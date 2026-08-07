import { z } from "zod";

const azureProviderResourceTypesSchema = z.object({
  value: z.array(
    z.object({
      resourceType: z.string().min(1),
      locations: z.array(z.string().min(1)).optional(),
    }),
  ),
});

const azureSubscriptionLocationSchema = z.object({
  name: z.string().regex(/^[a-z0-9-]+$/i),
  displayName: z.string().min(1),
  type: z.enum(["Region", "EdgeZone"]),
});

function displayKey(value: string): string {
  return value.trim().replaceAll(/\s+/g, " ").toLowerCase();
}

export function azureModelLocations(
  providerResourceTypes: unknown,
  subscriptionLocations: unknown,
): string[] {
  const provider = azureProviderResourceTypesSchema.parse(providerResourceTypes);
  const subscription = z.array(azureSubscriptionLocationSchema).parse(subscriptionLocations);
  const accountTypes = provider.value.filter(
    ({ resourceType }) => resourceType.toLowerCase() === "accounts",
  );
  if (accountTypes.length !== 1)
    throw new Error("Azure Cognitive Services account location metadata is ambiguous");
  const advertised = accountTypes[0]?.locations;
  if (advertised === undefined || advertised.length === 0)
    throw new Error("Azure Cognitive Services advertised no account locations");

  const namesByDisplay = new Map<string, string>();
  for (const location of subscription) {
    if (location.type !== "Region") continue;
    const key = displayKey(location.displayName);
    const name = location.name.toLowerCase();
    const existing = namesByDisplay.get(key);
    if (existing !== undefined && existing !== name)
      throw new Error("Azure subscription location display name is ambiguous");
    namesByDisplay.set(key, name);
  }

  const locations = new Set<string>();
  for (const displayName of advertised) {
    const key = displayKey(displayName);
    if (key === "global") continue;
    const location = namesByDisplay.get(key);
    if (location === undefined)
      throw new Error(`Azure Cognitive Services location ${displayName} has no canonical name`);
    locations.add(location);
  }
  if (locations.size === 0) throw new Error("Azure Models API had no regional locations");
  return [...locations].sort();
}
