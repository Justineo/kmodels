import { load } from "cheerio";
import { z } from "zod";

export const bedrockMeteredRatesUrl =
  "https://b0.p.awsstatic.com/pricing/2.0/meteredUnitMaps/bedrock/USD/current/bedrock.json";
const pricingPageUrl = "https://aws.amazon.com/bedrock/pricing/";
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

/** The visible page owns the route scope. Its price tokens resolve to exact native rate codes. */
export function bedrockNovaGeoPricing(documents: readonly { url: string; body: string }[]) {
  const rates = new Map<string, { label: string; meter: string; tier: string; price: string }>();
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
        for (const [location, prices] of Object.entries(regions)) {
          const rate = rateSchema.safeParse(prices[token]);
          if (!rate.success || rate.data.RegionlessRateCode !== token) continue;
          const key = `${location}\0${rate.data.rateCode}`;
          const fact = { label, meter, tier, price: rate.data.price };
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
