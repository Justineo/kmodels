import { describe, expect, it } from "vite-plus/test";
import {
  canonicalizeInstant,
  isCanonicalInstant,
  isPublishedTime,
  publishedValiditiesOverlap,
  publishedValidityIsCoherent,
} from "../src/catalog/pricing-time.ts";

describe("pricing published time", () => {
  it("canonicalizes offsets and fractional seconds exactly", () => {
    expect(canonicalizeInstant("2026-07-28T00:30:00+01:00")).toBe("2026-07-27T23:30:00.000Z");
    expect(canonicalizeInstant("2026-12-31T23:30:00-02:00")).toBe("2027-01-01T01:30:00.000Z");
    expect(canonicalizeInstant("2026-07-28T00:00:00.123400Z")).toBe("2026-07-28T00:00:00.1234Z");
    expect(canonicalizeInstant("2026-07-28T00:00:00.1Z")).toBe("2026-07-28T00:00:00.100Z");
  });

  it("rejects invalid or out-of-range instants", () => {
    expect(() => canonicalizeInstant("0001-01-01T00:00:00+01:00")).toThrow("supported year range");
    expect(() => canonicalizeInstant("2026-02-29T00:00:00Z")).toThrow("Invalid RFC 3339 instant");
    expect(() => canonicalizeInstant("2026-01-01T00:00:00-00:00")).toThrow("Unknown local offset");
  });

  it("validates canonical calendar labels", () => {
    expect(isPublishedTime("2024-02-29", "date")).toBe(true);
    expect(isPublishedTime("2023-02-29", "date")).toBe(false);
    expect(isPublishedTime("2026-07", "month")).toBe(true);
    expect(isPublishedTime("2026-7", "month")).toBe(false);
    expect(isCanonicalInstant("2026-07-28T00:00:00.000Z")).toBe(true);
    expect(isCanonicalInstant("2026-07-28T00:00:00Z")).toBe(false);
  });

  it("uses numeric fractional ordering for validity coherence", () => {
    expect(
      publishedValidityIsCoherent(
        { value: "2026-07-28T00:00:00.123Z", precision: "datetime" },
        { value: "2026-07-28T00:00:00.1234Z", precision: "datetime" },
      ),
    ).toBe(true);
    expect(
      publishedValidityIsCoherent(
        { value: "2027", precision: "year" },
        { value: "2026-12-31", precision: "date" },
      ),
    ).toBe(false);
    expect(
      publishedValidityIsCoherent(
        { value: "2026", precision: "year", inclusive: false },
        { value: "2026-12", precision: "month" },
      ),
    ).toBe(true);
    expect(
      publishedValidityIsCoherent(
        { value: "2026", precision: "year", inclusive: false },
        { value: "2026", precision: "year" },
      ),
    ).toBe(false);
  });

  it("proves only unambiguous validity intervals disjoint", () => {
    expect(
      publishedValiditiesOverlap(
        { until: { value: "2026-08-31", precision: "date" } },
        { from: { value: "2026-09-01", precision: "date" } },
      ),
    ).toBe(false);
    expect(
      publishedValiditiesOverlap(
        { until: { value: "2026", precision: "year" } },
        { from: { value: "2026-09-01", precision: "date" } },
      ),
    ).toBe(true);
    expect(
      publishedValiditiesOverlap(
        { until: { value: "2026-09-01", precision: "date", inclusive: false } },
        { from: { value: "2026-09-01", precision: "date" } },
      ),
    ).toBe(false);
  });
});
