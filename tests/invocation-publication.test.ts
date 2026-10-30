import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { verifyCalculationAssets } from "../scripts/check-calculation-assets.ts";
import { websiteDataVersion } from "../src/catalog/projections.ts";
import { websiteDetailChunkSchema } from "../src/catalog/website-schema.ts";
import { websiteInvocationDetail } from "../src/catalog/website-invocation.ts";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { canonicalJsonHash } from "../src/catalog/canonical-json.ts";
import { validateAssetPack } from "../src/catalog/asset-pack.ts";
import { canonicalJson, compareUtf8Sequences } from "../src/catalog/canonical-value.ts";
import { calculationExport } from "../src/catalog/pricing-calculator-export.ts";
import { calculationV2Export } from "../src/catalog/pricing-calculator-v2-export.ts";
import { canonicalizeApplicability } from "../src/catalog/pricing-canonical.ts";
import { invocationSelectorSourceRef } from "../src/catalog/publication-v2.ts";
import {
  createCalculator as createLegacyCalculator,
  validatePriceData as validateLegacyPriceData,
} from "../src/pricing/index.ts";
import { createCalculator, validatePriceData } from "../src/pricing/v2/index.ts";
import { collectProvider } from "../src/catalog/collector.ts";
import { fetchSource } from "../src/catalog/fetch.ts";
import { sha256 } from "../src/catalog/io.ts";
import { reconcileInvocationBindings } from "../src/catalog/invocation-pricing.ts";
import { manifests } from "../src/catalog/manifests.ts";
import { coreCatalogVersion, composeCatalogPair } from "../src/catalog/pricing-pair-transition.ts";
import {
  commitCatalogPair,
  prepareCatalogPair,
  readCatalogPairMirrors,
  recoverCatalogPair,
  type CatalogPairPaths,
} from "../src/catalog/pricing-publication.ts";
import {
  pricingCatalogEnvelopeSchema,
  type PricingCatalog,
} from "../src/catalog/pricing-schema.ts";
import { failedPricingTransition } from "../src/catalog/pricing-transition.ts";
import {
  readPublishedAssets,
  materializePublishedAssets,
} from "../src/catalog/published-assets.ts";
import {
  invocationPricingBindingSchema,
  publicationManifestSchema,
} from "../src/catalog/publication-v2-schema.ts";
import { catalogEnvelopeSchema, type Catalog } from "../src/catalog/schema.ts";
import {
  createPricingCompilationSnapshot,
  compilePricingSnapshot,
} from "../src/catalog/pricing-compilation.ts";

vi.mock("../src/catalog/fetch.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/catalog/fetch.ts")>()),
  fetchSource: vi.fn(),
}));

