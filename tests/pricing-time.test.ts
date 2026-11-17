import { describe, expect, it } from "vite-plus/test";
import {
  canonicalizeInstant,
  isCanonicalInstant,
  isPublishedTime,
  publishedValiditiesOverlap,
  publishedValidityIsCoherent,
  publishedValidityStatus,
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

  it("resolves exact effective times and excludes clearly future calendar labels", () => {
    const transition = "2026-08-16T16:00:00.000Z";
    const before = "2026-08-15T00:00:00.000Z";
    const currentPlan = {
      until: { value: transition, precision: "datetime" as const, inclusive: false },
    };
    const nextPlan = { from: { value: transition, precision: "datetime" as const } };

    expect(publishedValidityStatus(currentPlan, before)).toBe("current");
    expect(publishedValidityStatus(nextPlan, before)).toBe("upcoming");
    expect(publishedValidityStatus(currentPlan, transition)).toBe("expired");
    expect(publishedValidityStatus(nextPlan, transition)).toBe("current");
    expect(
      publishedValidityStatus({ until: { value: transition, precision: "datetime" } }, transition),
    ).toBe("current");
    expect(
      publishedValidityStatus(
        { from: { value: transition, precision: "datetime", inclusive: false } },
        transition,
      ),
    ).toBe("upcoming");
    expect(
      publishedValidityStatus({ from: { value: "2026-08-17", precision: "date" } }, before),
    ).toBe("upcoming");
  });

  it.each([
    ["2026-11-17T06:45:00.000Z", "current", "upcoming"],
    ["2026-11-29T23:59:59.999Z", "unresolved", "upcoming"],
    ["2026-11-30T00:00:00.000Z", "unresolved", "unresolved"],
    ["2026-12-01T23:59:59.999Z", "unresolved", "unresolved"],
    ["2026-12-02T00:00:00.000Z", "expired", "unresolved"],
    ["2026-12-03T00:00:00.000Z", "expired", "current"],
  ])("bounds date-only uncertainty at %s without inventing a cutover", (instant, old, next) => {
    expect(
      publishedValidityStatus({ until: { value: "2026-11-30", precision: "date" } }, instant),
    ).toBe(old);
    expect(
      publishedValidityStatus({ from: { value: "2026-12-01", precision: "date" } }, instant),
    ).toBe(next);
  });

  it.each([true, false, undefined])(
    "keeps ambiguous coarse endpoints unresolved with inclusivity %s",
    (inclusive) => {
      for (const precision of ["date", "month", "year"] as const) {
        const value = { date: "2026-11-30", month: "2026-11", year: "2026" }[precision];
        const boundary = { value, precision, inclusive };
        for (const validity of [{ from: boundary }, { until: boundary }])
          expect(publishedValidityStatus(validity, "2026-11-30T12:00:00.000Z")).toBe("unresolved");
      }
    },
  );

  it.each([
    ["month", "2026-11", "2026-10-01T00:00:00.000Z", "2026-12-02T00:00:00.000Z"],
    ["year", "2026", "2025-12-01T00:00:00.000Z", "2027-01-02T00:00:00.000Z"],
    ["date", "2024-02-29", "2024-02-27T23:59:59.999Z", "2024-03-02T00:00:00.000Z"],
  ] as const)(
    "resolves %s labels only outside the whole guarded period",
    (precision, value, before, after) => {
      const boundary = { value, precision };
      expect(publishedValidityStatus({ from: boundary }, before)).toBe("upcoming");
      expect(publishedValidityStatus({ until: boundary }, before)).toBe("current");
      expect(publishedValidityStatus({ from: boundary }, after)).toBe("current");
      expect(publishedValidityStatus({ until: boundary }, after)).toBe("expired");
    },
  );

  it("lets a definite exclusion dominate an uncertain sibling boundary", () => {
    expect(
      publishedValidityStatus(
        {
          from: { value: "2026-11", precision: "month" },
          until: { value: "2026-11-15T00:00:00.000Z", precision: "datetime" },
        },
        "2026-11-17T00:00:00.000Z",
      ),
    ).toBe("expired");
    expect(
      publishedValidityStatus(
        {
          from: { value: "2026-11-20T00:00:00.000Z", precision: "datetime" },
          until: { value: "2026-11", precision: "month" },
        },
        "2026-11-17T00:00:00.000Z",
      ),
    ).toBe("upcoming");
    expect(
      publishedValidityStatus(
        {
          from: { value: "2026-11-01", precision: "date" },
          until: { value: "2026-11-30", precision: "date" },
        },
        "2026-11-17T00:00:00.000Z",
      ),
    ).toBe("current");
  });

  it("handles calendar limits without turning boundary uncertainty into a match", () => {
    expect(
      publishedValidityStatus(
        { from: { value: "0001", precision: "year" } },
        "0001-01-01T00:00:00.000Z",
      ),
    ).toBe("unresolved");
    expect(
      publishedValidityStatus(
        { until: { value: "9999", precision: "year" } },
        "9999-12-31T23:59:59.999Z",
      ),
    ).toBe("unresolved");
  });
});
