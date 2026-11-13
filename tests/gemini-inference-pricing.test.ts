import { gunzipSync } from "node:zlib";
import { load } from "cheerio";
import { beforeAll, expect, it, vi } from "vite-plus/test";
import type { LinkedBundle } from "../src/catalog/bundle.ts";
import type { Selector } from "../src/pricing/schema.ts";
import { geminiInferenceFixtures } from "./gemini-inference-fixture.ts";
import { collectProvider } from "../src/catalog/collector.ts";
import { fetchSource } from "../src/catalog/fetch.ts";
import { manifests, type ProviderManifest } from "../src/catalog/manifests.ts";
import { sha256 } from "../src/catalog/io.ts";
import { composeCatalogPair, coreCatalogVersion } from "../src/catalog/pricing-pair-transition.ts";
import {
  prepareCatalogPair,
  type CatalogPairCandidate,
} from "../src/catalog/pricing-publication.ts";
import { compileInferencePriceMapping } from "../src/catalog/inference-pricing-compilation.ts";
import { emptyPricingCatalog } from "../src/catalog/pricing-schema.ts";
import { priceDataExport } from "../src/catalog/pricing-lookup-export.ts";
import { createInferencePriceLookup } from "../src/pricing/inference.ts";
import { projectCatalogPair } from "../src/catalog/projections.ts";
import { compressedAsset } from "../src/catalog/asset-pack.ts";
import { websiteDetailChunkSchema } from "../src/catalog/website-schema.ts";
import { queryWebsiteInferencePrice } from "../src/catalog/inference-price-presentation.ts";
import { restoreWebsiteInferenceDetail } from "./website-inference-detail.ts";
import type { Catalog } from "../src/catalog/schema.ts";

vi.mock("../src/catalog/fetch.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/catalog/fetch.ts")>()),
  fetchSource: vi.fn(),
}));
const at = "2026-10-30T19:00:00.000Z";
const manifest: ProviderManifest | undefined = manifests.find(
  ({ provider }) => provider.id === "gemini",
);
const source = manifest?.sources.find(({ id }) => id === "gemini-pricing");
const catalog = manifest?.sources.find(({ id }) => id === "gemini-models");
if (!manifest || !source || !catalog) throw new Error("Missing Gemini sources");
const configured: ProviderManifest = { ...manifest, sources: [catalog, source] };
async function collect(change?: (bundle: LinkedBundle) => void, previous?: CatalogPairCandidate) {
  const fixtures = await geminiInferenceFixtures();
  change?.(fixtures.pricing);
  const bodies = new Map([
    [catalog?.id, JSON.stringify(fixtures.catalog)],
    [source?.id, JSON.stringify(fixtures.pricing)],
  ]);
  vi.mocked(fetchSource).mockImplementation(async (input) => {
    const body = bodies.get(input.id);
    if (!body) throw new Error("Missing Gemini source fixture");
    return {
      body,
      contentHash: sha256(body),
      etag: undefined,
      lastModified: undefined,
      dependencies: [],
    };
  });
  const result = await collectProvider(configured, previous?.catalog, { sources: {} }, at);
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
  const pair = composeCatalogPair(
    previous?.catalog,
    core,
    previous?.pricing.data ?? emptyPricingCatalog(),
    [{ kind: "fresh", partition: result.pricing }],
  );
  return compileInferencePriceMapping(
    prepareCatalogPair(pair.catalog, pair.pricing),
    result.inferencePriceSources ?? [],
    previous,
  );
}
let baseline: CatalogPairCandidate;
beforeAll(async () => {
  baseline = await collect();
}, 20000);
function lookup(candidate = baseline) {
  return createInferencePriceLookup(
    priceDataExport(candidate.catalog, candidate.pricing),
    candidate.inference?.mapping,
  );
}

