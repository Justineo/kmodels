import { z } from "zod";
import { catalogRepairModel } from "./openai.ts";

const tokens = z.int().nonnegative().max(2_147_483_647);
const completedResponse = z.object({
  id: z.string().min(1).max(256).optional(),
  model: z.string(),
  service_tier: z.literal("default").nullish(),
  status: z.literal("completed").optional(),
  usage: z.object({
    input_tokens: tokens,
    output_tokens: tokens,
    total_tokens: tokens.optional(),
    input_tokens_details: z
      .object({
        cached_tokens: tokens.optional(),
        cache_write_tokens: tokens.optional(),
        cache_write_tokens_details: z
          .object({
            ttl_30m_tokens: tokens,
            ttl_12h_tokens: tokens,
          })
          .nullish(),
      })
      .nullish(),
  }),
});

// Standard GPT-6.2 Sol text rates in nano-USD per token. Select the context band
// on the entire input before subtracting any cache reads or writes.
const short = { input: 2000, read: 100, write30m: 2500, write12h: 5000, output: 10000 };
const long = { input: 4000, read: 200, write30m: 5000, write12h: 10000, output: 15000 };
const line = (tokens: number, rate: number) => ({
  tokens,
  nanousd_per_token: rate,
  cost_nanousd: tokens * rate,
});

export function streamSettlement(text: string) {
  const events = text
    .split(/\r?\n/)
    .filter((row) => row.startsWith("data: ") && row !== "data: [DONE]")
    .map((row): unknown => JSON.parse(row.slice(6)));
  const completions = events.filter(
    (event) => z.object({ type: z.literal("response.completed") }).safeParse(event).success,
  );
  if (completions.length !== 1)
    throw new Error("Missing unique completed Codex usage; reservation retained");
  const { response } = z.object({ response: completedResponse }).parse(completions[0]);
  if (
    response.model !== catalogRepairModel &&
    !(
      response.model.startsWith(catalogRepairModel + "-") &&
      /^-\d{4}-\d{2}-\d{2}$/.test(response.model.slice(catalogRepairModel.length))
    )
  )
    throw new Error("Unexpected Codex response model; reservation retained");
  const { usage } = response;
  const details = usage.input_tokens_details;
  const split = details?.cache_write_tokens_details;
  const splitTotal = split ? split.ttl_30m_tokens + split.ttl_12h_tokens : undefined;
  const written = details?.cache_write_tokens ?? splitTotal;
  const read = details?.cached_tokens;
  const remainder = usage.input_tokens - (read ?? 0) - (written ?? 0);
  if (
    remainder < 0 ||
    (splitTotal !== undefined && splitTotal !== written) ||
    (usage.total_tokens !== undefined &&
      usage.total_tokens !== usage.input_tokens + usage.output_tokens)
  )
    throw new Error("Inconsistent Codex usage; reservation retained");

  const longContext = usage.input_tokens > 272_000;
  const rates = longContext ? long : short;
  const classified = read !== undefined && written !== undefined;
  const charges = {
    ordinary_input: line(classified ? remainder : 0, rates.input),
    cache_read: line(read ?? 0, rates.read),
    cache_write_30m: line(split?.ttl_30m_tokens ?? 0, rates.write30m),
    cache_write_12h: line(split?.ttl_12h_tokens ?? 0, rates.write12h),
    cache_write_unknown_ttl: line(split ? 0 : (written ?? 0), rates.write12h),
    unclassified_input: line(
      classified ? 0 : remainder,
      written === undefined ? rates.write12h : rates.input,
    ),
    output: line(usage.output_tokens, rates.output),
  };
  return {
    ...(response.id === undefined ? {} : { response_id: response.id }),
    model: response.model,
    context_band: longContext ? "long" : "short",
    usage,
    charges,
    charged_microusd: Math.ceil(
      Object.values(charges).reduce((sum, item) => sum + item.cost_nanousd, 0) / 1000,
    ),
  };
}
