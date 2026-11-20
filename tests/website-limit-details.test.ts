import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { gunzipSync } from "node:zlib";
import { compressedAsset } from "../src/catalog/asset-pack.ts";
import { catalogJson } from "../src/catalog/endpoints.ts";
import { baseModel } from "../src/catalog/model.ts";
import type { CapabilityDetailGroup } from "../src/catalog/model-capability-details.ts";
import type { LimitDetailGroup } from "../src/catalog/model-limit-details.ts";
import { emptyPricingCatalog } from "../src/catalog/pricing-schema.ts";
import {
  hasScopedLimitDetails,
  projectCatalogPair,
  websiteDataVersion,
  websiteDataVersionForCatalog,
} from "../src/catalog/projections.ts";
import {
  createPricingCatalogEnvelope,
  pricingCatalogJson,
} from "../src/catalog/pricing-envelope.ts";
import { sha256, stableJson } from "../src/catalog/io.ts";
import { catalogSchema } from "../src/catalog/schema.ts";
import { websitePublication } from "../src/catalog/website-data.ts";
import { loadWebsiteModelDetail } from "../src/catalog/website-loader.ts";
import { websiteDetailChunkSchema, type WebsiteModel } from "../src/catalog/website-schema.ts";
import { foundAuditFields } from "./website-audit-fields.ts";

const at = "2026-11-17T00:00:00.000Z";
const group: LimitDetailGroup = {
  source_ref: "example-models",
  claim: "long_decode",
  statements: [
    {
      quantity: "output_tokens",
      kind: "default",
      tokens: 65536,
      measurement: "per_interaction",
      scope:
        "Interactions API; generated thinking and output when no explicit output budget is supplied.",
    },
  ],
  evidence: [
    {
      document_url: "https://example.com/limits",
      locator: "Long decode",
      observed_at: at,
      content_hash: "a".repeat(64),
      excerpt: "The default generated-token budget is 65,536.",
    },
  ],
};
const model: WebsiteModel = {
  provider_id: "example",
  model_id: "model",
  name: "Model",
  uid: "example/model",
  aliases: [],
  tasks: [],
  status: "active",
  release_stage: "stable",
  detail_chunk: 0,
  pricing: { outcome: "unknown" },
};
/** Website chunks cite sources; excerpts and document hashes stay in canonical storage. */
function sourced<Group extends LimitDetailGroup | CapabilityDetailGroup>(value: Group) {
  return {
    ...value,
    evidence: value.evidence.map(({ document_url, locator, observed_at }) => ({
      document_url,
      locator,
      observed_at,
    })),
  };
}
function catalog(details?: LimitDetailGroup[], capabilityDetails?: CapabilityDetailGroup[]) {
  const ids =
    capabilityDetails === undefined ? ["example", "other"] : ["example", "limited", "other"];
  return catalogSchema.parse({
    catalog_version: "a".repeat(64),
    generated_at: at,
    warnings: [],
    coverage: ids.map((provider_id) => ({
      provider_id,
      status: "fresh",
      model_count: 1,
      pricing_term_count: 0,
      checked_at: at,
      last_successful_sync_at: at,
    })),
    sources: ids.map((id) => ({
      id: `${id}-models`,
      provider_id: id,
      url: `https://${id}.com/limits`,
      source: ["website"],
      stability: "documented",
      field_paths: ["limit_details", "capability_details"],
      observed_at: at,
      content_hash: "a".repeat(64),
      extractor_version: "1",
    })),
    providers: ids.map((id) => ({
      id,
      name: id,
      kind: "hosted",
      homepage: `https://${id}.com`,
      catalog_scope: "global",
      source_ids: [`${id}-models`],
    })),
    models: ids.map((id) => ({
      ...baseModel({
        providerId: id,
        id: "model",
        name: "Model",
        sourceId: `${id}-models`,
        observedAt: at,
      }),
      ...(id === "example" && details !== undefined ? { limit_details: details } : {}),
      ...(id === "example" && capabilityDetails !== undefined
        ? { capability_details: capabilityDetails }
        : {}),
      ...(id === "limited" ? { limit_details: [{ ...group, source_ref: "limited-models" }] } : {}),
    })),
  });
}
function chunks(details: LimitDetailGroup[] | undefined, version: string) {
  return websitePublication(catalog(details), emptyPricingCatalog(), version).details;
}
function chunk(details: LimitDetailGroup[] | undefined, version: string) {
  const result = chunks(details, version)[0];
  if (result === undefined) throw new Error("Missing model chunk");
  return result;
}
afterEach(() => vi.unstubAllGlobals());

