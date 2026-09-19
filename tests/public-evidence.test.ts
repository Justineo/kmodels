import { readFile } from "node:fs/promises";
import { expect, it } from "vite-plus/test";
import { manifests, type SourceManifest } from "../src/catalog/manifests.ts";
import { reviewedPublicSource } from "../src/catalog/public-evidence.ts";

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
