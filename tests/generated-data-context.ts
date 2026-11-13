import { access } from "node:fs/promises";
import { readCatalogPairMirrors } from "../src/catalog/pricing-publication.ts";

let data: ReturnType<typeof loadGeneratedData> | undefined;

async function loadGeneratedData() {
  await access(new URL("../data/pricing.json.gz", import.meta.url));
  const pair = await readCatalogPairMirrors();
  if (pair === undefined) throw new Error("Generated catalog pair is missing");
  const { catalog, pricing, inference } = pair;
  return { catalog, pricing, inference };
}

export function generatedData() {
  data ??= loadGeneratedData();
  return data;
}
