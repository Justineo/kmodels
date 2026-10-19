import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vite-plus/test";
import { parseSource } from "../src/catalog/adapters.ts";
import { manifests, type SourceManifest } from "../src/catalog/manifests.ts";
import { assembleParsedProviderPricing } from "../src/catalog/pricing-adapter.ts";
import { canonicalJson } from "../src/catalog/canonical-json.ts";
import { catalogRepairCandidates } from "../src/catalog/catalog-repair.ts";
import { calculationExport } from "../src/catalog/pricing-calculator-export.ts";
import { createPricingCatalogEnvelope } from "../src/catalog/pricing-envelope.ts";
import {
  sourcePricingReconciliation,
  type PricingReconciliationItem,
} from "../src/catalog/pricing-reconciliation.ts";
import { catalogSchema, type Catalog } from "../src/catalog/schema.ts";
import { createCalculator, type Quantity } from "../src/pricing/index.ts";

const manifest = manifests.find(({ provider }) => provider.id === "amazon-bedrock");
if (manifest === undefined) throw new Error("Missing Bedrock manifest");
const primarySource = manifest.sources[0];
if (primarySource === undefined) throw new Error("Missing Bedrock source");
const source: SourceManifest = primarySource;
const provider = { ...manifest.provider, source_ids: manifest.sources.map(({ id }) => id) };
const observedAt = "2026-10-19T04:27:08.089Z";

async function nativeBundle(withBulk = false) {
  const card = {
    url: "https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-openai-gpt-6-astra.md",
    body: await readFile(
      new URL("./fixtures/bedrock/model-card-gpt6-context.md", import.meta.url),
      "utf8",
    ),
  };
  const documents = [card];
  if (withBulk)
    documents.push({
      url: "https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonBedrockFoundationModels/current/index.json",
      body: await readFile(
        new URL("./fixtures/bedrock/context-price-list.json", import.meta.url),
        "utf8",
      ),
    });
  return {
    index: {
      url: "https://docs.aws.amazon.com/bedrock/latest/userguide/model-cards.md",
      body: "# Model cards",
    },
    documents,
  };
}

function parse(
  bundle: Awaited<ReturnType<typeof nativeBundle>>,
  findings: PricingReconciliationItem[] = [],
) {
  return parseSource({
    provider,
    source,
    body: JSON.stringify(bundle),
    observedAt,
    onPricingReconciliation: (item) => findings.push(item),
  });
}

function astra(result: ReturnType<typeof parse>) {
  const model = result.models.find(({ model_id }) => model_id === "openai.gpt-6-astra");
  if (model === undefined) throw new Error("Missing Astra model");
  return model;
}

