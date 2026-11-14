import { expect, it, vi } from "vite-plus/test";
import { collectProvider } from "../src/catalog/collector.ts";
import { fetchSource, linkedDocumentUrls } from "../src/catalog/fetch.ts";
import { sha256 } from "../src/catalog/io.ts";
import { manifests } from "../src/catalog/manifests.ts";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import {
  nvidiaBuildPage,
  nvidiaBuildUrl,
  nvidiaEndpointBase,
  nvidiaEndpointMetadataSchema,
  nvidiaEndpointSpecSchema,
} from "../src/catalog/nvidia-build.ts";
import { prepareCatalogPair } from "../src/catalog/pricing-publication.ts";
import { emptyPricingCatalog } from "../src/catalog/pricing-schema.ts";
import { compileInferencePriceMapping } from "../src/catalog/inference-pricing-compilation.ts";
import { priceDataExport } from "../src/catalog/pricing-lookup-export.ts";
import { projectCatalogPair } from "../src/catalog/projections.ts";

vi.mock("../src/catalog/fetch.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/catalog/fetch.ts")>()),
  fetchSource: vi.fn(),
}));

const sharedUrl = "https://integrate.api.nvidia.com/v1/models";
const buildUrl = "https://build.nvidia.com";
const chatId = "vendor/vision";
const embedId = "vendor/embed-3.5";
const embedSlug = "vendor/embed-3_5";
const unavailableId = "vendor/old";
const unknownId = "vendor/unknown";
const now = "2026-11-04T17:00:00.000Z";
const inventory = JSON.stringify({
  object: "list",
  data: [chatId, embedId, unavailableId, unknownId].map((id) => ({ object: "model", id })),
});

function card(
  slug: string,
  path: string,
  requestId: string,
  options = { deprecated: false, host: sharedUrl.replace("/models", "") },
) {
  const [publisherName, endpointName] = slug.split("/");
  const records = [
    { endpointName, publisherName, isDeprecated: options.deprecated },
    {
      artifact: {
        artifactType: "ENDPOINT",
        publisher: publisherName,
        name: endpointName,
        displayName: `Display ${endpointName}`,
        updatedDate: now,
      },
    },
    {
      artifactName: endpointName,
      attributes: {
        specifications: {
          contextLength: 262144,
          inputModalities: ["Text", "Image"],
          outputModalities: ["Text"],
        },
        modelCapability: { functionCalling: true, reasoning: true },
        showUnavailableBanner: false,
      },
      openAPISpec: {
        servers: [{ url: options.host }],
        paths: {
          [path]: {
            post: {
              requestBody: {
                content: {
                  "application/json": { schema: { $ref: "#/components/schemas/Request" } },
                },
              },
            },
          },
        },
        components: { schemas: { Request: { properties: { model: { default: requestId } } } } },
      },
    },
  ];
  const text = "多模态示例\ncode";
  const textRecord = `a:T${Buffer.byteLength(text).toString(16)},${text}`;
  const payload =
    ':HL["/styles.css","style"]\n' +
    textRecord +
    records.map((record, index) => `${index}:${JSON.stringify(record)}\n`).join("");
  return {
    url: `${buildUrl}/${slug}`,
    body: `<meta name="description" content="Description from NVIDIA"><script>self.__next_f.push(${JSON.stringify([1, payload])})</script>`,
  };
}

function manifest() {
  const nvidia = manifests.find(({ provider }) => provider.id === "nvidia");
  if (nvidia === undefined) throw new Error("Missing NVIDIA manifest");
  return nvidia;
}

function payload(body: string) {
  return {
    body,
    contentHash: sha256(body),
    etag: undefined,
    lastModified: undefined,
    dependencies: [],
  };
}

