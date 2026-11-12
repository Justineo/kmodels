import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { expect, it, vi } from "vite-plus/test";
import { z } from "zod";
import { collectProvider } from "../src/catalog/collector.ts";
import { fetchSource } from "../src/catalog/fetch.ts";
import { manifests } from "../src/catalog/manifests.ts";
import { parseSource } from "../src/catalog/adapters.ts";
import { bedrockInferencePrices } from "../src/catalog/bedrock-inference-pricing.ts";
import { bedrockMeteredRatesUrl } from "../src/catalog/bedrock-nova-pricing.ts";
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
import { restoreInferencePrices } from "../src/catalog/website-inference-storage.ts";
import { queryWebsiteInferencePrice } from "../src/catalog/inference-price-presentation.ts";
import { websiteInferencePrices } from "../src/catalog/website-inference-pricing.ts";
import { websitePublication } from "../src/catalog/website-data.ts";
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
const priceListSchema = z.object({
  offerCode: z.string(),
  products: z.record(z.string(), z.unknown()),
  terms: z.object({ OnDemand: z.record(z.string(), z.unknown()) }),
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
  for (const doc of bundle.documents.filter(({ url }) =>
    url.includes("/AmazonBedrockFoundationModels/current/index.json"),
  )) {
    const extra = reviewed.documents.find(({ url }) => url === doc.url);
    if (!extra) throw new Error("Missing reviewed Rerank prices");
    const prices = priceListSchema.parse(JSON.parse(doc.body));
    const additional = priceListSchema.parse(JSON.parse(extra.body));
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
  const priceList = priceListSchema.parse(JSON.parse(list.body));
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
function select(key: "region" | "operation" | "service_tier" | "speed", value: string): Selector {
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

it("resolves India Kimi rates by the literal profile without borrowing other geographies' tier multipliers", async () => {
  const body = await fixture("bedrock/invocation-model-card-moonshot-ai-kimi-k3.md");
  const candidate = await collect((bundle) => {
    bundle.documents.push({
      url: `${root}userguide/model-card-moonshot-ai-kimi-k3.md`,
      body,
    });
  });
  const query = lookup(candidate);
  const selectors = [select("service_tier", "standard")];
  const provider_id = "amazon-bedrock";
  const model_id = "in.moonshotai.kimi-k3";
  const result = query({ provider_id, model_id, selectors });
  expect(result.status).toBe("matched");
  const rates = result.candidates.flatMap(({ offer }) =>
    offer.terms.flatMap((term) =>
      term.kind === "rate"
        ? [[term.meter.value, term.variants.map(({ price }) => price.value)]]
        : [],
    ),
  );
  expect(rates).toHaveLength(4);
  expect(rates).toEqual(
    expect.arrayContaining([
      ["input_text", [{ numerator: "33", denominator: "10000000" }]],
      ["output_text", [{ numerator: "33", denominator: "2000000" }]],
      ["cache_read_text", [{ numerator: "33", denominator: "100000000" }]],
      ["cache_write_text", [{ numerator: "33", denominator: "8000000" }]],
    ]),
  );
  const cacheWrite = result.candidates.flatMap(({ offer }) =>
    offer.terms.flatMap((term) =>
      term.kind === "rate" && term.meter.value === "cache_write_text" ? term.variants : [],
    ),
  );
  expect(cacheWrite).toHaveLength(1);
  expect(cacheWrite[0]?.charge_binding).toMatchObject({
    signal: { namespace: "provider", provider_id, value: "cache_write_1800s_input_tokens" },
  });
  expect(cacheWrite[0]?.charge_binding?.quantity_methods).toBeUndefined();
  if (candidate.inference === undefined) throw new Error("Missing Kimi K3 inference mapping");
  const rows = websiteInferencePrices(
    candidate.catalog,
    candidate.pricing,
    candidate.inference.mapping,
  );
  const website = websitePublication(
    candidate.catalog,
    candidate.pricing.data,
    "a".repeat(64),
    rows,
  );
  const price = rows
    .get(`${provider_id}/moonshotai.kimi-k3`)
    ?.find((row) => row.model_id === model_id);
  if (price === undefined) throw new Error("Missing Kimi K3 India website price");
  expect(
    price.pricing_options?.some(({ dimension }) => dimension.value === "cache_ttl_seconds"),
  ).toBe(false);
  const projected = queryWebsiteInferencePrice(price, selectors, at);
  expect(projected.status).toBe("matched");
  const visibleRates = projected.candidates.flatMap(
    ({ offer_ref, row_keys }) =>
      website.offers
        .flatMap(({ offers }) => offers)
        .find(({ id }) => id === offer_ref)
        ?.rates.filter(({ key }) => row_keys?.includes(key)) ?? [],
  );
  expect(visibleRates).toContainEqual(
    expect.objectContaining({ label: "Cache write (30 min)", amount: "$4.125" }),
  );
  for (const tier of ["priority", "flex"]) {
    const paid = [select("service_tier", tier), select("operation", "chat_completions")];
    expect(query({ provider_id, model_id, selectors: paid }).reason).toBe("no_applicable_price");
    expect(
      query({ provider_id, model_id: "us.moonshotai.kimi-k3", selectors: paid }).candidates,
    ).not.toHaveLength(0);
  }
}, 15000);

it("keeps shared commercial Geo rates and named tier rates within each profile's source Regions", async () => {
  const candidate = await collect((bundle) => {
    const card = bundle.documents.find(({ url }) =>
      url.endsWith("model-card-openai-gpt-6-astra.md"),
    );
    if (card === undefined) throw new Error("Missing Bedrock OpenAI fixture");
    const indiaGeo = [
      "**Geo: India**",
      "",
      "Geo inference ID: `in.openai.gpt-6-astra`",
      "",
      "| Source Region | Destination Regions |",
      "| --- | --- |",
      "| ap-south-1 (Mumbai) | ap-south-1 (Mumbai) |",
      "",
      "",
    ].join("\n");
    card.body = card.body
      .replace("## Programmatic Access", "## Call the model")
      .replace(
        "To call this model from code, use the following model IDs and endpoint URLs.",
        "Use these model IDs and endpoint URLs to call the model.",
      )
      .replace("## Regional Availability", "## Supported Regions")
      .replaceAll("Availability using the `", "The `")
      .replaceAll("APIs supported on `", "APIs supported on the `")
      .replaceAll("Input Modalities", "Input modalities")
      .replaceAll("Output Modalities", "Output modalities")
      .replace("us.openai.gpt-6-astra |", "us.openai.gpt-6-astra, in.openai.gpt-6-astra |")
      .replaceAll("Geo CRIS (US)", "US Geo CRIS")
      .replace(
        /^\| ap-south-1 \(Mumbai\).*$/m,
        "| ap-south-1 | Not supported | Supported | Supported |",
      )
      .replace("## Quotas and Limits", `${indiaGeo}## Quotas and Limits`);
  });
  const query = lookup(candidate);
  const provider_id = "amazon-bedrock";
  const standard = [
    ...conditions.filter(({ dimension }) => !["region", "service_tier"].includes(dimension.value)),
    select("service_tier", "standard"),
  ];
  for (const [prefix, region, otherRegion] of [
    ["in", "ap-south-1", "us-east-1"],
    ["us", "us-east-1", "ap-south-1"],
  ] as const) {
    const model_id = `${prefix}.openai.gpt-6-astra`;
    expect(
      query({ provider_id, model_id, selectors: [...standard, select("region", region)] }).status,
    ).toBe("matched");
    expect(
      query({ provider_id, model_id, selectors: [...standard, select("region", otherRegion)] })
        .reason,
    ).toBe("no_applicable_price");
  }
  expect(
    query({ provider_id, model_id: "us.openai.gpt-6-astra", selectors: conditions }).status,
  ).toBe("matched");
  expect(
    query({ provider_id, model_id: "in.openai.gpt-6-astra", selectors: conditions }).reason,
  ).toBe("no_applicable_price");
});

it("associates the AWS GovCloud profile geography published by the model card", async () => {
  const addGovCloud = (bundle: Bundle, label: string) => {
    const card = bundle.documents.find(({ url }) =>
      url.endsWith("model-card-openai-gpt-6-astra.md"),
    );
    if (card === undefined) throw new Error("Missing Bedrock OpenAI fixture");
    const govGeo = [
      `**Geo: ${label}**`,
      "",
      "Geo Inference ID: `us-gov.openai.gpt-6-astra`",
      "",
      "| Source Region | Destination Regions |",
      "| --- | --- |",
      "| us-gov-east-1 (AWS GovCloud (US-East)) | us-gov-east-1 (AWS GovCloud (US-East)), us-gov-west-1 (AWS GovCloud (US-West)) |",
      "| us-gov-west-1 (AWS GovCloud (US-West)) | us-gov-east-1 (AWS GovCloud (US-East)), us-gov-west-1 (AWS GovCloud (US-West)) |",
      "",
      "",
    ].join("\n");
    card.body = card.body
      .replace("## Programmatic Access", "## Call the model")
      .replace(
        "To call this model from code, use the following model IDs and endpoint URLs.",
        "Use these model IDs and endpoint URLs to call the model.",
      )
      .replace("## Regional Availability", "## Supported Regions")
      .replaceAll("Availability using the `", "The `")
      .replaceAll("APIs supported on `", "APIs supported on the `")
      .replaceAll("Input Modalities", "Input modalities")
      .replaceAll("Output Modalities", "Output modalities")
      .replaceAll("Geo CRIS (US)", "US Geo CRIS")
      .replace(
        "| us.openai.gpt-6-astra | global.openai.gpt-6-astra |",
        "| us.openai.gpt-6-astra, us-gov.openai.gpt-6-astra in the AWS GovCloud (US) Regions | global.openai.gpt-6-astra |",
      )
      .replace("## Quotas and Limits", `${govGeo}## Quotas and Limits`);
  };
  const govRules = (candidate: CatalogPairCandidate) =>
    candidate.inference?.mapping.rules.filter(
      ({ model_id }) => model_id === "us-gov.openai.gpt-6-astra",
    ) ?? [];
  const candidate = await collect((bundle) => addGovCloud(bundle, "US-GOV"));
  expect(govRules(candidate)).toHaveLength(1);
  expect(govRules(candidate)[0]?.fixed_selectors).toContainEqual({
    kind: "categorical",
    dimension: { namespace: "kmodels", value: "inference_geo" },
    value: { namespace: "provider", provider_id: "amazon-bedrock", value: "us-gov" },
  });
  expect(
    lookup(candidate)({ provider_id: "amazon-bedrock", model_id: "us-gov.openai.gpt-6-astra" })
      .reason,
  ).not.toBe("unreviewed_id");
  const undocumented = await collect((bundle) => addGovCloud(bundle, "Undocumented"));
  expect(govRules(undocumented)).toHaveLength(0);
  expect(
    lookup(undocumented)({
      provider_id: "amazon-bedrock",
      model_id: "us-gov.openai.gpt-6-astra",
    }).reason,
  ).toBe("unreviewed_id");
}, 20_000);

it("binds Nova Geo prices through the exact page token and native SKU", async () => {
  const reviewed = bundleSchema.parse(JSON.parse(await fixture("bedrock/nova-global-tiers.json")));
  const sku = "FY8T82UUN7VZR55K";
  const rateCode = `${sku}.JRTCKXETXF.6YS6EN2CT7`;
  const token = "jAqLUFZWnT3mWI7H1MUtAWVOngCMiV5V5M6X59_t_VU";
  const location = "US East (N. Virginia)";
  const build = (amount: string) =>
    collect((bundle) => {
      for (const doc of reviewed.documents) {
        const old = bundle.documents.find(({ url }) => url === doc.url);
        if (old === undefined) bundle.documents.push({ ...doc });
        else if (!doc.url.includes("pricing.us-east-1")) old.body = doc.body;
        else {
          const combined = priceListSchema.parse(JSON.parse(old.body));
          const additional = priceListSchema.parse(JSON.parse(doc.body));
          Object.assign(combined.products, additional.products);
          Object.assign(combined.terms.OnDemand, additional.terms.OnDemand);
          combined.products[sku] = {
            sku,
            attributes: {
              model: "Nova 2.0 Lite",
              location,
              regionCode: "us-east-1",
              usagetype: "USE1-Nova2.0Lite-input-tokens",
              feature: "On-demand Inference",
              inferenceType: "Input tokens",
            },
          };
          combined.terms.OnDemand[sku] = {
            term: {
              priceDimensions: {
                [rateCode]: {
                  rateCode,
                  description:
                    "$0.00033 per 1K tokens for USE1-Nova2.0Lite-input-tokens in US East (N. Virginia)",
                  unit: "1K tokens",
                  pricePerUnit: { USD: "0.0003300000" },
                },
              },
            },
          };
          old.body = JSON.stringify(combined);
        }
      }
      const markup = `<h3>Standard Tier</h3><table><thead><tr><th>Amazon Nova models</th><th>Price per 1M input tokens</th><th>Price per 1M output tokens</th></tr></thead><tbody><tr><td>Amazon Nova 2 Lite</td><td>{priceOf!bedrock/bedrock!${token}!*!1000}</td><td>—</td></tr></tbody></table>`;
      bundle.documents.push(
        {
          url: "https://aws.amazon.com/bedrock/pricing/",
          body: `<h2>Amazon Nova</h2><h3>Pricing for Understanding Models</h3><h4>Geo Cross-region inference and in-region</h4><div data-pricing-markup='${markup}'></div>`,
        },
        {
          url: bedrockMeteredRatesUrl,
          body: JSON.stringify({
            regions: {
              [location]: { [token]: { rateCode, price: amount, RegionlessRateCode: token } },
            },
          }),
        },
      );
    });
  const provider_id = "amazon-bedrock";
  const model_id = "us.amazon.nova-2-lite-v1:0";
  const selectors = [
    select("region", "us-east-1"),
    select("service_tier", "standard"),
    select("speed", "standard"),
  ];
  const query = lookup(await build("0.0003300000"));
  const result = query({ provider_id, model_id, selectors });
  expect(result.status).toBe("matched");
  expect(
    result.candidates.flatMap(({ offer }) =>
      offer.terms.flatMap((term) =>
        term.kind === "rate" && term.meter.value === "input_text"
          ? term.variants.map(({ price }) => price.value)
          : [],
      ),
    ),
  ).toEqual([{ numerator: "33", denominator: "100000000" }]);
  expect(query({ provider_id, model_id: "jp.amazon.nova-2-lite-v1:0", selectors }).reason).toBe(
    "no_applicable_price",
  );
  expect(lookup(await build("0.0003400000"))({ provider_id, model_id, selectors }).reason).toBe(
    "no_applicable_price",
  );
}, 20_000);

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
  const stored = details.find(
    ({ model_ref }) => model_ref === "amazon-bedrock/openai.gpt-6-astra",
  )?.inference_prices;
  if (stored === undefined) throw new Error("Missing stored inference prices");
  const id = restoreInferencePrices(stored).find(
    ({ model_id }) => model_id === "us.openai.gpt-6-astra",
  );
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
}, 20_000);
it("keeps Nova Global Standard, Priority and Flex token tariffs disjoint through publication", async () => {
  const reviewed = bundleSchema.parse(JSON.parse(await fixture("bedrock/nova-global-tiers.json")));
  const candidate = await collect((bundle) => {
    for (const doc of reviewed.documents) {
      const previous = bundle.documents.find(({ url }) => url === doc.url);
      if (previous === undefined) bundle.documents.push(doc);
      else if (doc.url.includes("pricing.us-east-1")) {
        const prices = priceListSchema.parse(JSON.parse(previous.body));
        const extra = priceListSchema.parse(JSON.parse(doc.body));
        Object.assign(prices.products, extra.products);
        Object.assign(prices.terms.OnDemand, extra.terms.OnDemand);
        previous.body = JSON.stringify(prices);
      } else previous.body = doc.body;
    }
  });
  const query = lookup(candidate);
  const model_id = "global.amazon.nova-2-lite-v1:0";
  const undecided = query({ provider_id: "amazon-bedrock", model_id });
  expect(undecided.status).toBe("candidates");
  expect(undecided.missing_conditions).toContainEqual({
    namespace: "kmodels",
    value: "service_tier",
  });
  const projected = await projectCatalogPair(candidate);
  const details = projected.ui.manifest.assets
    .filter(({ file_name }) => file_name.includes("/details/"))
    .flatMap(
      (asset) =>
        websiteDetailChunkSchema.parse(
          JSON.parse(gunzipSync(compressedAsset(projected.ui.pack, asset)).toString("utf8")),
        ).details,
    );
  const stored = details.find(
    ({ model_ref }) => model_ref === "amazon-bedrock/amazon.nova-2-lite-v1:0",
  )?.inference_prices;
  if (stored === undefined) throw new Error("Missing Nova Global inference prices");
  const id = restoreInferencePrices(stored).find((entry) => entry.model_id === model_id);
  if (id === undefined) throw new Error("Missing Nova Global inference ID");
  for (const [tier, numerator, denominator] of [
    ["standard", "9", "25000000"],
    ["priority", "63", "100000000"],
    ["flex", "9", "50000000"],
  ] as const) {
    const selectors: Selector[] = [
      select("region", "ap-east-2"),
      select("service_tier", tier),
      {
        kind: "decimal",
        dimension: { namespace: "kmodels", value: "cache_ttl_seconds" },
        value: "300",
        unit: { factors: [{ unit: { namespace: "kmodels", value: "second" }, power: 1 }] },
      },
    ];
    const result = query({ provider_id: "amazon-bedrock", model_id, selectors });
    expect(result.status).toBe("matched");
    expect(result.candidates).toHaveLength(1);
    const terms = result.candidates.flatMap(({ offer }) => offer.terms);
    expect(
      terms.flatMap((term) => (term.kind === "raw" ? term.variants : term.raw_variants)),
    ).toEqual([]);
    const rates = terms.filter((term) => term.kind === "rate");
    expect(rates.map(({ meter }) => meter.value).sort()).toEqual([
      "cache_read_text",
      "cache_write_text",
      "input_text",
      "output_text",
    ]);
    expect(
      rates
        .find(({ meter }) => meter.value === "input_text")
        ?.variants.map(({ price }) => price.value),
    ).toEqual([{ numerator, denominator }]);
    expect(queryWebsiteInferencePrice(id, selectors, at).status).toBe(result.status);
  }
}, 20_000);

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
}, 20_000);

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
