import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { z } from "zod";
import { expect, it, vi } from "vite-plus/test";
import { linkedBundleSchema } from "../src/catalog/bundle.ts";
import { collectProvider } from "../src/catalog/collector.ts";
import { fetchSource } from "../src/catalog/fetch.ts";
import { manifests } from "../src/catalog/manifests.ts";
import { sha256 } from "../src/catalog/io.ts";
import { composeCatalogPair, coreCatalogVersion } from "../src/catalog/pricing-pair-transition.ts";
import {
  prepareCatalogPair,
  type CatalogPairCandidate,
} from "../src/catalog/pricing-publication.ts";
import { compileInferencePriceMapping } from "../src/catalog/inference-pricing-compilation.ts";
import { emptyPricingCatalog } from "../src/catalog/pricing-schema.ts";
import { priceDataExport } from "../src/catalog/pricing-lookup-export.ts";
import { createInferencePriceLookup } from "../src/pricing/inference.ts";
import { projectCatalogPair } from "../src/catalog/projections.ts";
import { compressedAsset } from "../src/catalog/asset-pack.ts";
import {
  websiteDetailChunkSchema,
  websiteOfferChunkSchema,
} from "../src/catalog/website-schema.ts";
import { queryWebsiteInferencePrice } from "../src/catalog/inference-price-presentation.ts";
import { restoreWebsiteInferenceDetail } from "./website-inference-detail.ts";
import { renderComponent } from "./render-component.ts";
import InferencePrices from "../src/components/InferencePrices.vue";
import type { Catalog } from "../src/catalog/schema.ts";
import { yamlBlock } from "../src/catalog/yaml.ts";
import { readCerebrasReferences } from "../src/catalog/cerebras-accounting.ts";

vi.mock("../src/catalog/fetch.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/catalog/fetch.ts")>()),
  fetchSource: vi.fn(),
}));
const at = "2026-10-30T17:15:00.000Z";
const fixture = (file: string) =>
  readFile(new URL(`./fixtures/cerebras/${file}`, import.meta.url), "utf8");
const inventorySchema = z.object({
  object: z.literal("list"),
  data: z.array(z.object({ id: z.string() }).loose()),
});
type Input = {
  catalog: ReturnType<typeof linkedBundleSchema.parse>;
  inventory: z.infer<typeof inventorySchema>;
};
async function currentReasoning(catalog: Input["catalog"]): Promise<void> {
  let document = catalog.documents.find(({ url }) => url.endsWith("/chat-completions.md"));
  if (document === undefined) {
    document = {
      url: "https://inference-docs.cerebras.ai/api-reference/chat-completions.md",
      body: await fixture("chat-completions.md"),
    };
    catalog.documents.push(document);
  }
  const before = yamlBlock(document.body, "reasoning_effort", 8);
  if (before === undefined) throw Error("Missing owned parameter");
  document.body = document.body.replace(
    before,
    (await fixture("reasoning-options-folded.txt")).trimEnd(),
  );
}
async function collect(
  change?: (input: Input) => void | Promise<void>,
  previous?: CatalogPairCandidate,
  publicOnly = false,
) {
  const manifest = manifests.find(({ provider }) => provider.id === "cerebras");
  const catalog = manifest?.sources.find(({ id }) => id === "cerebras-catalog");
  const inventory = manifest?.sources.find(({ id }) => id === "cerebras-models");
  if (!manifest || !catalog || !inventory) throw new Error("Missing Cerebras sources");
  const input = {
    catalog: linkedBundleSchema.parse(JSON.parse(await fixture("inference-current-catalog.json"))),
    inventory: inventorySchema.parse(JSON.parse(await fixture("inference-current-public.json"))),
  };
  await change?.(input);
  vi.mocked(fetchSource).mockImplementation(async (source) => {
    const body = JSON.stringify(source.id === catalog.id ? input.catalog : input.inventory);
    return {
      body,
      contentHash: sha256(body),
      etag: undefined,
      lastModified: undefined,
      dependencies: [],
    };
  });
  const result = await collectProvider(
    { ...manifest, sources: publicOnly ? [inventory] : [catalog, inventory] },
    previous?.catalog,
    { sources: {} },
    at,
  );
  if (!result.pricing) throw new Error(JSON.stringify(result.attempt));
  const core: Catalog = {
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
    core,
    previous?.pricing.data ?? emptyPricingCatalog(),
    [{ kind: "fresh", partition: result.pricing }],
  );
  return compileInferencePriceMapping(
    prepareCatalogPair(composed.catalog, composed.pricing),
    result.inferencePriceSources ?? [],
    previous,
  );
}
function lookup(candidate: CatalogPairCandidate) {
  return createInferencePriceLookup(
    priceDataExport(candidate.catalog, candidate.pricing),
    candidate.inference?.mapping,
  );
}

