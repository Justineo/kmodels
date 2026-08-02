import { describe, expect, it } from "vite-plus/test";
import { pricingLimits } from "../src/catalog/pricing-constants.ts";
import { generatedData } from "./generated-data-context.ts";

const minimumReviewedObservationCount = 8_000;

describe("Bedrock pricing resource calibration", () => {
  it("contains the complete committed observation corpus within its provider budget", async () => {
    const pricing = (await generatedData()).pricing.data;
    const providerId = "amazon-bedrock";
    const books = pricing.books.filter(({ provider_id }) => provider_id === providerId);
    const modelRefs = new Set(books.flatMap(({ scope }) => scope.model_refs));
    const partition = {
      vocabulary: pricing.provider_vocabularies.find(
        ({ provider_id }) => provider_id === providerId,
      ),
      snapshot: pricing.provider_snapshots.find(({ provider_id }) => provider_id === providerId),
      model_dispositions: pricing.model_dispositions.filter(({ model_ref }) =>
        modelRefs.has(model_ref),
      ),
      books,
    };
    const observationCount = books.reduce(
      (bookTotal, book) =>
        bookTotal +
        book.scope_observations.length +
        book.offers.reduce(
          (offerTotal, offer) =>
            offerTotal +
            offer.states.reduce((stateTotal, state) => stateTotal + state.observations.length, 0) +
            offer.terms.reduce(
              (termTotal, term) =>
                termTotal +
                (term.kind === "raw"
                  ? term.variants
                  : [...term.variants, ...term.raw_variants]
                ).reduce((variantTotal, variant) => variantTotal + variant.observations.length, 0),
              0,
            ),
          0,
        ),
      0,
    );

    expect(observationCount).toBeGreaterThan(minimumReviewedObservationCount);
    expect(Buffer.byteLength(JSON.stringify(partition))).toBeLessThan(
      pricingLimits.providerPricingBytes,
    );
  }, 90_000);
});
