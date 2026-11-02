import { gunzipSync } from "node:zlib";
import { expect, it, vi } from "vite-plus/test";
import type { LinkedBundle } from "../src/catalog/bundle.ts";
import { collectProvider } from "../src/catalog/collector.ts";
import { fetchSource } from "../src/catalog/fetch.ts";
import { manifests } from "../src/catalog/manifests.ts";
import { sha256 } from "../src/catalog/io.ts";
import { composeCatalogPair, coreCatalogVersion } from "../src/catalog/pricing-pair-transition.ts";
import {
  prepareCatalogPair,
  type CatalogPairCandidate,
} from "../src/catalog/pricing-publication.ts";
import { compileInferencePriceMapping } from "../src/catalog/inference-pricing-compilation.ts";
import { emptyPricingCatalog } from "../src/catalog/pricing-schema.ts";
import { calculationExport } from "../src/catalog/pricing-calculator-export.ts";
import { createInferencePriceLookup } from "../src/pricing/inference.ts";
import type { Selector } from "../src/pricing/schema.ts";
import { projectCatalogPair } from "../src/catalog/projections.ts";
import { compressedAsset } from "../src/catalog/asset-pack.ts";
import { websiteDetailChunkSchema } from "../src/catalog/website-schema.ts";
import { queryWebsiteInferencePrice } from "../src/catalog/inference-price-presentation.ts";
import { restoreWebsiteInferenceDetail } from "./website-inference-detail.ts";
import type { Catalog } from "../src/catalog/schema.ts";
import { xaiInferenceBundle } from "./xai-inference-fixture.ts";

vi.mock("../src/catalog/fetch.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/catalog/fetch.ts")>()),
  fetchSource: vi.fn(),
}));
const at = "2026-10-30T17:45:00.000Z";
async function collect(change?: (bundle: LinkedBundle) => void, previous?: CatalogPairCandidate) {
  const manifest = manifests.find(({ provider }) => provider.id === "xai");
  const catalog = manifest?.sources.find(({ id }) => id === "xai-models");
  if (!manifest || !catalog) throw new Error("Missing xAI sources");
  const bundle = await xaiInferenceBundle();
  change?.(bundle);
  const bodies = new Map([[catalog.id, JSON.stringify(bundle)]]);
  vi.mocked(fetchSource).mockImplementation(async (source) => {
    const body = bodies.get(source.id);
    if (!body) throw new Error("Missing fixture");
    return {
      body,
      contentHash: sha256(body),
      etag: undefined,
      lastModified: undefined,
      dependencies: [],
    };
  });
  const result = await collectProvider(
    { ...manifest, sources: [catalog] },
    previous?.catalog,
    { sources: {} },
    at,
  );
  if (!result.pricing) throw new Error(JSON.stringify(result.attempt));
  const core: Catalog = {
    catalog_version: coreCatalogVersion([result.provider]),
    generated_at: at,
    providers: [result.provider],
    models: result.models,
    sources: result.sources,
    coverage: [result.coverage],
    warnings: result.warnings,
  };
  const composed = composeCatalogPair(
    previous?.catalog,
    core,
    previous?.pricing.data ?? emptyPricingCatalog(),
    [{ kind: "fresh", partition: result.pricing }],
  );
  return {
    candidate: compileInferencePriceMapping(
      prepareCatalogPair(composed.catalog, composed.pricing),
      result.inferencePriceSources ?? [],
      previous,
    ),
    facts: result.inferencePriceSources?.flatMap(({ rules }) => rules) ?? [],
  };
}
function lookup(candidate: CatalogPairCandidate) {
  return createInferencePriceLookup(
    calculationExport(candidate.catalog, candidate.pricing),
    candidate.inference?.mapping,
  );
}