const directories: string[] = [];
afterEach(async () => {
  vi.clearAllMocks();
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
const selectedManifest = manifests.find(({ provider }) => provider.id === "typesafe");
if (selectedManifest === undefined) throw new Error("Missing TypeSafe manifest");
const manifest = selectedManifest;
const at = "2026-10-30T00:00:00.000Z";
const later = "2026-10-30T01:00:00.000Z";
const file = (name: string) =>
  readFile(new URL(`./fixtures/typesafe/${name}`, import.meta.url), "utf8");

async function respond(api: string | null = "system-one.md", models?: string) {
  const source = manifest.sources[0];
  if (source === undefined) throw new Error("Missing TypeSafe source");
  const body = JSON.stringify({
    index: { url: source.url, body: models ?? (await file("models.md")) },
    documents: [
      { url: "https://docs.typesafe.ai/llms.txt", body: await file("llms.txt") },
      ...(api === null
        ? []
        : [{ url: "https://docs.typesafe.ai/api/system-one.md", body: await file(api) }]),
    ],
  });
  vi.mocked(fetchSource).mockResolvedValue({
    body,
    contentHash: sha256(body),
    etag: undefined,
    lastModified: undefined,
    dependencies: [],
  });
}

function catalog(result: Awaited<ReturnType<typeof collectProvider>>, time: string): Catalog {
  return {
    catalog_version: coreCatalogVersion([result.provider]),
    generated_at: time,
    providers: [result.provider],
    models: result.models,
    sources: result.sources,
    coverage: [result.coverage],
    warnings: result.warnings,
    ...(result.invocation === undefined ? {} : { invocation: result.invocation }),
  };
}

async function initial() {
  await respond();
  const result = await collectProvider(manifest, undefined, { sources: {} }, at);
  const core = catalog(result, at);
  const partition = result.pricing;
  if (partition === undefined || core.invocation === undefined)
    throw new Error(JSON.stringify(result.attempt));
  const prices: PricingCatalog = {
    provider_vocabularies: [partition.vocabulary],
    provider_snapshots: [partition.snapshot],
    model_dispositions: partition.model_dispositions,
    books: partition.books,
  };
  const bindings = reconcileInvocationBindings(
    core.invocation,
    prices,
    result.invocationPricing ?? [],
  );
  const candidate = prepareCatalogPair(core, prices, bindings);
  return { result, core, prices, bindings, candidate };
}

async function paths(): Promise<CatalogPairPaths> {
  const directory = await mkdtemp(join(tmpdir(), "kmodels-invocation-"));
  directories.push(directory);
  return {
    stateDirectory: join(directory, "state"),
    catalogMirror: join(directory, "catalog.json"),
    pricingMirrorGzip: join(directory, "pricing.json.gz"),
    pricingV2MirrorGzip: join(directory, "pricing-v2.json.gz"),
    projections: {
      uiManifest: join(directory, "ui.json"),
      uiPack: join(directory, "ui.pack"),
      exportManifest: join(directory, "exports.json"),
      exportPack: join(directory, "exports.pack"),
    },
  };
}

describe("invocation publication", () => {
  it.each([
    ["ui", 16],
    ["exports", 64],
  ] as const)("bounds the %s asset pack before inspecting entries", (profile, mebibytes) => {
    expect(() =>
      validateAssetPack(
        {
          schema_version: 1,
          profile,
          pair_id: "a".repeat(64),
          data_version: "b".repeat(64),
          assets: [],
        },
        new Uint8Array(mebibytes * 1024 * 1024 + 1),
      ),
    ).toThrow(/encoded-input limit/);
  });

  it("keeps v1 and v2 calculator readers distinct and preserves exact numeric evaluation", async () => {
    const { core, candidate } = await initial();
    if (candidate.v2 === undefined) throw new Error("Missing v2 publication");
    const legacy = calculationExport(core, candidate.pricing);
    const data = await calculationV2Export(candidate.v2);
    expect(() => validateLegacyPriceData(data)).toThrow(/1.0/);
    await expect(validatePriceData(legacy)).rejects.toMatchObject({ code: "UNSUPPORTED_SCHEMA" });
    const calculator = await createCalculator(data);
    const binding = calculator.listInvocationBindings()[0];
    const offerRef = binding?.offer_refs[0];
    if (binding === undefined || offerRef === undefined)
      throw new Error("Missing invocation offer");
    const request = {
      evaluatedAt: at,
      components: [
        {
          id: "request",
          offerRef,
          quantities: [
            {
              signal: { namespace: "kmodels" as const, value: "input_tokens" as const },
              value: { numerator: "1000", denominator: "1" },
            },
            {
              signal: { namespace: "kmodels" as const, value: "output_tokens" as const },
              value: { numerator: "100", denominator: "1" },
            },
          ],
        },
      ],
    };
    expect(() => calculator.calculate(request)).toThrow(/Select an invocation/);
    const result = calculator.calculate({
      ...request,
      components: request.components.map((component) => ({
        ...component,
        invocation: { targetRef: binding.target_ref, caseRef: binding.case_ref },
      })),
    });
    const oldResult = createLegacyCalculator(legacy).calculate(request);
    expect(result.status).toBe("calculated");
    expect(result.subtotals).toEqual(oldResult.subtotals);
    expect(result.charges).toEqual(oldResult.charges);
    expect(result.snapshot).toEqual(data.snapshot);
    expect(result.invocationSelections).toEqual([
      { componentId: "request", targetRef: binding.target_ref, caseRef: binding.case_ref },
    ]);
    binding.offer_refs.length = 0;
    expect(calculator.listInvocationBindings()[0]?.offer_refs).toContain(offerRef);
  });

  it("rejects missing, private and foreign invocation references in portable partitions", async () => {
    const { candidate } = await initial();
    if (candidate.v2 === undefined) throw new Error("Missing v2 publication");
    const data = await calculationV2Export(candidate.v2);
    for (const mutate of [
      (value: typeof data) => {
        value.snapshot.coreDataSha256 = "0".repeat(64);
      },
      (value: typeof data) => {
        const p = value.providers[0];
        if (p) p.invocation_sources = [];
      },
      (value: typeof data) => {
        const s = value.providers[0]?.invocation_sources[0];
        if (s) s.scope = "account";
      },
      (value: typeof data) => {
        const s = value.providers[0]?.invocation_sources[0];
        if (s) s.provider_id = "other";
      },
      (value: typeof data) => {
        const b = value.providers[0]?.invocation_bindings[0];
        if (b) b.offer_refs = ["0".repeat(64)];
      },
      (value: typeof data) => {
        const b = value.providers[0]?.invocation_bindings[0];
        if (b) b.case_ref = "missing";
      },
      (value: typeof data) => {
        const b = value.providers[0]?.invocation_bindings[0];
        if (b)
          b.selectors = [
            {
              dimension: { namespace: "kmodels", value: "model" },
              value: { kind: "context", input: "request_region" },
              evidence_refs: b.evidence_refs,
            },
          ];
      },
    ]) {
      const changed = structuredClone(data);
      mutate(changed);
      await expect(validatePriceData(changed)).rejects.toMatchObject({ code: "INVALID_DATA" });
    }
  });

  it("applies fixed invocation selectors and rejects overrides and unrelated cases", async () => {
    const { candidate } = await initial();
    if (candidate.v2 === undefined) throw new Error("Missing v2 publication");
    const data = await calculationV2Export(candidate.v2);
    const provider = data.providers[0];
    const binding = provider?.invocation_bindings[0];
    const target = provider?.invocation.invocation_targets.find(
      ({ id }) => id === binding?.target_ref,
    );
    const offerRef = binding?.offer_refs[0];
    if (binding === undefined || target === undefined || offerRef === undefined)
      throw new Error("Missing fixture target");
    const dimension = { namespace: "kmodels" as const, value: "model" as const };
    binding.selectors = [
      {
        dimension,
        value: {
          kind: "fixed",
          value: { namespace: "kmodels", value: target.resolved_model_ref ?? target.model_ref },
        },
        evidence_refs: binding.evidence_refs,
      },
    ];
    const calculator = await createCalculator(data);
    const selection = {
      offerRef,
      invocation: { targetRef: binding.target_ref, caseRef: binding.case_ref },
    };
    const bound = calculator.bindInvocation(selection);
    const returned = bound.selectors[0];
    if (returned?.kind !== "categorical") throw new Error("Missing fixed selector");
    returned.value.value = "mutated-by-consumer";
    expect(calculator.bindInvocation(selection).selectors).toEqual([
      {
        kind: "categorical",
        dimension,
        value:
          binding.selectors[0]?.value.kind === "fixed"
            ? binding.selectors[0].value.value
            : undefined,
      },
    ]);
    expect(() =>
      calculator.bindInvocation({
        ...selection,
        selectors: [
          {
            kind: "categorical",
            dimension,
            value: { namespace: "kmodels", value: "typesafe/other" },
          },
        ],
      }),
    ).toThrow(/contradicts/);
    expect(() =>
      calculator.bindInvocation({
        ...selection,
        invocation: { ...selection.invocation, caseRef: "missing" },
      }),
    ).toThrow(/does not bind/);
    expect(() =>
      calculator.bindInvocation({
        ...selection,
        invocation: {
          ...selection.invocation,
          inputs: {
            request_region: { namespace: "provider", provider_id: "typesafe", value: "us" },
          },
        },
      }),
    ).toThrow(/not declared/);
  });

  it.each(["context", "observed"] as const)(
    "keeps %s price inputs explicit and cannot bypass them with ordinary selectors",
    async (kind) => {
      const { candidate } = await initial();
      if (candidate.v2 === undefined) throw new Error("Missing v2 publication");
      const data = await calculationV2Export(candidate.v2);
      const provider = data.providers[0];
      const binding = provider?.invocation_bindings[0];
      const offerRef = binding?.offer_refs[0];
      const offer = provider?.books
        .flatMap(({ offers }) => offers)
        .find(({ id }) => id === offerRef);
      const term = offer?.terms.find((entry) => entry.kind === "rate");
      const rate = term?.kind === "rate" ? term.variants[0] : undefined;
      if (
        provider === undefined ||
        binding === undefined ||
        offerRef === undefined ||
        rate === undefined
      )
        throw new Error("Missing fixture rate");
      const dimension = {
        namespace: "provider" as const,
        provider_id: "typesafe",
        value: "synthetic_region",
      };
      const value = {
        namespace: "provider" as const,
        provider_id: "typesafe",
        value: "test-region",
      };
      provider.vocabulary.atoms.push(
        {
          kind: "dimension",
          key: dimension.value,
          definition: "Synthetic test dimension",
          resolution_phase: kind === "context" ? "request" : "outcome",
        },
        {
          kind: "categorical_value",
          key: value.value,
          dimension,
          definition: "Synthetic test region",
        },
      );
      rate.applicability = canonicalizeApplicability({
        any_of: rate.applicability.any_of.map(({ all_of }) => ({
          all_of: [...all_of, { kind: "categorical", dimension, values: [value] }],
        })),
      });
      const source = {
        dimension,
        channel: "response" as const,
        locator: { kind: "json_pointer" as const, value: "/served_region" },
        availability: "always" as const,
        evidence: rate.evidence,
      };
      rate.selector_sources = [source];
      const input =
        kind === "context" ? "request_region" : invocationSelectorSourceRef(offerRef, source);
      binding.selectors = [
        {
          dimension,
          value: kind === "context" ? { kind, input } : { kind, input_ref: input },
          evidence_refs: binding.evidence_refs,
        },
      ];
      const calculator = await createCalculator(data);
      const selection = {
        offerRef,
        invocation: { targetRef: binding.target_ref, caseRef: binding.case_ref },
      };
      expect(calculator.bindInvocation(selection).missingInputs).toEqual([{ kind, input }]);
      expect(() => calculator.requirements(selection)).toThrow(/incomplete/);
      expect(() =>
        calculator.bindInvocation({
          ...selection,
          selectors: [{ kind: "categorical", dimension, value }],
        }),
      ).toThrow(/declared context or observed input/);
      const supplied = {
        ...selection,
        invocation: {
          ...selection.invocation,
          ...(kind === "context"
            ? { inputs: { [input]: value } }
            : { observed: { [input]: value } }),
        },
      };
      expect(calculator.bindInvocation(supplied).missingInputs).toEqual([]);
      expect(calculator.bindInvocation(supplied).selectors).toEqual([
        { kind: "categorical", dimension, value },
      ]);
      expect(() => calculator.requirements(supplied)).not.toThrow();
      if (kind === "observed") {
        binding.selectors[0] = {
          dimension,
          value: { kind, input_ref: "selector:missing" },
          evidence_refs: binding.evidence_refs,
        };
        await expect(validatePriceData(data)).rejects.toThrow(/unknown observed input/);
      }
    },
  );

  it("collects exact TypeSafe targets and binds their reviewed offer without changing v1", async () => {
    const { candidate, core, prices, bindings } = await initial();
    expect(core.invocation?.invocation_targets).toHaveLength(3);
    expect(bindings).toHaveLength(3);
    const { invocation: _invocation, ...legacyCore } = core;
    const legacy = prepareCatalogPair(legacyCore, prices);
    expect(candidate.catalogAssetSource).toBe(legacy.catalogAssetSource);
    expect(candidate.pricingAssetSource).toBe(legacy.pricingAssetSource);
    expect(candidate.pairId).not.toBe(legacy.pairId);
    expect(
      catalogEnvelopeSchema.parse(JSON.parse(candidate.catalogAssetSource)).data,
    ).not.toHaveProperty("invocation_targets");
    expect(
      pricingCatalogEnvelopeSchema.parse(JSON.parse(candidate.pricingAssetSource)).data,
    ).not.toHaveProperty("invocation_bindings");
    expect(candidate.v2?.pricing.core_data_sha256).toBe(
      canonicalJsonHash(candidate.v2?.catalog.data),
    );
    expect(candidate.v2?.pricing.data.books).toEqual(candidate.pricing.data.books);
    if (candidate.v2 === undefined) throw new Error("Missing v2 publication");
    expect(candidate.v2.catalogSource).toBe(canonicalJson(candidate.v2.catalog));
    expect(candidate.v2.pricingSource).toBe(canonicalJson(candidate.v2.pricing));
  });

  it("rejects binding-only price conditions without advancing the accepted pair", async () => {
    const { candidate, core, prices, bindings } = await initial();
    if (candidate.v2 === undefined) throw new Error("Missing v2 publication");
    const binding = bindings[0];
    if (binding === undefined) throw new Error("Missing binding");
    const restricted = {
      ...binding,
      selectors: [
        {
          dimension: { namespace: "kmodels" as const, value: "region" as const },
          value: { kind: "context" as const, input: "request_region" },
          evidence_refs: binding.evidence_refs,
        },
      ],
    };
    const location = await paths();
    await commitCatalogPair(candidate, location);
    const before = await readFile(location.pricingMirrorGzip);
    expect(() => prepareCatalogPair(core, prices, [restricted])).toThrow(
      /selector is absent from the offer's commercial applicability/,
    );
    expect(await readFile(location.pricingMirrorGzip)).toEqual(before);
    const recovered = await recoverCatalogPair(location);
    expect(recovered?.pairId).toBe(candidate.pairId);
    expect(recovered?.catalog.generated_at).toBe(at);
    expect(recovered?.pricingAssetSource).toBe(candidate.pricingAssetSource);
    expect(recovered?.v2?.pricingSource).toBe(candidate.v2.pricingSource);

    const data = await calculationV2Export(candidate.v2);
    const provider = data.providers[0];
    if (provider === undefined) throw new Error("Missing provider");
    provider.invocation_bindings = [restricted];
    await expect(validatePriceData(data)).rejects.toThrow(
      /selector is absent from the offer's commercial applicability/,
    );
  });

  it("preserves regional rate restrictions for both legacy and invocation-aware consumers", async () => {
    const initialPair = await initial();
    const { core } = initialPair;
    const prices = structuredClone(initialPair.prices);
    const bindings = structuredClone(initialPair.bindings);
    const binding = bindings[0];
    const vocabulary = prices.provider_vocabularies[0];
    const offerRef = binding?.offer_refs[0];
    const offer = prices.books.flatMap(({ offers }) => offers).find(({ id }) => id === offerRef);
    if (
      binding === undefined ||
      vocabulary === undefined ||
      offer === undefined ||
      offerRef === undefined
    )
      throw new Error("Missing fixture offer");
    const dimension = { namespace: "kmodels" as const, value: "region" as const };
    const value = { namespace: "provider" as const, provider_id: "typesafe", value: "test-region" };
    vocabulary.atoms.push({
      kind: "categorical_value",
      key: value.value,
      dimension,
      definition: "Synthetic regional tariff",
    });
    const atomKey = (atom: (typeof vocabulary.atoms)[number]) => [
      atom.kind,
      ...("dimension" in atom ? [canonicalJson(atom.dimension)] : []),
      atom.key,
    ];
    vocabulary.atoms.sort((left, right) => compareUtf8Sequences(atomKey(left), atomKey(right)));
    for (const term of offer.terms) {
      if (term.kind !== "rate") continue;
      for (const variant of term.variants) {
        variant.applicability = canonicalizeApplicability({
          any_of: variant.applicability.any_of.map(({ all_of }) => ({
            all_of: [...all_of, { kind: "categorical", dimension, values: [value] }],
          })),
        });
        variant.observations = variant.observations.map((observation) => ({
          ...observation,
          raw: { ...observation.raw, conditions: [{ dimension: "Region", value: "test-region" }] },
          establishes_applicability: variant.applicability,
        }));
      }
    }
    binding.selectors = [
      { dimension, value: { kind: "fixed", value }, evidence_refs: binding.evidence_refs },
    ];
    const candidate = prepareCatalogPair(core, prices, [binding]);
    if (candidate.v2 === undefined) throw new Error("Missing v2 publication");
    const legacy = createLegacyCalculator(calculationExport(core, candidate.pricing));
    const current = await createCalculator(await calculationV2Export(candidate.v2));
    const component = {
      id: "request",
      offerRef,
      quantities: [
        {
          signal: { namespace: "kmodels" as const, value: "input_tokens" as const },
          value: { numerator: "1000", denominator: "1" },
        },
        {
          signal: { namespace: "kmodels" as const, value: "output_tokens" as const },
          value: { numerator: "100", denominator: "1" },
        },
      ],
    };
    const missing = legacy.calculate({ evaluatedAt: at, components: [component] });
    expect(missing.status).not.toBe("calculated");
    expect(missing.charges).toEqual([]);
    const selected = legacy.calculate({
      evaluatedAt: at,
      components: [{ ...component, selectors: [{ kind: "categorical", dimension, value }] }],
    });
    const bound = current.calculate({
      evaluatedAt: at,
      components: [
        { ...component, invocation: { targetRef: binding.target_ref, caseRef: binding.case_ref } },
      ],
    });
    expect(bound.status).toBe("calculated");
    expect(selected.status).toBe("calculated");
    expect(bound.subtotals).toEqual(selected.subtotals);
    expect(bound.charges).toEqual(selected.charges);
  });

  it("changes the v2 content binding when only a target condition changes", async () => {
    const { candidate, core, prices, bindings } = await initial();
    const changed = structuredClone(core);
    const target = changed.invocation?.invocation_targets[0];
    if (target === undefined) throw new Error("Missing target");
    target.resolution = "pinned";
    const next = prepareCatalogPair(changed, prices, bindings);
    expect(next.catalogAssetSource).toBe(candidate.catalogAssetSource);
    expect(next.pricingAssetSource).toBe(candidate.pricingAssetSource);
    expect(next.v2?.catalog.catalog_version).not.toBe(candidate.v2?.catalog.catalog_version);
    expect(next.pairId).not.toBe(candidate.pairId);
  });

  it("keeps a redirected model in deferred invocation reference closure", async () => {
    const { core } = await initial();
    const changed = structuredClone(core);
    const model = changed.models[0];
    const target = changed.invocation?.invocation_targets[0];
    if (model === undefined || target === undefined) throw new Error("Missing model target");
    const resolved = { ...model, uid: "typesafe/replacement", model_id: "replacement" };
    changed.models.push(resolved, { ...model, uid: "typesafe/unrelated", model_id: "unrelated" });
    target.resolution = "redirect";
    target.resolved_model_ref = resolved.uid;
    const detail = websiteInvocationDetail(changed, model, []);
    if (detail === undefined) throw new Error("Missing invocation detail");
    expect(detail.models.map(({ uid }) => uid)).toEqual([model.uid, resolved.uid]);
    expect(detail.graph.invocation_targets).toContainEqual(target);
    expect(detail.graph.invocation_targets.every(({ model_ref }) => model_ref === model.uid)).toBe(
      true,
    );
  });

  it("rejects dangling commercial joins and stale scope identities", async () => {
    const { core, prices, bindings } = await initial();
    const binding = bindings[0];
    if (binding === undefined) throw new Error("Missing binding");
    for (const replacement of [
      { ...binding, offer_refs: ["a".repeat(64)] },
      { ...binding, case_ref: "unknown-case" },
      { ...binding, evidence_refs: ["unknown-evidence"] },
      {
        ...binding,
        selectors: [
          {
            dimension: { namespace: "provider", provider_id: "other", value: "region" },
            value: { kind: "context", input: "request_region" },
            evidence_refs: binding.evidence_refs,
          },
        ],
      },
      {
        ...binding,
        selectors: [
          {
            dimension: { namespace: "kmodels", value: "input_tokens" },
            value: { kind: "context", input: "request_region" },
            evidence_refs: binding.evidence_refs,
          },
        ],
      },
    ]) {
      expect(() =>
        prepareCatalogPair(core, prices, [invocationPricingBindingSchema.parse(replacement)]),
      ).toThrow();
    }
    const changed = structuredClone(core);
    const entry = changed.invocation?.invocation_targets[0]?.cases[0];
    if (entry === undefined) throw new Error("Missing case");
    entry.request_region = { kind: "exact", value: "us-east-1" };
    expect(() => prepareCatalogPair(changed, prices, bindings)).toThrow(/case identity/);
  });

  it("publishes, materializes and recovers both pairs with complete resource hashes", async () => {
    const { candidate } = await initial();
    const location = await paths();
    await commitCatalogPair(candidate, location);
    const recovered = await recoverCatalogPair(location);
    expect(recovered?.v2).toEqual(candidate.v2);
    expect((await readCatalogPairMirrors(location))?.pairId).toBe(candidate.pairId);
    const published = await readPublishedAssets(location.projections);
    const directory = join(location.stateDirectory, "site");
    await materializePublishedAssets(published, directory);
    const manifest = publicationManifestSchema.parse(
      JSON.parse(await readFile(join(directory, "catalog/publication.json"), "utf8")),
    );
    expect(manifest.pairs[1].pair_id).toBe(candidate.pairId);
    for (const resource of manifest.resources)
      expect(sha256(await readFile(join(directory, resource.path)))).toBe(resource.sha256);
    expect(
      manifest.resources.some(({ path }) => path === "providers/v2/typesafe/invocations.json"),
    ).toBe(true);
    expect(
      manifest.resources.some(({ path }) => path === "pricing/calculation/coverage.json"),
    ).toBe(true);
    for (const path of [
      "pricing/v2/calculation/index.json",
      "pricing/v2/calculation/providers/typesafe.json",
      "pricing/v2/calculation/coverage.json",
    ])
      expect(manifest.resources.some((resource) => resource.path === path)).toBe(true);
    const full = await validatePriceData(
      JSON.parse(await readFile(join(directory, "pricing/v2/calculation/index.json"), "utf8")),
    );
    const partition = await validatePriceData(
      JSON.parse(
        await readFile(join(directory, "pricing/v2/calculation/providers/typesafe.json"), "utf8"),
      ),
    );
    expect(partition).toEqual(full);
    const providerModels = JSON.parse(
      await readFile(join(directory, "providers/v2/typesafe/models/index.json"), "utf8"),
    );
    expect(providerModels).toMatchObject({
      schema_version: 2,
      catalog_version: full.snapshot.coreCatalogVersion,
      provider_id: "typesafe",
      models: [
        {
          variants: [
            {
              legacy_fact_scope: "legacy_unscoped",
              target_refs: candidate.v2?.catalog.data.invocation_targets.map(({ id }) => id),
            },
          ],
        },
      ],
    });
    expect(full.snapshot.pricingAssetSha256).toBe(
      sha256(await readFile(join(directory, "pricing/v2/index.json"))),
    );
    const details = websiteDetailChunkSchema.parse(
      JSON.parse(await readFile(join(directory, "ui/details/typesafe/0.json"), "utf8")),
    );
    expect(details.schema_version).toBe(7);
    expect(details.data_version).toBe(
      websiteDataVersion(full.snapshot.coreCatalogVersion, full.snapshot.pricingDataVersion),
    );
    const detail = details.details.find(
      ({ model_ref }) => model_ref === full.providers[0]?.models[0]?.model_ref,
    );
    if (detail?.invocation === undefined) throw new Error("Missing deferred invocation detail");
    expect(detail.invocation.graph.invocation_targets).toEqual(
      candidate.v2?.catalog.data.invocation_targets,
    );
    expect(detail.invocation.bindings).toEqual(candidate.v2?.pricing.data.invocation_bindings);
    expect(
      detail.invocation.sources.every(({ scope }) => scope === "global" || scope === "region"),
    ).toBe(true);
    expect(detail.invocation.graph.invocation_evidence.length).toBeGreaterThan(0);
    expect(await verifyCalculationAssets(directory)).toEqual({
      legacyProviders: 1,
      v2Providers: 1,
    });
    await writeFile(
      join(directory, "pricing/v2/calculation/providers/typesafe.json"),
      canonicalJson({
        ...partition,
        snapshot: { ...partition.snapshot, coreCatalogVersion: "0".repeat(64) },
      }),
    );
    await expect(verifyCalculationAssets(directory)).rejects.toThrow();
  });

  it("rejects mixed cached v2 pricing and missing v2 mirrors", async () => {
    const { candidate } = await initial();
    if (candidate.v2 === undefined) throw new Error("Missing v2 pair");
    const location = await paths();
    await commitCatalogPair(candidate, location);
    await writeFile(
      location.pricingV2MirrorGzip,
      gzipSync(canonicalJson({ ...candidate.v2.pricing, core_catalog_version: "b".repeat(64) })),
    );
    await expect(readCatalogPairMirrors(location)).rejects.toThrow(/does not match/);
    expect((await recoverCatalogPair(location))?.v2).toEqual(candidate.v2);
    await rm(location.pricingV2MirrorGzip);
    await expect(readCatalogPairMirrors(location)).rejects.toThrow(/missing its v2/);
  });

  it("retains failed API companion evidence without inventing a fresh observation", async () => {
    const { core } = await initial();
    await respond(null);
    const next = await collectProvider(manifest, core, { sources: {} }, later);
    expect(next.coverage.status).toBe("fresh");
    expect(next.invocation?.invocation_targets).toEqual(core.invocation?.invocation_targets);
    expect(next.invocation?.target_coverage).toMatchObject([
      { state: "partial", reason: "source_unavailable" },
    ]);
    const apiEvidence = next.invocation?.invocation_evidence.filter(
      ({ basis }) => basis === "official_api_contract",
    );
    expect(apiEvidence).toHaveLength(1);
    expect(apiEvidence?.[0]?.observed_at).toBe(at);
    expect(
      next.invocation?.invocation_evidence
        .filter(({ basis }) => basis === "official_catalog")
        .every(({ observed_at }) => observed_at === later),
    ).toBe(true);
  });

  it("does not retain an alias removed by fresh identity evidence during API failure", async () => {
    const { core } = await initial();
    await respond(null, (await file("models.md")).replace(/^\| `jev-preview`.*\n/m, ""));
    const next = await collectProvider(manifest, core, { sources: {} }, later);
    expect(next.coverage.status).toBe("fresh");
    expect(next.invocation?.invocation_targets).toHaveLength(2);
    expect(
      next.invocation?.invocation_targets.some(
        ({ address }) => address.kind === "literal" && address.value === "jev-preview",
      ),
    ).toBe(false);
  });

  it("retains invocation facts with a failed provider and during pricing-driven core rollback", async () => {
    const { core, prices } = await initial();
    vi.mocked(fetchSource).mockRejectedValue(new Error("Unavailable"));
    const next = await collectProvider(manifest, core, { sources: {} }, later);
    expect(next.coverage.status).toBe("stale");
    expect(next.invocation).toEqual(core.invocation);
    if (core.invocation === undefined) throw new Error("Missing invocation facts");
    const empty = {
      ...catalog(next, later),
      models: [],
      invocation: { ...core.invocation, invocation_targets: [] },
    };
    // The provider's current model partition cannot satisfy retained commercial references.
    const composed = composeCatalogPair(core, empty, prices, [
      failedPricingTransition("typesafe", later, "provider_refresh_failed"),
    ]);
    expect(composed.catalog.invocation).toEqual(core.invocation);
  });

  it("revalidates retained price bindings and preserves reviewed joins in compilation inputs", async () => {
    const { core, prices, bindings, candidate, result } = await initial();
    const invocation = core.invocation;
    if (invocation === undefined || result.pricingReplaySources === undefined)
      throw new Error("Missing replay facts");
    expect(reconcileInvocationBindings(invocation, prices, [], { invocation, bindings })).toEqual(
      bindings,
    );
    const changed = structuredClone(invocation);
    const surface = changed.surfaces[0];
    if (surface === undefined) throw new Error("Missing surface");
    surface.path_template = "/v2/systemone";
    expect(reconcileInvocationBindings(changed, prices, [], { invocation, bindings })).toEqual([]);
    const snapshot = createPricingCompilationSnapshot(candidate, [
      { provider_id: "typesafe", sources: result.pricingReplaySources },
    ]);
    expect(snapshot.providers[0]?.sources[0]?.invocation_pricing).toHaveLength(3);
    const compiled = await compilePricingSnapshot(candidate, snapshot);
    expect(compiled.candidate.v2?.pricing.data.invocation_bindings).toEqual(bindings);
  });
});
