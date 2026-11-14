import { readFile } from "node:fs/promises";
import { linkedBundleSchema } from "../src/catalog/bundle.ts";

export async function mistralInferenceBundles() {
  const fixture = async (name: string): Promise<unknown> =>
    JSON.parse(
      await readFile(
        new URL(`./fixtures/mistral/inference-current-${name}.json`, import.meta.url),
        "utf8",
      ),
    );
  const catalog = linkedBundleSchema.parse(await fixture("catalog"));
  const pricing = linkedBundleSchema.parse(await fixture("pricing"));
  const policies = linkedBundleSchema.shape.documents.parse(await fixture("policies"));
  catalog.documents.push(...policies.filter(({ url }) => !url.includes("priority-tier")));
  catalog.documents.push({
    url: "https://docs.mistral.ai/studio/audio/speech-to-text/transcribe-in-realtime.md",
    body: await readFile(
      new URL("./fixtures/mistral/realtime-transcription.txt", import.meta.url),
      "utf8",
    ),
  });
  pricing.documents.push(...policies);
  return { catalog, pricing };
}
