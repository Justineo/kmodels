import { canonicalJsonKey } from "../catalog/canonical-value.ts";
import type { PriceCategoricalValue, PriceDimension } from "../catalog/pricing-schema.ts";
import type { WebsitePricingSelector } from "../catalog/website-schema.ts";

export function serviceOfferTitle(
  resource: string | undefined,
  offer: string,
  legacySelectors?: readonly WebsitePricingSelector[],
): string {
  // Older model chunks sometimes omit the resource title. Keep their established name.
  if (
    !resource &&
    offer === "Public rates" &&
    legacySelectors?.some(
      (s) =>
        s.dimension.namespace === "kmodels" &&
        s.dimension.value === "operation" &&
        s.kind === "categorical" &&
        s.values.some(
          ({ value }) =>
            value.namespace === "provider" &&
            value.provider_id === "anthropic" &&
            value.value === "web-assisted",
        ),
    )
  )
    return "Code Execution";
  if (!resource) return offer;
  return offer === "Public rates" || resource.toLowerCase() === offer.toLowerCase()
    ? resource
    : `${resource} · ${offer}`;
}

interface ConditionWording {
  provider: string;
  dimension: PriceDimension;
  value: string;
  label: string;
  description?: string;
}

const operation = { namespace: "kmodels", value: "operation" } as const;
const reviewedValues: readonly ConditionWording[] = [
  { provider: "anthropic", dimension: operation, value: "standalone", label: "Used on its own" },
  {
    provider: "anthropic",
    dimension: operation,
    value: "web-assisted",
    label: "Request includes qualifying web search or web fetch",
    description:
      "Requires web_search_20260209 or web_fetch_20260209, or a later version. Tokens and successful web searches are billed separately.",
  },
  { provider: "deepseek", dimension: operation, value: "server_tools", label: "Model tool call" },
  {
    provider: "deepseek",
    dimension: operation,
    value: "standalone",
    label: "Successful direct API call",
  },
];

export function conditionWording(dimension: PriceDimension, value: PriceCategoricalValue) {
  if (value.namespace !== "provider") return;
  return reviewedValues.find(
    (entry) =>
      entry.provider === value.provider_id &&
      entry.value === value.value &&
      canonicalJsonKey(entry.dimension) === canonicalJsonKey(dimension),
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
