import { describe, expect, it } from "vite-plus/test";
import { priceDataExport, priceDataExportAssets } from "../src/catalog/pricing-lookup-export.ts";
import { priceDataCoverage } from "../src/catalog/pricing-coverage.ts";
import { providerPricingFreshnessSchema } from "../src/catalog/pricing-schema.ts";
import { capturePricingSourceRecords } from "../src/catalog/pricing-source-records.ts";
import { providerPartition } from "../src/catalog/pricing-transition.ts";
import {
  validatePriceData,
  type PriceDataEnvelope,
  type PriceDataOffer,
  type PriceDataRate,
  type PriceDataTerm,
} from "../src/pricing/index.ts";
import type {
  PriceRateVariant,
  PricingBook,
  PricingOffer,
  PricingTerm,
} from "../src/catalog/pricing-schema.ts";
import { generatedData } from "./generated-data-context.ts";
import {
  DEFAULT_CODEX_MODEL,
  calculateUsageCostUsd,
  loadOpenAIPricingLookup,
  resolveOpenAIRateBand,
} from "../scripts/self-heal/adapters/codex.ts";

describe("unit-price exports", () => {
  it("validates complete provider partitions and preserves all commercial components", async () => {
    const { catalog, pricing } = await generatedData();
    for (const snapshot of pricing.data.provider_snapshots) {
      const envelope = validatePriceData(priceDataExport(catalog, pricing, [snapshot.provider_id]));
      const provider = envelope.providers[0];
      if (provider === undefined) throw new Error("Missing exported provider");
      const { source_records: _sourceRecords, ...freshness } = snapshot;
      expect(provider.snapshot).toEqual(providerPricingFreshnessSchema.parse(freshness));
      if (snapshot.source_records !== undefined)
        expect(provider.sources).toEqual(snapshot.source_records);
      for (const source of provider.sources) expect(source.observed_at).toBe(snapshot.observed_at);
      const canonicalBooks = pricing.data.books.filter(
        (book) => book.provider_id === snapshot.provider_id,
      );
      expect(provider.books.map((book) => book.id)).toEqual(canonicalBooks.map((book) => book.id));
      expectExportedOffers(
        provider.applicabilities,
        provider.books.flatMap((book) => book.offers),
        canonicalBooks,
      );
      expectCoverageMatchesTerms(envelope, canonicalBooks);
      expectObservationFragmentsOmitted(envelope);
    }
  }, 90_000);
  it("exports captured historical revisions without changing prices or the portable snapshot shape", async () => {
    const { catalog, pricing } = await generatedData();
    const snapshot = pricing.data.provider_snapshots[0];
    if (snapshot === undefined) throw new Error("Missing price snapshot");
    const owners = new Map(catalog.models.map(({ uid, provider_id }) => [uid, provider_id]));
    const partition = providerPartition(pricing.data, snapshot.provider_id, (ref) => {
      const owner = owners.get(ref);
      if (owner === undefined) throw new Error(`Missing model ${ref}`);
      return owner;
    });
    if (partition === undefined) throw new Error("Missing price partition");
    const historical = "2026-07-28T00:00:00.000Z";
    const captured = capturePricingSourceRecords(
      {
        ...partition,
        snapshot: {
          provider_id: snapshot.provider_id,
          observed_at: historical,
          publication: "fresh",
        },
      },
      catalog.sources.map((source) => ({
        ...source,
        observed_at: historical,
        content_hash: "a".repeat(64),
        extractor_version: "historical-v1",
      })),
    );
    const exported = validatePriceData(
      priceDataExport(
        catalog,
        {
          ...pricing,
          data: {
            ...pricing.data,
            provider_snapshots: pricing.data.provider_snapshots.map((value) =>
              value.provider_id === snapshot.provider_id
                ? {
                    ...captured.snapshot,
                    publication: "retained",
                    refresh_failure: {
                      attempted_at: catalog.generated_at,
                      code: "source_unavailable",
                    },
                  }
                : value,
            ),
          },
        },
        [snapshot.provider_id],
      ),
    ).providers[0];
    const baseline = priceDataExport(catalog, pricing, [snapshot.provider_id]).providers[0];
    expect(exported?.sources).toEqual(captured.snapshot.source_records);
    expect(exported?.snapshot).not.toHaveProperty("source_records");
    expect(exported?.snapshot).toMatchObject({ publication: "retained", observed_at: historical });
    expect(exported?.books).toEqual(baseline?.books);
    expect(exported?.models).toEqual(baseline?.models);
  }, 90_000);
  it("rejects empty, duplicated and unknown provider selections", async () => {
    const { catalog, pricing } = await generatedData();
    const providerId = pricing.data.provider_snapshots[0]?.provider_id;
    if (providerId === undefined) throw new Error("Missing provider snapshot");
    for (const selection of [[], [providerId, providerId], ["example/missing"]]) {
      expect(() => priceDataExport(catalog, pricing, selection)).toThrow(
        "complete provider partitions",
      );
    }
  });
  it("publishes the index, coverage and per-provider unit-price assets", async () => {
    const { catalog, pricing } = await generatedData();
    const fileNames = priceDataExportAssets(
      validatePriceData(priceDataExport(catalog, pricing)),
    ).map(({ fileName }) => fileName);
    expect(fileNames).toEqual([
      "pricing/lookup/index.json",
      "pricing/lookup/coverage.json",
      ...pricing.data.provider_snapshots.map(
        ({ provider_id }) => `pricing/lookup/providers/${provider_id}.json`,
      ),
    ]);
  }, 90_000);

  it("resolves live self-heal Codex adapter OpenAI rates directly from published export assets", async () => {
    const lookup = await loadOpenAIPricingLookup();
    // Structural check only (no hardcoded dollar constants) so legitimate OpenAI price updates
    // never block catalog publication; exact dollar arithmetic is covered by synthetic unit tests.
    const band = resolveOpenAIRateBand(DEFAULT_CODEX_MODEL, 10_000, lookup);
    expect(band.input.numerator > 0n).toBe(true);
    expect(band.output.numerator > 0n).toBe(true);
    expect(band.cacheRead.numerator >= 0n).toBe(true);

    const expectedMicroUsd =
      ((10_000n * band.input.numerator * band.output.denominator +
        1_000n * band.output.numerator * band.input.denominator) *
        2_000_000n +
        band.input.denominator * band.output.denominator) /
      (band.input.denominator * band.output.denominator * 2n);
    const expectedUsd = Number(expectedMicroUsd) / 1_000_000;
    expect(
      calculateUsageCostUsd(
        DEFAULT_CODEX_MODEL,
        {
          input_tokens: 10_000,
          output_tokens: 1_000,
          total_tokens: 11_000,
          input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
        },
        lookup,
      ),
    ).toBe(expectedUsd);

    // Synthetic unrecognized and synthetic dated IDs must fail closed rather than borrowing base rates
    // (never assert against real dated OpenAI IDs that future catalog refreshes may legitimately add).
    expect(() => resolveOpenAIRateBand("gpt-9-custom", 10_000, lookup)).toThrow(
      /Unsupported SELF_HEAL_MODEL/,
    );
    expect(() =>
      resolveOpenAIRateBand(`${DEFAULT_CODEX_MODEL}-1999-01-01`, 10_000, lookup),
    ).toThrow(/Unsupported SELF_HEAL_MODEL/);
  });
});

