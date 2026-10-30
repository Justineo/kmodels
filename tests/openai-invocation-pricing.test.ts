import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { linkedBundleSchema } from "../src/catalog/bundle.ts";
import { collectProvider } from "../src/catalog/collector.ts";
import { fetchSource } from "../src/catalog/fetch.ts";
import { sha256 } from "../src/catalog/io.ts";
import { invocationCaseId } from "../src/catalog/invocation-identity.ts";
import { manifests, type ProviderManifest } from "../src/catalog/manifests.ts";
import {
  openAiInvocationApiUrl,
  openAiInvocationRegionsUrl,
} from "../src/catalog/openai-invocation.ts";
import { reconcileInvocationBindings } from "../src/catalog/invocation-pricing.ts";
import { openAiWebSocketContracts } from "../src/catalog/openai-invocation-websocket.ts";
import {
  invocationOfferSelectorContracts,
  invocationOfferSelectorSources,
} from "../src/catalog/invocation-price-inputs.ts";
import { coreCatalogVersion } from "../src/catalog/pricing-pair-transition.ts";
import { prepareCatalogPair } from "../src/catalog/pricing-publication.ts";
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
  readFile(new URL(`./fixtures/openai/${name}`, import.meta.url), "utf8");

async function collected(
  operation: "embedding" | "responses" | "chat" | "realtime" = "embedding",
  accounting = operation,
  regionalControl = false,
) {
  const manifest: ProviderManifest | undefined = manifests.find(
    ({ provider }) => provider.id === "openai",
  );
  if (manifest === undefined || manifest.notConfiguredReason !== undefined)
    throw new Error("Missing provider");
  const bundle = linkedBundleSchema.parse(JSON.parse(await fixture("catalog.json")));
  const embeddingApi = await fixture("invocation-embedding.yaml");
  bundle.documents.push(
    {
      url: openAiInvocationApiUrl,
      // Synthetic operation control: retain the reviewed string model selector shape.
      body:
        operation === "responses" || operation === "chat"
          ? embeddingApi
              .replace(
                "  /embeddings:",
                operation === "responses" ? "  /responses:" : "  /chat/completions:",
              )
              .replace(
                "operationId: createEmbedding",
                operation === "responses"
                  ? "operationId: createResponse"
                  : "operationId: createChatCompletion",
              )
          : embeddingApi,
    },
    { url: openAiInvocationRegionsUrl, body: await fixture("invocation-regions.md") },
  );
  if (operation === "realtime") {
    bundle.index.body +=
      "\n- [GPT-Realtime-2.1](/api/docs/models/gpt-realtime-2.1.md): Reasoning model with tool use";
    bundle.documents.push(
      {
        url: "https://developers.openai.com/api/docs/models/gpt-realtime-2.1.md",
        body: await fixture("invocation-gpt-realtime-2.1.md"),
      },
      {
        url: openAiWebSocketContracts[0].url,
        body: await fixture("invocation-realtime.md"),
      },
    );
    const regions = bundle.documents.find(({ url }) => url === openAiInvocationRegionsUrl);
    if (regions === undefined) throw new Error("Missing regional companion");
    regions.body = await fixture("invocation-regions-realtime.md");
  }
  // Synthetic tariff control; the model, handshake and regional tuples are native fixtures.
  const realtimePrices =
    operation === "realtime"
      ? "\n\nRealtime and audio generation models\n\nStandard\n\n| Model | Modality | Input | Cached input | Output |\n| --- | --- | --- | --- | --- |\n| gpt-realtime-2.1 | Text | $4 | $0.40 | $24 |\n"
      : "";
  const bodies = new Map([
    ["openai-models", JSON.stringify(bundle)],
    ["openai-overview", await fixture("pricing-catalog.json")],
    [
      "openai-pricing",
      `${await fixture("pricing.md")}${realtimePrices}\n${await fixture("fixed-search.md")}`,
    ],
  ]);
  if (accounting !== "embedding")
    bodies.set(
      "openai-accounting",
      accounting === "realtime"
        ? await fixture("accounting-realtime.yaml")
        : accounting === "chat"
          ? await fixture("invocation-chat-tier.yaml")
          : "components:\n  schemas:\n    Response:\n      properties:\n        service_tier:\n          type: string",
    );
  if (regionalControl) {
    // Synthetic identity/scope control exercising the reviewed Astra EU/Fast price rule.
    for (const [source, body] of bodies)
      bodies.set(source, body.replaceAll("gpt-5.4", "gpt-6-astra"));
    bodies.set(
      "openai-pricing",
      `${bodies.get("openai-pricing")}\nFast mode is unavailable for GPT-6 Astra with EU data residency. Use Standard processing for those requests.`,
    );
  }
  vi.mocked(fetchSource).mockImplementation(async (source) => {
    const body = bodies.get(source.id);
    if (body === undefined) throw new Error(`Unexpected fixture source ${source.id}`);
    return {
      body,
      contentHash: sha256(body),
      etag: undefined,
      lastModified: undefined,
      dependencies: [],
    };
  });
  const selectedSources = manifest.sources.filter(({ id }) => bodies.has(id));
  const lastSource = selectedSources.pop();
  if (lastSource === undefined) throw new Error("Missing fixture sources");
  const selectedManifest: ProviderManifest = {
    ...manifest,
    sources: [...selectedSources, lastSource],
  };
  const result = await collectProvider(selectedManifest, undefined, { sources: {} }, at);
  const partition = result.pricing;
  const invocation = result.invocation;
  if (partition === undefined || invocation === undefined)
    throw new Error(JSON.stringify(result.attempt));
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
  return { core, pricing, bindings, invocation, bodies, selectedManifest };
}

