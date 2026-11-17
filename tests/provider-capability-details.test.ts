import { readFile } from "node:fs/promises";
import { expect, it, vi } from "vite-plus/test";
import { parseSource } from "../src/catalog/adapters.ts";
import type { LinkedBundle } from "../src/catalog/bundle.ts";
import { collectProvider } from "../src/catalog/collector.ts";
import { fetchSource } from "../src/catalog/fetch.ts";
import { sha256 } from "../src/catalog/io.ts";
import { manifests, type ProviderManifest } from "../src/catalog/manifests.ts";
import { capabilityDetailsSchema } from "../src/catalog/model-capability-details.ts";
import { catalogSchema } from "../src/catalog/schema.ts";
import {
  addCapabilityDetailGroup,
  modelDocumentEvidence,
} from "../src/catalog/source-model-details.ts";
import { geminiInferenceFixtures } from "./gemini-inference-fixture.ts";
import { xaiInferenceBundle } from "./xai-inference-fixture.ts";

vi.mock("../src/catalog/fetch.ts", async (original) => ({
  ...(await original<typeof import("../src/catalog/fetch.ts")>()),
  fetchSource: vi.fn(),
}));

const fixture = (path: string) => readFile(new URL("./fixtures/" + path, import.meta.url), "utf8");
const at = "2026-11-18T00:00:00.000Z";

function sourceInput(providerId: string, sourceId: string) {
  const manifest = manifests.find(({ provider }) => provider.id === providerId);
  const source = manifest?.sources.find(({ id }) => id === sourceId);
  if (!manifest || !source) throw new Error("Missing capability test source");
  return { provider: { ...manifest.provider, source_ids: [sourceId] }, source };
}

function parse(providerId: string, sourceId: string, bundle: LinkedBundle | string) {
  const findings: string[] = [];
  const result = parseSource({
    ...sourceInput(providerId, sourceId),
    body: typeof bundle === "string" ? bundle : JSON.stringify(bundle),
    observedAt: at,
    onContractFinding: (finding) => findings.push(...finding.diagnostics.map(({ path }) => path)),
  });
  return { ...result, findings };
}

const studio = "https://aistudio.google.com/docs";
const generateQuery = "?generate-content=true";

async function geminiBundle(): Promise<LinkedBundle> {
  const { catalog } = await geminiInferenceFixtures();
  const own = await fixture("gemini/unified-context.txt");
  for (const [id, label, notes] of [
    ["gemini-4-carbon", "Gemini 4 Carbon", ""],
    ["gemini-3.8-flash", "Gemini 3.8 Flash", ""],
    ["gemini-2.5-flash-lite", "Gemini 2.5 Flash-Lite", ""],
    [
      "gemini-3.7-flash",
      "Gemini 3.7 Flash",
      "API requests to \x60gemini-3.7-flash\x60 are automatically routed to \x60gemini-3.8-flash\x60.",
    ],
  ]) {
    const url = studio + "/models/" + id;
    catalog.documents = catalog.documents.filter((document) => !document.url.endsWith("/" + id));
    const body = own
      .replace("Unified context probe", label ?? "")
      .replace("limit-probe", id ?? "")
      .replace("{% table", (notes ?? "") + "\n\n{% table");
    catalog.documents.push({
      url,
      body:
        id === "gemini-4-carbon"
          ? body +
            '\n[**Context caching**](/docs/caching)\n\n{% badge label=Supported (Implicit only) type="supported" /%}\n\nNote: Explicit caching is not supported.\n'
          : body,
    });
  }
  for (const [kind, path] of [
    ["cache", "caching"],
    ["thinking", "thinking"],
  ] as const)
    for (const branch of ["interactions", "generate"] as const)
      catalog.documents.push({
        url: studio + "/" + path + (branch === "generate" ? generateQuery : ""),
        body: await fixture("gemini/scoped-" + kind + "-" + branch + ".txt"),
      });
  return catalog;
}

