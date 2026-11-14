import { z } from "zod";
import { load } from "cheerio";

const decimal = z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/);
export const vercelPageSearchPriceSchema = z.strictObject({
  model_id: z.string().min(1),
  provider: z.string().min(1),
  posts_per_thousand: decimal.optional(),
  profiles_per_thousand: decimal.optional(),
});
export type VercelPageSearchPrice = z.infer<typeof vercelPageSearchPriceSchema>;

export interface VercelPageSearchPrices {
  prices: VercelPageSearchPrice[];
  /** The canonical page published its own readable backing-model payload. */
  modelObserved: boolean;
}

/** The model-detail payload owns displayed amounts; the pricing component owns their unit. */
export function vercelPageSearchPrices(body: string): VercelPageSearchPrices {
  const $ = load(body);
  const canonical = $('link[rel="canonical"]').attr("href");
  const slug = canonical?.match(/^https:\/\/vercel\.com\/ai-gateway\/models\/([a-z0-9._-]+)$/)?.[1];
  if (slug === undefined) return { prices: [], modelObserved: false };
  const detail = z.tuple([
    z.literal("$"),
    z.string(),
    z.null(),
    z
      .object({
        backingModels: z.array(
          z
            .object({
              chef: z.string().min(1),
              primaryModel: z.literal(slug),
              provider: z.string().min(1),
              // A model that cannot use X search publishes no amounts here, and an unreadable
              // amount is not a claim. Only exact decimals establish a page price.
              xSearchPostCost: z.unknown().optional(),
              xSearchUserCost: z.unknown().optional(),
            })
            .strip(),
        ),
      })
      .strip(),
  ]);
  const prices: VercelPageSearchPrice[] = [];
  let modelObserved = false;
  for (const element of $("script").toArray()) {
    const payload = $(element)
      .text()
      .match(/^self\.__next_f\.push\((\[1,"(?:[^"\\]|\\.)*"\])\)$/)?.[1];
    if (payload === undefined) continue;
    try {
      const chunk = z.tuple([z.literal(1), z.string()]).parse(JSON.parse(payload))[1];
      for (const line of chunk.split("\n")) {
        if (!/^[a-f0-9]+:\[/.test(line) || !line.includes('"backingModels"')) continue;
        const parsed = detail.safeParse(JSON.parse(line.slice(line.indexOf(":") + 1)));
        if (!parsed.success) continue;
        for (const model of parsed.data[3].backingModels) {
          modelObserved = true;
          const posts = decimal.safeParse(model.xSearchPostCost);
          const profiles = decimal.safeParse(model.xSearchUserCost);
          if (!posts.success && !profiles.success) continue;
          prices.push({
            model_id: `${model.chef}/${model.primaryModel}`,
            provider: model.provider,
            ...(posts.success ? { posts_per_thousand: posts.data } : {}),
            ...(profiles.success ? { profiles_per_thousand: profiles.data } : {}),
          });
        }
      }
    } catch {
      // Unreadable optional Flight data cannot establish a commercial claim.
    }
  }
  return { prices, modelObserved };
}

export const vercelPricingContractsSchema = z.strictObject({
  x_search_units: z.literal("fetched_posts_and_profiles").optional(),
  token_peak_basis: z.literal("listed_off_peak_with_multiplier").optional(),
});
export type VercelPricingContracts = z.infer<typeof vercelPricingContractsSchema>;

/** Read the provider-owned pricing component's labels and billing explanation, never execute it. */
export function vercelPricingContracts(body: string): VercelPricingContracts {
  const contracts: VercelPricingContracts = {};
  for (const renderer of body.matchAll(
    /function\s+\w+\(\{webSearchCallCost:[^}]+xSearchPostCost:(\w+),xSearchUserCost:(\w+),[^}]+\}\)\{([\s\S]{0,6500}?)(?=function\s+\w+\(|e\.s\()/g,
  )) {
    const post = renderer[1],
      profile = renderer[2],
      section = renderer[3];
    if (
      section !== undefined &&
      post !== undefined &&
      profile !== undefined &&
      section.includes(`{label:"X posts fetched",cost:${post},unit:"posts"}`) &&
      section.includes(`{label:"X profiles fetched",cost:${profile},unit:"profiles"}`) &&
      section.includes('"/K",') &&
      /(\w+)\.unit\?` \$\{\1\.unit\}`/.test(section)
    )
      contracts.x_search_units = "fetched_posts_and_profiles";
  }
  for (const renderer of body.matchAll(
    /function\((\w+)\)\{let\{windows:(\w+),multiplier:(\w+),holidayCalendar:(\w+)\}=\1,([\s\S]{0,3000}?)Listed prices are the off-peak rate\.`\}/g,
  )) {
    const multiplier = renderer[3];
    if (
      multiplier !== undefined &&
      renderer[0].includes(`Math.round(100*${multiplier})/100`) &&
      /return`Token prices are \$\{\w+\} during \$\{\w+\} UTC/.test(renderer[0]) &&
      body.includes("Off-peak on ") &&
      body.includes("official make-up workdays are peak.")
    )
      contracts.token_peak_basis = "listed_off_peak_with_multiplier";
  }
  return contracts;
}
