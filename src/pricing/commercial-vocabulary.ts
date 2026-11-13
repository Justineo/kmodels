import { z } from "zod";

export const commercialDimensionSchema = z.enum([
  "execution",
  "account_plan",
  "billing_mode",
  "resource_kind",
  "service_tier",
  "requested_service_tier",
  "served_service_tier",
  "speed",
]);
export type CommercialDimension = z.infer<typeof commercialDimensionSchema>;
export function commercialConditionDimension(dimension: CommercialDimension): string {
  return dimension === "account_plan" ? "account_eligibility" : dimension;
}
export const commercialDimensionLabels: Record<CommercialDimension, string> = {
  execution: "Request mode",
  account_plan: "Account plan",
  billing_mode: "Billing basis",
  resource_kind: "Resource kind",
  service_tier: "Service tier",
  requested_service_tier: "Requested service tier",
  served_service_tier: "Billed service tier",
  speed: "Speed",
};
export const commercialDefinitions: Record<CommercialDimension, string> = {
  execution:
    "The commercially evidenced request, Batch or live-session mechanism; transport alone does not establish it.",
  account_plan:
    "The enrolled account pricing program, including its billing or data-use obligations.",
  billing_mode:
    "The charging basis; usage and running capacity do not imply a service tier or execution mechanism.",
  resource_kind: "The subject class of an independently priced provider resource.",
  service_tier:
    "The commercial service class established by the tariff, without an implied cross-provider SLA.",
  requested_service_tier:
    "A requested service class; it does not establish the outcome or the billed tier.",
  served_service_tier: "The actual service class used to select the billed tariff.",
  speed:
    "The actual performance class used to select the billed tariff, independently of service-tier naming.",
};
export function commercialValueLabel(value: string): string {
  const labels: Record<string, string> = {
    request: "Request",
    free_tier: "Free tier",
    paid_tier: "Paid tier",
    free_tier_contributor: "Contributor free tier",
    paid_tier_contributor: "Contributor paid tier",
    data_sharing: "Data sharing",
    default: "Standard account",
    batch: "Batch",
    realtime: "Realtime",
    usage: "Usage",
    capacity: "Running capacity",
    service: "Service",
    standard: "Standard",
    optimized: "Latency optimized",
    priority: "Priority",
    flex: "Flex",
    fast: "Fast",
    ultrafast: "Ultrafast",
  };
  return labels[value] ?? value;
}
