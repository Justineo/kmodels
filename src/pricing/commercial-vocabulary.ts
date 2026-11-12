import { z } from "zod";

export const commercialDimensionSchema = z.enum([
  "execution",
  "billing_mode",
  "resource_kind",
  "service_tier",
  "requested_service_tier",
  "served_service_tier",
  "speed",
]);
export type CommercialDimension = z.infer<typeof commercialDimensionSchema>;
export const commercialDimensionLabels: Record<CommercialDimension, string> = {
  execution: "Execution",
  billing_mode: "Billing basis",
  resource_kind: "Resource kind",
  service_tier: "Service tier",
  requested_service_tier: "Requested service tier",
  served_service_tier: "Served service tier",
  speed: "Served speed",
};
export const commercialDefinitions: Record<CommercialDimension, string> = {
  execution:
    "The commercially evidenced request, Batch or live-session mechanism; transport alone does not establish it.",
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
    request: "Ordinary request",
    batch: "Batch",
    realtime: "Live session",
    usage: "Usage",
    capacity: "Running capacity",
    service: "Service",
    standard: "Standard",
    priority: "Priority",
    flex: "Flex",
    fast: "Fast",
    ultrafast: "Ultrafast",
  };
  return labels[value] ?? value;
}
