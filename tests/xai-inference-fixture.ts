import { readFile } from "node:fs/promises";
import type { LinkedBundle } from "../src/catalog/bundle.ts";

export async function xaiInferenceBundle(): Promise<LinkedBundle> {
  const fixture = (name: string) =>
    readFile(new URL(`./fixtures/xai/inference-current-${name}`, import.meta.url), "utf8");
  return {
    index: {
      url: "https://docs.x.ai/developers/models",
      body: await fixture("models.html"),
    },
    documents: [
      {
        url: "https://docs.x.ai/llms-full.txt",
        body: `${await fixture("docs.txt")}\n\n${await fixture("regions.txt")}`,
      },
    ],
  };
}
