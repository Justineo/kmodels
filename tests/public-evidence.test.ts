import { readFile } from "node:fs/promises";
import { expect, it } from "vite-plus/test";
import { manifests, type SourceManifest } from "../src/catalog/manifests.ts";
import { publicEvidenceBaseline, reviewedPublicSource } from "../src/catalog/public-evidence.ts";

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
