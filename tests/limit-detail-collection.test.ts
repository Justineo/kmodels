import { describe, expect, it, vi } from "vite-plus/test";
import { parseSource } from "../src/catalog/adapters.ts";
import { applyGroups, collectProvider, retainSourceFacts } from "../src/catalog/collector.ts";
import { fetchSource } from "../src/catalog/fetch.ts";
import { manifests, type ProviderManifest, type SourceManifest } from "../src/catalog/manifests.ts";
import { baseModel } from "../src/catalog/model.ts";
import type { LimitDetailGroup } from "../src/catalog/model-limit-details.ts";
import type { CapabilityDetailGroup } from "../src/catalog/model-capability-details.ts";
import { catalogSchema } from "../src/catalog/schema.ts";

vi.mock("../src/catalog/adapters.ts", () => ({ parseSource: vi.fn() }));
vi.mock("../src/catalog/fetch.ts", async (original) => ({
  ...(await original<typeof import("../src/catalog/fetch.ts")>()),
  fetchSource: vi.fn(),
}));

const before = "2026-11-16T00:00:00.000Z";
const now = "2026-11-17T00:00:00.000Z";
const configured: ProviderManifest | undefined = manifests.find(
  ({ provider }) => provider.id === "typesafe",
);
const originalSource = configured?.sources[0];
if (
  configured === undefined ||
  configured.notConfiguredReason !== undefined ||
  originalSource === undefined
)
  throw new Error("Missing test source");
const source: SourceManifest = {
  ...originalSource,
  fields: [...originalSource.fields, "limit_details", "capability_details"],
  allowedHosts: ["example.com"],
  retainOmittedFacts: true,
};
const manifest: ProviderManifest = { ...configured, sources: [source] };

function detail(claim: string, tokens = 200, sourceRef = source.id): LimitDetailGroup {
  return {
    source_ref: sourceRef,
    claim,
    statements: [
      {
        quantity: "output_tokens",
        kind: "maximum",
        tokens,
        measurement: "per_response",
        scope: claim,
      },
    ],
    evidence: [
      {
        document_url: "https://example.com/limits",
        locator: claim,
        observed_at: before,
        content_hash: "a".repeat(64),
        excerpt: `${tokens} tokens`,
      },
    ],
  };
}

function model(at = now, details?: LimitDetailGroup[]) {
  return {
    ...baseModel({
      providerId: manifest.provider.id,
      id: "example",
      name: "Example",
      sourceId: source.id,
      observedAt: at,
    }),
    ...(details === undefined ? {} : { limit_details: details }),
    limits: { context_tokens: 1000 },
  };
}

function cacheDetail(claim: string, supported = true): CapabilityDetailGroup {
  const { evidence, source_ref } = detail(claim);
  return {
    claim,
    source_ref,
    evidence,
    statements: [{ kind: "prompt_cache", mode: "implicit", supported, scope: "Interactions API" }],
  };
}

