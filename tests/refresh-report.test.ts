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
                fields: ["capabilities", "limits"],
                field_changes: [
                  { path: "capabilities.reasoning", previous: false, current: true },
                  {
                    path: "limits.context_tokens",
                    previous: 128_000,
                    current: 131_072,
                  },
                  { path: "limits.max_output_tokens", previous: 4_096 },
                ],
              },
            ],
          },
          sources: { current: 9, added: 2, removed: 1, changed: 3 },
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
            delta: { resolved_models: 1, unknown_models: -1 },
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
    expect(output.markdown).toContain("| + | <code>example/new</code> | — |");
    expect(output.markdown).toContain("| − | <code>example/old</code> | — |");
    expect(output.markdown).toContain(
      "| ~ | <code>example/model</code> | <code>capabilities.reasoning</code>: <code>false</code> → <code>true</code>",
    );
    expect(output.markdown).toContain(
      "<code>limits.context_tokens</code>: <code>128000</code> → <code>131072</code>",
    );
    expect(output.markdown).toContain(
      "<code>limits.max_output_tokens</code>: <code>4096</code> → <em>missing</em>",
    );
    expect(output.markdown).toContain(
      "| example | ⚠️ retained | 1 | +1 · −1 · ~1 | 9 | +2 · −1 · ~3 | 0 | 2/3 · 1 unknown | resolved +1 · unknown −1 |",
    );
    expect(output.markdown).toContain("<summary>Legend</summary>");
    expect(output.markdown).toContain("Model `~`: the same model identity remains");
    expect(output.markdown).toContain("Source `~`: the same accepted source record remains");
    expect(output.markdown).toContain("#### Publication");
    expect(output.markdown).toContain(
      "⚠️ `retained`: the provider update could not be published as a complete validated pair",
    );
    expect(output.markdown).toContain("#### Pricing");
    expect(output.markdown).toContain("💰 `terms changed`: canonical commercial terms changed");
    expect(output.markdown).toContain("#### Signals");
    expect(output.markdown).toContain(
      "`persistent_source_failure`: at least one source has failed",
    );
    expect(output.markdown).toContain("3 consecutive · 24.0h stale");
    expect(output.markdown).toContain("#### Details");
    expect(output.markdown).toContain("| Type | Source | Value |");
    expect(output.markdown).toContain(
      "| Source | `example-catalog` | `parse_failed` · 3 consecutive · 24.0h stale |",
    );
    expect(output.markdown).toContain("`/video_capabilities/generate_audio`");
    expect(output.markdown).toContain(
      "| Contract | `example-catalog` | `reject` · `missing_required_field`",
    );
    expect(output.markdown).toContain("1/312 · expected boolean · observed missing");
    expect(output.markdown).toContain("`example/video`");
    expect(output.markdown).toContain("`reject` · +1 diagnostics omitted");
    expect(output.markdown).toContain("`model_count_drop`");
    expect(output.markdown).toContain("| Pricing | — | `source_schema_changed` |");
    expect(output.markdown).toContain(
      "| Extract | `example-catalog` | 2 models · 1 numeric · ?1 · facts 4/0 |",
    );
    expect(output.markdown).toContain(
      "| Reconcile | `example-catalog` | `source_item` · 5 items · 2 normalized · 1 excluded · ?2 |",
    );
    expect(output.markdown).toContain(
      "| Finding | `example-catalog` | `unbound` · `identity_not_found` |",
    );
    expect(output.markdown).toContain("| Finding | `example-catalog` | +1 omitted |");
    expect(output.markdown).toContain("2/3 · 1 unknown");
    expect(output.markdown).toContain("| Pricing coverage | — | 2/3 resolved · 1 unknown |");
    expect(output.markdown).toContain("<summary>Unknown pricing examples (1/3)</summary>");
    expect(output.markdown).toContain(
      "<summary>Pricing finding samples — <code>example-catalog</code> (1)</summary>",
    );
    expect(output.markdown).toContain("<code>Example model input</code>");
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
          pricing: { outcome: "provenance_only" },
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
    expect(output.markdown).toContain(
      "| example | ✅ accepted | 1 | — | — | ~1 | 🧾 evidence changed | — | — |",
    );
    expect(output.markdown).toContain(
      "🧾 `evidence changed`: commercial terms stayed the same; only provenance",
    );
    expect(output.markdown).toContain(
      "| Contract | `example-catalog` | `accept_with_signal` · `unknown_field`",
    );
    expect(output.warnings).toEqual([
      "example/example-catalog: accept_with_signal unknown_field at /future_field (1/1 items; 0123456789abcdef)",
    ]);
  });

  it("renders the immediately preceding limit-change shape", () => {
    const output = refreshReport({
      generated_at: "2026-08-01T00:00:00.000Z",
      catalog_version: "abcdef0123456789",
      providers: [
        {
          provider_id: "example",
          status: "fresh",
          models: {
            current: 1,
            added: 0,
            removed: 0,
            changed: 1,
            changed_models: [
              {
                model_ref: "example/model",
                fields: ["limits"],
                limit_changes: [{ field: "context_tokens", previous: 128_000, current: 131_072 }],
              },
            ],
          },
          sources: { changed: 0 },
          pricing: { outcome: "unchanged" },
        },
      ],
    });

    expect(output.markdown).toContain(
      "<code>limits.context_tokens</code>: <code>128000</code> → <code>131072</code>",
    );
  });

  it("groups every exact model field change beneath its provider", () => {
    const output = refreshReport({
      generated_at: "2026-08-01T00:00:00.000Z",
      catalog_version: "abcdef0123456789",
      providers: [
        {
          provider_id: "alpha",
          status: "fresh",
          models: {
            current: 1,
            added: 0,
            removed: 0,
            changed: 1,
            changed_models: [
              {
                model_ref: "alpha/model-a",
                fields: ["status"],
                field_changes: [{ path: "status", previous: "preview", current: "active" }],
              },
            ],
          },
          sources: { changed: 0 },
          pricing: { outcome: "unchanged" },
        },
        {
          provider_id: "beta",
          status: "fresh",
          models: {
            current: 1,
            added: 0,
            removed: 0,
            changed: 1,
            changed_models: [
              {
                model_ref: "beta/model-b",
                fields: ["limits"],
                field_changes: [
                  { path: "limits.context_tokens", previous: 8_192, current: 16_384 },
                ],
              },
            ],
          },
          sources: { changed: 0 },
          pricing: { outcome: "unchanged" },
        },
      ],
    });

    expect(output.markdown).toContain("### alpha\n\n#### Model changes\n\n| Δ | Model | Details |");
    expect(output.markdown).toContain(
      '| ~ | <code>alpha/model-a</code> | <code>status</code>: <code>"preview"</code> → <code>"active"</code> |',
    );
    expect(output.markdown).toContain("### beta\n\n#### Model changes\n\n| Δ | Model | Details |");
    expect(output.markdown).toContain(
      "| ~ | <code>beta/model-b</code> | <code>limits.context_tokens</code>: <code>8192</code> → <code>16384</code> |",
    );
  });
});