describe("versioned scoped limit website details", () => {
  it("projects and loads a mixed v11 and v7 publication under the capability cache salt", async () => {
    const capability: CapabilityDetailGroup = {
      source_ref: group.source_ref,
      claim: "interactions_cache",
      evidence: group.evidence,
      statements: [{ kind: "prompt_cache", mode: "implicit", scope: "Interactions API" }],
    };
    const input: unknown = JSON.parse(stableJson(catalog([group], [capability])));
    const core = catalogSchema.parse(input);
    const pricing = createPricingCatalogEnvelope(emptyPricingCatalog(), core);
    const dataVersion = websiteDataVersionForCatalog(core, pricing.pricing_data_version);
    expect(dataVersion).not.toBe(
      websiteDataVersion(core.catalog_version, pricing.pricing_data_version, undefined, true),
    );
    const result = await projectCatalogPair({
      pairId: "1".repeat(64),
      catalog: core,
      pricing,
      catalogAssetSource: catalogJson(core),
      pricingAssetChunks: [pricingCatalogJson(pricing, core)],
    });
    expect(result.ui.manifest.data_version).toBe(dataVersion);
    function packedChunk(provider: string) {
      const name = `ui/details/${provider}/0.json`;
      const entry = result.ui.manifest.assets.find(({ file_name }) => file_name === name);
      if (entry === undefined) throw new Error(`Missing projected asset ${name}`);
      return gunzipSync(compressedAsset(result.ui.pack, entry)).toString("utf8");
    }
    const versions = ["example", "limited", "other"].map((provider) =>
      websiteDetailChunkSchema.parse(JSON.parse(packedChunk(provider))),
    );
    expect(versions.map(({ schema_version }) => schema_version)).toEqual([11, 11, 7]);
    const details = versions.flatMap((chunk) => chunk.details);
    expect(foundAuditFields(details, "model-details")).toEqual([]);
    expect(() => websiteDetailChunkSchema.parse({ ...versions[0], schema_version: 8 })).toThrow();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const provider = new URL(url, "https://example.com").pathname.split("/")[3];
        if (provider === undefined) throw new Error("Missing provider in details URL");
        return new Response(packedChunk(provider));
      }),
    );
    expect(await loadWebsiteModelDetail(dataVersion, model)).toMatchObject({
      limit_details: [sourced(group)],
      capability_details: [sourced(capability)],
    });
    const limited = await loadWebsiteModelDetail(dataVersion, {
      ...model,
      provider_id: "limited",
      uid: "limited/model",
    });
    expect(limited).toHaveProperty("limit_details");
    expect(limited).not.toHaveProperty("capability_details");
    const other = await loadWebsiteModelDetail(dataVersion, {
      ...model,
      provider_id: "other",
      uid: "other/model",
    });
    expect(other).not.toHaveProperty("limit_details");
    expect(other).not.toHaveProperty("capability_details");
    const withdrawn = catalog([group], [{ ...capability, statements: [] }]);
    expect(websiteDataVersionForCatalog(withdrawn, pricing.pricing_data_version)).toBe(
      websiteDataVersion(core.catalog_version, pricing.pricing_data_version, undefined, true),
    );
  });
  it("flags pricing locators and raw fields alongside allowed model-claim locators", () => {
    const claims = { limit_details: [sourced(group)] };
    expect(foundAuditFields([claims])).toEqual(["locator"]);
    expect(foundAuditFields([{ ...claims, pricing: claims }], "model-details")).toEqual([
      "locator",
    ]);
    const groupWithRawEvidence = {
      ...sourced(group),
      evidence: sourced(group).evidence.map((revision) => ({
        ...revision,
        raw: "source fragment",
      })),
    };
    expect(foundAuditFields([{ limit_details: [groupWithRawEvidence] }], "model-details")).toEqual([
      "raw",
    ]);
    expect(foundAuditFields([{ limit_details: [group] }], "model-details")).toEqual([
      "content_hash",
      "excerpt",
    ]);
  });
  it("carries reviewed applicability through v11 while reading accepted v9 and v10 chunks", async () => {
    const statement = {
      kind: "reasoning_effort",
      scope: "Interactions API, beta enabled (config.level).",
      default_value: "deep",
    } as const;
    const capability: CapabilityDetailGroup = {
      source_ref: group.source_ref,
      claim: "interactions_effort",
      evidence: group.evidence,
      statements: [statement],
    };
    const structured: CapabilityDetailGroup = {
      ...capability,
      statements: [
        {
          ...statement,
          applicability: {
            interface: "Interactions API",
            parameter: "config.level",
            condition: "Beta enabled",
          },
        },
      ],
    };
    const legacy = catalog([group], [capability]);
    const current = catalog([group], [structured, { ...capability, claim: "legacy" }]);
    const pricing = emptyPricingCatalog();
    const legacyVersion = websiteDataVersionForCatalog(legacy, "b".repeat(64));
    const version = websiteDataVersionForCatalog(current, "b".repeat(64));
    expect(version).not.toBe(legacyVersion);
    const [legacyChunk] = websitePublication(legacy, pricing, legacyVersion).details;
    const [currentChunk] = websitePublication(current, pricing, version).details;
    if (legacyChunk === undefined || currentChunk === undefined)
      throw new Error("Missing model detail chunk");
    expect(legacyChunk.schema_version).toBe(11);
    expect(currentChunk.schema_version).toBe(11);
    expect(foundAuditFields(currentChunk.details, "model-details")).toEqual([]);
    // Slim sources do not satisfy the accepted v10 evidence contract.
    expect(() => websiteDetailChunkSchema.parse({ ...currentChunk, schema_version: 10 })).toThrow();
    const acceptedDetails = (capabilityDetails: CapabilityDetailGroup[]) =>
      legacyChunk.details.map((detail) => ({
        ...detail,
        limit_details: [group],
        capability_details: capabilityDetails,
      }));
    const acceptedV9 = websiteDetailChunkSchema.parse({
      ...legacyChunk,
      schema_version: 9,
      details: acceptedDetails([capability]),
    });
    expect(() =>
      websiteDetailChunkSchema.parse({ ...acceptedV9, details: acceptedDetails([structured]) }),
    ).toThrow();
    expect(
      websiteDetailChunkSchema.parse({
        ...acceptedV9,
        schema_version: 10,
        details: acceptedDetails([structured]),
      }).schema_version,
    ).toBe(10);
    const fetcher = vi.fn(
      async (input: string) =>
        new Response(stableJson(input.includes(legacyVersion) ? acceptedV9 : currentChunk)),
    );
    vi.stubGlobal("fetch", fetcher);
    expect((await loadWebsiteModelDetail(legacyVersion, model)).capability_details).toEqual([
      capability,
    ]);
    expect((await loadWebsiteModelDetail(version, model)).capability_details).toEqual([
      sourced(structured),
      sourced({ ...capability, claim: "legacy" }),
    ]);
    expect((await loadWebsiteModelDetail(legacyVersion, model)).capability_details).toEqual([
      capability,
    ]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("projects real statement-bearing assets under the conditional v11 cache identity", async () => {
    const coreInput: unknown = JSON.parse(stableJson(catalog([group])));
    const core = catalogSchema.parse(coreInput);
    const pricing = createPricingCatalogEnvelope(emptyPricingCatalog(), core);
    const result = await projectCatalogPair({
      pairId: "1".repeat(64),
      catalog: core,
      pricing,
      catalogAssetSource: catalogJson(core),
      pricingAssetChunks: [pricingCatalogJson(pricing, core)],
    });
    expect(hasScopedLimitDetails(core)).toBe(true);
    expect(hasScopedLimitDetails(catalog([{ ...group, statements: [] }]))).toBe(false);
    expect(result.ui.manifest.data_version).toBe(
      websiteDataVersion(core.catalog_version, pricing.pricing_data_version, undefined, true),
    );
    expect(result.ui.manifest.data_version).not.toBe(
      websiteDataVersion(core.catalog_version, pricing.pricing_data_version),
    );
    const entry = result.ui.manifest.assets.find(
      ({ file_name }) => file_name === "ui/details/example/0.json",
    );
    if (entry === undefined) throw new Error("Missing projected detail asset");
    const input: unknown = JSON.parse(
      gunzipSync(compressedAsset(result.ui.pack, entry)).toString("utf8"),
    );
    const parsed = websiteDetailChunkSchema.parse(input);
    expect(parsed.schema_version).toBe(11);
    expect(parsed.details[0]).toMatchObject({ limit_details: [sourced(group)] });
  });
  it("keeps exact no-detail v7 output and emits v11 only for statement-bearing chunks", () => {
    const version = "b".repeat(64);
    const legacy = chunk(undefined, version);
    expect(legacy.schema_version).toBe(7);
    expect(legacy.details[0]).not.toHaveProperty("limit_details");
    expect(stableJson(chunk([{ ...group, statements: [] }], version))).toBe(stableJson(legacy));
    const current = chunks([group], version);
    expect(current.map(({ schema_version }) => schema_version)).toEqual([11, 7]);
    expect(current[0]?.details[0]).toMatchObject({ limit_details: [sourced(group)] });
    expect(current[1]).toEqual(chunks(undefined, version)[1]);
  });

  it("uses an explicit conditional wire/cache salt even when canonical version strings stay fixed", () => {
    const core = "a".repeat(64),
      prices = "b".repeat(64);
    const legacy = websiteDataVersion(core, prices);
    expect(legacy).toBe(sha256(`website-core-v7\u0000${core}\u0000${prices}`));
    expect(websiteDataVersion(core, prices, undefined, false)).toBe(legacy);
    expect(websiteDataVersion(core, prices, undefined, true)).not.toBe(legacy);
    expect(websiteDataVersion(core, prices, "inference", true)).not.toBe(
      websiteDataVersion(core, prices, "inference"),
    );
  });

  it("keeps v7 closed while explicitly accepting v11, rejecting unknown versions and new unknown fields", () => {
    const current = chunk([group], "c".repeat(64));
    expect(websiteDetailChunkSchema.parse(current)).toEqual(current);
    expect(() => websiteDetailChunkSchema.parse({ ...current, schema_version: 7 })).toThrow();
    expect(() => websiteDetailChunkSchema.parse({ ...current, schema_version: 12 })).toThrow();
    expect(() => websiteDetailChunkSchema.parse({ ...current, extra: true })).toThrow();
    expect(() =>
      websiteDetailChunkSchema.parse({
        ...current,
        details: current.details.map((detail) => ({ ...detail, arbitrary: true })),
      }),
    ).toThrow();
  });

  it("loads unchanged v7 and qualified v11 without serving an older cached model detail", async () => {
    const oldVersion = "d".repeat(64),
      newVersion = "e".repeat(64);
    const fetcher = vi.fn(
      async (input: string) =>
        new Response(
          stableJson(
            chunk(
              input.includes(oldVersion) ? undefined : [group],
              input.includes(oldVersion) ? oldVersion : newVersion,
            ),
          ),
        ),
    );
    vi.stubGlobal("fetch", fetcher);
    const previous = await loadWebsiteModelDetail(oldVersion, model);
    expect(previous).not.toHaveProperty("limit_details");
    const current = await loadWebsiteModelDetail(newVersion, model);
    expect(current.limit_details).toEqual([sourced(group)]);
    expect(await loadWebsiteModelDetail(oldVersion, model)).toEqual(previous);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each(["data_version", "provider_id", "chunk", "schema_version"])(
    "rejects mismatched %s before caching details",
    async (field) => {
      const version = sha256(`scoped-wire-${field}`);
      const original = chunk([group], version);
      const invalid = {
        ...original,
        [field]:
          field === "data_version"
            ? "0".repeat(64)
            : field === "provider_id"
              ? "other"
              : field === "chunk"
                ? 1
                : 12,
      };
      const fetcher = vi
        .fn()
        .mockResolvedValueOnce(new Response(stableJson(invalid)))
        .mockResolvedValueOnce(new Response(stableJson(original)));
      vi.stubGlobal("fetch", fetcher);
      await expect(loadWebsiteModelDetail(version, model)).rejects.toThrow();
      expect((await loadWebsiteModelDetail(version, model)).limit_details).toEqual([
        sourced(group),
      ]);
      expect(fetcher).toHaveBeenCalledTimes(2);
    },
  );

  it("loads an intentional same-publication mixture of explicit v7 and v11 provider chunks", async () => {
    const version = "f".repeat(64);
    const values = chunks([group], version);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (url: string) => new Response(stableJson(values[url.includes("/other/") ? 1 : 0])),
      ),
    );
    expect((await loadWebsiteModelDetail(version, model)).limit_details).toEqual([sourced(group)]);
    expect(
      await loadWebsiteModelDetail(version, { ...model, provider_id: "other", uid: "other/model" }),
    ).not.toHaveProperty("limit_details");
  });
});