describe("OpenAI invocation pricing publication", () => {
  it("applies producer retention guards during collection without removing fresh identity", async () => {
    const { core, bodies, selectedManifest } = await collected();
    const bundle = linkedBundleSchema.parse(JSON.parse(bodies.get("openai-models") ?? ""));
    bundle.documents = bundle.documents.filter(({ url }) => url !== openAiInvocationApiUrl);
    bodies.set("openai-models", JSON.stringify(bundle));
    const unchanged = await collectProvider(
      selectedManifest,
      core,
      { sources: {} },
      "2026-10-31T00:00:00.000Z",
    );
    expect(unchanged.invocation?.invocation_targets).toEqual(core.invocation?.invocation_targets);
    const card = bundle.documents.find(({ url }) => url.includes("text-embedding-3-large"));
    if (card === undefined) throw new Error("Missing embedding card");
    card.body = card.body.replace(
      "| `v1/embeddings` | Supported |",
      "| `v1/embeddings` | Not supported |",
    );
    bodies.set("openai-models", JSON.stringify(bundle));
    const changed = await collectProvider(
      selectedManifest,
      core,
      { sources: {} },
      "2026-10-31T00:00:00.000Z",
    );
    expect(changed.coverage.status).toBe("fresh");
    expect(changed.models.some(({ uid }) => uid === "openai/text-embedding-3-large")).toBe(true);
    expect(
      changed.invocation?.invocation_targets.some(
        ({ model_ref }) => model_ref === "openai/text-embedding-3-large",
      ),
    ).toBe(false);
  });

  it("fixes regional residency without replacing observed Fast tier or guessing the default origin", async () => {
    const { core, pricing, invocation } = await collected("responses", "responses", true);
    const target = invocation.invocation_targets.find(
      ({ model_ref }) => model_ref === "openai/gpt-6-astra",
    );
    const base = target?.cases[0];
    if (target === undefined || base === undefined) throw new Error("Missing Responses control");
    // Joint route cases are synthetic controls; native regional tuples are covered separately.
    for (const region of ["Europe (EEA + Switzerland)", "United States"]) {
      const entry = {
        ...base,
        request_region: { kind: "exact" as const, value: region },
        inference_geo: { kind: "exact" as const, value: region },
        deployment_type: { kind: "exact" as const, value: "regional_processing" },
      };
      entry.id = invocationCaseId(target.id, entry);
      target.cases.push(entry);
    }
    const bindings = reconcileInvocationBindings(invocation, pricing, []);
    const selected = bindings.filter(({ target_ref }) => target_ref === target.id);
    expect(selected).toHaveLength(3);
    const pair = prepareCatalogPair(core, pricing, bindings);
    if (pair.v2 === undefined) throw new Error("Missing regional pair");
    const calculator = await createCalculator(await calculationV2Export(pair.v2));
    for (const binding of selected) {
      const entry = target.cases.find(({ id }) => id === binding.case_ref);
      const regional = entry?.request_region.kind === "exact";
      const europe =
        entry?.request_region.kind === "exact" &&
        entry.request_region.value === "Europe (EEA + Switzerland)";
      expect(
        binding.selectors.find(({ dimension }) => dimension.value === "eu_data_residency")?.value,
      ).toEqual(regional ? { kind: "fixed", value: europe } : undefined);
      const observed = binding.selectors.find(({ value }) => value.kind === "observed")?.value;
      const offerRef = binding.offer_refs[0];
      if (observed?.kind !== "observed" || offerRef === undefined)
        throw new Error("Missing served tier");
      const selection = {
        offerRef,
        invocation: {
          targetRef: target.id,
          caseRef: binding.case_ref,
          observed: {
            [observed.input_ref]: {
              namespace: "provider" as const,
              provider_id: "openai",
              value: "fast",
            },
          },
        },
      };
      const result = calculator.calculate({
        evaluatedAt: at,
        components: [{ id: "regional", ...selection, quantities: [] }],
      });
      expect(result.unresolved.some(({ reason }) => reason === "not_supported")).toBe(europe);
      if (regional)
        expect(() =>
          calculator.bindInvocation({
            ...selection,
            selectors: [
              {
                kind: "boolean",
                dimension: {
                  namespace: "provider",
                  provider_id: "openai",
                  value: "eu_data_residency",
                },
                value: !europe,
              },
            ],
          }),
        ).toThrow(/contradicts/);
    }
  });

  it("publishes native Realtime regional handshakes with independent synchronous prices", async () => {
    const { core, pricing, bindings, invocation } = await collected("realtime");
    const model = core.models.find(({ model_id }) => model_id === "gpt-realtime-2.1");
    if (model === undefined) throw new Error("Missing Realtime model");
    const targets = invocation.invocation_targets.filter(
      ({ model_ref, cases }) =>
        model_ref === model.uid && cases.some(({ support }) => support.state === "supported"),
    );
    const unsupported = invocation.invocation_targets.filter(
      ({ model_ref, cases }) =>
        model_ref === model.uid && cases.every(({ support }) => support.state === "unsupported"),
    );
    expect(unsupported).toHaveLength(1);
    expect(bindings.some(({ target_ref }) => unsupported.some(({ id }) => id === target_ref))).toBe(
      false,
    );
    expect(targets).toHaveLength(3);
    expect(targets.map(({ cases }) => cases[0]?.inference_geo)).toEqual(
      expect.arrayContaining([
        { kind: "unknown" },
        { kind: "exact", value: "United States" },
        { kind: "exact", value: "Europe (EEA + Switzerland)" },
      ]),
    );
    const selected = bindings.filter(({ target_ref }) =>
      targets.some(({ id }) => id === target_ref),
    );
    expect(selected).toHaveLength(3);
    expect(
      selected.every(({ selectors }) => selectors.every(({ value }) => value.kind === "fixed")),
    ).toBe(true);
    const pair = prepareCatalogPair(core, pricing, bindings);
    if (pair.v2 === undefined) throw new Error("Missing v2 pair");
    const calculator = await createCalculator(await calculationV2Export(pair.v2));
    const detail = websiteInvocationDetail(core, model, bindings);
    if (detail === undefined) throw new Error("Missing UI detail");
    for (const binding of selected) {
      const offerRef = binding.offer_refs[0];
      if (offerRef === undefined) throw new Error("Missing Realtime offer");
      const selection = {
        offerRef,
        invocation: { targetRef: binding.target_ref, caseRef: binding.case_ref },
      };
      expect(calculator.bindInvocation(selection).missingInputs).toEqual([]);
      expect(
        selectWebsiteInvocation(detail, model, binding.target_ref, binding.case_ref)?.binding,
      ).toEqual(binding);
      expect(calculator.requirements(selection).charges.length).toBeGreaterThan(0);
    }
  });

  it("binds Chat served tier only with its own verified response contract", async () => {
    const { core, pricing, bindings, invocation } = await collected("chat");
    expect(bindings.length).toBeGreaterThan(0);
    expect(
      bindings.every(({ selectors }) => selectors.some(({ value }) => value.kind === "observed")),
    ).toBe(true);
    const pair = prepareCatalogPair(core, pricing, bindings);
    if (pair.v2 === undefined) throw new Error("Missing v2 pair");
    await createCalculator(await calculationV2Export(pair.v2));
    const changed = await collected("chat", "responses");
    expect(changed.bindings).toEqual([]);
    expect(
      reconcileInvocationBindings(changed.invocation, changed.pricing, [], {
        invocation,
        bindings,
      }),
    ).toEqual([]);
    expect((await collected("responses", "chat")).bindings).toEqual([]);
  });

  it("uses one observed served-tier contract across the reviewed synchronous price variants", async () => {
    const { core, pricing, bindings } = await collected("responses");
    const tierBindings = bindings.flatMap((binding) =>
      binding.selectors.filter(({ dimension }) => dimension.value === "served_service_tier"),
    );
    expect(tierBindings.length).toBeGreaterThan(0);
    expect(tierBindings.every(({ value }) => value.kind === "observed")).toBe(true);
    const pair = prepareCatalogPair(core, pricing, bindings);
    if (pair.v2 === undefined) throw new Error("Missing v2 pair");
    const calculator = await createCalculator(await calculationV2Export(pair.v2));
    const binding = bindings[0];
    const input = binding?.selectors.find(({ value }) => value.kind === "observed")?.value;
    const offerRef = binding?.offer_refs[0];
    if (binding === undefined || input?.kind !== "observed" || offerRef === undefined)
      throw new Error("Missing observed binding");
    for (const tier of ["standard", "fast", "flex"]) {
      const value = { namespace: "provider" as const, provider_id: "openai", value: tier };
      const selection = {
        offerRef,
        invocation: {
          targetRef: binding.target_ref,
          caseRef: binding.case_ref,
          observed: { [input.input_ref]: value },
        },
      };
      expect(calculator.bindInvocation(selection)).toMatchObject({
        missingInputs: [],
        selectors: expect.arrayContaining([
          {
            dimension: { namespace: "kmodels", value: "served_service_tier" },
            kind: "categorical",
            value,
          },
        ]),
      });
    }
    expect(
      calculator.bindInvocation({
        offerRef,
        invocation: { targetRef: binding.target_ref, caseRef: binding.case_ref },
      }).missingInputs,
    ).toEqual([{ kind: "observed", input: input.input_ref }]);
    const offers = pricing.books.flatMap(({ offers }) =>
      offers.filter(({ offer_key }) => offer_key === "sync"),
    );
    const sources = offers
      .flatMap(invocationOfferSelectorContracts)
      .filter(({ dimension }) => dimension.value === "served_service_tier");
    expect(sources.length).toBeGreaterThan(0);
    for (const source of sources)
      expect(source.normalization).toEqual({
        kind: "categorical_map",
        entries: expect.arrayContaining([
          {
            source_value: "default",
            value: { namespace: "provider", provider_id: "openai", value: "standard" },
          },
          {
            source_value: "fast",
            value: { namespace: "provider", provider_id: "openai", value: "fast" },
          },
          {
            source_value: "flex",
            value: { namespace: "provider", provider_id: "openai", value: "flex" },
          },
        ]),
      });
    expect(
      sources.some(
        ({ normalization }) =>
          normalization?.kind === "categorical_map" &&
          normalization.entries.some(({ value }) => value.value === "batch"),
      ),
    ).toBe(false);
    // V1 rate-local mappings remain scoped to their own applicability.
    expect(
      offers
        .flatMap(invocationOfferSelectorSources)
        .some((source) => source.normalization?.entries.length === 1),
    ).toBe(true);
  });

  it.each(["conflicting", "unmapped"])(
    "withholds an observed join with a %s peer mapping",
    async (mode) => {
      const { invocation, pricing } = await collected("responses");
      for (const book of pricing.books)
        for (const offer of book.offers)
          for (const source of invocationOfferSelectorSources(offer)) {
            if (
              mode === "unmapped" &&
              source.normalization?.entries.some(({ value }) => value.value === "fast")
            ) {
              delete source.normalization;
              continue;
            }
            if (mode !== "conflicting") continue;
            for (const entry of source.normalization?.entries ?? [])
              if (entry.value.value === "fast" && entry.source_value === "fast")
                entry.source_value = "default";
          }
      expect(reconcileInvocationBindings(invocation, pricing, [])).toEqual([]);
    },
  );

  it("binds the exact admitted operation through collection, publication, calculator and UI", async () => {
    const { core, pricing, bindings, invocation } = await collected();
    const model = core.models.find(({ model_id }) => model_id === "text-embedding-3-large");
    if (model === undefined) throw new Error("Missing embedding model");
    expect(bindings).toHaveLength(3);
    expect(
      bindings.every(
        (binding) =>
          invocation.invocation_targets.find(({ id }) => id === binding.target_ref)?.model_ref ===
          model.uid,
      ),
    ).toBe(true);
    const pair = prepareCatalogPair(core, pricing, bindings);
    if (pair.v2 === undefined) throw new Error("Missing v2 pair");
    const calculator = await createCalculator(await calculationV2Export(pair.v2));
    for (const binding of bindings) {
      const offerRef = binding.offer_refs[0];
      if (offerRef === undefined) throw new Error("Missing offer");
      const selection = {
        offerRef,
        invocation: { targetRef: binding.target_ref, caseRef: binding.case_ref },
      };
      const signal = calculator.requirements(selection).charges[0]?.alternatives[0]?.[0];
      if (signal === undefined) throw new Error("Missing billable quantity");
      const cost = calculator.calculate({
        evaluatedAt: at,
        components: [
          {
            id: "embedding",
            ...selection,
            quantities: [{ signal, value: { numerator: "1000000", denominator: "1" } }],
          },
        ],
      });
      expect(cost.status).toBe("calculated");
      expect(cost.subtotals[0]?.amount).toEqual({ numerator: "13", denominator: "100" });
      const detail = websiteInvocationDetail(core, model, bindings);
      if (detail === undefined) throw new Error("Missing UI detail");
      expect(
        selectWebsiteInvocation(detail, model, binding.target_ref, binding.case_ref)?.binding,
      ).toEqual(binding);
    }
  });

  it("does not turn a failed price refresh into a new invocation price claim", async () => {
    const { invocation, pricing, bindings } = await collected();
    pricing.provider_snapshots = pricing.provider_snapshots.map((snapshot) => ({
      provider_id: snapshot.provider_id,
      observed_at: snapshot.observed_at,
      publication: "retained",
      refresh_failure: { attempted_at: at, code: "pricing_validation_failed" },
    }));
    expect(reconcileInvocationBindings(invocation, pricing, [])).toEqual([]);
    expect(reconcileInvocationBindings(invocation, pricing, [], { invocation, bindings })).toEqual(
      bindings,
    );
  });
});
