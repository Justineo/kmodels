import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vite-plus/test";
import { parseSource } from "../src/catalog/adapters.ts";
import { extractDashscopePricingInputs } from "../src/catalog/dashscope-accounting.ts";
import { manifests } from "../src/catalog/manifests.ts";
import { baseModel } from "../src/catalog/model.ts";
import { assembleParsedProviderPricing } from "../src/catalog/pricing-adapter.ts";
import { publishedRate } from "../src/catalog/pricing.ts";
import type {
  ParsedProviderModel,
  SourceCommercialPricingFact,
  SourcePricingInputFact,
} from "../src/catalog/pricing-source.ts";
import type { PricingReconciliationItem } from "../src/catalog/pricing-reconciliation.ts";

function configuration() {
  const manifest = manifests.find((m) => m.provider.id === "dashscope");
  const source = manifest?.sources.find((s) => s.id === "dashscope-pricing");
  if (manifest === undefined || source === undefined) throw new Error("Missing DashScope source");
  return {
    manifest,
    source,
    provider: { ...manifest.provider, source_ids: manifest.sources.map((s) => s.id) },
  };
}
const { source, provider } = configuration(),
  observedAt = "2026-10-20T00:00:00.000Z";
const origin = "https://www.alibabacloud.com/help/en/model-studio/";
const cacheRules =
  "Cache creation is billed at 125% of the standard input token price; reads at 10% of the standard input token price. Implicit reads cost 20% of the standard input token price.";
