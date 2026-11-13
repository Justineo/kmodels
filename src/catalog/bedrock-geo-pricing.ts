import { load } from "cheerio";
import { z } from "zod";
import { markdownProse } from "./markdown.ts";

export const bedrockMeteredRatesUrl =
  "https://b0.p.awsstatic.com/pricing/2.0/meteredUnitMaps/bedrock/USD/current/bedrock.json";
export const bedrockFoundationMeteredRatesUrl =
  "https://b0.p.awsstatic.com/pricing/2.0/meteredUnitMaps/bedrockfoundationmodels/USD/current/bedrockfoundationmodels.json";
const pricingPageUrl = "https://aws.amazon.com/bedrock/pricing/";
export const bedrockCrossRegionPricingUrl =
  "https://docs.aws.amazon.com/bedrock/latest/userguide/cross-region-inference.md";

/** The current comparison explicitly distinguishes Standard geographic pricing from Global. */
export function bedrockStandardGeoPricing(documents: readonly { url: string; body: string }[]) {
  const guides = documents.filter((d) => d.url === bedrockCrossRegionPricingUrl);
  if (guides.length !== 1 || !guides[0]) return false;
  const body = markdownProse(guides[0].body)
    .split("\n")
    .filter((line) => !/^\s*>/.test(line))
    .join("\n");
  return (
    (body.match(/^\| Cost \|/gm)?.length ?? 0) === 1 &&
    body.includes(
      "| Feature | Geographic Cross-Region Inference | Global Cross-Region Inference | Recommendation |",
    ) &&
    body.includes("| Cost | Standard pricing | Approximately 10% savings |") &&
    body.includes(
      "The price is calculated based on the Region from which you call an inference profile.",
    )
  );
}

