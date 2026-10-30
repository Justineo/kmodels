import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { collectProvider } from "../src/catalog/collector.ts";
import { fetchSource } from "../src/catalog/fetch.ts";
import { manifests, type ProviderManifest } from "../src/catalog/manifests.ts";
import { sha256 } from "../src/catalog/io.ts";
import { reconcileInvocationBindings } from "../src/catalog/invocation-pricing.ts";
import { prepareCatalogPair } from "../src/catalog/pricing-publication.ts";
import { coreCatalogVersion } from "../src/catalog/pricing-pair-transition.ts";
import { calculationV2Export } from "../src/catalog/pricing-calculator-v2-export.ts";
import { createCalculator } from "../src/pricing/v2/index.ts";
import { websiteInvocationDetail } from "../src/catalog/website-invocation.ts";
import { selectWebsiteInvocation } from "../src/catalog/website-invocation-context.ts";
import type { Catalog } from "../src/catalog/schema.ts";
import type { PricingCatalog } from "../src/catalog/pricing-schema.ts";

vi.mock("../src/catalog/fetch.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/catalog/fetch.ts")>()),
  fetchSource: vi.fn(),
}));
afterEach(() => vi.clearAllMocks());
const at = "2026-10-30T00:00:00.000Z";
const fixture = (name: string) =>
  readFile(new URL(`./fixtures/anthropic/${name}`, import.meta.url), "utf8");

async function collected(missingSpeed = false, missingWire = false) {
  const manifest = manifests.find(({ provider }) => provider.id === "anthropic");
  const source = manifest?.sources.find(({ id }) => id === "anthropic-models");
  if (manifest === undefined || source === undefined) throw new Error("Missing Anthropic source");
  const documents = [
    ["api/messages/create.md", "invocation-messages.md"],
    ["api/overview.md", "invocation-api-overview.md"],
    ["api/versioning.md", "invocation-versioning.md"],
    ["about-claude/models/model-ids-and-versions.md", "invocation-model-ids.md"],
    ["manage-claude/data-residency.md", "invocation-data-residency.md"],
    ["build-with-claude/fast-mode.md", "invocation-fast-mode.md"],
    ["build-with-claude/prompt-caching.md", "prompt-caching.md"],
    ["about-claude/pricing.md", "pricing.md"],
    ["about-claude/model-deprecations.md", "lifecycle.md"],
    ["release-notes/overview.md", "release-notes.md"],
    ["agents-and-tools/tool-use/code-execution-tool.md", "code-execution-tool.md"],
    ["agents-and-tools/tool-use/web-search-tool.md", "web-search-tool.md"],
    ["agents-and-tools/tool-use/advisor-tool.md", "advisor-tool.md"],
    ["build-with-claude/compaction.md", "compaction.md"],
    ["build-with-claude/compaction-threshold.md", "compaction-threshold.md"],
    ["build-with-claude/fallback-credit.md", "fallback-credit.md"],
    ["api/models/list.md", "models-list.md"],
    ["api/messages/batches/create.md", "batches.md"],
    ["build-with-claude/batch-processing.md", "batch-processing.md"],
    ["build-with-claude/citations.md", "citations.md"],
    ["build-with-claude/pdf-support.md", "pdf-support.md"],
    ["build-with-claude/context-editing.md", "context-editing.md"],
    ["build-with-claude/structured-outputs.md", "structured-outputs.md"],
    ["agents-and-tools/tool-use/computer-use-tool.md", "computer-use-tool.md"],
    ["build-with-claude/effort.md", "effort.md"],
    ["about-claude/glossary.md", "glossary.md"],
    ["build-with-claude/thinking.md", "thinking.md"],
    ["build-with-claude/thinking-troubleshooting.md", "thinking-troubleshooting.md"],
    ["agents-and-tools/tool-use/define-tools.md", "define-tools.md"],
  ] as const;
  const bundle = {
    index: { url: source.url, body: await fixture("overview.md") },
    documents: await Promise.all(
      documents.map(async ([path, name]) => {
        let body = await fixture(name);
        // Retain one historical tariff control whose model remains in the native Fast contract.
        if (name === "pricing.md")
          body = body.replace("Claude Opus 4.8 / Claude Opus 4.7", "Claude Opus 4.8");
        // This historical companion predates the retirement in the lifecycle fixture.
        if (name === "code-execution-tool.md")
          body = body.replace(/^\| Claude Opus 4\.1[^\n]*\n/gm, "");
        if (name === "invocation-fast-mode.md")
          body = body.replace(/^    - claude-opus-5(?:-5)?\n/gm, "");
        if (name === "invocation-messages.md" && missingSpeed)
          body = body.replace(
            '    - `speed: "standard" or "fast" or null`',
            '    - `unreviewed_speed: "standard" or "fast" or null`',
          );
        return { url: `https://platform.claude.com/docs/en/${path}`, body };
      }),
    ),
  };
  if (missingWire)
    bundle.documents = bundle.documents.filter(({ url }) => !url.endsWith("/api/overview.md"));
  const body = JSON.stringify(bundle);
  vi.mocked(fetchSource).mockResolvedValue({
    body,
    contentHash: sha256(body),
    etag: undefined,
    lastModified: undefined,
    dependencies: [],
    ...(missingWire
      ? {
          dependencyFailures: [
            {
              dependency_id: "anthropic-models/api-overview",
              impact: "claim" as const,
              outcome: "fetch_failed" as const,
              message: "Fixture outage",
            },
          ],
        }
      : {}),
  });
  const selected: ProviderManifest = { ...manifest, sources: [source] };
  const result = await collectProvider(selected, undefined, { sources: {} }, at);
  const invocation = result.invocation;
  const partition = result.pricing;
  if (invocation === undefined || partition === undefined)
    throw new Error(JSON.stringify(result.attempt.pricing));
  const core: Catalog = {
    catalog_version: coreCatalogVersion([result.provider]),
    generated_at: at,
    providers: [result.provider],
    models: result.models,
    sources: result.sources,
    coverage: [result.coverage],
    warnings: result.warnings,
    invocation,
  };
  const pricing: PricingCatalog = {
    provider_vocabularies: [partition.vocabulary],
    provider_snapshots: [partition.snapshot],
    model_dispositions: partition.model_dispositions,
    books: partition.books,
  };
  const bindings = reconcileInvocationBindings(invocation, pricing, []);
  return { core, pricing, bindings, invocation };
}