it("uses exact paid card limits and the current typed reasoning table without changing API price authority", async () => {
  const candidate = await collect(async ({ catalog }) => {
    await currentReasoning(catalog);
    const card = catalog.documents.find(({ url }) => url.endsWith("/qwen-3.8-27b.md"));
    if (!card) throw Error("Missing model card");
    card.body = card.body.replace("\\$0.99", "\\$1.23");
  });
  const model = candidate.catalog.models.find(({ model_id }) => model_id === "qwen-3.8-27b");
  expect(model).toMatchObject({
    limits: { context_tokens: 131072, max_output_tokens: 40960 },
    capabilities: { effort_control: true },
    api_endpoints: expect.arrayContaining([
      { name: "Chat Completions", path: "v1/chat/completions" },
    ]),
  });
  const result = lookup(candidate)({ provider_id: "cerebras", model_id: "qwen-3.8-27b" });
  const input = result.candidates
    .flatMap(({ offer }) => offer.terms)
    .find((term) => term.kind === "rate" && term.meter.value === "input_text");
  expect(input?.kind === "rate" ? input.variants.map(({ price }) => price.value) : []).toEqual([
    { numerator: "99", denominator: "100000000" },
  ]);
  expect(
    input?.kind === "rate"
      ? input.variants.flatMap(
          ({ charge_binding }) =>
            charge_binding?.quantity_methods?.flatMap(
              ({ input_sources }) => input_sources?.map(({ locator }) => locator.value) ?? [],
            ) ?? [],
        )
      : [],
  ).toContain("/usage/prompt_tokens");
});

it("distinguishes ignored reasoning parameters and duplicate model rows from controllable effort", async () => {
  const catalog = linkedBundleSchema.parse(
    JSON.parse(await fixture("inference-current-catalog.json")),
  );
  await currentReasoning(catalog);
  const first = readCerebrasReferences({
    documents: catalog.documents,
    sourceRef: "cerebras-catalog",
  });
  expect(first.chatModels.has("qwen-3.8-27b")).toBe(true);
  expect(first.chatModels.has("kimi-k2.7-code")).toBe(true);
  expect(first.effortModels.has("kimi-k2.7-code")).toBe(false);
  const doc = catalog.documents.find(({ url }) => url.endsWith("/chat-completions.md"));
  if (!doc) throw Error("Missing native reference");
  const line = doc.body.split("\n").find((line) => line.includes("| `qwen-3.8-27b` |"));
  if (!line) throw Error("Missing owned model row");
  doc.body = doc.body.replace(line, `${line}\n\n${line}`);
  const duplicate = readCerebrasReferences({
    documents: catalog.documents,
    sourceRef: "cerebras-catalog",
  });
  expect(duplicate.chatModels.has("qwen-3.8-27b")).toBe(false);
  expect(duplicate.effortModels.has("qwen-3.8-27b")).toBe(false);
  expect(duplicate.effortModels.has("gpt-oss-120b")).toBe(true);
});