describe("claim-local limit detail collection", () => {
  it("retains only unobserved claims despite fresh identity, keeping original evidence clocks", () => {
    const old = model(before, [
      detail("card", 100),
      detail("batch", 300),
      detail("foreign", 999, "other-source"),
    ]);
    const current = model(now, [detail("card", 200)]);
    const result = retainSourceFacts([current], [old], source, new Set([current.uid]));
    expect(result.count).toBe(1);
    expect(result.models[0]?.limit_details).toEqual([detail("batch", 300), detail("card", 200)]);
    expect(result.models[0]?.observed_at).toBe(now);
    expect(result.models[0]?.limit_details?.[0]?.evidence[0]?.observed_at).toBe(before);
  });

  it("replaces exact source/claim groups atomically and preserves independent owners", () => {
    const current = model(before, [detail("card", 100), detail("card", 900, "other-source")]);
    const withdrawal = { ...detail("card"), statements: [] };
    const incoming = model(now, [withdrawal, detail("forged", 42, "other-source")]);
    const merged = applyGroups([current], [{ source, models: [incoming] }], false);
    expect(merged[0]?.limit_details).toEqual([detail("card", 900, "other-source"), withdrawal]);
    const retained = retainSourceFacts(merged, [current], source, new Set([current.uid]));
    expect(retained.count).toBe(0);
    expect(retained.models[0]?.limit_details).toEqual(merged[0]?.limit_details);
  });

  it("ignores undeclared detail fields on both newly created and merged models", () => {
    const undeclared = { ...source, fields: ["model_id" as const] };
    const incoming = model(now, [detail("card")]);
    expect(
      applyGroups([], [{ source: undeclared, models: [incoming] }], true)[0]?.limit_details,
    ).toBeUndefined();
    expect(
      applyGroups([model()], [{ source: undeclared, models: [incoming] }], false)[0]?.limit_details,
    ).toBeUndefined();
  });

  it.each([false, true])(
    "retains only missing claims through collection, whole-source retention=%s",
    async (retainWholeSource) => {
      const { retainOmittedFacts: _retention, ...withoutRetention } = source;
      const selectedSource = retainWholeSource ? source : withoutRetention;
      const selectedManifest: ProviderManifest = { ...manifest, sources: [selectedSource] };
      vi.mocked(fetchSource).mockResolvedValue({
        body: "fixture",
        contentHash: "b".repeat(64),
        etag: undefined,
        lastModified: undefined,
        dependencies: [],
      });
      vi.mocked(parseSource).mockReturnValue({
        models: [
          {
            ...model(before, [detail("card"), detail("batch", 300)]),
            capability_details: [cacheDetail("cache"), cacheDetail("revoked")],
          },
        ],
      });
      const first = await collectProvider(selectedManifest, undefined, { sources: {} }, before);
      const previous = catalogSchema.parse({
        catalog_version: "a".repeat(64),
        generated_at: before,
        providers: [first.provider],
        models: first.models,
        sources: first.sources,
        coverage: [first.coverage],
        warnings: [],
      });
      vi.mocked(fetchSource).mockResolvedValue({
        body: "fixture",
        contentHash: "c".repeat(64),
        etag: undefined,
        lastModified: undefined,
        dependencies: [],
        dependencyFailures: [
          {
            dependency_id: `${source.id}/optional-guide`,
            impact: "claim",
            outcome: "fetch_failed",
            message: "HTTP 503",
          },
        ],
      });
      vi.mocked(parseSource).mockReturnValue({
        models: [
          {
            ...model(now, [detail("card", 250)]),
            limits: { context_tokens: 2000 },
            capability_details: [{ ...cacheDetail("revoked"), statements: [] }],
          },
        ],
      });
      const next = await collectProvider(selectedManifest, previous, { sources: {} }, now);
      expect(next.models[0]?.limit_details).toEqual([detail("batch", 300), detail("card", 250)]);
      expect(next.models[0]?.capability_details).toEqual([
        cacheDetail("cache"),
        { ...cacheDetail("revoked"), statements: [] },
      ]);
      expect(next.sources[0]?.observed_at).toBe(now);
      expect(next.models[0]?.limit_details?.[0]?.evidence[0]?.observed_at).toBe(before);
      expect(next.provider.catalog_version).not.toBe(first.provider.catalog_version);
      expect(next.models[0]?.limits.context_tokens).toBe(2000);
      const changedExtractor = await collectProvider(
        {
          ...selectedManifest,
          sources: [{ ...selectedSource, extractorVersion: "changed-parser" }],
        },
        previous,
        { sources: {} },
        now,
      );
      expect(changedExtractor.models[0]?.limit_details).toEqual([detail("card", 250)]);
      expect(changedExtractor.models[0]?.capability_details).toEqual([
        { ...cacheDetail("revoked"), statements: [] },
      ]);
      const undeclared = await collectProvider(
        {
          ...selectedManifest,
          sources: [
            {
              ...selectedSource,
              fields: selectedSource.fields.filter((field) => field !== "capability_details"),
            },
          ],
        },
        previous,
        { sources: {} },
        now,
      );
      expect(undeclared.models[0]?.capability_details).toBeUndefined();
      expect(undeclared.models[0]?.limit_details).toEqual(next.models[0]?.limit_details);
    },
  );

  it.each(["unowned", "host", "malformed", "duplicate", "oversized"])(
    "withholds %s claims without rejecting identity or independent valid claims",
    async (failure) => {
      vi.mocked(fetchSource).mockResolvedValue({
        body: "fixture",
        contentHash: "b".repeat(64),
        etag: undefined,
        lastModified: undefined,
        dependencies: [],
      });
      const invalid = detail("bad");
      if (failure === "unowned") invalid.source_ref = "different-provider-source";
      if (failure === "host" && invalid.evidence[0])
        invalid.evidence[0].document_url = "https://unowned.example/limits";
      if (failure === "malformed" && invalid.statements[0]) invalid.statements[0].scope = "";
      const details =
        failure === "duplicate"
          ? [invalid, invalid]
          : failure === "oversized"
            ? Array.from({ length: 9 }, (_, i) => detail(`bad-${i}`))
            : [invalid];
      vi.mocked(parseSource).mockReturnValue({
        models: [
          {
            ...model(now, [detail("card"), ...details]),
            capability_details: [
              cacheDetail("cache"),
              { ...cacheDetail("foreign"), source_ref: "different-provider-source" },
            ],
          },
        ],
      });
      const next = await collectProvider(manifest, undefined, { sources: {} }, now);
      expect(next.models[0]?.model_id).toBe("example");
      expect(next.models[0]?.limits.context_tokens).toBe(1000);
      expect(next.models[0]?.limit_details).toEqual(
        failure === "oversized" ? undefined : [detail("card")],
      );
      expect(next.warnings.some(({ code }) => code === "limit_detail_invalid")).toBe(true);
      expect(next.models[0]?.capability_details).toEqual([cacheDetail("cache")]);
      expect(next.warnings.some(({ code }) => code === "capability_detail_invalid")).toBe(true);
    },
  );
});
