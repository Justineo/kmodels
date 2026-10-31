import { readFile } from "node:fs/promises";
import { linkedBundleSchema, type LinkedBundle } from "../src/catalog/bundle.ts";

export async function dashscopeInferenceFixture(): Promise<Map<string, LinkedBundle>> {
  const bundle = linkedBundleSchema.parse(
    JSON.parse(
      await readFile(
        new URL("./fixtures/dashscope/inference-current.json", import.meta.url),
        "utf8",
      ),
    ),
  );
  return new Map([["dashscope-pricing", bundle]]);
}
