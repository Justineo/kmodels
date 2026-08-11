import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  loadWebsiteModelDetail,
  loadWebsiteProviderPricing,
  loadWebsiteProviderPricingChunk,
  loadWebsiteProviderPricingOffer,
} from "../src/catalog/website-loader.ts";
import type {
  WebsiteDetailChunk,
  WebsiteModel,
  WebsiteModelDetail,
  WebsiteOfferChunk,
  WebsitePricingOffer,
  WebsiteProvider,
  WebsiteProviderPricingChunk,
} from "../src/catalog/website-schema.ts";

const model = {
  provider_id: "test",
  model_id: "model",
  name: "Model",
  tasks: [],
  status: "active",
  release_stage: "stable",
  detail_chunk: 0,
  uid: "test/model",
  pricing: { outcome: "unknown" },
} satisfies WebsiteModel;

const capabilities: WebsiteModelDetail["capabilities"] = {
  reasoning: "unknown",
  tool_call: "unknown",
  structured_output: "unknown",
  streaming: "unknown",
  batch: "unknown",
  prompt_cache: "unknown",
  fine_tuning: "unknown",
  citations: "unknown",
  code_execution: "unknown",
  context_management: "unknown",
  effort_control: "unknown",
  computer_use: "unknown",
};

const provider = {
  id: "test",
  name: "Test",
  pricing_coverage: {
    models: 1,
    representative_models: 0,
    offer_models: 0,
    unknown_models: 1,
    not_applicable_models: 0,
    standalone_resources: 1,
    detail_chunks: 1,
  },
} satisfies WebsiteProvider;

function pricingOffer(id = "b"): WebsitePricingOffer {
  return {
    id: id.repeat(64),
    title: "Usage",
    group: "standalone",
    billing_mode: { label: "Usage" },
    state_summary: "Price not published",
    selectors: [],
    states: [],
    rates: [],
    allowances: [],
    contributions: [],
    enrollment: [],
    settlement: [],
    unnormalized_count: 0,
    unnormalized: [],
  };
}

function providerPricingChunk(
  dataVersion: string,
  chunk = 0,
  title = "Search",
  references: [number, number][] = [[0, 0]],
): WebsiteProviderPricingChunk {
  return {
    schema_version: 3,
    data_version: dataVersion,
    provider_id: provider.id,
    chunk,
    resources: [
      {
        id: (chunk === 0 ? "a" : "d").repeat(64),
        title,
        kind: "Service",
        raw_only: false,
        offers: [
          {
            id: "b".repeat(64),
            title: "Usage",
            billing_mode: { label: "Usage" },
            state_summary: "Price not published",
            offer_refs: references,
          },
        ],
      },
    ],
  };
}

function detailChunk(dataVersion: string, description: string): WebsiteDetailChunk {
  return {
    schema_version: 5,
    data_version: dataVersion,
    provider_id: model.provider_id,
    chunk: model.detail_chunk,
    details: [
      {
        model_ref: model.uid,
        description,
        modalities: { input: [], output: [] },
        capabilities,
        scope: "global_catalog",
      },
    ],
  };
}