async function nativeBundle() {
  const rows = z
    .array(z.object({ metadata: nvidiaEndpointMetadataSchema, spec: nvidiaEndpointSpecSchema }))
    .parse(
      JSON.parse(
        await readFile(new URL("./fixtures/nvidia/build-endpoints.json", import.meta.url), "utf8"),
      ),
    );
  const resources = rows.map(({ metadata: { artifact } }) => ({
    resourceType: "ENDPOINT",
    resourceId: `qc69jvmznzxy/${artifact.name}`,
    name: artifact.name,
    labels: [
      { key: "publisher", values: [artifact.publisher], unresolvedValues: [artifact.publisher] },
      { key: "nimType", values: ["Free Endpoint"], unresolvedValues: ["nim_type_preview"] },
    ],
  }));
  const page = {
    params: { page: 0, pageSize: 100 },
    resultPageTotal: 1,
    resultTotal: resources.length,
    results: [
      { groupValue: "_scored", resources },
      { groupValue: "ENDPOINT", resources },
    ],
  };
  const documents = [
    { url: nvidiaBuildUrl().href, body: JSON.stringify(page) },
    ...rows.flatMap(({ metadata, spec }) => [
      { url: nvidiaEndpointBase + spec.artifactName, body: JSON.stringify(metadata) },
      { url: nvidiaEndpointBase + spec.artifactName + "/spec", body: JSON.stringify(spec) },
    ]),
  ];
  return { rows, page, bundle: { index: { url: sharedUrl, body: inventory }, documents } };
}

it("collects native endpoint APIs beyond the shared inventory without inventing free prices", async () => {
  const { bundle, page } = await nativeBundle();
  expect(nvidiaBuildPage(JSON.stringify(page), 0).slugs).toEqual([
    "moonshotai/kimi-k3_1-pro",
    "nvidia/body-pose",
  ]);
  vi.mocked(fetchSource).mockImplementation(async ({ id }) => {
    if (id === "nvidia-nim-models") return payload(inventory);
    if (id === "nvidia-nim-cards") return payload(JSON.stringify(bundle));
    throw new Error("No retrieval fixture");
  });
  const result = await collectProvider(manifest(), undefined, { sources: {} }, now);
  expect(
    result.models.find(({ model_id }) => model_id === "moonshotai/kimi-k3.1-pro"),
  ).toMatchObject({
    limits: { context_tokens: 1048576 },
    tasks: ["text_generation"],
    capabilities: { tool_call: true, structured_output: true, reasoning: true },
    model_card: { publisher: "moonshotai" },
    api_endpoints: [{ path: "/v1/chat/completions" }],
  });
  expect(result.models.some(({ model_id }) => model_id === "moonshotai/kimi-k3_1-pro")).toBe(false);
  expect(result.models.find(({ model_id }) => model_id === "nvidia/body-pose")).toMatchObject({
    api_endpoints: [{ name: "NVCF gRPC", path: "grpc.nvcf.nvidia.com:443" }],
    modalities: { input: ["video"], output: [] },
  });
  expect(result.pricing).toBeUndefined();
  const candidate = compileInferencePriceMapping(
    prepareCatalogPair(
      {
        catalog_version: "1".repeat(64),
        generated_at: now,
        providers: [result.provider],
        models: result.models,
        sources: result.sources,
        coverage: [result.coverage],
        warnings: result.warnings,
      },
      emptyPricingCatalog(),
    ),
    [],
  );
  expect(() => priceDataExport(candidate.catalog, candidate.pricing)).toThrow(
    /complete provider partitions/,
  );
  expect(candidate.inference?.mapping.rules ?? []).toEqual([]);
  const projection = await projectCatalogPair(candidate);
  expect(projection.ui.manifest.assets.length).toBeGreaterThan(0);
});

it.each(["foreign namespace", "repeated group", "missing page", "wrong cursor", "download only"])(
  "checks the native catalog scope: %s",
  async (scenario) => {
    const { page } = await nativeBundle();
    if (scenario === "foreign namespace")
      page.results[1]?.resources.forEach((r) => {
        r.resourceId = r.resourceId.replace("qc69jvmznzxy", "foreign");
      });
    if (scenario === "repeated group") page.results.push({ groupValue: "ENDPOINT", resources: [] });
    if (scenario === "missing page") page.resultTotal++;
    if (scenario === "wrong cursor") page.params.page = 1;
    if (scenario === "download only")
      page.results[1]?.resources.forEach((r) => {
        r.labels = r.labels.filter(({ key }) => key !== "nimType");
      });
    if (scenario === "download only")
      expect(nvidiaBuildPage(JSON.stringify(page), 0).slugs).toEqual([]);
    else expect(() => nvidiaBuildPage(JSON.stringify(page), 0)).toThrow();
  },
);

