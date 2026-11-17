import { readFile } from "node:fs/promises";
import { expect, it } from "vite-plus/test";
import { z } from "zod";
import { parseSource } from "../src/catalog/adapters.ts";
import { manifests, type ProviderManifest, type SourceManifest } from "../src/catalog/manifests.ts";
import { baseModel } from "../src/catalog/model.ts";
import { assembleParsedProviderPricing } from "../src/catalog/pricing-adapter.ts";
import { priceDataExport } from "../src/catalog/pricing-lookup-export.ts";
import { prepareCatalogPair } from "../src/catalog/pricing-publication.ts";
import { providerModelSchema } from "../src/catalog/schema.ts";
import { createInferencePriceLookup } from "../src/pricing/inference.ts";
import type { Selector } from "../src/pricing/schema.ts";

function configuration() {
  const manifest: ProviderManifest | undefined = manifests.find((m) => m.provider.id === "azure");
  const retail: SourceManifest | undefined = manifest?.sources.find(
    (s) => s.id === "azure-retail-prices",
  );
  const api: SourceManifest | undefined = manifest?.sources.find((s) => s.id === "azure-api");
  if (!manifest || !retail || !api || retail.extractor.kind !== "azure-retail-prices")
    throw new Error("Missing Azure sources");
  return {
    manifest,
    api,
    source: {
      ...retail,
      extractor: { ...retail.extractor, minModels: 1, maxModels: 1, minHandledRatio: 1 },
    },
  };
}
const { manifest, api, source } = configuration();
const provider = { ...manifest.provider, source_ids: manifest.sources.map((s) => s.id) };
const at = "2026-11-17T15:13:45.344Z";
// Reduced public Retail meter captured on 2026-11-17; model release and source observation differ.
const fixture = z
  .object({ prices: z.array(z.record(z.string(), z.unknown())) })
  .parse(
    JSON.parse(
      await readFile(
        new URL("./fixtures/azure/retail-effective-start.json", import.meta.url),
        "utf8",
      ),
    ),
  );
