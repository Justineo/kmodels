import type { PriceDimension, PriceCondition } from "./pricing-schema.ts";

export function standardDimensionKind(
  dimension: Extract<PriceDimension, { namespace: "kmodels" }>["value"],
): PriceCondition["kind"] {
  if (["request_audio", "voice_control", "video_input", "promotion"].includes(dimension))
    return "boolean";
  if (
    [
      "cache_ttl_seconds",
      "duration_seconds",
      "context_tokens",
      "input_tokens",
      "output_tokens",
    ].includes(dimension)
  )
    return "decimal_range";
  return "categorical";
}
