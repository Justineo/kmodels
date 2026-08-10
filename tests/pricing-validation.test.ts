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
const termId = pricingTermId(offerId, "rate", "input-text");
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
        resource_edges: [],
        offers: [
          {
            id: offerId,
            offer_key: "usage",
            billing_mode: { namespace: "kmodels", value: "usage" },
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
            enrollment: [],
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
            relations: [],
            settlement: [],
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

  it("validates charge-signal ownership and exact offer relations", () => {
    const related = catalog();
    const sourceOffer = related.books[0]!.offers[0]!;
    const targetOffer = structuredClone(sourceOffer);
    targetOffer.offer_key = "service";
    targetOffer.id = pricingOfferId(bookId, targetOffer.offer_key);
    for (const term of targetOffer.terms)
      term.id = pricingTermId(targetOffer.id, term.kind, term.term_key);
    sourceOffer.relations = [
      {
        kind: "compatible_with",
        target: { kind: "offers", offer_refs: [targetOffer.id] },
        applicability: unconditionalApplicability,
        observations: [
          {
            source_ref: sourceRef,
            locator: { kind: "table", value: "compatibility" },
            establishes_offer_refs: [targetOffer.id],
            establishes_book_refs: [],
            raw: { label: "Compatible offers" },
          },
        ],
      },
    ];
    const term = sourceOffer.terms[0]!;
    if (term.kind !== "rate") throw new Error("fixture term is not a rate");
    term.variants[0]!.charge_binding = {
      signal: { namespace: "kmodels", value: "uncached_input_tokens" },
      aggregation: "request",
      observations: [
        {
          source_ref: sourceRef,
          locator: { kind: "provider_key", value: "usage.prompt_tokens" },
          raw: { fragment: "prompt_tokens" },
        },
      ],
    };
    related.books[0]!.offers.push(targetOffer);
    related.books[0]!.offers.sort((left, right) => left.id.localeCompare(right.id));
    expect(() => validatePricingCatalog(related, core)).not.toThrow();

    const wrongSignalUnit = structuredClone(related);
    const wrongSignalTerm = wrongSignalUnit.books[0]!.offers.find(
      ({ offer_key }) => offer_key === "usage",
    )?.terms[0];
    if (wrongSignalTerm?.kind !== "rate") throw new Error("fixture term is not a rate");
    wrongSignalTerm.variants[0]!.charge_binding!.signal = {
      namespace: "kmodels",
      value: "accepted_requests",
    };
    expect(() => validatePricingCatalog(wrongSignalUnit, core)).toThrow(
      "charge signal unit differs from the rate denominator",
    );

    const unknownSignal = structuredClone(related);
    const unknownTerm = unknownSignal.books[0]!.offers.find(
      ({ offer_key }) => offer_key === "usage",
    )?.terms[0];
    if (unknownTerm?.kind !== "rate") throw new Error("fixture term is not a rate");
    unknownTerm.variants[0]!.charge_binding!.signal = {
      namespace: "provider",
      provider_id: providerId,
      value: "billable_input",
    };
    expect(() => validatePricingCatalog(unknownSignal, core)).toThrow(
      "unknown provider usage_signal atom",
    );

    const missingTarget = structuredClone(related);
    const relation = missingTarget.books[0]!.offers.find(({ offer_key }) => offer_key === "usage")
      ?.relations[0];
    if (relation?.target.kind !== "offers") throw new Error("fixture relation is not exact");
    relation.target.offer_refs = ["0".repeat(64)];
    relation.observations[0]!.establishes_offer_refs = ["0".repeat(64)];
    expect(() => validatePricingCatalog(missingTarget, core)).toThrow(
      "relation target is not another provider offer",
    );
  });
});
