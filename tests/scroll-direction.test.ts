import { describe, expect, it } from "vite-plus/test";
import {
  clampScrollPosition,
  dominantScrollAxis,
  recentScrollVelocity,
} from "../src/scroll-direction.ts";

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

describe("touch scroll bounds", () => {
  it("clamps projected momentum to the scrollable range", () => {
    expect(clampScrollPosition(-120, 1_120, 390)).toBe(0);
    expect(clampScrollPosition(320, 1_120, 390)).toBe(320);
    expect(clampScrollPosition(900, 1_120, 390)).toBe(730);
  });

  it("stays at zero when the viewport does not overflow", () => {
    expect(clampScrollPosition(120, 390, 390)).toBe(0);
    expect(clampScrollPosition(120, 320, 390)).toBe(0);
  });
});

describe("touch scroll velocity", () => {
  it("uses the recent movement window instead of one noisy event", () => {
    expect(
      recentScrollVelocity(
        [
          { position: 0, time: 0 },
          { position: 20, time: 100 },
          { position: 60, time: 140 },
          { position: 100, time: 180 },
        ],
        180,
        100,
      ),
    ).toBe(1);
  });

  it("returns zero without two current samples", () => {
    expect(recentScrollVelocity([{ position: 20, time: 20 }], 200, 100)).toBe(0);
  });

  it("rejects invalid sample windows", () => {
    expect(() => recentScrollVelocity([], 0, 0)).toThrow("positive number");
  });
});
