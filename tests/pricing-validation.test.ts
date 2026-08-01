import { describe, expect, it } from "vite-plus/test";
import { unconditionalApplicability } from "../src/catalog/pricing-canonical.ts";
import {
  pricingBookId,
  pricingOfferId,
  pricingTermId,
} from "../src/catalog/pricing-identifiers.ts";
import type { PricingCatalog } from "../src/catalog/pricing-schema.ts";
import { validatePricingCatalogInParallel } from "../src/catalog/pricing-validation-parallel.ts";
import { validatePricingCatalog } from "../src/catalog/pricing-validation.ts";
import type { Catalog } from "../src/catalog/schema.ts";

const providerId = "test";
const modelRef = "test/model";
const sourceRef = "test-pricing";
const bookId = pricingBookId(providerId, "public");
const offerId = pricingOfferId(bookId, "usage");
const termId = pricingTermId(offerId, "input-text");
const raw = { amount: "2", denomination: "USD", unit: "million tokens" };
const locator = { kind: "table" as const, value: "row 1, input" };
const observation = {
  source_ref: sourceRef,
  locator,
  raw,
  establishes_applicability: unconditionalApplicability,
};

const core = {
  providers: [{ id: providerId }],
  models: [
    {
      uid: modelRef,
      provider_id: providerId,
    },
  ],
  sources: [{ id: sourceRef, provider_id: providerId }],
} as unknown as Pick<Catalog, "models" | "providers" | "sources">;

function catalog(): PricingCatalog {
  return {
    provider_vocabularies: [{ provider_id: providerId, atoms: [] }],
    provider_snapshots: [
      {
        provider_id: providerId,
        observed_at: "2026-07-28T00:00:00.000Z",
        publication: "fresh",
      },
    ],
    model_dispositions: [],
    books: [
      {
        id: bookId,
        provider_id: providerId,
        book_key: "public",
        scope: { kind: "models", model_refs: [modelRef] },
        scope_observations: [
          {
            source_ref: sourceRef,
            locator: { kind: "table", value: "heading" },
            establishes: { kind: "models", model_refs: [modelRef] },
            raw: { label: "Public model pricing" },
          },
        ],
        offers: [
          {
            id: offerId,
            offer_key: "usage",
            billing_mode: { namespace: "kmodels", value: "usage" },
            role: "base",
            states: [
              {
                state: "numeric",
                applicability: unconditionalApplicability,
                observations: [
                  {
                    source_ref: sourceRef,
                    locator: { kind: "table", value: "row 1" },
                    raw: { label: "Usage pricing" },
                    establishes_applicability: unconditionalApplicability,
                  },
                ],
              },
            ],
            terms: [
              {
                id: termId,
                term_key: "input-text",
                kind: "rate",
                meter: { namespace: "kmodels", value: "input_text" },
                source_refs: [sourceRef],
                variants: [
                  {
                    price: {
                      value: { numerator: "1", denominator: "500000" },
                      denomination: { kind: "fiat", currency: "USD" },
                      per: {
                        factors: [
                          {
                            unit: { namespace: "kmodels", value: "token" },
                            power: 1,
                          },
                        ],
                      },
                    },
                    applicability: unconditionalApplicability,
                    observations: [observation],
                  },
                ],
                raw_variants: [],
              },
            ],
            source_refs: [sourceRef],
          },
        ],
        source_refs: [sourceRef],
      },
    ],
  };
}

describe("canonical pricing serialized catalog validation", () => {
  it("accepts a canonical provider-local numeric catalog", () => {
    expect(() => validatePricingCatalog(catalog(), core)).not.toThrow();
  });

  it("checks the complete graph for I-JSON before using validated canonical serialization", () => {
    const invalid = catalog();
    invalid.books[0]!.scope_observations[0]!.raw = { label: "\ud800" };
    expect(() => validatePricingCatalog(invalid, core)).toThrow("lone surrogate");
  });

  it("rejects unstable IDs, unsorted arrays, and overlapping unequal values", () => {
    const badId = catalog();
    badId.books[0]!.id = "0".repeat(64);
    expect(() => validatePricingCatalog(badId, core)).toThrow("ID recipe mismatch");

    const conflict = catalog();
    const term = conflict.books[0]!.offers[0]!.terms[0]!;
    if (term.kind !== "rate") throw new Error("fixture term is not a rate");
    term.variants.push({
      ...term.variants[0]!,
      price: {
        ...term.variants[0]!.price,
        value: { numerator: "1", denominator: "400000" },
      },
    });
    expect(() => validatePricingCatalog(conflict, core)).toThrow();
  });

  it("preserves provider validation failures across worker boundaries", async () => {
    const badId = catalog();
    badId.books[0]!.id = "0".repeat(64);
    await expect(validatePricingCatalogInParallel(badId, core)).rejects.toThrow(
      "ID recipe mismatch",
    );
  });

  it("rejects evidence widening and cross-provider source ownership", () => {
    const widened = catalog();
    widened.books[0]!.scope.model_refs.push("test/other");
    expect(() => validatePricingCatalog(widened, core)).toThrow("model ref does not resolve");

    const foreignCore = structuredClone(core);
    foreignCore.sources[0]!.provider_id = "other";
    expect(() => validatePricingCatalog(catalog(), foreignCore)).toThrow(
      "belongs to another provider",
    );
  });

  it("accepts reviewed calculation evidence and rejects non-canonical units", () => {
    const formula = catalog();
    const formulaTerm = formula.books[0]!.offers[0]!.terms[0]!;
    if (formulaTerm.kind !== "rate") throw new Error("fixture term is not a rate");
    formulaTerm.variants[0]!.observations[0]!.raw = { formula: "input × 2" };
    expect(() => validatePricingCatalog(formula, core)).not.toThrow();

    const stateFormula = catalog();
    stateFormula.books[0]!.offers[0]!.states[0]!.observations[0]!.raw = {
      formula: "input × 2",
    };
    expect(() => validatePricingCatalog(stateFormula, core)).toThrow(
      "calculation evidence belongs only to a normalized rate",
    );

    const units = catalog();
    const unitTerm = units.books[0]!.offers[0]!.terms[0]!;
    if (unitTerm.kind !== "rate") throw new Error("fixture term is not a rate");
    unitTerm.variants[0]!.price.per.factors.push({
      unit: { namespace: "kmodels", value: "token" },
      power: 1,
    });
    expect(() => validatePricingCatalog(units, core)).toThrow("unit expression is not canonical");
  });
});
