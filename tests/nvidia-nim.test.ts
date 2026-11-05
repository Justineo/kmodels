import { expect, it, vi } from "vite-plus/test";
import { collectProvider } from "../src/catalog/collector.ts";
import { fetchSource, linkedDocumentUrls } from "../src/catalog/fetch.ts";
import { sha256 } from "../src/catalog/io.ts";
import { manifests } from "../src/catalog/manifests.ts";

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
