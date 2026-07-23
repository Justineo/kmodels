import { load } from "cheerio";
import { z } from "zod";
import { linkedBundleSchema } from "./bundle.ts";
import { modelIdSchema } from "./identity.ts";
import { apiEndpointKey, baseModel } from "./model.ts";
import { publishedRate } from "./pricing.ts";
import {
  type Modality,
  type ModelType,
  type PriceRate,
  type Provider,
  type ProviderModel,
  unknownCapabilities,
} from "./schema.ts";
import type { SourceManifest } from "./manifests.ts";

interface Input {
  provider: Provider;
  source: SourceManifest;
  body: string;
  observedAt: string;
}

const endpointSchema = z.enum([
  "chat",
  "embed",
  "embed_image",
  "classify",
  "summarize",
  "rerank",
  "rate",
  "generate",
  "transcriptions",
]);
const apiItemSchema = z.object({
  name: modelIdSchema,
  is_deprecated: z.boolean().optional(),
  endpoints: z.array(endpointSchema).optional(),
  context_length: z.number().int().nonnegative().optional(),
});
const apiSchema = z.object({
  models: z.array(z.unknown()).min(1),
  next_page_token: z.string().min(1).optional(),
});
const pricingSchema = z.object({
  inputLabel: z.string().min(1),
  inputPrice: z.number().finite().nonnegative().nullable().optional(),
  outputLabel: z.string().min(1).optional(),
  outputPrice: z.number().finite().nonnegative().nullable().optional(),
  overridePer: z.string().min(1).optional(),
});
const pricingModelSchema = z.object({
  modelName: z.string().min(1),
  per: z.string().min(1),
  pricings: z.array(pricingSchema).optional(),
  portableDescription: z.array(z.unknown()).optional(),
});

type Document = ReturnType<typeof load>;
type ApiEndpoint = NonNullable<ProviderModel["api_endpoints"]>[number];

interface LinkedDocument {
  url: string;
  body: string;
}

interface EndpointDefinition {
  documentPath: string;
  title: string;
  marker: string;
  endpoint: ApiEndpoint;
  href?: string;
  labels: string[];
  modelList?: "embed_jobs" | "generate";
}

interface EndpointReference {
  endpoint: ApiEndpoint;
  labels: string[];
  modelIds?: Set<string>;
}

interface EndpointReferences {
  byHref: Map<string, EndpointReference>;
  byLabel: Map<string, EndpointReference>;
}

interface ApiEndpointFact {
  type: ModelType;
  endpoint?: ApiEndpoint;
}

const endpointDefinitions: EndpointDefinition[] = [
  {
    documentPath: "/reference/chat.md",
    title: "Chat",
    marker: "POST https://api.cohere.com/v2/chat",
    endpoint: { name: "Chat V2", path: "v2/chat" },
    href: "/reference/chat",
    labels: ["Chat", "Chat V2"],
  },
  {
    documentPath: "/reference/chat-v1.md",
    title: "Chat (V1)",
    marker: "POST https://api.cohere.com/v1/chat",
    endpoint: { name: "Chat V1", path: "v1/chat" },
    labels: ["Chat V1"],
  },
  {
    documentPath: "/reference/embed.md",
    title: "Embed API (v2)",
    marker: "POST https://api.cohere.com/v2/embed",
    endpoint: { name: "Embed", path: "v2/embed" },
    href: "/reference/embed",
    labels: ["Embed"],
  },
  {
    documentPath: "/reference/create-embed-job.md",
    title: "Create an Embed Job",
    marker: "POST https://api.cohere.com/v1/embed-jobs",
    endpoint: { name: "Embed Jobs", path: "v1/embed-jobs" },
    href: "/reference/embed-jobs",
    labels: ["Embed Jobs"],
    modelList: "embed_jobs",
  },
  {
    documentPath: "/reference/rerank.md",
    title: "Rerank API (v2)",
    marker: "POST https://api.cohere.com/v2/rerank",
    endpoint: { name: "Rerank", path: "v2/rerank" },
    href: "/reference/rerank",
    labels: ["Rerank"],
  },
  {
    documentPath: "/reference/create-audio-transcription.md",
    title: "Create a transcription",
    marker: "POST https://api.cohere.com/v2/audio/transcriptions",
    endpoint: { name: "Audio Transcriptions", path: "v2/audio/transcriptions" },
    href: "/reference/create-audio-transcription",
    labels: ["Audio Transcriptions"],
  },
  {
    documentPath: "/docs/compatibility-api.md",
    title: "Using Cohere models via the OpenAI SDK",
    marker: "https://api.cohere.ai/compatibility/v1/chat/completions",
    endpoint: { name: "Chat Completions", path: "compatibility/v1/chat/completions" },
    labels: ["Chat Completions"],
  },
  {
    documentPath: "/v1/reference/generate.md",
    title: "Generate",
    marker: "POST https://api.cohere.com/v1/generate",
    endpoint: { name: "Generate", path: "v1/generate" },
    labels: ["Generate"],
    modelList: "generate",
  },
];