it.each(["private", "foreign publisher", "local only", "grpc without invocation", "deprecated"])(
  "does not admit an unqualified endpoint: %s",
  async (scenario) => {
    const { bundle, rows } = await nativeBundle();
    const row = rows[1];
    if (!row) throw new Error("Missing native endpoint fixture");
    if (scenario === "private") row.metadata.artifact.isPublic = false;
    if (scenario === "foreign publisher") row.metadata.artifact.publisher = "foreign";
    if (scenario === "local only") {
      delete row.spec.nvcfFunctionId;
      row.spec.openAPISpec = JSON.stringify({
        servers: [{ url: "http://localhost:8000" }],
        paths: {},
      });
    }
    if (scenario === "grpc without invocation")
      row.spec.attributes = JSON.stringify({ showUnavailableBanner: false });
    if (scenario === "deprecated")
      row.spec.attributes = JSON.stringify({
        showUnavailableBanner: false,
        deprecationNotice: "Retired.",
      });
    for (const document of bundle.documents) {
      if (document.url === nvidiaEndpointBase + "body-pose")
        document.body = JSON.stringify(row.metadata);
      if (document.url === nvidiaEndpointBase + "body-pose/spec")
        document.body = JSON.stringify(row.spec);
    }
    vi.mocked(fetchSource).mockImplementation(async ({ id }) => {
      if (id === "nvidia-nim-models") return payload(inventory);
      if (id === "nvidia-nim-cards") return payload(JSON.stringify(bundle));
      throw new Error("No retrieval fixture");
    });
    const result = await collectProvider(manifest(), undefined, { sources: {} }, now);
    expect(result.models.some(({ model_id }) => model_id === "nvidia/body-pose")).toBe(false);
    expect(result.models.some(({ model_id }) => model_id === "moonshotai/kimi-k3.1-pro")).toBe(
      true,
    );
  },
);

it("enriches exact hosted IDs and uses the hosted request schema to confirm alternate card slugs", async () => {
  const documents = [
    card(chatId, "/chat/completions", chatId),
    card(embedSlug, "/embeddings", embedId),
    card(unavailableId, "/chat/completions", unavailableId, {
      deprecated: true,
      host: "https://integrate.api.nvidia.com/v1",
    }),
    {
      ...card("different/unknown", "/chat/completions", unknownId),
      url: `${buildUrl}/${unknownId}`,
    },
    card("vendor/card-only", "/chat/completions", "vendor/card-only"),
  ];
  vi.mocked(fetchSource).mockImplementation(async ({ id }) =>
    payload(
      id === "nvidia-nim-models"
        ? inventory
        : JSON.stringify({ index: { url: sharedUrl, body: inventory }, documents }),
    ),
  );
  const result = await collectProvider(manifest(), undefined, { sources: {} }, now);
  expect(result.coverage.status).toBe("fresh");
  expect(result.models).toHaveLength(4);
  expect(result.models.find(({ model_id }) => model_id === chatId)).toMatchObject({
    name: "Display vision",
    description: "Description from NVIDIA",
    updated_date: "2026-11-04",
    limits: { context_tokens: 262144 },
    modalities: { input: ["text", "image"], output: ["text"] },
    capabilities: { tool_call: true, reasoning: true },
    api_endpoints: [{ name: "Chat completions", path: "/v1/chat/completions" }],
  });
  expect(result.models.find(({ model_id }) => model_id === embedId)).toMatchObject({
    tasks: ["embeddings"],
    api_endpoints: [{ name: "Embeddings", path: "/v1/embeddings" }],
  });
  expect(result.models.find(({ model_id }) => model_id === unavailableId)).toMatchObject({
    status: "deprecated",
    description: "Description from NVIDIA",
  });
  const unknown = result.models.find(({ model_id }) => model_id === unknownId);
  expect(unknown).toBeDefined();
  expect(unknown?.description).toBeUndefined();
});