function prices(ids = ["qwen3.7-plus"]) {
  return `<main><section><h2>Text generation - Qwen</h2><section><h3>US (Virginia)</h3><table><tr><th>Model ID</th><th>Deployment scope</th><th>Input price (per 1 million tokens)</th><th>Output price (per 1 million tokens)</th></tr>${ids.flatMap((id) => ["Global", "US"].map((scope, i) => `<tr><td>${id}</td><td>${scope}</td><td>$${i === 0 ? "2" : "4"}</td><td>$6</td></tr>`)).join("")}</table></section></section></main>`;
}
function parse(index: string, documents: Readonly<Record<string, string>>) {
  const diagnostics: PricingReconciliationItem[] = [];
  const result = parseSource({
    provider,
    source,
    observedAt,
    body: JSON.stringify({
      index: { url: source.url, body: index },
      documents: Object.entries(documents).map(([name, body]) => ({ url: origin + name, body })),
    }),
    onPricingReconciliation: (item) => diagnostics.push(item),
  });
  return { result, diagnostics };
}
describe("DashScope cache scope", () => {
  const scopedGuide = (id: string) => `${cacheRules}
## Explicit cache
### Supported models
## US (Virginia)
Models: ${id}
### How to use`;
  it("preserves the inference operation alongside the cache mode", () => {
    const index = prices()
      .replace("<th>Input price", "<th>Mode</th><th>Input price")
      .replaceAll("<td>$2</td>", "<td>Thinking mode</td><td>$2</td>")
      .replaceAll("<td>$4</td>", "<td>Thinking mode</td><td>$4</td>");
    const { result } = parse(index, { "context-cache.md": scopedGuide("qwen3.7-plus") });
    expect(result.models[0]?.price_facts).toContainEqual(
      expect.objectContaining({
        meter: "cache_write_text",
        conditions: expect.objectContaining({ operation: "thinking_mode", cache_mode: "explicit" }),
      }),
    );
  });
  it("retains an explicitly unpublished cache-read fee as raw evidence", () => {
    const { result } = parse(prices(["qwen3.8-max"]), {
      "context-cache.md":
        scopedGuide("qwen3.8-max") +
        "\nThe explicit cache hit price for qwen3.8-max is not 10% of the standard input token price. For specific pricing, see the Model Studio console.",
    });
    const model = result.models.find((m) => m.model_id === "qwen3.8-max");
    expect(model?.raw_price_facts).toContainEqual(
      expect.objectContaining({
        impact: "base_price",
        reason: "unknown_amount",
        conditions: expect.objectContaining({ cache_mode: "explicit" }),
        raw: expect.objectContaining({
          meter: "cache_read_text",
          fragment: expect.stringContaining("not 10%"),
        }),
      }),
    );
    expect(model?.price_facts.some((f) => f.meter === "cache_write_text")).toBe(true);
    expect(model?.price_facts.some((f) => f.meter === "cache_read_text")).toBe(false);
  });
  it("uses a matching public cache tariff before the guide's generic multiplier", () => {
    const index = prices(["qwen3.8-max"])
      .replace("</tr>", "<th>Cache-hit input price (per million tokens)</th></tr>")
      .replaceAll("<td>$6</td></tr>", "<td>$6</td><td>$0.03</td></tr>");
    const { result } = parse(index, {
      "context-cache.md":
        scopedGuide("qwen3.8-max") +
        "\nThe explicit cache hit price for qwen3.8-max is not 10% of the standard input token price.",
    });
    const model = result.models.find((m) => m.model_id === "qwen3.8-max");
    expect(model?.raw_price_facts.filter((f) => f.term_key === "unpublished_cache_read")).toEqual(
      [],
    );
    expect(
      model?.price_facts
        .filter((f) => f.meter === "cache_read_text")
        .every((f) => f.price === "0.03" && !f.derived),
    ).toBe(true);
  });
  it("keeps contradictory quotes for canonical conflict resolution", () => {
    const index = prices().replace(
      "</table>",
      "<tr><td>qwen3.7-plus</td><td>Global</td><td>$3</td><td>$6</td></tr></table>",
    );
    const { result, diagnostics } = parse(index, {});
    expect(
      result.models[0]?.price_facts
        .filter((f) => f.meter === "input_text" && f.conditions.deployment_scope === "Global")
        .map((f) => f.price)
        .sort(),
    ).toEqual(["2", "3"]);
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ reason_code: "pricing_claim_conflict" }),
    );
    const partition = assembleParsedProviderPricing(
      "dashscope",
      observedAt,
      [{ source, ...result }],
      result.models,
    );
    const term = partition?.books[0]?.offers[0]?.terms.find(
      (t) => t.kind === "rate" && t.meter.namespace === "kmodels" && t.meter.value === "input_text",
    );
    if (term?.kind !== "rate") throw new Error("Missing input rate");
    expect(term.raw_variants).toContainEqual(
      expect.objectContaining({ reason: "conflicting_values" }),
    );
    expect(term.variants).toContainEqual(
      expect.objectContaining({
        price: expect.objectContaining({ value: { numerator: "1", denominator: "250000" } }),
      }),
    );
  });
  it("reads anchored regional tabs and keeps deployment eligibility separate", () => {
    const { result, diagnostics } = parse(prices(), {
      "context-cache.md": `${cacheRules}
## Explicit cache <span id="explicit" />
### Supported models <span id="models" />
<Tabs>
  <Tab title="US (Virginia)">
    - <strong>Global scope:</strong>
      Qwen Max: qwen3.8-max
    - <strong>US scope:</strong>
      Qwen Plus: qwen3.7-plus
  </Tab>
</Tabs>
### How to use <span id="use" />
## Implicit cache <span id="implicit" />
### Supported models <span id="models-implicit" />
<Tabs>
  <Tab title="US (Virginia)">
    - <strong>Global service deployment scope:</strong>
      Qwen Plus: qwen3.7-plus
  </Tab>
</Tabs>
### How to use`,
    });
    const rates = result.models.find((m) => m.model_id === "qwen3.7-plus")?.price_facts ?? [];
    expect(rates).toContainEqual(
      expect.objectContaining({
        meter: "cache_write_text",
        price: "5",
        conditions: expect.objectContaining({
          region: "US (Virginia)",
          deployment_scope: "US",
          cache_mode: "explicit",
        }),
      }),
    );
    expect(rates).toContainEqual(
      expect.objectContaining({
        meter: "cache_read_text",
        price: "0.4",
        conditions: expect.objectContaining({
          deployment_scope: "Global",
          cache_mode: "implicit",
        }),
      }),
    );
    expect(
      rates.some(
        (f) => f.meter === "cache_write_text" && f.conditions.deployment_scope === "Global",
      ),
    ).toBe(false);
    expect(
      rates.some(
        (f) =>
          f.meter === "cache_read_text" &&
          f.conditions.deployment_scope === "US" &&
          f.conditions.cache_mode === "implicit",
      ),
    ).toBe(false);
    expect(diagnostics.filter((d) => d.reason_code === "cache_model_scope_drift")).toEqual([]);
  });
  it("does not borrow the next cache mode's supported-model list", () => {
    const { result } = parse(prices(), {
      "context-cache.md": `${cacheRules}
## Explicit cache
No reviewed model list.
## Implicit cache
### Supported models
## US (Virginia)
Models: qwen3.7-plus
### How to use`,
    });
    const rates = result.models.find((m) => m.model_id === "qwen3.7-plus")?.price_facts ?? [];
    expect(rates.some((f) => f.meter === "cache_write_text")).toBe(false);
    expect(
      rates.some((f) => f.meter === "cache_read_text" && f.conditions.cache_mode === "implicit"),
    ).toBe(true);
  });
  it("withholds unreadable deployment scopes while keeping a readable sibling", () => {
    const { result, diagnostics } = parse(prices(), {
      "context-cache.md": `${cacheRules}
## Explicit cache
### Supported models
<Tabs>
  <Tab title="US (Virginia)">
    - <strong>Unreviewed scope:</strong>
      Models: qwen3.7-plus
    - <strong>Global scope:</strong>
      Models: qwen3.7-plus
  </Tab>
</Tabs>
### How to use`,
    });
    const rates = result.models.find((m) => m.model_id === "qwen3.7-plus")?.price_facts ?? [];
    expect(rates).toContainEqual(
      expect.objectContaining({
        meter: "cache_write_text",
        conditions: expect.objectContaining({ deployment_scope: "Global" }),
      }),
    );
    expect(
      rates.some((f) => f.meter === "cache_write_text" && f.conditions.deployment_scope === "US"),
    ).toBe(false);
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ reason_code: "cache_model_scope_drift" }),
    );
  });
});