const native = fixture.prices[0];
if (!native) throw new Error("Missing Retail meter fixture");
const withoutStart = Object.fromEntries(
  Object.entries(native).filter(([key]) => key !== "effectiveStartDate"),
);
const model = {
  ...baseModel({
    providerId: "azure",
    id: "gpt-5.4-pro",
    version: "2026-03-05",
    name: "GPT-5.4 Pro",
    sourceId: source.id,
    observedAt: at,
  }),
  tasks: ["text_generation" as const],
  service_families: ["Azure OpenAI"],
  release_date: "2026-03-05",
};
function parse(prices: unknown[]) {
  return parseSource({
    provider,
    source,
    observedAt: at,
    catalogModels: [model],
    body: JSON.stringify({ prices }),
  });
}
function assemble(prices: unknown[]) {
  const parsed = parse(prices);
  const partition = assembleParsedProviderPricing(
    "azure",
    at,
    [{ source, ...parsed }],
    [model],
    manifest.pricingCategoricalLabels,
  );
  if (!partition) throw new Error("Missing Azure price partition");
  const core = {
    catalog_version: "a".repeat(64),
    generated_at: at,
    providers: [provider],
    models: [providerModelSchema.parse(model)],
    coverage: [],
    warnings: [],
    sources: [
      {
        id: source.id,
        provider_id: "azure",
        url: source.url,
        source: [source.type],
        stability: source.stability,
        scope: "global" as const,
        exhaustive: false,
        role: "overlay" as const,
        field_paths: source.fields,
        observed_at: at,
        content_hash: "1".repeat(64),
        extractor_version: source.extractorVersion,
        ...(source.pricingEvidence === undefined
          ? {}
          : { pricing_evidence: source.pricingEvidence }),
      },
    ],
  };
  const pair = prepareCatalogPair(core, {
    books: partition.books,
    provider_vocabularies: [partition.vocabulary],
    provider_snapshots: [partition.snapshot],
    model_dispositions: partition.model_dispositions,
  });
  const data = priceDataExport(pair.catalog, pair.pricing);
  const book = data.providers[0]?.books.find((b) => b.book_key === `model:${model.uid}`);
  if (!book) throw new Error("Missing Azure model book");
  // A synthetic caller-configured deployment exercises the actual public temporal matcher.
  // This fixture establishes no public Azure deployment alias; the producer still emits no mapping.
  const lookup = createInferencePriceLookup(data, {
    pricing_data_version: pair.pricing.pricing_data_version,
    core_catalog_version: core.catalog_version,
    sources: [],
    rules: [
      {
        provider_id: "azure",
        model_id: "configured-deployment",
        model_ref: model.uid,
        offer_refs: book.offers.map((o) => o.id),
        fixed_selectors: [],
        evidence: [
          {
            source_ref: source.id,
            locator: {
              kind: "provider_key",
              value: "Synthetic caller-configured deployment fixture",
            },
          },
        ],
      },
    ],
  });
  return { parsed, partition, data, lookup };
}
function selector(
  dimension: "region" | "deployment_scope" | "context_tier" | "served_service_tier",
  value: string,
): Selector {
  return {
    kind: "categorical",
    dimension: { namespace: "kmodels", value: dimension },
    value: { namespace: "provider", provider_id: "azure", value },
  };
}
const selections: Selector[] = [
  selector("region", "centralus"),
  selector("deployment_scope", "GlobalStandard"),
  selector("context_tier", "long_context"),
  selector("served_service_tier", "standard"),
];
function query(
  lookup: ReturnType<typeof createInferencePriceLookup>,
  evaluated_at: string,
  region = "centralus",
) {
  return lookup({
    provider_id: "azure",
    model_id: "configured-deployment",
    meter: { namespace: "kmodels", value: "output_text" },
    evaluated_at,
    selectors: selections.map((s) =>
      s.dimension.value === "region" ? selector("region", region) : s,
    ),
  });
}
const rates = (data: ReturnType<typeof priceDataExport>) =>
  data.providers.flatMap((p) =>
    p.books.flatMap((b) =>
      b.offers.flatMap((o) => o.terms.flatMap((t) => (t.kind === "rate" ? t.variants : []))),
    ),
  );

it("preserves the owned native start independently of release and observation clocks", () => {
  const { parsed, data, lookup } = assemble([native]);
  expect(parsed.models[0]?.price_facts[0]?.conditions.effective_from).toBe("2026-03-01T00:00:00Z");
  expect(parsed.models[0]?.price_facts[0]?.raw_validity).toBe("2026-03-01T00:00:00Z");
  expect(parsed.inference_prices).toEqual([]);
  expect(rates(data).map((v) => v.validity)).toEqual([
    { from: { value: "2026-03-01T00:00:00.000Z", precision: "datetime" } },
  ]);
  expect(lookup({ provider_id: "azure", model_id: "gpt-5.4-pro" }).reason).toBe("unreviewed_id");
});

it.each([
  ["2027-03-01T00:00:00Z", "datetime", "2027-03-01T00:00:00.000Z"],
  ["2027-03-01T08:30:00.123400+08:30", "datetime", "2027-03-01T00:00:00.1234Z"],
  ["2027-03-01", "date", "2027-03-01"],
])("retains native precision and exact UTC normalization (%s)", (start, precision, expected) => {
  const { parsed, data } = assemble([{ ...native, effectiveStartDate: start }]);
  expect(parsed.models[0]?.price_facts[0]?.conditions.effective_from).toBe(start);
  expect(parsed.models[0]?.price_facts[0]?.raw_validity).toBe(start);
  expect(rates(data).map((v) => v.validity)).toEqual([{ from: { value: expected, precision } }]);
});

