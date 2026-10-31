import { readFile } from "node:fs/promises";
import { expect, it } from "vite-plus/test";
import { parseSource } from "../src/catalog/adapters.ts";
import { manifests, type SourceManifest } from "../src/catalog/manifests.ts";
import { linkedDocumentUrls } from "../src/catalog/fetch.ts";
import { parseMistralPricingPolicy } from "../src/catalog/mistral-pricing-policy.ts";
import { extractMistralCommercialFacts } from "../src/catalog/mistral-commercial-source.ts";
import type { PricingReconciliationItem } from "../src/catalog/pricing-reconciliation.ts";

const fixture = (name: string) =>
  readFile(new URL(`./fixtures/mistral/${name}`, import.meta.url), "utf8");
const manifest = manifests.find(({ provider }) => provider.id === "mistral");
if (manifest === undefined) throw new Error("Missing Mistral manifest");
const provider = { ...manifest.provider, source_ids: manifest.sources.map(({ id }) => id) };
const source: SourceManifest | undefined = manifest.sources.find(
  ({ id }) => id === "mistral-models",
);
if (source?.linkedDocuments === undefined) throw new Error("Missing model source");
const catalogSource: SourceManifest = {
  ...source,
  extractor: { kind: "mistral-catalog", minModels: 3, maxModels: 3 },
  linkedDocuments: { ...source.linkedDocuments, minDocuments: 3, maxDocuments: 3 },
};

async function bundle() {
  return {
    index: { url: catalogSource.url, body: await fixture("models.md") },
    documents: [
      ...(await Promise.all(
        ["mistral-medium-3-5-26-04", "codestral-24-05"].map(async (slug) => ({
          url: `https://docs.mistral.ai/models/${slug}.md`,
          body: await fixture(`${slug}.md`),
        })),
      )),
      {
        url: "https://docs.mistral.ai/models/shieldstral-1-0.md",
        body: "# Shieldstral 1.0\n\nOpen weights with no API names.",
      },
      {
        url: "https://docs.mistral.ai/studio/batch-processing.md",
        body: await fixture("batch-processing.md"),
      },
      {
        url: "https://docs.mistral.ai/studio/conversations/advanced/prompt-caching.md",
        body: await fixture("prompt-caching.md"),
      },
    ],
  };
}

it("migrates the official Markdown inventory without losing aliases, retired models, rates or routes", async () => {
  const evidence = await bundle();
  expect(linkedDocumentUrls(evidence.index.body, catalogSource).map(({ href }) => href)).toEqual([
    "https://docs.mistral.ai/models/codestral-24-05.md",
    "https://docs.mistral.ai/models/mistral-medium-3-5-26-04.md",
    "https://docs.mistral.ai/models/shieldstral-1-0.md",
  ]);
  const result = parseSource({
    provider,
    source: catalogSource,
    observedAt: "2026-10-30T00:00:00Z",
    body: JSON.stringify(evidence),
  });
  expect(result.models).toHaveLength(2);
  expect(result.models.find(({ model_id }) => model_id === "mistral-medium-3-5")).toMatchObject({
    aliases: ["mistral-medium-3", "mistral-medium-latest"],
    limits: { context_tokens: 256000 },
    api_endpoints: expect.arrayContaining([
      { name: "Chat / Completions", path: "/v1/chat/completions" },
    ]),
    price_facts: expect.arrayContaining([
      expect.objectContaining({ meter: "input_text", price: "1.5" }),
      expect.objectContaining({
        meter: "input_text",
        price: "0.75",
        conditions: expect.objectContaining({ service_tier: "batch" }),
      }),
      expect.objectContaining({ meter: "cache_read_text", price: "0.15" }),
    ]),
  });
  expect(result.models.find(({ model_id }) => model_id === "codestral-2405")).toMatchObject({
    status: "retired",
    pricing_state: "not_applicable",
    price_facts: [],
  });
  evidence.documents = evidence.documents.filter(({ url }) => !url.endsWith("codestral-24-05.md"));
  expect(() =>
    parseSource({
      provider,
      source: catalogSource,
      observedAt: "2026-10-30T00:00:00Z",
      body: JSON.stringify(evidence),
    }),
  ).toThrow("disagree");
});