/** Discover only the owned Anthropic table's bounded AWS unit-map paths. */
export function bedrockFoundationMapUrls(body: string): string[] {
  const $ = load(body);
  const paths = new Set<string>();
  for (const block of $("h2#Anthropic")
    .closest("li[role='tabpanel']")
    .find("[data-pricing-markup]")) {
    const markup = $(block).attr("data-pricing-markup") ?? "";
    if (!markup.includes("Geo and In-region Cross-region Inference")) continue;
    for (const token of markup.matchAll(/\{priceOf!bedrockfoundationmodels\/([A-Za-z0-9_-]+)!/g)) {
      const path = token[1];
      if (path && path !== "bedrockfoundationmodels" && path.length <= 160)
        paths.add(
          `https://b0.p.awsstatic.com/pricing/2.0/meteredUnitMaps/bedrockfoundationmodels/USD/current/${path}.json`,
        );
    }
  }
  if (paths.size > 8) throw new Error("Too many Anthropic geographic unit maps");
  return [...paths].sort();
}
const heading = "Geo Cross-region inference and in-region";
const tiers = new Map([
  ["Standard Tier", "standard"],
  ["Priority Tier", "priority"],
  ["Flex Tier", "flex"],
]);
const mapSchema = z.object({ regions: z.record(z.string(), z.record(z.string(), z.unknown())) });
const rateSchema = z.object({
  rateCode: z.string().min(1),
  price: z.string().regex(/^\d+(?:\.\d+)?$/),
  RegionlessRateCode: z.string(),
});

export interface BedrockGeoPrice {
  labels: string[];
  meter: string;
  tier: string;
  price: string;
  unit: string;
  ttl?: number;
  speed?: string;
  locator: string;
}

/** Only the owned on-demand table can extend an exact SKU to geographic routing. */
export function bedrockAnthropicGeoPricing(documents: readonly { url: string; body: string }[]) {
  const rates = new Map<string, BedrockGeoPrice>();
  const pages = documents.filter(({ url }) => url === pricingPageUrl);
  const maps = documents.filter(({ url }) => url === bedrockFoundationMeteredRatesUrl);
  if (pages.length === 0 || maps.length === 0) return rates;
  const page = pages.length === 1 ? pages[0] : undefined;
  const map = maps.length === 1 ? maps[0] : undefined;
  if (!page || !map) throw new Error("Duplicate Anthropic geographic pricing evidence");
  const { regions } = mapSchema.parse(JSON.parse(map.body));
  const mapsByPath = new Map([["bedrockfoundationmodels", regions]]);
  for (const url of bedrockFoundationMapUrls(page.body)) {
    const matches = documents.filter((d) => d.url === url);
    if (matches.length > 1) throw new Error("Duplicate Anthropic unit map");
    const document = matches[0];
    if (!document) continue;
    const path = url
      .split("/")
      .at(-1)
      ?.replace(/\.json$/, "");
    if (path) mapsByPath.set(path, mapSchema.parse(JSON.parse(document.body)).regions);
  }
  const $ = load(page.body);
  const panel = $("h2#Anthropic").closest("li[role='tabpanel']");
  if (panel.length !== 1) throw new Error("Missing owned Anthropic pricing panel");
  let tables = 0;
  const columns = new Map<string, { meter: string; ttl?: number }>([
    ["Price per 1M input tokens", { meter: "input_text" }],
    ["Price per 1M output tokens", { meter: "output_text" }],
    ["Price per 1M input tokens (5m cache write)", { meter: "cache_write_text", ttl: 300 }],
    ["Price per 1M input tokens (1h cache write)", { meter: "cache_write_text", ttl: 3600 }],
    ["Price per 1M input tokens (cache read)", { meter: "cache_read_text" }],
  ]);
  for (const block of panel.find("[data-pricing-markup]")) {
    const table = load($(block).attr("data-pricing-markup") ?? "");
    if (table("h2").text().trim() !== "Geo and In-region Cross-region Inference") continue;
    const headers = table("thead th")
      .map((_, cell) => table(cell).text().trim())
      .get();
    if (headers[0] !== "Anthropic models" || !headers.some((header) => columns.has(header)))
      continue;
    tables++;
    for (const row of table("tbody tr")) {
      const cells = table(row)
        .children("td")
        .map((_, cell) => table(cell).text().trim())
        .get();
      // These suffixes qualify access/context, not the exact model identity. Native SKU
      // context parsing still owns the price band; this join never supplies a bound.
      const label = cells[0]?.replace(/\*\*$/, "").replace(/ - Long Context$/, "");
      if (!label) continue;
      for (const [index, header] of headers.entries()) {
        const column = columns.get(header);
        const reference = cells[index]?.match(
          /^\{priceOf!bedrockfoundationmodels\/([A-Za-z0-9_-]+)!([A-Za-z0-9_-]+)(?:!opt)?\}$/,
        );
        const token = reference?.[2];
        const tokenRegions = mapsByPath.get(reference?.[1] ?? "");
        if (!column || !token || !tokenRegions) continue;
        for (const prices of Object.values(tokenRegions)) {
          const rate = rateSchema.safeParse(prices[token]);
          if (!rate.success || rate.data.RegionlessRateCode !== token) continue;
          const key = rate.data.rateCode;
          const fact: BedrockGeoPrice = {
            labels: [label],
            ...column,
            tier: "standard",
            price: rate.data.price,
            unit: "1M tokens",
            locator: `${pricingPageUrl}#Anthropic | Geo and In-region Cross-region Inference`,
          };
          const previous = rates.get(key);
          if (previous) {
            if (
              JSON.stringify({ ...previous, labels: [] }) !==
              JSON.stringify({ ...fact, labels: [] })
            )
              throw new Error("Conflicting Anthropic geographic price cells");
            fact.labels = [...new Set([...previous.labels, label])];
          }
          rates.set(key, fact);
        }
      }
    }
  }
  if (tables !== 1 || rates.size === 0)
    throw new Error("Anthropic geographic prices did not resolve from one on-demand table");
  return rates;
}

/** The visible page owns the route scope. Its price tokens resolve to exact native rate codes. */
export function bedrockNovaGeoPricing(documents: readonly { url: string; body: string }[]) {
  const rates = new Map<string, BedrockGeoPrice>();
  const pages = documents.filter(({ url }) => url === pricingPageUrl);
  const maps = documents.filter(({ url }) => url === bedrockMeteredRatesUrl);
  if (pages.length === 0 || maps.length === 0) return rates;
  const page = pages.length === 1 ? pages[0] : undefined;
  const map = maps.length === 1 ? maps[0] : undefined;
  if (page === undefined || map === undefined) throw new Error("Duplicate Nova pricing evidence");
  const { regions } = mapSchema.parse(JSON.parse(map.body));
  const $ = load(page.body);
  const section = $("h4").filter((_, node) => $(node).text().trim() === heading);
  if (
    section.length !== 1 ||
    section.prevAll("h2").first().text().trim() !== "Amazon Nova" ||
    section.prevAll("h3").first().text().trim() !== "Pricing for Understanding Models"
  )
    throw new Error("Missing owned Nova geographic pricing section");
  for (const block of section.nextUntil("h2,h3,h4").filter("[data-pricing-markup]")) {
    const table = load($(block).attr("data-pricing-markup") ?? "");
    const tier = tiers.get(table("h3").first().text().trim());
    if (tier === undefined) continue;
    const rows = table("table")
      .filter((_, node) => {
        const headers = table(node)
          .find("th")
          .map((_, cell) => table(cell).text().trim())
          .get();
        return (
          headers.join("|") ===
          "Amazon Nova models|Price per 1M input tokens|Price per 1M output tokens"
        );
      })
      .find("tbody tr");
    for (const row of rows) {
      const [label, input, output] = table(row)
        .children("td")
        .map((_, cell) => table(cell).text().trim())
        .get();
      if (!label) continue;
      for (const [meter, cell] of [
        ["input_text", input],
        ["output_text", output],
      ] as const) {
        const token = cell?.match(
          /^\{priceOf!bedrock\/bedrock!([A-Za-z0-9_-]+)!\*!1000(?:!opt)?\}$/,
        )?.[1];
        if (token === undefined) continue;
        for (const prices of Object.values(regions)) {
          const rate = rateSchema.safeParse(prices[token]);
          if (!rate.success || rate.data.RegionlessRateCode !== token) continue;
          const key = rate.data.rateCode;
          const fact: BedrockGeoPrice = {
            labels: [label.replace(/ \(w\/ latency optimized inference\)$/, "")],
            meter,
            tier,
            price: rate.data.price,
            unit: "1K tokens",
            ...(label.endsWith(" (w/ latency optimized inference)") ? { speed: "optimized" } : {}),
            locator: `${pricingPageUrl}#Geo_Cross-region_inference_and_in-region`,
          };
          const previous = rates.get(key);
          if (previous !== undefined && JSON.stringify(previous) !== JSON.stringify(fact))
            throw new Error("Conflicting Nova geographic price cells");
          rates.set(key, fact);
        }
      }
    }
  }
  if (rates.size === 0) throw new Error("Nova geographic prices did not resolve to rate codes");
  return rates;
}
