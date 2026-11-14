import { load } from "cheerio";
import { z } from "zod";
import { linkedBundleSchema } from "./bundle.ts";
import { modelIdSchema } from "./identity.ts";
import { markdownProse, markdownSection } from "./markdown.ts";
import { baseModel } from "./model.ts";
import {
  nvidiaBuildPage,
  nvidiaBuildUrl,
  nvidiaEndpointBase,
  nvidiaEndpointMetadataSchema,
  nvidiaEndpointSpecSchema,
} from "./nvidia-build.ts";
import type { ParsedProviderModel } from "./pricing-source.ts";
import { modalitySchema, type ModelTask } from "./schema.ts";
import { parseSourceJson, assertSourceConstraint } from "./source-contract.ts";
import type { SourceParseInput } from "./source-parse.ts";

const buildOrigin = "https://build.nvidia.com";
const cardPath = /^\/[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/iu;
const modelsSchema = z.object({
  object: z.literal("list"),
  data: z
    .array(z.object({ object: z.literal("model"), id: modelIdSchema }))
    .min(1)
    .max(2_000),
});

function hostedIds(body: string): string[] {
  const { data } = modelsSchema.parse(parseSourceJson(body, "NVIDIA hosted model list"));
  assertSourceConstraint(
    "NVIDIA hosted model list repeated a model ID",
    new Set(data.map(({ id }) => id)).size === data.length,
    data,
  );
  return data.map(({ id }) => id);
}

export function parseNvidiaNimModels(input: SourceParseInput) {
  return hostedIds(input.body).map((id) =>
    baseModel({
      providerId: input.provider.id,
      id,
      name: id,
      sourceId: input.source.id,
      observedAt: input.observedAt,
    }),
  );
}

function candidateSlugs(id: string): string[] {
  if (!cardPath.test(`/${id}`)) return [];
  const [publisher, model] = id.split("/");
  if (publisher === undefined || model === undefined) return [];
  const alternate = `${publisher}/${model.replaceAll(".", "_")}`;
  return alternate === id ? [id] : [id, alternate];
}

export function nvidiaNimCardUrls(body: string): string[] {
  return hostedIds(body).flatMap((id) =>
    candidateSlugs(id).map((slug) => `${buildOrigin}/${slug}`),
  );
}

const flightFrame = z.tuple([z.literal(1), z.string()]);
const recordSchema = z.record(z.string(), z.unknown());
const cardIdentity = z.object({
  endpointName: z.string().min(1),
  publisherName: z.string().min(1),
  isDeprecated: z.boolean().optional(),
});
const cardConfiguration = z.object({
  artifactName: z.string().min(1),
  openAPISpec: z.unknown(),
  attributes: z.object({
    specifications: z
      .object({
        contextLength: z.number().int().positive().optional(),
        inputModalities: z.array(z.string()).optional(),
        outputModalities: z.array(z.string()).optional(),
      })
      .optional(),
    modelCapability: z
      .object({
        functionCalling: z.boolean().optional(),
        structuredOutput: z.boolean().optional(),
        reasoning: z.boolean().optional(),
      })
      .optional(),
    deprecationNotice: z.string().optional(),
    showUnavailableBanner: z.boolean().optional(),
  }),
});
const cardArtifact = z.object({
  artifactType: z.literal("ENDPOINT"),
  publisher: z.string(),
  name: z.string(),
  displayName: z.string().trim().min(1).optional(),
  updatedDate: z.iso.datetime({ offset: true }).optional(),
});
const openApi = z.object({
  servers: z.array(z.object({ url: z.string() })),
  paths: recordSchema,
  components: z.object({ schemas: recordSchema.optional() }).optional(),
});

function* objects(value: unknown): Generator<Record<string, unknown>> {
  if (Array.isArray(value)) {
    for (const item of value) yield* objects(item);
    return;
  }
  if (value === null || typeof value !== "object") return;
  const record: Record<string, unknown> = { ...value };
  yield record;
  for (const item of Object.values(record)) yield* objects(item);
}

function* cardRecords($: ReturnType<typeof load>) {
  const chunks: string[] = [];
  for (const element of $("script").toArray()) {
    const frame = $(element)
      .text()
      .trim()
      .match(/^self\.__next_f\.push\((\[1,"(?:[^"\\]|\\.)*"\])\);?$/su)?.[1];
    if (frame === undefined) continue;
    const chunk = flightFrame.safeParse(JSON.parse(frame));
    if (chunk.success) chunks.push(chunk.data[1]);
  }
  const stream = Buffer.from(chunks.join(""));
  let offset = 0;
  while (offset < stream.length) {
    const colon = stream.indexOf(":", offset);
    if (colon === -1 || !/^[a-f0-9]*$/u.test(stream.toString("ascii", offset, colon))) return;
    const start = colon + 1;
    if (stream[start] === 0x54) {
      // Flight text records count UTF-8 bytes and can end directly before the next row.
      const comma = stream.indexOf(",", start + 1);
      if (comma === -1) return;
      const size = stream.toString("ascii", start + 1, comma);
      if (!/^[a-f0-9]{1,8}$/u.test(size)) return;
      offset = comma + 1 + Number.parseInt(size, 16);
      continue;
    }
    const newline = stream.indexOf("\n", start);
    offset = newline === -1 ? stream.length : newline + 1;
    if (stream[start] !== 0x5b && stream[start] !== 0x7b) continue;
    const row = stream.toString("utf8", start, newline === -1 ? stream.length : newline);
    if (!/"(?:endpointName|artifactName|artifactType)"/u.test(row)) continue;
    let value: unknown;
    try {
      value = JSON.parse(row);
    } catch {
      continue;
    }
    yield* objects(value);
  }
}

const apiRoutes = new Map<string, { name: string; task: ModelTask }>([
  ["/chat/completions", { name: "Chat completions", task: "text_generation" }],
  ["/completions", { name: "Completions", task: "text_generation" }],
  ["/embeddings", { name: "Embeddings", task: "embeddings" }],
  ["/ranking", { name: "Rerank", task: "reranking" }],
  ["/rerank", { name: "Rerank", task: "reranking" }],
  ["/audio/transcriptions", { name: "Transcriptions", task: "transcription" }],
  ["/audio/translations", { name: "Audio translations", task: "translation" }],
]);
const operationSchema = z.object({
  post: z.object({
    description: z.string().optional(),
    requestBody: z.object({
      content: z.object({ "application/json": z.object({ schema: z.unknown() }) }),
    }),
  }),
});
const modelParameter = z.object({
  properties: z.object({
    model: z.object({
      default: z.string().optional(),
      example: z.string().optional(),
      enum: z.array(z.string()).optional(),
    }),
    input: z.unknown().optional(),
    modality: z.unknown().optional(),
    dimensions: z.unknown().optional(),
    passages: z.unknown().optional(),
  }),
});
const passageArray = z.object({ items: z.unknown() });
const passageFields = z.object({ properties: recordSchema });
const modalityChoices = z.object({ enum: z.array(z.string()) });
const dimensionsRange = z.object({
  minimum: z.number().int().positive(),
  maximum: z.number().int().positive(),
  description: z.string().optional(),
  deprecated: z.boolean().optional(),
});
const inputDescription = z.object({ description: z.string() });

function requestSchema(schema: unknown, components: Record<string, unknown> | undefined): unknown {
  const reference = z.object({ $ref: z.string() }).safeParse(schema);
  const name = reference.success
    ? reference.data.$ref.match(/^#\/components\/schemas\/([^/~]+)$/u)?.[1]
    : undefined;
  return name === undefined ? schema : components?.[name];
}

function exactRoutes(value: unknown, id: string) {
  const spec = openApi.safeParse(value);
  if (!spec.success) return [];
  const shared = spec.data.servers.some(({ url }) =>
    /^https:\/\/integrate\.api\.nvidia\.com\/v1\/?$/u.test(url),
  );
  const retrieval = spec.data.servers.some(({ url }) =>
    /^https:\/\/ai\.api\.nvidia\.com\/v1\/?$/u.test(url),
  );
  const components = spec.data.components?.schemas;
  return Object.entries(spec.data.paths).flatMap(([path, endpoint]) => {
    const isRetrieval =
      retrieval &&
      (path === `/retrieval/${id}/reranking` || path === "/retrieval/nvidia/reranking");
    const route = isRetrieval
      ? { name: "Rerank", task: "reranking" as const }
      : shared
        ? apiRoutes.get(path)
        : undefined;
    const operation = operationSchema.safeParse(endpoint);
    if (route === undefined || !operation.success) return [];
    const post = operation.data.post;
    const parameter = modelParameter.safeParse(
      requestSchema(post.requestBody.content["application/json"].schema, components),
    );
    if (!parameter.success) return [];
    const properties = parameter.data.properties;
    const model = properties.model;
    const passages = passageArray.safeParse(properties.passages);
    return model.default === id || model.example === id || model.enum?.includes(id)
      ? [
          {
            ...route,
            path: isRetrieval ? `https://ai.api.nvidia.com/v1${path}` : `/v1${path}`,
            properties,
            description: post.description,
            passage: requestSchema(passages.data?.items, components),
          },
        ]
      : [];
  });
}

function modalities(values: string[] | undefined) {
  return [
    ...new Set(
      (values ?? []).flatMap((value) => {
        const modality = modalitySchema.safeParse(value.toLowerCase());
        return modality.success ? [modality.data] : [];
      }),
    ),
  ];
}

function readCard(
  input: SourceParseInput,
  id: string,
  slug: string,
  body: string,
): ParsedProviderModel | undefined {
  const $ = load(body);
  let identity: z.infer<typeof cardIdentity> | undefined;
  let configuration: z.infer<typeof cardConfiguration> | undefined;
  let artifact: z.infer<typeof cardArtifact> | undefined;
  for (const record of cardRecords($)) {
    if (record.endpointName !== undefined) {
      const parsed = cardIdentity.safeParse(record);
      if (parsed.success && `${parsed.data.publisherName}/${parsed.data.endpointName}` === slug)
        identity = parsed.data;
    }
    if (record.artifactName !== undefined) {
      const parsed = cardConfiguration.safeParse(record);
      if (parsed.success && parsed.data.artifactName === slug.split("/")[1])
        configuration = parsed.data;
    }
    if (record.artifactType === "ENDPOINT") {
      const parsed = cardArtifact.safeParse(record);
      if (parsed.success && `${parsed.data.publisher}/${parsed.data.name}` === slug)
        artifact = parsed.data;
    }
  }
  if (identity === undefined || configuration === undefined) return;
  const routes = exactRoutes(configuration.openAPISpec, id);
  // A page-slug variant needs a hosted request that names the original inventory ID.
  if (slug !== id && routes.length === 0) return;
  return cardModel(
    input,
    id,
    configuration,
    artifact,
    $('meta[name="description"]').attr("content")?.trim(),
    identity.isDeprecated === true,
    routes,
  );
}

function cardModel(
  input: SourceParseInput,
  id: string,
  configuration: z.infer<typeof cardConfiguration>,
  artifact: z.infer<typeof cardArtifact> | undefined,
  description: string | undefined,
  deprecatedIdentity: boolean,
  routes: ReturnType<typeof exactRoutes>,
): ParsedProviderModel {
  const { attributes } = configuration;
  const model = baseModel({
    providerId: input.provider.id,
    id,
    name: artifact?.displayName ?? id,
    sourceId: input.source.id,
    observedAt: input.observedAt,
  });
  if (description) model.description = description;
  if (artifact !== undefined) model.model_card = { publisher: artifact.publisher };
  if (artifact?.updatedDate !== undefined) model.updated_date = artifact.updatedDate.slice(0, 10);
  const specs = attributes.specifications;
  if (specs?.contextLength !== undefined) model.limits.context_tokens = specs.contextLength;
  model.modalities = {
    input: modalities(specs?.inputModalities),
    output: modalities(specs?.outputModalities),
  };
  const capabilities = attributes.modelCapability;
  model.capabilities.tool_call = capabilities?.functionCalling ?? "unknown";
  model.capabilities.structured_output = capabilities?.structuredOutput ?? "unknown";
  model.capabilities.reasoning = capabilities?.reasoning ?? "unknown";
  const deprecated = deprecatedIdentity || Boolean(attributes.deprecationNotice?.trim());
  if (deprecated) model.status = "deprecated";
  if (!deprecated && attributes.showUnavailableBanner === false && routes.length > 0) {
    model.tasks = [...new Set(routes.map(({ task }) => task))];
    model.api_endpoints = routes.map(({ name, path }) => ({ name, path }));
  }
  return model;
}

function apiCard(
  input: SourceParseInput,
  slug: string,
  metadataBody: string,
  specBody: string,
  inventory: ReadonlySet<string>,
): ParsedProviderModel | undefined {
  const { artifact } = nvidiaEndpointMetadataSchema.parse(
    parseSourceJson(metadataBody, "NVIDIA endpoint metadata"),
  );
  const raw = nvidiaEndpointSpecSchema.parse(
    parseSourceJson(specBody, "NVIDIA endpoint specification"),
  );
  if (`${artifact.publisher}/${artifact.name}` !== slug || raw.artifactName !== artifact.name)
    return;
  if (!artifact.isPublic) return;
  const attributes = parseSourceJson(raw.attributes, "NVIDIA endpoint attributes");
  const configuration = cardConfiguration.parse({
    artifactName: raw.artifactName,
    attributes,
    openAPISpec:
      raw.openAPISpec == null || raw.openAPISpec.trim() === ""
        ? undefined
        : parseSourceJson(raw.openAPISpec, "NVIDIA endpoint OpenAPI"),
  });
  const spec = openApi.safeParse(configuration.openAPISpec);
  const ids = new Set([...inventory].filter((id) => candidateSlugs(id).includes(slug)));
  if (spec.success)
    for (const endpoint of Object.values(spec.data.paths)) {
      const operation = operationSchema.safeParse(endpoint);
      if (!operation.success) continue;
      const properties = modelParameter.safeParse(
        requestSchema(
          operation.data.post.requestBody.content["application/json"].schema,
          spec.data.components?.schemas,
        ),
      );
      if (!properties.success) continue;
      const model = properties.data.properties.model;
      for (const id of model.default !== undefined
        ? [model.default]
        : model.example !== undefined
          ? [model.example]
          : model.enum?.length === 1
            ? model.enum
            : [])
        if (exactRoutes(configuration.openAPISpec, id).length > 0) ids.add(modelIdSchema.parse(id));
    }
  const hosted = [...ids].filter((id) => exactRoutes(configuration.openAPISpec, id).length > 0);
  assertSourceConstraint(
    "NVIDIA endpoint specification repeated model identities",
    hosted.length <= 1,
    slug,
  );
  const fixed =
    spec.success &&
    spec.data.servers.some(({ url }) =>
      /^https:\/\/(?:ai|health|vision)\.api\.nvidia\.com(?:\/v1)?\/?$/u.test(url),
    )
      ? [...inventory].filter((id) =>
          Object.keys(spec.data.paths).some(
            (path) => path.endsWith(`/${id}`) || path.includes(`/${id}/`),
          ),
        )
      : [];
  const id = hosted[0] ?? (fixed.length === 1 ? fixed[0] : undefined) ?? modelIdSchema.parse(slug);
  const model = cardModel(
    input,
    id,
    configuration,
    artifact,
    artifact.shortDescription,
    artifact.attributes.some(({ key, value }) => key === "DEPRECATED" && value === "true"),
    exactRoutes(configuration.openAPISpec, id),
  );
  if (!inventory.has(id) && !artifact.labels.includes("nimType:endpoint:nim_type_preview")) return;
  if (configuration.attributes.showUnavailableBanner !== false || model.status === "deprecated")
    return inventory.has(id) ? model : undefined;
  if (hosted.length > 0) return model;
  const endpoints: { name: string; path: string }[] = [];
  if (spec.success)
    for (const { url } of spec.data.servers) {
      if (!/^https:\/\/(?:ai|health|vision)\.api\.nvidia\.com(?:\/v1)?\/?$/u.test(url)) continue;
      for (const [path, value] of Object.entries(spec.data.paths)) {
        const post = z
          .object({ post: z.object({ summary: z.string().optional() }) })
          .safeParse(value);
        if (
          !post.success ||
          !(path.endsWith(`/${id}`) || path.includes(`/${id}/`)) ||
          path.endsWith("/models") ||
          path.includes("{")
        )
          continue;
        endpoints.push({
          name: post.data.post.summary?.trim() || "Inference",
          path: url.replace(/\/$/u, "") + path,
        });
      }
    }
  if (endpoints.length === 0 && z.uuid().safeParse(raw.nvcfFunctionId).success) {
    const usage = z.object({ usage: z.string().optional() }).parse(attributes).usage ?? "";
    if (
      /--target\s+grpc\.nvcf\.nvidia\.com:443\b/u.test(usage) &&
      /--function-id\s+<%- nvcfFunctionId %>/u.test(usage)
    ) {
      endpoints.push({ name: "NVCF gRPC", path: "grpc.nvcf.nvidia.com:443" });
      for (const [flag, modality] of [
        ["--video-input", "video"],
        ["--audio-input", "audio"],
        ["--image-input", "image"],
      ] as const)
        if (usage.includes(`${flag} `) && !model.modalities.input.includes(modality))
          model.modalities.input.push(modality);
    } else if (raw.nvcfInferencePath !== "/grpc" && raw.nvcfInferencePath?.startsWith("/"))
      endpoints.push({
        name: "NVCF function invocation",
        path: `https://api.nvcf.nvidia.com/v2/nvcf/pexec/functions/${raw.nvcfFunctionId}`,
      });
  }
  if (endpoints.length === 0) return inventory.has(id) ? model : undefined;
  model.api_endpoints = endpoints;
  model.model_card = {
    publisher: artifact.publisher,
    access: "Free Endpoint",
  };
  return model;
}

export function parseNvidiaNimCards(input: SourceParseInput): ParsedProviderModel[] {
  const bundle = linkedBundleSchema.parse(parseSourceJson(input.body, "NVIDIA model card bundle"));
  const documents = new Map(bundle.documents.map(({ url, body }) => [url, body]));
  const ids = new Set(hostedIds(bundle.index.body));
  const buildUrl = nvidiaBuildUrl();
  const buildPages = bundle.documents.filter(({ url }) =>
    url.startsWith(buildUrl.origin + buildUrl.pathname),
  );
  const extraSlugs = buildPages.flatMap(({ body }, page) => nvidiaBuildPage(body, page).slugs);
  const native = new Map<string, ParsedProviderModel>();
  for (const slug of new Set([...[...ids].flatMap(candidateSlugs), ...extraSlugs])) {
    const name = slug.split("/")[1];
    const url = nvidiaEndpointBase + name;
    const metadata = documents.get(url),
      spec = documents.get(url + "/spec");
    if (metadata === undefined || spec === undefined) continue;
    const model = apiCard(input, slug, metadata, spec, ids);
    if (model !== undefined) native.set(model.model_id, model);
  }
  const models = (input.catalogModels ?? []).flatMap(({ model_id }) => {
    if (!ids.has(model_id) || native.has(model_id)) return [];
    for (const slug of candidateSlugs(model_id)) {
      const body = documents.get(`${buildOrigin}/${slug}`);
      if (body === undefined) continue;
      const model = readCard(input, model_id, slug, body);
      if (model !== undefined) return [model];
    }
    return [];
  });
  assertSourceConstraint(
    "NVIDIA cards did not match any hosted model IDs",
    models.length + native.size > 0,
    models.length,
  );
  return [...models, ...native.values()];
}

export function parseNvidiaNimRetrieval(input: SourceParseInput): ParsedProviderModel[] {
  const bundle = linkedBundleSchema.parse(
    parseSourceJson(input.body, "NVIDIA Retrieval API bundle"),
  );
  const index = markdownSection(bundle.index.body, 2, "Models");
  assertSourceConstraint(
    "NVIDIA Retrieval API registry omitted its model tables",
    index !== undefined,
    undefined,
  );
  const documents = new Map(bundle.documents.map(({ url, body }) => [url, body]));
  const models = new Map<string, ParsedProviderModel>();
  const rows = markdownProse(index).matchAll(
    /^\| \[([a-z0-9._-]+) \/ ([a-z0-9._-]+)\]\(https:\/\/docs\.api\.nvidia\.com\/nim\/reference\/[a-z0-9_-]+\)\s+\| \[[^\]\n]+\]\((https:\/\/docs\.api\.nvidia\.com\/nim\/reference\/[a-z0-9_-]+-(?:infer|invoke))\)/gimu,
  );
  for (const [, publisher, name, url] of rows) {
    const id = modelIdSchema.parse(`${publisher}/${name}`);
    const body = documents.get(`${url}.md`);
    const definition = body?.match(
      /^# OpenAPI definition\r?\n\s*```json\r?\n([\s\S]+?)\r?\n```/mu,
    )?.[1];
    if (definition === undefined) continue;
    const routes = exactRoutes(parseSourceJson(definition, "NVIDIA Retrieval OpenAPI"), id).filter(
      ({ task }) => task === "embeddings" || task === "reranking",
    );
    if (routes.length === 0) continue;
    const model =
      models.get(id) ??
      baseModel({
        providerId: input.provider.id,
        id,
        name: id,
        sourceId: input.source.id,
        observedAt: input.observedAt,
      });
    model.api_endpoints ??= [];
    for (const { task, name, path, properties, description, passage } of routes) {
      if (model.api_endpoints.some((endpoint) => endpoint.path === path)) continue;
      model.tasks.push(task);
      model.api_endpoints.push({ name, path });
      if (task === "embeddings") {
        model.modalities.output.push("embedding");
        model.modalities.input.push(
          ...modalities(modalityChoices.safeParse(properties.modality).data?.enum),
        );
        const dimensions = dimensionsRange.safeParse(properties.dimensions).data;
        if (
          dimensions !== undefined &&
          dimensions.minimum < dimensions.maximum &&
          dimensions.deprecated !== true &&
          !/\b(?:ignored|not implemented)\b/iu.test(dimensions.description ?? "")
        )
          model.limits.embedding_dimension_range = {
            min: dimensions.minimum,
            max: dimensions.maximum,
          };
      } else {
        const fields = passageFields.safeParse(passage);
        if (fields.success)
          model.modalities.input.push(...modalities(Object.keys(fields.data.properties)));
      }
      const limit =
        task === "embeddings"
          ? inputDescription
              .safeParse(properties.input)
              .data?.description.match(/\bMax length is ([1-9]\d*) tokens\b/u)?.[1]
          : description?.match(
              /\bmust fit within the model's context window of ([1-9]\d*) tokens\b/u,
            )?.[1];
      if (limit !== undefined && Number.isSafeInteger(Number(limit)))
        model.limits.max_input_tokens = Number(limit);
    }
    model.modalities.input = [...new Set(model.modalities.input)];
    model.modalities.output = [...new Set(model.modalities.output)];
    models.set(id, model);
  }
  assertSourceConstraint(
    "NVIDIA Retrieval API registry had no exact hosted requests",
    models.size > 0,
    models.size,
  );
  return [...models.values()];
}
