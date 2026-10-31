import { readFile } from "node:fs/promises";
import { z } from "zod";
import { manifests, type ProviderManifest } from "../src/catalog/manifests.ts";
import type { LinkedBundle } from "../src/catalog/bundle.ts";

export async function geminiInferenceFixtures(): Promise<{
  catalog: LinkedBundle;
  pricing: LinkedBundle;
}> {
  const pages = z
    .array(z.object({ url: z.url(), body: z.string() }))
    .parse(
      JSON.parse(
        await readFile(
          new URL("./fixtures/gemini/inference-current.json", import.meta.url),
          "utf8",
        ),
      ),
    );
  const manifest: ProviderManifest | undefined = manifests.find(
    ({ provider }) => provider.id === "gemini",
  );
  function bundle(id: string): LinkedBundle {
    const source = manifest?.sources.find((s) => s.id === id);
    if (!source?.linkedDocuments) throw new Error("Missing Gemini source");
    const index = pages.find(({ url }) => url === source.url);
    if (!index) throw new Error("Missing Gemini index");
    const fixed = new Set(source.linkedDocuments.documents?.map(({ url }) => url));
    return {
      index,
      documents: pages.filter(
        ({ url }) => fixed.has(url) || source.linkedDocuments?.path.test(new URL(url).pathname),
      ),
    };
  }
  return { catalog: bundle("gemini-models"), pricing: bundle("gemini-pricing") };
}