it("keeps the hosted inventory when NVIDIA Build is unavailable", async () => {
  const source = manifest().sources.find(({ id }) => id === "nvidia-nim-cards");
  if (source === undefined) throw new Error("Missing NVIDIA card source");
  expect(linkedDocumentUrls(inventory, source).map(({ href }) => href)).toContain(
    `${buildUrl}/${embedSlug}`,
  );
  vi.mocked(fetchSource).mockImplementation(async ({ id }) => {
    if (id === source.id) throw new Error("HTTP 503");
    return payload(inventory);
  });
  const result = await collectProvider(manifest(), undefined, { sources: {} }, now);
  expect(result.coverage.status).toBe("fresh");
  expect(result.models).toHaveLength(4);
  expect(result.attempt.sources).toContainEqual(
    expect.objectContaining({ source_id: source.id, outcome: "fetch_failed" }),
  );
});

it("admits a retrieval-only model from an exact hosted request and rejects local or mismatched specs", async () => {
  const ref = "https://docs.api.nvidia.com/nim/reference";
  const reranker = "nvidia/rerank-3.5";
  const entries = [
    { name: "rerank-3.5", host: "https://ai.api.nvidia.com/v1", requestId: reranker },
    { name: "local-rerank", host: "http://localhost:8000", requestId: "nvidia/local-rerank" },
    { name: "other-rerank", host: "https://ai.api.nvidia.com/v1", requestId: reranker },
    {
      name: "fixed-embed",
      host: "https://integrate.api.nvidia.com/v1",
      requestId: "nvidia/fixed-embed",
      dimensions: { minimum: 1, maximum: 1, description: "This field is ignored." },
    },
    {
      name: "resize-embed",
      host: "https://integrate.api.nvidia.com/v1",
      requestId: "nvidia/resize-embed",
      dimensions: { minimum: 1, maximum: 4096 },
    },
  ];
  const body = [
    "## Models",
    "### nvidia",
    "| Model | Endpoint |",
    "| - | - |",
    ...entries.map(
      ({ name }) =>
        `| [nvidia / ${name}](${ref}/nvidia-${name.replaceAll(".", "_")}) | [Rerank](${ref}/nvidia-${name.replaceAll(".", "_")}-infer) |`,
    ),
  ].join("\n");
  const bundle = JSON.stringify({
    index: { url: `${ref}/retrieval-apis.md`, body },
    documents: entries.map(({ name, host, requestId, dimensions }) => ({
      url: `${ref}/nvidia-${name.replaceAll(".", "_")}-infer.md`,
      body:
        "# OpenAPI definition\n\n```json\n" +
        JSON.stringify({
          servers: [{ url: host }],
          paths: {
            [dimensions === undefined ? `/retrieval/nvidia/${name}/reranking` : "/embeddings"]: {
              post: {
                description:
                  "Each query + passage pair must fit within the model's context window of 10240 tokens.",
                requestBody: {
                  content: {
                    "application/json": {
                      schema: {
                        properties: {
                          model: { default: requestId },
                          dimensions,
                          passages: { items: { $ref: "#/components/schemas/Passage" } },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          components: { schemas: { Passage: { properties: { text: {}, image: {} } } } },
        }) +
        "\n```",
    })),
  });
  const source = manifest().sources.find(({ id }) => id === "nvidia-nim-retrieval");
  if (source === undefined) throw new Error("Missing NVIDIA retrieval source");
  expect(linkedDocumentUrls(body, source)).toHaveLength(5);
  vi.mocked(fetchSource).mockImplementation(async ({ id }) => {
    if (id === source.id) return payload(bundle);
    if (id === "nvidia-nim-models") return payload(inventory);
    throw new Error("No model card fixture");
  });
  const result = await collectProvider(manifest(), undefined, { sources: {} }, now);
  expect(result.coverage.status).toBe("fresh");
  expect(result.models).toHaveLength(7);
  expect(result.models.find(({ model_id }) => model_id === reranker)).toMatchObject({
    tasks: ["reranking"],
    modalities: { input: ["text", "image"], output: [] },
    limits: { max_input_tokens: 10240 },
    api_endpoints: [
      { name: "Rerank", path: `https://ai.api.nvidia.com/v1/retrieval/${reranker}/reranking` },
    ],
  });
  expect(
    result.models.find(({ model_id }) => model_id === "nvidia/fixed-embed")?.limits
      .embedding_dimension_range,
  ).toBeUndefined();
  expect(
    result.models.find(({ model_id }) => model_id === "nvidia/resize-embed")?.limits
      .embedding_dimension_range,
  ).toEqual({ min: 1, max: 4096 });
});
