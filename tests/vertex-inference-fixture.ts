import { readFile } from "node:fs/promises";
import { linkedBundleSchema, type LinkedBundle } from "../src/catalog/bundle.ts";
import { vertexClaudeIdSource } from "../src/catalog/vertex-inference-pricing.ts";

export async function vertexInferenceFixture(): Promise<Map<string, LinkedBundle>> {
  const ids = ["google-models", "partner-models", "open-models", "pricing"];
  const entries = await Promise.all(
    ids.map(
      async (id) =>
        [
          `vertex-${id}`,
          linkedBundleSchema.parse(
            JSON.parse(
              await readFile(
                new URL(`./fixtures/vertex/inference-${id}.json`, import.meta.url),
                "utf8",
              ),
            ),
          ),
        ] as const,
    ),
  );
  const bundles = new Map(entries);
  bundles.get("vertex-pricing")?.documents.push({
    url: vertexClaudeIdSource,
    body: await readFile(
      new URL("./fixtures/vertex/claude-request-ids.html", import.meta.url),
      "utf8",
    ),
  });
  return bundles;
}