it("does not promote free-only card limits into paid metadata", async () => {
  const candidate = await collect(({ catalog }) => {
    const card = catalog.documents.find(({ url }) => url.endsWith("/qwen-3.8-27b.md"));
    if (!card) throw Error("Missing card");
    card.body = card.body.replaceAll("for paid tiers and trial customers", "for Free Trial only");
  });
  expect(
    candidate.catalog.models.find(({ model_id }) => model_id === "qwen-3.8-27b")?.limits,
  ).toEqual({ context_tokens: 65536, max_output_tokens: 32768 });
});

it("does not select a paid limit from conflicting summaries", async () => {
  const candidate = await collect(({ catalog }) => {
    const card = catalog.documents.find(({ url }) => url.endsWith("/qwen-3.8-27b.md"));
    const summary = card?.body
      .split("\n")
      .find((line) => line.startsWith("Model ID: `qwen-3.8-27b`."));
    if (!card || !summary) throw Error("Missing owned limits");
    card.body += `\n${summary.replace("131,072", "262,144")}`;
  });
  expect(
    candidate.catalog.models.find(({ model_id }) => model_id === "qwen-3.8-27b")?.limits,
  ).toEqual({ context_tokens: 65536, max_output_tokens: 32768 });
});

it("does not use a parameter table moved to another schema property", async () => {
  const catalog = linkedBundleSchema.parse(
    JSON.parse(await fixture("inference-current-catalog.json")),
  );
  await currentReasoning(catalog);
  const doc = catalog.documents.find(({ url }) => url.endsWith("/chat-completions.md"));
  if (!doc) throw Error("Missing native request reference");
  doc.body = doc.body.replace("        reasoning_effort:", "        request_metadata:");
  const parsed = readCerebrasReferences({
    documents: catalog.documents,
    sourceRef: "cerebras-catalog",
  });
  expect([...parsed.chatModels]).toEqual([]);
  expect([...parsed.effortModels]).toEqual([]);
  expect(parsed.pricingInputs.some(({ key }) => key === "chat.input_tokens")).toBe(true);
});

it("uses a flattened card's exact price when the public model omits that quote", async () => {
  const completions = await fixture("completions-rendered.html");
  const candidate = await collect(({ catalog, inventory }) => {
    const row = inventory.data.find(({ id }) => id === "qwen-3.8-27b");
    const card = catalog.documents.find(({ url }) => url.endsWith("/qwen-3.8-27b.md"));
    if (!row || !card) throw new Error("Missing Qwen fixtures");
    row.pricing = { completion: "0.00000149" };
    card.body =
      "# Qwen 3.8 27B\n\nModel ID\n\n`qwen-3.8-27b`\n\n### Pricing\n\nper million tokens\n\nInput\n\n\\$0.99\n\nOutput\n\n\\$1.49";
    catalog.documents.push({
      url: "https://inference-docs.cerebras.ai/api-reference/completions",
      body: completions,
    });
  });
  const result = lookup(candidate)({ provider_id: "cerebras", model_id: "qwen-3.8-27b" });
  expect(result.status).toBe("matched");
  const input = result.candidates[0]?.offer.terms.find(
    (term) => term.kind === "rate" && term.meter.value === "input_text",
  );
  expect(input?.kind === "rate" ? input.variants[0]?.price.value : undefined).toEqual({
    numerator: "99",
    denominator: "100000000",
  });
  expect(
    candidate.catalog.models.find(({ model_id }) => model_id === "qwen-3.8-27b")?.api_endpoints,
  ).toEqual([{ name: "Completions", path: "v1/completions" }]);
});