const apiEndpointFacts = new Map<z.infer<typeof endpointSchema>, ApiEndpointFact>([
  ["chat", { type: "generate" }],
  ["embed", { type: "embeddings" }],
  ["embed_image", { type: "embeddings" }],
  ["classify", { type: "classification", endpoint: { name: "Classify", path: "v1/classify" } }],
  ["summarize", { type: "generate", endpoint: { name: "Summarize", path: "v1/summarize" } }],
  ["rerank", { type: "rerank" }],
  ["rate", { type: "other" }],
  ["generate", { type: "generate", endpoint: { name: "Generate", path: "v1/generate" } }],
  ["transcriptions", { type: "audio_transcription" }],
]);

const typeByEndpointLabel = new Map<string, ModelType>([
  ["Chat", "generate"],
  ["Chat V1", "generate"],
  ["Chat V2", "generate"],
  ["Chat Completions", "generate"],
  ["Generate", "generate"],
  ["Embed", "embeddings"],
  ["Embed Jobs", "embeddings"],
  ["Rerank", "rerank"],
  ["Audio Transcriptions", "audio_transcription"],
]);

const months = new Map(
  ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].map(
    (month, index) => [month, String(index + 1).padStart(2, "0")],
  ),
);

function text(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function dimmed(style: string | undefined): boolean {
  return /opacity\s*:\s*0\.5/.test(style ?? "");
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function date(value: string): string | undefined {
  const iso = value.match(/\b(\d{4}-\d{2}-\d{2})\b/)?.[1];
  if (iso !== undefined) return iso;
  const match = value.match(
    /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/i,
  );
  const month =
    match?.[1] === undefined ? undefined : months.get(match[1].slice(0, 3).toLowerCase());
  return month === undefined || match?.[2] === undefined || match[3] === undefined
    ? undefined
    : `${match[3]}-${month}-${match[2].padStart(2, "0")}`;
}

function tokens(value: string): number | undefined {
  const match = value.replace(/,/g, "").match(/(\d+(?:\.\d+)?)\s*([km])?\b/i);
  if (match?.[1] === undefined) return undefined;
  const number = Number(match[1]);
  const multiplier = match[2]?.toLowerCase() === "m" ? 1_000_000 : match[2] ? 1_000 : 1;
  return Number.isSafeInteger(number * multiplier) ? number * multiplier : undefined;
}

function typesFromEndpointLabels(labels: string[]): ModelType[] {
  return unique(
    labels.map((label) => {
      const type = typeByEndpointLabel.get(label);
      if (type === undefined) throw new Error(`Unsupported Cohere model endpoint: ${label}`);
      return type;
    }),
  );
}

function typeFromId(id: string): ModelType[] {
  if (id.startsWith("embed-")) return ["embeddings"];
  if (id.startsWith("rerank-")) return ["rerank"];
  if (id.startsWith("cohere-transcribe-")) return ["audio_transcription"];
  return ["generate"];
}

function listedModelIds(
  body: string,
  kind: NonNullable<EndpointDefinition["modelList"]>,
): Set<string> {
  const section =
    kind === "embed_jobs"
      ? body.match(
          /Available models and corresponding embedding dimensions:\s*((?:\s*-\s+`[^`]+`[^\n]*(?:\n|$))+)/,
        )?.[1]
      : text(body).match(/Currently available models are (.*?)(?: Smaller,|$)/)?.[1];
  if (section === undefined) throw new Error(`Cohere ${kind} model list drifted`);
  const values = [...section.matchAll(/`([^`]+)`/g)].map((match) => modelIdSchema.parse(match[1]));
  const ids = new Set(values);
  if (ids.size === 0 || ids.size !== values.length)
    throw new Error(`Cohere ${kind} model list drifted`);
  return ids;
}

function endpointReferences(documents: LinkedDocument[]): EndpointReferences {
  const byHref = new Map<string, EndpointReference>();
  const byLabel = new Map<string, EndpointReference>();
  for (const definition of endpointDefinitions) {
    const matches = documents.filter(
      (document) => new URL(document.url).pathname === definition.documentPath,
    );
    const document = matches[0];
    if (
      matches.length !== 1 ||
      document === undefined ||
      document.body.match(/^# ([^\n]+)$/m)?.[1] !== definition.title ||
      !document.body.includes(definition.marker)
    )
      throw new Error(`Cohere API reference drifted: ${definition.endpoint.name}`);
    const modelIds =
      definition.modelList === undefined
        ? undefined
        : listedModelIds(document.body, definition.modelList);
    const reference: EndpointReference =
      modelIds === undefined
        ? { endpoint: definition.endpoint, labels: definition.labels }
        : { endpoint: definition.endpoint, labels: definition.labels, modelIds };
    if (definition.href !== undefined) byHref.set(definition.href, reference);
    for (const label of definition.labels) byLabel.set(label, reference);
  }
  return { byHref, byLabel };
}

function withEndpoints(current: ProviderModel, values: ApiEndpoint[]): ProviderModel {
  if (values.length === 0) return current;
  const merged = new Map(
    [...(current.api_endpoints ?? []), ...values].map((value) => [apiEndpointKey(value), value]),
  );
  return {
    ...current,
    api_endpoints: [...merged.values()].sort((left, right) =>
      apiEndpointKey(left).localeCompare(apiEndpointKey(right)),
    ),
  };
}

function linkedEndpoints(
  labels: string[],
  links: { label: string; href: string | undefined }[],
  id: string,
  references: EndpointReferences,
): ApiEndpoint[] {
  if (labels.join("\0") !== links.map(({ label }) => label).join("\0"))
    throw new Error(`Cohere endpoint links drifted for ${id}`);
  return links.flatMap(({ label, href }) => {
    const url = href === undefined ? undefined : new URL(href, "https://docs.cohere.com");
    const reference =
      url?.origin === "https://docs.cohere.com" ? references.byHref.get(url.pathname) : undefined;
    if (reference === undefined || !reference.labels.includes(label))
      throw new Error(`Unsupported Cohere model endpoint: ${label}`);
    return reference.modelIds !== undefined && !reference.modelIds.has(id)
      ? []
      : [reference.endpoint];
  });
}

function model(models: Map<string, ProviderModel>, input: Input, id: string): ProviderModel {
  const current = models.get(id);
  if (current !== undefined) return current;
  const created = {
    ...baseModel({
      providerId: input.provider.id,
      id,
      name: id,
      sourceId: input.source.id,
      observedAt: input.observedAt,
    }),
    types: typeFromId(id),
  };
  models.set(id, created);
  return created;
}

function update(
  models: Map<string, ProviderModel>,
  input: Input,
  id: string,
  change: (current: ProviderModel) => ProviderModel,
): void {
  models.set(id, change(model(models, input, id)));
}

function rootTables(
  input: Input,
  models: Map<string, ProviderModel>,
  body: string,
  references: EndpointReferences,
): void {
  const $ = load(body);
  $("table").each((_tableIndex, table) => {
    const headers = $(table)
      .find("tr")
      .first()
      .find("th,td")
      .map((_index, cell) => text($(cell).text()))
      .get();
    if (headers[0] !== "Model Name") return;
    const column = (name: string): number => headers.indexOf(name);
    $(table)
      .find("tr")
      .slice(1)
      .each((_rowIndex, row) => {
        const elements = $(row).find("td");
        const cells = elements.map((_index, cell) => text($(cell).text())).get();
        const parsedId = modelIdSchema.safeParse(cells[0]);
        if (!parsedId.success) return;
        const id = parsedId.data;
        model(models, input, id);
        if (!headers.includes("Description") && !headers.includes("Status")) return;
        const value = (name: string): string | undefined => {
          const index = column(name);
          return index < 0 ? undefined : cells[index];
        };
        const statusText = value("Status");
        const description = value("Description");
        const modality = value("Modality") ?? value("Modalities") ?? "";
        const endpoint = value("Endpoints") ?? "";
        const endpointIndex = column("Endpoints");
        const endpointCell = endpointIndex < 0 ? undefined : elements.eq(endpointIndex);
        const endpointLabels = endpoint.split(",").map(text).filter(Boolean);
        const apiEndpoints =
          endpointCell === undefined
            ? []
            : linkedEndpoints(
                endpointLabels,
                endpointCell
                  .find("a[href]")
                  .map((_index, element) => ({
                    label: text($(element).text()),
                    href: $(element).attr("href"),
                  }))
                  .get(),
                id,
                references,
              );
        const context = tokens(value("Context Length") ?? "");
        const output = tokens(value("Maximum Output Tokens") ?? "");
        const dimensions = unique(
          [...(value("Dimensions") ?? "").matchAll(/\d[\d,]*/g)]
            .map((match) => Number(match[0]?.replace(/,/g, "")))
            .filter((item) => Number.isSafeInteger(item) && item > 0),
        );
        const modelTypes =
          endpointLabels.length === 0 ? typeFromId(id) : typesFromEndpointLabels(endpointLabels);
        const isEmbedding = modelTypes.includes("embeddings");
        const isTranscription = modelTypes.includes("audio_transcription");
        const inputModalities: Modality[] = [];
        if (modality.toLowerCase().includes("text")) inputModalities.push("text");
        if (modality.toLowerCase().includes("image")) inputModalities.push("image");
        if (modality.toLowerCase().includes("pdf")) inputModalities.push("pdf");
        if (isTranscription) inputModalities.push("audio");
        const outputModalities: Modality[] = [];
        if (isEmbedding) outputModalities.push("embedding");
        if (isTranscription || modelTypes.includes("generate")) outputModalities.push("text");
        const deprecated = statusText?.startsWith("Deprecated") ?? false;
        const retired = statusText?.startsWith("Retired") ?? false;
        const active = statusText === "Live";
        update(models, input, id, (current) =>
          withEndpoints(
            {
              ...current,
              description: description || current.description,
              types: modelTypes,
              modalities:
                inputModalities.length + outputModalities.length > 0
                  ? { input: [...inputModalities], output: [...outputModalities] }
                  : current.modalities,
              limits: {
                ...current.limits,
                ...(context === undefined ? {} : { context_tokens: context }),
                ...(output === undefined ? {} : { max_output_tokens: output }),
                ...(dimensions.length === 0 ? {} : { embedding_dimensions: dimensions }),
                ...(dimensions.length <= 1
                  ? {}
                  : {
                      recommended_embedding_dimensions: [dimensions.at(-1) ?? 0].filter(
                        (item) => item > 0,
                      ),
                    }),
              },
              status: retired
                ? "retired"
                : deprecated
                  ? "deprecated"
                  : active
                    ? "active"
                    : current.status,
              is_deprecated: retired || deprecated ? true : active ? false : current.is_deprecated,
              deprecated_at: deprecated ? date(statusText ?? "") : current.deprecated_at,
              retired_at: retired ? date(statusText ?? "") : current.retired_at,
            },
            apiEndpoints,
          ),
        );
      });
  });
}

function cardTitle($: Document): string | undefined {
  const value = text($("h1").first().text())
    .replace(/^Cohere(?:'s|’s)\s+/i, "")
    .replace(/\s+Models?$/i, "");
  return value || undefined;
}

function cardId($: Document): string | undefined {
  const value = $("strong")
    .filter((_index, element) => text($(element).text()) === "Model ID")
    .first()
    .next()
    .text();
  const parsed = modelIdSchema.safeParse(text(value));
  return parsed.success ? parsed.data : undefined;
}

function cardMatchesPath(id: string, pathname: string): boolean {
  const page = pathname.split("/").filter(Boolean).at(-1);
  return page !== undefined && id.replace(/-\d{2}-\d{4}$/, "") === page;
}

function addRate(current: ProviderModel, rate: PriceRate): ProviderModel {
  const key = (item: PriceRate): string =>
    JSON.stringify([item.meter, item.unit, item.conditions, item.source_ref]);
  const existing = current.pricing.find((item) => key(item) === key(rate));
  if (existing !== undefined) {
    const decimal = (value: string): string => {
      const [whole = "", fraction = ""] = value.split(".");
      const normalizedWhole = whole.replace(/^0+(?=\d)/, "") || "0";
      const normalizedFraction = fraction.replace(/0+$/, "");
      return normalizedFraction ? `${normalizedWhole}.${normalizedFraction}` : normalizedWhole;
    };
    if (decimal(existing.price) !== decimal(rate.price))
      throw new Error(`Cohere pricing sources disagree for ${current.model_id}`);
    return current;
  }
  return { ...current, pricing: [...current.pricing, rate], pricing_status: "published" };
}

function commandCard(
  input: Input,
  models: Map<string, ProviderModel>,
  url: URL,
  body: string,
  references: EndpointReferences,
): void {
  const $ = load(body);
  const id = cardId($);
  if (id === undefined || !cardMatchesPath(id, url.pathname)) return;
  const title = cardTitle($);
  const capabilities = { ...unknownCapabilities() };
  const capabilityCard = $(".fern-card").filter((_index, card) =>
    text($(card).text()).startsWith("Capabilities"),
  );
  const capability = new Map<string, boolean>();
  capabilityCard.find("span").each((_index, element) => {
    const label = text($(element).text());
    if (
      !["Citations", "Tool Use", "Structured Outputs", "Reasoning", "Image Inputs"].includes(label)
    )
      return;
    capability.set(label, !dimmed($(element).attr("style")));
  });
  capabilities.citations = capability.get("Citations") ?? "unknown";
  capabilities.tool_call = capability.get("Tool Use") ?? "unknown";
  capabilities.structured_output = capability.get("Structured Outputs") ?? "unknown";
  capabilities.reasoning = capability.get("Reasoning") ?? "unknown";
  const specification = text(
    $(".fern-card")
      .filter((_index, card) => text($(card).text()).startsWith("Specifications"))
      .text(),
  );
  const context = tokens(specification.match(/Context Window:\s*([\d,]+\s*tokens)/i)?.[1] ?? "");
  const output = tokens(specification.match(/Max Output Tokens:\s*([\d,]+\s*tokens)/i)?.[1] ?? "");
  const endpointCard = $(".fern-card").filter((_index, card) =>
    text($(card).text()).startsWith("API Endpoints"),
  );
  const endpointLabels = endpointCard
    .find("span")
    .filter((_index, element) => !dimmed($(element).attr("style")))
    .map((_index, element) => text($(element).text()))
    .get();
  if (endpointLabels.length === 0) throw new Error(`Cohere endpoint card drifted for ${id}`);
  const types = typesFromEndpointLabels(endpointLabels);
  const apiEndpoints = endpointLabels.map((label) => {
    const reference = references.byLabel.get(label);
    if (reference === undefined) throw new Error(`Unsupported Cohere model endpoint: ${label}`);
    return reference.endpoint;
  });
  const inputModalities = [...model(models, input, id).modalities.input];
  if (capability.get("Image Inputs") === true) inputModalities.push("image");
  update(models, input, id, (current) =>
    withEndpoints(
      {
        ...current,
        name: title ?? current.name,
        types,
        modalities: {
          input: unique(inputModalities),
          output: current.modalities.output,
        },
        capabilities: { ...current.capabilities, ...capabilities },
        limits: {
          ...current.limits,
          ...(context === undefined ? {} : { context_tokens: context }),
          ...(output === undefined ? {} : { max_output_tokens: output }),
        },
      },
      apiEndpoints,
    ),
  );
  const pricing = text(
    $(".fern-card")
      .filter((_index, card) => text($(card).text()).startsWith("Pricing"))
      .text(),
  );
  const direct = pricing.match(
    /Input\$([\d.]+)\s*\/\s*1M tokensOutput\$([\d.]+)\s*\/\s*1M tokens/i,
  );
  if (direct?.[1] !== undefined && direct[2] !== undefined) {
    const inputPrice = direct[1];
    const outputPrice = direct[2];
    update(models, input, id, (current) =>
      addRate(
        addRate(
          current,
          publishedRate("input_text", inputPrice, "million_tokens", input.source.id, "1M tokens"),
        ),
        publishedRate("output_text", outputPrice, "million_tokens", input.source.id, "1M tokens"),
      ),
    );
  } else if (/free until rate limits|contact (?:our )?sales|Model Vault/i.test(pricing)) {
    update(models, input, id, (current) => ({ ...current, pricing_status: "custom_quote" }));
  }
}

function transcribePage(
  input: Input,
  models: Map<string, ProviderModel>,
  url: URL,
  body: string,
  references: EndpointReferences,
): void {
  const $ = load(body);
  const label = $("strong")
    .filter((_index, element) => /^Model name:?$/i.test(text($(element).text())))
    .first()
    .parent()
    .text();
  const parsed = modelIdSchema.safeParse(text(label).replace(/^Model name:\s*/i, ""));
  if (!parsed.success) return;
  const expected = url.pathname.endsWith("transcribe-arabic")
    ? /^cohere-transcribe-arabic-\d{2}-\d{4}$/
    : /^cohere-transcribe-\d{2}-\d{4}$/;
  if (!expected.test(parsed.data)) return;
  const description = $(".fern-prose p")
    .map((_index, element) => text($(element).text()))
    .get()
    .find((value) => value.length >= 40);
  const endpointHref = $("a")
    .filter(
      (_index, element) =>
        text($(element).text()) === "Audio Transcriptions API reference documentation",
    )
    .first()
    .attr("href");
  const endpointUrl =
    endpointHref === undefined ? undefined : new URL(endpointHref, "https://docs.cohere.com");
  const endpoint =
    endpointUrl?.origin === "https://docs.cohere.com"
      ? references.byHref.get(endpointUrl.pathname)
      : undefined;
  if (endpoint?.endpoint.name !== "Audio Transcriptions")
    throw new Error("Cohere transcription endpoint link drifted");
  const customQuote = /via our API for free[\s\S]*Model Vault/i.test(text($(".fern-prose").text()));
  update(models, input, parsed.data, (current) =>
    withEndpoints(
      {
        ...current,
        name: text($("h1").first().text()) || current.name,
        description: current.description ?? description,
        types: ["audio_transcription"],
        modalities: { input: ["audio"], output: ["text"] },
        status: "active",
        is_deprecated: false,
        pricing_status: customQuote ? "custom_quote" : current.pricing_status,
      },
      [endpoint.endpoint],
    ),
  );
}

function lifecycle(input: Input, models: Map<string, ProviderModel>, body: string): void {
  const $ = load(body);
  const applyList = (heading: string, status: "deprecated" | "retired", at: string): void => {
    const section = $("h3").filter((_index, element) =>
      text($(element).text()).startsWith(heading),
    );
    const ids = section
      .nextAll("ul")
      .first()
      .find("code")
      .map((_index, element) => text($(element).text()))
      .get()
      .filter((value) => modelIdSchema.safeParse(value).success);
    if (ids.length === 0)
      throw new Error(`Cohere lifecycle section ${heading} contained no model IDs`);
    for (const id of ids)
      update(models, input, id, (current) => ({
        ...current,
        status,
        is_deprecated: true,
        deprecated_at: status === "deprecated" ? at : current.deprecated_at,
        retired_at: status === "retired" ? at : current.retired_at,
      }));
  };
  applyList("2026-04-04:", "retired", "2026-04-04");
  applyList("2025-09-15:", "deprecated", "2025-09-15");
  const table = $("table").filter((_index, element) =>
    text($(element).find("tr").first().text()).includes("Deprecated Model"),
  );
  table
    .find("tr")
    .slice(1)
    .each((_index, row) => {
      const cells = $(row)
        .find("td")
        .map((_cellIndex, cell) => text($(cell).text()))
        .get();
      const id = modelIdSchema.safeParse(cells[1]);
      const replacement = modelIdSchema.safeParse(cells[3]);
      if (!id.success || !replacement.success || cells[0] === undefined) return;
      update(models, input, id.data, (current) => ({
        ...current,
        types: ["rerank"],
        status: "retired",
        is_deprecated: true,
        retired_at: cells[0],
        replacement_model_ids: unique([...current.replacement_model_ids, replacement.data]),
      }));
      const price = cells[2]?.match(/\$([\d.]+)\s*\/\s*1K searches/i)?.[1];
      if (price !== undefined)
        update(models, input, id.data, (current) =>
          addRate(
            current,
            publishedRate(
              "rerank_request",
              price,
              "thousand_search_units",
              input.source.id,
              "1K searches",
            ),
          ),
        );
    });
}

function key(value: string, keepDate: boolean): string {
  return value
    .toLowerCase()
    .replace(/[+]/g, " plus ")
    .replace(/\bc4ai\b|\bcohere(?:'s|’s)?\b|\bmodel\b/g, " ")
    .replace(keepDate ? /$^/ : /-\d{2}-\d{4}\b/g, " ")
    .replace(/\bv(?=\d)/g, "")
    .replace(/(\d+)\.0\b/g, "$1")
    .replace(/[^a-z0-9]+/g, "");
}

function matchProduct(
  models: Map<string, ProviderModel>,
  label: string,
  keepDate = false,
): ProviderModel | undefined {
  const target = key(label, keepDate);
  const matches = [...models.values()].filter(
    (item) =>
      item.status !== "retired" &&
      (key(item.model_id, keepDate) === target || key(item.name, keepDate) === target),
  );
  return matches.length === 1 ? matches[0] : undefined;
}

function collectPricing(value: unknown, result: z.infer<typeof pricingModelSchema>[]): void {
  const parsed = pricingModelSchema.safeParse(value);
  if (parsed.success) result.push(parsed.data);
  if (Array.isArray(value)) {
    for (const item of value) collectPricing(item, result);
    return;
  }
  const record = z.record(z.string(), z.unknown()).safeParse(value);
  if (record.success) for (const item of Object.values(record.data)) collectPricing(item, result);
}

function pricingModels($: Document): z.infer<typeof pricingModelSchema>[] {
  const result: z.infer<typeof pricingModelSchema>[] = [];
  $("script").each((_index, element) => {
    const script = ($(element).html() ?? "").trim();
    const prefix = "self.__next_f.push(";
    if (!script.startsWith(prefix) || !script.endsWith(")")) return;
    const frame = z.array(z.unknown()).safeParse(JSON.parse(script.slice(prefix.length, -1)));
    if (!frame.success) return;
    const payload = z.string().safeParse(frame.data[1]);
    const colon = payload.success ? payload.data.indexOf(":") : -1;
    if (!payload.success || colon < 0) return;
    try {
      collectPricing(JSON.parse(payload.data.slice(colon + 1)), result);
    } catch {
      return;
    }
  });
  return [...new Map(result.map((item) => [item.modelName, item])).values()];
}

function nestedText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(nestedText).join(" ");
  const record = z.record(z.string(), z.unknown()).safeParse(value);
  return record.success ? Object.values(record.data).map(nestedText).join(" ") : "";
}

function applyPricing(input: Input, models: Map<string, ProviderModel>, body: string): void {
  const $ = load(body);
  const products = pricingModels($);
  const required = [
    "Command A+",
    "Command R",
    "Command R7B",
    "Transcribe",
    "Embed 4",
    "Rerank 4 Fast",
    "Rerank 4 Pro",
  ];
  if (required.some((name) => !products.some((item) => item.modelName === name)))
    throw new Error("Cohere pricing model structure drifted");
  for (const product of products) {
    const current = matchProduct(models, product.modelName);
    if (current === undefined) continue;
    if (product.per === "Free") {
      update(models, input, current.model_id, (item) => ({
        ...item,
        pricing_status: "custom_quote",
      }));
      continue;
    }
    for (const item of product.pricings ?? []) {
      const unit = item.overridePer ?? product.per;
      const add = (label: string, price: number): void => {
        const normalized = label.toLowerCase();
        const rate =
          unit === "1K searches"
            ? publishedRate(
                "rerank_request",
                String(price),
                "thousand_search_units",
                input.source.id,
                unit,
              )
            : current.types.includes("embeddings")
              ? publishedRate("embedding", String(price), "million_tokens", input.source.id, unit, {
                  modality: normalized.includes("image") ? "image" : "text",
                })
              : publishedRate(
                  normalized.includes("output") ? "output_text" : "input_text",
                  String(price),
                  "million_tokens",
                  input.source.id,
                  unit,
                );
        update(models, input, current.model_id, (modelValue) => addRate(modelValue, rate));
      };
      if (item.inputPrice !== undefined && item.inputPrice !== null)
        add(item.inputLabel, item.inputPrice);
      if (
        item.outputLabel !== undefined &&
        item.outputPrice !== undefined &&
        item.outputPrice !== null
      )
        add(item.outputLabel, item.outputPrice);
    }
    if (product.modelName === "Transcribe") {
      const value = nestedText(product.portableDescription).match(
        /\$+([\d.]+)\s*\/\s*hour\s*\/\s*instance/i,
      )?.[1];
      if (value !== undefined)
        update(models, input, current.model_id, (item) =>
          addRate(
            item,
            publishedRate(
              "provisioned_throughput",
              value,
              "unit_hour",
              input.source.id,
              "hour / instance",
              { endpoint: "Model Vault", capacity: "starting rate" },
            ),
          ),
        );
    }
  }
  const legacy =
    /(.+?) pricing is \$([\d.]+)\/1M tokens for input and \$([\d.]+)\/1M tokens for output/i;
  $("li,p").each((_index, element) => {
    const match = text($(element).text()).match(legacy);
    const current = match?.[1] === undefined ? undefined : matchProduct(models, match[1], true);
    if (current === undefined || match?.[2] === undefined || match[3] === undefined) return;
    const inputPrice = match[2];
    const outputPrice = match[3];
    update(models, input, current.model_id, (item) =>
      addRate(
        addRate(
          item,
          publishedRate("input_text", inputPrice, "million_tokens", input.source.id, "1M tokens"),
        ),
        publishedRate("output_text", outputPrice, "million_tokens", input.source.id, "1M tokens"),
      ),
    );
  });
  const aya = text($("body").text()).match(
    /Aya Expanse models \(8B and 32B\).*?\$([\d.]+)\/1M tokens for input and \$([\d.]+)\/1M tokens for output/i,
  );
  if (aya?.[1] !== undefined && aya[2] !== undefined)
    for (const id of ["c4ai-aya-expanse-8b", "c4ai-aya-expanse-32b"])
      if (models.has(id))
        update(models, input, id, (item) =>
          addRate(
            addRate(
              item,
              publishedRate(
                "input_text",
                aya[1] ?? "",
                "million_tokens",
                input.source.id,
                "1M tokens",
              ),
            ),
            publishedRate(
              "output_text",
              aya[2] ?? "",
              "million_tokens",
              input.source.id,
              "1M tokens",
            ),
          ),
        );
  $("div.grid")
    .filter((_index, row) => $(row).children().length === 4)
    .each((_index, row) => {
      const cells = $(row)
        .children()
        .map((_cellIndex, cell) => text($(cell).text()))
        .get();
      const current = cells[0] === undefined ? undefined : matchProduct(models, cells[0]);
      const hourly = cells[2]?.match(/\$([\d,.]+)/)?.[1]?.replace(/,/g, "");
      const monthly = cells[3]?.match(/\$([\d,.]+)/)?.[1]?.replace(/,/g, "");
      if (
        current === undefined ||
        cells[1] === undefined ||
        hourly === undefined ||
        monthly === undefined
      )
        return;
      const conditions = { endpoint: "Model Vault", capacity: cells[1] };
      update(models, input, current.model_id, (item) =>
        addRate(
          addRate(
            item,
            publishedRate(
              "provisioned_throughput",
              hourly,
              "unit_hour",
              input.source.id,
              "hour / instance",
              conditions,
            ),
          ),
          publishedRate(
            "provisioned_throughput",
            monthly,
            "unit_month",
            input.source.id,
            "month / instance",
            conditions,
          ),
        ),
      );
    });
}

function includesId(value: string, id: string): boolean {
  return [...value.matchAll(/[a-z0-9][a-z0-9._:/-]*/gi)].some(
    (match) => match[0].replace(/[.,;:]+$/, "").toLowerCase() === id.toLowerCase(),
  );
}

function applyRelease(
  input: Input,
  models: Map<string, ProviderModel>,
  value: string,
  released: string | undefined,
  display?: string,
): void {
  if (released === undefined) return;
  const matches = [...models.values()].filter(
    (current) => /[-._/:]/.test(current.model_id) && includesId(value, current.model_id),
  );
  for (const current of matches)
    update(models, input, current.model_id, (item) => ({
      ...item,
      name:
        matches.length === 1 && display !== undefined && item.name === item.model_id
          ? display
          : item.name,
      release_date: released,
    }));
}

function releases(
  input: Input,
  models: Map<string, ProviderModel>,
  body: string,
  root: boolean,
): void {
  const $ = load(body);
  if (!root) {
    const value = text($(".fern-prose").text());
    if (!/(?:announc|releas|refresh)/i.test(value) || /(?:deprecat|retirement notice)/i.test(value))
      return;
    const display = text($("h2,h3").first().text())
      .replace(/^(?:Announcing|Meet)\s+/i, "")
      .replace(/^Cohere(?:'s|’s)\s+/i, "")
      .replace(/\s+Model(?: is Here!)?$/i, "");
    applyRelease(
      input,
      models,
      value,
      date(text($(".fern-docs-badge").first().text())),
      display || undefined,
    );
    return;
  }
  const entries = new Map<string, string>();
  $(".fern-docs-badge").each((_index, badge) => {
    const link = $(badge).closest("a");
    const path = link.attr("href");
    if (path !== undefined && !entries.has(path)) entries.set(path, text($(badge).text()));
  });
  const prose = $(".fern-prose")
    .map((_index, element) => text($(element).text()))
    .get()
    .filter(Boolean);
  if (entries.size !== prose.length) throw new Error("Cohere changelog structure drifted");
  [...entries].forEach(([path, value], index) => {
    if (/(?:retirement|deprecat)/i.test(path)) return;
    const content = prose[index];
    if (content !== undefined) applyRelease(input, models, content, date(value));
  });
}

function applyGenerateEndpoint(
  input: Input,
  models: Map<string, ProviderModel>,
  references: EndpointReferences,
): void {
  const reference = references.byLabel.get("Generate");
  if (reference?.modelIds === undefined)
    throw new Error("Cohere Generate API reference is missing");
  for (const id of reference.modelIds) {
    if (!models.has(id)) throw new Error(`Cohere Generate model did not match the catalog: ${id}`);
    update(models, input, id, (current) => withEndpoints(current, [reference.endpoint]));
  }
}

export function parseCohereCatalog(input: Input): ProviderModel[] {
  const bundle = linkedBundleSchema.parse(JSON.parse(input.body));
  const models = new Map<string, ProviderModel>();
  const references = endpointReferences(bundle.documents);
  rootTables(input, models, bundle.index.body, references);
  for (const document of bundle.documents) {
    const url = new URL(document.url);
    if (url.pathname.startsWith("/docs/command-"))
      commandCard(input, models, url, document.body, references);
    if (/^\/docs\/transcribe(?:-arabic)?$/.test(url.pathname))
      transcribePage(input, models, url, document.body, references);
    if (url.pathname === "/docs/deprecations") lifecycle(input, models, document.body);
    if (url.hostname === "cohere.com" && url.pathname === "/pricing")
      applyPricing(input, models, document.body);
  }
  applyGenerateEndpoint(input, models, references);
  for (const document of bundle.documents) {
    const url = new URL(document.url);
    if (url.pathname.includes("/changelog"))
      releases(input, models, document.body, url.pathname === "/v2/changelog");
  }
  if (models.size < 35 || models.size > 60)
    throw new Error("Cohere model count outside reviewed bounds");
  return [...models.values()].sort((left, right) => left.model_id.localeCompare(right.model_id));
}

export function parseCohereApi(input: Input): ProviderModel[] {
  const value = apiSchema.parse(JSON.parse(input.body));
  if (value.next_page_token !== undefined)
    throw new Error("Cohere Models API response was truncated");
  const items = value.models.map((item) => apiItemSchema.safeParse(item));
  if (items.some((item) => !item.success)) throw new Error("Cohere Models API schema drift");
  return items.flatMap((result) => {
    if (!result.success) return [];
    const item = result.data;
    const facts = (item.endpoints ?? []).map((endpoint) => {
      const fact = apiEndpointFacts.get(endpoint);
      if (fact === undefined) throw new Error(`Unsupported Cohere API endpoint: ${endpoint}`);
      return fact;
    });
    const types = unique(facts.map((fact) => fact.type));
    const modelTypes: ModelType[] = types.length > 0 ? types : ["other"];
    const apiEndpoints = unique(
      facts.flatMap(({ endpoint }) => (endpoint === undefined ? [] : [endpoint])),
    ).sort((left, right) => apiEndpointKey(left).localeCompare(apiEndpointKey(right)));
    return [
      {
        ...baseModel({
          providerId: input.provider.id,
          id: item.name,
          name: item.name,
          sourceId: input.source.id,
          observedAt: input.observedAt,
        }),
        types: modelTypes,
        api_endpoints: apiEndpoints.length === 0 ? undefined : apiEndpoints,
        limits:
          item.context_length === undefined || item.context_length === 0
            ? {}
            : { context_tokens: item.context_length },
        status: item.is_deprecated === true ? "deprecated" : "unknown",
        is_deprecated: item.is_deprecated ?? "unknown",
      },
    ];
  });
}
