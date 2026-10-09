import { readFile } from "node:fs/promises";
import { expect, it } from "vite-plus/test";
import { cohereModelDocumentUrls } from "../src/catalog/cohere-documents.ts";
import { linkedDocumentUrls } from "../src/catalog/fetch.ts";
import { reviewedPublicSource } from "../src/catalog/public-evidence.ts";

it("discovers the same reviewed cards from page-relative and legacy absolute links", async () => {
  const body = await readFile(
    new URL("./fixtures/cohere/model-overview-links.md", import.meta.url),
    "utf8",
  );
  const source = reviewedPublicSource("cohere-models");
  const configured = source.linkedDocuments;
  if (configured === undefined) throw new Error("Missing Cohere discovery contract");
  const urls = cohereModelDocumentUrls(body, source.url).map(({ href }) => href);
  expect(urls).toEqual([
    "https://docs.cohere.com/docs/command-a",
    "https://docs.cohere.com/docs/command-a-plus",
    "https://docs.cohere.com/docs/north-mini-code-1.0",
    "https://docs.cohere.com/docs/parse",
    "https://docs.cohere.com/v2/docs/transcribe",
    "https://docs.cohere.com/v2/docs/transcribe-arabic",
  ]);
  const legacy = urls.map((url) => `[Card](${url}.md)`).join("\n");
  expect(cohereModelDocumentUrls(legacy, "https://docs.cohere.com/docs/models/llms.txt")).toEqual(
    cohereModelDocumentUrls(body, source.url),
  );
  expect(cohereModelDocumentUrls(body, "https://docs.cohere.com/docs/models/llms.txt")).toEqual(
    cohereModelDocumentUrls(body, source.url),
  );
  expect(
    linkedDocumentUrls(body, {
      ...source,
      linkedDocuments: { ...configured, minDocuments: 6, maxDocuments: 6 },
    }).map(({ href }) => href),
  ).toEqual(urls);
  expect(() => linkedDocumentUrls(body, source)).toThrow("count_outside_bounds");
});

it("rejects off-origin, private-version and non-document links and deduplicates card views", () => {
  const body = [
    "command-a",
    "command-a.md",
    "https://docs.cohere.com/docs/command-a",
    "https://unreviewed.test/docs/command-a",
    "https://docs.cohere.com:444/docs/command-a",
    "https://user:password@docs.cohere.com/docs/command-a",
    "../reference/chat",
    "/v1/docs/command-a",
    "/v3/docs/command-a",
    "command-a?token=private",
    "command-a#fragment",
  ]
    .map((href) => `[Card](${href})`)
    .join("\n");
  expect(
    cohereModelDocumentUrls(body, "https://docs.cohere.com/docs/models.md").map(({ href }) => href),
  ).toEqual(["https://docs.cohere.com/docs/command-a"]);
  expect(() => cohereModelDocumentUrls(body, "https://unreviewed.test/docs/models.md")).toThrow(
    "official documentation origin",
  );
});
