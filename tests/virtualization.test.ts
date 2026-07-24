import { describe, expect, it } from "vite-plus/test";
import { calculateVirtualRange } from "../src/catalog/virtualization.ts";

describe("fixed-row virtual range", () => {
  it("renders the viewport and bounded overscan", () => {
    expect(
      calculateVirtualRange({
        count: 100,
        itemSize: 48,
        overscan: 8,
        scrollOffset: 480,
        viewportSize: 480,
      }),
    ).toEqual({
      start: 2,
      end: 28,
      paddingBefore: 96,
      paddingAfter: 3_456,
    });
  });

  it("clamps both ends of the collection", () => {
    expect(
      calculateVirtualRange({
        count: 100,
        itemSize: 48,
        overscan: 8,
        scrollOffset: 0,
        viewportSize: 480,
      }),
    ).toEqual({
      start: 0,
      end: 18,
      paddingBefore: 0,
      paddingAfter: 3_936,
    });

    expect(
      calculateVirtualRange({
        count: 100,
        itemSize: 48,
        overscan: 8,
        scrollOffset: 4_320,
        viewportSize: 480,
      }),
    ).toEqual({
      start: 82,
      end: 100,
      paddingBefore: 3_936,
      paddingAfter: 0,
    });
  });

  it("handles empty collections and rejects invalid row sizes", () => {
    expect(
      calculateVirtualRange({
        count: 0,
        itemSize: 48,
        overscan: 8,
        scrollOffset: 0,
        viewportSize: 480,
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
