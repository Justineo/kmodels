import { describe, expect, it } from "vite-plus/test";
import type { PriceApplicability } from "../src/catalog/pricing-schema.ts";
import {
  WEBSITE_APPLICABILITY_LABEL_MAX_LENGTH,
  applicabilityLabel,
} from "../src/catalog/website-data.ts";

describe("website applicability labels", () => {
  it("keeps simple conditions exact", () => {
    const applicability: PriceApplicability = {
      any_of: [
        {
          all_of: [
            {
              kind: "categorical",
              dimension: { namespace: "kmodels", value: "region" },
              values: [{ namespace: "kmodels", value: "us-east" }],
            },
          ],
        },
      ],
    };

    expect(applicabilityLabel(applicability, new Map())).toBe("Region: Us-east");
  });

  it("summarizes large DNF scopes within the display budget", () => {
    const clauses: PriceApplicability["any_of"] = Array.from({ length: 128 }, (_, index) => ({
      all_of: [
        {
          kind: "boolean",
          dimension: { namespace: "kmodels", value: "promotion" },
          value: false,
        },
        {
          kind: "categorical",
          dimension: { namespace: "kmodels", value: "region" },
          values: [{ namespace: "kmodels", value: `region-${index}` }],
        },
      ],
    }));
    const applicability: PriceApplicability = {
      any_of: clauses,
    };

    const label = applicabilityLabel(applicability, new Map());
    expect(label).toContain("No promotion");
    expect(label).toContain("Region: 128 values");
    expect(label).toContain("128 combinations");
    expect(label.length).toBeLessThanOrEqual(WEBSITE_APPLICABILITY_LABEL_MAX_LENGTH);
  });
});
