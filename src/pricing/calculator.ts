import { z } from "zod";
import { ExactIntegerLimitError } from "../catalog/pricing-rational.ts";
import type { CalculationRequest, SelectionRequest } from "./schema.ts";
import type { Calculator, CalculationResult, OfferEntry } from "./types.ts";
import { PricingError } from "./errors.ts";
import { evaluateRequest } from "./evaluation.ts";
import { parseRequest } from "./request.ts";
import { discoverRequirements } from "./requirements.ts";
import { createPricingSnapshot, type PricingSnapshot } from "./snapshot.ts";

const offerFilterSchema = z.strictObject({
  modelRef: z.string().min(1).optional(),
  providerId: z.string().min(1).optional(),
});
type OfferFilter = z.infer<typeof offerFilterSchema>;

export function createCalculator(priceData: unknown): Calculator {
  const snapshot = createPricingSnapshot(priceData);
  return Object.freeze({
    listOffers(input: OfferFilter = {}): OfferEntry[] {
      return guarded(() => listMatchingOffers(snapshot, parseRequest(offerFilterSchema, input)));
    },
    requirements(input: SelectionRequest) {
      return guarded(() => discoverRequirements(snapshot, input));
    },
    calculate(input: CalculationRequest): CalculationResult {
      return guarded(() => evaluateRequest(snapshot, input));
    },
  });
}

function guarded<T>(action: () => T): T {
  try {
    return action();
  } catch (error) {
    if (error instanceof PricingError) throw error;
    if (error instanceof ExactIntegerLimitError)
      throw new PricingError("ARITHMETIC_LIMIT", error.message);
    throw error;
  }
}

function listMatchingOffers(snapshot: PricingSnapshot, filter: OfferFilter): OfferEntry[] {
  const matches: OfferEntry[] = [];
  for (const { provider, book, offer } of snapshot.offers.values()) {
    if (filter.providerId !== undefined && provider.snapshot.provider_id !== filter.providerId)
      continue;
    const modelRefs = offer.model_refs ?? book.scope.model_refs;
    if (filter.modelRef !== undefined && !modelRefs.includes(filter.modelRef)) continue;
    matches.push({ providerId: provider.snapshot.provider_id, bookRef: book.id, modelRefs, offer });
  }
  return structuredClone(matches);
}
