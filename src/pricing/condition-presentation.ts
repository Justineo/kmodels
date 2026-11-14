import type { WebsitePricingSelector } from "../catalog/website-schema.ts";

export function fixedPricingDetailVisible(dimension: string): boolean {
  return !["execution", "billing_mode", "cache_mode"].includes(dimension);
}

export function pricingConditionDescription(selector: WebsitePricingSelector): string | undefined {
  const dashscope =
    selector.kind === "categorical" &&
    selector.values.some(
      ({ value }) => value.namespace === "provider" && value.provider_id === "dashscope",
    );
  if (selector.dimension.namespace !== "kmodels") return;
  if (selector.dimension.value === "region")
    return dashscope
      ? "The API access and data storage region, not your application's location. Inference may run elsewhere within the deployment scope."
      : "The provider region associated with these prices, not the location of the calling application.";
  if (selector.dimension.value === "deployment_scope")
    return dashscope
      ? "Where Alibaba Cloud may run inference. Global can use compute outside the API region; a geographic scope restricts inference to that area. Published combinations vary by model and region."
      : "The provider's deployment or inference routing scope. It can span multiple regions.";
}
