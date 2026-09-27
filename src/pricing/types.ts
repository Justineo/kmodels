import type {
  PriceApplicability,
  PriceDenomination,
  PriceDimension,
  Rational,
  UsageSignal,
} from "../catalog/pricing-schema.ts";
import type {
  CalculationBinding,
  CalculationAllowance,
  CalculationBook,
  ParsedCalculationComponent,
  CalculationEnvelope,
  CalculationOffer,
  CalculationProvider,
  CalculationRate,
  CalculationRequest,
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
  unitPrice: CalculationRate["price"];
  binding: CalculationBinding;
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
interface CalculationResultDetails {
  evaluatedAt: string;
  snapshot: CalculationEnvelope["snapshot"];
  freshness: CalculationProvider["snapshot"][];
  charges: Charge[];
  subtotals: Subtotal[];
  assumptions: Array<{
    componentId: string;
    assumption: ParsedCalculationComponent["assumptions"][number];
  }>;
  unresolved: Gap[];
}
export type CalculationResult = CalculationResultDetails &
  (
    | { status: "calculated"; totals: Subtotal[] }
    | { status: "estimated"; totals: Subtotal[] }
    | { status: "partial"; totals?: never }
    | { status: "unknown"; totals?: never }
  );

interface ChargeRequirementBase {
  termRef: string;
  applicability: PriceApplicability;
  validity?: CalculationRate["validity"];
  binding?: CalculationBinding;
  targetRateRefs?: string[];
  alternatives: UsageSignal[][];
}
export interface ReferencedRateRequirement {
  rateTermRef: string;
  applicability: PriceApplicability;
  validity?: CalculationRate["validity"];
  selectorSources: NonNullable<CalculationRate["selector_sources"]>;
}
export type ChargeRequirement = ChargeRequirementBase &
  (
    | { kind: "rate"; selectorSources: NonNullable<CalculationRate["selector_sources"]> }
    | {
        kind: "contribution";
        targetRateRefs: string[];
        referencedRates: ReferencedRateRequirement[];
      }
    | {
        kind: "allowance";
        benefit: CalculationAllowance["benefit"];
        target: CalculationAllowance["target"];
        reset: CalculationAllowance["reset"];
      }
  );
export interface Requirements {
  offerRef: string;
  states: CalculationOffer["states"];
  selectors: PriceDimension[];
  charges: ChargeRequirement[];
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