it("uses exact future starts for public selection without fabricating an end", () => {
  const { data, partition, lookup } = assemble([
    {
      ...native,
      effectiveStartDate: "2027-03-01T08:30:00+08:30",
      effectiveEndDate: "2027-03-02T00:00:00Z",
    },
  ]);
  expect(query(lookup, "2027-02-28T23:59:59.999Z").reason).toBe("no_applicable_price");
  expect(query(lookup, "2027-03-01T00:00:00Z").status).toBe("matched");
  expect(query(lookup, "2027-03-04T00:00:00Z").status).toBe("matched");
  expect(rates(data).every((v) => v.validity?.until === undefined)).toBe(true);
  expect(rates(data)[0]?.evidence).toContainEqual(
    expect.objectContaining({ locator: { kind: "meter", value: native.meterId } }),
  );
  expect(
    partition.books.flatMap((b) =>
      b.offers.flatMap((o) =>
        o.terms.flatMap((t) =>
          t.kind === "rate" ? t.variants.flatMap((v) => v.observations) : [],
        ),
      ),
    ),
  ).toContainEqual(
    expect.objectContaining({
      raw: expect.objectContaining({
        validity: "2027-03-01T08:30:00+08:30 – 2027-03-02T00:00:00Z",
      }),
    }),
  );
});

it("keeps date-only start uncertainty instead of inventing midnight", () => {
  const { lookup } = assemble([{ ...native, effectiveStartDate: "2027-03-01" }]);
  expect(query(lookup, "2027-02-27T00:00:00Z").reason).toBe("no_applicable_price");
  for (const evaluated_at of [
    "2027-02-28T00:00:00Z",
    "2027-03-01T12:00:00Z",
    "2027-03-02T23:59:00Z",
  ]) {
    const result = query(lookup, evaluated_at);
    expect(result.status).toBe("candidates");
    expect(result.candidates.flatMap((c) => c.gaps)).toContainEqual(
      expect.objectContaining({ code: "unresolved_validity" }),
    );
  }
  expect(query(lookup, "2027-03-03T00:00:00Z").status).toBe("matched");
});

it("keeps missing starts undated and never uses the end or model clocks as a substitute", () => {
  const { parsed, data, lookup } = assemble([{ ...withoutStart, effectiveEndDate: "2027-01-01" }]);
  expect(parsed.models[0]?.price_facts[0]?.conditions.effective_from).toBeUndefined();
  expect(parsed.models[0]?.price_facts[0]?.conditions.effective_until).toBeUndefined();
  expect(rates(data).every((v) => v.validity === undefined)).toBe(true);
  expect(query(lookup, "2027-03-03T00:00:00Z").status).toBe("matched");
});

it.each(["Pending", "2027-02-30", "2027-03-01T00:00:00", "2027-03-01T00:00:00-00:00"])(
  "retains an invalid start as bounded raw evidence while a disjoint region remains usable (%s)",
  (start) => {
    const { parsed, data, lookup } = assemble([
      { ...native, effectiveStartDate: start },
      {
        ...native,
        meterId: "valid-sibling",
        armRegionName: "eastus",
        effectiveStartDate: "2027-01-01T00:00:00Z",
      },
    ]);
    expect(
      parsed.models[0]?.price_facts.find((f) => f.source_locator?.value === native.meterId)
        ?.conditions.effective_from,
    ).toBe(start);
    const term = data.providers[0]?.books
      .flatMap((b) => b.offers.flatMap((o) => o.terms))
      .find((t) => t.kind === "rate");
    if (!term || term.kind !== "rate") throw new Error("Missing output tariff");
    expect(term.raw_variants).toHaveLength(1);
    expect(term.raw_variants[0]?.reason).toBe("unsupported_structure");
    expect(query(lookup, "2027-03-03T00:00:00Z").reason).toBe("unresolved_price");
    expect(query(lookup, "2027-03-03T00:00:00Z", "eastus").status).toBe("matched");
  },
);