it("matches current public API IDs and rates without a protocol or commercial selector", async () => {
  const candidate = await collect();
  const query = lookup(candidate);
  for (const [model_id, numerator, denominator] of [
    ["gpt-oss-120b", "7", "20000000"],
    ["qwen-3.8-27b", "99", "100000000"],
  ] as const) {
    const result = query({ provider_id: "cerebras", model_id });
    expect(result.status).toBe("matched");
    expect(result.missing_conditions).toEqual([]);
    expect(result.requires_offer_choice).toBe(false);
    expect(result.candidates).toHaveLength(1);
    expect(new Set(result.candidates[0]?.evidence.map(({ source_ref }) => source_ref))).toEqual(
      new Set(["cerebras-catalog", "cerebras-models"]),
    );
    expect(
      result.candidates.flatMap(({ offer }) =>
        offer.terms.flatMap((term) =>
          term.kind === "rate" && term.meter.value === "input_text"
            ? term.variants.map(({ price }) => price.value)
            : [],
        ),
      ),
    ).toEqual([{ numerator, denominator }]);
  }
  expect(
    candidate.inference?.mapping.rules.every(({ fixed_selectors }) => fixed_selectors.length === 0),
  ).toBe(true);
  for (const model_id of [
    "openai/gpt-oss-120b",
    "Qwen/Qwen3.8-27B",
    "us.gpt-oss-120b",
    "assigned-endpoint-id",
  ]) {
    expect(query({ provider_id: "cerebras", model_id }).reason).toBe("unreviewed_id");
  }
  expect(
    candidate.pricing.data.books
      .flatMap(({ offers }) => offers)
      .every(({ offer_key }) => offer_key === "payg"),
  ).toBe(true);
});

it("preserves public price associations without model cards, accounting documents or a catalog source", async () => {
  const candidate = await collect(({ catalog }) => {
    catalog.documents = [];
  });
  expect(lookup(candidate)({ provider_id: "cerebras", model_id: "gpt-oss-120b" }).status).toBe(
    "matched",
  );
  const publicOnly = await collect(undefined, undefined, true);
  const result = lookup(publicOnly)({ provider_id: "cerebras", model_id: "gpt-oss-120b" });
  expect(result.status).toBe("matched");
  expect(new Set(result.evidence.map(({ source_ref }) => source_ref))).toEqual(
    new Set(["cerebras-models"]),
  );
});

it("replaces both identity sources without reviving an ID from unindexed model-card prose", async () => {
  const previous = await collect();
  const next = await collect((input) => {
    input.catalog.index.body = input.catalog.index.body
      .split("\n")
      .filter((line) => !line.includes("`gpt-oss-120b`"))
      .join("\n");
    input.inventory.data = input.inventory.data.filter(({ id }) => id !== "gpt-oss-120b");
  }, previous);
  expect(lookup(next)({ provider_id: "cerebras", model_id: "gpt-oss-120b" }).reason).toBe(
    "unreviewed_id",
  );
  expect(lookup(next)({ provider_id: "cerebras", model_id: "qwen-3.8-27b" }).status).toBe(
    "matched",
  );
});

it("renders the direct ID and applicable rates without adding configuration controls", async () => {
  const candidate = await collect();
  const projected = await projectCatalogPair(candidate);
  const parse = (asset: (typeof projected.ui.manifest.assets)[number]) =>
    JSON.parse(gunzipSync(compressedAsset(projected.ui.pack, asset)).toString());
  const details = projected.ui.manifest.assets
    .filter(({ file_name }) => file_name.includes("/details/"))
    .flatMap((asset) =>
      websiteDetailChunkSchema.parse(parse(asset)).details.map(restoreWebsiteInferenceDetail),
    );
  const offers = projected.ui.manifest.assets
    .filter(({ file_name }) => file_name.includes("/offers/"))
    .flatMap((asset) => websiteOfferChunkSchema.parse(parse(asset)).offers);
  const detail = details.find(({ model_ref }) => model_ref === "cerebras/gpt-oss-120b");
  const price = detail?.inference_prices?.find(({ model_id }) => model_id === "gpt-oss-120b");
  if (!detail || !price) throw new Error("Missing website inference prices");
  expect(queryWebsiteInferencePrice(price, [], at).status).toBe("matched");
  const html = await renderComponent(InferencePrices, {
    modelRef: detail.model_ref,
    prices: detail.inference_prices,
    offers,
  });
  expect(html).toContain("gpt-oss-120b");
  expect(html).toContain("Applicable prices");
  expect(html).not.toContain("<select");
  expect(html).not.toContain("content_hash");
});
