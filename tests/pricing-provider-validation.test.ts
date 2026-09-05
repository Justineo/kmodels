import { describe, expect, it } from "vite-plus/test";
import { manifests } from "../src/catalog/manifests.ts";
import {
  compilePricingSnapshot,
  readPricingCompilationSnapshot,
} from "../src/catalog/pricing-compilation.ts";
import {
  adoptedTopologies,
  validateAdoptedTopology,
} from "../src/catalog/pricing-adopted-topology.ts";
import { validatePricingCatalogEnvelopeMetadata } from "../src/catalog/pricing-envelope.ts";
import { prepareCatalogPair } from "../src/catalog/pricing-publication.ts";
import { providerPartition } from "../src/catalog/pricing-transition.ts";
import { validatePricingCatalogInParallel } from "../src/catalog/pricing-validation-parallel.ts";
import { generatedData } from "./generated-data-context.ts";

describe("provider pricing validation", () => {
  it("validates every committed provider pricing partition", async () => {
    const { catalog, pricing, pricingDataHash } = await generatedData();

    expect(() =>
      validatePricingCatalogEnvelopeMetadata(pricing, catalog, pricingDataHash),
    ).not.toThrow();
    await expect(validatePricingCatalogInParallel(pricing.data, catalog)).resolves.toBeUndefined();
  }, 90_000);

  it("keeps the adopted commercial topology for every provider", async () => {
    const { catalog, pricing } = await generatedData();
    const modelProviders = new Map(
      catalog.models.map(({ uid, provider_id }) => [uid, provider_id]),
    );
    const modelProvider = (modelRef: string): string => {
      const providerId = modelProviders.get(modelRef);
      if (providerId === undefined) throw new Error(`Pricing model ref is unresolved: ${modelRef}`);
      return providerId;
    };

    const providerIds = pricing.data.provider_snapshots.map(({ provider_id }) => provider_id);
    expect(providerIds).toEqual([...adoptedTopologies.keys()]);
    for (const providerId of providerIds) {
      const partition = providerPartition(pricing.data, providerId, modelProvider);
      if (partition === undefined)
        throw new Error(`Provider ${providerId} has no pricing partition`);
      validateAdoptedTopology(partition);
    }
  });

  it("replays current extractor inputs and preserves obsolete captured partitions", async () => {
    const { catalog, pricing } = await generatedData();
    const current = prepareCatalogPair(catalog, pricing);
    const snapshot = await readPricingCompilationSnapshot(current);
    if (snapshot === undefined) throw new Error("Pricing replay input is missing");

    const compiled = await compilePricingSnapshot(current, snapshot);
    for (const captured of snapshot.providers) {
      const manifest = manifests.find(({ provider }) => provider.id === captured.provider_id);
      if (manifest === undefined) throw new Error(`Missing manifest for ${captured.provider_id}`);
      const obsolete = captured.sources.some((source) => {
        const configured = manifest.sources.find(({ id }) => id === source.source_id);
        return configured !== undefined && configured.extractorVersion !== source.extractor_version;
      });
      expect(compiled.preservedProviders.includes(captured.provider_id), captured.provider_id).toBe(
        obsolete,
      );
      expect(compiled.replayedProviders.includes(captured.provider_id), captured.provider_id).toBe(
        !obsolete,
      );
    }
    expect([...compiled.replayedProviders, ...compiled.preservedProviders].sort()).toEqual(
      pricing.data.provider_snapshots.map(({ provider_id }) => provider_id).sort(),
    );
    const modelProviders = new Map(
      catalog.models.map(({ uid, provider_id }) => [uid, provider_id]),
    );
    const modelProvider = (ref: string): string => {
      const providerId = modelProviders.get(ref);
      if (providerId === undefined) throw new Error(`Unresolved model ${ref}`);
      return providerId;
    };
    for (const providerId of compiled.preservedProviders)
      expect(providerPartition(compiled.candidate.pricing.data, providerId, modelProvider)).toEqual(
        providerPartition(pricing.data, providerId, modelProvider),
      );
  }, 300_000);
});