it("preserves repeated start schedules without inferring an end or choosing the latest quote", () => {
  const { parsed, data } = assemble([
    { ...native, effectiveStartDate: "2027-01-01T00:00:00Z" },
    { ...native, effectiveStartDate: "2028-01-01T00:00:00Z" },
  ]);
  expect(parsed.models[0]?.price_facts).toHaveLength(2);
  expect(rates(data)).toHaveLength(2);
  expect(rates(data).every((v) => v.validity?.until === undefined)).toBe(true);
});

it("keeps overlapping unequal dated quotes conflicting instead of treating the next start as an end", () => {
  const { data, lookup } = assemble([
    { ...native, effectiveStartDate: "2027-01-01T00:00:00Z" },
    { ...native, retailPrice: 271, effectiveStartDate: "2028-01-01T00:00:00Z" },
  ]);
  expect(rates(data)).toEqual([]);
  const raw = data.providers.flatMap((p) =>
    p.books.flatMap((b) =>
      b.offers.flatMap((o) => o.terms.flatMap((t) => (t.kind === "rate" ? t.raw_variants : []))),
    ),
  );
  expect(raw).toHaveLength(2);
  expect(
    raw.every((v) => v.reason === "conflicting_values" && v.validity?.until === undefined),
  ).toBe(true);
  expect(query(lookup, "2028-03-03T00:00:00Z").reason).toBe("unresolved_price");
});

it.each(["", 17, null])(
  "keeps structural date failures distinct from omitted starts (%j)",
  (start) => {
    const findings: unknown[] = [];
    const parsed = parseSource({
      provider,
      source,
      observedAt: at,
      catalogModels: [model],
      body: JSON.stringify({
        prices: [
          { ...native, effectiveStartDate: start },
          { ...withoutStart, meterId: "valid-sibling" },
        ],
      }),
      onContractFinding: (finding) => findings.push(finding),
    });
    expect(parsed.models[0]?.price_facts).toHaveLength(1);
    expect(parsed.models[0]?.price_facts[0]?.source_locator?.value).toBe("valid-sibling");
    expect(parsed.models[0]?.price_facts[0]?.conditions.effective_from).toBeUndefined();
    expect(findings.length).toBeGreaterThan(0);
  },
);

it.each([undefined, "Pending", "2027-02-30", "2027-03-01", "2027-03-01T08:30:00+08:30"])(
  "preserves the same native start on the historical exact ARM meter join (%s)",
  (start) => {
    const row = start === undefined ? withoutStart : { ...native, effectiveStartDate: start };
    const body = JSON.stringify({
      regions: [
        {
          location: "centralus",
          models: [
            {
              model: {
                name: model.model_id,
                version: model.version,
                capabilities: { chatCompletion: "true" },
                skus: [
                  {
                    name: "GlobalStandard",
                    costs: [{ name: "Output Tokens", meterId: native.meterId, unit: "1M" }],
                  },
                ],
              },
            },
          ],
        },
      ],
      prices: [row],
    });
    const parsed = parseSource({ provider, source: api, observedAt: at, body });
    expect(parsed.models[0]?.price_facts[0]?.conditions.effective_from).toBe(start);
    expect(parsed.models[0]?.uid).toBe(model.uid);
    expect(parsed.models[0]?.scope).toBe("runtime_observation");
    expect(
      assembleParsedProviderPricing("azure", at, [{ source: api, ...parsed }], [model]),
    ).toBeUndefined();
  },
);

it("does not attach a start or price when the historical meter identity is unbound", () => {
  const parsed = parseSource({
    provider,
    source: api,
    observedAt: at,
    body: JSON.stringify({
      regions: [
        {
          location: "centralus",
          models: [
            {
              model: {
                name: model.model_id,
                version: model.version,
                capabilities: { chatCompletion: "true" },
                skus: [
                  {
                    name: "GlobalStandard",
                    costs: [{ name: "Output Tokens", meterId: "different-meter", unit: "1M" }],
                  },
                ],
              },
            },
          ],
        },
      ],
      prices: [native],
    }),
  });
  expect(parsed.models[0]?.uid).toBe(model.uid);
  expect(parsed.models[0]?.price_facts).toEqual([]);
});
