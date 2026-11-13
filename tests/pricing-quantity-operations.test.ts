import { describe, expect, it } from "vite-plus/test";
import { validateUsageQuantityCalculation } from "../src/catalog/pricing-quantity-contract.ts";
import type { UsageSignal } from "../src/catalog/pricing-schema.ts";

const signal: UsageSignal = { namespace: "kmodels", value: "input_tokens" };

describe("validateUsageQuantityCalculation", () => {
  it("rejects repeated signals", () => {
    expect(() =>
      validateUsageQuantityCalculation({
        nodes: [
          { op: "signal", signal },
          { op: "signal", signal },
          { op: "sum", inputs: [0, 1] },
        ],
        result: 2,
      }),
    ).toThrow("repeats a usage signal");
  });
  it("rejects a zero billing increment", () => {
    expect(() =>
      validateUsageQuantityCalculation({
        nodes: [
          { op: "signal", signal },
          { op: "round_up", input: 0, increment: { numerator: "0", denominator: "1" } },
        ],
        result: 1,
      }),
    ).toThrow("Billing increment must be positive");
  });
});
