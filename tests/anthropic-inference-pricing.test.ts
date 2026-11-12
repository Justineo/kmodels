import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { expect, it, vi } from "vite-plus/test";
import { anthropicBundle } from "./anthropic-fixture.ts";
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
import {
  websiteDetailChunkSchema,
  websiteOfferChunkSchema,
} from "../src/catalog/website-schema.ts";
import { queryWebsiteInferencePrice } from "../src/catalog/inference-price-presentation.ts";
import { restoreWebsiteInferenceDetail } from "./website-inference-detail.ts";
import { renderComponent } from "./render-component.ts";
import InferencePrices from "../src/components/InferencePrices.vue";
import type { Catalog } from "../src/catalog/schema.ts";

vi.mock("../src/catalog/fetch.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/catalog/fetch.ts")>()),
  fetchSource: vi.fn(),
}));
const at = "2026-07-21T00:00:00.000Z";
type Bundle = Awaited<ReturnType<typeof anthropicBundle>>;
async function collect(change?: (bundle: Bundle) => void, previous?: CatalogPairCandidate) {
  const manifest = manifests.find(({ provider }) => provider.id === "anthropic");
  const source = manifest?.sources.find(({ id }) => id === "anthropic-models");
  if (!manifest || !source) throw new Error("Missing Anthropic source");
  const bundle = await anthropicBundle();
  for (const doc of bundle.documents) {
    const file = doc.url.endsWith("/model-ids-and-versions.md")
      ? "invocation-model-ids.md"
      : doc.url.endsWith("/batch-processing.md")
        ? "inference-batch-ids.md"
        : undefined;
    if (file)
      doc.body = await readFile(new URL(`./fixtures/anthropic/${file}`, import.meta.url), "utf8");
  }
  change?.(bundle);
  const body = JSON.stringify(bundle);
  vi.mocked(fetchSource).mockResolvedValue({
    body,
    contentHash: sha256(body),
    etag: undefined,
    lastModified: undefined,
    dependencies: [],
  });
  const result = await collectProvider(
    { ...manifest, sources: [source] },
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
  return compileInferencePriceMapping(
    prepareCatalogPair(composed.catalog, composed.pricing),
    result.inferencePriceSources ?? [],
    previous,
  );
}
function select(key: "speed" | "inference_geo", value: string): Selector {
  return {
    kind: "categorical",
    dimension: { namespace: "kmodels", value: key },
    value: { namespace: "provider", provider_id: "anthropic", value },
  };
}
const selectors: Selector[] = [
  select("speed", "standard"),
  select("inference_geo", "global"),
  {
    kind: "decimal",
    dimension: { namespace: "kmodels", value: "cache_ttl_seconds" },
    value: "300",
    unit: { factors: [{ unit: { namespace: "kmodels", value: "second" }, power: 1 }] },
  },
];
function lookup(candidate: CatalogPairCandidate) {
  return createInferencePriceLookup(
    calculationExport(candidate.catalog, candidate.pricing),
    candidate.inference?.mapping,
  );
}
function offer(candidate: CatalogPairCandidate, key: string) {
  const found = candidate.pricing.data.books.flatMap((book) =>
    book.offers.filter(
      (offer) =>
        offer.offer_key === key &&
        (offer.model_refs ?? book.scope.model_refs).includes("anthropic/claude-opus-4-7"),
    ),
  )[0];
  if (!found) throw new Error(`Missing ${key} offer`);
  return found.id;
}
it("publishes direct ID/alias prices and distinguishes Messages from Batch without assuming a plan", async () => {
  const candidate = await collect();
  const query = lookup(candidate);
  const ambiguousPlan = query({
    provider_id: "anthropic",
    model_id: "claude-opus-legacy",
    selectors,
  });
  expect(ambiguousPlan.status).toBe("candidates");
  expect(ambiguousPlan.requires_offer_choice).toBe(true);
  expect(ambiguousPlan.execution_modes).toEqual(["batch", "request"]);
  expect(ambiguousPlan.requires_execution_mode_choice).toBe(true);
  expect(new Set(ambiguousPlan.candidates.map(({ offer }) => offer.offer_key))).toEqual(
    new Set(["sync", "batch"]),
  );
  for (const [key, denominator] of [
    ["sync", "200000"],
    ["batch", "400000"],
  ]) {
    const result = query({
      provider_id: "anthropic",
      model_id: "claude-opus-legacy",
      selectors,
      execution_mode: key === "batch" ? "batch" : "request",
    });
    expect(result.status).toBe("matched");
    expect(result.requires_offer_choice).toBe(false);
    expect(
      result.candidates.flatMap(({ offer }) =>
        offer.terms.flatMap((term) =>
          term.kind === "rate" && term.meter.value === "input_text"
            ? term.variants.map(({ price }) => price.value)
            : [],
        ),
      ),
    ).toEqual([{ numerator: "1", denominator }]);
  }
  const result = query({
    provider_id: "anthropic",
    model_id: "claude-opus-4-7",
    selectors,
    offer_ref: offer(candidate, "sync"),
  });
  expect(result.candidates[0]?.model_ref).toBe("anthropic/claude-opus-4-7");
  expect(
    candidate.inference?.mapping.rules.every(({ fixed_selectors }) => fixed_selectors.length === 0),
  ).toBe(true);
  expect(query({ provider_id: "anthropic", model_id: "us.claude-opus-4-7" }).reason).toBe(
    "unreviewed_id",
  );
  expect(
    query({ provider_id: "anthropic", model_id: "claude-opus-4-7", offer_ref: "0".repeat(64) })
      .reason,
  ).toBe("no_applicable_price");
});
it("uses the same selected offer in public static output and the interactive UI", async () => {
  const candidate = await collect();
  const projected = await projectCatalogPair(candidate);
  const parseAsset = (asset: (typeof projected.ui.manifest.assets)[number]) =>
    JSON.parse(gunzipSync(compressedAsset(projected.ui.pack, asset)).toString("utf8"));
  const details = projected.ui.manifest.assets
    .filter(({ file_name }) => file_name.includes("/details/"))
    .flatMap((asset) => websiteDetailChunkSchema.parse(parseAsset(asset)).details)
    .map(restoreWebsiteInferenceDetail);
  const offers = projected.ui.manifest.assets
    .filter(({ file_name }) => file_name.includes("/offers/"))
    .flatMap((asset) => websiteOfferChunkSchema.parse(parseAsset(asset)).offers);
  const detail = details.find(({ model_ref }) => model_ref === "anthropic/claude-opus-4-7");
  const id = detail?.inference_prices?.find(({ model_id }) => model_id === "claude-opus-legacy");
  if (!id) throw new Error("Missing alias projection");
  for (const key of ["sync", "batch"]) {
    const publicResult = lookup(candidate)({
      provider_id: "anthropic",
      model_id: id.model_id,
      selectors,
      offer_ref: offer(candidate, key),
    });
    const ui = queryWebsiteInferencePrice(
      id,
      selectors,
      at,
      undefined,
      key === "batch" ? "batch" : "request",
    );
    expect(ui.status).toBe(publicResult.status);
    expect(ui.candidates.map(({ offer_ref }) => offer_ref)).toEqual(
      publicResult.candidates.map(({ offer }) => offer.id),
    );
  }
  const html = await renderComponent(InferencePrices, {
    modelRef: detail?.model_ref,
    prices: detail?.inference_prices,
    offers,
  });
  expect(html).toMatch(/<label\b[^>]*>Execution<\/label>/);
  expect(html).toContain("Ordinary request");
  expect(html).toContain("Batch");
  expect(html).toContain("Served speed");
  expect(html).toContain("All applicable options");
  expect(html).not.toContain("Message Batches");
  expect(html).not.toContain("Inspect target");
  expect(JSON.stringify(id)).not.toContain("content_hash");
});
it("moves or withdraws explicit aliases independently of equal prices or retained display aliases", async () => {
  const previous = await collect();
  const moved = await collect((bundle) => {
    bundle.index.body = bundle.index.body
      .split("\n")
      .map((line) =>
        !line.includes("**Claude API alias**")
          ? line
          : line.includes("claude-fable-5")
            ? line.replace("claude-opus-4-8", "claude-opus-legacy")
            : line.replace("claude-opus-legacy", "claude-opus-4-7"),
      )
      .join("\n");
  }, previous);
  expect(
    lookup(moved)({ provider_id: "anthropic", model_id: "claude-opus-legacy" }).candidates[0]
      ?.model_ref,
  ).toBe("anthropic/claude-opus-4-8");
  const withdrawn = await collect((bundle) => {
    bundle.index.body = bundle.index.body.replaceAll(
      "**Claude API alias**",
      "**Historical label**",
    );
  }, moved);
  expect(
    lookup(withdrawn)({ provider_id: "anthropic", model_id: "claude-opus-legacy" }).reason,
  ).toBe("unreviewed_id");
});
it.each(["identity", "batch"])(
  "withdraws only associations whose %s meaning is no longer evidenced",
  async (kind) => {
    const previous = await collect();
    const candidate = await collect((bundle) => {
      for (const doc of bundle.documents)
        doc.body =
          kind === "identity"
            ? doc.body.replace(
                "When you use a model ID in an API request, the underlying model remains constant for the lifetime of that ID.",
                "The identifier meaning has changed.",
              )
            : doc.body.replace("object with the standard", "object with different");
    }, previous);
    const result = lookup(candidate)({
      provider_id: "anthropic",
      model_id: "claude-opus-4-7",
      selectors,
    });
    if (kind === "identity") expect(result.reason).toBe("unreviewed_id");
    else {
      expect(result.status).toBe("matched");
      expect(result.candidates.map(({ offer }) => offer.offer_key)).toEqual(["sync"]);
    }
    expect(candidate.pricing.data.books.length).toBeGreaterThan(0);
  },
);

it("requires served speed rather than deriving it from a requested mode or model ID", async () => {
  const candidate = await collect();
  const query = lookup(candidate);
  const scope = {
    provider_id: "anthropic",
    model_id: "claude-opus-4-7",
    offer_ref: offer(candidate, "sync"),
  };
  expect(
    query({ ...scope, selectors: selectors.filter(({ dimension }) => dimension.value !== "speed") })
      .missing_conditions,
  ).toContainEqual({ namespace: "kmodels", value: "speed" });
  const fast = query({
    ...scope,
    selectors: selectors.map((value) =>
      value.dimension.value === "speed" ? select("speed", "fast") : value,
    ),
  });
  expect(fast.status).toBe("matched");
  expect(
    fast.candidates.flatMap(({ offer }) =>
      offer.terms.flatMap((term) =>
        term.kind === "rate" && term.meter.value === "input_text"
          ? term.variants.map(({ price }) => price.value)
          : [],
      ),
    ),
  ).toEqual([{ numerator: "1", denominator: "100000" }]);
});

it("retains conflicting alias owners and excludes placeholder aliases", async () => {
  const candidate = await collect((bundle) => {
    bundle.index.body = bundle.index.body
      .split("\n")
      .map((line) =>
        line.includes("**Claude API alias**") && line.includes("claude-fable-5")
          ? line.replace("claude-opus-4-8", "claude-opus-legacy").replace("claude-fable-5", "N/A")
          : line,
      )
      .join("\n");
  });
  expect(
    lookup(candidate)({
      provider_id: "anthropic",
      model_id: "claude-opus-legacy",
      offer_ref: offer(candidate, "sync"),
    }).reason,
  ).toBe("ambiguous_identity");
  expect(lookup(candidate)({ provider_id: "anthropic", model_id: "N/A" }).reason).toBe(
    "unreviewed_id",
  );
});
