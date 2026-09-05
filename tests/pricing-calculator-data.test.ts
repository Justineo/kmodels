import { describe, expect, it } from "vite-plus/test";
import {
  calculationExport,
  calculationExportAssets,
} from "../src/catalog/pricing-calculator-export.ts";
import { calculationCoverage } from "../src/catalog/pricing-calculation-coverage.ts";
import {
  validatePriceData,
  type CalculationEnvelope,
  type CalculationOffer,
  type CalculationRate,
  type CalculationTerm,
} from "../src/pricing/index.ts";
import type {
  PriceRateVariant,
  PricingBook,
  PricingOffer,
  PricingTerm,
} from "../src/catalog/pricing-schema.ts";
import {
  evaluateChargeQuantity,
  requiredUsageSignals,
  type QuantityBinding,
} from "../src/catalog/pricing-calculation.ts";
import { generatedData } from "./generated-data-context.ts";

describe("calculation exports", () => {
  it("validates complete provider partitions and preserves all commercial components", async () => {
    const { catalog, pricing } = await generatedData();
    for (const snapshot of pricing.data.provider_snapshots) {
      const envelope = validatePriceData(
        calculationExport(catalog, pricing, [snapshot.provider_id]),
      );
      const provider = envelope.providers[0];
      if (provider === undefined) throw new Error("Missing exported provider");
      expect(provider.snapshot).toEqual(snapshot);
      const canonicalBooks = pricing.data.books.filter(
        (book) => book.provider_id === snapshot.provider_id,
      );
      expect(provider.books.map((book) => book.id)).toEqual(canonicalBooks.map((book) => book.id));
      expectExportedOffers(
        provider.books.flatMap((book) => book.offers),
        canonicalBooks,
      );
      expectCoverageMatchesTerms(envelope, canonicalBooks);
      expectObservationFragmentsOmitted(envelope);
    }
  }, 90_000);
  it("rejects empty, duplicated and unknown provider selections", async () => {
    const { catalog, pricing } = await generatedData();
    const providerId = pricing.data.provider_snapshots[0]?.provider_id;
    if (providerId === undefined) throw new Error("Missing provider snapshot");
    for (const selection of [[], [providerId, providerId], ["example/missing"]]) {
      expect(() => calculationExport(catalog, pricing, selection)).toThrow(
        "complete provider partitions",
      );
    }
  });
  it("publishes the index, coverage and per-provider calculation assets", async () => {
    const { catalog, pricing } = await generatedData();
    const fileNames = calculationExportAssets(catalog, pricing).map(({ fileName }) => fileName);
    expect(fileNames).toEqual([
      "pricing/calculation/index.json",
      "pricing/calculation/coverage.json",
      ...pricing.data.provider_snapshots.map(
        ({ provider_id }) => `pricing/calculation/providers/${provider_id}.json`,
      ),
    ]);
  }, 90_000);
});

function expectExportedOffers(
  exportedOffers: CalculationOffer[],
  canonicalBooks: PricingBook[],
): void {
  const offersById = new Map(exportedOffers.map((offer) => [offer.id, offer]));
  for (const book of canonicalBooks) {
    for (const canonicalOffer of book.offers) {
      const exported = offersById.get(canonicalOffer.id);
      if (exported === undefined) throw new Error("Missing exported offer");
      expectOfferMatchesCanonical(exported, canonicalOffer);
    }
  }
}

function expectOfferMatchesCanonical(exported: CalculationOffer, canonical: PricingOffer): void {
  expect(exported.enrollment.map(({ evidence: _evidence, ...value }) => value)).toEqual(
    canonical.enrollment.map(({ observations: _observations, ...value }) => value),
  );
  expect(exported.settlement.map(({ evidence: _evidence, ...value }) => value)).toEqual(
    canonical.settlement.map(({ observations: _observations, ...value }) => value),
  );
  expect(exported.terms.map((term) => term.id)).toEqual(canonical.terms.map((term) => term.id));
  for (const canonicalTerm of canonical.terms) {
    const exportedTerm = exported.terms.find((term) => term.id === canonicalTerm.id);
    if (exportedTerm === undefined) throw new Error("Missing exported term");
    expectTermMatchesCanonical(exportedTerm, canonicalTerm);
  }
}

function expectTermMatchesCanonical(exported: CalculationTerm, canonical: PricingTerm): void {
  expect(exported.kind).toBe(canonical.kind);
  expect(exported.variants.length).toBe(canonical.variants.length);
  if (canonical.kind === "allowance" && exported.kind === "allowance") {
    expect(
      exported.variants.map(({ benefit, target, reset }) => ({ benefit, target, reset })),
    ).toEqual(canonical.variants.map(({ benefit, target, reset }) => ({ benefit, target, reset })));
  }
  if (canonical.kind === "contribution" && exported.kind === "contribution") {
    expect(exported.variants.map((variant) => variant.target_rate_refs)).toEqual(
      canonical.variants.map((variant) => variant.target_rate_refs),
    );
  }
  if (canonical.kind !== "rate" || exported.kind !== "rate") return;
  for (const [index, canonicalRate] of canonical.variants.entries()) {
    const exportedRate = exported.variants[index];
    if (exportedRate === undefined) throw new Error("Missing exported variant");
    expectRateMatchesCanonical(exportedRate, canonicalRate);
  }
}

function expectRateMatchesCanonical(exported: CalculationRate, canonical: PriceRateVariant): void {
  expect(exported.price).toEqual(canonical.price);
  expect(exported.applicability).toEqual(canonical.applicability);
  expect(exported.validity).toEqual(canonical.validity);
  if (canonical.charge_binding === undefined) return;
  if (exported.charge_binding === undefined) throw new Error("Missing exported binding");
  const { observations: _observations, ...canonicalBinding } = canonical.charge_binding;
  const { evidence: _evidence, ...exportedBinding } = exported.charge_binding;
  expect(exportedBinding).toEqual(canonicalBinding);
  expect(quantityEvaluationOrError(exported.charge_binding)).toEqual(
    quantityEvaluationOrError(canonical.charge_binding),
  );
}

function expectCoverageMatchesTerms(
  envelope: CalculationEnvelope,
  canonicalBooks: PricingBook[],
): void {
  const coverage = calculationCoverage(envelope).providers[0];
  const termCount = canonicalBooks
    .flatMap((book) => book.offers)
    .reduce((count, offer) => count + offer.terms.length, 0);
  expect(coverage?.components.length).toBe(termCount);
}

function expectObservationFragmentsOmitted(envelope: CalculationEnvelope): void {
  const serialized = JSON.stringify(envelope);
  expect(serialized).not.toContain('"observations":');
  expect(serialized).not.toContain('"raw":');
  expect(serialized).not.toContain('"fragment":');
}

function quantityEvaluationOrError(binding: QuantityBinding): unknown {
  const quantities = requiredUsageSignals(binding).map((signal) => ({
    signal,
    value: { numerator: "1", denominator: "1" },
  }));
  try {
    return evaluateChargeQuantity(binding, quantities);
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return { error: error.message };
  }
}
