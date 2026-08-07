import { describe, expect, it } from "vite-plus/test";
import { armCostMeterId, azureArmSkuSchema } from "../src/catalog/azure-commercial.ts";

describe("Azure ARM commercial metadata", () => {
  it("treats an empty direct meter as missing", () => {
    expect(armCostMeterId({ meterId: " " })).toBeUndefined();
    expect(armCostMeterId({ meterId: " meter-input " })).toBe("meter-input");
  });

  it("normalizes both ARM cost spellings and rejects disagreement", () => {
    expect(
      azureArmSkuSchema.parse({
        name: "GlobalStandard",
        cost: [{ name: "GeneratedToken", meterId: "meter-output" }],
      }).costs,
    ).toEqual([{ name: "GeneratedToken", meterId: "meter-output" }]);
    expect(() =>
      azureArmSkuSchema.parse({
        name: "GlobalStandard",
        cost: [{ name: "GeneratedToken", meterId: "meter-output" }],
        costs: [{ name: "GeneratedToken", meterId: "different" }],
      }),
    ).toThrow("ARM SKU cost and costs fields disagree");
  });
});