function condition(
  dimension: "account_eligibility" | "served_service_tier",
  value: string,
): Selector {
  return {
    kind: "categorical",
    dimension: { namespace: "kmodels", value: dimension },
    value: { namespace: "provider", provider_id: "gemini", value },
  };
}
const context: Selector = {
  kind: "decimal",
  dimension: { namespace: "kmodels", value: "context_tokens" },
  value: "1000",
  unit: { factors: [{ unit: { namespace: "kmodels", value: "token" }, power: 1 }] },
};
const paid = condition("account_eligibility", "paid_tier");
const standard = condition("served_service_tier", "standard");

it("selects independent account programs with canonical ownership and preserves their execution choices", () => {
  const query = lookup();
  const args = { provider_id: "gemini", model_id: "gemini-3.1-pro-preview", selectors: [context] };
  const choose = (plan: string, execution: string) =>
    query({
      ...args,
      choices: [
        { dimension: "account_plan", value: { namespace: "kmodels", value: plan } },
        { dimension: "execution", value: { namespace: "kmodels", value: execution } },
        ...(plan === "paid_tier" && execution === "request"
          ? [
              {
                dimension: "served_service_tier" as const,
                value: { namespace: "kmodels" as const, value: "standard" },
              },
            ]
          : []),
      ],
    });
  const paidRequest = choose("paid_tier", "request");
  const paidBatch = choose("paid_tier", "batch");
  const contributor = choose("paid_tier_contributor", "request");
  for (const result of [paidRequest, paidBatch, contributor]) expect(result.status).toBe("matched");
  expect(paidRequest.candidates[0]?.offer.id).toBe(paidBatch.candidates[0]?.offer.id);
  expect(contributor.candidates[0]?.offer.id).not.toBe(paidRequest.candidates[0]?.offer.id);
  expect(
    query(args)
      .available_choices.filter((c) => c.dimension === "account_plan")
      .every((c) => c.targets?.includes("offer")),
  ).toBe(true);
  expect(query(args).requires_offer_choice).toBe(true);
  expect(query(args).missing_conditions).toContainEqual({
    namespace: "kmodels",
    value: "account_eligibility",
  });
});

function rates(result: ReturnType<ReturnType<typeof lookup>>, meter: string) {
  return result.candidates.flatMap(({ offer }) =>
    offer.terms.flatMap((term) =>
      term.kind === "rate" && term.meter.value === meter
        ? term.variants.map(({ price }) => price.value)
        : [],
    ),
  );
}

it("matches exact price-table IDs, the documented alias and resource-name form", () => {
  expect(new Set(baseline.inference?.mapping.rules.map(({ model_id }) => model_id)).size).toBe(76);
  for (const model_id of [
    "gemini-3.1-pro-preview",
    "gemini-3.1-pro-preview-customtools",
    "models/gemini-3.1-pro-preview",
  ]) {
    const result = lookup()({
      provider_id: "gemini",
      model_id,
      execution_mode: "request",
      selectors: [paid, standard, context],
    });
    expect(result.status).toBe("matched");
    expect(result.query.model_id).toBe(model_id);
    expect(rates(result, "input_text")).toEqual([{ numerator: "1", denominator: "500000" }]);
  }
});
it("keeps account eligibility, served tier, context and Batch as commercial choices", () => {
  const args = { provider_id: "gemini", model_id: "gemini-3.1-pro-preview" };
  const unresolved = lookup()(args);
  expect(unresolved.status).toBe("candidates");
  expect(unresolved.requires_offer_choice).toBe(true);
  expect(unresolved.missing_conditions.map(({ value }) => value).sort()).toEqual([
    "account_eligibility",
    "context_tokens",
    "execution",
    "served_service_tier",
  ]);
  const batch = lookup()({
    ...args,
    execution_mode: "batch",
    selectors: [paid, context],
  });
  expect(batch.status).toBe("matched");
  expect(batch.missing_conditions).toEqual([]);
  expect(rates(batch, "input_text")).toEqual([{ numerator: "1", denominator: "1000000" }]);
});
it("restores Gemma free input and cache rates without treating a paid account as free", () => {
  const args = { provider_id: "gemini", model_id: "gemma-4-31b-it" };
  const result = lookup()({ ...args, selectors: [condition("account_eligibility", "free_tier")] });
  expect(result.status).toBe("matched");
  for (const meter of [
    "input_text",
    "input_image",
    "cache_read_text",
    "cache_read_image",
    "output_text",
  ])
    expect(rates(result, meter)).toEqual([{ numerator: "0", denominator: "1" }]);
  expect(lookup()({ ...args, selectors: [paid] }).reason).toBe("no_applicable_price");
});

