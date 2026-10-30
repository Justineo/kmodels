import type { InvocationPricingBinding } from "./invocation-pricing-schema.ts";
import type { InvocationTarget } from "./invocation-schema.ts";

/** An explicit tariff identity does not change the independently observed model resolution. */
export function invocationPricingModelRef(
  target: Pick<InvocationTarget, "model_ref" | "resolved_model_ref">,
  binding?: Pick<InvocationPricingBinding, "selectors">,
): string {
  const source = binding?.selectors.find(
    ({ dimension }) => dimension.namespace === "kmodels" && dimension.value === "model",
  )?.value;
  if (source === undefined) return target.resolved_model_ref ?? target.model_ref;
  if (
    source.kind !== "fixed" ||
    typeof source.value === "boolean" ||
    source.value.namespace !== "kmodels" ||
    (source.value.value !== target.model_ref && source.value.value !== target.resolved_model_ref)
  )
    throw new Error("Invocation price model selector contradicts its target");
  return source.value.value;
}
