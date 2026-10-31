import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { expect, it, vi } from "vite-plus/test";
import { z } from "zod";
import { collectProvider } from "../src/catalog/collector.ts";
import { fetchSource } from "../src/catalog/fetch.ts";
import { manifests } from "../src/catalog/manifests.ts";
import { parseSource } from "../src/catalog/adapters.ts";
import { bedrockInferencePrices } from "../src/catalog/bedrock-inference-pricing.ts";
import { sha256 } from "../src/catalog/io.ts";
import { composeCatalogPair, coreCatalogVersion } from "../src/catalog/pricing-pair-transition.ts";
import {
  prepareCatalogPair,
  type CatalogPairCandidate,
} from "../src/catalog/pricing-publication.ts";
import { compileInferencePriceMapping } from "../src/catalog/inference-pricing-compilation.ts";
import { emptyPricingCatalog } from "../src/catalog/pricing-schema.ts";
import { calculationExport } from "../src/catalog/pricing-calculator-export.ts";
import { createInferencePriceLookup } from "../src/pricing/inference.ts";
import type { Selector } from "../src/pricing/schema.ts";
import { projectCatalogPair } from "../src/catalog/projections.ts";
import { compressedAsset } from "../src/catalog/asset-pack.ts";
import { websiteDetailChunkSchema } from "../src/catalog/website-schema.ts";
import { queryWebsiteInferencePrice } from "../src/catalog/inference-price-presentation.ts";
import type { Catalog } from "../src/catalog/schema.ts";

