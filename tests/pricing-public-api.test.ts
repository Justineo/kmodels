import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import {
  createInferencePriceLookup,
  commercialPriceQuerySchema,
  validatePriceData,
  type PriceDataEnvelope,
} from "../src/pricing/index.ts";
import { lookupFixtureSchema } from "./pricing-lookup-fixture.ts";

const suite = lookupFixtureSchema.parse(
  JSON.parse(readFileSync(new URL("./fixtures/pricing/lookup.json", import.meta.url), "utf8")),
);
function dataset(name: string) {
  return validatePriceData(suite.datasets[name]);
}
function offer(data: PriceDataEnvelope) {
  const value = data.providers[0]?.books[0]?.offers[0];
  if (value === undefined) throw new Error("Missing fixture offer");
  return value;
}
function rate(data: PriceDataEnvelope) {
  const term = offer(data).terms[0];
  if (term?.kind !== "rate" || term.variants[0] === undefined)
    throw new Error("Missing fixture rate");
  return term.variants[0];
}
function mappedTier() {
  const data = dataset("tier");
  const variant = rate(data);
  const condition = variant.applicability.any_of[0]?.all_of[0];
  if (condition?.kind !== "categorical" || condition.values[0] === undefined)
    throw new Error("Missing tier condition");
  const entry = { source_value: "standard", value: condition.values[0] };
  const source = {
    dimension: condition.dimension,
    channel: "response" as const,
    locator: { kind: "json_pointer" as const, value: "/served_tier" },
    availability: "terminal_only" as const,
    absent_value: condition.values[0],
    normalization: {
      kind: "categorical_map" as const,
      entries: [entry],
    },
    evidence: structuredClone(variant.evidence),
  };
  variant.selector_sources = [source];
  return { data, variant, source, entry };
}

describe("public pricing contracts", () => {
  it("preserves selector evidence and isolates lookup results from caller mutation", () => {
    const { data, source } = mappedTier();
    const book = data.providers[0]?.books[0];
    const modelRef = book?.scope.model_refs[0];
    if (!book || !modelRef) throw new Error("Missing fixture model");
    const lookup = createInferencePriceLookup(data, {
      core_catalog_version: data.snapshot.coreCatalogVersion,
      pricing_data_version: data.snapshot.pricingDataVersion,
      sources: [],
      rules: [
        {
          provider_id: "example",
          model_id: "example-model",
          model_ref: modelRef,
          offer_refs: [offer(data).id],
          fixed_selectors: [],
          evidence: book.evidence,
        },
      ],
    });
    const query = { provider_id: "example", model_id: "example-model" };
    const original = lookup(query);
    const result = lookup(query);
    expect(
      result.candidates.flatMap(({ offer }) =>
        offer.terms.flatMap((term) =>
          term.kind === "rate"
            ? term.variants.flatMap((variant) => variant.selector_sources ?? [])
            : [],
        ),
      ),
    ).toContainEqual(source);
    result.candidates.length = 0;
    data.providers.length = 0;
    expect(lookup(query)).toEqual(original);
    expect(original).not.toHaveProperty("totals");
  });

  it("rejects retired schemas and usage/cost request fields", () => {
    for (const schemaVersion of ["1.0", "1.1"])
      expect(() => validatePriceData({ ...dataset("base"), schemaVersion })).toThrowError(
        expect.objectContaining({ code: "UNSUPPORTED_SCHEMA" }),
      );
    const subject = { kind: "model", provider_id: "example", model_id: "example-model" };
    expect(commercialPriceQuerySchema.safeParse({ subject }).success).toBe(true);
    for (const field of [
      "quantities",
      "components",
      "assumptions",
      "aggregation",
      "relatedComponents",
    ])
      expect(commercialPriceQuerySchema.safeParse({ subject, [field]: [] }).success).toBe(false);
  });

  const invalidMappings: Array<[string, (fixture: ReturnType<typeof mappedTier>) => void]> = [
    [
      "foreign mapped value",
      ({ entry }) => {
        entry.value = { namespace: "provider", provider_id: "foreign", value: "standard" };
      },
    ],
    [
      "unregistered mapped value",
      ({ entry }) => {
        entry.value = { namespace: "provider", provider_id: "example", value: "unregistered" };
      },
    ],
    [
      "value outside variant scope",
      ({ entry }) => {
        entry.value = { namespace: "provider", provider_id: "example", value: "priority" };
      },
    ],
    [
      "foreign absent value",
      ({ source }) => {
        source.absent_value = { namespace: "provider", provider_id: "foreign", value: "standard" };
      },
    ],
    [
      "unrelated dimension",
      ({ source }) => {
        source.dimension = { namespace: "kmodels", value: "region" };
      },
    ],
    [
      "duplicate source input",
      ({ source, entry }) => {
        source.normalization.entries.push(structuredClone(entry));
      },
    ],
  ];
  it.each(invalidMappings)("rejects %s at initialization", (_name, change) => {
    const fixture = mappedTier();
    change(fixture);
    expect(() => validatePriceData(fixture.data)).toThrowError(
      expect.objectContaining({ code: "INVALID_DATA" }),
    );
  });
});