function categorical(
  dimension: "endpoint" | "served_service_tier" | "resolution" | "operation",
  value: string,
): Selector {
  return {
    kind: "categorical",
    dimension: { namespace: "kmodels", value: dimension },
    value: { namespace: "provider", provider_id: "xai", value },
  };
}
const context: Selector = {
  kind: "decimal",
  dimension: { namespace: "kmodels", value: "context_tokens" },
  value: "1000",
  unit: { factors: [{ unit: { namespace: "kmodels", value: "token" }, power: 1 }] },
};
function offerRef(query: ReturnType<typeof lookup>, model_id: string, key: string) {
  const offer = query({ provider_id: "xai", model_id }).candidates.find(
    ({ offer }) => offer.offer_key === key,
  )?.offer;
  if (!offer) throw new Error(`Missing ${model_id} ${key} offer`);
  return offer.id;
}

it("maps exact structured IDs and declared aliases to the same canonical offers", async () => {
  const { candidate, facts } = await collect();
  const query = lookup(candidate);
  const base = query({ provider_id: "xai", model_id: "grok-4.3" });
  const alias = query({ provider_id: "xai", model_id: "grok-4.3-latest" });
  expect(alias.candidates.map(({ offer }) => offer.id)).toEqual(
    base.candidates.map(({ offer }) => offer.id),
  );
  expect(alias.candidates.map(({ offer }) => offer.offer_key).sort()).toEqual(["batch", "sync"]);
  expect(alias.status).toBe("candidates");
  expect(alias.requires_offer_choice).toBe(true);
  expect(alias.missing_conditions.map(({ value }) => value).sort()).toEqual([
    "context_tokens",
    "endpoint",
    "served_service_tier",
  ]);
  expect(
    facts
      .filter(({ model_id }) => model_id === "grok-4.3")
      .every(({ fixed_selectors }) => fixed_selectors.length === 0),
  ).toBe(true);
  for (const model_id of [
    "grok-4.7-latest",
    "us.grok-4.7",
    "xai/grok-4.7",
    "private-deployment",
    "Grok 4.7",
  ])
    expect(query({ provider_id: "xai", model_id }).reason).toBe("unreviewed_id");
});

it("selects regional Standard, realized Priority, and Batch prices without guessing a tier", async () => {
  const { candidate } = await collect();
  const query = lookup(candidate);
  const args = { provider_id: "xai", model_id: "grok-4.7" };
  for (const [region, tier, key, numerator, denominator] of [
    ["https://api.x.ai/v1", "default", "sync", "1", "500000"],
    ["https://us.api.x.ai/v1", "default", "sync", "11", "5000000"],
    ["https://api.x.ai/v1", "priority", "sync", "1", "250000"],
    ["https://us.api.x.ai/v1", "priority", "sync", "11", "2500000"],
    ["https://api.x.ai/v1", "", "batch", "1", "625000"],
  ]) {
    if (!region || tier === undefined || !key) throw new Error("Missing test condition");
    const selectors = [
      context,
      categorical("endpoint", region),
      ...(tier ? [categorical("served_service_tier", tier)] : []),
    ];
    const result = query({ ...args, offer_ref: offerRef(query, args.model_id, key), selectors });
    expect(result.status).toBe("matched");
    expect(
      result.candidates.flatMap(({ offer }) =>
        offer.terms.flatMap((term) =>
          term.kind === "rate" && term.meter.value === "input_text"
            ? term.variants.map(({ price }) => price.value)
            : [],
        ),
      ),
    ).toEqual([{ numerator, denominator }]);
  }
  const sync = offerRef(query, args.model_id, "sync");
  expect(
    query({
      ...args,
      offer_ref: sync,
      selectors: [context, categorical("endpoint", "https://api.x.ai/v1")],
    }),
  ).toMatchObject({
    status: "candidates",
    missing_conditions: [{ namespace: "kmodels", value: "served_service_tier" }],
  });
  expect(
    query({
      ...args,
      offer_ref: offerRef(query, args.model_id, "batch"),
      selectors: [
        context,
        categorical("endpoint", "https://us.api.x.ai/v1"),
        categorical("served_service_tier", "default"),
      ],
    }),
  ).toMatchObject({ status: "unknown", reason: "no_applicable_price", candidates: [] });
});

