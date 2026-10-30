import { resolveInvocationPriceSelectors } from "./binding.ts";
import type { InvocationPricingBinding } from "../../catalog/invocation-pricing-schema.ts";
import { calculatorForSnapshot } from "../calculator.ts";
import { indexValidatedPriceData } from "../snapshot.ts";
import { PricingError } from "../errors.ts";
import { parseRequest } from "../request.ts";
import type { Selector } from "../schema.ts";
import type { Calculator, CalculationResult, Requirements } from "../types.ts";
import {
  calculationV2RequestSchema,
  selectionV2RequestSchema,
  type CalculationV2Envelope,
  type CalculationV2Request,
  type SelectionV2Request,
} from "./schema.ts";
import { evaluatorEnvelope, validatePriceData } from "./validation.ts";

export interface BoundInvocation {
  selectors: Selector[];
  binding?: InvocationPricingBinding;
  missingInputs: Array<{ kind: "context" | "observed"; input: string }>;
}
export type CalculationV2Result = CalculationResult & {
  snapshot: CalculationV2Envelope["snapshot"];
  invocationSelections: Array<{ componentId: string; targetRef: string; caseRef: string }>;
};
export interface CalculatorV2 {
  listOffers: Calculator["listOffers"];
  listInvocationBindings(): InvocationPricingBinding[];
  bindInvocation(input: SelectionV2Request): BoundInvocation;
  requirements(input: SelectionV2Request): Requirements;
  calculate(input: CalculationV2Request): CalculationV2Result;
}

/** Initialization validates the complete partition; subsequent calculations are synchronous. */
export async function createCalculator(priceData: unknown): Promise<CalculatorV2> {
  const data = await validatePriceData(priceData);
  const evaluator = calculatorForSnapshot(indexValidatedPriceData(evaluatorEnvelope(data)));
  const bindings = data.providers.flatMap(({ invocation_bindings }) => invocation_bindings);

  function bindInvocation(input: SelectionV2Request): BoundInvocation {
    const request = parseRequest(selectionV2RequestSchema, input);
    const candidates = bindings.filter(({ offer_refs }) => offer_refs.includes(request.offerRef));
    const invocation = request.invocation;
    if (invocation === undefined) {
      if (candidates.length > 0)
        throw new PricingError(
          "INVALID_REQUEST",
          "Select an invocation target and case for this offer",
        );
      // Keep ordinary price calculation available for providers without invocation evidence.
      evaluator.requirements(request);
      return { selectors: request.selectors, missingInputs: [] };
    }
    const binding = candidates.find(
      ({ target_ref, case_ref }) =>
        target_ref === invocation.targetRef && case_ref === invocation.caseRef,
    );
    if (binding === undefined)
      throw new PricingError("INVALID_REQUEST", "The selected invocation does not bind this offer");
    const { selectors, missingInputs } = resolveInvocationPriceSelectors(binding, {
      selectors: request.selectors,
      inputs: invocation.inputs,
      observed: invocation.observed,
    });
    evaluator.requirements({ offerRef: request.offerRef, selectors });
    return structuredClone({ selectors, binding, missingInputs });
  }

  function requireBoundSelectors(input: SelectionV2Request): Selector[] {
    const bound = bindInvocation(input);
    if (bound.missingInputs.length > 0)
      throw new PricingError("INVALID_REQUEST", "Invocation pricing inputs are incomplete");
    return bound.selectors;
  }

  return Object.freeze<CalculatorV2>({
    listOffers: (input) => evaluator.listOffers(input),
    listInvocationBindings: () => structuredClone(bindings),
    bindInvocation,
    requirements(input: SelectionV2Request) {
      const request = parseRequest(selectionV2RequestSchema, input);
      return evaluator.requirements({
        offerRef: request.offerRef,
        selectors: requireBoundSelectors(request),
      });
    },
    calculate(input: CalculationV2Request): CalculationV2Result {
      const request = parseRequest(calculationV2RequestSchema, input);
      const invocationSelections: CalculationV2Result["invocationSelections"] = [];
      const components = request.components.map(({ invocation, ...component }) => {
        if (invocation !== undefined)
          invocationSelections.push({
            componentId: component.id,
            targetRef: invocation.targetRef,
            caseRef: invocation.caseRef,
          });
        return {
          ...component,
          selectors: requireBoundSelectors({
            offerRef: component.offerRef,
            selectors: component.selectors,
            ...(invocation === undefined ? {} : { invocation }),
          }),
        };
      });
      return {
        ...evaluator.calculate({ ...request, components }),
        snapshot: structuredClone(data.snapshot),
        invocationSelections,
      };
    },
  });
}
