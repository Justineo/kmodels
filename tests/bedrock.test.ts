import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";
import { parseSource } from "../src/catalog/adapters.ts";
import { extractBedrockPricingInputs } from "../src/catalog/bedrock-accounting.ts";
import { formatPricingInterpretationSample } from "../src/catalog/bedrock.ts";
import { assembleParsedProviderPricing } from "../src/catalog/pricing-adapter.ts";
import { publishedRate } from "../src/catalog/pricing.ts";
import { evaluateRateCost } from "../src/catalog/pricing-calculation.ts";
import { manifests, type ProviderManifest } from "../src/catalog/manifests.ts";
import type { PricingReconciliationItem } from "../src/catalog/pricing-reconciliation.ts";
import type { ParsedProviderModel as ProviderModel } from "../src/catalog/pricing-source.ts";
import type { Provider } from "../src/catalog/schema.ts";
import type { SourceContractEvidence } from "../src/catalog/source-contract.ts";
import type { SourceParseResult } from "../src/catalog/source-parse.ts";

const observedAt = "2026-07-21T00:00:00.000Z";

async function fixture(path: string): Promise<string> {
  return readFile(new URL(`./fixtures/${path}`, import.meta.url), "utf8");
}

function manifest(providerId: string): ProviderManifest {
  const value = manifests.find((item) => item.provider.id === providerId);
  if (value === undefined) throw new Error(`Missing manifest ${providerId}`);
  return value;
}

function provider(value: ProviderManifest): Provider {
  return { ...value.provider, source_ids: value.sources.map((source) => source.id) };
}

const linkedBundleFixtureSchema = z.object({
  index: z.object({ url: z.string(), body: z.string() }),
  documents: z.array(z.object({ url: z.string(), body: z.string() })),
});

function linkedBundle(body: string): z.infer<typeof linkedBundleFixtureSchema> {
  return linkedBundleFixtureSchema.parse(JSON.parse(body));
}

async function bedrockFixture(path: string, sourceId?: string): Promise<ProviderModel[]> {
  const value = manifest("amazon-bedrock");
  const source =
    sourceId === undefined ? value.sources[0] : value.sources.find(({ id }) => id === sourceId);
  if (source === undefined) throw new Error("Missing Bedrock source");
  return parseSource({ provider: provider(value), source, body: await fixture(path), observedAt })
    .models;
}

function bedrockModels(bundle: z.infer<typeof linkedBundleFixtureSchema>): ProviderModel[] {
  return bedrockResult(bundle).models;
}

function bedrockResult(bundle: z.infer<typeof linkedBundleFixtureSchema>): SourceParseResult {
  const value = manifest("amazon-bedrock");
  const source = value.sources[0];
  if (source === undefined) throw new Error("Missing Bedrock source");
  return parseSource({
    provider: provider(value),
    source,
    body: JSON.stringify(bundle),
    observedAt,
  });
}

async function contextBundle() {
  return {
    index: {
      url: "https://docs.aws.amazon.com/bedrock/latest/userguide/model-cards.md",
      body: "# Model cards",
    },
    documents: [
      {
        url: "https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-haiku-5-5.md",
        body: await fixture("bedrock/model-card-haiku-context.md"),
      },
      {
        url: "https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-openai-gpt-6-astra.md",
        body: await fixture("bedrock/model-card-gpt6-context.md"),
      },
      {
        url: "https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonBedrockFoundationModels/current/index.json",
        body: await fixture("bedrock/context-price-list.json"),
      },
    ],
  };
}

function priceDimension(unit: string, usage: string) {
  return {
    url: "https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonBedrockService/current/index.json",
    body: JSON.stringify({
      offerCode: "AmazonBedrockService",
      products: {
        EXTRA: {
          sku: "EXTRA",
          attributes: { model: "Command R", regionCode: "us-east-1", usagetype: usage },
        },
      },
      terms: {
        OnDemand: {
          EXTRA: {
            term: {
              priceDimensions: {
                rate: {
                  rateCode: "EXTRA.rate",
                  description: usage,
                  unit,
                  pricePerUnit: { USD: "0.002" },
                },
              },
            },
          },
        },
      },
    }),
  };
}

