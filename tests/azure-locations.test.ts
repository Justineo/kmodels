import { describe, expect, it } from "vite-plus/test";
import { azureModelLocations } from "../src/catalog/azure-locations.ts";

const provider = {
  value: [
    {
      resourceType: "accounts",
      locations: ["Global", "East US 2", "Sweden Central", "East US 2"],
    },
  ],
};

const subscriptionLocations = [
  { name: "eastus2", displayName: "East US 2", type: "Region" },
  { name: "swedencentral", displayName: "Sweden Central", type: "Region" },
  { name: "edge-test", displayName: "Edge Test", type: "EdgeZone" },
];

describe("Azure location discovery", () => {
  it("maps provider display names to canonical regional names", () => {
    expect(azureModelLocations(provider, subscriptionLocations)).toEqual([
      "eastus2",
      "swedencentral",
    ]);
  });

  it("rejects a provider location without a canonical subscription mapping", () => {
    expect(() =>
      azureModelLocations(
        { value: [{ resourceType: "accounts", locations: ["Unknown Region"] }] },
        subscriptionLocations,
      ),
    ).toThrow("Unknown Region has no canonical name");
  });

  it("rejects ambiguous account resource metadata", () => {
    expect(() =>
      azureModelLocations(
        {
          value: [
            { resourceType: "accounts", locations: ["East US 2"] },
            { resourceType: "Accounts", locations: ["Sweden Central"] },
          ],
        },
        subscriptionLocations,
      ),
    ).toThrow("account location metadata is ambiguous");
  });
});
