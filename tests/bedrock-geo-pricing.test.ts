import { readFile } from "node:fs/promises";
import { expect, it } from "vite-plus/test";
import { z } from "zod";
import { parseSource } from "../src/catalog/adapters.ts";
import { manifests } from "../src/catalog/manifests.ts";
import {
  bedrockAnthropicGeoPricing,
  bedrockFoundationMeteredRatesUrl,
  bedrockFoundationMapUrls,
} from "../src/catalog/bedrock-geo-pricing.ts";

const bundleSchema = z.object({
  index: z.object({ url: z.string(), body: z.string() }),
  documents: z.array(z.object({ url: z.string(), body: z.string() })),
});
const fixture = bundleSchema.parse(
  JSON.parse(
    await readFile(
      new URL("./fixtures/bedrock/anthropic-geo-pricing.json", import.meta.url),
      "utf8",
    ),
  ),
);
const manifest = manifests.find((m) => m.provider.id === "amazon-bedrock");
const source = manifest?.sources.find((s) => s.id === "bedrock-models");
function parse(bundle: z.infer<typeof bundleSchema>, modelId = "anthropic.claude-sonnet-5-5") {
  if (!source || !manifest) throw new Error("Missing Bedrock source");
  const parsed = parseSource({
    provider: { ...manifest.provider, source_ids: [source.id] },
    source,
    body: JSON.stringify(bundle),
    observedAt: "2026-11-13T00:00:00Z",
  });
  const model = parsed.models.find((m) => m.model_id === modelId);
  if (!model) throw new Error("Missing Sonnet fixture");
  return model;
}

it("resolves a page-owned custom unit map without confusing it with the default map", () => {
  const bundle = structuredClone(fixture);
  const page = bundle.documents.find((d) => d.url === "https://aws.amazon.com/bedrock/pricing/");
  const map = bundle.documents.find((d) => d.url === bedrockFoundationMeteredRatesUrl);
  if (!page || !map) throw new Error("Missing pricing fixture");
  page.body = page.body.replaceAll(
    "priceOf!bedrockfoundationmodels/bedrockfoundationmodels!",
    "priceOf!bedrockfoundationmodels/reviewed-map!",
  );
  const url = bedrockFoundationMeteredRatesUrl.replace(
    "/bedrockfoundationmodels.json",
    "/reviewed-map.json",
  );
  expect(bedrockFoundationMapUrls(page.body)).toEqual([url]);
  expect(parse(bundle).price_facts.some((f) => f.conditions.inference_geo === "au")).toBe(false);
  bundle.documents.push({ url, body: map.body });
  expect(parse(bundle).price_facts.some((f) => f.conditions.inference_geo === "au")).toBe(true);
});

it.each(["writer.palmyra-x5-v1:0", "meta.llama4-scout-17b-instruct-v1:0"])(
  "uses the documented Standard geographic policy for %s without inferring other routes",
  async (modelId) => {
    const bundle = bundleSchema.parse(
      JSON.parse(
        await readFile(
          new URL("./fixtures/bedrock/standard-geo-pricing.json", import.meta.url),
          "utf8",
        ),
      ),
    );
    const guide = bundle.documents.find((d) => d.url.endsWith("/cross-region-inference.md"));
    if (!guide) throw new Error("Missing cross-region policy");
    const model = parse(bundle, modelId);
    expect(
      model.price_facts.filter(
        (f) =>
          f.conditions.deployment_scope === "geo_cross_region" &&
          f.conditions.region === "us-east-1",
      ),
    ).toHaveLength(2);
    expect(
      model.price_facts.some((f) => f.conditions.deployment_scope === "global_cross_region"),
    ).toBe(false);
    guide.body = guide.body.replace("| Cost | Standard pricing |", "| Cost | Contact sales | ");
    expect(
      parse(bundle, modelId).price_facts.some(
        (f) => f.conditions.deployment_scope === "geo_cross_region",
      ),
    ).toBe(false);
  },
);

