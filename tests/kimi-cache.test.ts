import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";
import { extractKimiOpenApiAccounting } from "../src/catalog/kimi-accounting.ts";
import { manifests, type ProviderManifest } from "../src/catalog/manifests.ts";
import { baseModel } from "../src/catalog/model.ts";
import { assembleParsedProviderPricing } from "../src/catalog/pricing-adapter.ts";
import { calculationExport } from "../src/catalog/pricing-calculator-export.ts";
import { createPricingCatalogEnvelope } from "../src/catalog/pricing-envelope.ts";
import type { ParsedProviderModel, SourcePriceFact } from "../src/catalog/pricing-source.ts";
import { catalogSchema } from "../src/catalog/schema.ts";
import { createCalculator } from "../src/pricing/index.ts";

const observedAt = "2026-10-20T00:00:00.000Z";
async function compiled(
  china: boolean,
  options: {
    editBody?: (body: string) => string;
    otherRegion?: boolean;
    modelId?: "kimi-k3" | "kimi-k2.6";
  } = {},
) {
  const manifest: ProviderManifest | undefined = manifests.find(
    ({ provider }) => provider.id === "kimi",
  );
  if (manifest === undefined) throw new Error("Missing Kimi provider");
  const api = manifest.sources.find(
    ({ id }) => id === (china ? "kimi-china-openapi" : "kimi-openapi"),
  );
  const price = manifest.sources.find(
    ({ id }) => id === (china ? "kimi-pricing" : "kimi-international-pricing"),
  );
  if (api === undefined || price === undefined) throw new Error("Missing Kimi sources");
  const body = await readFile(
    new URL("./fixtures/kimi/cache-accounting.json", import.meta.url),
    "utf8",
  );
  const apiSources = [api];
  if (options.otherRegion) {
    const other = manifest.sources.find(
      ({ id }) => id === (china ? "kimi-openapi" : "kimi-china-openapi"),
    );
    if (other === undefined) throw new Error("Missing other region");
    apiSources.push(other);
  }
  const apiGroups = apiSources.map((source) => {
    if (source.extractor.kind !== "kimi-openapi") throw new Error("Invalid API source");
    return {
      source,
      accounting: extractKimiOpenApiAccounting({
        spec: JSON.parse(source === api ? (options.editBody?.(body) ?? body) : body),
        sourceRef: source.id,
        baseUrl: source.extractor.baseUrl,
      }),
    };
  });
  const modelId = options.modelId ?? "kimi-k3";
  const writes = modelId === "kimi-k3";
  const region = china ? "China" : "International",
    currency = china ? "CNY" : "USD";
  const rate = (
    meter: SourcePriceFact["meter"],
    amount: string,
    ttl?: number,
  ): SourcePriceFact => ({
    source_ref: price.id,
    meter,
    price: amount,
    currency,
    unit: "million_tokens",
    derived: false,
    conditions: { region, ...(ttl === undefined ? {} : { cache_ttl_seconds: ttl }) },
  });
  const model: ParsedProviderModel = {
    ...baseModel({
      providerId: "kimi",
      id: modelId,
      name: modelId,
      sourceId: api.id,
      observedAt,
    }),
    source_refs: [...apiSources.map(({ id }) => id), price.id],
    tasks: ["text_generation"],
    modalities: { input: ["text"], output: ["text"] },
    api_endpoints: [
      ...new Map(
        [
          { name: "Chat Completions", path: "/v1/chat/completions" },
          ...apiGroups.flatMap(({ accounting }) =>
            accounting.endpoints
              .filter(({ modelIds }) => modelIds.includes(modelId))
              .map(({ name, path }) => ({ name, path })),
          ),
        ].map((endpoint) => [endpoint.path, endpoint]),
      ).values(),
    ],
    pricing_state: "numeric",
    raw_price_facts: [],
    price_facts: [
      rate("input_text", writes ? (china ? "20" : "3") : china ? "6.5" : "0.95"),
      rate("cache_read_text", writes ? (china ? "2" : "0.3") : china ? "1.1" : "0.16"),
      rate("output_text", writes ? (china ? "100" : "15") : china ? "27" : "4"),
      ...(writes
        ? [
            rate("cache_write_text", china ? "20" : "3", 300),
            rate("cache_write_text", china ? "40" : "6", 3600),
          ]
        : []),
    ],
  };
  const groups = [
    ...apiGroups.map(({ source, accounting }) => ({
      source,
      models: [{ ...model, price_facts: [], pricing_state: "unknown" as const }],
      pricing_inputs: accounting.pricingInputs,
    })),
    { source: price, models: [model] },
  ];
  const partition = assembleParsedProviderPricing("kimi", observedAt, groups, [model]);
  if (partition === undefined) throw new Error("Missing Kimi prices");
  const core = catalogSchema.parse(
    JSON.parse(
      JSON.stringify({
        catalog_version: "a".repeat(64),
        generated_at: observedAt,
        providers: [{ ...manifest.provider, source_ids: manifest.sources.map(({ id }) => id) }],
        models: [model],
        coverage: [],
        warnings: [],
        sources: [...apiSources, price].map((source) => ({
          id: source.id,
          provider_id: "kimi",
          url: source.url,
          source: [source.type],
          stability: source.stability,
          scope: source.scope,
          role: source.role,
          exhaustive: source.exhaustive,
          field_paths: source.fields,
          pricing_evidence: source.pricingEvidence,
          observed_at: observedAt,
          extractor_version: source.extractorVersion,
          content_hash: "1".repeat(64),
        })),
      }),
    ),
  );
  const pricing = {
    books: partition.books,
    provider_snapshots: [partition.snapshot],
    provider_vocabularies: [partition.vocabulary],
    model_dispositions: partition.model_dispositions,
  };
  const exported = calculationExport(core, createPricingCatalogEnvelope(pricing, core));
  const offer = exported.providers[0]?.books[0]?.offers.find(
    ({ offer_key }) => offer_key === "sync",
  );
  if (offer === undefined) throw new Error("Missing Kimi synchronous offer");
  return { calculator: createCalculator(exported), offer, region, currency };
}

