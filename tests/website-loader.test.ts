import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { loadWebsiteModelDetail } from "../src/catalog/website-loader.ts";
import type {
  WebsiteDetailChunk,
  WebsiteModel,
  WebsiteModelDetail,
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

function detailChunk(dataVersion: string, description: string): WebsiteDetailChunk {
  return {
    schema_version: 3,
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
});