const reportedAudio: SourcePricingInputFact = {
  key: "native.input_audio_tokens",
  source_ref: source.id,
  channel: "response",
  locator: { kind: "json_pointer", value: "/usage/audio_tokens" },
  availability: "terminal_only",
};
function target(realtime = false, dual = false): ParsedProviderModel {
  return {
    ...baseModel({
      providerId: "dashscope",
      id: "protocol-test",
      name: "Protocol Test",
      sourceId: source.id,
      observedAt,
    }),
    tasks: ["speech_to_speech"],
    delivery_modes: realtime ? ["realtime"] : undefined,
    api_endpoints: dual
      ? [
          {
            name: "Multimodal Generation",
            path: "/api/v1/services/aigc/multimodal-generation/generation",
          },
        ]
      : undefined,
    price_facts: [
      publishedRate("input_audio", "3", "million_tokens", source.id, "Audio tariff", {
        modality: "audio",
      }),
    ],
  };
}
describe("DashScope usage contracts", () => {
  it("reads owned HTML properties, terminal stream options and alternative cache locators", async () => {
    const documents = await Promise.all(
      [
        ["qwen-api-via-openai-chat-completions", "chat-properties.html"],
        ["qwen-api-via-dashscope", "native-properties.html"],
      ].map(async ([path, name]) => ({
        url: origin + path,
        body: await readFile(new URL(`./fixtures/dashscope/${name}`, import.meta.url), "utf8"),
      })),
    );
    const missing: string[] = [];
    const inputs = extractDashscopePricingInputs(documents, source.id, (finding) => {
      missing.push(...finding.diagnostics.map(({ path }) => path));
    });
    for (const protocol of ["chat", "native"]) {
      for (const stream of ["", "stream."]) {
        const key = `${protocol}.${stream}cache_creation_input_tokens`;
        expect(inputs).toContainEqual(
          expect.objectContaining({
            key,
            locator: {
              kind: "json_pointer",
              value: "/usage/prompt_tokens_details/cache_creation_input_tokens",
            },
          }),
        );
        expect(missing.some((path) => path.endsWith(`/${key}`))).toBe(false);
      }
    }
    expect(inputs).toContainEqual(
      expect.objectContaining({
        key: "native.input_image_tokens",
        locator: { kind: "json_pointer", value: "/usage/input_tokens_details/image_tokens" },
      }),
    );
    expect(inputs.some(({ locator }) => locator.value === "/usage/image_tokens")).toBe(false);
  });
  it.each([
    ["request tree", (body: string) => body.replace("Chat response object", "Request body")],
    ["wrong parent", (body: string) => body.replace("prompt_tokens_details", "request_options")],
    [
      "wrong leaf type",
      (body: string) =>
        body.replace("cached_tokens</strong><code>integer", "cached_tokens</strong><code>string"),
    ],
    [
      "duplicate leaf",
      (body: string) =>
        body.replace(
          "<p><strong>cached_tokens</strong><code>integer</code></p>",
          "<p><strong>cached_tokens</strong><code>integer</code></p>".repeat(2),
        ),
    ],
    [
      "unowned accordion",
      (body: string) =>
        body.replace(
          "<p><strong>prompt_tokens_details",
          "<h3>Unrelated properties</h3><p><strong>prompt_tokens_details",
        ),
    ],
  ])("does not borrow an HTML field from %s", async (_name, mutate) => {
    const body = await readFile(
      new URL("./fixtures/dashscope/chat-properties.html", import.meta.url),
      "utf8",
    );
    const inputs = extractDashscopePricingInputs(
      [{ url: origin + "qwen-api-via-openai-chat-completions", body: mutate(body) }],
      source.id,
    );
    expect(inputs.some(({ key }) => key === "chat.cached_input_tokens")).toBe(false);
  });
  it("reads MDX billing properties only inside the response_api discriminator", () => {
    const body = `## Response object <span id="response" />
<strong>usage</strong> \`object\`
<Accordion title="Properties">
<strong>x_details</strong> \`array\`
<Accordion title="Properties">
<strong>x_billing_type</strong> \`string\`
The value is fixed to response_api.
<strong>input_tokens_details</strong> \`object\`
<Accordion title="Properties">
<strong>image_tokens</strong> \`integer\`
</Accordion>
<strong>prompt_tokens_details</strong> \`object\`
<Accordion title="Properties">
<strong>cache_creation_input_tokens</strong> \`integer\`
</Accordion>
</Accordion>
</Accordion>`;
    const extract = (value: string) =>
      extractDashscopePricingInputs(
        [{ url: origin + "qwen-api-via-openai-responses.md", body: value }],
        source.id,
      ).some(({ key }) => key === "responses.detail.input_image_tokens");
    expect(extract(body)).toBe(true);
    expect(extract(body.replace("fixed to response_api", "fixed to tool_api"))).toBe(false);
    const inputs = extractDashscopePricingInputs(
      [{ url: origin + "qwen-api-via-openai-responses.md", body }],
      source.id,
    );
    expect(inputs).toContainEqual(
      expect.objectContaining({
        key: "responses.session_cache_creation_input_tokens",
        locator: {
          kind: "provider_field",
          value:
            "Response.usage.x_details[x_billing_type=response_api].prompt_tokens_details.cache_creation_input_tokens",
        },
      }),
    );
    expect(
      inputs.some(
        ({ locator }) =>
          locator.value === "/usage/prompt_tokens_details/cache_creation_input_tokens",
      ),
    ).toBe(false);
  });
  it("keeps response selectors separate from numeric counters and request size", () => {
    const inputs = extractDashscopePricingInputs(
      [
        {
          url: origin + "text-to-video-api-reference.md",
          body: '```json\n{"usage":{"size":"1280*720","duration":0.5}}\n```',
        },
        {
          url: origin + "qwen-image-api.md",
          body: '```json\n{"parameters":{"size":"1280*720"},"usage":{"width":1280,"height":720,"image_count":1}}\n```',
        },
      ],
      source.id,
    );
    expect(inputs).toContainEqual(
      expect.objectContaining({
        key: "video.effective_size",
        locator: { kind: "json_pointer", value: "/usage/size" },
      }),
    );
    expect(inputs).toContainEqual(
      expect.objectContaining({
        key: "video.billable_seconds",
        locator: { kind: "json_pointer", value: "/usage/duration" },
      }),
    );
    expect(inputs.some(({ key }) => key === "image.effective_size")).toBe(false);
    expect(inputs).toContainEqual(expect.objectContaining({ key: "image.width" }));
  });
  it.each([
    [
      "terminal SSE",
      'data:{"type":"response.completed","response":{"output":[...],"usage":{"x_tools":{"web_search_image":{"count":1}}}}}',
      true,
    ],
    [
      "nonterminal SSE",
      'data:{"type":"response.in_progress","response":{"output":[],"usage":{"x_tools":{"web_search_image":{"count":1}}}}}',
      false,
    ],
    [
      "malformed usage",
      'data:{"type":"response.completed","response":{"output":[],"usage":{"x_tools":{"web_search_image":{"count":1}},"unknown":[...]}}}',
      false,
    ],
    [
      "duplicate usage",
      'data:{"type":"response.completed","response":{"output":[],"usage":{"x_tools":{"web_search_image":{"count":1}},"x_tools":{}}}}',
      false,
    ],
  ])("checks %s before binding hosted-tool counters", (_name, example, expected) => {
    const inputs = extractDashscopePricingInputs(
      [
        {
          url: origin + "qwen-api-via-openai-responses.md",
          body: "```json Image search\n" + example + "\n```",
        },
      ],
      source.id,
    );
    expect(inputs.some(({ key }) => key === "responses.stream.web_search_image_count")).toBe(
      expected,
    );
  });
  it("keeps successful Batch and ASR usage under their actual response envelopes", () => {
    const inputs = extractDashscopePricingInputs(
      [
        {
          url: origin + "batch-interfaces-compatible-with-openai.md",
          body: '```json\n{"response":{"status_code":200,"body":{"usage":{"prompt_tokens":10,"completion_tokens":4,"total_tokens":14}}}}\n```',
        },
        {
          url: origin + "fun-asr-server-events.md",
          body: '```json\n{"header":{"event":"result-generated"},"payload":{"output":{"sentence":{"sentence_end":true}},"usage":{"duration":3}}}\n```',
        },
      ],
      source.id,
    );
    expect(inputs.filter(({ key }) => key.startsWith("batch."))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "batch.chat.input_tokens",
          locator: { kind: "json_pointer", value: "/response/body/usage/prompt_tokens" },
        }),
        expect.objectContaining({
          key: "batch.chat.output_tokens",
          locator: { kind: "json_pointer", value: "/response/body/usage/completion_tokens" },
        }),
      ]),
    );
    expect(inputs).toContainEqual(
      expect.objectContaining({
        key: "asr.stream.processed_audio_seconds",
        locator: { kind: "json_pointer", value: "/payload/usage/duration" },
      }),
    );
  });
  it.each([
    [
      "failed Batch item",
      "batch-interfaces-compatible-with-openai.md",
      '{"response":{"status_code":400,"body":{"usage":{"prompt_tokens":10}}}}',
      "batch.chat.input_tokens",
    ],
    [
      "interim ASR result",
      "fun-asr-server-events.md",
      '{"header":{"event":"result-generated"},"payload":{"output":{"sentence":{"sentence_end":false}},"usage":{"duration":3}}}',
      "asr.stream.processed_audio_seconds",
    ],
  ])("does not bind usage from a %s", (_name, path, example, key) => {
    const inputs = extractDashscopePricingInputs(
      [{ url: origin + path, body: "```json\n" + example + "\n```" }],
      source.id,
    );
    expect(inputs.some((input) => input.key === key)).toBe(false);
  });
  it("reads nested usage examples and the documented terminal include_usage option", () => {
    const body =
      '## Response\n```json\n{"usage":{"prompt_tokens":10,"prompt_tokens_details":{"cached_tokens":4,"text_tokens":10}}}\n```\n```python\nstream_options={"include_usage": True}\n```';
    const inputs = extractDashscopePricingInputs(
      [{ url: origin + "qwen-api-via-openai-chat-completions.md", body }],
      source.id,
    );
    expect(inputs).toContainEqual(
      expect.objectContaining({
        key: "chat.cached_input_tokens",
        locator: { kind: "json_pointer", value: "/usage/prompt_tokens_details/cached_tokens" },
      }),
    );
    expect(inputs).toContainEqual(
      expect.objectContaining({ key: "chat.stream.cached_input_tokens" }),
    );
  });
  it("does not take usage fields from an unrelated example object", () => {
    const body =
      '## Response\n```json\n{"request":{"prompt_tokens_details":{"cached_tokens":4}}}\n```';
    const inputs = extractDashscopePricingInputs(
      [{ url: origin + "qwen-api-via-openai-chat-completions.md", body }],
      source.id,
    );
    expect(inputs.some((f) => f.key === "chat.cached_input_tokens")).toBe(false);
  });
  it.each([
    { name: "Realtime only", realtime: true, dual: false, expected: false },
    { name: "ordinary speech-to-speech capability", realtime: false, dual: false, expected: true },
    { name: "documented dual route", realtime: true, dual: true, expected: true },
  ])("scopes ordinary usage fields for $name", ({ realtime, dual, expected }) => {
    const model = target(realtime, dual);
    const partition = assembleParsedProviderPricing(
      "dashscope",
      observedAt,
      [{ source, models: [model], pricing_inputs: [reportedAudio] }],
      [model],
    );
    const term = partition?.books[0]?.offers[0]?.terms.find((t) => t.kind === "rate");
    if (term?.kind !== "rate") throw new Error("Missing audio rate");
    expect(
      (
        term.variants[0]?.charge_binding?.quantity_methods?.flatMap((m) => m.input_sources ?? []) ??
        []
      ).length > 0,
    ).toBe(expected);
  });
  it("does not make optional fine-grained token fields absent-as-zero", async () => {
    const documents = await Promise.all(
      [
        ["qwen-api-via-openai-chat-completions.md", "chat.html"],
        ["qwen-api-via-dashscope.md", "usage.html"],
        ["qwen-api-via-openai-responses.md", "responses.html"],
      ].map(async ([path, name]) => ({
        url: origin + path,
        body: await readFile(new URL(`./fixtures/dashscope/${name}`, import.meta.url), "utf8"),
      })),
    );
    const inputs = extractDashscopePricingInputs(documents, source.id);
    const details = inputs.filter((f) =>
      [
        "chat.input_text_tokens",
        "native.input_text_tokens",
        "responses.detail.input_text_tokens",
      ].includes(f.key),
    );
    expect(details).toHaveLength(3);
    expect(details.every((f) => f.absent_value === undefined)).toBe(true);
  });
  it("does not turn a reported web-search intent count into successful billable retrievals", () => {
    const model = target();
    const fact: SourceCommercialPricingFact = {
      source_ref: source.id,
      book_key: "service:web-search",
      book_name: "Web search",
      resource_kind: "service",
      resource_key: "web-search",
      model_refs: [model.uid],
      offer_key: "built-in:singapore",
      offer_name: "Web search",
      billing_mode: "usage",
      pricing_state: "numeric",
      price_facts: [
        publishedRate(
          "web_search",
          "10",
          "thousand_events",
          source.id,
          "USD per 1,000 successful searches",
        ),
      ],
      raw_price_facts: [],
    };
    const inputs: SourcePricingInputFact[] = [
      {
        ...reportedAudio,
        key: "native.web_search_count",
        locator: { kind: "json_pointer", value: "/usage/plugins/search/count" },
      },
    ];
    const partition = assembleParsedProviderPricing(
      "dashscope",
      observedAt,
      [{ source, models: [model], pricing_inputs: inputs, commercial_facts: [fact] }],
      [model],
    );
    const term = partition?.books
      .find((b) => b.book_key === "service:web-search")
      ?.offers[0]?.terms.find((t) => t.kind === "rate");
    if (term?.kind !== "rate") throw new Error("Missing web-search rate");
    expect(term.variants[0]?.charge_binding).toMatchObject({
      signal: { namespace: "kmodels", value: "successful_web_searches" },
    });
    expect(term.variants[0]?.charge_binding?.quantity_methods).toBeUndefined();
  });
});

