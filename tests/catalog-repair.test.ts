import { describe, expect, it } from "vite-plus/test";
import { parseRepairOutcome } from "../scripts/catalog-repair-publication.ts";
import {
  catalogRepairCandidates,
  catalogRepairBatch,
  catalogRepairEvidenceIncomplete,
  catalogRepairEvidenceCommands,
  scheduledCatalogReview,
} from "../src/catalog/catalog-repair.ts";
import { manifests } from "../src/catalog/manifests.ts";

const assertCatalogRepairOutcome = (output: string) => parseRepairOutcome(output).type;

it("bounds provider repair admission without dropping candidates or delaying the periodic slot", () => {
  const candidates = manifests.flatMap(({ provider }) =>
    ["source_parse_failure", "pricing_validation"].map((trigger) => ({
      provider_id: provider.id,
      scope: "provider" as const,
      subject_id: trigger,
      trigger:
        trigger === "source_parse_failure"
          ? ("source_parse_failure" as const)
          : ("pricing_validation" as const),
      message: "Observed failure",
      diagnostics: [],
    })),
  );
  const firstDay = Date.parse("2026-10-20T00:00:00Z");
  const reviewed = new Set<string>();
  for (let offset = 0; offset < manifests.length; offset++) {
    const at = new Date(firstDay + offset * 86_400_000);
    const periodic = scheduledCatalogReview(at);
    const input = [...candidates, periodic];
    const batch = catalogRepairBatch(input, at);
    expect(batch.selected).toContain(periodic);
    const active = batch.selected.filter((candidate) => candidate !== periodic);
    expect(active).toHaveLength(2);
    expect(new Set(active.map(({ provider_id }) => provider_id)).size).toBe(1);
    active.forEach(({ provider_id }) => reviewed.add(provider_id));
    expect([...batch.selected, ...batch.deferred]).toHaveLength(input.length);
    expect(new Set([...batch.selected, ...batch.deferred])).toEqual(new Set(input));
    expect(catalogRepairBatch(input, new Date(at.getTime() + 86_399_999))).toEqual(batch);
    expect(
      catalogRepairBatch(input.toReversed(), at)
        .selected.filter((candidate) => candidate !== periodic)
        .map(({ provider_id }) => provider_id),
    ).toEqual(active.map(({ provider_id }) => provider_id));
  }
  expect([...reviewed].sort()).toEqual(manifests.map(({ provider }) => provider.id).sort());
  expect(catalogRepairBatch([], new Date(firstDay))).toEqual({ selected: [], deferred: [] });
  expect(() => catalogRepairBatch(candidates, new Date("invalid"))).toThrow("valid date");
});

it("fails incomplete repair outputs even when the agent exits successfully", () => {
  for (const type of ["missing_data", "missing_tool", "report_incomplete"])
    expect(() =>
      assertCatalogRepairOutcome(JSON.stringify({ type, reason: "Missing evidence" })),
    ).toThrow("Catalog repair incomplete");
  for (const output of [
    "",
    "{}",
    JSON.stringify({ type: "noop" }),
    JSON.stringify({ type: "commit_repair", title: "Repair" }),
  ])
    expect(() => assertCatalogRepairOutcome(output)).toThrow();
  const noop = JSON.stringify({ type: "noop", message: "All candidates independently resolved" });
  expect(assertCatalogRepairOutcome(noop)).toBe("noop");
  expect(
    assertCatalogRepairOutcome(
      JSON.stringify({
        type: "commit_repair",
        title: "Repair",
        body: "Reproduced and validated",
      }),
    ),
  ).toBe("commit_repair");
  expect(() => assertCatalogRepairOutcome(`${noop}\n${noop}`)).toThrow("exactly one");
  expect(() =>
    assertCatalogRepairOutcome(`${noop}\n${JSON.stringify({ type: "missing_data" })}`),
  ).toThrow("incomplete");
});