vi.mock("../src/catalog/fetch.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/catalog/fetch.ts")>()),
  fetchSource: vi.fn(),
}));
const root = "https://docs.aws.amazon.com/bedrock/latest/";
const at = "2026-10-31T00:00:00.000Z";
const fixture = (name: string) => readFile(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const bundleSchema = z.object({
  index: z.object({ url: z.string(), body: z.string() }),
  documents: z.array(z.object({ url: z.string(), body: z.string() })),
});
type Bundle = z.infer<typeof bundleSchema>;
async function collect(change?: (bundle: Bundle) => void, previous?: CatalogPairCandidate) {
  const manifest = manifests.find(({ provider }) => provider.id === "amazon-bedrock");
  const source = manifest?.sources.find(({ id }) => id === "bedrock-models");
  if (!manifest || !source) throw new Error("Missing Bedrock source");
  const bundle = bundleSchema.parse(JSON.parse(await fixture("document/bedrock.json")));
  const reviewed = bundleSchema.parse(
    JSON.parse(await fixture("document/bedrock-pricing-identity.json")),
  );
  const priceSchema = z.object({
    offerCode: z.string(),
    products: z.record(z.string(), z.unknown()),
    terms: z.object({ OnDemand: z.record(z.string(), z.unknown()) }),
  });
  for (const doc of bundle.documents.filter(({ url }) =>
    url.includes("/AmazonBedrockFoundationModels/current/index.json"),
  )) {
    const extra = reviewed.documents.find(({ url }) => url === doc.url);
    if (!extra) throw new Error("Missing reviewed Rerank prices");
    const prices = priceSchema.parse(JSON.parse(doc.body));
    const additional = priceSchema.parse(JSON.parse(extra.body));
    prices.products.RERANK = additional.products.RERANK;
    prices.terms.OnDemand.RERANK = additional.terms.OnDemand.RERANK;
    doc.body = JSON.stringify(prices);
  }
  for (const [path, file] of [
    ["userguide/model-card-openai-gpt-6-astra.md", "model-card-gpt6-context.md"],
    ["userguide/cross-region-inference.md", "invocation-cross-region-inference.md"],
    ["userguide/endpoints-region-availability.md", "endpoint-regions.md"],
    ["userguide/rerank-use.md", "invocation-rerank-use.md"],
    ["userguide/rerank-supported.md", "invocation-rerank-supported.md"],
    [
      "APIReference/API_agent-runtime_BedrockRerankingModelConfiguration.md",
      "invocation-API_agent-runtime_BedrockRerankingModelConfiguration.md",
    ],
  ]) {
    if (!path || !file) throw new Error("Missing fixture path");
    bundle.documents = bundle.documents.filter(({ url }) => url !== root + path);
    bundle.documents.push({ url: root + path, body: await fixture(`bedrock/${file}`) });
  }
  const list = bundle.documents.find(({ url }) => url.includes("/AmazonBedrock/current/"));
  if (!list) throw new Error("Missing price list");
  const priceList = z
    .object({
      offerCode: z.string(),
      products: z.record(z.string(), z.unknown()),
      terms: z.object({ OnDemand: z.record(z.string(), z.unknown()) }),
    })
    .parse(JSON.parse(list.body));
  priceList.products.ROUTING = {
    sku: "ROUTING",
    attributes: {
      feature: "Prompt Router",
      regionCode: "us-east-1",
      usagetype: "USE1-PromptRouter",
    },
  };
  priceList.terms.OnDemand.ROUTING = {
    term: {
      priceDimensions: {
        rate: {
          description: "$0.001 per request",
          unit: "Requests",
          pricePerUnit: { USD: "0.001" },
        },
      },
    },
  };
  list.body = JSON.stringify(priceList);
  change?.(bundle);
  const body = JSON.stringify(bundle);
  vi.mocked(fetchSource).mockResolvedValue({
    body,
    contentHash: sha256(body),
    etag: undefined,
    lastModified: undefined,
    dependencies: [],
  });
  const result = await collectProvider(
    { ...manifest, sources: [source] },
    previous?.catalog,
    { sources: {} },
    at,
  );
  if (!result.pricing) throw new Error(JSON.stringify(result.attempt));
  const catalog: Catalog = {
    catalog_version: coreCatalogVersion([result.provider]),
    generated_at: at,
    providers: [result.provider],
    models: result.models,
    sources: result.sources,
    coverage: [result.coverage],
    warnings: result.warnings,
  };
  const composed = composeCatalogPair(
    previous?.catalog,
    catalog,
    previous?.pricing.data ?? emptyPricingCatalog(),
    [{ kind: "fresh", partition: result.pricing }],
  );
  return compileInferencePriceMapping(
    prepareCatalogPair(composed.catalog, composed.pricing),
    result.inferencePriceSources ?? [],
    previous,
  );
}
function select(key: "region" | "operation" | "service_tier", value: string): Selector {
  return {
    kind: "categorical",
    dimension: { namespace: "kmodels", value: key },
    value: { namespace: "provider", provider_id: "amazon-bedrock", value },
  };
}
const conditions: Selector[] = [
  select("region", "us-east-1"),
  select("operation", "responses"),
  select("service_tier", "ultrafast"),
  {
    kind: "decimal",
    dimension: { namespace: "kmodels", value: "context_tokens" },
    value: "1000",
    unit: { factors: [{ unit: { namespace: "kmodels", value: "token" }, power: 1 }] },
  },
  {
    kind: "decimal",
    dimension: { namespace: "kmodels", value: "cache_ttl_seconds" },
    value: "1800",
    unit: { factors: [{ unit: { namespace: "kmodels", value: "second" }, power: 1 }] },
  },
];
function lookup(candidate: CatalogPairCandidate) {
  return createInferencePriceLookup(
    calculationExport(candidate.catalog, candidate.pricing),
    candidate.inference?.mapping,
  );
}
it("collects actual IDs through static output and uses the same commercial conditions in the UI", async () => {
  const candidate = await collect();
  const query = lookup(candidate);
  for (const [prefix, numerator, denominator] of [
    ["us", "33", "500000"],
    ["global", "3", "50000"],
  ]) {
    const model_id = `${prefix}.openai.gpt-6-astra`;
    expect(query({ provider_id: "amazon-bedrock", model_id }).status).toBe("candidates");
    const matched = query({ provider_id: "amazon-bedrock", model_id, selectors: conditions });
    expect(matched.status).toBe("matched");
    expect(
      matched.candidates.flatMap(({ offer }) =>
        offer.terms.flatMap((term) =>
          term.kind === "rate" && term.meter.value === "input_text"
            ? term.variants.map(({ price }) => price.value)
            : [],
        ),
      ),
    ).toEqual([{ numerator, denominator }]);
  }
  const base = candidate.inference?.mapping.rules.filter(
    ({ model_id }) => model_id === "openai.gpt-6-astra",
  );
  expect(base).toHaveLength(1);
  expect(base?.[0]?.fixed_selectors).toContainEqual({
    kind: "categorical",
    dimension: { namespace: "kmodels", value: "endpoint" },
    value: { namespace: "provider", provider_id: "amazon-bedrock", value: "bedrock-mantle" },
  });
  const projected = await projectCatalogPair(candidate);
  const publicMapping = projected.exports.manifest.assets.find(
    ({ file_name }) => file_name === "pricing/inference.json",
  );
  expect(publicMapping).toBeDefined();
  const details = projected.ui.manifest.assets
    .filter(({ file_name }) => file_name.includes("/details/"))
    .flatMap(
      (asset) =>
        websiteDetailChunkSchema.parse(
          JSON.parse(gunzipSync(compressedAsset(projected.ui.pack, asset)).toString("utf8")),
        ).details,
    );
  const id = details
    .find(({ model_ref }) => model_ref === "amazon-bedrock/openai.gpt-6-astra")
    ?.inference_prices?.find(({ model_id }) => model_id === "us.openai.gpt-6-astra");
  if (!id) throw new Error("Missing projected ID");
  expect(queryWebsiteInferencePrice(id, conditions, at).status).toBe("matched");
  const excluded = conditions.map((condition) =>
    condition.dimension.value === "region" ? select("region", "eu-north-1") : condition,
  );
  expect(queryWebsiteInferencePrice(id, excluded, at).reason).toBe("no_applicable_price");
  expect(
    query({ provider_id: "amazon-bedrock", model_id: id.model_id, selectors: excluded }).reason,
  ).toBe("no_applicable_price");
  expect(JSON.stringify(id)).not.toContain("content_hash");
});
it("does not infer private resource IDs, regional prefixes, or reranker ARNs", async () => {
  const candidate = await collect();
  const query = lookup(candidate);
  const literal = "arn:aws:bedrock:us-east-1::foundation-model/cohere.rerank-v3-5:0";
  expect(candidate.inference?.mapping.rules.some(({ model_id }) => model_id === literal)).toBe(
    true,
  );
  for (const model_id of [
    literal.replace("us-east-1", "us-west-2"),
    "eu.openai.gpt-6-astra",
    "arn:aws:bedrock:us-east-1:123456789012:application-inference-profile/private",
  ])
    expect(query({ provider_id: "amazon-bedrock", model_id }).reason).toBe("unreviewed_id");
});
it.each(["geography", "source billing", "request meaning"])(
  "withdraws an association when %s evidence changes, keeping canonical prices",
  async (kind) => {
    const previous = await collect();
    const candidate = await collect((bundle) => {
      for (const doc of bundle.documents) {
        if (kind === "geography")
          doc.body = doc.body.replace("**Geo: US**", "**Geo: Undocumented**");
        if (kind === "source billing")
          doc.body = doc.body.replace(
            "The price is calculated based on the Region from which you call an inference profile.",
            "Pricing semantics changed.",
          );
        if (kind === "request meaning")
          doc.body = doc.body.replace(
            "To call this model from code, use the following model IDs and endpoint URLs.",
            "Identifiers with unspecified meaning.",
          );
      }
    }, previous);
    expect(
      lookup(candidate)({ provider_id: "amazon-bedrock", model_id: "us.openai.gpt-6-astra" })
        .reason,
    ).toBe("unreviewed_id");
    expect(candidate.pricing.data.books.length).toBeGreaterThan(0);
  },
  15000,
);
it("does not require separate API syntax or account-profile configuration documents", async () => {
  const previous = await collect();
  const candidate = await collect((bundle) => {
    bundle.documents = bundle.documents.filter(
      ({ url }) => !/API_runtime_.*\.md|inference-profiles|userguide\/endpoints\.md/.test(url),
    );
    for (const doc of bundle.documents)
      doc.body = doc.body.replace(/## Capabilities and Features\n[\s\S]*?(?=\n## )/g, "");
  });
  const ids = (value: CatalogPairCandidate) =>
    value.inference?.mapping.rules.filter(({ model_id }) =>
      model_id.includes("openai.gpt-6-astra"),
    );
  expect(ids(candidate)).toEqual(ids(previous));
});

it("reads native ID declarations without protocol matrices and never invents a base ID", async () => {
  const manifest = manifests.find(({ provider }) => provider.id === "amazon-bedrock");
  const source = manifest?.sources.find(({ id }) => id === "bedrock-models");
  if (!manifest || !source) throw new Error("Missing Bedrock source");
  const documents = await Promise.all(
    [
      "model-card-openai-gpt-6-astra.md",
      "model-card-zai-glm-5-3.md",
      "model-card-moonshot-ai-kimi-k3.md",
      "model-card-anthropic-claude-haiku-4-5.md",
      "model-card-amazon-nova-2-sonic.md",
      "cross-region-inference.md",
    ].map(async (name) => ({
      url: `${root}userguide/${name}`,
      body: await fixture(`bedrock/invocation-${name}`),
    })),
  );
  const input = {
    provider: { ...manifest.provider, source_ids: [source.id] },
    source,
    observedAt: at,
    body: JSON.stringify({ index: { url: source.url, body: "# Model cards" }, documents }),
  };
  const parsed = parseSource(input);
  const before = bedrockInferencePrices(input, parsed.models, documents);
  expect(before.inference_prices.map(({ model_id }) => model_id)).toContain(
    "amazon.nova-2-sonic-v1:0",
  );
  expect(before.inference_prices.map(({ model_id }) => model_id)).not.toContain("zai.glm-5.3");
  expect(before.inference_prices.map(({ model_id }) => model_id)).not.toContain(
    "anthropic.claude-haiku-4-5-20251001-v1:0",
  );
  expect(
    before.inference_prices.some(
      ({ model_ref, model_id }) =>
        model_ref.includes("model-card-anthropic") && model_id.startsWith("global."),
    ),
  ).toBe(true);
  const withoutProtocol = documents.map((doc) => ({
    ...doc,
    body: doc.body.replace(
      /## (?:Endpoints and APIs supported|Capabilities and Features)\n[\s\S]*?(?=\n## )/g,
      "",
    ),
  }));
  expect(bedrockInferencePrices(input, parsed.models, withoutProtocol)).toEqual(before);
  const changed = documents.map((doc) => ({
    ...doc,
    body: doc.body.replace(
      /^(?:Use the following model IDs? and endpoint URLs? to access this model programmatically\.|To call this model from code, use the following model IDs and endpoint URLs\.)/gm,
      "> $&",
    ),
  }));
  expect(bedrockInferencePrices(input, parsed.models, changed).inference_prices).toEqual([]);
});