it.each(["amount", "unit", "rate code", "meter", "TTL", "model", "missing map"])(
  "does not extend native rates through a mismatched %s",
  (failure) => {
    const bundle = structuredClone(fixture);
    const page = bundle.documents.find((d) => d.url === "https://aws.amazon.com/bedrock/pricing/");
    const map = bundle.documents.find((d) => d.url === bedrockFoundationMeteredRatesUrl);
    if (!page || !map) throw new Error("Missing pricing evidence");
    if (failure === "amount") map.body = map.body.replaceAll('"2.2000000000"', '"2.3000000000"');
    if (failure === "unit") {
      const list = bundle.documents.find((d) =>
        d.url.includes("/AmazonBedrockFoundationModels/current/"),
      );
      if (!list) throw new Error("Missing native price list");
      list.body = list.body.replaceAll('"unit":"1M tokens"', '"unit":"1K tokens"');
    }
    if (failure === "rate code") map.body = map.body.replaceAll("GMQB95G44FZFDK33.", "UNREVIEWED.");
    if (failure === "meter")
      page.body = page.body.replaceAll(
        "Price per 1M input tokens</strong>",
        "Price per 1M output tokens</strong>",
      );
    if (failure === "TTL") page.body = page.body.replaceAll("(5m cache write)", "(1h cache write)");
    if (failure === "model")
      page.body = page.body.replaceAll("Claude Sonnet 5.5", "Claude Sonnet Unreviewed");
    if (failure === "missing map") bundle.documents = bundle.documents.filter((d) => d !== map);
    const model = parse(bundle);
    const meter = failure === "TTL" ? "cache_write_text" : "input_text";
    expect(
      model.price_facts.filter(
        (f) =>
          f.meter === meter &&
          f.conditions.region === "ap-southeast-2" &&
          f.conditions.deployment_scope === "geo_cross_region" &&
          (failure !== "TTL" || f.conditions.cache_ttl_seconds === 300),
      ),
    ).toHaveLength(0);
    expect(
      model.price_facts.some((f) => f.conditions.deployment_scope === "global_cross_region"),
    ).toBe(true);
  },
);

it("requires the profile's source region, preserves unresolved quotes, and never uses destination regions", () => {
  const bundle = structuredClone(fixture);
  const card = bundle.documents.find((d) =>
    d.url.endsWith("model-card-anthropic-claude-sonnet-5-5.md"),
  );
  if (!card) throw new Error("Missing card");
  // Remove AU source rows only: Sydney still appears as a destination and in availability.
  card.body = card.body.replace(/(\*\*Geo: AU\*\*[\s\S]*?)(?=\*\*Geo:|$)/, (section) =>
    section.replace(/^\| ap-southeast-[24] .*\n/gm, ""),
  );
  // No Mantle in-region fallback for these otherwise valid quotes.
  card.body = card.body.replace(
    /(Availability using the `bedrock-mantle` endpoint[\s\S]*?)(?=###|$)/,
    (section) => section.replace(/^\| ap-southeast-[24] .*\n/gm, ""),
  );
  const model = parse(bundle);
  expect(model.price_facts.filter((f) => f.conditions.inference_geo === "au")).toHaveLength(0);
  expect(model.price_facts.some((f) => f.conditions.inference_geo === "us")).toBe(true);
  expect(
    model.raw_price_facts.some(
      (f) => f.reason === "unknown_applicability" && f.conditions.region === "ap-southeast-2",
    ),
  ).toBe(true);
});

it("rejects an unowned or duplicated geographic pricing panel", () => {
  const bundle = structuredClone(fixture);
  const page = bundle.documents.find((d) => d.url === "https://aws.amazon.com/bedrock/pricing/");
  if (!page) throw new Error("Missing pricing page");
  const body = page.body;
  page.body = body.replace('id="Anthropic"', 'id="Unrelated"');
  expect(() => bedrockAnthropicGeoPricing(bundle.documents)).toThrow("owned Anthropic");
  page.body = body + body;
  expect(() => bedrockAnthropicGeoPricing(bundle.documents)).toThrow("owned Anthropic");
});
