import type {
  PriceApplicability,
  PriceDenomination,
  PriceDimension,
  Rational,
  UsageSignal,
} from "../catalog/pricing-schema.ts";
import type {
  CalculationBinding,
  CalculationBook,
  CalculationComponent,
  CalculationEnvelope,
  CalculationOffer,
  CalculationProvider,
  CalculationRate,
  CalculationRequest,
  CalculationTerm,
  Evidence,
  SelectionRequest,
} from "./schema.ts";
import type { Gap } from "./selection.ts";

export interface OfferEntry {
  providerId: string;
  bookRef: string;
  modelRefs: string[];
  offer: CalculationOffer;
}
export interface Charge {
  componentId: string;
  offerRef: string;
  termRef: string;
  rateTermRef: string;
  quantity: Rational;
  grossAmount: Rational;
  amount: Rational;
  denomination: PriceDenomination;
  evidence: Evidence[];
  allowances: string[];
}
export interface Subtotal {
  denomination: PriceDenomination;
  amount: Rational;
}
export interface CalculationResult {
  status: "calculated" | "estimated" | "partial" | "unknown";
  evaluatedAt: string;
  snapshot: CalculationEnvelope["snapshot"];
  freshness: CalculationProvider["snapshot"][];
  charges: Charge[];
  subtotals: Subtotal[];
  totals?: Subtotal[];
  assumptions: Array<{
    componentId: string;
    assumption: CalculationComponent["assumptions"][number];
  }>;
  unresolved: Gap[];
}
export interface Requirements {
  offerRef: string;
  states: CalculationOffer["states"];
  selectors: PriceDimension[];
  charges: Array<{
    termRef: string;
    kind: CalculationTerm["kind"];
    applicability: PriceApplicability;
    validity?: CalculationRate["validity"];
    binding?: CalculationBinding;
    targetRateRefs?: string[];
    alternatives: UsageSignal[][];
  }>;
  aggregationBoundaries: CalculationBinding["aggregation"][];
  relatedCharges: CalculationOffer["relations"];
  resourceEdges: CalculationBook["resource_edges"];
  gaps: Gap[];
}
export interface Calculator {
  listOffers(input?: { modelRef?: string; providerId?: string }): OfferEntry[];
  requirements(input: SelectionRequest): Requirements;
  calculate(this: void, input: CalculationRequest): CalculationResult;
}
