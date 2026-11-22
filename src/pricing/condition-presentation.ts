import type { PriceCategoricalValue } from "../catalog/pricing-schema.ts";
import type { WebsitePricingSelector } from "../catalog/website-schema.ts";

export function serviceOfferTitle(resource: string | undefined, offer: string): string {
  if (!resource) return offer;
  return offer === "Public rates" || resource.toLowerCase() === offer.toLowerCase()
    ? resource
    : `${resource} · ${offer}`;
}

const webToolRequirement =
  "Requires web_search_20260209 or web_fetch_20260209, or a later version. Tokens and successful web searches are billed separately.";

export function serviceOperationCopy(
  value: PriceCategoricalValue,
  label: string,
): {
  label: string;
  detail?: string;
} {
  if (value.namespace === "provider") {
    if (value.provider_id === "anthropic" && value.value === "web-assisted")
      return {
        label: "Request includes qualifying web search or web fetch",
        detail: webToolRequirement,
      };
    if (value.provider_id === "deepseek") {
      if (value.value === "server_tools") return { label: "Model tool call" };
      if (value.value === "standalone") return { label: "Successful direct API call" };
    }
    if (value.value === "standalone") return { label: "Used on its own" };
  }
  return { label };
}

export function isCodeExecutionSelector(selector: WebsitePricingSelector): boolean {
  return (
    selector.dimension.namespace === "kmodels" &&
    selector.dimension.value === "operation" &&
    selector.kind === "categorical" &&
    selector.values.some(
      ({ value }) =>
        value.namespace === "provider" &&
        value.provider_id === "anthropic" &&
        value.value === "web-assisted",
    )
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
  if (isCodeExecutionSelector(selector))
    return {
      label: "Web tool use",
      description: `Code execution has no extra charge with qualifying web tools. ${webToolRequirement}`,
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
