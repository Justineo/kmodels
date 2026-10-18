import { readFile } from "node:fs/promises";
import { expect, it } from "vite-plus/test";
import { manifests, type SourceManifest } from "../src/catalog/manifests.ts";
import {
  linkedPublicSource,
  publicEvidenceBaseline,
  reviewedPublicSource,
} from "../src/catalog/public-evidence.ts";

it("inspects a first-party successor linked by reviewed HTML without admitting it to collection", () => {
  const parent = reviewedPublicSource("vertex-pricing", "--index");
  const target =
    "https://docs.cloud.google.com/gemini-enterprise-agent-platform/reference/rest/Shared.Types/VideoGenerationModelParams";
  const body = `<a href="${target}#fields">Parameters</a>`;
  const source = linkedPublicSource(parent, body, target);
  expect(source.url).toBe(target);
  expect(source.allowedHosts).toEqual(parent.allowedHosts);
  expect(source.maxResponseBytes).toBeLessThanOrEqual(parent.maxResponseBytes);
  expect(source.maxResponseBytes).toBeLessThanOrEqual(4 * 1024 * 1024);
  expect(source.linkedDocuments).toBeUndefined();
  expect(source.transport).toBeUndefined();
  expect(() => reviewedPublicSource("vertex-pricing", target + "/unreviewed")).toThrow(
    "not a fixed reviewed companion",
  );
  expect(() => linkedPublicSource(parent, body, target + "/unlinked")).toThrow("not linked");
  for (const url of [
    "http://docs.cloud.google.com/page",
    "https://docs.cloud.google.com.evil.test/page",
    "https://secret@docs.cloud.google.com/page",
    "https://docs.cloud.google.com:444/page",
  ])
    expect(() => linkedPublicSource(parent, `<a href="${url}">Link</a>`, url)).toThrow(
      "host boundary",
    );
  expect(() => linkedPublicSource({ ...parent, access: "authenticated" }, body, target)).toThrow(
    "public HTML parent",
  );
  expect(() =>
    linkedPublicSource(reviewedPublicSource("cohere-models", "--index"), body, target),
  ).toThrow("public HTML parent");
});

it("distinguishes a provider-ID mistake from authentication and names the public source", () => {
  expect(() => reviewedPublicSource("amazon-bedrock")).toThrow(
    /Expected a source ID, received provider ID amazon-bedrock.*bedrock-models.*not an authentication failure/,
  );
  expect(reviewedPublicSource("bedrock-models")).toMatchObject({ access: "public" });
  expect(() => reviewedPublicSource("unknown-source")).toThrow("Unknown reviewed source ID");
  expect(() => reviewedPublicSource("mistral-api")).toThrow("public source without credentials");
});

it("compares public refetches to the exact reported attempt, including a failed parse", () => {
  const at = "2026-09-20T02:06:07.280Z";
  const hash = "1".repeat(64);
  const state = {
    sources: {
      "dashscope-recommended": {
        checkedAt: at,
        contentHash: hash,
        consecutiveFailures: 120,
        lastSuccessAt: "2026-09-11T05:50:05.136Z",
      },
    },
  };
  expect(
    publicEvidenceBaseline("dashscope-recommended", hash, state, at, "parse_failed"),
  ).toMatchObject({
    comparison: "matching_refresh",
    source_hash: hash,
  });
  expect(
    publicEvidenceBaseline("dashscope-recommended", "2".repeat(64), state, at, "parse_failed")
      .comparison,
  ).toBe("changed_since_refresh");
  expect(
    publicEvidenceBaseline(
      "dashscope-recommended",
      hash,
      state,
      "2026-09-21T02:06:07.280Z",
      "parse_failed",
    ).comparison,
  ).toBe("unavailable");
  expect(publicEvidenceBaseline("missing", hash, state, at, "changed").comparison).toBe(
    "unavailable",
  );
  for (const outcome of ["fetch_failed", "skipped_not_configured", undefined]) {
    expect(
      publicEvidenceBaseline("dashscope-recommended", hash, state, at, outcome).comparison,
    ).toBe("unavailable");
  }
  expect(
    publicEvidenceBaseline(
      "cohere-models/api-embed-v2",
      hash,
      {
        sources: {
          "cohere-models/api-embed-v2": {
            checkedAt: at,
            contentHash: hash,
            consecutiveFailures: 0,
          },
        },
      },
      at,
      "changed",
    ).comparison,
  ).toBe("matching_refresh");
});

it("keeps public repair transport hosts reachable through the declared sandbox network", async () => {
  const workflow = await readFile(
    new URL("../.github/workflows/catalog-repair.md", import.meta.url),
    "utf8",
  );
  const network = workflow.match(/\nnetwork:\n([\s\S]*?)\ntools:/)?.[1];
  if (!network) throw new Error("Missing explicit repair network configuration");
  const allowed = new Set(network.split("\n").map((line) => line.trim().replace(/^- /, "")));
  for (const source of manifests.flatMap<SourceManifest>(({ sources }) => sources)) {
    if (source.access !== "public" || source.auth) continue;
    expect(reviewedPublicSource(source.id)).toEqual(source);
    for (const host of source.allowedHosts)
      expect(allowed.has(host), `${source.id}: ${host}`).toBe(true);
  }
});

it("isolates raw index evidence without widening the reviewed source boundary", () => {
  const source = reviewedPublicSource("cohere-models");
  const index = reviewedPublicSource("cohere-models", "--index");
  expect(index.url).toBe(source.url);
  expect(index.allowedHosts).toEqual(source.allowedHosts);
  expect(index.format).toBe(source.format);
  expect(index.maxResponseBytes).toBe(source.linkedDocuments?.maxDocumentBytes);
  expect(index.linkedDocuments).toBeUndefined();
  expect(index.transport).toBeUndefined();
  expect(source.linkedDocuments).toBeDefined();
  expect(() => reviewedPublicSource("mistral-api", "--index")).toThrow(
    "public source without credentials",
  );
  expect(() => reviewedPublicSource("cohere-models", "https://docs.cohere.com/unreviewed")).toThrow(
    "not a fixed reviewed companion",
  );
  expect(() => reviewedPublicSource("vercel-models", "--index")).toThrow(
    "without a custom transport",
  );
});