it("keeps native Gemini cache modes and thinking defaults separate by exact API URL", async () => {
  const bundle = await geminiBundle();
  const { models } = parse("gemini", "gemini-models", bundle);
  const carbon = models.find(({ model_id }) => model_id === "gemini-4-carbon");
  const flash = models.find(({ model_id }) => model_id === "gemini-3.8-flash");
  expect(
    carbon?.capability_details?.find(({ claim }) => claim === "generate_content_cache_modes")
      ?.statements,
  ).toContainEqual(
    expect.objectContaining({ kind: "prompt_cache", mode: "explicit", supported: false }),
  );
  expect(
    flash?.capability_details?.find(({ claim }) => claim === "interactions_cache_modes")
      ?.statements,
  ).toContainEqual(
    expect.objectContaining({ kind: "prompt_cache", mode: "explicit", supported: false }),
  );
  expect(
    flash?.capability_details?.find(({ claim }) => claim === "generate_content_cache_modes")
      ?.statements,
  ).toContainEqual(
    expect.objectContaining({ kind: "prompt_cache", mode: "explicit", supported: true }),
  );
  expect(
    flash?.capability_details?.find(({ claim }) => claim === "interactions_thinking_levels")
      ?.statements,
  ).toEqual([
    expect.objectContaining({
      supported_values: ["low", "medium", "high"],
      default_value: "medium",
      unsupported_values: ["minimal"],
    }),
  ]);
  expect(
    models.find(({ model_id }) => model_id === "gemini-2.5-flash-lite")?.capability_details?.[0]
      ?.statements[0],
  ).not.toHaveProperty("default_value");
  const redirect = models.find(({ model_id }) => model_id === "gemini-3.7-flash");
  expect(redirect).toBeDefined();
  expect(redirect?.capability_details).toBeUndefined();
  const generate = bundle.documents.find(({ url }) => url === studio + "/caching" + generateQuery);
  expect(
    flash?.capability_details?.find(({ claim }) => claim === "generate_content_cache_modes")
      ?.evidence,
  ).toContainEqual(
    expect.objectContaining({
      document_url: generate?.url,
      content_hash: sha256(generate?.body ?? ""),
      observed_at: at,
    }),
  );
});

it("withholds a mislabelled Gemini API companion while a fresh sibling remains", async () => {
  const bundle = await geminiBundle();
  const interactions = bundle.documents.find(({ url }) => url === studio + "/thinking");
  const generate = bundle.documents.find(({ url }) => url === studio + "/thinking" + generateQuery);
  if (!interactions || !generate) throw new Error("Missing thinking control");
  generate.body = interactions.body;
  interactions.body = interactions.body.replace(
    "gemini-4-carbon | On (medium) | low, medium, high",
    "gemini-4-carbon | On (steady) | low, steady, high",
  );
  const { models, findings } = parse("gemini", "gemini-models", bundle);
  const carbon = models.find(({ model_id }) => model_id === "gemini-4-carbon");
  expect(
    carbon?.capability_details?.find(({ claim }) => claim === "interactions_thinking_levels")
      ?.statements,
  ).toContainEqual(
    expect.objectContaining({
      supported_values: ["low", "steady", "high"],
      default_value: "steady",
    }),
  );
  expect(
    carbon?.capability_details?.some(({ claim }) => claim === "generate_content_thinking_levels"),
  ).toBe(false);
  expect(findings).toContain("/capability_details/generate_content_thinking_levels");
});

async function xaiBundle(): Promise<LinkedBundle> {
  const bundle = await xaiInferenceBundle();
  const document = bundle.documents[0];
  if (!document) throw new Error("Missing xAI document");
  document.body += "\n\n" + (await fixture("xai/scoped-capability-effort.txt"));
  return bundle;
}