it("rejects issue creation and other side effects even alongside a completed repair", () => {
  const repair = JSON.stringify({
    type: "commit_repair",
    title: "Fix the parser",
    body: "Reproduced with a reviewed fixture",
  });
  for (const type of [
    "create_issue",
    "create_pull_request",
    "add_comment",
    "update_issue",
    "unknown",
  ]) {
    const unsupported = JSON.stringify({ type, title: "Follow up", body: "Investigate later" });
    expect(() => assertCatalogRepairOutcome(unsupported)).toThrow(`cannot emit ${type}`);
    expect(() => assertCatalogRepairOutcome(`${repair}\n${unsupported}`)).toThrow(
      `cannot emit ${type}`,
    );
  }
  expect(() =>
    assertCatalogRepairOutcome(
      `${repair}\n${JSON.stringify({ type: "noop", message: "Nothing left to do" })}`,
    ),
  ).toThrow("exactly one");
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

it("reviews every provider and global consistency once in each daily cycle without error signals", () => {
  const firstDay = Date.parse("2026-10-19T00:00:00Z");
  const cycle = Array.from({ length: manifests.length + 1 }, (_, index) =>
    scheduledCatalogReview(new Date(firstDay + index * 86_400_000)),
  );
  expect(
    cycle
      .filter(({ trigger }) => trigger === "scheduled_provider_review")
      .map(({ provider_id }) => provider_id)
      .sort(),
  ).toEqual(manifests.map(({ provider }) => provider.id).sort());
  expect(cycle.filter(({ trigger }) => trigger === "scheduled_architecture_review")).toHaveLength(
    1,
  );
  expect(scheduledCatalogReview(new Date(firstDay + 86_399_999))).toEqual(cycle[0]);
  expect(scheduledCatalogReview(new Date(firstDay + cycle.length * 86_400_000))).toEqual(cycle[0]);
  expect(() => scheduledCatalogReview(new Date("invalid"))).toThrow("valid date");
  const openai = cycle.find(({ provider_id }) => provider_id === "openai");
  if (openai === undefined) throw new Error("Missing OpenAI review");
  const commands = catalogRepairEvidenceCommands([openai]);
  expect(commands).toContain("vp node scripts/fetch-catalog-evidence.ts openai-models");
  expect(commands).not.toContain("vp node scripts/fetch-catalog-evidence.ts openai-api");
});

it.each(["fetch_failed", "skipped_not_configured"])(
  "keeps unchanged successful-source validation failures reviewable despite an unrelated %s source",
  (outcome) => {
    const input = report([
      provider({
        attempt: {
          outcome: "rejected",
          sources: [
            { source_id: "openai-models", outcome: "unchanged", content_changed: false },
            { source_id: "openai-api", outcome },
          ],
          validation_issue: { code: "model_count_drop", message: "Model count dropped" },
        },
      }),
    ]);
    expect(catalogRepairCandidates(input)).toMatchObject([
      { provider_id: "openai", scope: "provider", trigger: "provider_validation" },
    ]);
    expect(catalogRepairEvidenceIncomplete(input)).toBe(outcome === "fetch_failed");
  },
);

it("prepares exact reviewed source commands instead of provider IDs", () => {
  const candidates = catalogRepairCandidates(
    report([
      {
        provider_id: "amazon-bedrock",
        signals: [],
        attempt: {
          outcome: "accepted",
          sources: [{ source_id: "bedrock-models", outcome: "parse_failed" }],
        },
      },
    ]),
  );
  expect(catalogRepairEvidenceCommands([...candidates, ...candidates])).toEqual([
    "vp node scripts/fetch-catalog-evidence.ts bedrock-models",
  ]);
  expect(
    catalogRepairEvidenceCommands(
      candidates.map((candidate) => ({ ...candidate, source_id: "mistral-api" })),
    ),
  ).toEqual([]);
});

it.each([
  {
    outcome: "parse_failed",
    status: undefined,
    failures: 1,
    trigger: "source_parse_failure",
    incomplete: false,
  },
  { outcome: "fetch_failed", status: 404, failures: 1, trigger: undefined, incomplete: true },
  {
    outcome: "fetch_failed",
    status: 404,
    failures: 2,
    trigger: "source_location_change",
    incomplete: true,
  },
  { outcome: "fetch_failed", status: 503, failures: 3, trigger: undefined, incomplete: true },
])(
  "investigates dependency contracts and persistent relocation without turning transport failure into parser repair: $outcome/$status/$failures",
  ({ outcome, status, failures, trigger, incomplete }) => {
    const input = report([
      provider({
        attempt: {
          outcome: "accepted",
          sources: [
            {
              source_id: "openai-models",
              outcome: "unchanged",
              content_changed: false,
              dependency_failures: [
                {
                  dependency_id: "openai-models/companion",
                  impact: "claim",
                  outcome,
                  message: "Companion unavailable or changed",
                  consecutive_failures: failures,
                  ...(status === undefined ? {} : { http_status: status }),
                },
              ],
            },
          ],
        },
      }),
    ]);
    const candidates = catalogRepairCandidates(input);
    if (trigger === undefined) expect(candidates).toEqual([]);
    else {
      expect(candidates).toEqual([
        expect.objectContaining({ source_id: "openai-models", trigger }),
      ]);
      expect(candidates[0]?.message).toContain("openai-models/companion");
    }
    expect(catalogRepairEvidenceIncomplete(input)).toBe(incomplete);
  },
);

it("keeps native HTTP status authoritative over legacy message matching", () => {
  const input = report([
    provider({
      attempt: {
        outcome: "accepted",
        sources: [
          {
            source_id: "openai-models",
            outcome: "fetch_failed",
            http_status: 503,
            message: "HTTP 404",
            consecutive_failures: 3,
          },
        ],
      },
    }),
  ]);
  expect(catalogRepairCandidates(input)).toEqual([]);
});

it.each([
  {
    provider_id: "amazon-bedrock",
    source_id: "bedrock-models",
    reason: "optional_catalog_source_drifted",
    sample: "Bedrock Mantle: Bedrock Mantle guide omitted its region table",
  },
  {
    provider_id: "mistral",
    source_id: "mistral-pricing",
    reason: "public_price_shape_unsupported",
    sample: "Mistral Large 4: Input",
  },
  {
    provider_id: "mistral",
    source_id: "mistral-pricing",
    reason: "public_price_label_unsupported",
    sample: "mistral-ocr-4-1: Cached input (/1000 pages)",
  },
  ...[
    "model_card_input_price_drift",
    "model_card_output_price_drift",
    "cache_pricing_policy_drift",
    "public_price_claim_drift",
  ].map((reason) => ({
    provider_id: "cerebras",
    source_id: reason === "public_price_claim_drift" ? "cerebras-models" : "cerebras-catalog",
    reason,
    sample: "gpt-oss-120b: consumed pricing claim unavailable",
  })),
])(
  "exposes $reason for independent repair even when source bytes and fallback are unchanged",
  ({ provider_id, source_id, reason, sample }) => {
    const candidates = catalogRepairCandidates(
      report([
        provider({
          provider_id,
          attempt: {
            outcome: "accepted",
            pricing: {
              outcome: "failed",
              failure_code: "pricing_validation_failed",
              message: "Service topology retained",
            },
            sources: [
              {
                source_id,
                outcome: "unchanged",
                pricing_reconciliation: {
                  reason_counts: { [reason]: 1 },
                  diagnostics: [{ reason_code: reason, sample }],
                },
              },
            ],
          },
        }),
      ]),
    );
    expect(candidates).toContainEqual(
      expect.objectContaining({
        source_id,
        trigger: "source_pricing_structure",
        message: expect.stringContaining(sample),
      }),
    );
    expect(candidates).toContainEqual(expect.objectContaining({ trigger: "pricing_validation" }));
  },
);

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
    expect(catalogRepairEvidenceIncomplete(input, new Set(["openai"]))).toBe(true);
    expect(catalogRepairEvidenceIncomplete(input, new Set(["xai"]))).toBe(false);
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
    for (const reason of [
      "open_model_pricing_rejected",
      "partner_model_pricing_rejected",
      "pricing_policy_unavailable",
      "pricing_context_scope_unresolved",
      "pricing_location_scope_unresolved",
      "pricing_model_scope_unresolved",
      "served_tier_contract_unavailable",
      "model_card_price_scope_unresolved",
      "model_card_price_cell_unreadable",
      "model_card_service_tier_scope_unresolved",
    ])
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

  it.each([
    ["unchanged", false],
    ["changed", true],
  ] as const)("reviews consumed contract drift on %s bytes", (outcome, contentChanged) => {
    const source = {
      source_id: "openai-models",
      outcome,
      content_changed: contentChanged,
      contract_findings: [
        {
          disposition: "accept_with_signal",
          diagnostics: [
            { kind: "missing_required_field", path: "/usage/input_tokens", affected_items: 1 },
          ],
        },
      ],
    };
    const candidates = catalogRepairCandidates(
      report([
        provider({
          attempt: { outcome: "accepted", sources: [source] },
        }),
      ]),
    );
    expect(candidates).toEqual([
      expect.objectContaining({
        trigger: "source_contract_change",
        source_id: "openai-models",
        diagnostics: source.contract_findings[0]?.diagnostics,
      }),
    ]);
    expect(
      catalogRepairCandidates(
        report([
          provider({
            attempt: {
              outcome: "accepted",
              sources: [
                {
                  ...source,
                  contract_findings: [
                    {
                      disposition: "accept_with_signal",
                      diagnostics: [
                        { kind: "unknown_field", path: "/future_field", affected_items: 1 },
                      ],
                    },
                  ],
                },
              ],
            },
          }),
        ]),
      ),
    ).toEqual([]);
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

  it("does not overwrite a source pricing finding when provider validation also rejects", () => {
    const candidates = catalogRepairCandidates(
      report([
        provider({
          attempt: {
            outcome: "rejected",
            sources: [
              {
                source_id: "openai-pricing",
                outcome: "changed",
                content_changed: true,
                pricing_reconciliation: {
                  reason_counts: { public_price_shape_unsupported: 1 },
                  diagnostics: [
                    {
                      reason_code: "public_price_shape_unsupported",
                      sample: "Unreadable reviewed sale cell",
                    },
                  ],
                },
              },
            ],
            validation_issue: { code: "model_count_drop", message: "Model count dropped" },
          },
        }),
      ]),
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ trigger: "source_pricing_structure" });
    expect(candidates[0]?.message).toContain("Unreadable reviewed sale cell");
    expect(candidates[0]?.message).toContain("Provider validation: model_count_drop");
  });

  it("does not dismiss truncated contract evidence as a persistent harmless extension", () => {
    for (const extra of [{ contract_findings_omitted: 1 }, {}]) {
      const candidates = catalogRepairCandidates(
        report([
          provider({
            attempt: {
              outcome: "accepted",
              sources: [
                {
                  source_id: "openai-models",
                  outcome: "unchanged",
                  contract_findings: [
                    {
                      disposition: "accept_with_signal",
                      diagnostic_count: 2,
                      diagnostics: [{ kind: "unknown_field", path: "/future", affected_items: 1 }],
                    },
                  ],
                  ...extra,
                },
              ],
            },
          }),
        ]),
      );
      expect(candidates[0]?.trigger).toBe("source_contract_change");
    }
  });

  it("keeps an unused changed extension informational while admitting an authenticated parser failure", () => {
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
          provider({
            provider_id: "mistral",
            attempt: {
              outcome: "accepted",
              sources: [
                {
                  source_id: "mistral-pricing",
                  outcome: "unchanged",
                  pricing_reconciliation: {
                    reason_counts: { public_model_price_without_rate: 1 },
                    diagnostics: [
                      { reason_code: "public_model_price_without_rate", sample: "unpriced-model" },
                    ],
                  },
                },
              ],
            },
          }),
        ]),
      ),
    ).toEqual([]);
  });
});