describe("Bedrock adapters", () => {
  it("binds each native token SKU to its owning model-card context range", async () => {
    const models = bedrockModels(await contextBundle());
    for (const [id, threshold] of [
      ["anthropic.claude-haiku-5-5", 100_000],
      ["openai.gpt-6-astra", 272_000],
    ] as const) {
      const model = models.find(({ model_id }) => model_id === id);
      expect(model).toBeDefined();
      const rates =
        model?.price_facts.filter(({ source_locator }) => source_locator?.kind === "sku") ?? [];
      expect(model?.raw_price_facts).toEqual([]);
      expect(rates).toHaveLength(4);
      expect(
        rates.filter(({ conditions }) => conditions.context_max_tokens === threshold),
      ).toHaveLength(2);
      expect(
        rates.filter(({ conditions }) => conditions.context_min_tokens === threshold + 1),
      ).toHaveLength(2);
      expect(
        rates.every(
          ({ price, raw_price, unit, raw_unit, source_locator }) =>
            price === raw_price &&
            unit === "million_tokens" &&
            raw_unit === "1M tokens" &&
            source_locator?.kind === "sku",
        ),
      ).toBe(true);
    }
  });

  it.each(["short", "long"])(
    "does not infer a missing native context-band definition (%s)",
    async (removed) => {
      const bundle = await contextBundle();
      const card = bundle.documents[0];
      if (card === undefined) throw new Error("Missing native card");
      card.body = card.body.replace(
        removed === "short"
          ? /Prompts of 100,000 tokens or fewer are billed at the standard per-token rates\./
          : /Prompts that exceed 100,000 tokens are billed at higher rates for input, output, and cache read and write operations\./,
        "",
      );
      const models = bedrockModels(bundle);
      const haiku = models.find(({ model_id }) => model_id === "anthropic.claude-haiku-5-5");
      expect(haiku?.price_facts).toHaveLength(2);
      expect(haiku?.raw_price_facts).toHaveLength(2);
      expect(haiku?.raw_price_facts.every(({ reason }) => reason === "unknown_applicability")).toBe(
        true,
      );
      expect(
        haiku?.price_facts.every(({ conditions }) =>
          removed === "short"
            ? conditions.context_min_tokens === 100_001
            : conditions.context_max_tokens === 100_000,
        ),
      ).toBe(true);
      expect(
        models
          .find(({ model_id }) => model_id === "openai.gpt-6-astra")
          ?.price_facts.filter(({ source_locator }) => source_locator?.kind === "sku"),
      ).toHaveLength(4);
    },
  );

  it.each(["fenced", "quoted", "unowned", "contradictory", "invalid", "duplicate"])(
    "does not acquire context scope from %s card claims",
    async (change) => {
      const bundle = await contextBundle();
      const card = bundle.documents[0];
      if (card === undefined) throw new Error("Missing native card");
      const note = card.body.split("\n").find((line) => line.includes("Prompts of 100,000"));
      if (note === undefined) throw new Error("Missing native context note");
      const content =
        change === "fenced"
          ? "```text\n" + note + "\n```"
          : change === "quoted"
            ? "> " + note
            : change === "unowned"
              ? ""
              : change === "contradictory"
                ? note + "\n" + note.replaceAll("100,000", "200,000")
                : change === "invalid"
                  ? note.replaceAll("100,000", "100,00")
                  : note + "\n\n## Pricing\n" + note;
      card.body = card.body.replace(note, content);
      if (change === "unowned") card.body += "\n\n## Examples\n" + note;
      const models = bedrockModels(bundle);
      const haiku = models.find(({ model_id }) => model_id === "anthropic.claude-haiku-5-5");
      expect(haiku?.price_facts).toHaveLength(
        ["fenced", "quoted", "unowned"].includes(change) ? 2 : 0,
      );
      expect(
        haiku?.price_facts.every(
          ({ conditions }) =>
            conditions.context_min_tokens === undefined &&
            conditions.context_max_tokens === undefined,
        ),
      ).toBe(true);
      expect(haiku?.raw_price_facts.every(({ reason }) => reason === "unknown_applicability")).toBe(
        true,
      );
      expect(haiku?.raw_price_facts).toHaveLength(
        ["fenced", "quoted", "unowned"].includes(change) ? 2 : 4,
      );
      expect(
        models
          .find(({ model_id }) => model_id === "openai.gpt-6-astra")
          ?.price_facts.filter(({ source_locator }) => source_locator?.kind === "sku"),
      ).toHaveLength(4);
    },
  );

  it("ignores example headings and fenced duplicate owners while retaining real native bounds", async () => {
    const bundle = await contextBundle();
    for (const card of bundle.documents.filter(({ url }) => url.endsWith(".md")))
      card.body = card.body
        .replace("## Pricing", "```text\n## Pricing\n```\n\n## Pricing")
        .replace(
          "## Programmatic Access",
          "### Examples — Commercial Regions, short context (512K input tokens or fewer)\n\n## Programmatic Access",
        )
        .replaceAll("\n", "\r\n");
    const models = bedrockModels(bundle);
    expect(models).toHaveLength(2);
    expect(
      models.every(
        ({ price_facts, raw_price_facts }) =>
          price_facts.filter(({ source_locator }) => source_locator?.kind === "sku").length === 4 &&
          raw_price_facts.length === 0,
      ),
    ).toBe(true);
  });

  it.each([
    {
      name: "prose cannot restore a renamed counter",
      document: "TokenUsage",
      change: (body: string) =>
        body.replaceAll("cacheReadInputTokens", "cachedInputTokens") +
        "<p>Earlier versions used cacheReadInputTokens.</p>",
      missing: "runtime.converse.cached_input_tokens",
      retained: "runtime.converse.output_tokens",
    },
    {
      name: "a counter must retain its integer type",
      document: "TokenUsage",
      change: (body: string) =>
        body.replace(/(cacheReadInputTokens<\/b>[\s\S]*?Type: )Integer/, "$1String"),
      missing: "runtime.converse.cached_input_tokens",
      retained: "runtime.converse.output_tokens",
    },
    {
      name: "a nested lookalike cannot supply a direct counter",
      document: "TokenUsage",
      change: (body: string) =>
        body.replace(
          /(<dt id="bedrock-Type-runtime_TokenUsage-cacheReadInputTokens"[\s\S]*?<\/dd>)/,
          "<dt>details</dt><dd><dl>$1</dl></dd>",
        ),
      missing: "runtime.converse.cached_input_tokens",
      retained: "runtime.converse.output_tokens",
    },
    {
      name: "duplicate declarations cannot choose the first type",
      document: "TokenUsage",
      change: (body: string) =>
        body.replace(
          /(cacheReadInputTokens<\/b>[\s\S]*?Type: Integer<\/p>)/,
          "$1<p>Type: String</p>",
        ),
      missing: "runtime.converse.cached_input_tokens",
      retained: "runtime.converse.output_tokens",
    },
    {
      name: "selectors require their component's declared type",
      document: "ServiceTier",
      change: (body: string) => body.replace("Type: String", "Type: Integer"),
      missing: "runtime.converse.selector.service_tier",
      retained: "runtime.converse.selector.speed",
    },
    {
      name: "duplicate direct counter definitions are ambiguous",
      document: "TokenUsage",
      change: (body: string) =>
        body.replace(
          /(<dt id="bedrock-Type-runtime_TokenUsage-cacheReadInputTokens"[\s\S]*?<\/dd>)/,
          "$1 $1",
        ),
      missing: "runtime.converse.cached_input_tokens",
      retained: "runtime.converse.output_tokens",
    },
    {
      name: "guardrail usage requires an owned integer counter",
      document: "GuardrailUsage",
      change: (body: string) =>
        body.replace(/(contentPolicyUnits<\/b>[\s\S]*?Type: )Integer/, "$1String"),
      missing: "guardrails.apply.contentPolicyUnits",
      retained: "guardrails.apply.topicPolicyUnits",
    },
  ])("withholds only affected mappings: $name", async ({ document, change, missing, retained }) => {
    const bundle = linkedBundle(await fixture("document/bedrock.json"));
    const doc = bundle.documents.find(({ url }) => url.endsWith(`API_runtime_${document}.html`));
    if (doc === undefined) throw new Error(`Missing ${document} fixture`);
    doc.body = change(doc.body);
    const inputs = extractBedrockPricingInputs(bundle.documents, "test");
    expect(inputs.some(({ key }) => key === missing)).toBe(false);
    expect(inputs.some(({ key }) => key === retained)).toBe(true);
    expect(bedrockModels(bundle).some(({ price_facts }) => price_facts.length > 0)).toBe(true);
  });

  it("does not use request fields as a Converse response contract", async () => {
    const bundle = linkedBundle(await fixture("document/bedrock.json"));
    const doc = bundle.documents.find(({ url }) => url.endsWith("API_runtime_Converse.html"));
    if (doc === undefined) throw new Error("Missing Converse fixture");
    doc.body = doc.body.replace("Converse-response-usage", "Converse-request-usage");
    const inputs = extractBedrockPricingInputs(bundle.documents, "test");
    expect(
      inputs.some(
        ({ key, channel }) => key === "runtime.converse.output_tokens" && channel === "response",
      ),
    ).toBe(false);
    expect(
      inputs.some(
        ({ key, channel }) =>
          key === "runtime.converse.output_tokens" && channel === "stream_event",
      ),
    ).toBe(true);
    expect(
      inputs.some(
        ({ key, channel }) => key === "runtime.converse.selector.speed" && channel === "response",
      ),
    ).toBe(true);
  });

  it.each([
    [
      "batch-inference-results.html",
      '"inputTokenCount": number',
      '"details": { "inputTokenCount": number }',
      "batch.manifest.input_tokens",
      "batch.manifest.output_tokens",
    ],
    [
      "batch-inference-results.html",
      '"inputTokenCount": number',
      '"inputTokenCount": number, "inputTokenCount": "invalid"',
      "batch.manifest.input_tokens",
      "batch.manifest.output_tokens",
    ],
    [
      "model-invocation-logging.html",
      '"input": { "inputTokenCount": 42 }',
      '"input": { "inputTokenCount": "42", "details": { "inputTokenCount": 42 } }',
      "runtime.invocation_log.input_tokens",
      "runtime.invocation_log.output_tokens",
    ],
    [
      "guardrails-use-invoke-guardrail-checks-using.html",
      '"promptAttack": { "textUnits": 0 }',
      '"promptAttack": { "textUnits": "0", "details": { "textUnits": 0 } }',
      "guardrails.checks.promptAttack.textUnits",
      "guardrails.checks.contentFilter.textUnits",
    ],
  ])("checks owned numeric paths in %s", async (document, before, after, missing, retained) => {
    const bundle = linkedBundle(await fixture("document/bedrock.json"));
    const doc = bundle.documents.find(({ url }) => url.endsWith(document));
    if (doc === undefined) throw new Error(`Missing ${document} fixture`);
    doc.body = doc.body.replace(before, after);
    const inputs = extractBedrockPricingInputs(bundle.documents, "test");
    expect(inputs.some(({ key }) => key === missing)).toBe(false);
    expect(inputs.some(({ key }) => key === retained)).toBe(true);
  });

  it("retains an unrecognized invocation unit as bounded raw evidence", async () => {
    const bundle = linkedBundle(await fixture("document/bedrock.json"));
    bundle.documents.push(priceDimension("Unreviewed units", "USE1-CommandR-input-tokens"));
    const models = bedrockModels(bundle);
    const command = models.find(({ model_id }) => model_id === "cohere.command-r-v1:0");
    expect(command?.raw_price_facts).toContainEqual(
      expect.objectContaining({
        impact: "base_price",
        reason: "unsupported_structure",
        raw: expect.objectContaining({ amount: "0.002", unit: "Unreviewed units" }),
      }),
    );
    expect(models.some(({ price_facts }) => price_facts.length > 0)).toBe(true);
    const source = manifest("amazon-bedrock").sources[0];
    if (source === undefined || command === undefined) throw new Error("Missing Bedrock fixture");
    const partition = assembleParsedProviderPricing(
      "amazon-bedrock",
      observedAt,
      [{ source, models }],
      models,
    );
    const terms =
      partition?.books
        .find(({ book_key }) => book_key === `model:${command.uid}`)
        ?.offers.find(({ offer_key }) => offer_key === "on-demand")?.terms ?? [];
    expect(terms).toContainEqual(
      expect.objectContaining({
        kind: "raw",
        variants: expect.arrayContaining([
          expect.objectContaining({ impact: "base_price", reason: "unsupported_structure" }),
        ]),
      }),
    );
  });

  it("reads an explicit thirty-minute TTL from a Price List dimension", async () => {
    const bundle = linkedBundle(await fixture("document/bedrock.json"));
    bundle.documents.push(priceDimension("1K tokens", "USE1-CommandR-cache-write-tokens-30m"));
    const command = bedrockModels(bundle).find(
      ({ model_id }) => model_id === "cohere.command-r-v1:0",
    );
    expect(command?.price_facts).toContainEqual(
      expect.objectContaining({
        meter: "cache_write_text",
        conditions: expect.objectContaining({ cache_ttl_seconds: 1800 }),
      }),
    );
  });

  it.each([
    ["API_runtime_Converse.html", "response", "stream_event"],
    ["API_runtime_ConverseStreamMetadataEvent.html", "stream_event", "response"],
  ])("withholds TTL mappings when %s is unavailable", async (document, missing, available) => {
    const bundle = linkedBundle(await fixture("document/bedrock.json"));
    bundle.documents = bundle.documents.filter(({ url }) => !url.endsWith(document));
    const inputs = bedrockResult(bundle).pricing_inputs ?? [];
    const ttl = inputs.filter(({ key }) => /cache_write_(?:5m|1h)_input_tokens$/.test(key));
    expect(ttl.some(({ channel }) => channel === missing)).toBe(false);
    expect(ttl.some(({ channel }) => channel === available)).toBe(true);
  });

  it("isolates a duplicated optional accounting document from catalog and sibling inputs", async () => {
    const bundle = linkedBundle(await fixture("document/bedrock.json"));
    const token = bundle.documents.find(({ url }) => url.endsWith("TokenUsage.html"));
    if (token === undefined) throw new Error("Missing TokenUsage fixture");
    bundle.documents.push({ ...token });
    const parsed = bedrockResult(bundle);
    const { models } = parsed;
    expect(models).toHaveLength(4);
    const inputs = parsed.pricing_inputs ?? [];
    expect(inputs.some(({ key }) => key === "runtime.converse.output_tokens")).toBe(false);
    expect(inputs.some(({ key }) => key === "guardrails.apply.contentPolicyUnits")).toBe(true);
    expect(models.some(({ price_facts }) => price_facts.length > 0)).toBe(true);
  });

  it("keeps an unsupported cache TTL distinct from the aggregate write counter", async () => {
    const models = await bedrockFixture("document/bedrock.json");
    const model = models.find(
      ({ model_id }) => model_id === "anthropic.claude-haiku-4-5-20251001-v1:0",
    );
    const source = manifest("amazon-bedrock").sources[0];
    if (model === undefined || source === undefined)
      throw new Error("Missing Bedrock fixture model");
    for (const ttl of [300, 1800])
      model.price_facts.push(
        publishedRate("cache_write_text", "2", "million_tokens", source.id, "M tokens", {
          endpoint: "bedrock-runtime",
          cache_ttl_seconds: ttl,
        }),
      );
    const partition = assembleParsedProviderPricing(
      "amazon-bedrock",
      observedAt,
      [{ source, models }],
      models,
    );
    const term = partition?.books
      .find(({ book_key }) => book_key === `model:${model.uid}`)
      ?.offers.find(({ offer_key }) => offer_key === "on-demand")
      ?.terms.find(({ term_key }) => term_key === "cache_write_text");
    if (term?.kind !== "rate") throw new Error("Missing cache write term");
    const unsupported = term.variants.find(({ applicability }) =>
      applicability.any_of.some(({ all_of }) =>
        all_of.some(
          (condition) =>
            condition.kind === "decimal_range" &&
            condition.dimension.value === "cache_ttl_seconds" &&
            condition.lower?.value === "1800",
        ),
      ),
    );
    expect(unsupported?.charge_binding).toMatchObject({
      signal: {
        namespace: "provider",
        provider_id: "amazon-bedrock",
        value: "cache_write_1800s_input_tokens",
      },
    });
    expect(unsupported?.charge_binding?.quantity_methods).toBeUndefined();
    if (unsupported === undefined) throw new Error("Missing thirty-minute cache-write rate");
    expect(
      evaluateRateCost(unsupported, [
        {
          signal: {
            namespace: "provider",
            provider_id: "amazon-bedrock",
            value: "cache_write_1800s_input_tokens",
          },
          value: { numerator: "1000000", denominator: "1" },
        },
      ]),
    ).toMatchObject({ kind: "resolved", amount: { numerator: "2", denominator: "1" } });
  });

  it.each([false, true])(
    "retains conflicting public-page observations (reverse=%s)",
    async (reverse) => {
      const bundle = linkedBundle(await fixture("document/bedrock-sonnet-pricing.json"));
      const amounts = reverse ? ["101", "99"] : ["99", "101"];
      bundle.documents.push({
        url: "https://aws.amazon.com/bedrock/pricing/",
        body: `<li role="tabpanel"><h2 id="OpenAI">OpenAI</h2><div class="lb-rtxt">Region: US East (N. Virginia)</div><div><table><tr><td>OpenAI models</td><td>Price per 1M input tokens</td><td>Price per 1M output tokens</td></tr>${amounts.map((amount) => `<tr><td>Claude Sonnet 4</td><td>$${amount}</td><td>N/A</td></tr>`).join("")}</table></div></li><li role="tabpanel"><h2 id="Stability_AI">Stability AI</h2><table><tr><td>Stability AI Image Services</td><td>Price per generation for each model</td></tr></table></li>`,
      });
      const models = bedrockModels(bundle);
      const source = manifest("amazon-bedrock").sources[0];
      if (source === undefined) throw new Error("Missing Bedrock source");
      const model = models.find(
        ({ model_id }) => model_id === "anthropic.claude-sonnet-4-20250514-v1:0",
      );
      expect(
        model?.price_facts.filter(
          ({ meter, price }) => meter === "input_text" && amounts.includes(price),
        ),
      ).toHaveLength(2);
      const partition = assembleParsedProviderPricing(
        "amazon-bedrock",
        observedAt,
        [{ source, models }],
        models,
      );
      const term = partition?.books
        .find(({ book_key }) => book_key === `model:${model?.uid}`)
        ?.offers.find(({ offer_key }) => offer_key === "on-demand")
        ?.terms.find(({ term_key }) => term_key === "input_text");
      if (term?.kind !== "rate") throw new Error("Missing input price term");
      expect(term.raw_variants.some(({ reason }) => reason === "conflicting_values")).toBe(true);
    },
  );

  it("uses only first-party Bedrock catalog and invocation-pricing inputs", async () => {
    const value = manifest("amazon-bedrock");
    const source = value.sources[0];
    if (source === undefined) throw new Error("Missing Bedrock source");
    expect(source.extractorVersion).toBe("bedrock-catalog-v34");
    expect(
      source.linkedDocuments?.documents?.map(({ id, optional, claimLocal }) => [
        id,
        optional,
        claimLocal,
      ]),
    ).toEqual([
      ["bedrock-mantle", true, undefined],
      ["bedrock-endpoint-regions", true, undefined],
      ["bedrock-endpoints", true, undefined],
      ["bedrock-rerank-supported", true, undefined],
      ["bedrock-public-pricing", true, undefined],
      ["bedrock-cohere-embed-v4-marketplace", true, undefined],
      ["pricing-bedrock", true, undefined],
      ["pricing-foundation-models", true, undefined],
      ["pricing-service", true, undefined],
      ["bedrock-converse", true, true],
      ["bedrock-converse-stream-metadata", true, true],
      ["bedrock-token-usage", true, true],
      ["bedrock-cache-detail", true, true],
      ["bedrock-prompt-caching", true, true],
      ["bedrock-batch-results", true, true],
      ["bedrock-invocation-logging", true, true],
      ["bedrock-apply-guardrail", true, true],
      ["bedrock-service-tier", true, true],
      ["bedrock-performance-configuration", true, true],
      ["bedrock-guardrail-usage", true, true],
      ["bedrock-invoke-guardrail-checks", true, true],
    ]);

    const bundle = linkedBundle(await fixture("document/bedrock.json"));
    const parsed = parseSource({
      provider: provider(value),
      source,
      body: JSON.stringify(bundle),
      observedAt,
    });
    expect(parsed.models).toHaveLength(4);
    const pricingInputs = parsed.pricing_inputs ?? [];
    expect(pricingInputs).toHaveLength(32);
    expect(pricingInputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "runtime.converse.uncached_input_tokens",
          channel: "response",
          locator: { kind: "json_pointer", value: "/usage/inputTokens" },
        }),
        expect.objectContaining({
          key: "runtime.converse.cache_write_1h_input_tokens",
          channel: "stream_event",
          absent_value: "zero",
        }),
        expect.objectContaining({
          key: "batch.manifest.input_tokens",
          channel: "result",
          locator: {
            kind: "provider_field",
            value: "manifest.json.out.inputTokenCount",
          },
        }),
        expect.objectContaining({
          key: "runtime.invocation_log.output_tokens",
          channel: "invocation_log",
          availability: "reconciliation_only",
        }),
        expect.objectContaining({
          key: "guardrails.apply.contentPolicyUnits",
          locator: { kind: "json_pointer", value: "/usage/contentPolicyUnits" },
        }),
        expect.objectContaining({
          key: "guardrails.checks.promptAttack.textUnits",
          locator: {
            kind: "json_pointer",
            value: "/usage/promptAttack/textUnits",
          },
        }),
      ]),
    );

    const drifted = linkedBundle(await fixture("document/bedrock.json"));
    const tokenUsage = drifted.documents.find(({ url }) => url.endsWith("TokenUsage.html"));
    if (tokenUsage === undefined) throw new Error("Missing Bedrock TokenUsage fixture");
    tokenUsage.body = tokenUsage.body.replaceAll("cacheReadInputTokens", "cachedInputTokens");
    const driftFindings: PricingReconciliationItem[] = [];
    const driftedResult = parseSource({
      provider: provider(value),
      source,
      body: JSON.stringify(drifted),
      observedAt,
      onPricingReconciliation: (item) => driftFindings.push(item),
    });
    const driftedModels = driftedResult.models;
    const driftedInputs = driftedResult.pricing_inputs ?? [];
    expect(driftedInputs).toHaveLength(30);
    expect(driftedInputs.some(({ key }) => key === "runtime.converse.cached_input_tokens")).toBe(
      false,
    );
    expect(driftedInputs.some(({ key }) => key === "runtime.converse.output_tokens")).toBe(true);
    expect(driftedModels.find(({ price_facts }) => price_facts.length > 0)).toMatchObject({
      pricing_state: "numeric",
      raw_price_facts: [],
    });
    expect(driftFindings).toContainEqual({
      disposition: "unbound",
      reason_code: "pricing_input_contract_partial",
      sample: "30/32 Bedrock pricing inputs",
    });

    const mantle = bundle.documents.find(({ url }) => url.endsWith("inference-responses-api.md"));
    if (mantle === undefined) throw new Error("Missing Bedrock Mantle fixture");
    bundle.documents.push({ ...mantle });
    const findings: PricingReconciliationItem[] = [];
    expect(
      parseSource({
        provider: provider(value),
        source,
        body: JSON.stringify(bundle),
        observedAt,
        onPricingReconciliation: (item) => findings.push(item),
      }).models,
    ).toHaveLength(4);
    expect(findings).toContainEqual(
      expect.objectContaining({
        disposition: "unsupported",
        reason_code: "optional_catalog_source_drifted",
      }),
    );
  });

  it("reads relocated Mantle regions without requiring the optional Price List", async () => {
    const bundle = linkedBundle(await fixture("document/bedrock.json"));
    const responses = bundle.documents.find(({ url }) =>
      url.endsWith("inference-responses-api.md"),
    );
    if (responses === undefined) throw new Error("Missing Bedrock Responses fixture");
    responses.body =
      "## Supported Regions and Endpoints\nSee [Regional availability by endpoints](endpoints-region-availability.md) and [Inference endpoints supported by Amazon Bedrock](endpoints.md).";
    const regions = {
      url: "https://docs.aws.amazon.com/bedrock/latest/userguide/endpoints-region-availability.md",
      body: await fixture("bedrock/endpoint-regions.md"),
    };
    const endpoints = {
      url: "https://docs.aws.amazon.com/bedrock/latest/userguide/endpoints.md",
      body: await fixture("bedrock/endpoints.md"),
    };
    bundle.documents = bundle.documents.filter(
      ({ url }) => !url.includes("AmazonBedrockFoundationModels"),
    );
    bundle.documents.push(regions, endpoints);
    const value = manifest("amazon-bedrock");
    const source = value.sources[0];
    if (source === undefined) throw new Error("Missing Bedrock source");
    const replay = () => {
      const findings: PricingReconciliationItem[] = [];
      const models = parseSource({
        provider: provider(value),
        source,
        body: JSON.stringify(bundle),
        observedAt,
        onPricingReconciliation: (item) => findings.push(item),
      }).models;
      const model = models.find(({ model_id }) => model_id === "anthropic.claude-haiku-4-5");
      if (model === undefined) throw new Error("Missing Mantle model");
      return { model, findings };
    };
    expect(replay().model.availability).toEqual([
      { region: "us-east-1", deployment_type: "bedrock-mantle/in-region" },
    ]);
    expect(
      replay().findings.some(
        ({ reason_code }) => reason_code === "optional_catalog_source_drifted",
      ),
    ).toBe(false);
    const card = bundle.documents.find(({ url }) => url.includes("model-card-anthropic-cl"));
    if (card === undefined) throw new Error("Missing Claude card");
    card.body = card.body.replaceAll("us-east-1", "eu-central-1");
    expect(replay().model.availability).toEqual([
      { region: "eu-central-1", deployment_type: "bedrock-mantle/in-region" },
    ]);
    card.body = card.body.replaceAll("eu-central-1", "us-west-1");
    expect(replay().model.availability).toEqual([]);
    card.body = card.body.replaceAll("us-west-1", "us-east-1");
    const validRegions = regions.body;
    regions.body = regions.body.replaceAll("icon-yes.png", "unknown.png");
    expect(replay().model.availability).toEqual([]);
    regions.body = validRegions + validRegions;
    expect(replay().model.availability).toEqual([]);
    regions.body = validRegions;
    bundle.documents = bundle.documents.filter(({ url }) => url !== endpoints.url);
    expect(replay().model.availability).toEqual([]);
    bundle.documents.push(endpoints);
    endpoints.body = endpoints.body.replace(
      "bedrock-mantle.{region}.api.aws",
      "bedrock-runtime.{region}.amazonaws.com",
    );
    expect(replay().model.availability).toEqual([]);
    expect(replay().findings).toContainEqual(
      expect.objectContaining({ reason_code: "optional_catalog_source_drifted" }),
    );
  });

  it("parses separate Bedrock endpoint and API support tables", async () => {
    const value = manifest("amazon-bedrock");
    const source = value.sources[0];
    if (source === undefined) throw new Error("Missing Bedrock source");
    const separated = linkedBundle(await fixture("document/bedrock.json"));
    const separatedCard = separated.documents.find((document) =>
      document.url.endsWith("model-card-anthropic-claude-haiku-4-5.md"),
    );
    if (separatedCard === undefined) throw new Error("Missing Bedrock model card fixture");
    separatedCard.body = await fixture("bedrock/model-card-separated-tables.md");
    const separatedModels = parseSource({
      provider: provider(value),
      source,
      body: JSON.stringify(separated),
      observedAt,
    }).models;
    expect(
      separatedModels.find(
        ({ model_id }) => model_id === "anthropic.claude-haiku-4-5-20251001-v1:0",
      ),
    ).toMatchObject({
      pricing_state: "numeric",
      api_endpoints: [
        { name: "Converse", path: "model/{modelId}/converse" },
        { name: "Invoke", path: "model/{modelId}/invoke" },
      ],
    });
  });

  it("uses a model card's exact scoped token table when the price lists have no model rate", async () => {
    const value = manifest("amazon-bedrock");
    const source = value.sources[0];
    if (source === undefined) throw new Error("Missing Bedrock source");
    const bundle = linkedBundle(await fixture("document/bedrock.json"));
    const body = (await fixture("bedrock/model-card-kimi-k3.md")).replace(
      "- **Model launch date:**",
      "+ **Model launch date:**",
    );
    bundle.documents.push({
      url: "https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-moonshot-ai-kimi-k3.md",
      body,
    });
    const models = parseSource({
      provider: provider(value),
      source,
      body: JSON.stringify(bundle),
      observedAt,
    }).models;
    const kimi = models.find(({ model_id }) => model_id === "moonshotai.kimi-k3");
    expect(kimi).toMatchObject({
      pricing_state: "numeric",
      release_date: "2026-09-18",
      api_endpoints: expect.arrayContaining([{ name: "Responses", path: "v1/responses" }]),
    });
    expect(kimi?.price_facts).toHaveLength(40);
    expect(
      kimi?.price_facts
        .filter(({ conditions }) => conditions.service_tier !== "standard")
        .every(({ conditions }) =>
          ["responses", "chat_completions"].includes(conditions.operation ?? ""),
        ),
    ).toBe(true);
    expect(kimi?.price_facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          meter: "input_text",
          price: "5.25",
          conditions: expect.objectContaining({
            service_tier: "priority",
            operation: "responses",
            deployment_scope: "global_cross_region",
          }),
        }),
        expect.objectContaining({
          meter: "cache_write_text",
          price: "2.0625",
          conditions: expect.objectContaining({
            service_tier: "flex",
            operation: "chat_completions",
            inference_geo: "us",
            cache_ttl_seconds: 1_800,
          }),
        }),
      ]),
    );
    expect(
      kimi?.price_facts
        .filter(
          ({ meter, conditions }) =>
            meter === "cache_write_text" && conditions.service_tier === "standard",
        )
        .map(({ price, conditions }) => [price, conditions]),
    ).toEqual([
      [
        "3.75",
        {
          endpoint: "bedrock-runtime",
          deployment_scope: "global_cross_region",
          service_tier: "standard",
          cache_ttl_seconds: 1_800,
        },
      ],
      [
        "4.125",
        {
          endpoint: "bedrock-runtime",
          deployment_scope: "geo_cross_region",
          service_tier: "standard",
          inference_geo: "us",
          cache_ttl_seconds: 1_800,
        },
      ],
    ]);
    const drifted = linkedBundle(JSON.stringify(bundle));
    const card = drifted.documents.find(({ url }) =>
      url.includes("model-card-moonshot-ai-kimi-k3"),
    );
    if (card === undefined) throw new Error("Missing Kimi K3 card");
    card.body = card.body.replace("$4.125", "Contact sales");
    const findings: PricingReconciliationItem[] = [];
    const driftedModels = parseSource({
      provider: provider(value),
      source,
      body: JSON.stringify(drifted),
      observedAt,
      onPricingReconciliation: (item) => findings.push(item),
    }).models;
    expect(
      driftedModels.find(({ model_id }) => model_id === "moonshotai.kimi-k3")?.price_facts,
    ).toHaveLength(35);
    expect(findings).toContainEqual({
      disposition: "unsupported",
      reason_code: "model_card_price_row_unreadable",
      sample: "US CRIS: Cache write (30 min): Contact sales",
    });
    card.body = body.replace("only the Responses and Chat Completions APIs", "only selected APIs");
    const unknownScope = parseSource({
      provider: provider(value),
      source,
      body: JSON.stringify(drifted),
      observedAt,
    }).models;
    expect(
      unknownScope.find(({ model_id }) => model_id === "moonshotai.kimi-k3")?.price_facts,
    ).toHaveLength(8);
  });

  it("uses Grok's Runtime card for Geo and Global tiers without borrowing Mantle prices", async () => {
    const value = manifest("amazon-bedrock");
    const source = value.sources[0];
    if (source === undefined) throw new Error("Missing Bedrock source");
    const bundle = linkedBundle(await fixture("document/bedrock.json"));
    bundle.documents.push({
      url: "https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-xai-grok-4-7.md",
      body: await fixture("bedrock/model-card-grok-4-7.md"),
    });
    const models = parseSource({
      provider: provider(value),
      source,
      body: JSON.stringify(bundle),
      observedAt,
    }).models;
    const grok = models.find(({ model_id }) => model_id === "xai.grok-4.7");
    expect(grok?.price_facts).toHaveLength(18);
    expect(
      grok?.price_facts.every(({ conditions }) => conditions.endpoint === "bedrock-runtime"),
    ).toBe(true);
    expect(
      grok?.price_facts
        .filter(({ meter }) => meter === "input_text")
        .map(({ price, conditions }) => [
          price,
          conditions.service_tier,
          conditions.deployment_scope,
          conditions.inference_geo,
        ]),
    ).toEqual(
      expect.arrayContaining([
        ["2.20", "standard", "geo_cross_region", "us"],
        ["2.00", "standard", "global_cross_region", undefined],
        ["3.85", "priority", "geo_cross_region", "us"],
        ["3.5", "priority", "global_cross_region", undefined],
        ["1.1", "flex", "geo_cross_region", "us"],
        ["1", "flex", "global_cross_region", undefined],
      ]),
    );
  });

  it("uses the Bedrock OpenAI card's short and long context prices without inventing cache writes", async () => {
    const value = manifest("amazon-bedrock");
    const source = value.sources[0];
    if (source === undefined) throw new Error("Missing Bedrock source");
    const bundle = linkedBundle(await fixture("document/bedrock.json"));
    bundle.documents.push({
      url: "https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-openai-gpt-55.md",
      body: await fixture("bedrock/model-card-openai-tiered.md"),
    });
    const models = parseSource({
      provider: provider(value),
      source,
      body: JSON.stringify(bundle),
      observedAt,
    }).models;
    const model = models.find(({ model_id }) => model_id === "openai.gpt-5.5");
    expect(model?.api_endpoints).toContainEqual({ name: "Responses", path: "openai/v1/responses" });
    expect(model?.price_facts).toHaveLength(6);
    expect(
      model?.price_facts
        .filter(({ meter }) => meter === "input_text")
        .map(({ price, conditions }) => [
          price,
          conditions.context_max_tokens,
          conditions.context_min_tokens,
        ]),
    ).toEqual([
      ["5.50", 272_000, undefined],
      ["11.00", undefined, 272_001],
    ]);
    expect(model?.price_facts.some(({ meter }) => meter === "cache_write_text")).toBe(false);
    expect(
      model?.price_facts.every(({ conditions }) => conditions.endpoint === "bedrock-mantle"),
    ).toBe(true);
  });

  it("keeps OpenAI card Geo and Global cross-Region rates on Bedrock Runtime", async () => {
    const value = manifest("amazon-bedrock");
    const source = value.sources[0];
    if (source === undefined) throw new Error("Missing Bedrock source");
    const bundle = linkedBundle(await fixture("document/bedrock.json"));
    bundle.documents.push({
      url: "https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-openai-gpt-6-astra.md",
      body: await fixture("bedrock/model-card-openai-cross.md"),
    });
    const models = parseSource({
      provider: provider(value),
      source,
      body: JSON.stringify(bundle),
      observedAt,
    }).models;
    const rates = models.find(({ model_id }) => model_id === "openai.gpt-6-astra")?.price_facts;
    expect(models.find(({ model_id }) => model_id === "openai.gpt-6-astra")?.api_endpoints).toEqual(
      expect.arrayContaining([
        { name: "Responses", path: "openai/v1/responses" },
        { name: "Chat Completions", path: "openai/v1/chat/completions" },
      ]),
    );
    expect(rates).toHaveLength(12);
    expect(
      rates
        ?.filter(({ meter }) => meter === "input_text")
        .map(({ price, conditions }) => [price, conditions.endpoint, conditions.deployment_scope]),
    ).toEqual([
      ["11.00", "bedrock-mantle", "in_region"],
      ["11.00", "bedrock-runtime", "geo_cross_region"],
      ["10.00", "bedrock-runtime", "global_cross_region"],
    ]);
  });

  it("keeps Bedrock Runtime and Mantle availability separate on modern model cards", async () => {
    const value = manifest("amazon-bedrock");
    const source = value.sources[0];
    if (source === undefined) throw new Error("Missing Bedrock source");
    const bundle = linkedBundle(await fixture("document/bedrock.json"));
    bundle.documents.push({
      url: "https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-opus-5-5.md",
      body: `# Claude Opus 5.5
## ![](claude.png) Anthropic — Claude Opus 5.5
## Model Details
+ **Model launch date:** September 22, 2026
+ **Model lifecycle:** Active
| Input Modalities | Output Modalities |
| --- | --- |
| ![Yes](icon-yes.png) Text | ![Yes](icon-yes.png) Text |
## Endpoints and APIs supported
| Endpoint | Supported |
| --- | --- |
| bedrock-runtime | ![Yes](icon-yes.png) |
| bedrock-mantle | ![Yes](icon-yes.png) |
**APIs supported on \`bedrock-runtime\` endpoint**
| Messages | Responses |
| --- | --- |
| ![Yes](icon-yes.png) | ![No](icon-no.png) |
**APIs supported on \`bedrock-mantle\` endpoint**
| Messages | Responses |
| --- | --- |
| ![Yes](icon-yes.png) | ![No](icon-no.png) |
## Programmatic Access
| Endpoint | Model ID | Geo inference ID | Global inference ID |
| --- | --- | --- | --- |
| bedrock-runtime | anthropic.claude-opus-5-5 | us.anthropic.claude-opus-5-5 | global.anthropic.claude-opus-5-5 |
| bedrock-mantle | anthropic.claude-opus-5-5 | N/A | N/A |
| bedrock-runtime | N/A | N/A | N/A |
## Regional Availability
**Availability using the \`bedrock-runtime\` endpoint**
| Region | In-Region | Geo | Global |
| --- | --- | --- | --- |
| us-east-1 (N. Virginia) | ![No](icon-no.png) | ![Yes](icon-yes.png) | ![Yes](icon-yes.png) |
| eu-west-1 (Ireland) | Legacy (EOL: 2026-09-30) | ![No](icon-no.png) | ![No](icon-no.png) |
**Availability using the \`bedrock-mantle\` endpoint**
| Region | In-Region | Geo | Global |
| --- | --- | --- | --- |
| us-east-1 (N. Virginia) | ![Yes](icon-yes.png) | ![No](icon-no.png) | ![No](icon-no.png) |`,
    });
    const models = parseSource({
      provider: provider(value),
      source,
      body: JSON.stringify(bundle),
      observedAt,
    }).models;
    expect(models.find(({ model_id }) => model_id === "anthropic.claude-opus-5-5")).toMatchObject({
      release_date: "2026-09-22",
      availability: [
        { region: "us-east-1", deployment_type: "bedrock-mantle/in-region" },
        { region: "us-east-1", deployment_type: "bedrock-runtime/geo" },
        { region: "us-east-1", deployment_type: "bedrock-runtime/global" },
        { region: "eu-west-1", deployment_type: "bedrock-runtime/in-region" },
      ],
    });
    expect(models.some(({ model_id }) => model_id === "N/A")).toBe(false);
  });

  it("adds officially supported Bedrock rerank models absent from model cards", async () => {
    const value = manifest("amazon-bedrock");
    const source = value.sources[0];
    if (source === undefined) throw new Error("Missing Bedrock source");
    const bundle = linkedBundle(await fixture("document/bedrock.json"));
    bundle.documents = bundle.documents.filter(
      ({ url }) => !url.includes("/AmazonBedrock/current/"),
    );
    bundle.documents.push(
      {
        url: "https://docs.aws.amazon.com/bedrock/latest/userguide/rerank-supported.md",
        body: `| Provider | Model | Model ID | Single-region model support |
| --- | --- | --- | --- |
| Amazon | Rerank 1.0 | \`amazon.rerank-v1:0\` | \`eu-central-1\` \`us-west-2\` |`,
      },
      {
        url: "https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonBedrock/current/index.json",
        body: JSON.stringify({
          offerCode: "AmazonBedrock",
          products: {
            RERANK: {
              sku: "RERANK",
              attributes: {
                feature: "Reranker",
                regionCode: "eu-central-1",
                usagetype: "EUC1-AmazonRerank-v1-searchunits",
              },
            },
          },
          terms: {
            OnDemand: {
              RERANK: {
                term: {
                  effectiveDate: "2026-08-01T00:00:00Z",
                  priceDimensions: {
                    rate: {
                      description: "$1 per 1000 search units",
                      unit: "Search Units",
                      pricePerUnit: { USD: "0.0010000000" },
                    },
                  },
                },
              },
            },
          },
        }),
      },
    );

    const model = parseSource({
      provider: provider(value),
      source,
      body: JSON.stringify(bundle),
      observedAt,
    }).models.find(({ model_id }) => model_id === "amazon.rerank-v1:0");
    expect(model).toMatchObject({
      name: "Rerank 1.0",
      tasks: ["reranking"],
      api_endpoints: [{ name: "Rerank", path: "rerank" }],
      pricing_state: "numeric",
      price_facts: [
        expect.objectContaining({
          meter: "rerank_request",
          price: "0.0010000000",
          unit: "search_unit",
          conditions: expect.objectContaining({ endpoint: "bedrock-agent-runtime" }),
        }),
      ],
    });
    expect(model?.availability).toEqual([
      {
        region: "eu-central-1",
        deployment_type: "bedrock-agent-runtime/in-region",
      },
      { region: "us-west-2", deployment_type: "bedrock-agent-runtime/in-region" },
    ]);
  });

  it("parses escaped Bedrock Markdown pipes and isolates an irregular model card", async () => {
    const value = manifest("amazon-bedrock");
    const source = value.sources[0];
    if (source === undefined) throw new Error("Missing Bedrock source");
    const escaped = linkedBundle(await fixture("document/bedrock.json"));
    const escapedCard = escaped.documents.find(({ url }) => url.includes("model-card-"));
    if (escapedCard === undefined) throw new Error("Missing Bedrock card fixture");
    escapedCard.body = escapedCard.body.replace(
      "us-east-1 (N. Virginia) | ![Yes]",
      "us-east-1 (N. Virginia \\| primary) | ![Yes]",
    );
    expect(
      parseSource({
        provider: provider(value),
        source,
        body: JSON.stringify(escaped),
        observedAt,
      }).models,
    ).toHaveLength(4);
    const irregular = linkedBundle(await fixture("document/bedrock.json"));
    const irregularCard = irregular.documents.find(({ url }) => url.includes("model-card-"));
    if (irregularCard === undefined) throw new Error("Missing Bedrock card fixture");
    irregularCard.body = irregularCard.body.replace(
      "us-east-1 (N. Virginia) | ![Yes](icon-yes.png) |",
      "us-east-1 (N. Virginia) | unexpected | ![Yes](icon-yes.png) |",
    );
    const findings: PricingReconciliationItem[] = [];
    expect(
      parseSource({
        provider: provider(value),
        source,
        body: JSON.stringify(irregular),
        observedAt,
        onPricingReconciliation: (item) => findings.push(item),
      }).models,
    ).toHaveLength(3);
    expect(findings).toContainEqual(
      expect.objectContaining({
        disposition: "excluded",
        reason_code: "model_card_unsupported",
      }),
    );
  });

  it("bounds Bedrock aggregate pricing diagnostics to the reconciliation schema", () => {
    const sample = formatPricingInterpretationSample(
      20_437,
      20_543,
      new Set([
        "Grok 4.7 (APS3-xai.grok-4.7-mantle-cache-read-tokens-priority)",
        "Grok 4.7 (APS6-xai.grok-4.7-mantle-output-tokens-priority)",
      ]),
      new Set(["A long unsupported pricing dimension".repeat(20)]),
    );
    expect(sample).toHaveLength(256);
  });

  it("uses the current public Bedrock page when the structured price lists lag", async () => {
    const value = manifest("amazon-bedrock");
    const source = value.sources[0];
    if (source === undefined) throw new Error("Missing Bedrock source");
    const fixtureBundle = linkedBundle(await fixture("document/bedrock.json"));
    const haiku = fixtureBundle.documents.find((document) =>
      document.url.endsWith("model-card-anthropic-claude-haiku-4-5.md"),
    );
    const mantle = fixtureBundle.documents.find((document) =>
      document.url.endsWith("inference-responses-api.md"),
    );
    if (haiku === undefined || mantle === undefined)
      throw new Error("Missing Bedrock model card fixture");
    const body = JSON.stringify({
      index: fixtureBundle.index,
      documents: [
        mantle,
        {
          url: "https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-openai-gpt-5-5.md",
          body: haiku.body
            .replaceAll("Anthropic — Claude Haiku 4.5", "OpenAI — GPT-5.5")
            .replaceAll("Claude Haiku 4.5", "GPT-5.5")
            .replaceAll("anthropic.claude-haiku-4-5-20251001-v1:0", "openai.gpt-5.5")
            .replaceAll("anthropic.claude-haiku-4-5", "openai.gpt-5.5-mantle"),
        },
        {
          url: "https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-stability-stable-image-remove-background.md",
          body: haiku.body
            .replaceAll(
              "Anthropic — Claude Haiku 4.5",
              "Stability AI — Stable Image Remove Background",
            )
            .replaceAll("Claude Haiku 4.5", "Stable Image Remove Background")
            .replaceAll(
              "anthropic.claude-haiku-4-5-20251001-v1:0",
              "stability.stable-image-remove-background-v1:0",
            )
            .replaceAll(
              "anthropic.claude-haiku-4-5",
              "stability.stable-image-remove-background-mantle",
            ),
        },
        {
          url: "https://aws.amazon.com/bedrock/pricing/",
          body: `<li role="tabpanel">
            <h2 id="OpenAI">OpenAI</h2>
            <div class="lb-rtxt"><p>Regions: US East (N. Virginia) &amp; US East (Ohio)</p></div>
            <div><table><tbody>
              <tr><td></td><td colspan="4">Short Context Window (272K)</td><td colspan="4">Long Context Window (1M)</td></tr>
              <tr><td>OpenAI models</td><td>Price per 1M input tokens</td><td>Price per 1M input tokens (30m cache write)</td><td>Price per 1M input tokens (cache read)</td><td>Price per 1M output tokens</td><td>Price per 1M input tokens</td><td>Price per 1M input tokens (30m cache write)</td><td>Price per 1M input tokens (cache read)</td><td>Price per 1M output tokens</td></tr>
              <tr><td>GPT-5.5</td><td>$ 5.50</td><td>-</td><td>$ 0.55</td><td>$ 33.00</td><td>-</td><td>-</td><td>-</td><td>-</td></tr>
            </tbody></table></div>
          </li>
          <li role="tabpanel">
            <h2 id="Stability_AI">Stability AI</h2>
            <table><tbody>
              <tr><td>Stability AI Image Services</td><td>Price per generation for each model</td><td></td></tr>
              <tr><td>Stable Image Remove Background</td><td>$0.07</td><td></td></tr>
            </tbody></table>
          </li>
          <li role="tabpanel">
            <h2 id="Model_Evaluation">Model Evaluation</h2>
            <p>
              Automatically-generated algorithmic scores are provided at no extra charge. Model
              inference remains billable, with a charge of $0.21 per completed human task.
            </p>
          </li>`,
        },
      ],
    });
    const reconciliation: { disposition: string; reason_code: string }[] = [];
    const parsed = parseSource({
      provider: provider(value),
      source,
      body,
      observedAt,
      onPricingReconciliation: (item) => reconciliation.push(item),
    });
    const { models } = parsed;
    const model = models.find(({ model_id }) => model_id === "openai.gpt-5.5");
    expect(model?.price_facts).toHaveLength(6);
    expect(
      model?.price_facts.find(
        ({ meter, conditions }) => meter === "input_text" && conditions.region === "us-east-1",
      ),
    ).toMatchObject({
      price: "5.50",
      unit: "million_tokens",
      conditions: {
        deployment_scope: "in_region",
        service_tier: "standard",
        context_max_tokens: 272_000,
      },
    });
    const stability = models.find(
      ({ model_id }) => model_id === "stability.stable-image-remove-background-v1:0",
    );
    expect(stability?.price_facts).toHaveLength(3);
    expect(stability?.price_facts[0]).toMatchObject({
      meter: "image_generation",
      price: "0.07",
      unit: "image",
      conditions: { deployment_scope: "geo_cross_region", service_tier: "standard" },
    });
    expect(parsed.commercial_facts ?? []).toEqual([]);
    expect(reconciliation).toEqual([
      { disposition: "normalized", reason_code: "pricing_page_cell_bound" },
      {
        disposition: "excluded",
        reason_code: "price_cell_not_available",
        sample: "GPT-5.5: Price per 1M input tokens (30m cache write)",
      },
      { disposition: "normalized", reason_code: "pricing_page_cell_bound" },
      { disposition: "normalized", reason_code: "pricing_page_cell_bound" },
      ...Array.from({ length: 4 }, () => ({
        disposition: "excluded",
        reason_code: "price_cell_not_available",
        sample: expect.stringContaining("GPT-5.5"),
      })),
      { disposition: "normalized", reason_code: "pricing_page_cell_bound" },
    ]);

    const withoutOpenAiTables: PricingReconciliationItem[] = [];
    const isolated = parseSource({
      provider: provider(value),
      source,
      body: body.replaceAll("OpenAI models", "Frontier models"),
      observedAt,
      onPricingReconciliation: (item) => withoutOpenAiTables.push(item),
    }).models;
    expect(
      isolated.find(({ model_id }) => model_id === "stability.stable-image-remove-background-v1:0")
        ?.price_facts,
    ).toHaveLength(3);
    expect(withoutOpenAiTables).toContainEqual({
      disposition: "unsupported",
      reason_code: "optional_pricing_source_drifted",
      sample: "Bedrock public pricing page: contained no reviewed OpenAI model tables",
    });
  });

  it("preserves Bedrock OpenAI short- and long-context price ranges", async () => {
    const value = manifest("amazon-bedrock");
    const source = value.sources[0];
    if (source === undefined) throw new Error("Missing Bedrock source");
    const fixtureBundle = linkedBundle(await fixture("document/bedrock.json"));
    const haiku = fixtureBundle.documents.find((document) =>
      document.url.endsWith("model-card-anthropic-claude-haiku-4-5.md"),
    );
    const mantle = fixtureBundle.documents.find((document) =>
      document.url.endsWith("inference-responses-api.md"),
    );
    if (haiku === undefined || mantle === undefined)
      throw new Error("Missing Bedrock model card fixture");
    const body = JSON.stringify({
      index: fixtureBundle.index,
      documents: [
        mantle,
        {
          url: "https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-openai-gpt-56-sol.md",
          body: haiku.body
            .replaceAll("Anthropic — Claude Haiku 4.5", "OpenAI — GPT-5.6 Sol")
            .replaceAll("Claude Haiku 4.5", "GPT-5.6 Sol")
            .replaceAll("anthropic.claude-haiku-4-5-20251001-v1:0", "openai.gpt-5.6-sol-runtime")
            .replaceAll("anthropic.claude-haiku-4-5", "openai.gpt-5.6-sol"),
        },
        {
          url: "https://aws.amazon.com/bedrock/pricing/",
          body: `<li role="tabpanel">
            <h2 id="OpenAI">OpenAI</h2>
            <div class="lb-rtxt"><p>Region: US East (N. Virginia)</p></div>
            <div><table><tbody>
              <tr><td></td><td colspan="4">Short Context Window (272K)</td><td colspan="4">Long Context Window (1M)</td></tr>
              <tr><td>OpenAI models</td><td>Price per 1M input tokens</td><td>Price per 1M input tokens (30m cache write)</td><td>Price per 1M input tokens (cache read)</td><td>Price per 1M output tokens</td><td>Price per 1M input tokens</td><td>Price per 1M input tokens (30m cache write)</td><td>Price per 1M input tokens (cache read)</td><td>Price per 1M output tokens</td></tr>
              <tr><td>GPT-5.6 Sol</td><td>$5.50</td><td>$6.875</td><td>$0.55</td><td>$33.00</td><td>$11.00</td><td>$13.75</td><td>$1.10</td><td>$49.50</td></tr>
            </tbody></table></div>
          </li>
          <li role="tabpanel">
            <h2 id="Stability_AI">Stability AI</h2>
            <table><tbody><tr><td>Stability AI Image Services</td><td>Price per generation for each model</td></tr></tbody></table>
          </li>`,
        },
      ],
    });
    const model = parseSource({
      provider: provider(value),
      source,
      body,
      observedAt,
    }).models.find(({ model_id }) => model_id === "openai.gpt-5.6-sol");
    expect(model?.price_facts).toHaveLength(8);
    expect(
      model?.price_facts.find(
        ({ meter, conditions }) =>
          meter === "input_text" && conditions.context_min_tokens === 272_001,
      ),
    ).toMatchObject({
      price: "11.00",
      raw_unit: "Long Context Window (1M): Price per 1M input tokens",
      conditions: { context_min_tokens: 272_001, context_max_tokens: 1_000_000 },
    });
  });

  it("uses reviewed Bedrock pricing-page values when AWS price-list values disagree", async () => {
    const value = manifest("amazon-bedrock");
    const source = value.sources[0];
    if (source === undefined) throw new Error("Missing Bedrock source");
    const bundle = linkedBundle(
      (await fixture("document/bedrock-sonnet-pricing.json"))
        .replace(
          "USE1-Claude4Sonnet-input-tokens-cross-region-global",
          "USE1-Claude4Sonnet-input-tokens",
        )
        .replace("Claude4Sonnet input tokens cross region global", "Claude4Sonnet input tokens"),
    );
    const structured = bundle.documents.find((document) =>
      document.body.includes("USE1-Claude4Sonnet-input-tokens"),
    );
    if (structured === undefined) throw new Error("Missing Bedrock price-list fixture");
    structured.body = structured.body.replace(
      '"inferenceType":"Input tokens","model":"Claude Sonnet 4"',
      '"inferenceType":"Input tokens","model":"Claude Sonnet 4","service_tier":"standard"',
    );
    bundle.documents.push({
      url: "https://aws.amazon.com/bedrock/pricing/",
      body: `<li role="tabpanel">
        <h2 id="OpenAI">OpenAI</h2>
        <div class="lb-rtxt"><p>Region: US East (N. Virginia)</p></div>
        <div><table><tbody>
          <tr><td>OpenAI models</td><td>Price per 1M input tokens</td><td>Price per 1M output tokens</td></tr>
          <tr><td>Claude Sonnet 4</td><td>$ 99.00</td><td>N/A</td></tr>
        </tbody></table></div>
      </li>
      <li role="tabpanel">
        <h2 id="Stability_AI">Stability AI</h2>
        <table><tbody>
          <tr><td>Stability AI Image Services</td><td>Price per generation for each model</td></tr>
        </tbody></table>
      </li>`,
    });
    const reconciliation: { disposition: string; reason_code: string }[] = [];
    const models = parseSource({
      provider: provider(value),
      source,
      body: JSON.stringify(bundle),
      observedAt,
      onPricingReconciliation: (item) => reconciliation.push(item),
    }).models;
    const sonnet = models.find(
      ({ model_id }) => model_id === "anthropic.claude-sonnet-4-20250514-v1:0",
    );
    expect(
      sonnet?.price_facts.find(
        ({ meter, conditions }) =>
          meter === "input_text" &&
          conditions.region === "us-east-1" &&
          conditions.endpoint === undefined &&
          conditions.service_tier === "standard" &&
          conditions.context_min_tokens === undefined,
      )?.price,
    ).toBe("99.00");
    expect(sonnet?.raw_price_facts).toContainEqual(
      expect.objectContaining({
        impact: "informational",
        reason: "superseded_value",
        raw: expect.objectContaining({ meter: "input_text" }),
      }),
    );
    expect(reconciliation).toContainEqual({
      disposition: "normalized",
      reason_code: "pricing_page_cell_overrode_price_list",
    });
  });

  it.each(["existing", "expanded", "asymmetric", "reordered"])(
    "uses a complete Cohere Embed 4 Marketplace inventory (%s)",
    async (shape) => {
      const value = manifest("amazon-bedrock");
      const source = value.sources[0];
      if (source === undefined) throw new Error("Missing Bedrock source");
      const bundle = linkedBundle(await fixture("document/bedrock.json"));
      const command = bundle.documents.find((document) =>
        document.url.endsWith("model-card-cohere-command-r.md"),
      );
      if (command === undefined) throw new Error("Missing Cohere Bedrock card fixture");
      bundle.documents.push({
        url: "https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-cohere-embed-v4.md",
        body: command.body
          .replaceAll("Command R", "Cohere Embed 4")
          .replaceAll("cohere.command-r-v1:0", "cohere.embed-v4:0"),
      });
      const regions = `
      ap-northeast-1 ap-northeast-2 ap-northeast-3 ap-south-1 ap-south-2
      ap-southeast-1 ap-southeast-2 ap-southeast-3 ap-southeast-4 ca-central-1
      eu-central-1 eu-central-2 eu-north-1 eu-south-1 eu-south-2 eu-west-1 eu-west-2 eu-west-3
      sa-east-1 us-east-1 us-east-2 us-west-1 us-west-2
    `
        .trim()
        .split(/\s+/);
      if (shape === "expanded" || shape === "asymmetric") regions.push("ca-west-1");
      const rateCards = regions.flatMap((region, index) =>
        [false, true]
          .filter((global) => !(shape === "asymmetric" && global && region === "ca-west-1"))
          .map((global) => ({
            dimensionKey: `R${index}_InputTokenCount${global ? "_Global" : ""}`,
            displayName: `Price per 1 million input tokens${global ? " Global" : ""}`,
            description: `Price per 1 million input tokens${global ? " Global" : ""}`,
            dimensionLabels: [{ type: "REGION", value: region, displayName: region }],
            unit: "Units",
            price: "0.12000000",
          })),
      );
      const pageContext = {
        routeParams: { listingId: "prodview-j3fgisven2yrs" },
        dehydratedState: {
          queries: Array.from({ length: 2 }, (_, index) => ({
            state: {
              data: {
                summary: {
                  vendor: { vendorName: "Cohere" },
                  pricingModel: "USAGE",
                  terms: [
                    {
                      termType: "UsageBasedPricingTerm",
                      currencyCode: "USD",
                      rateCards:
                        shape === "reordered" && index === 1 ? [...rateCards].reverse() : rateCards,
                      rateCardCount: rateCards.length,
                      totalRateCards: rateCards.length,
                    },
                  ],
                },
              },
            },
          })),
        },
      };
      bundle.documents.push({
        url: "https://aws.amazon.com/marketplace/pp/prodview-j3fgisven2yrs",
        body: `<title>AWS Marketplace: Cohere Embed 4 Model (Amazon Bedrock Edition)</title><script id="vike_pageContext">${JSON.stringify(pageContext)}</script>`,
      });
      const models = parseSource({
        provider: provider(value),
        source,
        body: JSON.stringify(bundle),
        observedAt,
      }).models;
      const model = models.find(({ model_id }) => model_id === "cohere.embed-v4:0");
      if (model === undefined) throw new Error("Missing Cohere Embed 4 fixture model");
      expect(model.price_facts).toHaveLength(rateCards.length);
      model.price_facts.push({
        meter: "input_text",
        price: "0.0000000200",
        currency: "USD",
        unit: "token",
        conditions: {
          deployment_scope: "in_region",
          endpoint: "bedrock-runtime",
          region: "us-east-1",
        },
        source_ref: source.id,
        derived: false,
        raw_price: "0.0000000200",
        raw_unit: "Embeddings",
      });
      const partition = assembleParsedProviderPricing(
        value.provider.id,
        observedAt,
        [{ source, models: [model] }],
        [model],
        value.pricingCategoricalLabels,
      );
      const term = partition?.books[0]?.offers[0]?.terms.find(
        (candidate) => candidate.kind === "rate" && candidate.meter.value === "input_text",
      );
      if (term?.kind !== "rate") throw new Error("Missing Cohere Embed 4 input term");
      expect(term.variants).not.toHaveLength(0);
      expect(term.raw_variants).toEqual([
        expect.objectContaining({
          impact: "informational",
          reason: "superseded_value",
          resolution_policy: "bedrock_marketplace_product_page_over_price_list",
        }),
      ]);
    },
  );

  it("keeps Bedrock latency configuration separate from service tier and context tier", async () => {
    const value = manifest("amazon-bedrock");
    const source = value.sources[0];
    if (source === undefined) throw new Error("Missing Bedrock source");
    const body = (await fixture("document/bedrock.json")).replace(
      "USE1-ClaudeHaiku45-input-tokens",
      "USE1-ClaudeHaiku45-input-tokens-latency-optimized",
    );
    const model = parseSource({
      provider: provider(value),
      source,
      body,
      observedAt,
    }).models.find(({ model_id }) => model_id === "anthropic.claude-haiku-4-5-20251001-v1:0");
    expect(
      model?.price_facts.find(
        ({ meter, conditions }) => meter === "input_text" && conditions.speed === "optimized",
      ),
    ).toMatchObject({
      conditions: {
        region: "us-east-1",
        endpoint: "bedrock-runtime",
        deployment_scope: "in_region",
        service_tier: "standard",
        speed: "optimized",
      },
    });
  });

  it("uses an explicit model-card route for Bedrock Responses variants", async () => {
    const value = manifest("amazon-bedrock");
    const source = value.sources[0];
    if (source === undefined) throw new Error("Missing Bedrock source");
    const bundle = linkedBundle(await fixture("document/bedrock.json"));
    const haiku = bundle.documents.find((document) =>
      document.url.endsWith("model-card-anthropic-claude-haiku-4-5.md"),
    );
    if (haiku === undefined) throw new Error("Missing Bedrock model card fixture");
    bundle.documents.push({
      url: "https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-openai-gpt-56-sol.md",
      body: haiku.body
        .replaceAll("Anthropic — Claude Haiku 4.5", "OpenAI — GPT-5.6 Sol")
        .replaceAll("Claude Haiku 4.5", "GPT-5.6 Sol")
        .replaceAll("anthropic.claude-haiku-4-5-20251001-v1:0", "openai.gpt-5.6-sol-runtime")
        .replaceAll("anthropic.claude-haiku-4-5", "openai.gpt-5.6-sol")
        .replace("![Yes](icon-yes.png) Messages", "![Yes](icon-yes.png) Responses")
        .replace(
          "## Capabilities and Features",
          "**Note**  \nThis model is available on the `openai/v1/responses` path on the `bedrock-mantle` endpoint.\n\n## Capabilities and Features",
        ),
    });
    const model = parseSource({
      provider: provider(value),
      source,
      body: JSON.stringify(bundle),
      observedAt,
    }).models.find(({ model_id }) => model_id === "openai.gpt-5.6-sol");
    expect(model?.api_endpoints).toEqual([{ name: "Responses", path: "openai/v1/responses" }]);
  });

  it("uses unique catalog identities and provider-native units for Bedrock prices", async () => {
    const parsed = bedrockResult(
      linkedBundle(await fixture("document/bedrock-pricing-identity.json")),
    );
    const { models } = parsed;
    const nova = models.find(
      ({ model_id }) => model_id === "amazon.nova-2-multimodal-embeddings-v1:0",
    );
    const rerank = models.find(({ model_id }) => model_id === "cohere.rerank-v3-5:0");

    expect(nova?.price_facts).toContainEqual(
      expect.objectContaining({
        meter: "input_text",
        price: "0.135",
        unit: "million_tokens",
        raw_unit: "1K tokens",
      }),
    );
    expect(
      nova?.price_facts
        .filter(
          ({ meter, conditions }) => meter === "input_image" && conditions.operation !== undefined,
        )
        .map(({ price, conditions }) => ({ price, operation: conditions.operation })),
    ).toEqual([
      { price: "0.0004800000", operation: "document_image" },
      { price: "0.0000300000", operation: "standard_image" },
    ]);
    expect(nova?.price_facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          meter: "input_image",
          price: "0.0001000000",
          unit: "image",
          raw_unit: "Input Images",
        }),
        expect.objectContaining({
          meter: "embedding",
          price: "0.0000700000",
          unit: "request",
          raw_unit: "Text Requests",
          conditions: expect.objectContaining({ modality: "text" }),
        }),
        expect.objectContaining({
          meter: "input_text",
          price: "0.0000000200",
          unit: "token",
          raw_unit: "Embeddings",
          derived: true,
        }),
      ]),
    );
    expect(
      parsed.commercial_facts?.find(
        ({ resource_key }) => resource_key === `nova-web-grounding:${nova?.uid}`,
      )?.price_facts,
    ).toContainEqual(
      expect.objectContaining({ meter: "web_search", price: "0.0300000000", unit: "request" }),
    );
    expect(nova?.price_facts.some(({ meter }) => meter === "provisioned_throughput")).toBe(false);
    expect(rerank?.price_facts).toContainEqual(
      expect.objectContaining({
        meter: "rerank_request",
        price: "0.0020000000",
        unit: "search_unit",
        raw_unit: "Search Units",
      }),
    );
  });

  it("ignores an out-of-scope AgentCore price list without rejecting Bedrock", async () => {
    const value = manifest("amazon-bedrock");
    const source = value.sources[0];
    if (source === undefined) throw new Error("Missing Bedrock source");
    const bundle = linkedBundle(await fixture("document/bedrock-pricing-identity.json"));
    bundle.documents.push({
      url: "https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonBedrockAgentCore/current/index.json",
      body: await fixture("bedrock/agentcore-price-list.json"),
    });
    const findings: PricingReconciliationItem[] = [];
    const result = parseSource({
      provider: provider(value),
      source,
      body: JSON.stringify(bundle),
      observedAt,
      onPricingReconciliation: (item) => findings.push(item),
    });
    const { models } = result;

    expect(models).toHaveLength(2);
    expect(
      (result.commercial_facts ?? []).some(({ book_key }) => book_key.includes("agentcore")),
    ).toBe(false);
    expect(findings).toContainEqual({
      disposition: "unsupported",
      reason_code: "price_list_unsupported",
      sample:
        "https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonBedrockAgentCore/current/index.json",
    });
  });

  it("classifies Bedrock Flow execution as outside the gateway invocation boundary", async () => {
    const value = manifest("amazon-bedrock");
    const source = value.sources[0];
    if (source === undefined) throw new Error("Missing Bedrock source");
    const bundle = linkedBundle(await fixture("document/bedrock-pricing-identity.json"));
    const priceList = bundle.documents.find((document) =>
      document.url.endsWith("/AmazonBedrock/current/index.json"),
    );
    if (priceList === undefined) throw new Error("Missing Bedrock price-list fixture");
    const list = JSON.parse(priceList.body) as {
      products: Record<string, unknown>;
      terms: { OnDemand: Record<string, unknown> };
    };
    list.products["FLOW"] = {
      sku: "FLOW",
      attributes: {
        servicecode: "AmazonBedrock",
        feature: "Flow Execution",
        operation: "BedrockFlows-v1-invokeFlow",
        usagetype: "USE1-BedrockFlows-v1-invokeFlow",
        regionCode: "us-east-1",
      },
    };
    list.terms.OnDemand["FLOW"] = {
      "FLOW.TERM": {
        effectiveDate: "2026-07-01T00:00:00Z",
        priceDimensions: {
          "FLOW.DIM": {
            description: "$0.035 per 1K node transitions",
            unit: "1K node transitions",
            pricePerUnit: { USD: "0.035" },
          },
        },
      },
    };
    priceList.body = JSON.stringify(list);
    const findings: PricingReconciliationItem[] = [];
    parseSource({
      provider: provider(value),
      source,
      body: JSON.stringify(bundle),
      observedAt,
      onPricingReconciliation: (item) => findings.push(item),
    });
    expect(findings).toContainEqual(
      expect.objectContaining({
        disposition: "excluded",
        reason_code: "price_dimension_outside_invocation_scope",
        sample: expect.stringContaining("BedrockFlows-v1-invokeFlow"),
      }),
    );
    expect(findings).not.toContainEqual(
      expect.objectContaining({
        disposition: "unsupported",
        sample: expect.stringContaining("BedrockFlows-v1-invokeFlow"),
      }),
    );
  });

  it("does not bind Automatic Prompt Optimization charges to a numeric model identity", async () => {
    const value = manifest("amazon-bedrock");
    const source = value.sources[0];
    if (source === undefined) throw new Error("Missing Bedrock source");
    const bundle = linkedBundle(await fixture("document/bedrock.json"));
    const card = bundle.documents.find((document) =>
      document.url.endsWith("model-card-anthropic-claude-haiku-4-5.md"),
    );
    if (card === undefined) throw new Error("Missing Bedrock model-card fixture");
    card.url = "https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-deepseek-v3-1.md";
    card.body = card.body
      .replaceAll("Claude Haiku 4.5", "DeepSeek V3.1")
      .replace("Anthropic —", "DeepSeek —")
      .replaceAll("anthropic.claude-haiku-4-5-20251001-v1:0", "deepseek.v3-v1:0")
      .replaceAll("anthropic.claude-haiku-4-5", "deepseek.v3-mantle")
      .replaceAll("us-east-1", "ap-south-1");
    const priceList = bundle.documents.find((document) =>
      document.url.endsWith("/AmazonBedrock/current/index.json"),
    );
    if (priceList === undefined) throw new Error("Missing Bedrock price-list fixture");
    const list = JSON.parse(priceList.body) as {
      products: Record<string, unknown>;
      terms: { OnDemand: Record<string, unknown> };
    };
    list.products["DEEPSEEK"] = {
      sku: "DEEPSEEK",
      attributes: {
        servicecode: "AmazonBedrock",
        usagetype: "APS3-DeepSeek-V3.1-input-tokens",
        feature: "On-demand Inference",
        inferenceType: "Input tokens",
        model: "DeepSeek V3.1",
        provider: "DeepSeek",
        regionCode: "ap-south-1",
      },
    };
    list.terms.OnDemand["DEEPSEEK"] = {
      "DEEPSEEK.JRTCKXETXF": {
        effectiveDate: "2026-08-01T00:00:00Z",
        priceDimensions: {
          "DEEPSEEK.JRTCKXETXF.6YS6EN2CT7": {
            description: "$0.000682424 per 1K input tokens for DeepSeek V3.1",
            unit: "1K tokens",
            pricePerUnit: { USD: "0.0006824240" },
          },
        },
      },
    };
    list.products["PROMPTOPT"] = {
      sku: "PROMPTOPT",
      attributes: {
        servicecode: "AmazonBedrock",
        usagetype: "APS3-APO-v1-optimizePrompt",
        operation: "APO-v1-optimizePrompt",
        feature: "Automatic Prompt Optimization",
        regionCode: "ap-south-1",
      },
    };
    list.terms.OnDemand["PROMPTOPT"] = {
      "PROMPTOPT.JRTCKXETXF": {
        effectiveDate: "2026-08-01T00:00:00Z",
        priceDimensions: {
          "PROMPTOPT.JRTCKXETXF.6YS6EN2CT7": {
            description: "$0.03 per 1K tokens for APS3-APO-v1-optimizePrompt",
            unit: "1K tokens",
            pricePerUnit: { USD: "0.0300000000" },
          },
        },
      },
    };
    priceList.body = JSON.stringify(list);
    const findings: PricingReconciliationItem[] = [];
    const model = parseSource({
      provider: provider(value),
      source,
      body: JSON.stringify(bundle),
      observedAt,
      onPricingReconciliation: (item) => findings.push(item),
    }).models.find(({ model_id }) => model_id === "deepseek.v3-v1:0");

    expect(
      model?.price_facts
        .filter(
          ({ meter, conditions }) => meter === "input_text" && conditions.region === "ap-south-1",
        )
        .map(({ price, conditions }) => ({ price, tier: conditions.service_tier })),
    ).toEqual([{ price: "0.682424", tier: "standard" }]);
    expect(findings).toContainEqual(
      expect.objectContaining({
        disposition: "excluded",
        reason_code: "price_dimension_outside_invocation_scope",
        sample: expect.stringContaining("APO-v1-optimizePrompt"),
      }),
    );
  });

  it("keeps embedding invocation dimensions and excludes provisioned capacity", async () => {
    const value = manifest("amazon-bedrock");
    const source = value.sources[0];
    if (source === undefined) throw new Error("Missing Bedrock source");
    const models = await bedrockFixture("document/bedrock-embedding-pricing.json");
    const titan = models.find(({ model_id }) => model_id === "amazon.titan-embed-image-v1");
    if (titan === undefined) throw new Error("Missing Titan embedding fixture model");

    expect(titan.price_facts.every(({ conditions }) => conditions.modality === undefined)).toBe(
      true,
    );
    expect(
      titan.price_facts.map(({ meter, price, unit, conditions }) => {
        const { region, endpoint, deployment_scope, service_tier } = conditions;
        return {
          meter,
          price,
          unit,
          conditions: { region, endpoint, deployment_scope, service_tier },
        };
      }),
    ).toEqual([
      {
        meter: "input_image",
        price: "0.0000400000",
        unit: "image",
        conditions: {
          region: "eu-west-3",
          endpoint: "bedrock-runtime",
          deployment_scope: "in_region",
          service_tier: "batch",
        },
      },
      {
        meter: "input_text",
        price: "0.5",
        unit: "million_tokens",
        conditions: {
          region: "eu-west-3",
          endpoint: "bedrock-runtime",
          deployment_scope: "in_region",
          service_tier: "batch",
        },
      },
    ]);

    const partition = assembleParsedProviderPricing(
      value.provider.id,
      observedAt,
      [{ source, models }],
      models,
    );
    expect(
      partition?.books
        .filter(({ scope }) =>
          scope.model_refs.includes("amazon-bedrock/amazon.titan-embed-image-v1"),
        )
        .flatMap(({ offers }) => offers)
        .flatMap(({ terms }) =>
          terms.map((term) => [
            term.term_key,
            term.kind === "rate" ? term.variants.length : 0,
            term.kind === "rate" ? term.raw_variants.length : 0,
          ]),
        )
        .sort(([left], [right]) => String(left).localeCompare(String(right))),
    ).toEqual([
      ["input_image", 1, 0],
      ["input_text", 1, 0],
    ]);

    const marengo = models.find(({ model_id }) => model_id === "twelvelabs.marengo-embed-3-0-v1:0");
    expect(
      marengo?.price_facts.map(({ meter, unit, conditions }) => ({
        meter,
        unit,
        modality: conditions.modality,
      })),
    ).toEqual([
      { meter: "input_audio", unit: "second", modality: undefined },
      { meter: "input_video", unit: "second", modality: undefined },
    ]);
  });

  it("reconciles endpoint-equivalent Marketplace and service token prices", async () => {
    const value = manifest("amazon-bedrock");
    const source = value.sources[0];
    if (source === undefined) throw new Error("Missing Bedrock source");
    const models = await bedrockFixture("document/bedrock-sonnet-pricing.json");
    const sonnet = models.find(
      ({ model_id }) => model_id === "anthropic.claude-sonnet-4-20250514-v1:0",
    );
    if (sonnet === undefined) throw new Error("Missing Claude Sonnet 4 fixture model");
    expect(
      sonnet.price_facts
        .filter(({ conditions }) => conditions.service_tier !== "batch")
        .every(({ conditions }) => conditions.endpoint === undefined),
    ).toBe(true);
    expect(
      sonnet.price_facts
        .filter(({ conditions }) => conditions.service_tier === "batch")
        .every(({ conditions }) => conditions.endpoint === "bedrock-runtime"),
    ).toBe(true);

    const partition = assembleParsedProviderPricing(
      value.provider.id,
      observedAt,
      [{ source, models }],
      models,
    );
    const modelBook = partition?.books.find(
      ({ scope }) =>
        scope.kind === "models" &&
        scope.model_refs.includes("amazon-bedrock/anthropic.claude-sonnet-4-20250514-v1:0"),
    );
    const onDemand = modelBook?.offers.find(({ offer_key }) => offer_key === "on-demand");
    const batchOffer = modelBook?.offers.find(({ offer_key }) => offer_key === "batch");
    const terms = onDemand?.terms ?? [];
    expect(
      terms
        .filter(({ kind }) => kind === "rate")
        .map((term) => [
          term.term_key,
          term.kind === "rate" ? term.variants.length : 0,
          term.kind === "rate" ? term.raw_variants.length : 0,
        ])
        .sort(([left], [right]) => String(left).localeCompare(String(right))),
    ).toEqual([
      ["cache_read_text", 1, 0],
      ["cache_write_text", 1, 0],
      ["input_text", 1, 0],
      ["output_text", 1, 0],
    ]);
    const unresolved = terms.flatMap((term) => (term.kind === "raw" ? term.variants : []));
    expect(unresolved).toHaveLength(4);
    expect(unresolved.every(({ reason }) => reason === "unknown_applicability")).toBe(true);
    expect(
      unresolved
        .flatMap(({ observations }) => observations.map(({ raw }) => raw.amount))
        .sort((left, right) => String(left).localeCompare(String(right))),
    ).toEqual(["0.0006000000", "0.0060000000", "0.0075000000", "0.0225000000"]);
    expect(
      batchOffer?.terms
        .map((term) => [term.term_key, term.kind === "rate" ? term.variants.length : 0])
        .sort(([left], [right]) => String(left).localeCompare(String(right))),
    ).toEqual([
      ["input_text", 1],
      ["output_text", 1],
    ]);

    const input = terms.find(({ term_key }) => term_key === "input_text");
    if (input?.kind !== "rate") throw new Error("Missing input price term");
    const standard = input.variants.find(({ observations }) =>
      observations.some(({ raw }) => raw.amount === "3.0000000000"),
    );
    const longContext = unresolved.find(({ observations }) =>
      observations.some(({ raw }) => raw.amount === "0.0060000000"),
    );
    const batchInput = batchOffer?.terms.find(({ term_key }) => term_key === "input_text");
    const batch = batchInput?.kind === "rate" ? batchInput.variants[0] : undefined;
    expect(
      modelBook?.offers.every(({ states }) =>
        states.every(({ validity }) => validity === undefined),
      ),
    ).toBe(true);
    expect(
      terms.every(
        (term) =>
          term.kind === "raw" || term.variants.every(({ validity }) => validity === undefined),
      ),
    ).toBe(true);
    expect(standard?.observations.some(({ raw }) => raw.validity === "2026-07-01T00:00:00Z")).toBe(
      true,
    );
    expect(
      standard?.applicability.any_of[0]?.all_of.some(
        ({ dimension }) => dimension.value === "context_tokens",
      ),
    ).toBe(false);
    expect(longContext).toBeDefined();
    expect(
      longContext?.possible_scope?.any_of[0]?.all_of.some(
        ({ dimension }) => dimension.value === "context_tokens",
      ),
    ).toBe(false);
    expect(
      batch?.applicability.any_of[0]?.all_of.some(
        ({ dimension }) => dimension.namespace === "kmodels" && dimension.value === "service_tier",
      ),
    ).toBe(false);
  });

  it("pairs Bedrock display names with official endpoint model IDs", async () => {
    const models = await bedrockFixture("document/bedrock.json");
    expect(models.map(({ model_id, id_kind, name }) => ({ model_id, id_kind, name }))).toEqual([
      {
        model_id: "anthropic.claude-haiku-4-5",
        id_kind: "api_id",
        name: "Claude Haiku 4.5",
      },
      {
        model_id: "anthropic.claude-haiku-4-5-20251001-v1:0",
        id_kind: "api_id",
        name: "Claude Haiku 4.5",
      },
      { model_id: "cohere.command-r-v1:0", id_kind: "api_id", name: "Command R" },
      { model_id: "cohere.rerank-v3-5:0", id_kind: "api_id", name: "Rerank 3.5" },
    ]);
    const runtime = models.find(
      (model) => model.model_id === "anthropic.claude-haiku-4-5-20251001-v1:0",
    );
    const mantle = models.find((model) => model.model_id === "anthropic.claude-haiku-4-5");
    const rerank = models.find((model) => model.model_id === "cohere.rerank-v3-5:0");
    expect(models[0]?.tasks).toEqual(["text_generation"]);
    expect(models[0]?.modalities.input).toEqual(["text", "image"]);
    expect(runtime?.aliases).toEqual([
      "global.anthropic.claude-haiku-4-5-20251001-v1:0",
      "us.anthropic.claude-haiku-4-5-20251001-v1:0",
    ]);
    expect(runtime?.api_endpoints).toEqual([
      { name: "Converse", path: "model/{modelId}/converse" },
      { name: "Invoke", path: "model/{modelId}/invoke" },
      { name: "Messages", path: "model/{modelId}/invoke" },
    ]);
    expect(mantle?.api_endpoints).toEqual([{ name: "Messages", path: "anthropic/v1/messages" }]);
    expect(rerank?.api_endpoints).toEqual([
      { name: "Invoke", path: "model/{modelId}/invoke" },
      { name: "Rerank", path: "rerank" },
    ]);
    expect(runtime?.availability).toEqual([
      { region: "ap-southeast-4", deployment_type: "bedrock-runtime/geo" },
      { region: "us-east-1", deployment_type: "bedrock-runtime/geo" },
      { region: "ap-southeast-4", deployment_type: "bedrock-runtime/global" },
      { region: "us-east-1", deployment_type: "bedrock-runtime/global" },
      { region: "ap-southeast-4", deployment_type: "bedrock-runtime/in-region" },
      { region: "us-east-1", deployment_type: "bedrock-runtime/in-region" },
    ]);
    expect(mantle?.availability).toEqual([
      { region: "us-east-1", deployment_type: "bedrock-mantle/in-region" },
    ]);
    expect(models[0]?.limits).toEqual({ context_tokens: 200_000, max_output_tokens: 64_000 });
    expect(models[0]?.release_date).toBe("2025-10-15");
    expect(models[0]?.capabilities.reasoning).toBe(true);
    expect(models[0]?.capabilities.prompt_cache).toBe(true);
    expect(runtime?.price_facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          meter: "input_text",
          price: "0.8",
          unit: "million_tokens",
          raw_validity: "2026-07-01T00:00:00Z",
          conditions: expect.objectContaining({
            region: "us-east-1",
            endpoint: "bedrock-runtime",
            service_tier: "standard",
          }),
        }),
        expect.objectContaining({
          meter: "input_text",
          price: "1.0000000000",
          conditions: expect.objectContaining({
            deployment_scope: "global_cross_region",
          }),
        }),
        expect.objectContaining({
          meter: "input_text",
          price: "0.5000000000",
          conditions: expect.objectContaining({
            endpoint: "bedrock-runtime",
            deployment_scope: "global_cross_region",
            service_tier: "batch",
          }),
        }),
        expect.objectContaining({
          meter: "output_text",
          price: "5.0000000000",
          conditions: expect.objectContaining({
            deployment_scope: "in_region",
          }),
        }),
      ]),
    );
    expect(
      runtime?.price_facts.every(({ conditions }) => conditions.effective_from === undefined),
    ).toBe(true);
    expect(mantle?.price_facts).toEqual([
      expect.objectContaining({
        meter: "output_text",
        price: "5.0000000000",
        conditions: expect.objectContaining({
          deployment_scope: "in_region",
        }),
      }),
    ]);
    expect(models[2]?.status).toBe("legacy");
    expect(models[2]?.aliases).toEqual(["us.cohere.command-r-v1:0"]);
  });

  it("treats an effective Bedrock EOL date as retired despite a stale Legacy card label", async () => {
    const value = manifest("amazon-bedrock");
    const source = value.sources[0];
    if (source === undefined) throw new Error("Missing Bedrock source");
    const body = (await fixture("document/bedrock.json")).replace(
      "**Model EOL date:** N/A",
      "**Model EOL date:** Jun 20, 2026",
    );
    const model = parseSource({ provider: provider(value), source, body, observedAt }).models.find(
      (candidate) => candidate.model_id === "cohere.command-r-v1:0",
    );
    expect(model).toMatchObject({ status: "retired", retired_at: "2026-06-20" });
  });

  it("keeps a Bedrock card when an optional lifecycle date is invalid", async () => {
    const value = manifest("amazon-bedrock");
    const source = value.sources[0];
    if (source === undefined) throw new Error("Missing Bedrock source");
    const body = (await fixture("document/bedrock.json")).replace(
      "**Model launch date:** Oct 15, 2025",
      "**Model launch date:** Feb 30, 2025",
    );
    const findings: PricingReconciliationItem[] = [];
    const models = parseSource({
      provider: provider(value),
      source,
      body,
      observedAt,
      onPricingReconciliation: (item) => findings.push(item),
    }).models;
    expect(models).toHaveLength(4);
    expect(
      models.find(({ model_id }) => model_id === "anthropic.claude-haiku-4-5")?.release_date,
    ).toBeUndefined();
    expect(findings).toContainEqual(
      expect.objectContaining({
        disposition: "unsupported",
        reason_code: "model_card_date_unsupported",
        sample: expect.stringContaining("Feb 30, 2025"),
      }),
    );
  });

  it("preserves an explicit Mantle endpoint on service token prices", async () => {
    const value = manifest("amazon-bedrock");
    const source = value.sources[0];
    if (source === undefined) throw new Error("Missing Bedrock source");
    const input = (await fixture("document/bedrock.json"))
      .replace("/AmazonBedrock/current/", "/AmazonBedrockService/current/")
      .replace('\\"offerCode\\":\\"AmazonBedrock\\"', '\\"offerCode\\":\\"AmazonBedrockService\\"')
      .replace("USE1-ClaudeHaiku45-input-tokens", "USE1-ClaudeHaiku45-input-tokens-mantle");
    const models = parseSource({
      provider: provider(value),
      source,
      body: input,
      observedAt,
    }).models;
    const mantle = models.find((model) => model.model_id === "anthropic.claude-haiku-4-5");

    expect(mantle?.price_facts).toContainEqual(
      expect.objectContaining({
        meter: "input_text",
        price: "0.8",
        conditions: expect.objectContaining({ endpoint: "bedrock-mantle" }),
      }),
    );
  });

  it("keeps API evidence positive and isolates unknown labels", async () => {
    const value = manifest("amazon-bedrock");
    const source = value.sources[0];
    if (source === undefined) throw new Error("Missing Bedrock catalog source");
    const withoutInvoke = (await fixture("document/bedrock.json")).replace(
      "![Yes](icon-yes.png) Invoke",
      "![No](icon-no.png) Invoke",
    );
    const command = parseSource({
      provider: provider(value),
      source,
      body: withoutInvoke,
      observedAt,
    }).models.find(({ model_id }) => model_id === "cohere.command-r-v1:0");
    expect(command?.api_endpoints).toBeUndefined();

    const withChat = (await fixture("document/bedrock.json")).replace(
      "![Yes](icon-yes.png) Messages",
      "![Yes](icon-yes.png) Chat Completions",
    );
    const chatModels = parseSource({
      provider: provider(value),
      source,
      body: withChat,
      observedAt,
    }).models;
    for (const id of ["anthropic.claude-haiku-4-5", "anthropic.claude-haiku-4-5-20251001-v1:0"])
      expect(chatModels.find(({ model_id }) => model_id === id)?.api_endpoints).toContainEqual({
        name: "Chat Completions",
        path: "v1/chat/completions",
      });

    const sharedId = withChat.replace(
      "`bedrock-mantle` | `anthropic.claude-haiku-4-5`",
      "`bedrock-mantle` | `anthropic.claude-haiku-4-5-20251001-v1:0`",
    );
    const sharedModel = parseSource({
      provider: provider(value),
      source,
      body: sharedId,
      observedAt,
    }).models.find(({ model_id }) => model_id === "anthropic.claude-haiku-4-5-20251001-v1:0");
    expect(sharedModel?.api_endpoints?.filter(({ name }) => name === "Chat Completions")).toEqual([
      { name: "Chat Completions", path: "v1/chat/completions" },
    ]);

    const body = (await fixture("document/bedrock.json")).replace(
      "![Yes](icon-yes.png) Invoke",
      "![Yes](icon-yes.png) Transform",
    );
    const findings: PricingReconciliationItem[] = [];
    expect(
      parseSource({
        provider: provider(value),
        source,
        body,
        observedAt,
        onPricingReconciliation: (item) => findings.push(item),
      }).models,
    ).toHaveLength(4);
    expect(findings).toContainEqual(
      expect.objectContaining({
        disposition: "unsupported",
        reason_code: "model_card_api_unsupported",
        sample: "Transform",
      }),
    );
  });

  it("merges additive evidence for an exact model ID repeated across cards", async () => {
    const value = manifest("amazon-bedrock");
    const source = value.sources[0];
    if (source === undefined) throw new Error("Missing Bedrock catalog source");
    const bundle = linkedBundle(await fixture("document/bedrock.json"));
    const card = bundle.documents.find((document) =>
      document.url.endsWith("model-card-anthropic-claude-haiku-4-5.md"),
    );
    if (card === undefined) throw new Error("Missing Bedrock fixture card");
    bundle.documents.push({
      url: "https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-haiku-4-5-copy.md",
      body: card.body.replace(
        "![Yes](icon-yes.png) Messages",
        "![Yes](icon-yes.png) Chat Completions",
      ),
    });
    const model = parseSource({
      provider: provider(value),
      source,
      body: JSON.stringify(bundle),
      observedAt,
    }).models.find(({ model_id }) => model_id === "anthropic.claude-haiku-4-5-20251001-v1:0");
    expect(model?.api_endpoints).toEqual([
      { name: "Converse", path: "model/{modelId}/converse" },
      { name: "Invoke", path: "model/{modelId}/invoke" },
      { name: "Messages", path: "model/{modelId}/invoke" },
      { name: "Chat Completions", path: "v1/chat/completions" },
    ]);
  });

  it("parses the signed regional inventory as a scoped structured overlay", async () => {
    const model = (await bedrockFixture("document/bedrock-api.json", "bedrock-api-us-east-1"))[0];
    expect({
      id: model?.model_id,
      name: model?.name,
      release: model?.release_date,
      modalities: model?.modalities,
      streaming: model?.capabilities.streaming,
      fineTuning: model?.capabilities.fine_tuning,
      status: model?.status,
    }).toEqual({
      id: "anthropic.claude-haiku-4-5-20251001-v1:0",
      name: "Claude Haiku 4.5",
      release: "2025-10-15",
      modalities: { input: ["text", "image"], output: ["text"] },
      streaming: true,
      fineTuning: true,
      status: "active",
    });
  });

  it("normalizes live inventory enums and signals unknown additions without dropping rows", async () => {
    const value = manifest("amazon-bedrock");
    const source = value.sources.find(({ id }) => id === "bedrock-api-us-east-1");
    if (source === undefined) throw new Error("Missing Bedrock API source");
    const body = await fixture("document/bedrock-api.json");
    const withoutName = body.replace('      "modelName": "Claude Haiku 4.5",\n', "");
    expect(
      parseSource({
        provider: provider(value),
        source,
        body: withoutName,
        observedAt,
      }).models[0]?.name,
    ).toBe("anthropic.claude-haiku-4-5-20251001-v1:0");
    const expanded = body
      .replace(
        '"inputModalities": ["TEXT", "IMAGE"]',
        '"inputModalities": ["TEXT", "IMAGE", "EMBEDDING", "AUDIO", "VIDEO"]',
      )
      .replace(
        '"outputModalities": ["TEXT"]',
        '"outputModalities": ["TEXT", "EMBEDDING", "SPEECH"]',
      )
      .replace(
        '"customizationsSupported": ["FINE_TUNING"]',
        '"customizationsSupported": ["PREFERENCE_FINE_TUNING", "CONTINUED_PRE_TRAINING", "DISTILLATION"]',
      )
      .replace(
        '"inferenceTypesSupported": ["ON_DEMAND"]',
        '"inferenceTypesSupported": ["ON_DEMAND", "PROVISIONED", "INFERENCE_PROFILE"]',
      )
      .replace(
        '"status": "ACTIVE",',
        '"status": "ACTIVE",\n        "publicExtendedAccessTime": "2027-01-01T00:00:00.000Z",',
      );
    const expandedModel = parseSource({
      provider: provider(value),
      source,
      body: expanded,
      observedAt,
    }).models[0];
    expect({
      modalities: expandedModel?.modalities,
      fineTuning: expandedModel?.capabilities.fine_tuning,
    }).toEqual({
      modalities: {
        input: ["text", "image", "embedding", "audio", "video"],
        output: ["text", "embedding", "audio"],
      },
      fineTuning: true,
    });
    expect(
      parseSource({
        provider: provider(value),
        source,
        body: body.replace(
          '"customizationsSupported": ["FINE_TUNING"]',
          '"customizationsSupported": ["CONTINUED_PRE_TRAINING", "DISTILLATION"]',
        ),
        observedAt,
      }).models[0]?.capabilities.fine_tuning,
    ).toBe(false);
    const findings: SourceContractEvidence[] = [];
    const unknown = parseSource({
      provider: provider(value),
      source,
      body: body
        .replace(
          '"inputModalities": ["TEXT", "IMAGE"]',
          '"inputModalities": ["TEXT", "IMAGE", "MUSIC"]',
        )
        .replace(
          '"customizationsSupported": ["FINE_TUNING"]',
          '"customizationsSupported": ["ADAPTER_TUNING"]',
        )
        .replace(
          '"inferenceTypesSupported": ["ON_DEMAND"]',
          '"inferenceTypesSupported": ["SERVERLESS"]',
        )
        .replace('"status": "ACTIVE"', '"status": "AVAILABLE"'),
      observedAt,
      onContractFinding: (finding) => findings.push(finding),
    }).models[0];
    expect(unknown).toMatchObject({
      modalities: { input: ["text", "image"], output: ["text"] },
      capabilities: { streaming: true, fine_tuning: "unknown" },
      release_date: "2025-10-15",
      status: "unknown",
    });
    expect(findings).toMatchObject([
      {
        disposition: "accept_with_signal",
        diagnostics: expect.arrayContaining([
          expect.objectContaining({ kind: "unknown_value", observed_value: "MUSIC" }),
          expect.objectContaining({ kind: "unknown_value", observed_value: "ADAPTER_TUNING" }),
          expect.objectContaining({ kind: "unknown_value", observed_value: "SERVERLESS" }),
          expect.objectContaining({ kind: "unknown_value", observed_value: "AVAILABLE" }),
        ]),
      },
    ]);
    for (const changed of [
      body.replace("foundation-model/anthropic", "foundation-model/cohere"),
      body.replace(/^\s*"modelArn":.*\n/m, ""),
    ])
      expect(
        () => parseSource({ provider: provider(value), source, body: changed, observedAt }).models,
      ).toThrow();
  });
});