it("reconciles the xAI native Responses set and fallback through exact public model rows", async () => {
  const { models } = parse("xai", "xai-models", await xaiBundle());
  for (const [id, values] of [
    ["grok-4.7", ["low", "medium", "high", "xhigh"]],
    ["grok-4.6", ["low", "medium", "high", "xhigh"]],
    ["grok-4.5", ["low", "medium", "high"]],
  ] as const) {
    const model = models.find(({ model_id }) => model_id === id);
    const group = model?.capability_details?.find(
      ({ claim }) => claim === "responses_reasoning_effort",
    );
    expect(group?.statements).toEqual([
      expect.objectContaining({
        supported_values: values,
        default_value: "high",
        scope: expect.stringContaining("xAI Responses API"),
      }),
    ]);
    expect(model?.price_facts.length).toBeGreaterThan(0);
    if (id === "grok-4.5")
      expect(group?.statements[0]?.scope).toContain("xhigh is accepted as high");
  }
});

it("withholds a conflicting xAI default while preserving the model and price", async () => {
  const bundle = await xaiBundle();
  const document = bundle.documents[0];
  if (!document) throw new Error("Missing effort mutation target");
  document.body = document.body.replace(
    /\| \x60grok-4\.7\x60 \| \x60reasoning\.effort\x60: [^\r\n]+/,
    (line) =>
      line
        .replace('\x60"high"\x60 (default)', '\x60"high"\x60')
        .replace('\x60"low"\x60', '\x60"low"\x60 (default)'),
  );
  const { models, findings } = parse("xai", "xai-models", bundle);
  const model = models.find(({ model_id }) => model_id === "grok-4.7");
  expect(model).toBeDefined();
  expect(
    model?.capability_details?.some(({ claim }) => claim === "responses_reasoning_effort") ?? false,
  ).toBe(false);
  expect(model?.price_facts.length).toBeGreaterThan(0);
  expect(findings).toContain("/capability_details/responses_reasoning_effort/grok-4.7");
});

it("joins xAI automatic caching to exact Chat and Responses requests independently of effort", async () => {
  const bundle = await xaiBundle();
  const doc = bundle.documents[0];
  if (!doc) throw new Error("Missing xAI cache evidence");
  doc.body += "\n\n" + (await fixture("xai/scoped-capability-cache.txt"));
  bundle.index.body = bundle.index.body.replaceAll(
    '"defaultEffort":"high"',
    '"defaultEffort":null',
  );
  const { models } = parse("xai", "xai-models", bundle);
  const model = models.find(({ model_id }) => model_id === "grok-4.7");
  expect(model?.price_facts.length).toBeGreaterThan(0);
  expect(model?.capability_details?.map(({ claim }) => claim)).toEqual([
    "chat_cache_modes",
    "responses_cache_modes",
  ]);
  expect(model?.capability_details?.flatMap(({ statements }) => statements)).toEqual([
    expect.objectContaining({
      kind: "prompt_cache",
      mode: "implicit",
      supported: true,
      scope: expect.stringContaining("Chat Completions"),
    }),
    expect.objectContaining({
      kind: "prompt_cache",
      mode: "implicit",
      supported: true,
      scope: expect.stringContaining("Responses"),
    }),
  ]);
  const sibling = models.find(({ model_id }) => model_id === "grok-4.6");
  expect(sibling).toBeDefined();
  expect(sibling?.capability_details).toBeUndefined();
});

it("uses Kimi native enum and default without copying effort into an older model or generic operation", async () => {
  const body = (await fixture("kimi/openapi-k3-1.json")).replace(
    '"enum": ["low", "high", "max"],\n                "default": "max"',
    '"enum": ["low", "high", "max", "adaptive"],\n                "default": "adaptive"',
  );
  const { models } = parse("kimi", "kimi-openapi", body);
  const model = models.find(({ model_id }) => model_id === "kimi-k3.1-pro");
  const group = model?.capability_details?.find(({ claim }) => claim === "chat_reasoning_effort");
  expect(group?.statements).toEqual([
    expect.objectContaining({
      supported_values: ["low", "high", "max", "adaptive"],
      default_value: "adaptive",
    }),
  ]);
  expect(
    model?.capability_details?.some(({ claim }) => claim === "responses_reasoning_effort"),
  ).toBe(false);
  const older = models.find(({ model_id }) => model_id === "kimi-k2.6");
  expect(older).toBeDefined();
  expect(older?.capability_details).toBeUndefined();
});

