import { describe, expect, it } from "vite-plus/test";
import { commercialPricingProjection } from "../src/catalog/pricing-commercial.ts";
import { unconditionalApplicability } from "../src/catalog/pricing-canonical.ts";
import {
  pricingBookId,
  pricingOfferId,
  pricingTermId,
} from "../src/catalog/pricing-identifiers.ts";
import type { PricingCatalog } from "../src/catalog/pricing-schema.ts";

const providerId = "test";
const bookId = pricingBookId(providerId, "public");
const offerId = pricingOfferId(bookId, "usage");
const termId = pricingTermId(offerId, "rate", "input");

function catalog(raw = false): PricingCatalog {
  return {
    provider_vocabularies: [
      {
        provider_id: providerId,
        atoms: [
          {
            kind: "meter",
            key: "compute",
            definition: "Provider compute work",
          },
          {
            kind: "unit",
            key: "unused",
            definition: "Unused provider unit",
          },
        ],
      },
    ],
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
        scope: { kind: "models", model_refs: ["test/model"] },
        scope_observations: [
          {
            source_ref: "pricing",
            locator: { kind: "table", value: "heading" },
            establishes: { kind: "models", model_refs: ["test/model"] },
            raw: { label: "Pricing" },
          },
        ],
        resource_edges: [],
        source_refs: ["pricing"],
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
                    source_ref: "pricing",
                    locator: { kind: "table", value: "state" },
                    establishes_applicability: unconditionalApplicability,
                    raw: { label: "Numeric" },
                  },
                ],
              },
            ],
            enrollment: [],
            terms: [
              {
                id: termId,
                term_key: "input",
                kind: "rate",
                meter: {
                  namespace: "provider",
                  provider_id: providerId,
                  value: "compute",
                },
                variants: raw
                  ? []
                  : [
                      {
                        price: {
                          value: { numerator: "1", denominator: "1" },
                          denomination: { kind: "fiat", currency: "USD" },
                          per: { factors: [] },
                        },
                        applicability: unconditionalApplicability,
                        observations: [
                          {
                            source_ref: "pricing",
                            locator: { kind: "table", value: "price" },
                            establishes_applicability: unconditionalApplicability,
                            raw: { amount: "1.00" },
                          },
                        ],
                      },
                    ],
                raw_variants: raw
                  ? [
                      {
                        impact: "base_price",
                        reason: "unsupported_structure",
                        observations: [
                          {
                            source_ref: "pricing",
                            locator: { kind: "table", value: "price" },
                            raw: { formula: "base × 2" },
                          },
                        ],
                      },
                    ]
                  : [],
                source_refs: ["pricing"],
              },
            ],
            relations: [],
            settlement: [],
            source_refs: ["pricing"],
          },
        ],
      },
    ],
  };
}

describe("pricing commercial projection", () => {
  it("keeps only used provider atoms", () => {
    expect(commercialPricingProjection(catalog()).provider_atoms).toEqual([
      {
        provider_id: providerId,
        atoms: [
          {
            kind: "meter",
            key: "compute",
            definition: "Provider compute work",
          },
        ],
      },
    ]);
  });

  it("separates normalized provenance changes from commercial changes", () => {
    const first = catalog();
    const second = structuredClone(first);
    const term = second.books[0]!.offers[0]!.terms[0]!;
    if (term.kind !== "rate") throw new Error("fixture term is not a rate");
    term.variants[0]!.observations[0]!.raw = { amount: "1" };
    expect(commercialPricingProjection(first)).toEqual(commercialPricingProjection(second));
  });

  it("includes complete raw facts in commercial equality", () => {
    const first = catalog(true);
    const second = structuredClone(first);
    const term = second.books[0]!.offers[0]!.terms[0]!;
    if (term.kind !== "rate") throw new Error("fixture term is not a rate");
    term.raw_variants[0]!.observations[0]!.raw = { formula: "base × 3" };
    expect(commercialPricingProjection(first)).not.toEqual(commercialPricingProjection(second));
  });

  it("omits informational-only raw terms", () => {
    const value = catalog();
    value.books[0]!.offers[0]!.terms.push({
      id: pricingTermId(offerId, "raw", "note"),
      term_key: "note",
      kind: "raw",
      variants: [
        {
          impact: "informational",
          reason: "unsupported_structure",
          observations: [
            {
              source_ref: "pricing",
              locator: { kind: "table", value: "note" },
              raw: { label: "Display note" },
            },
          ],
        },
      ],
      source_refs: ["pricing"],
    });
    expect(commercialPricingProjection(value).books[0]?.offers[0]?.terms).toHaveLength(1);
  });
});
