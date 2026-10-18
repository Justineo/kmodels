import { describe, expect, it } from "vite-plus/test";
import {
  armCostMeterId,
  azureArmSkuSchema,
  azurePriceAmountSchema,
} from "../src/catalog/azure-commercial.ts";

describe("Azure ARM commercial metadata", () => {
  it("normalizes numeric exponents while rejecting non-price strings", () => {
    expect(azurePriceAmountSchema.parse(1e-7)).toBe("0.0000001");
    expect(azurePriceAmountSchema.parse(1e21)).toBe("1000000000000000000000");
    expect(azurePriceAmountSchema.parse("0.0010")).toBe("0.001");
    for (const value of ["Pending", "-1", "NaN", "1e-7", -1, Infinity])
      expect(azurePriceAmountSchema.safeParse(value).success).toBe(false);
  });

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