describe("DashScope native tool tariffs", () => {
  it("uses video columns to retain audio and mode price selection under a family heading", () => {
    const index = `<main><h2>Wan</h2><h3>Singapore</h3><table>
      <tr><th>Model ID</th><th>Output video type</th><th>Output video resolution</th><th>Output price</th></tr>
      <tr><td>wan2.6-i2v-flash</td><td>Audio video audio=true</td><td>720P</td><td>$0.05/second</td></tr>
      <tr><td>wan2.6-i2v-flash</td><td>Silent video audio=false</td><td>720P</td><td>$0.025/second</td></tr></table>
      <table><tr><th>Model ID</th><th>Output video mode</th><th>Output price</th></tr>
      <tr><td>wan2.2-animate-mix</td><td>Standard mode wan-std</td><td>$0.18/second</td></tr>
      <tr><td>wan2.2-animate-mix</td><td>Professional mode wan-pro</td><td>$0.26/second</td></tr></table></main>`;
    const { result, diagnostics } = parse(index, {});
    const video = result.models.find((m) => m.model_id === "wan2.6-i2v-flash");
    expect(video?.tasks).toContain("video_generation");
    expect(video?.price_facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          meter: "video_generation",
          price: "0.05",
          conditions: expect.objectContaining({ audio: true }),
        }),
        expect.objectContaining({
          meter: "video_generation",
          price: "0.025",
          conditions: expect.objectContaining({ audio: false }),
        }),
      ]),
    );
    expect(
      result.models
        .find((m) => m.model_id === "wan2.2-animate-mix")
        ?.price_facts.map((f) => f.conditions.operation)
        .sort(),
    ).toEqual(["professional_mode_wan_pro", "standard_mode_wan_std"]);
    expect(diagnostics.some((d) => d.reason_code === "pricing_claim_conflict")).toBe(false);
  });
  it("keeps input and output image tariffs separate without relying on a family heading", () => {
    const index =
      "<main><h2>Qwen-Image</h2><h3>Singapore</h3><table><tr><th>Model ID</th><th>Input unit price</th><th>Output unit price</th></tr><tr><td>qwen-image-3.0-pro</td><td>$0.003/image</td><td>$0.075/image</td></tr></table></main>";
    const { result, diagnostics } = parse(index, {});
    expect(result.models[0]?.price_facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ meter: "input_image", price: "0.003", unit: "image" }),
        expect.objectContaining({ meter: "image_generation", price: "0.075", unit: "image" }),
      ]),
    );
    expect(diagnostics.some((d) => d.reason_code === "pricing_claim_conflict")).toBe(false);
    const partition = assembleParsedProviderPricing(
      "dashscope",
      observedAt,
      [{ source, ...result }],
      result.models,
    );
    const input = partition?.books[0]?.offers[0]?.terms.find(
      (t) => t.kind === "rate" && t.meter.value === "input_image",
    );
    if (input?.kind !== "rate") throw new Error("Missing input image tariff");
    expect(input.variants[0]?.charge_binding).toBeUndefined();
  });
  const web = `## Supported models <span id="supported" />
<Tabs>
  <Tab title="Singapore">
    Models: qwen3.7-plus, deepseek-v4.1-flash-1017
  </Tab>
  <Tab title="China (Beijing)">
    Models: qwen3.7-plus, deepseek-v4.1-flash-1017
  </Tab>
  <Tab title="Global">
    The following models are supported in the US (Virginia), China (Hong Kong), Japan (Tokyo), and Germany (Frankfurt) regions.
    Models: qwen3.7-plus, deepseek-v4.1-flash-1017
  </Tab>
</Tabs>
## Quick start
## Billing
- **agent policy**:
  - The fee per 1,000 calls is as follows:
    - For the China (Beijing), US (Virginia), China (Hong Kong), Japan (Tokyo), and Germany (Frankfurt) regions: $0.573411.
    - For the Singapore region: $10.00.
- **agent_max policy (Limited-time offer)**:
  - Fee per 1,000 calls for the web search tool:
    - For the China (Beijing), US (Virginia), China (Hong Kong), Japan (Tokyo), and Germany (Frankfurt) regions: $0.573411.
    - For the Singapore region: $10.00.
The count field usage.plugins.search.count indicates intent detection and is not a basis for billing.`;
  it("retains grouped regional prices, explicit policies, and exact third-party compatibility", () => {
    const { result } = parse(prices(["qwen3.7-plus", "deepseek-v4.1-flash-1017"]), {
      "web-search.md": web,
    });
    const facts = result.commercial_facts?.filter((f) => f.resource_key === "web-search") ?? [];
    expect(facts.flatMap((f) => f.price_facts)).toContainEqual(
      expect.objectContaining({
        price: "0.573411",
        conditions: expect.objectContaining({ region: "China (Beijing)", operation: "agent" }),
      }),
    );
    expect(facts.flatMap((f) => f.model_refs ?? [])).toContain(
      "dashscope/deepseek-v4.1-flash-1017",
    );
    const regions = new Set(facts.flatMap((f) => f.price_facts.map((r) => r.conditions.region)));
    expect(regions).toEqual(
      new Set([
        "Singapore",
        "China (Beijing)",
        "US (Virginia)",
        "Hong Kong (China)",
        "Japan (Tokyo)",
        "Germany (Frankfurt)",
      ]),
    );
    expect(
      facts.flatMap((f) => f.price_facts).every((f) => f.conditions.deployment_scope === undefined),
    ).toBe(true);
  });
  it("reads an amount before its image-search region without inferring an account plan", () => {
    const { result } = parse(prices(), {
      "web-search-image.md":
        "# Text-to-image search\nSupported model: qwen3.7-plus.\n## Billing\nThe fee for every 1,000 calls is: $8 for deployments in the Singapore region, and $3.44 for deployments in North China 2 (Beijing).",
    });
    const rates =
      result.commercial_facts
        ?.filter((f) => f.resource_key === "text-to-image-search")
        .flatMap((f) => f.price_facts) ?? [];
    expect(rates).toContainEqual(
      expect.objectContaining({
        price: "3.44",
        conditions: expect.objectContaining({ region: "China (Beijing)" }),
      }),
    );
    expect(rates.every((f) => f.conditions.deployment_scope === undefined)).toBe(true);
  });
  it("preserves an unsupported billing item's quote instead of dropping its amount", () => {
    const index =
      "<main><section><h2>Video generation</h2><h3>Singapore</h3><table><tr><th>Model ID</th><th>Billing item</th><th>Output price</th></tr><tr><td>happyoyster-1.0-adventure</td><td>World creation</td><td>$0.5/second</td></tr></table></section></main>";
    const { result } = parse(index, {});
    expect(result.models[0]?.price_facts).toEqual([]);
    expect(result.models[0]?.raw_price_facts).toContainEqual(
      expect.objectContaining({
        impact: "base_price",
        raw: expect.objectContaining({
          amount: "0.5",
          fragment: expect.stringContaining("World creation"),
        }),
      }),
    );
  });
});
