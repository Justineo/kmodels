import { describe, expect, it } from "vite-plus/test";
import { parsePricingReleaseInput } from "../src/catalog/pricing-release.ts";

describe("pricing release input", () => {
  it("accepts only closed reviewed transitions and pair-bound safety findings", () => {
    expect(
      parsePricingReleaseInput({
        transitions: [{ kind: "withdraw_pricing", provider_id: "test" }],
        safety_findings: [
          {
            provider_id: "test",
            accepted_pair_id: "a".repeat(64),
            affects: "pricing",
          },
        ],
      }),
    ).toMatchObject({
      transitions: [{ kind: "withdraw_pricing", provider_id: "test" }],
      safety_findings: [{ affects: "pricing" }],
    });
    expect(() =>
      parsePricingReleaseInput({
        transitions: [{ kind: "failed", provider_id: "test" }],
      }),
    ).toThrow();
  });
});
