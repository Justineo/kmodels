import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  loadWebsiteModelDetail,
  preloadWebsiteModelDetail,
  preloadWebsiteModelDetailChunk,
} from "../src/catalog/website-loader.ts";
import { loadWebsiteCatalog } from "../src/catalog/website-runtime.ts";
import type { WebsiteModel, WebsitePricingOffer } from "../src/catalog/website-schema.ts";
import { acceptsGzipEncoding } from "../src/catalog/http-encoding.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function makeOffer(id: string): WebsitePricingOffer {
  return {
    id,
    title: "On-demand inference",
    group: "model_mechanism",
    billing_mode: { label: "Usage" },
    state_summary: "Metered pricing",
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

function makeModel(providerId: string, modelId: string, detailChunk = 0): WebsiteModel {
  return {
    uid: `${providerId}/${modelId}`,
    provider_id: providerId,
    model_id: modelId,
    name: modelId,
    aliases: [],
    tasks: ["text_generation"],
    status: "active",
    release_stage: "stable",
    detail_chunk: detailChunk,
    pricing: { outcome: "unknown" },
  };
}

function makeStoredDetail(modelRef: string, offerRefs: Array<[number, number]> = []) {
  return {
    model_ref: modelRef,
    modalities: { input: ["text"], output: ["text"] },
    capabilities: {
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
    },
    scope: "global_catalog",
    ...(offerRefs.length === 0 ? {} : { pricing: { offer_refs: offerRefs } }),
  };
}

describe("website loader regressions (F04, F14, F15, F20)", () => {
  it("loads the first, middle, and last model of a >1,000-model chunk without self-eviction (F04)", async () => {
    const version = "a".repeat(64);
    const total = 1_500;
    const details = Array.from({ length: total }, (_, i) =>
      makeStoredDetail(`huggingface/model-${i}`),
    );
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            schema_version: 12,
            data_version: version,
            provider_id: "huggingface",
            chunk: 0,
            details,
          }),
          { status: 200 },
        ),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const first = await loadWebsiteModelDetail(version, makeModel("huggingface", "model-0"));
    const middle = await loadWebsiteModelDetail(version, makeModel("huggingface", "model-750"));
    const last = await loadWebsiteModelDetail(version, makeModel("huggingface", "model-1499"));
    expect(first.model_ref).toBe("huggingface/model-0");
    expect(middle.model_ref).toBe("huggingface/model-750");
    expect(last.model_ref).toBe("huggingface/model-1499");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("re-fetches cleanly after chunk cache eviction and preserves late-failure isolation (F04, F20)", async () => {
    const version = "b".repeat(64);
    let rejectFirst!: (reason?: unknown) => void;
    let callsForTarget = 0;
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/ui/details/race-provider/0.json")) {
        callsForTarget += 1;
        if (callsForTarget === 1) {
          return new Promise<Response>((_, reject) => {
            rejectFirst = reject;
          });
        }
        return new Response(
          JSON.stringify({
            schema_version: 12,
            data_version: version,
            provider_id: "race-provider",
            chunk: 0,
            details: [makeStoredDetail("race-provider/m0"), makeStoredDetail("race-provider/m1")],
          }),
          { status: 200 },
        );
      }
      const match = url.match(/\/ui\/details\/(p\d+)\/0\.json/);
      const providerId = match?.[1] ?? "p0";
      return new Response(
        JSON.stringify({
          schema_version: 12,
          data_version: version,
          provider_id: providerId,
          chunk: 0,
          details: [makeStoredDetail(`${providerId}/m0`)],
        }),
        { status: 200 },
      );
    });
    globalThis.fetch = fetchMock as typeof fetch;

    // Start an in-flight chunk request for race-provider/0.json
    const pendingFirst = preloadWebsiteModelDetailChunk(version, makeModel("race-provider", "m0"));
    // Evict it from parsedDetailChunks (>24 distinct chunks)
    for (let i = 0; i < 26; i += 1) {
      await preloadWebsiteModelDetailChunk(version, makeModel(`p${i}`, "m0"));
    }
    // Load race-provider/m0 — triggers a NEW chunk request in parsedDetailChunks and succeeds
    const second = await loadWebsiteModelDetail(version, makeModel("race-provider", "m0"));
    expect(second.model_ref).toBe("race-provider/m0");
    // Now fail the evicted first chunk request — it MUST NOT delete the newer cached chunk!
    rejectFirst(new Error("late failure"));
    await expect(pendingFirst).rejects.toThrow("late failure");
    const callsBeforeSibling = fetchMock.mock.calls.length;
    const sibling = await loadWebsiteModelDetail(version, makeModel("race-provider", "m1"));
    expect(sibling.model_ref).toBe("race-provider/m1");
    expect(fetchMock.mock.calls.length).toBe(callsBeforeSibling);
  });

  it("preloads both detail and referenced offer chunks so first open needs zero extra fetches (F15)", async () => {
    const version = "c".repeat(64);
    const offerId = "d".repeat(64);
    const requestedUrls: string[] = [];
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      requestedUrls.push(url);
      if (url.includes("/ui/details/xai/0.json")) {
        return new Response(
          JSON.stringify({
            schema_version: 12,
            data_version: version,
            provider_id: "xai",
            chunk: 0,
            details: [makeStoredDetail("xai/grok-3", [[0, 0]])],
          }),
          { status: 200 },
        );
      }
      if (url.includes("/ui/offers/xai/0.json")) {
        return new Response(
          JSON.stringify({
            schema_version: 3,
            data_version: version,
            provider_id: "xai",
            chunk: 0,
            offers: [makeOffer(offerId)],
          }),
          { status: 200 },
        );
      }
      throw new Error(`Unexpected URL ${url}`);
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const model = makeModel("xai", "grok-3");
    await preloadWebsiteModelDetail(version, model);
    expect(requestedUrls).toHaveLength(2);
    expect(requestedUrls.some((u) => u.includes("/ui/offers/xai/0.json"))).toBe(true);

    const opened = await loadWebsiteModelDetail(version, model);
    expect(opened.pricing?.offers).toHaveLength(1);
    expect(requestedUrls).toHaveLength(2);
  });

  it("rejects malformed details/offers, normalizes legacy empty claim groups, and enforces 128 KiB core limit (F14)", async () => {
    const version = "e".repeat(64);
    // Missing modalities must be rejected
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            schema_version: 12,
            data_version: version,
            provider_id: "bad",
            chunk: 0,
            details: [{ model_ref: "bad/m0" }],
          }),
          { status: 200 },
        ),
    ) as typeof fetch;
    await expect(loadWebsiteModelDetail(version, makeModel("bad", "m0"))).rejects.toThrow(
      "modalities",
    );

    // Legacy v10 empty claim groups are stripped (matching websiteClaimStatements)
    const legacyVersion = "f".repeat(64);
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            schema_version: 10,
            data_version: legacyVersion,
            provider_id: "legacy",
            chunk: 0,
            details: [
              {
                ...makeStoredDetail("legacy/m0"),
                limit_details: [
                  { statements: [] },
                  { statements: [{ kind: "max_tokens", value: 1024 }] },
                ],
              },
            ],
          }),
          { status: 200 },
        ),
    ) as typeof fetch;
    const loadedLegacy = await loadWebsiteModelDetail(legacyVersion, makeModel("legacy", "m0"));
    expect(loadedLegacy.limit_details).toHaveLength(1);

    // Core manifest exceeding 128 KiB must be rejected by loadWebsiteCatalog
    await expect(
      loadWebsiteCatalog(async () => ({
        schema_version: 1,
        data_version: version,
        generated_at: "2026-11-23T00:00:00.000Z",
        providers: [],
        chunks: [],
        padding: "x".repeat(130 * 1024),
      })),
    ).rejects.toThrow("chunk limit");

    // Malformed offer rate row missing applicability must be rejected (R2-P2-#3)
    const offerVersion = "9".repeat(64);
    globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/ui/details/malformed-offer/0.json")) {
        return new Response(
          JSON.stringify({
            schema_version: 12,
            data_version: offerVersion,
            provider_id: "malformed-offer",
            chunk: 0,
            details: [makeStoredDetail("malformed-offer/m0", [[0, 0]])],
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          schema_version: 3,
          data_version: offerVersion,
          provider_id: "malformed-offer",
          chunk: 0,
          offers: [
            {
              ...makeOffer("8".repeat(64)),
              rates: [
                {
                  key: "r0",
                  term_ref: "7".repeat(64),
                  label: "Input",
                  amount: "$1",
                  unit: "per 1M",
                  accessible_text: "$1",
                  applicability_label: "All",
                },
              ],
            },
          ],
        }),
        { status: 200 },
      );
    }) as typeof fetch;
    await expect(
      loadWebsiteModelDetail(offerVersion, makeModel("malformed-offer", "m0")),
    ).rejects.toThrow("Invalid applicability on rate");
  });
});

describe("dev server Accept-Encoding negotiation (F19)", () => {
  it("handles gzip, explicit gzip;q=0, wildcard, and missing header accurately", () => {
    expect(acceptsGzipEncoding("gzip, deflate, br")).toBe(true);
    expect(acceptsGzipEncoding("br, gzip;q=0.5")).toBe(true);
    expect(acceptsGzipEncoding("gzip;q=0")).toBe(false);
    expect(acceptsGzipEncoding("br, gzip;q=0.000, *;q=0.5")).toBe(false);
    expect(acceptsGzipEncoding("*")).toBe(true);
    expect(acceptsGzipEncoding("*;q=0")).toBe(false);
    expect(acceptsGzipEncoding("br, deflate")).toBe(false);
    expect(acceptsGzipEncoding(undefined)).toBe(false);
  });
});
