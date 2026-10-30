import { canonicalJson } from "../../catalog/canonical-value.ts";
import type { InvocationPricingBinding } from "../../catalog/invocation-pricing-schema.ts";
import type { PriceCategoricalValue } from "../../catalog/pricing-schema.ts";
import { PricingError } from "../errors.ts";
import type { Selector } from "../schema.ts";

/** Resolve values identically for the calculator and conditional website rates. */
export function resolveInvocationPriceSelectors(
  binding: InvocationPricingBinding,
  input: {
    selectors: readonly Selector[];
    inputs: Readonly<Record<string, PriceCategoricalValue>>;
    observed: Readonly<Record<string, PriceCategoricalValue>>;
  },
) {
  const selectors = [...input.selectors];
  const dimensions = new Set(selectors.map(({ dimension }) => canonicalJson(dimension)));
  if (dimensions.size !== selectors.length)
    throw new PricingError("DUPLICATE_SELECTOR", "Selector dimensions must be unique");
  const missingInputs: Array<{ kind: "context" | "observed"; input: string }> = [];
  const expectedContext = new Set<string>();
  const expectedObserved = new Set<string>();
  for (const selector of binding.selectors) {
    const source = selector.value;
    if (source.kind === "context") expectedContext.add(source.input);
    if (source.kind === "observed") expectedObserved.add(source.input_ref);
    const value =
      source.kind === "fixed"
        ? source.value
        : source.kind === "context"
          ? input.inputs[source.input]
          : input.observed[source.input_ref];
    const existing = selectors.find(
      ({ dimension }) => canonicalJson(dimension) === canonicalJson(selector.dimension),
    );
    if (value === undefined) {
      if (existing !== undefined)
        throw new PricingError(
          "INVALID_REQUEST",
          "Supply invocation selectors through their declared context or observed input",
        );
      if (source.kind !== "fixed")
        missingInputs.push({
          kind: source.kind,
          input: source.kind === "context" ? source.input : source.input_ref,
        });
      continue;
    }
    const derived: Selector = { kind: "categorical", dimension: selector.dimension, value };
    if (existing !== undefined && canonicalJson(existing) !== canonicalJson(derived))
      throw new PricingError(
        "INVALID_REQUEST",
        "A caller selector contradicts the invocation binding",
      );
    if (existing === undefined) selectors.push(derived);
  }
  if (
    Object.keys(input.inputs).some((key) => !expectedContext.has(key)) ||
    Object.keys(input.observed).some((key) => !expectedObserved.has(key))
  )
    throw new PricingError("INVALID_REQUEST", "Invocation input is not declared by this binding");
  return { selectors, missingInputs };
}