describe("native Bedrock card tariffs", () => {
  it.each(["quoted", "fenced", "duplicate", "unowned"])(
    "does not borrow %s service-tier instructions",
    async (change) => {
      const bundle = await nativeBundle();
      const card = bundle.documents[0];
      if (card === undefined) throw new Error("Missing native card");
      const line = card.body
        .split("\n")
        .find((line) => line.includes("To request it with the Responses API"));
      if (line === undefined) throw new Error("Missing tier instruction");
      card.body = card.body.replace(
        line,
        change === "quoted"
          ? "> " + line
          : change === "fenced"
            ? "```text\n" + line + "\n```"
            : change === "duplicate"
              ? "## Service Tiers\n" + line
              : "",
      );
      if (change === "unowned") card.body += "\n## Examples\n" + line;
      const model = astra(parse(bundle));
      expect(
        model.price_facts.some(({ conditions }) => conditions.service_tier === "ultrafast"),
      ).toBe(false);
      expect(model.raw_price_facts).toHaveLength(24);
      expect(
        model.price_facts.some(({ conditions }) => conditions.service_tier === "standard"),
      ).toBe(true);
    },
  );

  it("requires the owning USD unit claim while retaining independent native SKUs", async () => {
    const bundle = await nativeBundle(true);
    const card = bundle.documents[0];
    if (card === undefined) throw new Error("Missing native card");
    card.body = card.body.replace(
      "All prices are in USD per 1 million tokens.",
      "All prices are in credits per unit.",
    );
    const model = astra(parse(bundle));
    expect(model.price_facts).toHaveLength(4);
    expect(model.raw_price_facts).toHaveLength(48);
    expect(
      model.raw_price_facts.every(
        ({ reason, raw }) =>
          reason === "unknown_unit" &&
          raw.amount !== undefined &&
          raw.denomination === undefined &&
          raw.unit === undefined,
      ),
    ).toBe(true);
  });

  it("isolates a malformed native table without losing its quotes or other bands", async () => {
    const bundle = await nativeBundle();
    const card = bundle.documents[0];
    if (card === undefined) throw new Error("Missing native card");
    const line = card.body
      .split("\n")
      .find((line) => line.includes("In-Region (us-east-1)") && line.includes("$66.00"));
    if (line === undefined) throw new Error("Missing native row");
    card.body = card.body.replace(line, line + " Broken |");
    const model = astra(parse(bundle));
    const ultra = model.price_facts.filter(
      ({ conditions }) => conditions.service_tier === "ultrafast",
    );
    expect(new Set(ultra.map(({ source_locator }) => source_locator?.value)).size).toBe(12);
    expect(ultra.every(({ conditions }) => conditions.context_min_tokens === 272001)).toBe(true);
    expect(model.raw_price_facts).toHaveLength(1);
    expect(model.raw_price_facts[0]?.raw.fragment).toContain("$66.00");
  });

  it("calculates native Ultrafast amounts through the portable export with caller-supplied quantities", async () => {
    const result = parse(await nativeBundle(true));
    const partition = assembleParsedProviderPricing(
      "amazon-bedrock",
      observedAt,
      [{ source, ...result }],
      result.models,
    );
    if (partition === undefined) throw new Error("Missing partition");
    const parsedCore: Catalog = {
      catalog_version: "a".repeat(64),
      generated_at: observedAt,
      coverage: [],
      warnings: [],
      providers: [provider],
      models: result.models,
      sources: [
        {
          id: source.id,
          provider_id: provider.id,
          url: source.url,
          source: source.source ?? [source.type],
          stability: source.stability,
          scope: source.scope ?? "global",
          exhaustive: source.exhaustive ?? false,
          role: source.role ?? "catalog",
          field_paths: source.fields,
          observed_at: observedAt,
          content_hash: "1".repeat(64),
          extractor_version: source.extractorVersion,
        },
      ],
    };
    const core = catalogSchema.parse(JSON.parse(JSON.stringify(parsedCore)));
    const envelope = calculationExport(
      core,
      createPricingCatalogEnvelope(
        {
          provider_vocabularies: [partition.vocabulary],
          provider_snapshots: [partition.snapshot],
          model_dispositions: partition.model_dispositions,
          books: partition.books,
        },
        core,
      ),
    );
    const exported = envelope.providers[0]?.books
      .find(({ scope }) => scope.model_refs.includes(astra(result).uid))
      ?.offers.find(({ offer_key }) => offer_key === "on-demand");
    if (exported === undefined) throw new Error("Missing exported offer");
    const quantities = new Map<string, Quantity>();
    for (const term of exported.terms) {
      if (term.kind !== "rate") continue;
      for (const variant of term.variants) {
        const signal = variant.charge_binding?.signal;
        if (signal !== undefined)
          quantities.set(canonicalJson(signal), {
            signal,
            value: { numerator: "0", denominator: "1" },
          });
      }
    }
    const calculator = createCalculator(envelope);
    for (const [context, expected] of [
      [272000, { numerator: "408", denominator: "25" }],
      [272001, { numerator: "816003", denominator: "25000" }],
    ] as const) {
      const calculated = calculator.calculate({
        evaluatedAt: observedAt,
        components: [
          {
            id: "native",
            offerRef: exported.id,
            quantities: [...quantities.values()].map((quantity) =>
              quantity.signal.value === "uncached_input_tokens"
                ? { ...quantity, value: { numerator: String(context), denominator: "1" } }
                : quantity,
            ),
            selectors: [
              {
                kind: "categorical",
                dimension: { namespace: "kmodels", value: "service_tier" },
                value: { namespace: "provider", provider_id: "amazon-bedrock", value: "ultrafast" },
              },
              {
                kind: "categorical",
                dimension: { namespace: "kmodels", value: "operation" },
                value: { namespace: "provider", provider_id: "amazon-bedrock", value: "responses" },
              },
              {
                kind: "categorical",
                dimension: { namespace: "kmodels", value: "endpoint" },
                value: {
                  namespace: "provider",
                  provider_id: "amazon-bedrock",
                  value: "bedrock-runtime",
                },
              },
              {
                kind: "categorical",
                dimension: { namespace: "kmodels", value: "deployment_scope" },
                value: {
                  namespace: "provider",
                  provider_id: "amazon-bedrock",
                  value: "global_cross_region",
                },
              },
              {
                kind: "categorical",
                dimension: { namespace: "kmodels", value: "region" },
                value: { namespace: "provider", provider_id: "amazon-bedrock", value: "us-east-1" },
              },
              {
                kind: "decimal",
                dimension: { namespace: "kmodels", value: "context_tokens" },
                unit: { factors: [{ unit: { namespace: "kmodels", value: "token" }, power: 1 }] },
                value: String(context),
              },
              {
                kind: "decimal",
                dimension: { namespace: "kmodels", value: "cache_ttl_seconds" },
                unit: { factors: [{ unit: { namespace: "kmodels", value: "second" }, power: 1 }] },
                value: "1800",
              },
            ],
          },
        ],
      });
      expect(calculated).toMatchObject({
        status: "calculated",
        totals: [
          {
            amount: expected,
            denomination: { kind: "fiat", currency: "USD" },
          },
        ],
      });
    }
  });

  it.each([false, true])(
    "retains all literal Ultrafast quotes with partial bulk inventory=%s",
    async (withBulk) => {
      const model = astra(parse(await nativeBundle(withBulk)));
      const ultra = model.price_facts.filter(
        ({ conditions }) => conditions.service_tier === "ultrafast",
      );
      expect(new Set(ultra.map(({ source_locator }) => source_locator?.value)).size).toBe(24);
      expect(
        ultra.every(
          ({ derived, conditions, source_locator }) =>
            !derived && conditions.operation === "responses" && source_locator?.kind === "table",
        ),
      ).toBe(true);
      expect(
        ultra
          .filter(
            ({ meter, conditions }) =>
              meter === "input_text" && conditions.deployment_scope === "global_cross_region",
          )
          .map(({ price }) => price),
      ).toEqual(expect.arrayContaining(["60.00", "120.00"]));
      expect(
        ultra
          .filter(({ meter }) => meter === "cache_write_text")
          .every(({ conditions }) => conditions.cache_ttl_seconds === 1800),
      ).toBe(true);
      expect(
        ultra
          .filter(({ conditions }) => conditions.endpoint === "bedrock-mantle")
          .every(({ conditions }) => conditions.region === "us-east-1"),
      ).toBe(true);
      expect(
        ultra
          .filter(({ conditions }) => conditions.deployment_scope === "geo_cross_region")
          .every(({ conditions }) => conditions.inference_geo === "us"),
      ).toBe(true);
      expect(
        model.price_facts.filter(({ source_locator }) => source_locator?.kind === "sku"),
      ).toHaveLength(withBulk ? 4 : 0);
      expect(model.raw_price_facts).toEqual([]);
    },
  );

  it("preserves numeric amounts and localized unknown API scope without lending Converse contracts", async () => {
    const bundle = await nativeBundle(true);
    const card = bundle.documents[0];
    if (card === undefined) throw new Error("Missing native card");
    card.body = card.body.replace(
      "To request it with the Responses API, set",
      "To request it with a selected API, set",
    );
    const findings: PricingReconciliationItem[] = [];
    const result = parse(bundle, findings);
    const model = astra(result);
    expect(
      model.price_facts.some(({ conditions }) => conditions.service_tier === "ultrafast"),
    ).toBe(false);
    const raw = model.raw_price_facts.filter(
      ({ conditions }) => conditions.service_tier === "ultrafast",
    );
    expect(raw).toHaveLength(24);
    expect(
      raw.every(
        ({ reason, raw }) =>
          reason === "unknown_applicability" &&
          raw.amount !== undefined &&
          raw.unit === "1 million tokens",
      ),
    ).toBe(true);
    expect(findings).toContainEqual(
      expect.objectContaining({
        reason_code: "model_card_price_scope_unresolved",
        disposition: "unresolved",
      }),
    );
    const reconciliation = sourcePricingReconciliation(result.models, findings, true);
    expect(reconciliation.diagnostics).toContainEqual(
      expect.objectContaining({ reason_code: "model_card_price_scope_unresolved" }),
    );
    const candidates = catalogRepairCandidates({
      schema_version: 2,
      generated_at: observedAt,
      providers: [
        {
          provider_id: provider.id,
          signals: [],
          attempt: {
            outcome: "accepted",
            sources: [
              {
                source_id: source.id,
                outcome: "unchanged",
                content_changed: false,
                pricing_reconciliation: reconciliation,
              },
            ],
          },
        },
      ],
    });
    expect(candidates).toEqual([
      expect.objectContaining({
        source_id: source.id,
        trigger: "source_pricing_structure",
        message: expect.stringContaining("model_card_price_scope_unresolved: 24"),
      }),
    ]);
    expect(model.price_facts.some(({ conditions }) => conditions.service_tier === "standard")).toBe(
      true,
    );
  });

  it("retains sibling cells when one native cache column loses its contract", async () => {
    const bundle = await nativeBundle();
    const card = bundle.documents[0];
    if (card === undefined) throw new Error("Missing native card");
    card.body = card.body.replaceAll(
      "Input — 30-minute cache write",
      "Input — unspecified cache write",
    );
    const model = astra(parse(bundle));
    expect(model.price_facts.some(({ meter }) => meter === "cache_write_text")).toBe(false);
    expect(model.price_facts.some(({ meter }) => meter === "input_text")).toBe(true);
    expect(model.price_facts.some(({ meter }) => meter === "output_text")).toBe(true);
    expect(model.raw_price_facts.filter(({ reason }) => reason === "unknown_meter")).toHaveLength(
      12,
    );
    expect(
      model.raw_price_facts.every(
        ({ raw }) => raw.amount !== undefined && raw.fragment?.includes("unspecified cache write"),
      ),
    ).toBe(true);
  });

  it("retains an unreadable price cell without fabricating a quote state or a multiplier", async () => {
    const bundle = await nativeBundle();
    const card = bundle.documents[0];
    if (card === undefined) throw new Error("Missing native card");
    card.body = card.body.replace("$66.00", "Contact us");
    const model = astra(parse(bundle));
    expect(
      new Set(
        model.price_facts
          .filter(({ conditions }) => conditions.service_tier === "ultrafast")
          .map(({ source_locator }) => source_locator?.value),
      ).size,
    ).toBe(23);
    expect(model.raw_price_facts).toHaveLength(1);
    expect(model.raw_price_facts[0]).toMatchObject({
      reason: "unsupported_structure",
      raw: { fragment: expect.stringContaining("Contact us") },
    });
    expect(model.state_facts ?? []).toEqual([]);
  });

  it("keeps a duplicate tariff owner unresolved without hiding other bands", async () => {
    const bundle = await nativeBundle();
    const card = bundle.documents[0];
    if (card === undefined) throw new Error("Missing native card");
    const start = card.body.indexOf("### Ultrafast — Commercial Regions, short context");
    const end = card.body.indexOf("### Ultrafast — Commercial Regions, long context", start);
    card.body = card.body.slice(0, end) + card.body.slice(start, end) + card.body.slice(end);
    const model = astra(parse(bundle));
    expect(
      model.price_facts
        .filter(({ conditions }) => conditions.service_tier === "ultrafast")
        .every(({ conditions }) => conditions.context_min_tokens === 272001),
    ).toBe(true);
    expect(
      model.raw_price_facts.some(
        ({ reason, raw }) => reason === "unknown_applicability" && raw.fragment?.includes("$66.00"),
      ),
    ).toBe(true);
    expect(model.price_facts.some(({ conditions }) => conditions.service_tier === "standard")).toBe(
      true,
    );
  });

  it("composes card and bulk observations without silently selecting an unequal amount", async () => {
    const bundle = await nativeBundle(true);
    const bulk = bundle.documents[1];
    if (bulk === undefined) throw new Error("Missing native bulk excerpt");
    bulk.body = bulk.body.replace('"1.0000000000"', '"9.0000000000"');
    const result = parse(bundle);
    const partition = assembleParsedProviderPricing(
      "amazon-bedrock",
      observedAt,
      [{ source, ...result }],
      result.models,
    );
    const book = partition?.books.find(
      ({ scope }) => scope.kind === "models" && scope.model_refs.includes(astra(result).uid),
    );
    const cache = book?.offers
      .find(({ offer_key }) => offer_key === "on-demand")
      ?.terms.find(({ term_key }) => term_key === "cache_read_text");
    expect(cache?.kind).toBe("rate");
    if (cache?.kind !== "rate") throw new Error("Missing cache term");
    const conflicts = cache.raw_variants.filter(({ reason }) => reason === "conflicting_values");
    expect(
      conflicts.flatMap(({ observations }) => observations.map(({ raw }) => raw.amount)),
    ).toEqual(expect.arrayContaining(["9.0000000000", "$1.00"]));
    expect(
      cache.variants.some(({ observations }) =>
        observations.some(({ raw }) => raw.amount === "$6.00"),
      ),
    ).toBe(true);
    for (const variant of cache.variants.filter(({ observations }) =>
      observations.some(({ raw }) => raw.amount === "$6.00"),
    )) {
      expect(variant.charge_binding?.quantity_methods).toBeUndefined();
      expect(variant.selector_sources ?? []).toEqual([]);
    }
    const reversed = parse({ ...bundle, documents: [...bundle.documents].reverse() });
    const again = assembleParsedProviderPricing(
      "amazon-bedrock",
      observedAt,
      [{ source, ...reversed }],
      reversed.models,
    );
    expect(again?.books).toEqual(partition?.books);
  });
});
