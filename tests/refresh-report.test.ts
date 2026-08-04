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
            changed: 1,
            added_model_refs: ["example/new"],
            removed_model_refs: ["example/old"],
            changed_models: [
              {
                model_ref: "example/model",
                fields: ["limits"],
                limit_changes: [
                  { field: "context_tokens", previous: 128_000, current: 131_072 },
                  { field: "max_output_tokens", previous: 4_096 },
                ],
              },
            ],
          },
          sources: { changed: 0 },
          pricing: { outcome: "unchanged" },
          pricing_coverage: {
            current_models: 3,
            offer_models: 1,
            not_applicable_models: 1,
            unknown_models: 1,
            normalized_rate_models: 1,
            raw_fact_models: 0,
            unknown_model_refs: ["example/unknown"],
            unknown_model_refs_omitted: 0,
          },
          signals: [
            "drift_guard_triggered",
            "breaking_contract_mismatch",
            "coverage_regression",
            "persistent_source_failure",
          ],
          attempt: {
            outcome: "rejected",
            sources: [
              {
                source_id: "example-catalog",
                outcome: "parse_failed",
                consecutive_failures: 3,
                last_success_at: "2026-07-31T00:00:00.000Z",
                contract_finding: {
                  disposition: "reject",
                  observed_items: 312,
                  diagnostic_count: 2,
                  diagnostics: [
                    {
                      fingerprint: "0123456789abcdef",
                      kind: "missing_required_field",
                      path: "/video_capabilities/generate_audio",
                      expected: "boolean",
                      observed: "missing",
                      affected_items: 1,
                      sample_model_ids: ["example/video"],
                    },
                  ],
                },
                pricing_extraction: {
                  model_records: 2,
                  numeric_models: 1,
                  raw_models: 0,
                  free_models: 0,
                  custom_quote_models: 0,
                  not_published_models: 0,
                  not_applicable_models: 0,
                  unknown_models: 1,
                  normalized_facts: 4,
                  raw_facts: 0,
                },
                pricing_reconciliation: {
                  basis: "source_item",
                  unit: "reviewed source pricing item",
                  observed_items: 5,
                  disposition_counts: {
                    normalized: 2,
                    raw: 0,
                    explicit_non_numeric: 0,
                    excluded: 1,
                    unbound: 1,
                    ambiguous: 0,
                    unsupported: 1,
                    unresolved: 0,
                  },
                  diagnostic_count: 2,
                  diagnostics: [
                    {
                      disposition: "unbound",
                      reason_code: "identity_not_found",
                      sample: "Example model input",
                    },
                  ],
                },
              },
            ],
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
      "example: coverage_regression",
      "example/example-catalog: reject missing_required_field at /video_capabilities/generate_audio (1/312 items; 0123456789abcdef)",
      "example/example-catalog: 2/5 pricing items unresolved (1 unbound, 0 ambiguous, 1 unsupported, 0 unresolved)",
      "example/example-catalog: 3 consecutive failures; 24.0h stale",
      "example: pricing attempt source_schema_changed",
    ]);
    expect(output.markdown).toContain("partial publication");
    expect(output.markdown).toContain("1.3s");
    expect(output.markdown).toContain("`example/new`");
    expect(output.markdown).toContain("`example/old`");
    expect(output.markdown).toContain(
      "`example/model (limits.context_tokens: 128000 → 131072; limits.max_output_tokens: 4096 → missing)`",
    );
    expect(output.markdown).toContain("`example-catalog` parse_failed");
    expect(output.markdown).toContain("3 consecutive, 24.0h stale");
    expect(output.markdown).toContain("`/video_capabilities/generate_audio`");
    expect(output.markdown).toContain("Contract reject");
    expect(output.markdown).toContain("1/312 items");
    expect(output.markdown).toContain("`example/video`");
    expect(output.markdown).toContain("1 additional diagnostics omitted");
    expect(output.markdown).toContain("`model_count_drop`");
    expect(output.markdown).toContain("Pricing attempt: `source_schema_changed`");
    expect(output.markdown).toContain("Pricing extraction `example-catalog`: 2 model records");
    expect(output.markdown).toContain(
      "Pricing reconciliation `example-catalog`: source item over 5 reviewed source pricing items",
    );
    expect(output.markdown).toContain("`unbound` / `identity_not_found`; `Example model input`");
    expect(output.markdown).toContain("1 additional unresolved items omitted");
    expect(output.markdown).toContain("2/3 resolved · 1 unknown");
    expect(output.markdown).toContain("Unknown pricing: 1/3 current models");
    expect(output.markdown).toContain("`example/unknown`");
  });

  it("reports accepted extensions without presenting them as publication failures", () => {
    const output = refreshReport({
      generated_at: "2026-08-01T00:00:00.000Z",
      catalog_version: "abcdef0123456789",
      outcome: "evidence_only",
      publication: "complete",
      providers: [
        {
          provider_id: "example",
          status: "fresh",
          publication: "accepted",
          models: { current: 1, added: 0, removed: 0, changed: 0 },
          sources: { changed: 1 },
          pricing: { outcome: "unchanged" },
          signals: ["unreviewed_extension"],
          attempt: {
            outcome: "accepted",
            sources: [
              {
                source_id: "example-catalog",
                outcome: "changed",
                contract_finding: {
                  disposition: "accept_with_signal",
                  observed_items: 1,
                  diagnostic_count: 1,
                  diagnostics: [
                    {
                      fingerprint: "0123456789abcdef",
                      kind: "unknown_field",
                      path: "/future_field",
                      observed: "boolean",
                      observed_value: "true",
                      affected_items: 1,
                    },
                  ],
                },
              },
            ],
          },
        },
      ],
    });

    expect(output.markdown).toContain("complete publication");
    expect(output.markdown).toContain("Contract accept_with_signal");
    expect(output.warnings).toEqual([
      "example/example-catalog: accept_with_signal unknown_field at /future_field (1/1 items; 0123456789abcdef)",
    ]);
  });
});
