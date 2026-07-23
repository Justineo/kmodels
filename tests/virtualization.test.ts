import { describe, expect, it } from "vite-plus/test";
import { calculateVirtualRange } from "../src/catalog/virtualization.ts";

describe("fixed-row virtual range", () => {
  it("renders the viewport and bounded overscan", () => {
    expect(
      calculateVirtualRange({
        count: 100,
        itemSize: 52,
        overscan: 8,
        scrollOffset: 520,
        viewportSize: 520,
      }),
    ).toEqual({
      start: 2,
      end: 28,
      paddingBefore: 104,
      paddingAfter: 3_744,
    });
  });

  it("clamps both ends of the collection", () => {
    expect(
      calculateVirtualRange({
        count: 100,
        itemSize: 52,
        overscan: 8,
        scrollOffset: 0,
        viewportSize: 520,
      }),
    ).toEqual({
      start: 0,
      end: 18,
      paddingBefore: 0,
      paddingAfter: 4_264,
    });

    expect(
      calculateVirtualRange({
        count: 100,
        itemSize: 52,
        overscan: 8,
        scrollOffset: 4_680,
        viewportSize: 520,
      }),
    ).toEqual({
      start: 82,
      end: 100,
      paddingBefore: 4_264,
      paddingAfter: 0,
    });
  });

  it("handles empty collections and rejects invalid row sizes", () => {
    expect(
      calculateVirtualRange({
        count: 0,
        itemSize: 52,
        overscan: 8,
        scrollOffset: 0,
        viewportSize: 520,
      }),
    ).toEqual({
      start: 0,
      end: 0,
      paddingBefore: 0,
      paddingAfter: 0,
    });

    expect(() =>
      calculateVirtualRange({
        count: 1,
        itemSize: 0,
        overscan: 0,
        scrollOffset: 0,
        viewportSize: 0,
      }),
    ).toThrow("Virtual item size must be positive");
  });
});