function offerChunk(dataVersion: string, values = [pricingOffer()]): WebsiteOfferChunk {
  return {
    schema_version: 2,
    data_version: dataVersion,
    provider_id: model.provider_id,
    chunk: 0,
    offers: values,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("website detail loading", () => {
  it("evicts failed requests so a later attempt can recover", async () => {
    const dataVersion = "a".repeat(64);
    let attempts = 0;
    vi.stubGlobal("fetch", async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("temporary failure");
      return new Response(JSON.stringify(detailChunk(dataVersion, "Recovered")));
    });

    await expect(loadWebsiteModelDetail(dataVersion, model)).rejects.toThrow("temporary failure");
    await expect(loadWebsiteModelDetail(dataVersion, model)).resolves.toMatchObject({
      description: "Recovered",
    });
    expect(attempts).toBe(2);
  });

  it("evicts rejected chunks so a later attempt can recover", async () => {
    const dataVersion = "d".repeat(64);
    let attempts = 0;
    vi.stubGlobal("fetch", async () => {
      attempts += 1;
      const version = attempts === 1 ? "e".repeat(64) : dataVersion;
      return new Response(JSON.stringify(detailChunk(version, "Recovered")));
    });

    await expect(loadWebsiteModelDetail(dataVersion, model)).rejects.toThrow(
      "does not match the catalog",
    );
    await expect(loadWebsiteModelDetail(dataVersion, model)).resolves.toMatchObject({
      description: "Recovered",
    });
    expect(attempts).toBe(2);
  });

  it("scopes deferred detail caches and request URLs to the catalog data version", async () => {
    const firstVersion = "b".repeat(64);
    const secondVersion = "c".repeat(64);
    const requestedUrls: string[] = [];
    vi.stubGlobal("fetch", async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      requestedUrls.push(url);
      const version = new URL(url, "https://example.test").searchParams.get("v");
      if (version === null) throw new Error("Missing detail data version");
      return new Response(JSON.stringify(detailChunk(version, version)));
    });

    await expect(loadWebsiteModelDetail(firstVersion, model)).resolves.toMatchObject({
      description: firstVersion,
    });
    await expect(loadWebsiteModelDetail(secondVersion, model)).resolves.toMatchObject({
      description: secondVersion,
    });
    expect(requestedUrls).toEqual([
      `/ui/details/test/0.json?v=${firstVersion}`,
      `/ui/details/test/0.json?v=${secondVersion}`,
    ]);
  });

  it("loads shared offers only when a priced model detail is requested", async () => {
    const dataVersion = "7".repeat(64);
    const requestedUrls: string[] = [];
    vi.stubGlobal("fetch", async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      requestedUrls.push(url);
      if (url.startsWith("/ui/offers/"))
        return new Response(JSON.stringify(offerChunk(dataVersion)));
      const detail = detailChunk(dataVersion, "Priced");
      const modelDetail = detail.details[0];
      if (modelDetail === undefined) throw new Error("Missing test model detail");
      modelDetail.pricing = { offer_refs: [[0, 0]] };
      return new Response(JSON.stringify(detail));
    });

    await expect(loadWebsiteModelDetail(dataVersion, model)).resolves.toMatchObject({
      pricing: { offers: [{ title: "Usage" }] },
    });
    expect(requestedUrls).toEqual([
      `/ui/details/test/0.json?v=${dataVersion}`,
      `/ui/offers/test/0.json?v=${dataVersion}`,
    ]);
  });

  it("loads only the first provider resource chunk until an offer is expanded", async () => {
    const dataVersion = "f".repeat(64);
    const requestedUrls: string[] = [];
    vi.stubGlobal("fetch", async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      requestedUrls.push(url);
      return new Response(JSON.stringify(providerPricingChunk(dataVersion)));
    });

    const detail = await loadWebsiteProviderPricing(dataVersion, provider);
    expect(detail).toMatchObject({
      provider_id: provider.id,
      resources: [{ title: "Search" }],
    });
    expect(requestedUrls).toEqual([`/ui/providers/test/pricing/0.json?v=${dataVersion}`]);

    const summary = detail.resources[0]?.offers[0];
    if (summary === undefined) throw new Error("Missing provider offer summary");
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify(offerChunk(dataVersion))));
    await expect(
      loadWebsiteProviderPricingOffer(dataVersion, provider.id, summary),
    ).resolves.toMatchObject({ title: "Usage" });
  });

  it("loads additional provider chunks and offer fragments only when requested", async () => {
    const dataVersion = "e".repeat(64);
    const chunkedProvider = {
      ...provider,
      pricing_coverage: { ...provider.pricing_coverage, detail_chunks: 2 },
    };
    const stateFragment = pricingOffer();
    stateFragment.states = [
      {
        key: "state:0",
        state: "numeric",
        label: "Numeric",
        applicability: { any_of: [{ all_of: [] }] },
        applicability_label: "All contexts",
      },
    ];
    stateFragment.unnormalized_count = 1;
    const rawFragment = pricingOffer();
    rawFragment.unnormalized = [
      {
        key: "raw:0",
        label: "Usage aggregation",
        impact: "base_price",
        reason: "Requires usage aggregation",
      },
    ];
    rawFragment.unnormalized_count = 1;
    const requestedUrls: string[] = [];
    vi.stubGlobal("fetch", async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      requestedUrls.push(url);
      if (url.startsWith("/ui/offers/"))
        return new Response(JSON.stringify(offerChunk(dataVersion, [stateFragment, rawFragment])));
      const chunk = url.includes("/1.json") ? 1 : 0;
      return new Response(
        JSON.stringify(
          providerPricingChunk(dataVersion, chunk, chunk === 0 ? "Search" : "Storage", [
            [0, 0],
            [0, 1],
          ]),
        ),
      );
    });

    const first = await loadWebsiteProviderPricing(dataVersion, chunkedProvider);
    expect(first.resources.map(({ title }) => title)).toEqual(["Search"]);
    const second = await loadWebsiteProviderPricingChunk(dataVersion, provider.id, 1);
    expect(second.resources.map(({ title }) => title)).toEqual(["Storage"]);
    const summary = second.resources[0]?.offers[0];
    if (summary === undefined) throw new Error("Missing provider offer summary");
    await expect(
      loadWebsiteProviderPricingOffer(dataVersion, provider.id, summary),
    ).resolves.toMatchObject({
      states: [{ key: "state:0" }],
      unnormalized: [{ key: "raw:0" }],
    });
    expect(requestedUrls.filter((url) => url.startsWith("/ui/offers/"))).toHaveLength(1);
    expect(requestedUrls.filter((url) => url.startsWith("/ui/providers/"))).toHaveLength(2);
  });

  it("rejects deferred offer details that disagree with their summary", async () => {
    const dataVersion = "6".repeat(64);
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify(offerChunk(dataVersion))));
    const summary = providerPricingChunk(dataVersion).resources[0]?.offers[0];
    if (summary === undefined) throw new Error("Missing provider offer summary");

    const mismatches = [
      { ...summary, id: "c".repeat(64) },
      { ...summary, title: "Other usage" },
      { ...summary, billing_mode: { label: "Capacity" } },
      { ...summary, state_summary: "Free" },
    ];
    for (const mismatch of mismatches)
      await expect(
        loadWebsiteProviderPricingOffer(dataVersion, provider.id, mismatch),
      ).rejects.toThrow("does not match its summary");
  });

  it("evicts invalid provider pricing so a later request can recover", async () => {
    const dataVersion = "9".repeat(64);
    let providerAttempts = 0;
    vi.stubGlobal("fetch", async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.startsWith("/ui/offers/"))
        return new Response(JSON.stringify(offerChunk(dataVersion)));
      providerAttempts += 1;
      return new Response(
        JSON.stringify(providerPricingChunk(providerAttempts === 1 ? "8".repeat(64) : dataVersion)),
      );
    });

    await expect(loadWebsiteProviderPricing(dataVersion, provider)).rejects.toThrow(
      "does not match the catalog",
    );
    await expect(loadWebsiteProviderPricing(dataVersion, provider)).resolves.toMatchObject({
      data_version: dataVersion,
    });
    expect(providerAttempts).toBe(2);
  });
});