it("withholds Kimi's malformed optional effort default without losing Chat identity", async () => {
  const body = (await fixture("kimi/openapi-k3-1.json")).replace(
    '"default": "max"',
    '"default": "unsupported"',
  );
  const { models, findings } = parse("kimi", "kimi-openapi", body);
  const model = models.find(({ model_id }) => model_id === "kimi-k3.1-pro");
  expect(model?.api_endpoints).toContainEqual({
    name: "Chat Completions",
    path: "/v1/chat/completions",
  });
  expect(model?.capability_details).toBeUndefined();
  expect(findings).toContain("/capability_details/chat_reasoning_effort");
});

it("allows a partial effort list beside an independently known default at the shared boundary", async () => {
  const body = await fixture("kimi/openapi-k3-1.json");
  const input = { ...sourceInput("kimi", "kimi-openapi"), body, observedAt: at };
  const model = parseSource(input).models.find(({ model_id }) => model_id === "kimi-k3");
  if (!model) throw new Error("Missing partial-list test model");
  addCapabilityDetailGroup(input, model, {
    claim: "examples_and_default",
    statements: [
      {
        kind: "reasoning_effort",
        supported_values: ["low"],
        default_value: "max",
        scope: "Kimi Chat Completions API",
      },
    ],
    evidence: [
      modelDocumentEvidence(
        input,
        { url: input.source.url, body },
        "Native reasoning_effort",
        "low is supported. Default: max.",
      ),
    ],
  });
  expect(
    model.capability_details?.find(({ claim }) => claim === "examples_and_default")?.statements[0],
  ).toMatchObject({
    supported_values: ["low"],
    default_value: "max",
  });
});

