import { readFile } from "node:fs/promises";
import type { LinkedBundle } from "../src/catalog/bundle.ts";
import type { SourceManifest } from "../src/catalog/manifests.ts";

export async function kimiInferenceBundle(source: SourceManifest): Promise<LinkedBundle> {
  const region = source.id === "kimi-pricing" ? "cn" : "global";
  const fixture = (kind: string) =>
    readFile(
      new URL(`./fixtures/kimi/inference-current-${region}-${kind}.html`, import.meta.url),
      "utf8",
    );
  const origin = new URL(source.url).origin;
  return {
    index: { url: source.url, body: await fixture("chat") },
    documents: [
      { url: `${origin}/docs/pricing/batch`, body: await fixture("batch") },
      {
        url: `${origin}/docs/pricing/tools`,
        body: await readFile(
          new URL(`./fixtures/kimi/pricing-${region}-rest-tools.md`, import.meta.url),
          "utf8",
        ),
      },
    ],
  };
}