describe("Kimi cache-write accounting", () => {
  it.each(["counter", "model scope"])(
    "does not replace a failed regional %s with the other region's contract",
    async (kind) => {
      const { offer } = await compiled(true, {
        otherRegion: true,
        editBody: (body) => {
          if (kind === "model scope")
            return body.replace("currently supports `kimi-k3`", "supports compatible models");
          const spec = z
            .object({ components: z.object({ schemas: z.record(z.string(), z.unknown()) }) })
            .passthrough()
            .parse(JSON.parse(body));
          const usage = z
            .object({
              properties: z
                .object({
                  input_tokens_details: z
                    .object({ properties: z.record(z.string(), z.unknown()) })
                    .passthrough(),
                })
                .passthrough(),
            })
            .passthrough()
            .parse(spec.components.schemas["ResponsesUsage"]);
          usage.properties.input_tokens_details.properties["cached_tokens"] = { type: "string" };
          spec.components.schemas["ResponsesUsage"] = usage;
          return JSON.stringify(spec);
        },
      });
      const cached = offer.terms.find(
        (term) => term.kind === "rate" && term.meter.value === "cache_read_text",
      );
      if (cached?.kind !== "rate") throw new Error("Missing cache charge");
      const binding = cached.variants[0]?.charge_binding;
      expect(binding).toBeDefined();
      expect(
        binding?.quantity_methods
          ?.flatMap(({ input_sources }) => input_sources ?? [])
          .map(({ locator }) => locator.value),
      ).not.toContain("/usage/input_tokens_details/cached_tokens");
      expect(binding?.evidence.some(({ source_ref }) => source_ref === "kimi-openapi")).toBe(false);
      expect(
        binding?.quantity_methods
          ?.flatMap(({ input_sources }) => input_sources ?? [])
          .map(({ locator }) => locator.value),
      ).toContain("/usage/cached_tokens");
    },
  );

  it("leaves the stronger partition caller-owned when its description no longer proves exclusivity", async () => {
    const { offer } = await compiled(false, {
      editBody: (body) =>
        body.replaceAll(
          "are mutually exclusive and sum to prompt_tokens",
          "are reported separately",
        ),
    });
    const input = offer.terms.find(
      (term) => term.kind === "rate" && term.meter.value === "input_text",
    );
    if (input?.kind !== "rate") throw new Error("Missing input charge");
    const methods = input.variants[0]?.charge_binding?.quantity_methods;
    expect(methods?.some(({ calculation }) => calculation !== undefined)).toBe(false);
    expect(
      methods
        ?.flatMap(({ input_sources }) => input_sources ?? [])
        .map(({ locator }) => locator.value),
    ).toContain("/usage/input_tokens");
  });

  it("keeps ordinary non-hit input billing when no separate write tariff exists", async () => {
    const { calculator, offer, region, currency } = await compiled(true, { modelId: "kimi-k2.6" });
    const result = calculator.calculate({
      evaluatedAt: observedAt,
      components: [
        {
          id: "k2",
          offerRef: offer.id,
          selectors: [
            {
              kind: "categorical",
              dimension: { namespace: "kmodels", value: "region" },
              value: { namespace: "provider", provider_id: "kimi", value: region },
            },
          ],
          quantities: [
            {
              signal: { namespace: "kmodels", value: "input_tokens" },
              value: { numerator: "1000", denominator: "1" },
            },
            {
              signal: { namespace: "kmodels", value: "cached_input_tokens" },
              value: { numerator: "200", denominator: "1" },
            },
            {
              signal: { namespace: "kmodels", value: "output_tokens" },
              value: { numerator: "0", denominator: "1" },
            },
          ],
        },
      ],
    });
    expect(result.status).toBe("calculated");
    expect(result.totals).toEqual([
      {
        denomination: { kind: "fiat", currency },
        amount: { numerator: "271", denominator: "50000" },
      },
    ]);
  });
  it.each([
    { china: true, ttl: 300, amount: { numerator: "41", denominator: "2500" } },
    { china: true, ttl: 3600, amount: { numerator: "14", denominator: "625" } },
    { china: false, ttl: 300, amount: { numerator: "123", denominator: "50000" } },
    { china: false, ttl: 3600, amount: { numerator: "21", denominator: "6250" } },
  ])(
    "charges each native Chat prompt partition once (China=$china, TTL=$ttl)",
    async ({ china, ttl, amount }) => {
      const { calculator, offer, region, currency } = await compiled(china);
      const result = calculator.calculate({
        evaluatedAt: observedAt,
        components: [
          {
            id: "chat",
            offerRef: offer.id,
            selectors: [
              {
                kind: "categorical",
                dimension: { namespace: "kmodels", value: "region" },
                value: { namespace: "provider", provider_id: "kimi", value: region },
              },
              {
                kind: "decimal",
                dimension: { namespace: "kmodels", value: "cache_ttl_seconds" },
                unit: { factors: [{ unit: { namespace: "kmodels", value: "second" }, power: 1 }] },
                value: String(ttl),
              },
            ],
            quantities: [
              {
                signal: { namespace: "kmodels", value: "input_tokens" },
                value: { numerator: "1000", denominator: "1" },
              },
              {
                signal: { namespace: "kmodels", value: "cached_input_tokens" },
                value: { numerator: "200", denominator: "1" },
              },
              {
                signal: { namespace: "kmodels", value: "cache_write_tokens" },
                value: { numerator: "300", denominator: "1" },
              },
              {
                signal: { namespace: "kmodels", value: "output_tokens" },
                value: { numerator: "0", denominator: "1" },
              },
            ],
          },
        ],
      });
      expect(result.status).toBe("calculated");
      expect(result.totals).toEqual([{ denomination: { kind: "fiat", currency }, amount }]);
    },
  );
});