describe("Anthropic invocation pricing publication", () => {
  it("keeps canonical prices fresh during an invocation-only companion outage", async () => {
    const manifest: ProviderManifest | undefined = manifests.find(
      ({ provider }) => provider.id === "anthropic",
    );
    const companions = manifest?.sources
      .find(({ id }) => id === "anthropic-models")
      ?.linkedDocuments?.documents?.filter(
        ({ id }) => id === "api-overview" || id === "api-versioning",
      );
    expect(companions).toHaveLength(2);
    expect(companions?.every(({ optional, claimLocal }) => optional && claimLocal)).toBe(true);
    const { pricing, invocation, bindings } = await collected(false, true);
    expect(pricing.provider_snapshots[0]?.publication).toBe("fresh");
    expect(invocation.invocation_targets).toEqual([]);
    expect(bindings).toEqual([]);
  });
  it("publishes US Fast pricing through the collector, v2 calculator and website", async () => {
    const { core, pricing, bindings, invocation } = await collected();
    const target = invocation.invocation_targets.find(
      ({ address, cases }) =>
        address.kind === "literal" &&
        address.value === "claude-opus-4-8" &&
        cases[0]?.inference_geo.kind === "exact" &&
        cases[0].inference_geo.value === "us" &&
        cases[0].inference_mode.kind === "exact",
    );
    const binding = bindings.find(({ target_ref }) => target_ref === target?.id);
    if (target === undefined || binding === undefined)
      throw new Error(
        `Missing US Fast binding: ${bindings.length} bindings, ${invocation.invocation_targets.length} targets`,
      );
    expect(binding.selectors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          dimension: { namespace: "kmodels", value: "speed" },
          value: {
            kind: "fixed",
            value: { namespace: "provider", provider_id: "anthropic", value: "fast" },
          },
        }),
        expect.objectContaining({
          dimension: { namespace: "kmodels", value: "inference_geo" },
          value: {
            kind: "fixed",
            value: { namespace: "provider", provider_id: "anthropic", value: "us" },
          },
        }),
      ]),
    );
    const pair = prepareCatalogPair(core, pricing, bindings);
    if (pair.v2 === undefined) throw new Error("Missing v2 pair");
    const calculator = await createCalculator(await calculationV2Export(pair.v2));
    const offerRef = binding.offer_refs[0];
    if (offerRef === undefined) throw new Error("Missing offer");
    const selection = { offerRef, invocation: { targetRef: target.id, caseRef: binding.case_ref } };
    expect(calculator.bindInvocation(selection).missingInputs).toEqual([]);
    expect(() =>
      calculator.bindInvocation({
        ...selection,
        selectors: [
          {
            kind: "categorical",
            dimension: { namespace: "kmodels", value: "inference_geo" },
            value: { namespace: "provider", provider_id: "anthropic", value: "global" },
          },
        ],
      }),
    ).toThrow(/contradicts/);
    const model = core.models.find(({ uid }) => uid === target.model_ref);
    if (model === undefined) throw new Error("Missing model");
    const detail = websiteInvocationDetail(core, model, bindings);
    if (detail === undefined) throw new Error("Missing website detail");
    expect(selectWebsiteInvocation(detail, model, target.id, binding.case_ref)?.binding).toEqual(
      binding,
    );
    const requirements = calculator.requirements(selection);
    expect(requirements.charges.length).toBeGreaterThan(0);
    const signals = [
      ...new Map(
        requirements.charges
          .flatMap(({ alternatives }) => alternatives[0] ?? [])
          .map((signal) => [JSON.stringify(signal), signal]),
      ).values(),
    ];
    expect(signals.some(({ value }) => value === "uncached_input_tokens")).toBe(true);
    const cost = calculator.calculate({
      evaluatedAt: at,
      components: [
        {
          id: "messages",
          ...selection,
          quantities: signals.map((signal) => ({
            signal,
            value: {
              numerator: signal.value === "uncached_input_tokens" ? "1000000" : "0",
              denominator: "1",
            },
          })),
        },
      ],
    });
    expect(cost.status).toBe("calculated");
    expect(cost.subtotals[0]?.amount).toEqual({ numerator: "11", denominator: "1" });
  });

  it("requires actual outcomes when speed and workspace routing were omitted", async () => {
    const { core, pricing, bindings, invocation } = await collected();
    const target = invocation.invocation_targets.find(
      ({ model_ref, selectors }) =>
        model_ref === "anthropic/claude-opus-4-8" && selectors.length === 1,
    );
    const binding = bindings.find(({ target_ref }) => target_ref === target?.id);
    if (binding === undefined) throw new Error("Missing default binding");
    expect(
      binding.selectors
        .filter(({ value }) => value.kind === "observed")
        .map(({ dimension }) => dimension.value)
        .sort(),
    ).toEqual(["inference_geo", "speed"]);
    const pair = prepareCatalogPair(core, pricing, bindings);
    if (pair.v2 === undefined) throw new Error("Missing pair");
    const calculator = await createCalculator(await calculationV2Export(pair.v2));
    const offerRef = binding.offer_refs[0];
    if (offerRef === undefined) throw new Error("Missing offer");
    expect(
      calculator.bindInvocation({
        offerRef,
        invocation: { targetRef: binding.target_ref, caseRef: binding.case_ref },
      }).missingInputs,
    ).toHaveLength(2);
  });

  it("withdraws stale joins when actual speed accounting is no longer established", async () => {
    const prior = await collected();
    const fresh = await collected(true);
    expect(fresh.invocation.invocation_targets.length).toBeGreaterThan(0);
    expect(fresh.bindings).toEqual([]);
    expect(
      reconcileInvocationBindings(fresh.invocation, fresh.pricing, [], {
        invocation: prior.invocation,
        bindings: prior.bindings,
      }),
    ).toEqual([]);
  });
});
