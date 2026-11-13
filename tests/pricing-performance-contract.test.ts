import { expect, it } from "vite-plus/test";
import { timingFailures, timingSummary } from "../scripts/pricing-performance-contract.ts";

it("uses nearest-rank percentiles without mutating samples", () => {
  const samples = [100, ...Array.from({ length: 19 }, (_, n) => n)];
  expect(timingSummary(samples)).toEqual({ count: 20, median_ms: 9, p95_ms: 18 });
  expect(samples[0]).toBe(100);
});

it("rejects incomplete or invalid timing evidence", () => {
  for (const samples of [[], [NaN], [Infinity], [-1]]) {
    expect(() => timingSummary(samples)).toThrow();
    expect(() => timingFailures("fixture", samples, [], new Map())).toThrow();
  }
  expect(() => timingFailures("fixture", [1], [], new Map([["switch", [1]]]))).toThrow();
  expect(timingFailures("static", [1], [], new Map())).toEqual([]);
});

it("bounds cold work and each interaction separately, including the tail", () => {
  expect(timingFailures("fixture", [750], [150], new Map([["switch", [50, 100]]]))).toEqual([]);
  const failures = timingFailures(
    "fixture",
    [751],
    [151],
    new Map([
      ["fast", Array.from({ length: 100 }, () => 1)],
      ["slow", [51, 101]],
    ]),
  );
  expect(failures).toHaveLength(4);
  expect(failures.join("\n")).toContain("slow P95");
  expect(failures.join("\n")).toContain("slow median");
});
