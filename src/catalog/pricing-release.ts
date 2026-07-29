import { z } from "zod";
import type { AcceptedPairSafetyFinding } from "./pricing-pair-transition.ts";
import type { ProviderPricingTransition } from "./pricing-transition.ts";

const providerId = z.string().min(1);
const absenceTransitionSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("fresh_empty"), provider_id: providerId }),
  z.strictObject({ kind: z.literal("remove_provider"), provider_id: providerId }),
  z.strictObject({ kind: z.literal("withdraw_pricing"), provider_id: providerId }),
]);
const safetyFindingSchema = z.strictObject({
  provider_id: providerId,
  accepted_pair_id: z.string().regex(/^[0-9a-f]{64}$/),
  affects: z.enum(["core", "pricing", "both"]),
  replacement_core_cleared: z.literal(true).optional(),
  replacement_pricing_cleared: z.literal(true).optional(),
});
const pricingReleaseInputSchema = z.strictObject({
  transitions: z.array(absenceTransitionSchema).default([]),
  safety_findings: z.array(safetyFindingSchema).default([]),
});

export interface PricingReleaseInput {
  transitions: ProviderPricingTransition[];
  safety_findings: AcceptedPairSafetyFinding[];
}

export function parsePricingReleaseInput(value: unknown): PricingReleaseInput {
  const parsed = pricingReleaseInputSchema.parse(value);
  return {
    transitions: parsed.transitions,
    safety_findings: parsed.safety_findings.map(
      ({
        replacement_core_cleared,
        replacement_pricing_cleared,
        ...finding
      }): AcceptedPairSafetyFinding => ({
        ...finding,
        ...(replacement_core_cleared === true ? { replacement_core_cleared: true } : {}),
        ...(replacement_pricing_cleared === true ? { replacement_pricing_cleared: true } : {}),
      }),
    ),
  };
}