function expectExportedOffers(
  applicabilities: PriceDataEnvelope["providers"][number]["applicabilities"],
  exportedOffers: PriceDataOffer[],
  canonicalBooks: PricingBook[],
): void {
  const offersById = new Map(exportedOffers.map((offer) => [offer.id, offer]));
  for (const book of canonicalBooks) {
    for (const canonicalOffer of book.offers) {
      const exported = offersById.get(canonicalOffer.id);
      if (exported === undefined) throw new Error("Missing exported offer");
      expectOfferMatchesCanonical(applicabilities, exported, canonicalOffer);
    }
  }
}

function expectOfferMatchesCanonical(
  applicabilities: PriceDataEnvelope["providers"][number]["applicabilities"],
  exported: PriceDataOffer,
  canonical: PricingOffer,
): void {
  expect(exported.terms.map((term) => term.id)).toEqual(canonical.terms.map((term) => term.id));
  for (const canonicalTerm of canonical.terms) {
    const exportedTerm = exported.terms.find((term) => term.id === canonicalTerm.id);
    if (exportedTerm === undefined) throw new Error("Missing exported term");
    expectTermMatchesCanonical(applicabilities, exportedTerm, canonicalTerm);
  }
}

function expectTermMatchesCanonical(
  applicabilities: PriceDataEnvelope["providers"][number]["applicabilities"],
  exported: PriceDataTerm,
  canonical: PricingTerm,
): void {
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
    expectRateMatchesCanonical(applicabilities, exportedRate, canonicalRate);
  }
}

function expectRateMatchesCanonical(
  applicabilities: PriceDataEnvelope["providers"][number]["applicabilities"],
  exported: PriceDataRate,
  canonical: PriceRateVariant,
): void {
  expect(exported.price).toEqual(canonical.price);
  expect(applicabilities[exported.applicability_id]).toEqual(canonical.applicability);
  expect(exported.validity).toEqual(canonical.validity);
}

function expectCoverageMatchesTerms(
  envelope: PriceDataEnvelope,
  canonicalBooks: PricingBook[],
): void {
  const coverage = priceDataCoverage(envelope).providers[0];
  const termCount = canonicalBooks
    .flatMap((book) => book.offers)
    .reduce((count, offer) => count + offer.terms.length, 0);
  expect(coverage?.components.length).toBe(termCount);
}

function expectObservationFragmentsOmitted(envelope: PriceDataEnvelope): void {
  const serialized = JSON.stringify(envelope);
  expect(serialized).not.toContain('"observations":');
  expect(serialized).not.toContain('"raw":');
  expect(serialized).not.toContain('"fragment":');
}