it("treats Contributor as an invitation and data-sharing pricing program, not an observed service tier", () => {
  const model_id = "gemini-3.1-pro-preview";
  const result = lookup()({
    provider_id: "gemini",
    model_id,
    execution_mode: "request" as const,
    selectors: [condition("account_eligibility", "paid_tier_contributor"), context],
  });
  expect(result.status).toBe("matched");
  expect(result.missing_conditions).toEqual([]);
  expect(rates(result, "input_text")).toEqual([{ numerator: "1", denominator: "1000000" }]);
  expect(
    result.candidates
      .flatMap(({ offer }) =>
        offer.terms.flatMap((term) =>
          term.kind === "rate"
            ? term.variants.flatMap(({ selector_sources }) => selector_sources ?? [])
            : [],
        ),
      )
      .some(({ dimension }) => dimension.value === "served_service_tier"),
  ).toBe(false);
  expect(
    baseline.pricing.data.provider_vocabularies
      .flatMap(({ atoms }) => atoms)
      .some(
        (atom) =>
          atom.kind === "categorical_value" &&
          atom.dimension.value === "served_service_tier" &&
          atom.key === "contributor",
      ),
  ).toBe(false);
  const freeModel = "gemini-3.5-flash-lite";
  const free = lookup()({
    provider_id: "gemini",
    model_id: freeModel,
    execution_mode: "request" as const,
    selectors: [condition("account_eligibility", "free_tier_contributor")],
  });
  expect(free.status).toBe("matched");
  expect(rates(free, "input_text")).toEqual([{ numerator: "0", denominator: "1" }]);
  expect(rates(free, "cache_read_text")).toEqual([]);
});

