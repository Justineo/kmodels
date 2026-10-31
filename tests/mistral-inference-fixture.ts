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
  pricing.documents.push(...policies);
  return { catalog, pricing };
}