it("records a model card without a price as unknown instead of source-contract drift", async () => {
  const evidence = await bundle();
  const withoutPrice = (body: string) => body.replace(/^- Pricing: .*$\n?/mu, "");
  const parse = (body: string) => {
    const findings: unknown[] = [];
    const items: PricingReconciliationItem[] = [];
    const result = parseSource({
      provider,
      source: catalogSource,
      observedAt: "2026-10-30T00:00:00Z",
      body: JSON.stringify({
        ...evidence,
        documents: evidence.documents.map((document) =>
          document.url.endsWith("mistral-medium-3-5-26-04.md") ? { ...document, body } : document,
        ),
      }),
      onContractFinding: (finding) => findings.push(finding),
      onPricingReconciliation: (item) => items.push(item),
    });
    return { findings, items, result };
  };
  const absent = parse(withoutPrice(await fixture("mistral-medium-3-5-26-04.md")));
  expect(
    absent.result.models.find(({ model_id }) => model_id === "mistral-medium-3-5"),
  ).toMatchObject({ pricing_state: "unknown", price_facts: [] });
  expect(absent.items).toContainEqual({
    disposition: "excluded",
    reason_code: "repository_price_not_published",
    sample: "mistral-medium-3-5-26-04",
  });
  expect(absent.findings).toEqual([]);
  const unreadable = parse(
    (await fixture("mistral-medium-3-5-26-04.md")).replace(
      "- Pricing: Input $1.5 /M Tokens; Output $7.5 /M Tokens",
      "- Pricing: Input one point five /M Tokens; Output seven /M Tokens",
    ),
  );
  expect(unreadable.items).toContainEqual({
    disposition: "unsupported",
    reason_code: "repository_price_shape_unsupported",
    sample: "mistral-medium-3-5-26-04",
  });
  expect(unreadable.items).not.toContainEqual(
    expect.objectContaining({ reason_code: "repository_price_not_published" }),
  );
  expect(
    unreadable.result.models.find(({ model_id }) => model_id === "mistral-medium-3-5"),
  ).toMatchObject({ pricing_state: "unknown", price_facts: [] });
});

it("does not replace an inventory identity with a different model card", async () => {
  const evidence = await bundle();
  evidence.documents = evidence.documents.map((document) => ({
    ...document,
    body: document.body.replace("`mistral-medium-3-5`", "`unrelated-model`"),
  }));
  const findings: unknown[] = [];
  const result = parseSource({
    provider,
    source: catalogSource,
    observedAt: "2026-10-30T00:00:00Z",
    body: JSON.stringify(evidence),
    onContractFinding: (finding) => findings.push(finding),
  });
  expect(result.models.map(({ model_id }) => model_id)).toEqual(["codestral-2405"]);
  expect(findings).not.toHaveLength(0);
});

it("reads the shipped currency formatter with exact lexical precision and rejects ambiguous or drifting arithmetic", async () => {
  const body = await fixture("pricing-runtime.txt");
  const index = { url: "https://docs.mistral.ai/inference/pricing", body: "" };
  const document = { url: "https://docs.mistral.ai/_next/static/chunks/pricing.js", body };
  const parse = (documents: { url: string; body: string }[]) =>
    parseMistralPricingPolicy({ index, documents }, "mistral-pricing", undefined);
  expect(parse([document]).euro).toEqual({ factor: "0.85", decimals: 7 });
  expect(parse([{ ...document, body: body.replace("0.85", "0.9") }]).euro).toEqual({
    factor: "0.9",
    decimals: 7,
  });
  expect(parse([document, document]).euro).toBeUndefined();
  expect(parse([{ ...document, body: body.replace("0.85 * e", "0.85 + e") }]).euro).toBeUndefined();
  expect(parse([{ ...document, url: "https://example.com/pricing.js" }]).euro).toBeUndefined();
  expect(parse([{ ...document, body: `function unrelated() { ${body} }` }]).euro).toEqual({
    factor: "0.85",
    decimals: 7,
  });
  expect(parse([{ ...document, body: body + body }]).euro).toBeUndefined();
  for (const changed of [
    body.replace("eur: 7", "eur: 7, eur: 8"),
    body.replace("eur: 7", "eur: 19"),
    body.replace("0.85 * e", "0.85 * unrelated"),
    body.replace("i[t]", "i[e]"),
  ])
    expect(parse([{ ...document, body: changed }]).euro).toBeUndefined();
});

it("discovers pricing runtime scripts only within the reviewed opt-in host and path", () => {
  const pricing: SourceManifest | undefined = manifest?.sources.find(
    ({ id }) => id === "mistral-pricing",
  );
  if (pricing?.linkedDocuments === undefined) throw new Error("Missing pricing source");
  const body =
    '<script src="/_next/static/chunks/pricing.js"></script><script src="https://example.com/_next/static/chunks/foreign.js"></script><script src="/other.js"></script><script src="/_next/static/chunks/query.js?track=1"></script>';
  expect(linkedDocumentUrls(body, pricing).map(({ href }) => href)).toEqual([
    "https://docs.mistral.ai/_next/static/chunks/pricing.js",
  ]);
  expect(
    linkedDocumentUrls(body, {
      ...pricing,
      linkedDocuments: { ...pricing.linkedDocuments, includeScripts: false },
    }),
  ).toEqual([]);
});

it("keeps omitted tool tariffs explicitly unknown while preserving independently current service identity", () => {
  const result = extractMistralCommercialFacts(
    {
      models: [],
      sourceId: "mistral-pricing",
      documents: [
        {
          url: "https://docs.mistral.ai/studio/agents/agent-tools/websearch.md",
          body: "Websearch supports web_search and web_search_premium.",
        },
      ],
    },
    [],
  );
  expect(
    result.map(({ resource_key, pricing_state, price_facts }) => ({
      resource_key,
      pricing_state,
      price_facts,
    })),
  ).toEqual([
    { resource_key: "web-search", pricing_state: "unknown", price_facts: [] },
    { resource_key: "premium-news", pricing_state: "unknown", price_facts: [] },
  ]);
  expect(result.every(({ raw_price_facts }) => raw_price_facts.length === 1)).toBe(true);
});