it("maps media and realtime IDs to the documented global tariff without a cluster selector", async () => {
  const { candidate } = await collect();
  const query = lookup(candidate);
  for (const [model_id, key, selectors] of [
    ["grok-imagine-image", "direct", [categorical("resolution", "1K")]],
    ["grok-imagine-image", "batch", [categorical("resolution", "1K")]],
    ["grok-imagine-video", "direct", [categorical("resolution", "480p")]],
    ["grok-voice-latest", "realtime", []],
  ] as const) {
    const result = query({
      provider_id: "xai",
      model_id,
      offer_ref: offerRef(query, model_id, key),
      selectors: [...selectors],
    });
    expect(result.status, model_id).toBe("matched");
    expect(result.missing_conditions).toEqual([]);
    expect(
      result.candidates
        .flatMap(({ offer }) =>
          offer.terms.flatMap((term) => (term.kind === "rate" ? term.variants : [])),
        )
        .some((variant) => JSON.stringify(variant.applicability).includes('"region"')),
    ).toBe(false);
    expect(
      query({
        provider_id: "xai",
        model_id,
        selectors: [categorical("endpoint", "https://us.api.x.ai/v1")],
      }).reason,
    ).toBe("incompatible_conditions");
  }
  const image = query({
    provider_id: "xai",
    model_id: "grok-imagine-image",
    offer_ref: offerRef(query, "grok-imagine-image", "direct"),
    selectors: [categorical("resolution", "1K")],
  });
  expect(
    image.candidates.flatMap(({ offer }) =>
      offer.terms.flatMap((term) =>
        term.kind === "rate" && term.meter.value === "image_generation"
          ? term.variants.map(({ price }) => price.value)
          : [],
      ),
    ),
  ).toEqual([{ numerator: "1", denominator: "50" }]);
  for (const model_id of ["grok-tts", "grok-voice-transcribe-2.0", "grok-stt"])
    expect(query({ provider_id: "xai", model_id }).candidates).toEqual([]);
});

it("preserves reviewed redirects and exposes conflicting alias identity rather than choosing a price", async () => {
  const { candidate } = await collect();
  const query = lookup(candidate);
  const legacy = query({ provider_id: "xai", model_id: "grok-3" });
  expect(legacy.candidates.length).toBeGreaterThan(0);
  expect(legacy.candidates.every(({ model_ref }) => model_ref === "xai/grok-3")).toBe(true);
  for (const model_id of ["grok-code-fast-1", "grok-imagine-image-pro"])
    expect(query({ provider_id: "xai", model_id })).toMatchObject({
      status: "unknown",
      reason: "ambiguous_identity",
      candidates: [],
    });
});

it("withdraws an alias from fresh source evidence even if the catalog retains its old alias", async () => {
  const { candidate: previous } = await collect();
  const { candidate } = await collect((bundle) => {
    bundle.index.body = bundle.index.body.replaceAll(
      '"grok-4.3-latest"',
      '"grok-4.3-reviewed-alias"',
    );
  }, previous);
  const query = lookup(candidate);
  expect(query({ provider_id: "xai", model_id: "grok-4.3-latest" }).reason).toBe("unreviewed_id");
  expect(query({ provider_id: "xai", model_id: "grok-4.3-reviewed-alias" }).status).toBe(
    "candidates",
  );
  expect(query({ provider_id: "xai", model_id: "grok-4.3" }).status).toBe("candidates");
});

it("keeps direct text ID prices when optional protocol and release-note sections disappear", async () => {
  const { candidate } = await collect((bundle) => {
    for (const document of bundle.documents)
      document.body = document.body.replace(
        /===([^\n]+)===\n([\s\S]*?)(?=\n===|$)/g,
        (section: string, path: string) =>
          path.includes("model-capabilities/text") || path.includes("release-notes") ? "" : section,
      );
  });
  expect(lookup(candidate)({ provider_id: "xai", model_id: "grok-4.7" }).candidates).toHaveLength(
    2,
  );
});

