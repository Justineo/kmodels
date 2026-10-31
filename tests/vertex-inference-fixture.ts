import { readFile } from "node:fs/promises";
import { linkedBundleSchema, type LinkedBundle } from "../src/catalog/bundle.ts";

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
  return new Map(entries);
}
