import { describe, expect, it } from "vite-plus/test";
import { dominantScrollAxis } from "../src/scroll-direction.ts";

describe("touch scroll direction", () => {
  it("waits for the gesture threshold", () => {
    expect(dominantScrollAxis(7, 7, 8)).toBeUndefined();
  });

  it("selects one dominant axis and prefers vertical for a tie", () => {
    expect(dominantScrollAxis(12, 8, 8)).toBe("horizontal");
    expect(dominantScrollAxis(8, 12, 8)).toBe("vertical");
    expect(dominantScrollAxis(12, 12, 8)).toBe("vertical");
  });

  it("rejects invalid thresholds", () => {
    expect(() => dominantScrollAxis(1, 1, -1)).toThrow("non-negative");
  });
});