async function kimiMarketBundle(market: "china" | "international"): Promise<LinkedBundle> {
  const host = market === "china" ? "https://platform.kimi.com" : "https://platform.kimi.ai";
  const mode = '{"type":"object","properties":{"mode":{"type":"string","enum":["implicit"]}}}';
  const body = (await fixture("kimi/openapi-k3-1.json"))
    .replace('"prompt_cache_options": { "type": "object" }', '"prompt_cache_options": ' + mode)
    .replace(
      /("ResponsesRequest": \{\s+"properties": \{)/,
      '$1\n"prompt_cache_options": ' +
        mode +
        ',\n"reasoning": {"properties":{"effort":{"enum":["low","max"],"default":"max"}}},',
    )
    .replace(
      /("MessagesRequest": \{\s+"type": "object",\s+"properties": \{)/,
      '$1\n"cache_control": {"properties":{"type":{"enum":["ephemeral"]}}},\n"output_config": {"properties":{"effort":{"enum":["low","max"],"default":"max"}}},',
    )
    .replace(
      "https://api.moonshot.ai",
      market === "china" ? "https://api.moonshot.cn" : "https://api.moonshot.ai",
    );
  return {
    index: { url: host + "/docs/openapi.json", body },
    documents: [
      {
        url: host + "/docs/guide/context-caching.md",
        body: (market === "china"
          ? [
              "# 上下文缓存",
              "Chat Completions API 和 Responses API 在省略 \x60prompt_cache_options\x60 时默认按 \x605m\x60 TTL 写入缓存。需要指定 TTL 时，传入 \x60prompt_cache_options\x60：",
              "\x60prompt_cache_options.mode\x60 当前仅支持 \x60implicit\x60，\x60ttl\x60 支持 \x605m\x60 和 \x601h\x60。",
              "Anthropic Messages API 使用顶层 \x60cache_control\x60 设置缓存 TTL。省略该字段时，默认按 \x605m\x60 TTL 读写缓存；传入该字段时，可选择 TTL。",
              "> \x60kimi-k3.1-pro\x60、\x60kimi-k3\x60 支持 Cache Write。",
            ]
          : [
              "# Context Caching",
              "The Chat Completions API and Responses API write to the cache with a \x605m\x60 TTL by default when \x60prompt_cache_options\x60 is omitted. To specify a TTL, pass \x60prompt_cache_options\x60:",
              "\x60prompt_cache_options.mode\x60 currently supports only \x60implicit\x60, and \x60ttl\x60 supports \x605m\x60 and \x601h\x60.",
              "The Anthropic Messages API uses the top-level \x60cache_control\x60 field to set the cache TTL. When the field is omitted, cache reads and writes use the \x605m\x60 TTL by default; when it is provided, use \x60cache_control.ttl\x60 to select a TTL.",
              "> \x60kimi-k3\x60 and \x60kimi-k3.1-pro\x60 support Cache Write.",
            ]
        ).join("\n\n"),
      },
    ],
  };
}

it("retains only the stale Kimi cache claim in its own market while independent claims advance", async () => {
  const newer = "2026-11-18T01:00:00.000Z";
  const local = await kimiMarketBundle("china");
  const foreign = await kimiMarketBundle("international");
  const china = sourceInput("kimi", "kimi-china-openapi").source;
  const international = sourceInput("kimi", "kimi-openapi").source;
  const configured: ProviderManifest | undefined = manifests.find(
    ({ provider }) => provider.id === "kimi",
  );
  if (!configured) throw new Error("Missing Kimi provider");
  const manifest: ProviderManifest = { ...configured, sources: [international, china] };
  vi.mocked(fetchSource).mockImplementation(async (source) => {
    const body = JSON.stringify(source.id === china.id ? local : foreign);
    return {
      body,
      contentHash: sha256(body),
      etag: undefined,
      lastModified: undefined,
      dependencies: [],
    };
  });
  const first = await collectProvider(manifest, undefined, { sources: {} }, at);
  const previous = catalogSchema.parse({
    catalog_version: "a".repeat(64),
    generated_at: at,
    providers: [first.provider],
    models: first.models,
    sources: first.sources,
    coverage: [first.coverage],
    warnings: [],
  });
  const initial = previous.models.find(({ model_id }) => model_id === "kimi-k3");
  expect(initial?.capability_details).toHaveLength(10);
  local.index.body = local.index.body.replace(
    /("ResponsesRequest": \{\s+"properties": \{\s+)"prompt_cache_options"/,
    '$1"unrecognized_cache_options"',
  );
  const second = await collectProvider(manifest, previous, { sources: {} }, newer);
  const merged = second.models.find(({ model_id }) => model_id === "kimi-k3");
  const groups = merged?.capability_details ?? [];
  expect(groups).toHaveLength(10);
  for (const [owner, claim, clock] of [
    [china.id, "chat_responses_cache_modes", at],
    [china.id, "messages_cache_modes", newer],
    [china.id, "responses_reasoning_effort", newer],
    [international.id, "chat_responses_cache_modes", newer],
  ]) {
    const group = groups.find(
      ({ source_ref, claim: key }) => source_ref === owner && key === claim,
    );
    expect(group?.evidence.every(({ observed_at }) => observed_at === clock)).toBe(true);
    expect(group?.statements[0]?.scope).toContain(owner === china.id ? "China" : "international");
  }
  const cache = groups.find(
    ({ source_ref, claim }) => source_ref === china.id && claim === "chat_responses_cache_modes",
  );
  expect(cache?.evidence.some(({ excerpt }) => excerpt.includes("当前仅支持"))).toBe(true);
  const firstGroup = groups[0];
  if (!firstGroup) throw new Error("Missing collected effort evidence");
  expect(
    capabilityDetailsSchema.safeParse([...groups, { ...firstGroup, claim: "eleventh" }]).success,
  ).toBe(false);
  const oversized = groups.map((group) => ({
    ...group,
    evidence: group.evidence.map((evidence) => ({ ...evidence, excerpt: "🧪".repeat(1000) })),
  }));
  const overflow = capabilityDetailsSchema.safeParse(oversized);
  expect(overflow.error?.issues.map(({ message }) => message)).toContain("Details exceed 16 KiB");
  vi.mocked(fetchSource).mockReset();
});

it.each([
  [
    "international",
    "cache reads and writes use the \x605m\x60 TTL by default",
    "cache reads and writes use no cache by default",
    "messages_cache_modes",
    "chat_responses_cache_modes",
  ],
  [
    "china",
    "时默认按 \x605m\x60 TTL 写入缓存",
    "时默认不写入缓存",
    "chat_responses_cache_modes",
    "messages_cache_modes",
  ],
  [
    "china",
    "省略该字段时，默认按 \x605m\x60 TTL 读写缓存",
    "省略该字段时，默认不读写缓存",
    "messages_cache_modes",
    "chat_responses_cache_modes",
  ],
] as const)(
  "rejects cache default negation from the %s Kimi guide",
  async (market, before, after, affected, unaffected) => {
    const bundle = await kimiMarketBundle(market);
    const guide = bundle.documents[0];
    if (!guide?.body.includes(before)) throw new Error("Missing Kimi negation mutation target");
    guide.body = guide.body.replace(before, after);
    const sourceId = market === "china" ? "kimi-china-openapi" : "kimi-openapi";
    const { models, findings } = parse("kimi", sourceId, bundle);
    const model = models.find(({ model_id }) => model_id === "kimi-k3");
    expect(model).toBeDefined();
    expect(model?.capability_details?.map(({ claim }) => claim)).toEqual(
      expect.arrayContaining([
        unaffected,
        "chat_reasoning_effort",
        "responses_reasoning_effort",
        "messages_reasoning_effort",
      ]),
    );
    expect(model?.capability_details?.some(({ claim }) => claim === affected)).toBe(false);
    expect(findings).toContain("/capability_details/" + affected);
  },
);

function field(name: string, type: string, body: string): string {
  return `<div class="openapi-schema__list-item"><strong class="openapi-schema__property">${name}</strong><span class="openapi-schema__name">${type}</span>${body}</div>`;
}

it("inspects the owned DeepSeek effort by operation and leaves a missing Responses default absent", async () => {
  const source = "https://api-docs.deepseek.com";
  const choices =
    "<p>Possible values: <code>none</code>, <code>low</code>, <code>high</code>, <code>max</code></p>";
  const html = (path: string, request: string) =>
    `<article><pre class="openapi__method-endpoint"><span class="badge">POST</span><h2 class="openapi__method-endpoint-path">${path}</h2></pre><div class="openapi-markdown__details mime">${request}</div></article>`;
  const identity = field("model", "string", "<p>Possible values: <code>deepseek-v4-pro</code></p>");
  const bundle: LinkedBundle = {
    index: {
      url: source + "/quick_start/pricing/",
      body: await fixture("deepseek/inference-current.html"),
    },
    documents: [
      {
        url: source + "/api/create-chat-completion/",
        body: html(
          "/chat/completions",
          identity +
            field("reasoning_effort", "string", choices + "<p>The default effort is high.</p>"),
        ),
      },
      {
        url: source + "/api/create-response/",
        body: html(
          "/responses",
          identity + field("reasoning", "object", field("effort", "string", choices)),
        ),
      },
      {
        url: source + "/api/create-message/",
        body: html(
          "/anthropic/v1/messages",
          identity +
            field(
              "output_config",
              "object",
              field(
                "effort",
                "string",
                choices +
                  "<p>Controls thinking mode and effort, with high as the default effort.</p>",
              ),
            ),
        ),
      },
      { url: source + "/guides/anthropic_api/", body: await fixture("deepseek/anthropic.html") },
    ],
  };
  const { models } = parse("deepseek", "deepseek-catalog", bundle);
  const model = models.find(({ model_id }) => model_id === "deepseek-v4-pro");
  expect(model?.capability_details?.map(({ claim }) => claim)).toEqual([
    "chat_reasoning_effort",
    "responses_reasoning_effort",
    "messages_reasoning_effort",
  ]);
  const chat = model?.capability_details?.find(({ claim }) => claim === "chat_reasoning_effort");
  expect(chat?.statements[0]).toHaveProperty("default_value", "high");
  const responses = model?.capability_details?.find(
    ({ claim }) => claim === "responses_reasoning_effort",
  );
  expect(responses?.statements[0]).toEqual(
    expect.objectContaining({ supported_values: ["none", "low", "high", "max"] }),
  );
  expect(responses?.statements[0]).not.toHaveProperty("default_value");
});
