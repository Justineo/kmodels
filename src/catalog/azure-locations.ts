import { z } from "zod";
import { assertSourceConstraint, recognizeValue } from "./source-contract.ts";

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
  const provider = recognizeValue(
    "Azure resource-type metadata",
    azureProviderResourceTypesSchema,
    providerResourceTypes,
  );
  const subscription = recognizeValue(
    "Azure subscription locations",
    z.array(azureSubscriptionLocationSchema),
    subscriptionLocations,
  );
  const accountTypes = provider.value.filter(
    ({ resourceType }) => resourceType.toLowerCase() === "accounts",
  );
  assertSourceConstraint(
    "Azure Cognitive Services account location metadata is ambiguous",
    accountTypes.length === 1,
    accountTypes,
    ["value"],
  );
  const advertised = accountTypes[0]?.locations;
  assertSourceConstraint(
    "Azure Cognitive Services advertised no account locations",
    advertised !== undefined && advertised.length > 0,
    advertised,
    ["value", "locations"],
  );

  const namesByDisplay = new Map<string, string>();
  for (const location of subscription) {
    if (location.type !== "Region") continue;
    const key = displayKey(location.displayName);
    const name = location.name.toLowerCase();
    const existing = namesByDisplay.get(key);
    assertSourceConstraint(
      "Azure subscription location display name is ambiguous",
      existing === undefined || existing === name,
      location,
      ["displayName"],
    );
    namesByDisplay.set(key, name);
  }

  const locations = new Set<string>();
  for (const displayName of advertised) {
    const key = displayKey(displayName);
    if (key === "global") continue;
    const location = namesByDisplay.get(key);
    assertSourceConstraint(
      `Azure Cognitive Services location ${displayName} has no canonical name`,
      location !== undefined,
      displayName,
      ["value", "locations"],
    );
    locations.add(location);
  }
  assertSourceConstraint(
    "Azure Models API had no regional locations",
    locations.size > 0,
    [...locations],
    ["value", "locations"],
  );
  return [...locations].sort();
}