it("uses identical conditional matching in the static UI with compact evidence", async () => {
  const { candidate } = await collect();
  const projected = await projectCatalogPair(candidate);
  const details = projected.ui.manifest.assets
    .filter(({ file_name }) => file_name.includes("/details/"))
    .flatMap(
      (asset) =>
        websiteDetailChunkSchema.parse(
          JSON.parse(gunzipSync(compressedAsset(projected.ui.pack, asset)).toString()),
        ).details,
    )
    .map(restoreWebsiteInferenceDetail);
  const price = details.find(({ model_ref }) => model_ref === "xai/grok-4.7@1.0")
    ?.inference_prices?.[0];
  if (!price) throw new Error("Missing website mapping");
  expect(queryWebsiteInferencePrice(price, [], at).status).toBe("candidates");
  const ref = offerRef(lookup(candidate), "grok-4.7", "sync");
  expect(
    queryWebsiteInferencePrice(
      price,
      [
        context,
        categorical("endpoint", "https://us.api.x.ai/v1"),
        categorical("served_service_tier", "default"),
      ],
      at,
      ref,
    ).status,
  ).toBe("matched");
  expect(JSON.stringify(price)).not.toContain("content_hash");
  const voice = details
    .find(({ model_ref }) => model_ref === "xai/grok-voice-3.0@1.0")
    ?.inference_prices?.find(({ model_id }) => model_id === "grok-voice-latest");
  if (!voice) throw new Error("Missing voice website mapping");
  expect(queryWebsiteInferencePrice(voice, [], at)).toMatchObject({
    status: "matched",
    missing_conditions: [],
  });
  expect(
    queryWebsiteInferencePrice(voice, [categorical("endpoint", "https://us.api.x.ai/v1")], at)
      .reason,
  ).toBe("incompatible_conditions");
});

it("withdraws endpoint associations when their owned commercial scope disappears", async () => {
  const { candidate: previous } = await collect();
  const { candidate, facts } = await collect((bundle) => {
    for (const document of bundle.documents)
      document.body = document.body.replace(
        "## US Regional Endpoint Pricing",
        "## Unreviewed endpoint terms",
      );
  }, previous);
  expect(candidate.catalog.models.some(({ model_id }) => model_id === "grok-4.7")).toBe(true);
  expect(facts.some(({ model_id }) => model_id === "grok-4.7")).toBe(false);
  expect(facts.some(({ model_id }) => model_id === "grok-imagine-image")).toBe(true);
  expect(lookup(candidate)({ provider_id: "xai", model_id: "grok-4.7" }).reason).toBe(
    "unreviewed_id",
  );
});

it("withdraws media scope independently of text pricing when the regional guide changes", async () => {
  const { candidate: previous } = await collect();
  const { candidate } = await collect((bundle) => {
    for (const document of bundle.documents)
      document.body = document.body.replaceAll(
        "The image generation, video generation, and voice APIs are not served by the US endpoint; use the global endpoint for those.",
        "Unreviewed media endpoint scope.",
      );
  }, previous);
  const query = lookup(candidate);
  expect(query({ provider_id: "xai", model_id: "grok-imagine-image" }).reason).toBe(
    "unreviewed_id",
  );
  expect(query({ provider_id: "xai", model_id: "grok-voice-latest" }).reason).toBe("unreviewed_id");
  expect(query({ provider_id: "xai", model_id: "grok-4.7" }).status).toBe("candidates");
});

it("uses the exact Grok Build table rows and keeps unproved Batch availability unknown", async () => {
  const { candidate } = await collect();
  const query = lookup(candidate);
  const args = { provider_id: "xai", model_id: "grok-build-0.1" };
  expect(query(args).candidates.map(({ offer }) => offer.offer_key)).toEqual(["sync"]);
  const result = query({
    ...args,
    selectors: [
      context,
      categorical("endpoint", "https://api.x.ai/v1"),
      categorical("served_service_tier", "default"),
    ],
  });
  expect(result.status).toBe("matched");
  expect(
    result.candidates.flatMap(({ offer }) =>
      offer.terms.flatMap((term) =>
        term.kind === "rate" && term.meter.value === "input_text"
          ? term.variants.map(({ price }) => price.value)
          : [],
      ),
    ),
  ).toEqual([{ numerator: "1", denominator: "1000000" }]);
});
