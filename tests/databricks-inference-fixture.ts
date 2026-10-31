import { readFile } from "node:fs/promises";
import { linkedBundleSchema } from "../src/catalog/bundle.ts";

export async function databricksInferenceFixture() {
  return linkedBundleSchema.parse(
    JSON.parse(
      await readFile(
        new URL("./fixtures/databricks/inference-current.json", import.meta.url),
        "utf8",
      ),
    ),
  );
}
