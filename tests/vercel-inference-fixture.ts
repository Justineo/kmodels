import { readFile } from "node:fs/promises";
import { linkedBundleSchema } from "../src/catalog/bundle.ts";

export async function vercelInferenceBundle() {
  return linkedBundleSchema.parse(
    JSON.parse(
      await readFile(new URL("./fixtures/vercel/inference-current.json", import.meta.url), "utf8"),
    ),
  );
}
