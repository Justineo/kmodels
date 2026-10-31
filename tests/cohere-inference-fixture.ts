import { readFile } from "node:fs/promises";
import type { LinkedBundle } from "../src/catalog/bundle.ts";

export const cohereInferenceFixture = (name: string) =>
  readFile(new URL(`./fixtures/cohere/inference-current-${name}`, import.meta.url), "utf8");

export async function cohereInferenceBundle(): Promise<LinkedBundle> {
  return {
    index: {
      url: "https://docs.cohere.com/docs/models.md",
      body: await cohereInferenceFixture("index.md"),
    },
    documents: await Promise.all(
      [
        ["/docs/models", "models"],
        ["/docs/command-a-plus", "command-a-plus"],
        ["/v2/docs/transcribe", "transcribe"],
        ["/v2/docs/transcribe-arabic", "transcribe-arabic"],
        ["/docs/parse", "parse"],
      ].map(async ([path, file]) => ({
        url: `https://docs.cohere.com${path}`,
        body: await cohereInferenceFixture(`${file}.html`),
      })),
    ),
  };
}
