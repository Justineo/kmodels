import type { ProviderAtomRegistryEntry, UnitExpression, UsageSignal } from "./pricing-schema.ts";

export const openAiTokenUnit: UnitExpression = {
  factors: [{ unit: { namespace: "kmodels", value: "token" }, power: 1 }],
};

const textQuantities = new Map([
  [
    "input_text",
    { key: "uncached_input_text_tokens", definition: "Billable uncached text-input tokens" },
  ],
  [
    "cache_read_text",
    { key: "cached_input_text_tokens", definition: "Billable cached text-input tokens" },
  ],
  [
    "cache_write_text",
    { key: "cache_write_text_tokens", definition: "Billable text-input cache-write tokens" },
  ],
  ["output_text", { key: "output_text_tokens", definition: "Billable text-output tokens" }],
]);

// A native Text modality row establishes a text-only charge, independently of peer quotes.
export function openAiTextQuantity(meter: string):
  | {
      signal: UsageSignal;
      atom: Extract<ProviderAtomRegistryEntry, { kind: "usage_signal" }>;
    }
  | undefined {
  const quantity = textQuantities.get(meter);
  if (quantity === undefined) return;
  const { key, definition } = quantity;
  return {
    signal: { namespace: "provider", provider_id: "openai", value: key },
    atom: {
      kind: "usage_signal",
      key,
      definition,
      unit: openAiTokenUnit,
      resolution_phase: "outcome",
    },
  };
}
