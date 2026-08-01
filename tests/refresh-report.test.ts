import { describe, expect, it } from "vite-plus/test";
import { refreshReport } from "../src/catalog/refresh-report.ts";

describe("refresh report", () => {
  it("makes retained publication and exact model changes visible", () => {
    const output = refreshReport({
      schema_version: 2,
      generated_at: "2026-08-01T00:00:00.000Z",
      catalog_version: "a".repeat(64),
      outcome: "unchanged",
      publication: "partial",
      operational: {
        provider_durations: [{ provider_id: "example", duration_ms: 1_250 }],
      },
      providers: [
        {
          provider_id: "example",
          status: "stale",
          publication: "retained",
          models: {
            current: 1,
            added: 1,
            removed: 1,
            changed: 0,
            added_model_refs: ["example/new"],
            removed_model_refs: ["example/old"],
            changed_models: [],
          },
          sources: { changed: 0 },
          pricing: { outcome: "unchanged" },
          signals: ["drift_guard_triggered"],
          attempt: {
            outcome: "rejected",
            sources: [{ source_id: "example-catalog", outcome: "parse_failed" }],
            validation_issue: { code: "model_count_drop" },
            failure: { code: "source_schema_changed" },
            pricing: { outcome: "failed", failure_code: "source_schema_changed" },
          },
        },
      ],
    });

    expect(output.warnings).toEqual([
      "example publication was retained",
      "example: drift_guard_triggered",
      "example: pricing attempt source_schema_changed",
    ]);
    expect(output.markdown).toContain("partial publication");
    expect(output.markdown).toContain("1.3s");
    expect(output.markdown).toContain("`example/new`");
    expect(output.markdown).toContain("`example/old`");
    expect(output.markdown).toContain("`example-catalog` parse_failed");
    expect(output.markdown).toContain("`model_count_drop`");
    expect(output.markdown).toContain("Pricing attempt: `source_schema_changed`");
  });
});
