import type { PriceDimension, PriceCategoricalValue } from "../catalog/pricing-schema.ts";
import type { WebsitePricingSelector } from "../catalog/website-schema.ts";

export function isWebAssistedCodeExecution(
  dimension: PriceDimension,
  value: PriceCategoricalValue,
): boolean {
  return (
    dimension.namespace === "kmodels" &&
    dimension.value === "operation" &&
    value.namespace === "provider" &&
    value.provider_id === "anthropic" &&
    value.value === "web-assisted"
  );
}

export function fixedPricingDetailVisible(dimension: string): boolean {
  return !["execution", "billing_mode", "cache_mode"].includes(dimension);
}

export function pricingConditionHeading(selector: WebsitePricingSelector): {
  label: string;
  description?: string;
} {
  const { label } = selector;
  if (selector.dimension.namespace !== "kmodels") return { label };
  if (
    selector.kind === "categorical" &&
    selector.values.some(({ value }) => isWebAssistedCodeExecution(selector.dimension, value))
  )
    return {
      label: "Code execution",
      description:
        "Code execution is included when the request contains web_search_20260209 or web_fetch_20260209, or a later version of either tool. Tokens and successful web searches are billed separately.",
    };
  const dashscope =
    selector.kind === "categorical" &&
    selector.values.some(
      ({ value }) => value.namespace === "provider" && value.provider_id === "dashscope",
    );
  if (selector.dimension.value === "region")
    return {
      label,
      description: dashscope
        ? "The API access and data storage region, not your application's location. Inference may run elsewhere within the deployment scope."
        : "The provider region associated with these prices, not the location of the calling application.",
    };
  if (selector.dimension.value === "deployment_scope")
    return {
      label,
      description: dashscope
        ? "Where Alibaba Cloud may run inference. Global can use compute outside the API region; a geographic scope restricts inference to that area. Published combinations vary by model and region."
        : "The provider's deployment or inference routing scope. It can span multiple regions.",
    };
  return { label };
}
