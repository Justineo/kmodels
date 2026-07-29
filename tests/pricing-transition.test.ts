import { describe, expect, it } from "vite-plus/test";
import type { ProviderPricingPartition } from "../src/catalog/pricing-assembly.ts";
import type { PricingCatalog } from "../src/catalog/pricing-schema.ts";
import {
  failedPricingTransition,
  providerPartition,
  transitionProviderPricing,
} from "../src/catalog/pricing-transition.ts";

const providerId = "test";
const modelProvider = (modelRef: string) => modelRef.split("/")[0] ?? "";

function partition(publication: "fresh" | "retained", observed = "2026-07-28T00:00:00.000Z") {
  return {
    vocabulary: { provider_id: providerId, atoms: [] },
    snapshot:
      publication === "fresh"
        ? {
            provider_id: providerId,
            observed_at: observed,
            publication,
          }
        : {
            provider_id: providerId,
            observed_at: observed,
            publication,
            refresh_failure: {
              attempted_at: "2026-07-28T00:00:00.000Z",
              code: "provider_refresh_failed",
            },
          },
    model_dispositions: [
      {
        model_ref: "test/model",
        state: "not_applicable",
        observations: [
          {
            source_ref: "pricing",
            locator: { kind: "table", value: "model" },
            establishes_model_ref: "test/model",
            raw: { label: "Not offered" },
          },
        ],
      },
    ],
    books: [],
  } satisfies ProviderPricingPartition;
}

function catalog(value?: ProviderPricingPartition): PricingCatalog {
  return {
    provider_vocabularies: value === undefined ? [] : [value.vocabulary],
    provider_snapshots: value === undefined ? [] : [value.snapshot],
    model_dispositions: value?.model_dispositions ?? [],
    books: value?.books ?? [],
  };
}

describe("provider pricing transitions", () => {
  it("retains only an immediate prior pricing partition after failure", () => {
    const prior = partition("fresh", "2026-07-27T00:00:00.000Z");
    const retained = transitionProviderPricing(
      catalog(prior),
      failedPricingTransition(providerId, "2026-07-28T00:00:00.000Z", "source_schema_changed"),
      modelProvider,
    );
    expect(providerPartition(retained, providerId, modelProvider)?.snapshot).toEqual({
      provider_id: providerId,
      observed_at: prior.snapshot.observed_at,
      publication: "retained",
      refresh_failure: {
        attempted_at: "2026-07-28T00:00:00.000Z",
        code: "source_schema_changed",
      },
    });
    expect(
      transitionProviderPricing(
        catalog(),
        failedPricingTransition(providerId, "2026-07-28T00:00:00.000Z", "provider_refresh_failed"),
        modelProvider,
      ),
    ).toEqual(catalog());
  });

  it("advances a fresh partition without rewriting its observation time", () => {
    const fresh = partition("fresh");
    const result = transitionProviderPricing(
      catalog(partition("retained", "2026-07-27T00:00:00.000Z")),
      { kind: "fresh", partition: fresh },
      modelProvider,
    );
    expect(providerPartition(result, providerId, modelProvider)).toEqual(fresh);
    expect(() =>
      transitionProviderPricing(
        catalog(),
        { kind: "fresh", partition: partition("retained") },
        modelProvider,
      ),
    ).toThrow("must carry a fresh");
  });

  it.each(["fresh_empty", "withdraw_pricing", "remove_provider"] as const)(
    "removes the complete pricing partition for %s",
    (kind) => {
      const result = transitionProviderPricing(
        catalog(partition("fresh")),
        { kind, provider_id: providerId },
        modelProvider,
      );
      expect(providerPartition(result, providerId, modelProvider)).toBeUndefined();
      expect(result).toEqual(catalog());
    },
  );
});