it("leaves Contributor raw when its required program evidence changes while preserving Standard", async () => {
  const candidate = await collect((bundle) => {
    expect(bundle.index.body).toContain("invite-only basis");
    bundle.index.body = bundle.index.body.replaceAll("invite-only basis", "open enrollment basis");
  });
  const model_id = "gemini-3.1-pro-preview";
  const args = { provider_id: "gemini", model_id, execution_mode: "request" as const };
  expect(
    lookup(candidate)({
      ...args,
      selectors: [condition("account_eligibility", "paid_tier_contributor"), context],
    }).reason,
  ).toBe("unresolved_price");
  expect(lookup(candidate)({ ...args, selectors: [paid, standard, context] }).status).toBe(
    "matched",
  );
  expect(
    lookup(candidate)({
      provider_id: "gemini",
      model_id: "gemini-3.5-flash-lite",
      execution_mode: "request" as const,
      selectors: [condition("account_eligibility", "free_tier_contributor")],
    }).reason,
  ).toBe("unresolved_price");
}, 15000);
it("returns date-only promotion rates with unresolved effective time", () => {
  const result = lookup()({
    provider_id: "gemini",
    model_id: "gemini-4-argon",
    execution_mode: "request" as const,
    selectors: [paid, standard],
  });
  expect(result.status).toBe("candidates");
  expect(result.candidates.flatMap(({ gaps }) => gaps)).toContainEqual(
    expect.objectContaining({ code: "unresolved_validity" }),
  );
  expect(
    result.candidates
      .flatMap(({ offer }) => offer.terms)
      .flatMap((term) => (term.kind === "rate" ? term.variants : []))
      .map(({ validity }) => validity?.until),
  ).toContainEqual({ value: "2026-11-30", precision: "date" });
});
it("does not borrow prices for latest aliases, regional IDs, agents or private resources", () => {
  for (const model_id of [
    "gemini-flash-latest",
    "us.gemini-3.1-pro-preview",
    "publishers/google/models/gemini-3.1-pro-preview",
    "my-deployment",
    "deep-research-preview-04-2026",
    "veo-3.1-generate-preview",
  ])
    expect(lookup()({ provider_id: "gemini", model_id }).reason).toBe("unreviewed_id");
});
it("withdraws an exact ID mapping even when retained catalog pricing still exists", async () => {
  const candidate = await collect((bundle) => {
    const $ = load(bundle.index.body);
    const section = $(".models-section").filter((_, node) =>
      $(node)
        .find(".heading-group code")
        .toArray()
        .some((code) => $(code).text() === "gemini-3.1-pro-preview"),
    );
    expect(section.length).toBe(1);
    section.nextUntil(".models-section").remove();
    section.remove();
    bundle.index.body = $.html();
  }, baseline);
  expect(
    candidate.catalog.models.some(({ model_id }) => model_id === "gemini-3.1-pro-preview"),
  ).toBe(true);
  expect(
    lookup(candidate)({ provider_id: "gemini", model_id: "gemini-3.1-pro-preview" }).reason,
  ).toBe("unreviewed_id");
  expect(lookup(candidate)({ provider_id: "gemini", model_id: "gemma-4-31b-it" }).status).toBe(
    "candidates",
  );
}, 15000);
it("removes optional resource-name proofs independently of literal ID tariffs", async () => {
  const candidate = await collect((bundle) => {
    bundle.documents = [];
  }, baseline);
  expect(
    lookup(candidate)({ provider_id: "gemini", model_id: "models/gemini-3.1-pro-preview" }).reason,
  ).toBe("unreviewed_id");
  const model_id = "gemini-3.1-pro-preview";
  expect(
    lookup(candidate)({
      provider_id: "gemini",
      model_id,
      selectors: [
        paid,
        standard,
        context,
        {
          kind: "categorical",
          dimension: { namespace: "provider", provider_id: "gemini", value: "invocation_mode" },
          value: { namespace: "provider", provider_id: "gemini", value: "sync" },
        },
      ],
    }).status,
  ).toBe("matched");
}, 15000);
it("detects resource-name format drift without spreading a new prefix", async () => {
  const candidate = await collect((bundle) => {
    const document = bundle.documents.find(({ url }) => url.includes("$discovery"));
    if (!document) throw new Error("Missing Discovery");
    document.body = document.body.replaceAll("models/{model}", "deployments/{model}");
  });
  expect(
    lookup(candidate)({ provider_id: "gemini", model_id: "models/gemini-3.1-pro-preview" }).reason,
  ).toBe("unreviewed_id");
  expect(
    lookup(candidate)({ provider_id: "gemini", model_id: "deployments/gemini-3.1-pro-preview" })
      .reason,
  ).toBe("unreviewed_id");
  expect(
    lookup(candidate)({ provider_id: "gemini", model_id: "gemini-3.1-pro-preview" }).status,
  ).toBe("candidates");
}, 15000);
it("uses the same conditions in compact website data", async () => {
  const projected = await projectCatalogPair(baseline);
  const details = projected.ui.manifest.assets
    .filter(({ file_name }) => file_name.includes("/details/"))
    .flatMap(
      (asset) =>
        websiteDetailChunkSchema.parse(
          JSON.parse(gunzipSync(compressedAsset(projected.ui.pack, asset)).toString()),
        ).details,
    )
    .map(restoreWebsiteInferenceDetail);
  const price = details
    .find(({ model_ref }) => model_ref === "gemini/gemini-3.1-pro-preview")
    ?.inference_prices?.find(({ model_id }) => model_id === "models/gemini-3.1-pro-preview");
  if (!price) throw new Error("Missing Gemini website association");
  const ref = undefined;
  expect(
    queryWebsiteInferencePrice(price, [paid, standard, context], at, ref, "request").status,
  ).toBe("matched");
  expect(JSON.stringify(price)).not.toMatch(
    /content_hash|invocation_target|GenerateContentResponse/,
  );
}, 15000);
