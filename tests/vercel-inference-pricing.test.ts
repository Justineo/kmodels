import { gunzipSync } from "node:zlib";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { beforeAll, expect, it, vi } from "vite-plus/test";
import { linkedBundleSchema, type LinkedBundle } from "../src/catalog/bundle.ts";
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
import { priceDataExport } from "../src/catalog/pricing-lookup-export.ts";
import { createInferencePriceLookup } from "../src/pricing/inference.ts";
import type { Selector } from "../src/pricing/schema.ts";
import { projectCatalogPair } from "../src/catalog/projections.ts";
import { compressedAsset } from "../src/catalog/asset-pack.ts";
import { websiteDetailChunkSchema } from "../src/catalog/website-schema.ts";
import { queryWebsiteInferencePrice } from "../src/catalog/inference-price-presentation.ts";
import { restoreWebsiteInferenceDetail } from "./website-inference-detail.ts";
import { createCommercialPriceLookup } from "../src/pricing/commercial.ts";
import { websiteProviderPricingChunkSchema } from "../src/catalog/website-schema.ts";
import type { Catalog } from "../src/catalog/schema.ts";
import { vercelInferenceBundle } from "./vercel-inference-fixture.ts";

vi.mock("../src/catalog/fetch.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/catalog/fetch.ts")>()),
  fetchSource: vi.fn(),
}));
const at = "2026-10-30T18:30:00.000Z";
async function collect(change?: (bundle: LinkedBundle) => void, previous?: CatalogPairCandidate) {
  const manifest = manifests.find(({ provider }) => provider.id === "vercel");
  const catalog = manifest?.sources.find(({ id }) => id === "vercel-models");
  if (!manifest || !catalog) throw new Error("Missing Vercel source");
  const bundle = await vercelInferenceBundle();
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
let baseline: CatalogPairCandidate;
beforeAll(async () => {
  baseline = (await collect()).candidate;
}, 15000);

function lookup(candidate: CatalogPairCandidate) {
  return createInferencePriceLookup(
    priceDataExport(candidate.catalog, candidate.pricing),
    candidate.inference?.mapping,
  );
}

function condition(
  dimension:
    | "operation"
    | "route_provider"
    | "region"
    | "speed"
    | "served_service_tier"
    | "quality"
    | "resolution",
  value: string,
): Selector {
  return {
    kind: "categorical",
    dimension: { namespace: "kmodels", value: dimension },
    value: { namespace: "provider", provider_id: "vercel", value },
  };
}
function amounts(result: ReturnType<ReturnType<typeof lookup>>, meter = "input_text") {
  return result.candidates.flatMap(({ offer }) =>
    offer.terms.flatMap((term) =>
      term.kind === "rate" && term.meter.value === meter
        ? term.variants.map(({ price }) => price.value)
        : [],
    ),
  );
}

it("looks up a native gateway ID without treating the creator as the serving route", async () => {
  const candidate = baseline;
  const query = lookup(candidate);
  const args = { provider_id: "vercel", model_id: "alibaba/qwen3-embedding-0.6b" };
  const result = query({ ...args, selectors: [condition("route_provider", "deepinfra")] });
  expect(
    result.status,
    JSON.stringify({ missing: result.missing_conditions, reason: result.reason }),
  ).toBe("matched");
  expect(amounts(result, "embedding")).toEqual([{ numerator: "1", denominator: "100000000" }]);
  expect(result.candidates.every(({ offer }) => offer.offer_key === "usage")).toBe(true);
  for (const model_id of [
    "qwen3-embedding-0.6b",
    "deepinfra/qwen3-embedding-0.6b",
    "eu.alibaba/qwen3-embedding-0.6b",
    "vmc/abc-123",
  ])
    expect(query({ provider_id: "vercel", model_id }).reason).toBe("unreviewed_id");
});

it("publishes HeyGen duration boundaries identically to the public lookup and website", async () => {
  const reviewed = linkedBundleSchema.parse(
    JSON.parse(
      await readFile(
        new URL("./fixtures/vercel/heygen-duration-tiers.json", import.meta.url),
        "utf8",
      ),
    ),
  );
  const listSchema = z.object({ object: z.literal("list"), data: z.array(z.unknown()) });
  const { candidate } = await collect((bundle) => {
    const list = listSchema.parse(JSON.parse(bundle.index.body));
    list.data.push(...listSchema.parse(JSON.parse(reviewed.index.body)).data);
    bundle.index.body = JSON.stringify(list);
    for (const doc of reviewed.documents) {
      const existing = bundle.documents.find(({ url }) => url === doc.url);
      if (existing === undefined) bundle.documents.push(doc);
      else existing.body = doc.body;
    }
  });
  const query = lookup(candidate);
  const model_id = "heygen/heygen-video-1";
  const fixed = [
    condition("route_provider", "heygen"),
    condition("quality", "text_to_video"),
    condition("resolution", "480p"),
  ];
  const pending = query({ provider_id: "vercel", model_id, selectors: fixed });
  expect(pending.status).toBe("candidates");
  expect(pending.missing_conditions).toContainEqual({
    namespace: "kmodels",
    value: "duration_seconds",
  });
  const projected = await projectCatalogPair(candidate);
  const detail = projected.ui.manifest.assets
    .filter(({ file_name }) => file_name.includes("/details/"))
    .flatMap((asset) =>
      websiteDetailChunkSchema
        .parse(JSON.parse(gunzipSync(compressedAsset(projected.ui.pack, asset)).toString("utf8")))
        .details.map(restoreWebsiteInferenceDetail),
    )
    .find(({ model_ref }) => model_ref === `vercel/${model_id}`);
  const price = detail?.inference_prices?.find((entry) => entry.model_id === model_id);
  if (price === undefined) throw new Error("Missing HeyGen website lookup");
  for (const [seconds, numerator, denominator] of [
    ["15", "1", "100"],
    ["15.1", "9", "200"],
  ] as const) {
    const selectors: Selector[] = [
      ...fixed,
      {
        kind: "decimal",
        dimension: { namespace: "kmodels", value: "duration_seconds" },
        value: seconds,
        unit: { factors: [{ unit: { namespace: "kmodels", value: "second" }, power: 1 }] },
      },
    ];
    const result = query({ provider_id: "vercel", model_id, selectors });
    expect(result.status).toBe("matched");
    expect(amounts(result, "video_generation")).toEqual([{ numerator, denominator }]);
    expect(queryWebsiteInferencePrice(price, selectors, at).status).toBe(result.status);
  }
}, 15000);

it("keeps native Fast context tiers and regional amounts instead of extending the short rate", async () => {
  const candidate = baseline;
  const query = lookup(candidate);
  for (const [region, numerator, denominator] of [
    ["default", "1", "25000"],
    ["us", "11", "250000"],
  ] as const) {
    const result = query({
      provider_id: "vercel",
      model_id: "openai/gpt-6-astra",

      selectors: [
        {
          kind: "categorical",
          dimension: { namespace: "provider", provider_id: "vercel", value: "invocation_mode" },
          value: { namespace: "provider", provider_id: "vercel", value: "usage" },
        },
        condition("speed", "fast"),
        condition("served_service_tier", "standard"),
        condition("region", region),
        {
          kind: "decimal",
          dimension: { namespace: "kmodels", value: "context_tokens" },
          value: "300000",
          unit: { factors: [{ unit: { namespace: "kmodels", value: "token" }, power: 1 }] },
        },
      ],
    });
    expect(
      result.status,
      JSON.stringify({
        reason: result.reason,
        modes: result.execution_modes,
        missing: result.missing_conditions,
      }),
    ).toBe("matched");
    expect(amounts(result)).toEqual([{ numerator, denominator }]);
  }
});

it("associates Batch IDs and base IDs with the same published Batch rates", async () => {
  const candidate = baseline;
  const query = lookup(candidate);
  for (const model_id of ["anthropic/claude-opus-5", "anthropic/claude-opus-5-batch"]) {
    for (const [region, numerator, denominator] of [
      ["default", "1", "400000"],
      ["us", "11", "4000000"],
    ] as const) {
      const result = query({
        provider_id: "vercel",
        model_id,
        execution_mode: "batch",
        selectors: [condition("route_provider", "anthropic"), condition("region", region)],
      });
      expect(result.status).toBe("matched");
      expect(result.execution_modes).toEqual(["batch"]);
      expect(
        result.candidates.every(({ selectors }) =>
          selectors.every(({ dimension }) => dimension.value !== "operation"),
        ),
      ).toBe(true);
      expect(amounts(result)).toEqual([{ numerator, denominator }]);
    }
  }
  expect(
    query({
      provider_id: "vercel",
      model_id: "anthropic/claude-opus-5-batch",
      execution_mode: "request",
    }).reason,
  ).toBe("no_applicable_price");
  expect(
    query({
      provider_id: "vercel",
      model_id: "anthropic/claude-opus-5",
      execution_mode: "batch",
      selectors: [condition("route_provider", "bedrock")],
    }).reason,
  ).toBe("no_applicable_price");
});

it("withdraws Batch-dependent associations when its commercial evidence disappears", async () => {
  const previous = baseline;
  const { candidate } = await collect((bundle) => {
    bundle.documents = bundle.documents.filter(({ url }) => !url.endsWith("batch-processing.md"));
  }, previous);
  const query = lookup(candidate);
  for (const model_id of ["anthropic/claude-opus-5", "anthropic/claude-opus-5-batch"])
    expect(query({ provider_id: "vercel", model_id }).reason).toBe("unreviewed_id");
  expect(
    query({
      provider_id: "vercel",
      model_id: "alibaba/qwen3-embedding-0.6b",
      selectors: [condition("route_provider", "deepinfra")],
    }).status,
  ).toBe("matched");
}, 15000);

it("does not require optional accounting documents for independently published ID prices", async () => {
  const { candidate } = await collect((bundle) => {
    bundle.documents = bundle.documents.filter(
      ({ url }) => !url.endsWith(".md") || url.endsWith("batch-processing.md"),
    );
  });
  const result = lookup(candidate)({
    provider_id: "vercel",
    model_id: "anthropic/claude-opus-5-batch",
    selectors: [condition("route_provider", "anthropic"), condition("region", "default")],
  });
  expect(result.status).toBe("matched");
}, 15000);

it("withdraws a removed public ID without borrowing a surviving model's price", async () => {
  const { candidate } = await collect((bundle) => {
    const inventory = z
      .object({ object: z.literal("list"), data: z.array(z.object({ id: z.string() }).loose()) })
      .parse(JSON.parse(bundle.index.body));
    inventory.data = inventory.data.filter(({ id }) => id !== "alibaba/qwen3-embedding-0.6b");
    bundle.index.body = JSON.stringify(inventory);
  }, baseline);
  expect(
    lookup(candidate)({ provider_id: "vercel", model_id: "alibaba/qwen3-embedding-0.6b" }).reason,
  ).toBe("unreviewed_id");
}, 15000);

it("exports the same conditions to the UI without audit payloads or invocation targets", async () => {
  const candidate = baseline;
  const projected = await projectCatalogPair(candidate);
  const details = projected.ui.manifest.assets
    .filter(({ file_name }) => file_name.includes("/details/"))
    .flatMap((asset) =>
      websiteDetailChunkSchema
        .parse(JSON.parse(gunzipSync(compressedAsset(projected.ui.pack, asset)).toString()))
        .details.map(restoreWebsiteInferenceDetail),
    );
  const model = candidate.catalog.models.find(
    ({ model_id }) => model_id === "anthropic/claude-opus-5-batch",
  );
  const price = details.find(({ model_ref }) => model_ref === model?.uid)?.inference_prices?.[0];
  if (!price) throw new Error("Missing Batch UI mapping");
  expect(
    queryWebsiteInferencePrice(
      price,
      [condition("route_provider", "anthropic"), condition("region", "us")],
      at,
    ).status,
  ).toBe("matched");
  expect(JSON.stringify(price)).not.toMatch(/content_hash|invocation_target/);
}, 15000);

it("publishes service tariffs and scoped Live accounting through actual portable and website consumers", async () => {
  const services = await readFile(
    new URL("./fixtures/vercel/additional-services.md", import.meta.url),
    "utf8",
  );
  const live = await readFile(new URL("./fixtures/vercel/live-usage.md", import.meta.url), "utf8");
  const { candidate } = await collect((bundle) => {
    const search = bundle.documents.find((d) => d.url.endsWith("/web-search.md"));
    if (search) search.body += "\n" + services;
    else
      bundle.documents.push({
        url: "https://vercel.com/docs/ai-gateway/models-and-providers/web-search.md",
        body: services,
      });
    bundle.documents.push({
      url: "https://vercel.com/docs/ai-gateway/modalities/realtime/gpt-live.md",
      body: live,
    });
  });
  const data = priceDataExport(candidate.catalog, candidate.pricing);
  const query = createCommercialPriceLookup(data, candidate.inference?.mapping);
  const fetch = candidate.pricing.data.books.find(
    (b) => b.book_key === "service:browserbase-fetch",
  );
  if (!fetch) throw new Error("Missing Browserbase resource");
  const result = query({
    subject: { kind: "resource", provider_id: "vercel", book_ref: fetch.id },
    selectors: [
      {
        kind: "categorical",
        dimension: { namespace: "provider", provider_id: "vercel", value: "format" },
        value: { namespace: "provider", provider_id: "vercel", value: "markdown" },
      },
      {
        kind: "boolean",
        dimension: { namespace: "provider", provider_id: "vercel", value: "proxies" },
        value: true,
      },
    ],
  });
  expect(result.status).toBe("matched");
  expect(
    result.candidates.flatMap((c) =>
      c.offer.terms.flatMap((t) => (t.kind === "rate" ? t.variants.map((v) => v.price.value) : [])),
    ),
  ).toEqual([{ numerator: "7", denominator: "1000" }]);
  const modelBooks = candidate.pricing.data.books.filter((b) => b.scope.kind === "models");
  const durationTerms = (id: string) =>
    modelBooks
      .filter((b) => b.scope.model_refs.includes(`vercel/${id}`))
      .flatMap((b) =>
        b.offers.flatMap((o) =>
          o.terms.filter((t) => t.kind === "rate" && t.meter.value === "session_runtime"),
        ),
      );
  const liveMethods = durationTerms("openai/gpt-live-1").flatMap((t) =>
    t.kind === "rate" ? t.variants.flatMap((v) => v.charge_binding?.quantity_methods ?? []) : [],
  );
  expect(liveMethods).toEqual([
    expect.objectContaining({
      input_sources: [
        expect.objectContaining({
          channel: "stream_event",
          availability: "terminal_only",
          locator: { kind: "provider_field", value: "session.closed.usage.seconds" },
        }),
      ],
    }),
  ]);
  expect(
    durationTerms("google/gemini-3.8-live").flatMap((t) =>
      t.kind === "rate" ? t.variants.flatMap((v) => v.charge_binding?.quantity_methods ?? []) : [],
    ),
  ).toEqual([]);
  const projection = await projectCatalogPair(candidate);
  const resources = projection.ui.manifest.assets
    .filter((a) => a.file_name.includes("/providers/vercel/pricing/"))
    .flatMap(
      (a) =>
        websiteProviderPricingChunkSchema.parse(
          JSON.parse(gunzipSync(compressedAsset(projection.ui.pack, a)).toString("utf8")),
        ).resources,
    );
  expect(resources.map((r) => r.title)).toEqual(
    expect.arrayContaining([
      "Browserbase Search",
      "Browserbase Fetch",
      "DeepSeek Search",
      "DeepSeek Fetch",
    ]),
  );
}, 15000);
