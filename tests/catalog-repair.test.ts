import { describe, expect, it } from "vite-plus/test";
import { catalogRepairCandidates } from "../src/catalog/catalog-repair.ts";

const provider = (overrides: Record<string, unknown>): Record<string, unknown> => ({
  provider_id: "openai",
  signals: [],
  ...overrides,
});

const report = (providers: Record<string, unknown>[]): Record<string, unknown> => ({
  schema_version: 2,
  generated_at: "2026-09-02T00:00:00.000Z",
  providers,
});

describe("catalog repair candidate selection", () => {
  it("selects a parser contract failure from any reviewed source", () => {
    expect(
      catalogRepairCandidates(
        report([
          provider({
            signals: ["breaking_contract_mismatch"],
            attempt: {
              outcome: "rejected",
              sources: [
                {
                  source_id: "openai-models",
                  outcome: "parse_failed",
                  message: "model table changed shape",
                  contract_finding: {
                    disposition: "reject",
                    diagnostics: [
                      {
                        kind: "missing_required_field",
                        path: "/models/*/id",
                        expected: "string",
                        observed: "missing",
                        affected_items: 1,
                      },
                    ],
                  },
                },
              ],
            },
          }),
        ]),
      ),
    ).toEqual([
      expect.objectContaining({
        provider_id: "openai",
        source_id: "openai-models",
        source_access: "public",
        trigger: "source_parse_failure",
        message: "model table changed shape",
      }),
    ]);
  });

  it("lets the agent inspect every changed source around a rejected validation", () => {
    expect(
      catalogRepairCandidates(
        report([
          provider({
            signals: ["drift_guard_triggered", "coverage_regression"],
            attempt: {
              outcome: "rejected",
              sources: [
                {
                  source_id: "openai-pricing",
                  outcome: "changed",
                  content_changed: true,
                },
              ],
              validation_issue: {
                code: "model_count_drop",
                message: "model count dropped by more than 10%",
              },
            },
          }),
        ]),
      ),
    ).toEqual([
      expect.objectContaining({
        source_id: "openai-pricing",
        trigger: "provider_validation",
        message: "model_count_drop: model count dropped by more than 10%",
      }),
    ]);
  });

  it("selects a changed contract extension and an authenticated parser failure", () => {
    expect(
      catalogRepairCandidates(
        report([
          provider({
            signals: ["unreviewed_extension"],
            attempt: {
              outcome: "accepted",
              sources: [
                {
                  source_id: "openai-models",
                  outcome: "changed",
                  content_changed: true,
                  contract_finding: {
                    disposition: "accept_with_signal",
                    diagnostics: [
                      {
                        kind: "unknown_field",
                        path: "/models/*/future",
                        affected_items: 1,
                      },
                    ],
                  },
                },
                {
                  source_id: "openai-api",
                  outcome: "parse_failed",
                  message: "authenticated response changed shape",
                },
              ],
            },
          }),
        ]),
      ),
    ).toEqual([
      expect.objectContaining({
        source_id: "openai-api",
        source_access: "authenticated",
        trigger: "source_parse_failure",
      }),
      expect.objectContaining({
        source_id: "openai-models",
        trigger: "source_contract_change",
      }),
    ]);
  });

  it("selects a provider validation even when no source changed", () => {
    expect(
      catalogRepairCandidates(
        report([
          provider({
            signals: ["coverage_regression"],
            attempt: {
              outcome: "rejected",
              sources: [{ source_id: "openai-models", outcome: "unchanged" }],
              validation_issue: { code: "api_endpoint_count_drop", message: "endpoints dropped" },
            },
          }),
        ]),
      ),
    ).toEqual([
      expect.objectContaining({
        scope: "provider",
        subject_id: "provider_validation",
        trigger: "provider_validation",
      }),
    ]);
  });

  it("selects a non-operational pricing validation failure", () => {
    expect(
      catalogRepairCandidates(
        report([
          provider({
            attempt: {
              outcome: "accepted",
              sources: [{ source_id: "openai-pricing", outcome: "unchanged" }],
              pricing: {
                outcome: "failed",
                failure_code: "source_schema_changed",
                message: "pricing topology validation failed",
              },
            },
          }),
        ]),
      ),
    ).toEqual([
      expect.objectContaining({
        scope: "provider",
        subject_id: "pricing_validation",
        trigger: "pricing_validation",
        message: "pricing topology validation failed",
      }),
    ]);
  });

  it("excludes transport failures, missing configuration, and unresolved pricing alone", () => {
    expect(
      catalogRepairCandidates(
        report([
          provider({
            signals: ["coverage_regression"],
            pricing_coverage: { unknown_models: 12 },
            attempt: {
              outcome: "rejected",
              sources: [
                { source_id: "openai-models", outcome: "fetch_failed" },
                { source_id: "openai-api", outcome: "skipped_not_configured" },
              ],
              validation_issue: { code: "model_count_drop", message: "model count dropped" },
            },
          }),
        ]),
      ),
    ).toEqual([]);
  });
});
