import { describe, expect, it } from "vite-plus/test";
import {
  assertCatalogRepairOutcome,
  catalogRepairCandidates,
  catalogRepairEvidenceIncomplete,
} from "../src/catalog/catalog-repair.ts";

it("fails incomplete repair outputs even when the agent exits successfully", () => {
  for (const type of ["missing_data", "missing_tool", "report_incomplete"])
    expect(() =>
      assertCatalogRepairOutcome(JSON.stringify({ type, reason: "Missing evidence" })),
    ).toThrow("Catalog repair incomplete");
  for (const output of [
    "",
    "{}",
    JSON.stringify({ type: "noop" }),
    JSON.stringify({ type: "create_pull_request", title: "Repair" }),
  ])
    expect(() => assertCatalogRepairOutcome(output)).toThrow();
  const noop = JSON.stringify({ type: "noop", message: "All candidates independently resolved" });
  expect(() => assertCatalogRepairOutcome(noop)).not.toThrow();
  expect(() =>
    assertCatalogRepairOutcome(
      JSON.stringify({
        type: "create_pull_request",
        title: "Repair",
        body: "Reproduced and validated",
      }),
    ),
  ).not.toThrow();
  expect(() => assertCatalogRepairOutcome(`${noop}\n${noop}`)).toThrow("exactly one");
  expect(() =>
    assertCatalogRepairOutcome(`${noop}\n${JSON.stringify({ type: "missing_data" })}`),
  ).toThrow("incomplete");
});

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
  it("reviews repeated public 404/410 failures for relocation without escalating transient transport", () => {
    const input = (message: string, failures: number) =>
      report([
        provider({
          attempt: {
            outcome: "rejected",
            sources: [
              {
                source_id: "openai-models",
                outcome: "fetch_failed",
                message,
                consecutive_failures: failures,
              },
            ],
          },
        }),
      ]);
    expect(catalogRepairCandidates(input("HTTP 404", 1))).toEqual([]);
    expect(catalogRepairCandidates(input("HTTP 404", 2))).toEqual([
      expect.objectContaining({ trigger: "source_location_change" }),
    ]);
    expect(catalogRepairCandidates(input("HTTP 410", 3))).toHaveLength(1);
    expect(catalogRepairCandidates(input("HTTP 503", 5))).toEqual([]);
    expect(catalogRepairCandidates(input("TLS handshake timeout", 5))).toEqual([]);
  });
  it("keeps unavailable evidence incomplete without asking an agent to repair a transport failure", () => {
    const input = report([
      provider({
        attempt: {
          outcome: "accepted",
          sources: [{ source_id: "openai-pricing", outcome: "fetch_failed", message: "HTTP 503" }],
        },
      }),
    ]);
    expect(catalogRepairCandidates(input)).toEqual([]);
    expect(catalogRepairEvidenceIncomplete(input)).toBe(true);
    expect(
      catalogRepairEvidenceIncomplete(
        report([
          provider({
            attempt: {
              outcome: "accepted",
              sources: [],
              pricing: { outcome: "failed", failure_code: "source_unavailable" },
            },
          }),
        ]),
      ),
    ).toBe(true);
    expect(
      catalogRepairEvidenceIncomplete(
        report([
          provider({
            attempt: {
              outcome: "accepted",
              sources: [{ source_id: "openai-api", outcome: "skipped_not_configured" }],
            },
          }),
        ]),
      ),
    ).toBe(false);
  });
  it("admits missing owned accounting contracts even when accepted source bytes are unchanged", () => {
    const candidates = catalogRepairCandidates(
      report([
        provider({
          provider_id: "gemini",
          attempt: {
            outcome: "accepted",
            sources: [
              {
                source_id: "gemini-pricing",
                outcome: "unchanged",
                content_changed: false,
                pricing_reconciliation: {
                  reason_counts: { pricing_input_contract_partial: 2, pricing_unknown_meter: 7 },
                  diagnostics: [
                    {
                      reason_code: "pricing_input_contract_partial",
                      sample: "21 Interactions mappings unavailable",
                    },
                    {
                      reason_code: "pricing_input_contract_partial",
                      sample: "3 video mappings unavailable",
                    },
                  ],
                },
              },
            ],
          },
        }),
      ]),
    );
    expect(candidates).toEqual([
      expect.objectContaining({
        source_id: "gemini-pricing",
        trigger: "source_pricing_structure",
        message: expect.stringContaining(
          "21 Interactions mappings unavailable; 3 video mappings unavailable",
        ),
      }),
    ]);
    expect(candidates[0]?.message).not.toContain("pricing_unknown_meter");
  });
  it("admits known unrecognized pricing-card structure despite unchanged fallback coverage", () => {
    const input = (reason: string, count: number, outcome = "unchanged") =>
      report([
        provider({
          provider_id: "mistral",
          attempt: {
            outcome: "accepted",
            sources: [
              {
                source_id: "mistral-pricing",
                outcome,
                content_changed: false,
                pricing_reconciliation: { reason_counts: { [reason]: count } },
              },
            ],
          },
        }),
      ]);
    expect(catalogRepairCandidates(input("unknown_public_pricing_card", 20))).toEqual([
      expect.objectContaining({
        source_id: "mistral-pricing",
        trigger: "source_pricing_structure",
      }),
    ]);
    expect(catalogRepairCandidates(input("unreviewed_pricing_tier", 20))).toEqual([]);
    for (const reason of ["open_model_pricing_rejected", "partner_model_pricing_rejected"])
      expect(catalogRepairCandidates(input(reason, 1))).toEqual([
        expect.objectContaining({ trigger: "source_pricing_structure" }),
      ]);
    expect(catalogRepairCandidates(input("unknown_public_pricing_card", 0))).toEqual([]);
    expect(
      catalogRepairCandidates(input("unknown_public_pricing_card", 20, "fetch_failed")),
    ).toEqual([]);
  });
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

  it("preserves pricing validation alongside a missing source contract", () => {
    const candidates = catalogRepairCandidates(
      report([
        provider({
          attempt: {
            outcome: "accepted",
            sources: [
              {
                source_id: "openai-pricing",
                outcome: "unchanged",
                pricing_reconciliation: {
                  reason_counts: { pricing_input_contract_partial: 1 },
                },
              },
            ],
            pricing: {
              outcome: "failed",
              failure_code: "pricing_validation_failed",
              message: "required allowance is missing",
            },
          },
        }),
      ]),
    );
    expect(candidates).toEqual([
      expect.objectContaining({ trigger: "source_pricing_structure" }),
      expect.objectContaining({
        trigger: "pricing_validation",
        message: "required allowance is missing",
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
