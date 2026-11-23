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
  return structuredClone(validatePriceData(suite.datasets[name]));
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

describe("public pricing contracts", () => {
  it("hydrates interned applicabilities and isolates lookup results from caller mutation", () => {
    const data = dataset("tier");
    const provider = data.providers[0];
    const book = provider?.books[0];
    const modelRef = book?.scope.model_refs[0];
    if (!provider || !book || !modelRef) throw new Error("Missing fixture model");
    const variant = rate(data);
    const expectedApplicability = provider.applicabilities[variant.applicability_id];
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
          term.kind === "rate" ? term.variants.map((v) => v.applicability) : [],
        ),
      ),
    ).toContainEqual(expectedApplicability);
    result.candidates.length = 0;
    data.providers.length = 0;
    expect(lookup(query)).toEqual(original);
    expect(original).not.toHaveProperty("totals");
  });

  it("rejects retired schemas and usage/cost request fields", () => {
    for (const schemaVersion of ["1.0", "1.1", "2.0"])
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

  const invalidDatasets: Array<[string, (data: PriceDataEnvelope) => void]> = [
    [
      "out-of-range applicability_id",
      (data) => {
        rate(data).applicability_id = 999;
      },
    ],
    [
      "duplicate applicability table entry",
      (data) => {
        const provider = data.providers[0];
        const first = provider?.applicabilities[0];
        if (!provider || !first) throw new Error("Missing applicability");
        provider.applicabilities.push(structuredClone(first));
      },
    ],
    [
      "complete selection with empty alternatives",
      (data) => {
        const book = data.providers[0]?.books[0];
        if (!book) throw new Error("Missing book");
        offer(data).selection = [
          {
            dimension: "execution",
            coverage: "complete",
            applicability_id: 0,
            alternatives: [],
            evidence: book.evidence,
          },
        ];
      },
    ],
    [
      "billing_mode selection disagreeing with offer billing_mode",
      (data) => {
        const book = data.providers[0]?.books[0];
        if (!book) throw new Error("Missing book");
        offer(data).selection = [
          {
            dimension: "billing_mode",
            coverage: "complete",
            applicability_id: 0,
            alternatives: [
              { value: { namespace: "kmodels", value: "capacity" }, applicability_id: 0 },
            ],
            evidence: book.evidence,
          },
        ];
      },
    ],
  ];
  it.each(invalidDatasets)("rejects %s at initialization", (_name, change) => {
    const data = dataset("tier");
    change(data);
    expect(() => validatePriceData(data)).toThrowError(
      expect.objectContaining({ code: "INVALID_DATA" }),
    );
  });
});
