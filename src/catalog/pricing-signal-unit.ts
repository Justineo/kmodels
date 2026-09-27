import type { UsageSignal, UnitExpression } from "./pricing-schema.ts";

export function standardUsageSignalUnit(
  signal: Extract<UsageSignal, { namespace: "kmodels" }>,
): UnitExpression {
  const singleUnit = (
    value: Extract<UnitExpression["factors"][number]["unit"], { namespace: "kmodels" }>["value"],
  ): UnitExpression => ({
    factors: [{ unit: { namespace: "kmodels", value }, power: 1 }],
  });
  switch (signal.value) {
    case "input_tokens":
    case "uncached_input_tokens":
    case "cached_input_tokens":
    case "cache_write_tokens":
    case "output_tokens":
    case "reasoning_output_tokens":
      return singleUnit("token");
    case "input_characters":
      return singleUnit("character");
    case "processed_pages":
      return singleUnit("page");
    case "processed_images":
      return singleUnit("image");
    case "processed_audio_seconds":
      return singleUnit("second");
    case "accepted_requests":
      return singleUnit("request");
    case "completed_result_items":
    case "generated_items":
      return singleUnit("item");
    case "successful_web_searches":
      return singleUnit("event");
    case "generated_images":
      return singleUnit("image");
    case "generated_seconds":
    case "active_seconds":
      return singleUnit("second");
    case "stored_byte_seconds":
      return {
        factors: [
          { unit: { namespace: "kmodels", value: "byte" }, power: 1 },
          { unit: { namespace: "kmodels", value: "second" }, power: 1 },
        ],
      };
    case "transferred_bytes":
      return singleUnit("byte");
  }
}
