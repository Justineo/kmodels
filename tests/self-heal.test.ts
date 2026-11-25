import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { z } from "zod";
import { captureRepairSource } from "../src/catalog/catalog-repair-capture.ts";
import { sha256 } from "../src/catalog/io.ts";
import { manifests, type ProviderManifest, type SourceManifest } from "../src/catalog/manifests.ts";
import { baseModel } from "../src/catalog/model.ts";
import { providerModelSchema } from "../src/catalog/schema.ts";
import { createContractFindingCollector, recognizeItems } from "../src/catalog/source-contract.ts";
import { sourceErrorFingerprint } from "../src/catalog/source-failure.ts";
import { readBoundedJson, replayCatalogEvidence } from "../scripts/replay-catalog-evidence.ts";

// Allow local git/bash subprocesses on isolated temporary repositories while keeping network offline.
vi.unmock("node:child_process");
import {
  appendBudgetEntry,
  buildSettledBudgetEntry,
  emptyBudgetLedger,
  evaluateBudget,
  readBudgetLedger,
  type BudgetLimits,
} from "../scripts/self-heal/budget.ts";
import {
  discoverEvidenceFiles,
  selectSelfHealTarget,
  selectUpstreamRefreshArtifacts,
} from "../scripts/self-heal/triage.ts";
import {
  auditDiffSafety,
  classifyChangedPaths,
  evaluateBeforeAfterReplay,
  extractSourceThresholds,
  findCrossProviderImporters,
  needsBrowserPrerequisite,
  runSelfHealGate,
} from "../scripts/self-heal/gate.ts";
import { runGenerate } from "../scripts/self-heal/generate.ts";
import { runVerify } from "../scripts/self-heal/verify.ts";
import { runPublish } from "../scripts/self-heal/publish.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function git(args: readonly string[], cwd: string): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr.trim() || `git ${args[0]} failed`);
  return result.stdout.trim();
}

const strictLimits: BudgetLimits = {
  maxRunUsd: 1.5,
  maxRunTokens: 200_000,
  maxWindowUsd: 5.0,
  maxWindowRuns: 3,
  windowHours: 24,
  providerCooldownHours: 6,
};

function makeRefreshReport(
  providers: Array<{ id: string; sourceId: string; outcome: "unchanged" | "parse_failed" }>,
) {
  // Intentionally omits `schema_version` to match catalog.yml's actual `refresh-report.json`.
  return {
    generated_at: "2026-11-23T00:00:00.000Z",
    catalog_version: "a".repeat(64),
    providers: providers.map(({ id, sourceId, outcome }) => ({
      provider_id: id,
      signals: [],
      attempt: {
        outcome: outcome === "unchanged" ? "accepted" : "rejected",
        sources: [
          {
            source_id: sourceId,
            outcome,
            ...(outcome === "parse_failed" ? { message: `${id} parser drifted` } : {}),
          },
        ],
      },
    })),
  };
}

describe("self-heal triage, compressed evidence discovery & anti-starvation", () => {
  it("discovers and replays real .json.gz captures from captureRepairSource with portable relative paths", async () => {
    const captureDir = await makeTempDir("kmodels-capture-");
    const providerManifests: readonly ProviderManifest[] = manifests;
    const allSources: readonly SourceManifest[] = providerManifests.flatMap((m) => m.sources);
    const publicSource = allSources.find((s) => s.access === "public" && !s.auth);
    expect(publicSource).toBeDefined();

    const prevDir = process.env.KMODELS_REPAIR_CAPTURE_DIRECTORY;
    process.env.KMODELS_REPAIR_CAPTURE_DIRECTORY = captureDir;
    try {
      await captureRepairSource(publicSource!, '{"models":[]}', "2026-11-23T00:00:00.000Z");
    } finally {
      if (prevDir === undefined) delete process.env.KMODELS_REPAIR_CAPTURE_DIRECTORY;
      else process.env.KMODELS_REPAIR_CAPTURE_DIRECTORY = prevDir;
    }

    const discovered = await discoverEvidenceFiles(captureDir);
    expect(discovered).toHaveLength(1);
    expect(discovered[0]?.source_id).toBe(publicSource!.id);
    expect(discovered[0]?.relative_path.endsWith(".json.gz")).toBe(true);
    expect(discovered[0]?.relative_path.startsWith("/")).toBe(false);

    // replay-catalog-evidence's readBoundedJson must read the exact .json.gz capture natively.
    const decoded = await readBoundedJson(join(captureDir, discovered[0]!.relative_path));
    expect(decoded).toMatchObject({
      source_id: publicSource!.id,
      body: '{"models":[]}',
    });
  });

  it("returns idle when no provider has actionable drift or quarantine", () => {
    const result = selectSelfHealTarget(
      makeRefreshReport([{ id: "openai", sourceId: "openai-models", outcome: "unchanged" }]),
      [],
    );
    expect(result).toEqual({
      status: "idle",
      idle_reason: "no_candidates",
      total_candidates: 0,
      skipped_providers: [],
    });
  });

  it("advances past persistently failing providers that have an open PR or active cooldown", () => {
    const nowMs = Date.parse("2026-11-23T12:00:00.000Z");
    const report = makeRefreshReport([
      { id: "anthropic", sourceId: "anthropic-models", outcome: "parse_failed" },
      { id: "cohere", sourceId: "cohere-models", outcome: "parse_failed" },
      { id: "openai", sourceId: "openai-models", outcome: "unchanged" },
    ]);
    const quarantine = [
      {
        provider_id: "fireworks",
        checked_at: "2026-11-23T00:00:00.000Z",
        reason: "Persistent drift 1",
      },
    ];

    const ledger = appendBudgetEntry(
      emptyBudgetLedger(),
      buildSettledBudgetEntry({
        run_id: "run-1",
        provider_id: "anthropic",
        recorded_at: "2026-11-23T10:00:00.000Z",
        usage: { usage_known: false, input_tokens: null, output_tokens: null, estimated_usd: null },
        outcome: "generate_failed",
        limits: strictLimits,
      }),
      { nowMs },
    );

    const result = selectSelfHealTarget(report, quarantine, {
      nowMs,
      openPrProviders: new Set(["fireworks"]),
      budgetLedger: ledger,
      budgetLimits: strictLimits,
      triggerRunId: "999",
      triggerRunAttempt: 2,
    });

    expect(result.status).toBe("actionable");
    expect(result.target?.provider_id).toBe("cohere");
    expect(result.target?.trigger_run_id).toBe("999");
    expect(result.target?.trigger_run_attempt).toBe(2);
    expect(result.skipped_providers).toEqual([
      { provider_id: "fireworks", reason: "open_pr" },
      expect.objectContaining({ provider_id: "anthropic", reason: "cooldown" }),
    ]);
  });

  it("reserves conservative maxRunUsd for unknown usage and blocks when rolling cap would be exceeded", () => {
    const nowMs = Date.parse("2026-11-23T12:00:00.000Z");
    const settledUnknown = buildSettledBudgetEntry({
      run_id: "run-unknown",
      provider_id: "fireworks",
      recorded_at: "2026-11-23T11:00:00.000Z",
      usage: { usage_known: false, input_tokens: null, output_tokens: null, estimated_usd: null },
      outcome: "generate_failed",
      limits: strictLimits,
    });
    expect(settledUnknown.usage_known).toBe(false);
    expect(settledUnknown.estimated_usd).toBe(strictLimits.maxRunUsd);

    let ledger = emptyBudgetLedger();
    for (let i = 1; i <= 3; i += 1) {
      ledger = appendBudgetEntry(
        ledger,
        buildSettledBudgetEntry({
          run_id: `run-${i}`,
          provider_id: `provider-${i}`,
          recorded_at: `2026-11-23T0${i}:00:00.000Z`,
          usage: {
            usage_known: true,
            input_tokens: 20_000,
            output_tokens: 5_000,
            estimated_usd: 1.4,
          },
          outcome: "auto_push",
          limits: strictLimits,
        }),
        { nowMs },
      );
    }

    // Rolling spend is $4.20; reserving maxRunUsd ($1.50) would exceed $5.00 cap!
    const preReserve = evaluateBudget(ledger, { nowMs, limits: strictLimits, reserveRun: true });
    expect(preReserve.allowed).toBe(false);
    expect(preReserve.reasons.some((r) => r.includes("spend"))).toBe(true);

    // Unknown usage with a known spend floor above maxRunUsd MUST settle the higher known floor (never under-report $3 as $2).
    const floorLimits: BudgetLimits = { ...strictLimits, maxRunUsd: 2.0, maxWindowUsd: 10.0 };
    const settledHighFloor = buildSettledBudgetEntry({
      run_id: "run-floor",
      provider_id: "openai",
      recorded_at: "2026-11-23T11:30:00.000Z",
      usage: { usage_known: false, input_tokens: 10_000, output_tokens: 5_000, estimated_usd: 3.0 },
      outcome: "budget_rejected",
      limits: floorLimits,
    });
    expect(settledHighFloor.usage_known).toBe(false);
    expect(settledHighFloor.estimated_usd).toBe(3.0);
    const postCheck = evaluateBudget(emptyBudgetLedger(), {
      nowMs,
      limits: floorLimits,
      runUsage: {
        usage_known: false,
        input_tokens: 10_000,
        output_tokens: 5_000,
        estimated_usd: 3.0,
      },
    });
    expect(postCheck.allowed).toBe(false);
    expect(postCheck.reasons.some((r) => r.includes("per-run cap"))).toBe(true);
  });

  it("scopes provider-level evidence strictly to sources owned by the selected provider and skips missing source evidence when required", () => {
    const sharedPool = [
      {
        source_id: "vercel-models",
        relative_path: "vercel-models.json.gz",
        source_hash: "a".repeat(64),
        sha256: "b".repeat(64),
      },
      {
        source_id: "openai-pricing",
        relative_path: "openai-pricing.json.gz",
        source_hash: "c".repeat(64),
        sha256: "d".repeat(64),
        context_relative_path: "openai-pricing.context.json.gz",
        context_sha256: "e".repeat(64),
        context_kind: "catalog_models" as const,
      },
    ];

    // Provider-level quarantine with NO source_id must NEVER attach unrelated source evidence (neither vercel-models nor openai-pricing).
    const openaiQuarantineNoSource = selectSelfHealTarget(
      makeRefreshReport([]),
      [
        {
          provider_id: "openai",
          checked_at: "2026-11-23T00:00:00.000Z",
          reason: "Quarantined validation mismatch",
        },
      ],
      { evidenceFiles: sharedPool },
    );
    expect(openaiQuarantineNoSource.status).toBe("actionable");
    expect(openaiQuarantineNoSource.target?.provider_id).toBe("openai");
    expect(openaiQuarantineNoSource.target?.evidence_files).toEqual([]);

    // Under requireSourceEvidence=true, provider-level assembly/quarantine failure with unrelated same-provider evidence MUST be rejected.
    const providerValidationWithUnrelatedEvidence = selectSelfHealTarget(
      makeRefreshReport([]),
      [
        {
          provider_id: "openai",
          checked_at: "2026-11-23T00:00:00.000Z",
          reason: "Provider assembly mismatch",
        },
      ],
      { evidenceFiles: sharedPool, requireSourceEvidence: true },
    );
    expect(providerValidationWithUnrelatedEvidence.status).toBe("idle");
    expect(providerValidationWithUnrelatedEvidence.idle_reason).toBe("missing_evidence");

    // Source-level target binds ONLY its own matching source evidence (never another provider's).
    const openaiPricingOnly = selectSelfHealTarget(
      makeRefreshReport([{ id: "openai", sourceId: "openai-pricing", outcome: "parse_failed" }]),
      [],
      { evidenceFiles: sharedPool, requireSourceEvidence: true },
    );
    expect(openaiPricingOnly.status).toBe("actionable");
    expect(openaiPricingOnly.target?.evidence_files.map((e) => e.source_id)).toEqual([
      "openai-pricing",
    ]);

    // Context-dependent pricing sources (openai-pricing, azure-retail-prices) MUST be rejected when required context is missing or incomplete.
    const openaiPricingNoContext = selectSelfHealTarget(
      makeRefreshReport([{ id: "openai", sourceId: "openai-pricing", outcome: "parse_failed" }]),
      [],
      {
        evidenceFiles: [
          {
            source_id: "openai-pricing",
            relative_path: "openai-pricing.json.gz",
            source_hash: "c".repeat(64),
            sha256: "d".repeat(64),
          },
        ],
        requireSourceEvidence: true,
      },
    );
    expect(openaiPricingNoContext.status).toBe("idle");
    expect(openaiPricingNoContext.idle_reason).toBe("missing_evidence");

    const azureRetailPlainContext = selectSelfHealTarget(
      makeRefreshReport([
        { id: "azure", sourceId: "azure-retail-prices", outcome: "parse_failed" },
      ]),
      [],
      {
        evidenceFiles: [
          {
            source_id: "azure-retail-prices",
            relative_path: "azure-retail-prices.json.gz",
            source_hash: "c".repeat(64),
            sha256: "d".repeat(64),
            context_relative_path: "azure-retail-prices.context.json.gz",
            context_sha256: "e".repeat(64),
            context_kind: "catalog_models",
          },
        ],
        requireSourceEvidence: true,
      },
    );
    expect(azureRetailPlainContext.status).toBe("idle");
    expect(azureRetailPlainContext.idle_reason).toBe("missing_evidence");

    const azureRetailFullContext = selectSelfHealTarget(
      makeRefreshReport([
        { id: "azure", sourceId: "azure-retail-prices", outcome: "parse_failed" },
      ]),
      [],
      {
        evidenceFiles: [
          {
            source_id: "azure-retail-prices",
            relative_path: "azure-retail-prices.json.gz",
            source_hash: "c".repeat(64),
            sha256: "d".repeat(64),
            context_relative_path: "azure-retail-prices.context.json.gz",
            context_sha256: "e".repeat(64),
            context_kind: "azure_retail",
          },
        ],
        requireSourceEvidence: true,
      },
    );
    expect(azureRetailFullContext.status).toBe("actionable");

    // Provider validation attached to a changed source (e.g. OpenAI model_count_drop on openai-pricing)
    // and 404 source_location_change MUST be rejected by requireSourceEvidence.
    const modelCountDropReport = {
      generated_at: "2026-11-23T00:00:00.000Z",
      catalog_version: "a".repeat(64),
      providers: [
        {
          provider_id: "openai",
          signals: ["provider_validation"],
          attempt: {
            outcome: "rejected",
            validation_issue: { code: "model_count_drop", message: "Model count dropped" },
            sources: [{ source_id: "openai-pricing", outcome: "changed", content_changed: true }],
          },
        },
      ],
    };
    const modelCountDropTriage = selectSelfHealTarget(modelCountDropReport, [], {
      evidenceFiles: sharedPool,
      requireSourceEvidence: true,
    });
    expect(modelCountDropTriage.status).toBe("idle");
    expect(modelCountDropTriage.idle_reason).toBe("missing_evidence");
    expect(modelCountDropTriage.skipped_providers[0]?.detail).toContain("provider_validation");

    // Same source with BOTH pricing_input_contract_partial AND model_count_drop MUST preserve BOTH triggers and reject single-source replay.
    const mergedDriftAndDropReport = {
      generated_at: "2026-11-23T00:00:00.000Z",
      catalog_version: "a".repeat(64),
      providers: [
        {
          provider_id: "openai",
          signals: ["provider_validation"],
          attempt: {
            outcome: "rejected",
            validation_issue: { code: "model_count_drop", message: "Model count dropped" },
            sources: [
              {
                source_id: "openai-pricing",
                outcome: "changed",
                content_changed: true,
                pricing_reconciliation: {
                  reason_counts: { pricing_input_contract_partial: 1 },
                },
              },
            ],
          },
        },
      ],
    };
    const mergedTriage = selectSelfHealTarget(mergedDriftAndDropReport, [], {
      evidenceFiles: sharedPool,
      requireSourceEvidence: true,
    });
    expect(mergedTriage.status).toBe("idle");
    expect(mergedTriage.idle_reason).toBe("missing_evidence");
    expect(mergedTriage.skipped_providers[0]?.detail).toContain("provider_validation");

    // Quarantined provider that ALSO has a source-level failure MUST keep its quarantine obligation.
    const quarantinedWithSourceFail = selectSelfHealTarget(
      makeRefreshReport([{ id: "openai", sourceId: "openai-pricing", outcome: "parse_failed" }]),
      [
        {
          provider_id: "openai",
          checked_at: "2026-11-23T00:00:00.000Z",
          reason: "Quarantined validation mismatch",
        },
      ],
      { evidenceFiles: sharedPool, requireSourceEvidence: true },
    );
    expect(quarantinedWithSourceFail.status).toBe("idle");
    expect(quarantinedWithSourceFail.idle_reason).toBe("missing_evidence");

    // together-releases reads catalogModels and MUST be rejected when no paired context file exists.
    const togetherNoCtx = selectSelfHealTarget(
      makeRefreshReport([
        { id: "together", sourceId: "together-releases", outcome: "parse_failed" },
      ]),
      [],
      {
        evidenceFiles: [
          {
            source_id: "together-releases",
            relative_path: "together-releases.json.gz",
            source_hash: "a".repeat(64),
            sha256: "b".repeat(64),
          },
        ],
        requireSourceEvidence: true,
      },
    );
    expect(togetherNoCtx.status).toBe("idle");
    expect(togetherNoCtx.idle_reason).toBe("missing_evidence");

    // sagemaker-pricing reads catalog from its own self-contained bundle and MUST NOT require paired context.
    const sagemakerNoCtx = selectSelfHealTarget(
      makeRefreshReport([
        { id: "amazon-sagemaker", sourceId: "sagemaker-pricing", outcome: "parse_failed" },
      ]),
      [],
      {
        evidenceFiles: [
          {
            source_id: "sagemaker-pricing",
            relative_path: "sagemaker-pricing.json.gz",
            source_hash: "a".repeat(64),
            sha256: "b".repeat(64),
          },
        ],
        requireSourceEvidence: true,
      },
    );
    expect(sagemakerNoCtx.status).toBe("actionable");
    expect(sagemakerNoCtx.target?.provider_id).toBe("amazon-sagemaker");

    // Same source with BOTH a dependency parse_failed AND a persistent 404 MUST keep source_location_change in triggers and reject single-source replay.
    const mixedDepReport = {
      generated_at: "2026-11-23T00:00:00.000Z",
      catalog_version: "a".repeat(64),
      providers: [
        {
          provider_id: "nvidia",
          signals: [],
          attempt: {
            outcome: "accepted",
            sources: [
              {
                source_id: "nvidia-nim-retrieval",
                outcome: "unchanged",
                dependency_failures: [
                  {
                    dependency_id: "dep-parse",
                    outcome: "parse_failed",
                    message: "Model table missing header",
                    impact: "claim",
                  },
                  {
                    dependency_id: "dep-404",
                    outcome: "fetch_failed",
                    http_status: 404,
                    consecutive_failures: 3,
                    message: "HTTP 404",
                    impact: "claim",
                  },
                ],
              },
            ],
          },
        },
      ],
    };
    const mixedDepTriage = selectSelfHealTarget(mixedDepReport, [], {
      evidenceFiles: [
        {
          source_id: "nvidia-nim-retrieval",
          relative_path: "nvidia-nim-retrieval.json.gz",
          source_hash: "a".repeat(64),
          sha256: "b".repeat(64),
        },
      ],
      requireSourceEvidence: true,
    });
    expect(mixedDepTriage.status).toBe("idle");
    expect(mixedDepTriage.idle_reason).toBe("missing_evidence");
    expect(mixedDepTriage.skipped_providers[0]?.detail).toContain("source_location_change");

    // Source-level parse_failed that ALSO carries a persistent 404 in dependency_failures MUST preserve source_location_change and return idle.
    const sourceParsePlus404Report = {
      generated_at: "2026-11-23T00:00:00.000Z",
      catalog_version: "a".repeat(64),
      providers: [
        {
          provider_id: "nvidia",
          signals: [],
          attempt: {
            outcome: "rejected",
            sources: [
              {
                source_id: "nvidia-nim-retrieval",
                outcome: "parse_failed",
                message: "NVIDIA retrieval index layout drifted",
                dependency_failures: [
                  {
                    dependency_id: "dep-404",
                    outcome: "fetch_failed",
                    http_status: 404,
                    consecutive_failures: 3,
                    message: "HTTP 404",
                    impact: "claim",
                  },
                ],
              },
            ],
          },
        },
      ],
    };
    const sourceParsePlus404Triage = selectSelfHealTarget(sourceParsePlus404Report, [], {
      evidenceFiles: [
        {
          source_id: "nvidia-nim-retrieval",
          relative_path: "nvidia-nim-retrieval.json.gz",
          source_hash: "a".repeat(64),
          sha256: "b".repeat(64),
        },
      ],
      requireSourceEvidence: true,
    });
    expect(sourceParsePlus404Triage.status).toBe("idle");
    expect(sourceParsePlus404Triage.idle_reason).toBe("missing_evidence");
    expect(sourceParsePlus404Triage.skipped_providers[0]?.detail).toContain(
      "source_location_change",
    );

    // Multiple distinct dependency parse failures OR omitted dependency failures MUST NOT enter single-source replay.
    const twoDepParseReport = {
      generated_at: "2026-11-23T00:00:00.000Z",
      catalog_version: "a".repeat(64),
      providers: [
        {
          provider_id: "nvidia",
          signals: [],
          attempt: {
            outcome: "accepted",
            sources: [
              {
                source_id: "nvidia-nim-retrieval",
                outcome: "unchanged",
                dependency_failures: [
                  {
                    dependency_id: "dep-a",
                    outcome: "parse_failed",
                    message: "Metadata missing",
                    impact: "claim",
                  },
                  {
                    dependency_id: "dep-b",
                    outcome: "parse_failed",
                    message: "Table missing",
                    impact: "claim",
                  },
                ],
              },
            ],
          },
        },
      ],
    };
    const twoDepTriage = selectSelfHealTarget(twoDepParseReport, [], {
      evidenceFiles: [
        {
          source_id: "nvidia-nim-retrieval",
          relative_path: "nvidia-nim-retrieval.json.gz",
          source_hash: "a".repeat(64),
          sha256: "b".repeat(64),
        },
      ],
      requireSourceEvidence: true,
    });
    expect(twoDepTriage.status).toBe("idle");
    expect(twoDepTriage.idle_reason).toBe("missing_evidence");
    expect(twoDepTriage.skipped_providers[0]?.detail).toContain("dependency_parse_failure");

    // Even a SINGLE transport-layer dependency parse_failed (like Ollama `/index` replaced with `{}`)
    // MUST NOT enter paid generation because single-source replay lacks the raw failed dependency body.
    const singleDepParseReport = {
      generated_at: "2026-11-23T00:00:00.000Z",
      catalog_version: "a".repeat(64),
      providers: [
        {
          provider_id: "ollama",
          signals: [],
          attempt: {
            outcome: "accepted",
            sources: [
              {
                source_id: "ollama-cloud-models",
                outcome: "unchanged",
                dependency_failures: [
                  {
                    dependency_id: "ollama-cloud-models/index",
                    outcome: "parse_failed",
                    message: "Ollama cloud model list contract mismatch",
                    impact: "claim",
                  },
                ],
              },
            ],
          },
        },
      ],
    };
    const singleDepTriage = selectSelfHealTarget(singleDepParseReport, [], {
      evidenceFiles: [
        {
          source_id: "ollama-cloud-models",
          relative_path: "ollama-cloud-models.json.gz",
          source_hash: "a".repeat(64),
          sha256: "b".repeat(64),
        },
      ],
      requireSourceEvidence: true,
    });
    expect(singleDepTriage.status).toBe("idle");
    expect(singleDepTriage.idle_reason).toBe("missing_evidence");
    expect(singleDepTriage.skipped_providers[0]?.detail).toContain("dependency_parse_failure");

    // Target carrying content_hash (Page A) MUST filter out Page B evidence in triage (idle when only B exists, selects ONLY A when both A and B exist).
    const hashA = "1".repeat(64);
    const hashB = "2".repeat(64);
    const kimiHashReport = {
      generated_at: "2026-11-23T00:00:00.000Z",
      catalog_version: "a".repeat(64),
      providers: [
        {
          provider_id: "kimi",
          signals: [],
          attempt: {
            outcome: "rejected",
            sources: [
              {
                source_id: "kimi-releases",
                outcome: "parse_failed",
                content_hash: hashA,
                message: "Unexpected Kimi release page: [source]",
              },
            ],
          },
        },
      ],
    };
    const evPageA = {
      source_id: "kimi-releases",
      relative_path: "kimi-releases-a.json.gz",
      source_hash: hashA,
      sha256: "a".repeat(64),
    };
    const evPageB = {
      source_id: "kimi-releases",
      relative_path: "kimi-releases-b.json.gz",
      source_hash: hashB,
      sha256: "b".repeat(64),
    };
    const kimiOnlyB = selectSelfHealTarget(kimiHashReport, [], {
      evidenceFiles: [evPageB],
      requireSourceEvidence: true,
    });
    expect(kimiOnlyB.status).toBe("idle");
    expect(kimiOnlyB.idle_reason).toBe("missing_evidence");
    const kimiBothAB = selectSelfHealTarget(kimiHashReport, [], {
      evidenceFiles: [evPageA, evPageB],
      requireSourceEvidence: true,
    });
    expect(kimiBothAB.status).toBe("actionable");
    expect(kimiBothAB.target?.evidence_files).toEqual([evPageA]);

    // Legacy redacted report WITHOUT content_hash or error_fingerprint MUST be rejected in triage BEFORE paid generation even when matching evidence exists!
    const kimiLegacyRedactedReport = {
      generated_at: "2026-11-23T00:00:00.000Z",
      catalog_version: "a".repeat(64),
      providers: [
        {
          provider_id: "kimi",
          signals: [],
          attempt: {
            outcome: "rejected",
            sources: [
              {
                source_id: "kimi-releases",
                outcome: "parse_failed",
                message: "Unexpected Kimi release page: [source]",
              },
            ],
          },
        },
      ],
    };
    const kimiLegacyTriage = selectSelfHealTarget(kimiLegacyRedactedReport, [], {
      evidenceFiles: [evPageA],
      requireSourceEvidence: true,
    });
    expect(kimiLegacyTriage.status).toBe("idle");
    expect(kimiLegacyTriage.idle_reason).toBe("missing_evidence");
    expect(kimiLegacyTriage.skipped_providers[0]?.detail).toContain(
      "unbound_redacted_parse_failure",
    );

    // 17 benign `accept_with_signal` `unknown_field` findings via createContractFindingCollector().summary()
    // MUST return idle (same as 16), while mixing in 1 real drift finding MUST return actionable.
    const buildExtReport = (count: number, includeDrift: boolean) => {
      const collector = createContractFindingCollector();
      for (let i = 1; i <= count; i += 1) {
        const idx = String(i).padStart(2, "0");
        collector.add({
          disposition: "accept_with_signal",
          observed_items: 1,
          diagnostic_count: 1,
          diagnostics: [
            {
              fingerprint: idx.padEnd(16, "b"),
              kind: "unknown_field",
              path: `/extra_${idx}`,
              observed: "string",
              affected_items: 1,
            },
          ],
        });
      }
      if (includeDrift) {
        collector.add({
          disposition: "accept_with_signal",
          observed_items: 1,
          diagnostic_count: 1,
          diagnostics: [
            {
              fingerprint: "c".repeat(16),
              kind: "missing_required_field",
              path: "/required_field",
              observed: "missing",
              affected_items: 1,
            },
          ],
        });
      }
      return {
        generated_at: "2026-11-23T00:00:00.000Z",
        catalog_version: "a".repeat(64),
        providers: [
          {
            provider_id: "ollama",
            signals: [],
            attempt: {
              outcome: "accepted",
              sources: [
                {
                  source_id: "ollama-cloud-models",
                  outcome: "unchanged",
                  ...collector.summary(),
                },
              ],
            },
          },
        ],
      };
    };
    const ollamaEv = [
      {
        source_id: "ollama-cloud-models",
        relative_path: "ollama-cloud-models.json.gz",
        source_hash: "a".repeat(64),
        sha256: "b".repeat(64),
      },
    ];
    expect(
      selectSelfHealTarget(buildExtReport(16, false), [], {
        evidenceFiles: ollamaEv,
        requireSourceEvidence: true,
      }).status,
    ).toBe("idle");
    expect(
      selectSelfHealTarget(buildExtReport(17, false), [], {
        evidenceFiles: ollamaEv,
        requireSourceEvidence: true,
      }).status,
    ).toBe("idle");
    expect(
      selectSelfHealTarget(buildExtReport(17, true), [], {
        evidenceFiles: ollamaEv,
        requireSourceEvidence: true,
      }).status,
    ).toBe("actionable");

    // Sources requiring authenticated inventory context (like mistral-pricing) MUST be marked missing_evidence before paid generation.
    const mistralPricingEv = selectSelfHealTarget(
      makeRefreshReport([{ id: "mistral", sourceId: "mistral-pricing", outcome: "parse_failed" }]),
      [],
      {
        evidenceFiles: [
          {
            source_id: "mistral-pricing",
            relative_path: "mistral-pricing.json.gz",
            source_hash: "e".repeat(64),
            sha256: "f".repeat(64),
          },
        ],
        requireSourceEvidence: true,
      },
    );
    expect(mistralPricingEv.status).toBe("idle");
    expect(mistralPricingEv.idle_reason).toBe("missing_evidence");
    expect(mistralPricingEv.skipped_providers[0]?.detail).toContain("authenticated inventory");

    // With requireSourceEvidence=true, a source-level failure lacking evidence is skipped instead of entering paid generation.
    const missingEv = selectSelfHealTarget(
      makeRefreshReport([
        { id: "fireworks", sourceId: "fireworks-serverless", outcome: "parse_failed" },
      ]),
      [],
      { evidenceFiles: [], requireSourceEvidence: true },
    );
    expect(missingEv.status).toBe("idle");
    expect(missingEv.idle_reason).toBe("missing_evidence");
    expect(missingEv.skipped_providers).toEqual([
      expect.objectContaining({ provider_id: "fireworks", reason: "missing_evidence" }),
    ]);

    // When TWO sources of the same provider fail, having evidence for ONLY ONE source MUST NOT pass requireSourceEvidence.
    const partialSourceEv = selectSelfHealTarget(
      {
        generated_at: "2026-11-23T00:00:00.000Z",
        catalog_version: "a".repeat(64),
        providers: [
          {
            provider_id: "openai",
            signals: [],
            attempt: {
              outcome: "rejected",
              sources: [
                { source_id: "openai-models", outcome: "parse_failed", message: "models drifted" },
                {
                  source_id: "openai-pricing",
                  outcome: "parse_failed",
                  message: "pricing drifted",
                },
              ],
            },
          },
        ],
      },
      [],
      { evidenceFiles: [sharedPool[1]!], requireSourceEvidence: true },
    );
    expect(partialSourceEv.status).toBe("idle");
    expect(partialSourceEv.idle_reason).toBe("missing_evidence");
    expect(partialSourceEv.skipped_providers[0]?.detail).toContain("openai-models");

    // Standalone provider-level quarantine with 0 bound evidence MUST NOT enter paid generation when requireSourceEvidence=true.
    const zeroEvQuarantine = selectSelfHealTarget(
      makeRefreshReport([]),
      [
        {
          provider_id: "openai",
          checked_at: "2026-11-23T00:00:00.000Z",
          reason: "Quarantined validation mismatch",
        },
      ],
      { evidenceFiles: [], requireSourceEvidence: true },
    );
    expect(zeroEvQuarantine.status).toBe("idle");
    expect(zeroEvQuarantine.idle_reason).toBe("missing_evidence");
  });

  it("captures, discovers, and replays paired public catalog context for pricing sources like openai-pricing", async () => {
    const captureDir = await makeTempDir("kmodels-capture-ctx-");
    const openaiPricing = manifests
      .find((m) => m.provider.id === "openai")
      ?.sources.find((s) => s.id === "openai-pricing");
    expect(openaiPricing).toBeDefined();

    const catalogContext = [
      providerModelSchema.parse(
        baseModel({
          providerId: "openai",
          id: "gpt-test",
          name: "Test",
          sourceId: "openai-models",
          observedAt: "2026-10-20T05:36:32.249Z",
        }),
      ),
    ];
    const body =
      "Flagship models\nStandard\n| Model | Short context input | Short context output |\n| --- | --- | --- |\n| gpt-test | $2 | $3 |";

    const prevDir = process.env.KMODELS_REPAIR_CAPTURE_DIRECTORY;
    process.env.KMODELS_REPAIR_CAPTURE_DIRECTORY = captureDir;
    try {
      await captureRepairSource(openaiPricing!, body, "2026-10-20T05:36:32.249Z", catalogContext);
    } finally {
      if (prevDir === undefined) delete process.env.KMODELS_REPAIR_CAPTURE_DIRECTORY;
      else process.env.KMODELS_REPAIR_CAPTURE_DIRECTORY = prevDir;
    }

    const discovered = await discoverEvidenceFiles(captureDir);
    expect(discovered).toHaveLength(1);
    expect(discovered[0]?.source_id).toBe("openai-pricing");
    expect(discovered[0]?.context_relative_path?.endsWith(".context.json.gz")).toBe(true);
    expect(discovered[0]?.context_sha256).toMatch(/^[0-9a-f]{64}$/);

    // Replaying with the bound context parses 2 prices cleanly (whereas omitting context throws).
    const evidenceJson = await readBoundedJson(join(captureDir, discovered[0]!.relative_path));
    const contextJson = await readBoundedJson(
      join(captureDir, discovered[0]!.context_relative_path!),
    );
    expect(() => replayCatalogEvidence("openai-pricing", evidenceJson)).toThrow(/catalog/i);
    const summary = replayCatalogEvidence("openai-pricing", evidenceJson, contextJson);
    expect(summary.models).toContainEqual(
      expect.objectContaining({ uid: "openai/gpt-test", prices: 2 }),
    );
  });

  it("rejects corrupt scalar context files, invalid context fields, and body-hash-corrupted evidence during discovery and selects exact upstream shards", async () => {
    const dir = await makeTempDir("kmodels-bad-ctx-");
    const body = '{"models":[]}';
    const validHash = sha256(body);
    const allProviderManifests: readonly ProviderManifest[] = manifests;
    const allPublicSources: readonly SourceManifest[] = allProviderManifests.flatMap(
      (m) => m.sources,
    );
    const findSource = (id: string) => allPublicSources.find((s) => s.id === id)!;
    const openaiPricingSrc = findSource("openai-pricing");
    const togetherReleasesSrc = findSource("together-releases");
    const kimiReleasesSrc = findSource("kimi-releases");

    await writeFile(
      join(dir, `openai-pricing-${validHash}.json`),
      JSON.stringify({
        source_id: openaiPricingSrc.id,
        scope: "source",
        source_url: openaiPricingSrc.url,
        observed_at: "2026-11-23T00:00:00.000Z",
        source_hash: validHash,
        body,
      }),
    );
    await writeFile(join(dir, `openai-pricing-${validHash}.context.json`), "42");
    await writeFile(
      join(dir, `together-releases-${validHash}.json`),
      JSON.stringify({
        source_id: togetherReleasesSrc.id,
        scope: "source",
        source_url: togetherReleasesSrc.url,
        observed_at: "2026-11-23T00:00:00.000Z",
        source_hash: validHash,
        body,
      }),
    );
    // Structured context with invalid sibling field MUST be rejected during discovery identically to replay-catalog-evidence.ts.
    await writeFile(
      join(dir, `together-releases-${validHash}.context.json`),
      JSON.stringify({ catalog_models: [], previous_catalog_models: 42 }),
    );
    // Evidence whose source_hash does NOT match sha256(body) MUST be rejected BEFORE paid generation!
    await writeFile(
      join(dir, `kimi-releases-badhash.json`),
      JSON.stringify({
        source_id: kimiReleasesSrc.id,
        scope: "source",
        source_url: kimiReleasesSrc.url,
        observed_at: "2026-11-23T00:00:00.000Z",
        source_hash: "f".repeat(64),
        body: "<html>corrupted hash</html>",
      }),
    );
    const discovered = await discoverEvidenceFiles(dir);
    expect(discovered.map((d) => d.source_id)).toEqual(["openai-pricing", "together-releases"]);
    for (const item of discovered) {
      expect(item.context_relative_path).toBeUndefined();
      expect(item.context_kind).toBeUndefined();
    }

    // Multi-page `--paginate --slurp` artifact selection:
    // Attempt 2 re-ran nvidia collect, but assemble failed before writing an attempt-2 report.
    const slurpedPages = [
      {
        artifacts: [
          { id: 100, name: "catalog-refresh-42-attempt-1", expired: false },
          { id: 101, name: "catalog-public-evidence-42-attempt-1-nvidia", expired: false },
          { id: 102, name: "catalog-public-evidence-42-attempt-1-openai", expired: false },
        ],
      },
      {
        artifacts: [
          { id: 201, name: "catalog-public-evidence-42-attempt-2-nvidia", expired: false },
        ],
      },
    ];
    // Without manifest (legacy fallback): attempt-1 report MUST NOT pair with attempt-2 nvidia shard.
    expect(selectUpstreamRefreshArtifacts(slurpedPages, "42", 2)).toEqual({
      report: "catalog-refresh-42-attempt-1",
      report_attempt: 1,
      reports: [{ attempt: 1, name: "catalog-refresh-42-attempt-1" }],
      shards: [
        "catalog-public-evidence-42-attempt-1-nvidia",
        "catalog-public-evidence-42-attempt-1-openai",
      ],
    });
    // Mismatched manifest report_attempt (2 vs selected attempt 1) MUST throw instead of returning attempt-2 shards.
    expect(() =>
      selectUpstreamRefreshArtifacts(slurpedPages, "42", 2, {
        version: 1,
        report_attempt: 2,
        shards: [
          {
            shard: "nvidia",
            attempt: 2,
            artifact_id: "201",
            artifact_name: "catalog-public-evidence-42-attempt-2-nvidia",
          },
        ],
      }),
    ).toThrow(/report_attempt/);

    // With manifest where attempt-2 assemble succeeded and nvidia emitted NO public evidence while legally reusing attempt-1 openai shard:
    const slurpedAttempt2Report = [
      ...slurpedPages,
      { artifacts: [{ id: 200, name: "catalog-refresh-42-attempt-2", expired: false }] },
    ];
    expect(
      selectUpstreamRefreshArtifacts(slurpedAttempt2Report, "42", 2, {
        version: 1,
        report_attempt: 2,
        shards: [
          { shard: "nvidia", attempt: 2, artifact_id: "", artifact_name: "" },
          {
            shard: "openai",
            attempt: 1,
            artifact_id: "102",
            artifact_name: "catalog-public-evidence-42-attempt-1-openai",
          },
        ],
      }),
    ).toEqual({
      report: "catalog-refresh-42-attempt-2",
      report_attempt: 2,
      reports: [
        { attempt: 2, name: "catalog-refresh-42-attempt-2" },
        { attempt: 1, name: "catalog-refresh-42-attempt-1" },
      ],
      shards: ["catalog-public-evidence-42-attempt-1-openai"],
    });
    // Mismatched artifact_id against API list MUST throw even when artifact_name matches.
    expect(() =>
      selectUpstreamRefreshArtifacts(slurpedAttempt2Report, "42", 2, {
        version: 1,
        report_attempt: 2,
        shards: [
          {
            shard: "openai",
            attempt: 1,
            artifact_id: "999999",
            artifact_name: "catalog-public-evidence-42-attempt-1-openai",
          },
        ],
      }),
    ).toThrow(/does not match any non-expired GitHub API artifact/);
  });
});

describe("self-heal ownership, reverse-deps, replay semantics & large-diff handling", () => {
  it.each([
    ["gemini", "src/catalog/gemini.ts", "src/catalog/databricks.ts"],
    ["anthropic", "src/catalog/anthropic-price-row.ts", "src/catalog/azure.ts"],
  ])("routes cross-provider %s files to draft_pr", (provider, path, importer) => {
    expect(findCrossProviderImporters(path, provider)).toContain(importer);
    expect(classifyChangedPaths([path], provider)).toEqual({
      mode: "draft_pr",
      forbidden_files: [],
      protected_files: [path],
    });
  });

  it("allows auto_push for provider-owned files without cross-provider importers", () => {
    expect(
      classifyChangedPaths(
        [
          "src/catalog/fireworks.ts",
          "tests/fireworks.test.ts",
          "tests/fixtures/fireworks/page.html",
          "docs/providers/fireworks.md",
        ],
        "fireworks",
      ),
    ).toEqual({
      mode: "auto_push",
      forbidden_files: [],
      protected_files: [],
    });
  }, 15_000);

  it("hard-rejects sealed transport, CI workflows, self-heal scripts, packages, and lockfiles", () => {
    for (const forbidden of [
      "src/catalog/transport/auth-fetch.ts",
      "src/catalog/transport/sagemaker-fetch.ts",
      ".github/workflows/self-heal.yml",
      "scripts/self-heal/gate.ts",
      "scripts/deployment-receipt.ts",
      "packages/pricing/package.json",
      "package.json",
      "data/catalog.json",
    ]) {
      const result = classifyChangedPaths([forbidden], "amazon-sagemaker");
      expect(result.mode, forbidden).toBe("rejected");
      expect(result.forbidden_files).toContain(forbidden);
    }
  });

  it("distinguishes baseline environment errors, non-reproduced passes, and real diagnostic fixes", () => {
    const validCandidateJson = JSON.stringify({
      schema_version: 1,
      stage: "parse",
      source_id: "fireworks-models",
      models: [{ uid: "fireworks/m1" }],
      contract_findings: [],
      reconciliation: { reason_counts: {} },
    });

    // Baseline missing node_modules / ERR_MODULE_NOT_FOUND MUST be rejected, never counted as reproduction.
    expect(
      evaluateBeforeAfterReplay({
        sourceId: "fireworks-models",
        baseline: {
          status: 1,
          stdout: "",
          stderr: "Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'zod'",
        },
        candidate: { status: 0, stdout: validCandidateJson, stderr: "" },
      }).ok,
    ).toBe(false);

    // Baseline passes with 0 diagnostics, candidate passes with different stdout -> REJECTED.
    expect(
      evaluateBeforeAfterReplay({
        sourceId: "fireworks-models",
        baseline: {
          status: 0,
          stdout: JSON.stringify({
            schema_version: 1,
            stage: "parse",
            source_id: "fireworks-models",
            models: [],
            contract_findings: [],
          }),
          stderr: "",
        },
        candidate: { status: 0, stdout: validCandidateJson, stderr: "" },
      }).ok,
    ).toBe(false);

    // Baseline reproduces real structured parser failure, candidate parses cleanly -> ACCEPTED.
    expect(
      evaluateBeforeAfterReplay({
        sourceId: "fireworks-models",
        baseline: {
          status: 1,
          stdout: "",
          stderr: JSON.stringify({
            schema_version: 1,
            stage: "parse_error",
            source_id: "fireworks-models",
            error_name: "Error",
            message: "Fireworks table header changed",
          }),
        },
        candidate: { status: 0, stdout: validCandidateJson, stderr: "" },
      }).ok,
    ).toBe(true);

    // Baseline has 2 contract findings, candidate reduces to 0 -> ACCEPTED; still 2 -> REJECTED.
    const twoFindings = JSON.stringify({
      schema_version: 1,
      stage: "parse",
      source_id: "fireworks-models",
      models: [{ uid: "fireworks/m1" }],
      contract_findings: [{ kind: "missing_column" }, { kind: "changed_shape" }],
    });
    expect(
      evaluateBeforeAfterReplay({
        sourceId: "fireworks-models",
        baseline: { status: 0, stdout: twoFindings, stderr: "" },
        candidate: { status: 0, stdout: validCandidateJson, stderr: "" },
      }).ok,
    ).toBe(true);
    expect(
      evaluateBeforeAfterReplay({
        sourceId: "fireworks-models",
        baseline: { status: 0, stdout: twoFindings, stderr: "" },
        candidate: { status: 0, stdout: twoFindings, stderr: "" },
      }).ok,
    ).toBe(false);

    // Shared 29-reason parity: pricing_input_contract_drift 1 -> 0 MUST be accepted.
    const driftBaseline = JSON.stringify({
      schema_version: 1,
      stage: "parse",
      source_id: "openai-pricing",
      models: [{ uid: "openai/m1" }],
      contract_findings: [],
      reconciliation: { reason_counts: { pricing_input_contract_drift: 1 } },
    });
    const driftFixed = JSON.stringify({
      schema_version: 1,
      stage: "parse",
      source_id: "openai-pricing",
      models: [{ uid: "openai/m1" }],
      contract_findings: [],
      reconciliation: { reason_counts: {} },
    });
    expect(
      evaluateBeforeAfterReplay({
        sourceId: "openai-pricing",
        baseline: { status: 0, stdout: driftBaseline, stderr: "" },
        candidate: { status: 0, stdout: driftFixed, stderr: "" },
        targetCandidates: [
          {
            provider_id: "openai",
            scope: "source",
            subject_id: "openai-pricing",
            source_id: "openai-pricing",
            trigger: "source_pricing_structure",
            message: "Missing reviewed source contracts: pricing_input_contract_drift: 1.",
            diagnostics: [],
            reconciliation_reasons: { pricing_input_contract_drift: 1 },
          },
        ],
      }).ok,
    ).toBe(true);

    // Target-specific check: keeping target pricing_input_contract_partial=1 while dropping unrelated sibling MUST be rejected.
    const partialWithSibling = JSON.stringify({
      schema_version: 1,
      stage: "parse",
      source_id: "openai-pricing",
      models: [{ uid: "openai/m1" }],
      contract_findings: [],
      reconciliation: {
        reason_counts: {
          pricing_input_contract_partial: 1,
          public_price_shape_unsupported: 1,
        },
      },
    });
    const siblingOnlyDropped = JSON.stringify({
      schema_version: 1,
      stage: "parse",
      source_id: "openai-pricing",
      models: [{ uid: "openai/m1" }],
      contract_findings: [],
      reconciliation: {
        reason_counts: {
          pricing_input_contract_partial: 1,
        },
      },
    });
    const targetOnlyFixed = JSON.stringify({
      schema_version: 1,
      stage: "parse",
      source_id: "openai-pricing",
      models: [{ uid: "openai/m1" }],
      contract_findings: [],
      reconciliation: {
        reason_counts: {
          public_price_shape_unsupported: 1,
        },
      },
    });
    const targetFixedSiblingRegressed = JSON.stringify({
      schema_version: 1,
      stage: "parse",
      source_id: "openai-pricing",
      models: [{ uid: "openai/m1" }],
      contract_findings: [],
      reconciliation: {
        reason_counts: {
          public_price_shape_unsupported: 2,
        },
      },
    });
    const partialTarget = [
      {
        provider_id: "openai",
        scope: "source" as const,
        subject_id: "openai-pricing",
        source_id: "openai-pricing",
        trigger: "source_pricing_structure" as const,
        message: "Missing reviewed source contracts: pricing_input_contract_partial: 1.",
        diagnostics: [],
        reconciliation_reasons: { pricing_input_contract_partial: 1 },
      },
    ];
    expect(
      evaluateBeforeAfterReplay({
        sourceId: "openai-pricing",
        baseline: { status: 0, stdout: partialWithSibling, stderr: "" },
        candidate: { status: 0, stdout: siblingOnlyDropped, stderr: "" },
        targetCandidates: partialTarget,
      }).ok,
    ).toBe(false);
    expect(
      evaluateBeforeAfterReplay({
        sourceId: "openai-pricing",
        baseline: { status: 0, stdout: partialWithSibling, stderr: "" },
        candidate: { status: 0, stdout: targetOnlyFixed, stderr: "" },
        targetCandidates: partialTarget,
      }).ok,
    ).toBe(true);
    expect(
      evaluateBeforeAfterReplay({
        sourceId: "openai-pricing",
        baseline: { status: 0, stdout: partialWithSibling, stderr: "" },
        candidate: { status: 0, stdout: targetFixedSiblingRegressed, stderr: "" },
        targetCandidates: partialTarget,
      }).ok,
    ).toBe(false);

    // Multi-target reasons MUST be evaluated individually: fixing 1 of 2 or failing to reproduce 1 of 2 MUST be rejected.
    const twoTargets = [
      {
        provider_id: "dashscope",
        scope: "source" as const,
        subject_id: "dashscope-pricing",
        source_id: "dashscope-pricing",
        trigger: "source_pricing_structure" as const,
        message:
          "Missing reviewed source contracts: pricing_input_contract_partial: 1, pricing_input_contract_drift: 1.",
        diagnostics: [],
        reconciliation_reasons: {
          pricing_input_contract_partial: 1,
          pricing_input_contract_drift: 1,
        },
      },
    ];
    const bothReasonsBase = JSON.stringify({
      schema_version: 1,
      stage: "parse",
      source_id: "dashscope-pricing",
      models: [{ uid: "dashscope/m1" }],
      contract_findings: [],
      reconciliation: {
        reason_counts: {
          pricing_input_contract_partial: 1,
          pricing_input_contract_drift: 1,
        },
      },
    });
    const oneReasonOnlyBase = JSON.stringify({
      schema_version: 1,
      stage: "parse",
      source_id: "dashscope-pricing",
      models: [{ uid: "dashscope/m1" }],
      contract_findings: [],
      reconciliation: {
        reason_counts: {
          pricing_input_contract_partial: 1,
        },
      },
    });
    const onlyOneFixed = oneReasonOnlyBase;
    const bothFixed = JSON.stringify({
      schema_version: 1,
      stage: "parse",
      source_id: "dashscope-pricing",
      models: [{ uid: "dashscope/m1" }],
      contract_findings: [],
      reconciliation: { reason_counts: {} },
    });
    expect(
      evaluateBeforeAfterReplay({
        sourceId: "dashscope-pricing",
        baseline: { status: 0, stdout: bothReasonsBase, stderr: "" },
        candidate: { status: 0, stdout: onlyOneFixed, stderr: "" },
        targetCandidates: twoTargets,
      }).ok,
    ).toBe(false);
    expect(
      evaluateBeforeAfterReplay({
        sourceId: "dashscope-pricing",
        baseline: { status: 0, stdout: oneReasonOnlyBase, stderr: "" },
        candidate: { status: 0, stdout: bothFixed, stderr: "" },
        targetCandidates: twoTargets,
      }).ok,
    ).toBe(false);
    expect(
      evaluateBeforeAfterReplay({
        sourceId: "dashscope-pricing",
        baseline: { status: 0, stdout: bothReasonsBase, stderr: "" },
        candidate: { status: 0, stdout: bothFixed, stderr: "" },
        targetCandidates: twoTargets,
      }).ok,
    ).toBe(true);

    // Per-path contract_findings matching: retaining target path while dropping another field's error MUST be rejected.
    const contractTarget = [
      {
        provider_id: "openai",
        scope: "source" as const,
        subject_id: "openai-models",
        source_id: "openai-models",
        trigger: "source_contract_change" as const,
        message: "Contract drift on /models/0/pricing",
        diagnostics: [
          {
            kind: "missing_required_field",
            path: "/models/0/pricing",
            affected_items: 1,
          },
        ],
      },
    ];
    const contractBase = JSON.stringify({
      schema_version: 1,
      stage: "parse",
      source_id: "openai-models",
      models: [{ uid: "openai/m1" }],
      contract_findings: [
        {
          diagnostics: [
            { kind: "missing_required_field", path: "/models/0/pricing", affected_items: 1 },
            { kind: "type_mismatch", path: "/models/0/name", affected_items: 1 },
          ],
        },
      ],
    });
    const contractWrongFieldFixed = JSON.stringify({
      schema_version: 1,
      stage: "parse",
      source_id: "openai-models",
      models: [{ uid: "openai/m1" }],
      contract_findings: [
        {
          diagnostics: [
            { kind: "missing_required_field", path: "/models/0/pricing", affected_items: 1 },
          ],
        },
      ],
    });
    const contractTargetFixed = JSON.stringify({
      schema_version: 1,
      stage: "parse",
      source_id: "openai-models",
      models: [{ uid: "openai/m1" }],
      contract_findings: [
        {
          diagnostics: [{ kind: "type_mismatch", path: "/models/0/name", affected_items: 1 }],
        },
      ],
    });
    expect(
      evaluateBeforeAfterReplay({
        sourceId: "openai-models",
        baseline: { status: 0, stdout: contractBase, stderr: "" },
        candidate: { status: 0, stdout: contractWrongFieldFixed, stderr: "" },
        targetCandidates: contractTarget,
      }).ok,
    ).toBe(false);
    expect(
      evaluateBeforeAfterReplay({
        sourceId: "openai-models",
        baseline: { status: 0, stdout: contractBase, stderr: "" },
        candidate: { status: 0, stdout: contractTargetFixed, stderr: "" },
        targetCandidates: contractTarget,
      }).ok,
    ).toBe(true);

    // Non-drift `unknown_field` hint in candidate.diagnostics stays under sibling no-regression (1->1 accepted, 1->2 rejected).
    const driftPlusUnknownFieldTarget = [
      {
        provider_id: "mistral",
        scope: "source" as const,
        subject_id: "mistral-models",
        source_id: "mistral-models",
        trigger: "source_contract_change" as const,
        message: "Contract drift with additive unknown_field",
        diagnostics: [
          { kind: "missing_required_field", path: "/models/0/pricing", affected_items: 1 },
          { kind: "unknown_field", path: "/models/0/new_badge", affected_items: 1 },
        ],
      },
    ];
    const baseWithUnknownField = JSON.stringify({
      schema_version: 1,
      stage: "parse",
      source_id: "mistral-models",
      models: [{ uid: "mistral/m1" }],
      contract_findings: [
        {
          diagnostics: [
            { kind: "missing_required_field", path: "/models/0/pricing", affected_items: 1 },
            { kind: "unknown_field", path: "/models/0/new_badge", affected_items: 1 },
          ],
        },
      ],
    });
    const candDriftFixedUnknownFieldKept = JSON.stringify({
      schema_version: 1,
      stage: "parse",
      source_id: "mistral-models",
      models: [{ uid: "mistral/m1" }],
      contract_findings: [
        {
          diagnostics: [{ kind: "unknown_field", path: "/models/0/new_badge", affected_items: 1 }],
        },
      ],
    });
    const candUnknownFieldRegressed = JSON.stringify({
      schema_version: 1,
      stage: "parse",
      source_id: "mistral-models",
      models: [{ uid: "mistral/m1" }],
      contract_findings: [
        {
          diagnostics: [{ kind: "unknown_field", path: "/models/0/new_badge", affected_items: 2 }],
        },
      ],
    });
    expect(
      evaluateBeforeAfterReplay({
        sourceId: "mistral-models",
        baseline: { status: 0, stdout: baseWithUnknownField, stderr: "" },
        candidate: { status: 0, stdout: candDriftFixedUnknownFieldKept, stderr: "" },
        targetCandidates: driftPlusUnknownFieldTarget,
      }).ok,
    ).toBe(true);
    expect(
      evaluateBeforeAfterReplay({
        sourceId: "mistral-models",
        baseline: { status: 0, stdout: baseWithUnknownField, stderr: "" },
        candidate: { status: 0, stdout: candUnknownFieldRegressed, stderr: "" },
        targetCandidates: driftPlusUnknownFieldTarget,
      }).ok,
    ).toBe(false);

    // Path A: Provider-level assembly failure MUST NOT pass via unrelated same-provider source replay.
    expect(
      evaluateBeforeAfterReplay({
        sourceId: "openai-pricing",
        baseline: { status: 0, stdout: driftBaseline, stderr: "" },
        candidate: { status: 0, stdout: driftFixed, stderr: "" },
        targetCandidates: [
          {
            provider_id: "openai",
            scope: "provider",
            subject_id: "provider_validation",
            trigger: "provider_validation",
            message: "Provider assembly check failed",
            diagnostics: [],
          },
        ],
      }).ok,
    ).toBe(false);

    // Path B: When target is `pricing_input_contract_partial`, a non-zero baseline exit MUST NOT bypass per-target diagnostic checks.
    const candStillHasThreePartial = JSON.stringify({
      schema_version: 1,
      stage: "parse",
      source_id: "openai-pricing",
      models: [{ uid: "openai/m1" }],
      contract_findings: [],
      reconciliation: { reason_counts: { pricing_input_contract_partial: 3 } },
    });
    expect(
      evaluateBeforeAfterReplay({
        sourceId: "openai-pricing",
        baseline: {
          status: 1,
          stdout: "",
          stderr: "Error: OpenAI pricing requires the collected catalog",
        },
        candidate: { status: 0, stdout: candStillHasThreePartial, stderr: "" },
        targetCandidates: partialTarget,
      }).ok,
    ).toBe(false);
    expect(
      evaluateBeforeAfterReplay({
        sourceId: "openai-pricing",
        baseline: { status: 1, stdout: "", stderr: "Error: unexpected crash" },
        candidate: { status: 0, stdout: candStillHasThreePartial, stderr: "" },
        targetCandidates: partialTarget,
      }).ok,
    ).toBe(false);

    // Path C: provider_validation attached to a changed source_id (e.g. OpenAI model_count_drop)
    // and source_location_change (e.g. NVIDIA HTTP 404) MUST NOT pass via unrelated parse summary diff.
    expect(
      evaluateBeforeAfterReplay({
        sourceId: "openai-pricing",
        baseline: { status: 0, stdout: driftBaseline, stderr: "" },
        candidate: { status: 0, stdout: driftFixed, stderr: "" },
        targetCandidates: [
          {
            provider_id: "openai",
            scope: "source",
            subject_id: "openai-pricing",
            source_id: "openai-pricing",
            trigger: "provider_validation",
            message: "model_count_drop: Model count dropped",
            diagnostics: [],
          },
        ],
      }).ok,
    ).toBe(false);
    expect(
      evaluateBeforeAfterReplay({
        sourceId: "nvidia-nim-retrieval",
        baseline: {
          status: 0,
          stdout: JSON.stringify({
            schema_version: 1,
            stage: "parse",
            source_id: "nvidia-nim-retrieval",
            models: [{ uid: "nvidia/m1" }],
            contract_findings: [
              { diagnostics: [{ kind: "unknown_field", path: "/x", affected_items: 1 }] },
            ],
          }),
          stderr: "",
        },
        candidate: {
          status: 0,
          stdout: JSON.stringify({
            schema_version: 1,
            stage: "parse",
            source_id: "nvidia-nim-retrieval",
            models: [{ uid: "nvidia/m1" }],
            contract_findings: [],
          }),
          stderr: "",
        },
        targetCandidates: [
          {
            provider_id: "nvidia",
            scope: "source",
            subject_id: "nvidia-nim-retrieval",
            source_id: "nvidia-nim-retrieval",
            trigger: "source_location_change",
            message: "HTTP 404 on dependency nvidia-embedding-2b-infer",
            diagnostics: [],
          },
        ],
      }).ok,
    ).toBe(false);

    // Path D: source_parse_failure with structured SourceContractError diagnostics:
    // - Baseline throws matching SourceContractError & candidate parses cleanly -> ACCEPTED
    // - Baseline throws UNRELATED SourceContractError -> REJECTED
    // - Baseline exits 0 with those diagnostics in summary (never crashed) -> REJECTED
    const fireworksParseFailureTarget = [
      {
        provider_id: "fireworks",
        scope: "source" as const,
        subject_id: "fireworks-serverless",
        source_id: "fireworks-serverless",
        trigger: "source_parse_failure" as const,
        message: "Fireworks serverless contract mismatch: missing_required_field at /documents",
        diagnostics: [{ kind: "missing_required_field", path: "/documents", affected_items: 1 }],
      },
    ];
    const matchingStructuredErr = JSON.stringify({
      schema_version: 1,
      stage: "parse_error",
      source_id: "fireworks-serverless",
      error_name: "SourceContractError",
      message: "Fireworks serverless contract mismatch: missing_required_field at /documents",
      contract_finding: {
        diagnostics: [{ kind: "missing_required_field", path: "/documents", affected_items: 1 }],
      },
    });
    const wrongStructuredErr = JSON.stringify({
      schema_version: 1,
      stage: "parse_error",
      source_id: "fireworks-serverless",
      error_name: "SourceContractError",
      message: "Fireworks serverless contract mismatch: type_mismatch at /other",
      contract_finding: {
        diagnostics: [{ kind: "type_mismatch", path: "/other", affected_items: 1 }],
      },
    });
    const cleanFireworksCandidate = JSON.stringify({
      schema_version: 1,
      stage: "parse",
      source_id: "fireworks-serverless",
      models: [{ uid: "fireworks/m1" }],
      contract_findings: [],
    });
    expect(
      evaluateBeforeAfterReplay({
        sourceId: "fireworks-serverless",
        baseline: { status: 1, stdout: "", stderr: matchingStructuredErr },
        candidate: { status: 0, stdout: cleanFireworksCandidate, stderr: "" },
        targetCandidates: fireworksParseFailureTarget,
      }).ok,
    ).toBe(true);
    expect(
      evaluateBeforeAfterReplay({
        sourceId: "fireworks-serverless",
        baseline: { status: 1, stdout: "", stderr: wrongStructuredErr },
        candidate: { status: 0, stdout: cleanFireworksCandidate, stderr: "" },
        targetCandidates: fireworksParseFailureTarget,
      }).ok,
    ).toBe(false);
    // Baseline killed by signal (status: null), plain non-diagnostic error text, or wrong source_id in parse_error MUST ALL be rejected.
    expect(
      evaluateBeforeAfterReplay({
        sourceId: "fireworks-serverless",
        baseline: { status: null, stdout: "", stderr: "" },
        candidate: { status: 0, stdout: cleanFireworksCandidate, stderr: "" },
        targetCandidates: fireworksParseFailureTarget,
      }).ok,
    ).toBe(false);
    expect(
      evaluateBeforeAfterReplay({
        sourceId: "fireworks-serverless",
        baseline: {
          status: 1,
          stdout: "",
          stderr: "Generic startup failure without contract keys",
        },
        candidate: { status: 0, stdout: cleanFireworksCandidate, stderr: "" },
        targetCandidates: fireworksParseFailureTarget,
      }).ok,
    ).toBe(false);
    // Plain unattributed text mentioning the diagnostic MUST be rejected (requires structured parse_error JSON).
    expect(
      evaluateBeforeAfterReplay({
        sourceId: "fireworks-serverless",
        baseline: {
          status: 1,
          stdout: "",
          stderr: "missing_required_field at /documents",
        },
        candidate: { status: 0, stdout: cleanFireworksCandidate, stderr: "" },
        targetCandidates: fireworksParseFailureTarget,
      }).ok,
    ).toBe(false);
    // Unstructured source_parse_failure (no contract diagnostics): baseline error from a different stage/message MUST be rejected.
    const vercelUnstructuredTarget = [
      {
        provider_id: "vercel",
        scope: "source" as const,
        subject_id: "vercel-models",
        source_id: "vercel-models",
        trigger: "source_parse_failure" as const,
        message: "Model page missing provider column",
        diagnostics: [],
      },
    ];
    const cleanVercelCandidate = JSON.stringify({
      schema_version: 1,
      stage: "parse",
      source_id: "vercel-models",
      models: [{ uid: "vercel/m1" }],
      contract_findings: [],
    });
    expect(
      evaluateBeforeAfterReplay({
        sourceId: "vercel-models",
        baseline: {
          status: 1,
          stdout: "",
          stderr: JSON.stringify({
            schema_version: 1,
            stage: "parse_error",
            source_id: "vercel-models",
            error_name: "Error",
            message: "Vercel models transport omitted its source bundle",
          }),
        },
        candidate: { status: 0, stdout: cleanVercelCandidate, stderr: "" },
        targetCandidates: vercelUnstructuredTarget,
      }).ok,
    ).toBe(false);
    expect(
      evaluateBeforeAfterReplay({
        sourceId: "vercel-models",
        baseline: {
          status: 1,
          stdout: "",
          stderr: JSON.stringify({
            schema_version: 1,
            stage: "evidence_error",
            source_id: "vercel-models",
            error_name: "Error",
            message: "Model page missing provider column",
          }),
        },
        candidate: { status: 0, stdout: cleanVercelCandidate, stderr: "" },
        targetCandidates: vercelUnstructuredTarget,
      }).ok,
    ).toBe(false);
    expect(
      evaluateBeforeAfterReplay({
        sourceId: "vercel-models",
        baseline: {
          status: 1,
          stdout: "",
          stderr: JSON.stringify({
            schema_version: 1,
            stage: "parse_error",
            source_id: "vercel-models",
            error_name: "Error",
            message: "Model page missing provider column",
          }),
        },
        candidate: { status: 0, stdout: cleanVercelCandidate, stderr: "" },
        targetCandidates: vercelUnstructuredTarget,
      }).ok,
    ).toBe(true);

    // Two distinct dependency parse failures OR omitted dependency failures MUST NOT pass when baseline only reproduces one.
    const twoDepFailTarget = [
      {
        provider_id: "nvidia",
        scope: "source" as const,
        subject_id: "nvidia-nim-retrieval",
        source_id: "nvidia-nim-retrieval",
        trigger: "source_parse_failure" as const,
        dependency_parse_failures: [
          { dependency_id: "dep-a", message: "Metadata missing" },
          { dependency_id: "dep-b", message: "Table missing" },
        ],
        message:
          "Dependency evidence requires investigation: dep-a: Metadata missing; dep-b: Table missing",
        diagnostics: [],
      },
    ];
    const cleanNvidiaCandidate = JSON.stringify({
      schema_version: 1,
      stage: "parse",
      source_id: "nvidia-nim-retrieval",
      models: [{ uid: "nvidia/m1" }],
      contract_findings: [],
    });
    expect(
      evaluateBeforeAfterReplay({
        sourceId: "nvidia-nim-retrieval",
        baseline: {
          status: 1,
          stdout: "",
          stderr: JSON.stringify({
            schema_version: 1,
            stage: "parse_error",
            source_id: "nvidia-nim-retrieval",
            error_name: "Error",
            message: "Metadata missing",
          }),
        },
        candidate: { status: 0, stdout: cleanNvidiaCandidate, stderr: "" },
        targetCandidates: twoDepFailTarget,
      }).ok,
    ).toBe(false);
    expect(
      evaluateBeforeAfterReplay({
        sourceId: "nvidia-nim-retrieval",
        baseline: {
          status: 1,
          stdout: "",
          stderr: JSON.stringify({
            schema_version: 1,
            stage: "parse_error",
            source_id: "nvidia-nim-retrieval",
            error_name: "Error",
            message: "Metadata missing",
          }),
        },
        candidate: { status: 0, stdout: cleanNvidiaCandidate, stderr: "" },
        targetCandidates: [
          {
            provider_id: "nvidia",
            scope: "source" as const,
            subject_id: "nvidia-nim-retrieval",
            source_id: "nvidia-nim-retrieval",
            trigger: "source_parse_failure" as const,
            dependency_failures_omitted: 1,
            message:
              "Dependency evidence requires investigation: dep-a: Metadata missing; additional failures omitted",
            diagnostics: [],
          },
        ],
      }).ok,
    ).toBe(false);

    // Candidate in source_parse_failure branch introducing NEW drift or reconciliation diagnostics MUST be rejected!
    expect(
      evaluateBeforeAfterReplay({
        sourceId: "vercel-models",
        baseline: {
          status: 1,
          stdout: "",
          stderr: JSON.stringify({
            schema_version: 1,
            stage: "parse_error",
            source_id: "vercel-models",
            error_name: "Error",
            message: "Model page missing provider column",
          }),
        },
        candidate: {
          status: 0,
          stdout: JSON.stringify({
            schema_version: 1,
            stage: "parse",
            source_id: "vercel-models",
            models: [{ uid: "vercel/m1" }],
            contract_findings: [
              {
                diagnostics: [
                  { kind: "missing_required_field", path: "/models", affected_items: 20 },
                ],
              },
            ],
            reconciliation: { reason_counts: { pricing_policy_unavailable: 1 } },
          }),
          stderr: "",
        },
        targetCandidates: vercelUnstructuredTarget,
      }).ok,
    ).toBe(false);

    // Redacted URL (`[source]`) in target message:
    // - Same failing page with matching error_fingerprint -> ACCEPTED
    // - Different failing page (release-a vs release-b) -> REJECTED
    // - Generic redacted text WITHOUT error_fingerprint or source_hash -> REJECTED
    const kimiPageAErr = new Error(
      "Unexpected Kimi release page: https://platform.moonshot.cn/docs/release-a",
    );
    const kimiPageBErr = new Error(
      "Unexpected Kimi release page: https://platform.moonshot.cn/docs/release-b",
    );
    const cleanKimiCandidate = JSON.stringify({
      schema_version: 1,
      stage: "parse",
      source_id: "kimi-releases",
      models: [{ uid: "kimi/m1" }],
      contract_findings: [],
    });
    expect(
      evaluateBeforeAfterReplay({
        sourceId: "kimi-releases",
        baseline: {
          status: 1,
          stdout: "",
          stderr: JSON.stringify({
            schema_version: 1,
            stage: "parse_error",
            source_id: "kimi-releases",
            error_name: "Error",
            error_fingerprint: sourceErrorFingerprint(kimiPageAErr),
            message: "Unexpected Kimi release page: [source]",
          }),
        },
        candidate: { status: 0, stdout: cleanKimiCandidate, stderr: "" },
        targetCandidates: [
          {
            provider_id: "kimi",
            scope: "source" as const,
            subject_id: "kimi-releases",
            source_id: "kimi-releases",
            trigger: "source_parse_failure" as const,
            error_fingerprint: sourceErrorFingerprint(kimiPageAErr),
            message: "Unexpected Kimi release page: [source]",
            diagnostics: [],
          },
        ],
      }).ok,
    ).toBe(true);
    expect(
      evaluateBeforeAfterReplay({
        sourceId: "kimi-releases",
        baseline: {
          status: 1,
          stdout: "",
          stderr: JSON.stringify({
            schema_version: 1,
            stage: "parse_error",
            source_id: "kimi-releases",
            error_name: "Error",
            error_fingerprint: sourceErrorFingerprint(kimiPageBErr),
            message: "Unexpected Kimi release page: [source]",
          }),
        },
        candidate: { status: 0, stdout: cleanKimiCandidate, stderr: "" },
        targetCandidates: [
          {
            provider_id: "kimi",
            scope: "source" as const,
            subject_id: "kimi-releases",
            source_id: "kimi-releases",
            trigger: "source_parse_failure" as const,
            error_fingerprint: sourceErrorFingerprint(kimiPageAErr),
            message: "Unexpected Kimi release page: [source]",
            diagnostics: [],
          },
        ],
      }).ok,
    ).toBe(false);
    expect(
      evaluateBeforeAfterReplay({
        sourceId: "kimi-releases",
        baseline: {
          status: 1,
          stdout: "",
          stderr: JSON.stringify({
            schema_version: 1,
            stage: "parse_error",
            source_id: "kimi-releases",
            error_name: "Error",
            error_fingerprint: sourceErrorFingerprint(kimiPageBErr),
            message: "Unexpected Kimi release page: [source]",
          }),
        },
        candidate: { status: 0, stdout: cleanKimiCandidate, stderr: "" },
        targetCandidates: [
          {
            provider_id: "kimi",
            scope: "source" as const,
            subject_id: "kimi-releases",
            source_id: "kimi-releases",
            trigger: "source_parse_failure" as const,
            message: "Unexpected Kimi release page: [source]",
            diagnostics: [],
          },
        ],
      }).ok,
    ).toBe(false);

    // Pre-throw accumulated diagnostics (e.g. Vercel missing /name before throwing index error) preserved on parse_error MUST verify cleanly.
    expect(
      evaluateBeforeAfterReplay({
        sourceId: "vercel-models",
        baseline: {
          status: 1,
          stdout: "",
          stderr: JSON.stringify({
            schema_version: 1,
            stage: "parse_error",
            source_id: "vercel-models",
            error_name: "Error",
            message: "Vercel bundle index URL changed",
            contract_findings: [
              {
                diagnostics: [{ kind: "missing_required_field", path: "/name", affected_items: 1 }],
              },
            ],
            contract_diagnostic_counts: { "missing_required_field:/name": 1 },
          }),
        },
        candidate: { status: 0, stdout: cleanVercelCandidate, stderr: "" },
        targetCandidates: [
          {
            provider_id: "vercel",
            scope: "source" as const,
            subject_id: "vercel-models",
            source_id: "vercel-models",
            trigger: "source_parse_failure" as const,
            message: "Vercel bundle index URL changed",
            diagnostics: [{ kind: "missing_required_field", path: "/name", affected_items: 1 }],
          },
        ],
      }).ok,
    ).toBe(true);
    // Legacy report with pre-throw `/name` diagnostic MUST STILL reject a DIFFERENT final terminating exception!
    expect(
      evaluateBeforeAfterReplay({
        sourceId: "vercel-models",
        baseline: {
          status: 1,
          stdout: "",
          stderr: JSON.stringify({
            schema_version: 1,
            stage: "parse_error",
            source_id: "vercel-models",
            error_name: "Error",
            message: "Vercel endpoints JSON invalid",
            contract_findings: [
              {
                diagnostics: [{ kind: "missing_required_field", path: "/name", affected_items: 1 }],
              },
            ],
            contract_diagnostic_counts: { "missing_required_field:/name": 1 },
          }),
        },
        candidate: { status: 0, stdout: cleanVercelCandidate, stderr: "" },
        targetCandidates: [
          {
            provider_id: "vercel",
            scope: "source" as const,
            subject_id: "vercel-models",
            source_id: "vercel-models",
            trigger: "source_parse_failure" as const,
            message: "Vercel bundle index URL changed",
            diagnostics: [{ kind: "missing_required_field", path: "/name", affected_items: 1 }],
          },
        ],
      }).ok,
    ).toBe(false);

    // Raw 1,024-char truncated message containing consecutive spaces (which shrinks below 1,024 after normalization)
    // WITHOUT error_fingerprint or source_hash MUST still be rejected as ambiguous truncation.
    const truncatedSpacedMsg = `Vercel pricing script failed: ${"  ".repeat(497)}`;
    expect(truncatedSpacedMsg.length).toBe(1024);
    expect(
      evaluateBeforeAfterReplay({
        sourceId: "vercel-models",
        baseline: {
          status: 1,
          stdout: "",
          stderr: JSON.stringify({
            schema_version: 1,
            stage: "parse_error",
            source_id: "vercel-models",
            error_name: "Error",
            message: truncatedSpacedMsg,
          }),
        },
        candidate: { status: 0, stdout: cleanVercelCandidate, stderr: "" },
        targetCandidates: [
          {
            provider_id: "vercel",
            scope: "source" as const,
            subject_id: "vercel-models",
            source_id: "vercel-models",
            trigger: "source_parse_failure" as const,
            message: truncatedSpacedMsg,
            diagnostics: [],
          },
        ],
      }).ok,
    ).toBe(false);

    // After fixing a parse failure, 17 benign `unknown_field` (`accept_with_signal`) findings that overflow the 16-item
    // display summary MUST pass when complete replay counts confirm 0 drift and 0 reject findings (while legacy summaries without complete counts reject).
    const ext17Collector = createContractFindingCollector();
    for (let i = 1; i <= 17; i += 1) {
      const idx = String(i).padStart(2, "0");
      ext17Collector.add({
        disposition: "accept_with_signal",
        observed_items: 1,
        diagnostic_count: 1,
        diagnostics: [
          {
            fingerprint: idx.padEnd(16, "a"),
            kind: "unknown_field",
            path: `/extra_${idx}`,
            observed: "string",
            affected_items: 1,
          },
        ],
      });
    }
    const cand17Extensions = JSON.stringify({
      schema_version: 1,
      stage: "parse",
      source_id: "vercel-models",
      models: [{ uid: "vercel/m1" }],
      ...ext17Collector.summary(),
      contract_findings_total: ext17Collector.replayCounts().total_findings,
      contract_reject_findings: ext17Collector.replayCounts().reject_findings,
      contract_diagnostic_counts: ext17Collector.replayCounts().diagnostic_counts,
    });
    const cand17LegacyIncomplete = JSON.stringify({
      schema_version: 1,
      stage: "parse",
      source_id: "vercel-models",
      models: [{ uid: "vercel/m1" }],
      ...ext17Collector.summary(),
    });
    expect(
      evaluateBeforeAfterReplay({
        sourceId: "vercel-models",
        baseline: {
          status: 1,
          stdout: "",
          stderr: JSON.stringify({
            schema_version: 1,
            stage: "parse_error",
            source_id: "vercel-models",
            error_name: "Error",
            message: "Model page missing provider column",
          }),
        },
        candidate: { status: 0, stdout: cand17Extensions, stderr: "" },
        targetCandidates: vercelUnstructuredTarget,
      }).ok,
    ).toBe(true);
    expect(
      evaluateBeforeAfterReplay({
        sourceId: "vercel-models",
        baseline: {
          status: 1,
          stdout: "",
          stderr: JSON.stringify({
            schema_version: 1,
            stage: "parse_error",
            source_id: "vercel-models",
            error_name: "Error",
            message: "Model page missing provider column",
          }),
        },
        candidate: { status: 0, stdout: cand17LegacyIncomplete, stderr: "" },
        targetCandidates: vercelUnstructuredTarget,
      }).ok,
    ).toBe(false);

    // Strict schema `disposition: "reject"` unknown_field paths (/alpha + /beta vs /alpha + /gamma)
    // MUST be checked individually (never skipped as benign accept_with_signal unknown_field).
    const strictRejectTarget = [
      {
        provider_id: "vercel",
        scope: "source" as const,
        subject_id: "vercel-models",
        source_id: "vercel-models",
        trigger: "source_parse_failure" as const,
        message: "Vercel model contract mismatch: unknown_field at /alpha (1 more)",
        diagnostics: [
          {
            kind: "unknown_field",
            path: "/alpha",
            affected_items: 1,
            disposition: "reject" as const,
          },
          {
            kind: "unknown_field",
            path: "/beta",
            affected_items: 1,
            disposition: "reject" as const,
          },
        ],
      },
    ];
    expect(
      evaluateBeforeAfterReplay({
        sourceId: "vercel-models",
        baseline: {
          status: 1,
          stdout: "",
          stderr: JSON.stringify({
            schema_version: 1,
            stage: "parse_error",
            source_id: "vercel-models",
            error_name: "SourceContractError",
            message: "Vercel model contract mismatch: unknown_field at /alpha (1 more)",
            contract_finding: {
              disposition: "reject",
              diagnostics: [
                { kind: "unknown_field", path: "/alpha", affected_items: 1 },
                { kind: "unknown_field", path: "/gamma", affected_items: 1 },
              ],
            },
          }),
        },
        candidate: { status: 0, stdout: cleanVercelCandidate, stderr: "" },
        targetCandidates: strictRejectTarget,
      }).ok,
    ).toBe(false);
    expect(
      evaluateBeforeAfterReplay({
        sourceId: "vercel-models",
        baseline: {
          status: 1,
          stdout: "",
          stderr: JSON.stringify({
            schema_version: 1,
            stage: "parse_error",
            source_id: "vercel-models",
            error_name: "SourceContractError",
            message: "Vercel model contract mismatch: unknown_field at /alpha (1 more)",
            contract_finding: {
              disposition: "reject",
              diagnostics: [
                { kind: "unknown_field", path: "/alpha", affected_items: 1 },
                { kind: "unknown_field", path: "/beta", affected_items: 1 },
              ],
            },
          }),
        },
        candidate: { status: 0, stdout: cleanVercelCandidate, stderr: "" },
        targetCandidates: strictRejectTarget,
      }).ok,
    ).toBe(true);

    // Downgrading a strict `reject / unknown_field` on `/display_label` to `accept_with_signal / unknown_field`
    // (matching the repository's reviewed extension handling, e.g. Vercel 697a8b0e) MUST pass when reject count drops to 0,
    // while keeping `disposition: "reject"` on `/display_label` MUST still fail!
    const displayLabelRejectTarget = [
      {
        provider_id: "vercel",
        scope: "source" as const,
        subject_id: "vercel-models",
        source_id: "vercel-models",
        trigger: "source_parse_failure" as const,
        message: "Vercel model contract mismatch: unknown_field at /display_label",
        diagnostics: [
          {
            kind: "unknown_field",
            path: "/display_label",
            affected_items: 1,
            disposition: "reject" as const,
          },
        ],
      },
    ];
    const displayLabelBaseline = {
      status: 1,
      stdout: "",
      stderr: JSON.stringify({
        schema_version: 1,
        stage: "parse_error",
        source_id: "vercel-models",
        error_name: "SourceContractError",
        message: "Vercel model contract mismatch: unknown_field at /display_label",
        contract_finding: {
          disposition: "reject",
          diagnostics: [{ kind: "unknown_field", path: "/display_label", affected_items: 1 }],
        },
      }),
    };
    const candDowngradedHint = JSON.stringify({
      schema_version: 1,
      stage: "parse",
      source_id: "vercel-models",
      models: [{ uid: "vercel/m1" }],
      contract_findings: [
        {
          disposition: "accept_with_signal",
          diagnostics: [{ kind: "unknown_field", path: "/display_label", affected_items: 1 }],
        },
      ],
      contract_findings_total: 1,
      contract_reject_findings: 0,
      contract_diagnostic_counts: { "unknown_field:/display_label": 1 },
      contract_reject_diagnostic_counts: {},
    });
    const candStillRejecting = JSON.stringify({
      schema_version: 1,
      stage: "parse",
      source_id: "vercel-models",
      models: [{ uid: "vercel/m1" }],
      contract_findings: [
        {
          disposition: "reject",
          diagnostics: [{ kind: "unknown_field", path: "/display_label", affected_items: 1 }],
        },
      ],
      contract_findings_total: 1,
      contract_reject_findings: 1,
      contract_diagnostic_counts: { "unknown_field:/display_label": 1 },
      contract_reject_diagnostic_counts: { "unknown_field:/display_label": 1 },
    });
    expect(
      evaluateBeforeAfterReplay({
        sourceId: "vercel-models",
        baseline: displayLabelBaseline,
        candidate: { status: 0, stdout: candDowngradedHint, stderr: "" },
        targetCandidates: displayLabelRejectTarget,
      }).ok,
    ).toBe(true);
    expect(
      evaluateBeforeAfterReplay({
        sourceId: "vercel-models",
        baseline: displayLabelBaseline,
        candidate: { status: 0, stdout: candStillRejecting, stderr: "" },
        targetCandidates: displayLabelRejectTarget,
      }).ok,
    ).toBe(false);
    // Same downgrade in summary-mode (`skipInvalidItems: true`, exit 0 on baseline):
    // reject count drops 1 -> 0 while accept_with_signal hint remains -> ACCEPTED; still rejecting -> REJECTED.
    const summaryRejectTarget = [
      {
        ...displayLabelRejectTarget[0]!,
        trigger: "source_contract_change" as const,
      },
    ];
    expect(
      evaluateBeforeAfterReplay({
        sourceId: "vercel-models",
        baseline: { status: 0, stdout: candStillRejecting, stderr: "" },
        candidate: { status: 0, stdout: candDowngradedHint, stderr: "" },
        targetCandidates: summaryRejectTarget,
      }).ok,
    ).toBe(true);
    expect(
      evaluateBeforeAfterReplay({
        sourceId: "vercel-models",
        baseline: { status: 0, stdout: candStillRejecting, stderr: "" },
        candidate: { status: 0, stdout: candStillRejecting, stderr: "" },
        targetCandidates: summaryRejectTarget,
      }).ok,
    ).toBe(false);

    // Case-sensitive model identifier keys (`Model-X` vs `model-x`) MUST remain distinguishable on legacy reports without fingerprint.
    expect(
      evaluateBeforeAfterReplay({
        sourceId: "vercel-models",
        baseline: {
          status: 1,
          stdout: "",
          stderr: JSON.stringify({
            schema_version: 1,
            stage: "parse_error",
            source_id: "vercel-models",
            error_name: "Error",
            message: "Vercel pricing registry missing key model-x",
          }),
        },
        candidate: { status: 0, stdout: cleanVercelCandidate, stderr: "" },
        targetCandidates: [
          {
            provider_id: "vercel",
            scope: "source" as const,
            subject_id: "vercel-models",
            source_id: "vercel-models",
            trigger: "source_parse_failure" as const,
            message: "Vercel pricing registry missing key Model-X",
            diagnostics: [],
          },
        ],
      }).ok,
    ).toBe(false);

    // Single finding with >8 diagnostics (second-layer maxDiagnostics truncation inside aggregateEvidence):
    // 1) Growing from 9 missing fields to 27 missing fields while top 8 decrease MUST be REJECTED (new regressions beyond #8).
    // 2) Fixing top 8 missing fields while retaining pre-existing #9 MUST be ACCEPTED (not false 0 -> 1 regression).
    const makeWideItemSchema = (count: number) =>
      z.object(
        Object.fromEntries(
          Array.from({ length: count }, (_, i) => [
            `f${String(i + 1).padStart(2, "0")}`,
            z.string(),
          ]),
        ),
      );
    const collectWideSummary = (missingFields: number[], rowCount: number) => {
      const schema = makeWideItemSchema(27);
      const item = Object.fromEntries(
        Array.from({ length: 27 }, (_, i) => [
          `f${String(i + 1).padStart(2, "0")}`,
          missingFields.includes(i + 1) ? undefined : "ok",
        ]),
      );
      const collector = createContractFindingCollector();
      recognizeItems({
        label: "wide-test",
        items: Array.from({ length: rowCount }, () => ({ ...item })),
        schema,
        skipInvalidItems: true,
        onFinding: collector.add,
      });
      return JSON.stringify({
        schema_version: 1,
        stage: "parse",
        source_id: "dashscope-pricing",
        models: [{ uid: "dashscope/m1" }],
        ...collector.summary(),
        contract_findings_total: collector.replayCounts().total_findings,
        contract_diagnostic_counts: collector.replayCounts().diagnostic_counts,
      });
    };
    const base9Wide = collectWideSummary([1, 2, 3, 4, 5, 6, 7, 8, 9], 3);
    const cand27Wide = collectWideSummary(
      Array.from({ length: 27 }, (_, i) => i + 1),
      2,
    );
    const candOnly9thWide = collectWideSummary([9], 3);
    const wideTarget = [
      {
        provider_id: "dashscope",
        scope: "source" as const,
        subject_id: "dashscope-pricing",
        source_id: "dashscope-pricing",
        trigger: "source_contract_change" as const,
        message: "Wide contract drift",
        diagnostics: [{ kind: "missing_required_field", path: "/f01", affected_items: 3 }],
      },
    ];
    expect(
      evaluateBeforeAfterReplay({
        sourceId: "dashscope-pricing",
        baseline: { status: 0, stdout: base9Wide, stderr: "" },
        candidate: { status: 0, stdout: cand27Wide, stderr: "" },
        targetCandidates: wideTarget,
      }).ok,
    ).toBe(false);
    expect(
      evaluateBeforeAfterReplay({
        sourceId: "dashscope-pricing",
        baseline: { status: 0, stdout: base9Wide, stderr: "" },
        candidate: { status: 0, stdout: candOnly9thWide, stderr: "" },
        targetCandidates: wideTarget,
      }).ok,
    ).toBe(true);

    // 17-finding summary cap: fixing findings #1..#16 while retaining pre-existing finding #17 MUST pass (not 0 -> 1 regression).
    const baseCollector = createContractFindingCollector();
    for (let i = 1; i <= 17; i += 1) {
      const idx = String(i).padStart(2, "0");
      baseCollector.add({
        disposition: "accept_with_signal",
        observed_items: 1,
        diagnostic_count: 1,
        diagnostics: [
          {
            fingerprint: idx.padEnd(16, "0"),
            kind: "missing_required_field",
            path: `/rows/${idx}`,
            observed: "missing",
            affected_items: 1,
          },
        ],
      });
    }
    const candCollector = createContractFindingCollector();
    candCollector.add({
      disposition: "accept_with_signal",
      observed_items: 1,
      diagnostic_count: 1,
      diagnostics: [
        {
          fingerprint: "17".padEnd(16, "0"),
          kind: "missing_required_field",
          path: "/rows/17",
          observed: "missing",
          affected_items: 1,
        },
      ],
    });
    const base17Summary = JSON.stringify({
      schema_version: 1,
      stage: "parse",
      source_id: "dashscope-pricing",
      models: [{ uid: "dashscope/m1" }],
      ...baseCollector.summary(),
      contract_findings_total: baseCollector.replayCounts().total_findings,
      contract_diagnostic_counts: baseCollector.replayCounts().diagnostic_counts,
    });
    const cand17Summary = JSON.stringify({
      schema_version: 1,
      stage: "parse",
      source_id: "dashscope-pricing",
      models: [{ uid: "dashscope/m1" }],
      ...candCollector.summary(),
      contract_findings_total: candCollector.replayCounts().total_findings,
      contract_diagnostic_counts: candCollector.replayCounts().diagnostic_counts,
    });
    expect(
      evaluateBeforeAfterReplay({
        sourceId: "dashscope-pricing",
        baseline: { status: 0, stdout: base17Summary, stderr: "" },
        candidate: { status: 0, stdout: cand17Summary, stderr: "" },
        targetCandidates: [
          {
            provider_id: "dashscope",
            scope: "source" as const,
            subject_id: "dashscope-pricing",
            source_id: "dashscope-pricing",
            trigger: "source_contract_change" as const,
            message: "DashScope contract drift",
            diagnostics: [{ kind: "missing_required_field", path: "/rows/01", affected_items: 1 }],
          },
        ],
      }).ok,
    ).toBe(true);
    const otherSourceStructuredErr = JSON.stringify({
      schema_version: 1,
      stage: "parse_error",
      source_id: "openai-pricing",
      error_name: "SourceContractError",
      message: "Wrong source: missing_required_field at /documents",
      contract_finding: {
        diagnostics: [{ kind: "missing_required_field", path: "/documents", affected_items: 1 }],
      },
    });
    expect(
      evaluateBeforeAfterReplay({
        sourceId: "fireworks-serverless",
        baseline: { status: 1, stdout: "", stderr: otherSourceStructuredErr },
        candidate: { status: 0, stdout: cleanFireworksCandidate, stderr: "" },
        targetCandidates: fireworksParseFailureTarget,
      }).ok,
    ).toBe(false);
    expect(
      evaluateBeforeAfterReplay({
        sourceId: "fireworks-serverless",
        baseline: {
          status: 0,
          stdout: JSON.stringify({
            schema_version: 1,
            stage: "parse",
            source_id: "fireworks-serverless",
            models: [{ uid: "fireworks/m1" }],
            contract_findings: [
              {
                diagnostics: [
                  { kind: "missing_required_field", path: "/documents", affected_items: 1 },
                ],
              },
            ],
          }),
          stderr: "",
        },
        candidate: { status: 0, stdout: cleanFireworksCandidate, stderr: "" },
        targetCandidates: fireworksParseFailureTarget,
      }).ok,
    ).toBe(false);

    // Browser prerequisite planner detection
    expect(needsBrowserPrerequisite([["check"], ["run", "test:e2e"]])).toBe(true);
    expect(needsBrowserPrerequisite([["run", "test:pricing-performance"]])).toBe(true);
    expect(needsBrowserPrerequisite([["check"], ["test", "related"]])).toBe(false);
  });

  it("audits untracked files, deleted thresholds, per-source thresholds, and >2 MiB fixture diffs without ENOBUFS", async () => {
    const beforeSource = [
      '  { id: "source-a", minModels: 10 },',
      '  { id: "source-b", minModels: 50 },',
    ].join("\n");
    const raisedBoth = [
      '  { id: "source-a", minModels: 12 },',
      '  { id: "source-b", minModels: 55 },',
    ].join("\n");
    expect(
      auditDiffSafety("", {
        beforeFiles: { "src/catalog/manifests.ts": beforeSource },
        afterFiles: { "src/catalog/manifests.ts": raisedBoth },
      }),
    ).toEqual([]);
    expect(extractSourceThresholds(beforeSource).get("source-a:minModels")).toBe(10);

    const repo = await makeTempDir("kmodels-large-diff-");
    git(["init", "-b", "main"], repo);
    git(["config", "user.email", "test@example.com"], repo);
    git(["config", "user.name", "Test"], repo);
    await mkdir(join(repo, "tests/fixtures/fireworks"), { recursive: true });
    const bigLine = "a".repeat(2 * 1024 * 1024);
    await writeFile(join(repo, "tests/fixtures/fireworks/big.html"), `${bigLine}\n`);
    git(["add", "."], repo);
    git(["commit", "-m", "init"], repo);
    await writeFile(join(repo, "tests/fixtures/fireworks/big.html"), `${bigLine} \n`);

    const verdict = runSelfHealGate({
      cwd: repo,
      base: "HEAD",
      targetProvider: "fireworks",
      requireEvidenceReplay: false,
      skipValidation: true,
    });
    expect(verdict.ok).toBe(true);
    expect(verdict.mode).toBe("auto_push");
    expect(verdict.changed_files).toEqual(["tests/fixtures/fireworks/big.html"]);
  });
});

describe("self-heal zero-cost end-to-end 4-job pipeline", () => {
  async function createTestFixtureRepos() {
    const root = await makeTempDir("kmodels-e2e-heal-");
    const bareRemote = join(root, "remote.git");
    const seedRepo = join(root, "seed");
    const artifactsDir = join(root, "external-artifacts");
    const evidenceDir = join(artifactsDir, "triage-packet/evidence");
    await mkdir(bareRemote, { recursive: true });
    await mkdir(seedRepo, { recursive: true });
    await mkdir(evidenceDir, { recursive: true });

    git(["init", "--bare", "-b", "main"], bareRemote);
    git(["init", "-b", "main"], seedRepo);
    git(["config", "user.email", "test@example.com"], seedRepo);
    git(["config", "user.name", "Test"], seedRepo);
    await mkdir(join(seedRepo, "src/catalog"), { recursive: true });
    await writeFile(join(seedRepo, "src/catalog/fireworks.ts"), "export const v = 1;\n");
    await writeFile(join(seedRepo, "src/catalog/openai.ts"), "export const v = 1;\n");
    git(["add", "."], seedRepo);
    git(["commit", "-m", "initial"], seedRepo);
    git(["remote", "add", "origin", bareRemote], seedRepo);
    git(["push", "-u", "origin", "main"], seedRepo);
    const baseSha = git(["rev-parse", "HEAD"], seedRepo);

    const cloneCheckout = (name: string) => {
      const dir = join(root, name);
      git(["clone", bareRemote, dir], root);
      git(["config", "user.email", "test@example.com"], dir);
      git(["config", "user.name", "Test"], dir);
      return dir;
    };

    const triagePath = join(artifactsDir, "triage-packet/target.json");
    const triageTarget = selectSelfHealTarget(makeRefreshReport([]), [
      {
        provider_id: "fireworks",
        checked_at: "2026-11-23T00:00:00.000Z",
        reason: "Quarantined validation mismatch",
      },
    ]);
    await writeFile(triagePath, `${JSON.stringify(triageTarget, null, 2)}\n`);

    return { root, bareRemote, baseSha, artifactsDir, evidenceDir, triagePath, cloneCheckout };
  }

  it("delivers an exact verified patch via generate -> isolated verify -> publish without leaking workflow files", async () => {
    const { artifactsDir, evidenceDir, triagePath, cloneCheckout } = await createTestFixtureRepos();
    const genRepo = cloneCheckout("gen");
    const verifyRepo = cloneCheckout("verify");
    const publishRepo = cloneCheckout("publish");
    const proposalDir = join(artifactsDir, "proposal-out");
    const verifyDir = join(artifactsDir, "verify-out");
    const ledgerPath = join(artifactsDir, "budget-ledger.json");

    const gen = await runGenerate({
      cwd: genRepo,
      triageFile: triagePath,
      evidenceRoot: evidenceDir,
      outputDir: proposalDir,
      allowZeroEvidenceForTest: true,
      agentCommand:
        'printf "export const v = 2;\\n" > src/catalog/fireworks.ts && printf \'{"input_tokens":1000,"output_tokens":500,"estimated_usd":0.05}\' > "$SELF_HEAL_USAGE_FILE"',
    });
    expect(gen.hasPatch).toBe(true);
    expect(gen.proposal?.changed_files).toEqual(["src/catalog/fireworks.ts"]);

    const receipt = await runVerify({
      cwd: verifyRepo,
      triageFile: triagePath,
      evidenceRoot: evidenceDir,
      proposalDir,
      outputDir: verifyDir,
      requireEvidenceReplay: false,
      skipValidation: true,
    });
    expect(receipt.ok).toBe(true);
    expect(receipt.mode).toBe("auto_push");

    const published = await runPublish({
      cwd: publishRepo,
      triageFile: triagePath,
      proposalDir,
      verifyDir,
      verifyJobResult: "success",
      runId: "run-happy",
      runAttempt: 1,
      budgetLedgerPath: ledgerPath,
    });
    expect(published.outcome).toBe("auto_push");
    expect(published.published_sha).toBeDefined();

    // Remote main must adopt ONLY src/catalog/fireworks.ts (ZERO workflow/triage files).
    const committedFiles = git(
      ["diff-tree", "--no-commit-id", "--name-only", "-r", published.published_sha!],
      publishRepo,
    ).split("\n");
    expect(committedFiles).toEqual(["src/catalog/fireworks.ts"]);
  }, 15_000);

  it("refuses paid generation and rejects verification when any failing source or provider quarantine lacks bound evidence", async () => {
    const { artifactsDir, evidenceDir, triagePath, cloneCheckout } = await createTestFixtureRepos();
    const genRepo = cloneCheckout("gen");
    const verifyRepo = cloneCheckout("verify");
    const proposalDir = join(artifactsDir, "proposal-out");

    // 1. Standalone provider quarantine with 0 bound evidence refuses paid generation at $0.
    const zeroEvQuarantineGen = await runGenerate({
      cwd: genRepo,
      triageFile: triagePath,
      evidenceRoot: evidenceDir,
      outputDir: join(artifactsDir, "zero-ev-quarantine"),
      agentCommand: "echo SHOULD_NOT_RUN >&2; exit 99",
    });
    expect(zeroEvQuarantineGen.hasPatch).toBe(false);
    expect(zeroEvQuarantineGen.usage.attempts).toBe(0);
    expect(zeroEvQuarantineGen.usage.estimated_usd).toBe(0);

    // 2. Two failing sources with evidence for ONLY ONE source refuses paid generation AND fails verify.
    const partialEvTriage = join(artifactsDir, "partial-ev-target.json");
    await writeFile(
      partialEvTriage,
      JSON.stringify(
        selectSelfHealTarget(
          {
            generated_at: "2026-11-23T00:00:00.000Z",
            catalog_version: "a".repeat(64),
            providers: [
              {
                provider_id: "openai",
                signals: [],
                attempt: {
                  outcome: "rejected",
                  sources: [
                    {
                      source_id: "openai-models",
                      outcome: "parse_failed",
                      message: "models drifted",
                    },
                    {
                      source_id: "openai-pricing",
                      outcome: "parse_failed",
                      message: "pricing drifted",
                    },
                  ],
                },
              },
            ],
          },
          [],
          {
            evidenceFiles: [
              {
                source_id: "openai-pricing",
                relative_path: "openai-pricing.json.gz",
                source_hash: "a".repeat(64),
                sha256: "b".repeat(64),
              },
            ],
          },
        ),
      ),
    );
    const partialGen = await runGenerate({
      cwd: genRepo,
      triageFile: partialEvTriage,
      evidenceRoot: evidenceDir,
      outputDir: join(artifactsDir, "partial-gen"),
      agentCommand: "echo SHOULD_NOT_RUN >&2; exit 99",
    });
    expect(partialGen.hasPatch).toBe(false);
    expect(partialGen.usage.attempts).toBe(0);
    expect(partialGen.usage.error).toContain("openai-models");

    // Generate a syntactically valid openai proposal (bypassing evidence only in test helper) and confirm verify rejects missing source evidence.
    const openaiQuarantineTriage = join(artifactsDir, "openai-quarantine-target.json");
    await writeFile(
      openaiQuarantineTriage,
      JSON.stringify(
        selectSelfHealTarget(makeRefreshReport([]), [
          {
            provider_id: "openai",
            checked_at: "2026-11-23T00:00:00.000Z",
            reason: "Quarantined validation mismatch",
          },
        ]),
      ),
    );
    await runGenerate({
      cwd: genRepo,
      triageFile: openaiQuarantineTriage,
      evidenceRoot: evidenceDir,
      outputDir: proposalDir,
      allowZeroEvidenceForTest: true,
      agentCommand:
        'printf "export const v = 2;\\n" > src/catalog/openai.ts && printf \'{"input_tokens":100,"output_tokens":50,"estimated_usd":0.01}\' > "$SELF_HEAL_USAGE_FILE"',
    });
    const partialReceipt = await runVerify({
      cwd: verifyRepo,
      triageFile: partialEvTriage,
      evidenceRoot: evidenceDir,
      proposalDir,
      outputDir: join(artifactsDir, "partial-verify"),
      skipValidation: true,
    });
    expect(partialReceipt.ok).toBe(false);
    expect(
      partialReceipt.violations.some((v) =>
        v.includes("Missing bound evidence for target source(s): openai-models"),
      ),
    ).toBe(true);
  }, 15_000);

  it("subtracts remaining per-run budget before attempt 2 and stops retrying immediately when usage is unreported", async () => {
    const { artifactsDir, evidenceDir, triagePath, cloneCheckout } = await createTestFixtureRepos();
    const repo = cloneCheckout("budget-gen");

    // Unknown usage on attempt 1 stops immediately after 1 attempt.
    const failGen = await runGenerate({
      cwd: repo,
      triageFile: triagePath,
      evidenceRoot: evidenceDir,
      outputDir: join(artifactsDir, "fail-proposal"),
      allowZeroEvidenceForTest: true,
      agentCommand: "exit 1",
    });
    expect(failGen.hasPatch).toBe(false);
    expect(failGen.usage.attempts).toBe(1);
    expect(failGen.usage.usage_known).toBe(false);
    expect(failGen.usage.estimated_usd).toBeNull();

    // Known attempt 1 spend ($1.25 of $2.00) passes remaining $0.75 to attempt 2 and rejects on $2.50 cumulative spend.
    const seenLimitsPath = join(artifactsDir, "seen-limits.log");
    const prevMaxUsd = process.env.SELF_HEAL_MAX_RUN_USD;
    process.env.SELF_HEAL_MAX_RUN_USD = "2";
    try {
      const retryGen = await runGenerate({
        cwd: repo,
        triageFile: triagePath,
        evidenceRoot: evidenceDir,
        outputDir: join(artifactsDir, "retry-proposal"),
        allowZeroEvidenceForTest: true,
        agentCommand: `printf '%s\\n' "$SELF_HEAL_MAX_RUN_USD" >> ${JSON.stringify(seenLimitsPath)} && printf '{"input_tokens":1000,"output_tokens":500,"estimated_usd":1.25}' > "$SELF_HEAL_USAGE_FILE"`,
      });
      expect(retryGen.hasPatch).toBe(false);
      expect(retryGen.usage.status).toBe("budget_exceeded");
      expect(retryGen.usage.attempts).toBe(2);
      expect(retryGen.usage.estimated_usd).toBe(2.5);
      expect((await readFile(seenLimitsPath, "utf8")).trim().split("\n")).toEqual(["2", "0.75"]);

      // Two attempts reporting $0.10 + $0.20 under a $0.30 per-run cap MUST equal $0.30 (not fail with budget_exceeded due to IEEE-754 float drift).
      process.env.SELF_HEAL_MAX_RUN_USD = "0.3";
      const countFile = join(artifactsDir, "exact-run-count.txt");
      const exactSumGen = await runGenerate({
        cwd: repo,
        triageFile: triagePath,
        evidenceRoot: evidenceDir,
        outputDir: join(artifactsDir, "exact-sum-proposal"),
        allowZeroEvidenceForTest: true,
        agentCommand: `n=$(($(cat ${JSON.stringify(countFile)} 2>/dev/null || echo 0) + 1)); echo "$n" > ${JSON.stringify(countFile)}; if [ "$n" -eq 1 ]; then printf '{"input_tokens":100,"output_tokens":50,"estimated_usd":0.1}' > "$SELF_HEAL_USAGE_FILE"; else printf '{"input_tokens":100,"output_tokens":50,"estimated_usd":0.2}' > "$SELF_HEAL_USAGE_FILE"; fi`,
      });
      expect(exactSumGen.hasPatch).toBe(false);
      expect(exactSumGen.usage.attempts).toBe(2);
      expect(exactSumGen.usage.estimated_usd).toBe(0.3);
      expect(exactSumGen.usage.status).toBe("no_patch");

      // Sub-microdollar fractions ($0.10000049 + $0.20000049 = $0.30000098) MUST round the cumulative total to $0.300001 (never $0.300000).
      process.env.SELF_HEAL_MAX_RUN_USD = "1";
      const subMicroCountFile = join(artifactsDir, "submicro-count.txt");
      const subMicroGen = await runGenerate({
        cwd: repo,
        triageFile: triagePath,
        evidenceRoot: evidenceDir,
        outputDir: join(artifactsDir, "submicro-proposal"),
        allowZeroEvidenceForTest: true,
        agentCommand: `n=$(($(cat ${JSON.stringify(subMicroCountFile)} 2>/dev/null || echo 0) + 1)); echo "$n" > ${JSON.stringify(subMicroCountFile)}; if [ "$n" -eq 1 ]; then printf '{"input_tokens":100,"output_tokens":50,"estimated_usd":0.10000049}' > "$SELF_HEAL_USAGE_FILE"; else printf '{"input_tokens":100,"output_tokens":50,"estimated_usd":0.20000049}' > "$SELF_HEAL_USAGE_FILE"; fi`,
      });
      expect(subMicroGen.usage.attempts).toBe(2);
      expect(subMicroGen.usage.estimated_usd).toBe(0.300001);

      // Overflowing estimated_usd (1e303) MUST be discarded without throwing ZodError while preserving valid token counts.
      const overflowUsdGen = await runGenerate({
        cwd: repo,
        triageFile: triagePath,
        evidenceRoot: evidenceDir,
        outputDir: join(artifactsDir, "overflow-usd-proposal"),
        allowZeroEvidenceForTest: true,
        agentCommand:
          'printf \'{"input_tokens":1000,"output_tokens":500,"estimated_usd":1e303}\' > "$SELF_HEAL_USAGE_FILE"',
      });
      expect(overflowUsdGen.usage.usage_known).toBe(false);
      expect(overflowUsdGen.usage.estimated_usd).toBeNull();
      expect(overflowUsdGen.usage.input_tokens).toBe(1_000);
      expect(overflowUsdGen.usage.output_tokens).toBe(500);
    } finally {
      if (prevMaxUsd === undefined) delete process.env.SELF_HEAL_MAX_RUN_USD;
      else process.env.SELF_HEAL_MAX_RUN_USD = prevMaxUsd;
    }

    // Legacy packet containing BOTH Page A and Page B for a Page A target MUST pass ONLY Page A into the agent prompt!
    const dualEvidenceTriage = join(artifactsDir, "dual-evidence-triage.json");
    const capturedPromptPath = join(artifactsDir, "captured-prompt.md");
    await writeFile(
      dualEvidenceTriage,
      JSON.stringify({
        status: "actionable",
        target: {
          provider_id: "kimi",
          quarantined: false,
          candidates: [
            {
              provider_id: "kimi",
              scope: "source",
              subject_id: "kimi-releases",
              source_id: "kimi-releases",
              trigger: "source_parse_failure",
              source_hash: "1".repeat(64),
              message: "Unexpected Kimi release page: [source]",
              diagnostics: [],
            },
          ],
          evidence_files: [
            {
              source_id: "kimi-releases",
              relative_path: "kimi-releases-a.json.gz",
              source_hash: "1".repeat(64),
              sha256: "a".repeat(64),
            },
            {
              source_id: "kimi-releases",
              relative_path: "kimi-releases-b.json.gz",
              source_hash: "2".repeat(64),
              sha256: "b".repeat(64),
            },
          ],
        },
      }),
    );
    await runGenerate({
      cwd: repo,
      triageFile: dualEvidenceTriage,
      evidenceRoot: evidenceDir,
      outputDir: join(artifactsDir, "dual-evidence-gen"),
      agentCommand: `cp "$SELF_HEAL_PROMPT_FILE" ${JSON.stringify(capturedPromptPath)} && exit 1`,
    });
    const capturedPrompt = await readFile(capturedPromptPath, "utf8");
    expect(capturedPrompt).toContain("kimi-releases-a.json.gz");
    expect(capturedPrompt).not.toContain("kimi-releases-b.json.gz");

    // Mismatched target.source_hash vs evidence_files.source_hash MUST stop generate at $0 (0 attempts) before invoking the agent!
    const mismatchedHashTriage = join(artifactsDir, "mismatched-hash-triage.json");
    await writeFile(
      mismatchedHashTriage,
      JSON.stringify({
        status: "actionable",
        target: {
          provider_id: "kimi",
          quarantined: false,
          candidates: [
            {
              provider_id: "kimi",
              scope: "source",
              subject_id: "kimi-releases",
              source_id: "kimi-releases",
              trigger: "source_parse_failure",
              source_hash: "1".repeat(64),
              message: "Unexpected Kimi release page: [source]",
              diagnostics: [],
            },
          ],
          evidence_files: [
            {
              source_id: "kimi-releases",
              relative_path: "kimi-releases-b.json.gz",
              source_hash: "2".repeat(64),
              sha256: "b".repeat(64),
            },
          ],
        },
      }),
    );
    const mismatchedHashGen = await runGenerate({
      cwd: repo,
      triageFile: mismatchedHashTriage,
      evidenceRoot: evidenceDir,
      outputDir: join(artifactsDir, "mismatched-hash-gen"),
      agentCommand: "echo SHOULD_NOT_RUN >&2; exit 99",
    });
    expect(mismatchedHashGen.hasPatch).toBe(false);
    expect(mismatchedHashGen.usage.attempts).toBe(0);
    expect(mismatchedHashGen.usage.estimated_usd).toBe(0);
  }, 15_000);

  it("settles budget on missing candidate.patch, failed verify job, failed git push, and deduplicates (run_id, run_attempt) retries", async () => {
    const { root, artifactsDir, evidenceDir, triagePath, cloneCheckout } =
      await createTestFixtureRepos();
    const genRepo = cloneCheckout("gen");
    const verifyRepo = cloneCheckout("verify");
    const publishRepo = cloneCheckout("publish");
    const proposalDir = join(artifactsDir, "proposal-out");
    const verifyDir = join(artifactsDir, "verify-out");
    const ledgerPath = join(artifactsDir, "budget-ledger.json");

    await runGenerate({
      cwd: genRepo,
      triageFile: triagePath,
      evidenceRoot: evidenceDir,
      outputDir: proposalDir,
      allowZeroEvidenceForTest: true,
      agentCommand:
        'printf "export const v = 2;\\n" > src/catalog/fireworks.ts && printf \'{"input_tokens":1000,"output_tokens":500,"estimated_usd":0.25}\' > "$SELF_HEAL_USAGE_FILE"',
    });
    await runVerify({
      cwd: verifyRepo,
      triageFile: triagePath,
      evidenceRoot: evidenceDir,
      proposalDir,
      outputDir: verifyDir,
      requireEvidenceReplay: false,
      skipValidation: true,
    });

    // 1. Missing candidate.patch with valid proposal.json + known $0.25 usage MUST settle ledger without throwing ENOENT.
    const missingPatchDir = join(artifactsDir, "missing-patch-proposal");
    await mkdir(missingPatchDir, { recursive: true });
    await writeFile(
      join(missingPatchDir, "proposal.json"),
      await readFile(join(proposalDir, "proposal.json"), "utf8"),
    );
    await writeFile(
      join(missingPatchDir, "usage.json"),
      await readFile(join(proposalDir, "usage.json"), "utf8"),
    );
    const missingPatchOutcome = await runPublish({
      cwd: publishRepo,
      triageFile: triagePath,
      proposalDir: missingPatchDir,
      verifyDir,
      runId: "run-missing-patch",
      runAttempt: 1,
      budgetLedgerPath: ledgerPath,
    });
    expect(missingPatchOutcome.outcome).toBe("rejected");
    expect(missingPatchOutcome.violations.some((v) => v.includes("ENOENT"))).toBe(true);
    let ledger = await readBudgetLedger(ledgerPath);
    expect(ledger.entries).toHaveLength(1);
    expect(ledger.entries[0]?.estimated_usd).toBe(0.25);

    // 2. Re-running settlement for the SAME (run_id, run_attempt) MUST deduplicate, never lower known spend,
    //    and NEVER mislabel a conservative unknown $2 reserve as `usage_known: true` when merging with known $0.25.
    const mergeNow = Date.parse("2026-11-23T12:00:00.000Z");
    const knownHighEntry = buildSettledBudgetEntry({
      run_id: "run-monotonic",
      run_attempt: 1,
      provider_id: "fireworks",
      recorded_at: "2026-11-23T10:00:00.000Z",
      usage: { usage_known: true, input_tokens: 12_000, output_tokens: 4_000, estimated_usd: 3.0 },
      outcome: "rejected",
    });
    const retryUnknownEntry = buildSettledBudgetEntry({
      run_id: "run-monotonic",
      run_attempt: 1,
      provider_id: "fireworks",
      recorded_at: "2026-11-23T10:05:00.000Z",
      usage: { usage_known: false, input_tokens: null, output_tokens: null, estimated_usd: null },
      outcome: "rejected",
    });
    const mergedHigh = appendBudgetEntry(
      appendBudgetEntry(emptyBudgetLedger(), knownHighEntry, { nowMs: mergeNow }),
      retryUnknownEntry,
      { nowMs: mergeNow },
    );
    expect(mergedHigh.entries).toHaveLength(1);
    expect(mergedHigh.entries[0]?.estimated_usd).toBe(3.0);
    expect(mergedHigh.entries[0]?.usage_known).toBe(true);
    expect(mergedHigh.entries[0]?.input_tokens).toBe(12_000);
    expect(mergedHigh.entries[0]?.output_tokens).toBe(4_000);
    expect(mergedHigh.entries[0]?.recorded_at).toBe("2026-11-23T10:00:00.000Z");

    const knownSmallEntry = buildSettledBudgetEntry({
      run_id: "run-small-known",
      run_attempt: 1,
      provider_id: "fireworks",
      recorded_at: "2026-11-23T10:00:00.000Z",
      usage: { usage_known: true, input_tokens: 1_000, output_tokens: 500, estimated_usd: 0.25 },
      outcome: "rejected",
    });
    const unknownReserveEntry = buildSettledBudgetEntry({
      run_id: "run-small-known",
      run_attempt: 1,
      provider_id: "fireworks",
      recorded_at: "2026-11-23T10:02:00.000Z",
      usage: { usage_known: false, input_tokens: null, output_tokens: null, estimated_usd: null },
      outcome: "rejected",
    });
    // Both orders (known -> unknown reserve, unknown reserve -> known) keep exact $0.25 with usage_known: true.
    for (const [first, second] of [
      [knownSmallEntry, unknownReserveEntry],
      [unknownReserveEntry, knownSmallEntry],
    ] as const) {
      const merged = appendBudgetEntry(
        appendBudgetEntry(emptyBudgetLedger(), first, { nowMs: mergeNow }),
        second,
        { nowMs: mergeNow },
      );
      expect(merged.entries).toHaveLength(1);
      expect(merged.entries[0]?.usage_known).toBe(true);
      expect(merged.entries[0]?.estimated_usd).toBe(0.25);
      expect(merged.entries[0]?.input_tokens).toBe(1_000);
    }

    // Incomplete usage that observed $3.00 (no tokens) merged with known $0.25 MUST preserve the $3.00 observed floor in BOTH orders!
    const incompleteHighFloorEntry = buildSettledBudgetEntry({
      run_id: "run-observed-floor",
      run_attempt: 1,
      provider_id: "fireworks",
      recorded_at: "2026-11-23T10:00:00.000Z",
      usage: { usage_known: false, input_tokens: null, output_tokens: null, estimated_usd: 3.0 },
      outcome: "rejected",
    });
    const knownLowerEntry = buildSettledBudgetEntry({
      run_id: "run-observed-floor",
      run_attempt: 1,
      provider_id: "fireworks",
      recorded_at: "2026-11-23T10:02:00.000Z",
      usage: { usage_known: true, input_tokens: 1_000, output_tokens: 500, estimated_usd: 0.25 },
      outcome: "rejected",
    });
    for (const [first, second] of [
      [incompleteHighFloorEntry, knownLowerEntry],
      [knownLowerEntry, incompleteHighFloorEntry],
    ] as const) {
      const merged = appendBudgetEntry(
        appendBudgetEntry(emptyBudgetLedger(), first, { nowMs: mergeNow }),
        second,
        { nowMs: mergeNow },
      );
      expect(merged.entries).toHaveLength(1);
      expect(merged.entries[0]?.usage_known).toBe(false);
      expect(merged.entries[0]?.estimated_usd).toBe(3.0);
      expect(merged.entries[0]?.observed_usd).toBe(3.0);
    }

    // Re-evaluating the same (run_id, run_attempt) with a lower $0.25 spend when ledger already observed $3.00
    // MUST still reject against per-run maxRunUsd ($2) even though rolling window ($10) has room.
    const highFloorLedger = appendBudgetEntry(emptyBudgetLedger(), incompleteHighFloorEntry, {
      nowMs: mergeNow,
    });
    const reEvalHighFloor = evaluateBudget(highFloorLedger, {
      nowMs: mergeNow,
      limits: { ...strictLimits, maxRunUsd: 2.0, maxWindowUsd: 10.0 },
      existingRunKey: { run_id: "run-observed-floor", run_attempt: 1 },
      runUsage: { usage_known: true, input_tokens: 1_000, output_tokens: 500, estimated_usd: 0.25 },
    });
    expect(reEvalHighFloor.allowed).toBe(false);
    expect(reEvalHighFloor.reasons.some((r) => r.includes("per-run cap"))).toBe(true);

    // Re-evaluating the same run AFTER >24 hours (25h later):
    // 1. Existing $3 observed spend MUST STILL reject against $2 per-run cap.
    const laterMs = Date.parse("2026-11-24T11:00:00.000Z"); // 25h after 2026-11-23T10:00:00.000Z
    const reEvalAgedHighFloor = evaluateBudget(highFloorLedger, {
      nowMs: laterMs,
      limits: { ...strictLimits, maxRunUsd: 2.0, maxWindowUsd: 10.0 },
      existingRunKey: { run_id: "run-observed-floor", run_attempt: 1 },
      runUsage: { usage_known: true, input_tokens: 1_000, output_tokens: 500, estimated_usd: 0.25 },
    });
    expect(reEvalAgedHighFloor.allowed).toBe(false);
    expect(reEvalAgedHighFloor.reasons.some((r) => r.includes("per-run cap"))).toBe(true);

    // 2. Reverse control: 25h-old $0.25 run + recent $0.30 other run under $0.40 window cap MUST NOT double-count the 25h-old run into the current window.
    let agedSmallLedger = appendBudgetEntry(
      emptyBudgetLedger(),
      buildSettledBudgetEntry({
        run_id: "run-aged-small",
        run_attempt: 1,
        provider_id: "fireworks",
        recorded_at: "2026-11-23T10:00:00.000Z",
        usage: { usage_known: true, input_tokens: 1_000, output_tokens: 500, estimated_usd: 0.25 },
        outcome: "rejected",
      }),
      { nowMs: laterMs },
    );
    agedSmallLedger = appendBudgetEntry(
      agedSmallLedger,
      buildSettledBudgetEntry({
        run_id: "run-recent-other",
        run_attempt: 1,
        provider_id: "openai",
        recorded_at: "2026-11-24T10:00:00.000Z",
        usage: { usage_known: true, input_tokens: 1_000, output_tokens: 500, estimated_usd: 0.3 },
        outcome: "auto_push",
      }),
      { nowMs: laterMs },
    );
    const reEvalAgedSmall = evaluateBudget(agedSmallLedger, {
      nowMs: laterMs,
      limits: { ...strictLimits, maxRunUsd: 2.0, maxWindowUsd: 0.4 },
      existingRunKey: { run_id: "run-aged-small", run_attempt: 1 },
      runUsage: { usage_known: true, input_tokens: 1_000, output_tokens: 500, estimated_usd: 0.25 },
    });
    expect(reEvalAgedSmall.allowed).toBe(true);

    // Partial agent usage receipt (reports $3 and 600,000 input_tokens, omits output_tokens):
    // generate MUST preserve both observed fields (never drop to null/$2 reserve), trigger budget_exceeded, and publish MUST settle $3 + 600,000 input_tokens.
    const partialUsageDir = join(artifactsDir, "partial-usage-gen");
    const partialLedgerPath = join(artifactsDir, "partial-usage-ledger.json");
    const partialGen = await runGenerate({
      cwd: genRepo,
      triageFile: triagePath,
      evidenceRoot: evidenceDir,
      outputDir: partialUsageDir,
      allowZeroEvidenceForTest: true,
      agentCommand:
        'printf \'{"input_tokens":600000,"estimated_usd":3}\' > "$SELF_HEAL_USAGE_FILE"',
    });
    expect(partialGen.hasPatch).toBe(false);
    expect(partialGen.usage.status).toBe("budget_exceeded");
    expect(partialGen.usage.usage_known).toBe(false);
    expect(partialGen.usage.input_tokens).toBe(600_000);
    expect(partialGen.usage.output_tokens).toBeNull();
    expect(partialGen.usage.estimated_usd).toBe(3);
    const partialPublish = await runPublish({
      cwd: publishRepo,
      triageFile: triagePath,
      proposalDir: partialUsageDir,
      runId: "run-partial-usage",
      runAttempt: 1,
      budgetLedgerPath: partialLedgerPath,
    });
    expect(partialPublish.outcome).toBe("budget_rejected");
    const settledPartial = await readBudgetLedger(partialLedgerPath);
    expect(settledPartial.entries).toHaveLength(1);
    expect(settledPartial.entries[0]?.estimated_usd).toBe(3);
    expect(settledPartial.entries[0]?.observed_usd).toBe(3);
    expect(settledPartial.entries[0]?.input_tokens).toBe(600_000);
    expect(settledPartial.entries[0]?.output_tokens).toBeNull();

    // Rolling spend EXACTLY equal to cap (0.10 + 0.20 === 0.30 under IEEE-754) MUST be allowed.
    const exactCapLedger = appendBudgetEntry(
      emptyBudgetLedger(),
      buildSettledBudgetEntry({
        run_id: "run-exact-1",
        run_attempt: 1,
        provider_id: "openai",
        recorded_at: "2026-11-23T11:00:00.000Z",
        usage: { usage_known: true, input_tokens: 1_000, output_tokens: 500, estimated_usd: 0.1 },
        outcome: "auto_push",
      }),
      { nowMs: mergeNow },
    );
    expect(
      evaluateBudget(exactCapLedger, {
        nowMs: mergeNow,
        limits: { ...strictLimits, maxWindowUsd: 0.3, maxRunUsd: 2.0 },
        runUsage: {
          usage_known: true,
          input_tokens: 1_000,
          output_tokens: 500,
          estimated_usd: 0.2,
        },
      }).allowed,
    ).toBe(true);

    // Unsafe integer token count (1e20) alongside valid $3 MUST discard only the bad token field and preserve $3 through generate -> publish.
    const unsafeTokenDir = join(artifactsDir, "unsafe-token-gen");
    const unsafeLedgerPath = join(artifactsDir, "unsafe-token-ledger.json");
    const unsafeGen = await runGenerate({
      cwd: genRepo,
      triageFile: triagePath,
      evidenceRoot: evidenceDir,
      outputDir: unsafeTokenDir,
      allowZeroEvidenceForTest: true,
      agentCommand: 'printf \'{"input_tokens":1e20,"estimated_usd":3}\' > "$SELF_HEAL_USAGE_FILE"',
    });
    expect(unsafeGen.usage.status).toBe("budget_exceeded");
    expect(unsafeGen.usage.usage_known).toBe(false);
    expect(unsafeGen.usage.input_tokens).toBeNull();
    expect(unsafeGen.usage.estimated_usd).toBe(3);
    const unsafePublish = await runPublish({
      cwd: publishRepo,
      triageFile: triagePath,
      proposalDir: unsafeTokenDir,
      runId: "run-unsafe-token",
      runAttempt: 1,
      budgetLedgerPath: unsafeLedgerPath,
    });
    expect(unsafePublish.outcome).toBe("budget_rejected");
    const settledUnsafe = await readBudgetLedger(unsafeLedgerPath);
    expect(settledUnsafe.entries[0]?.estimated_usd).toBe(3);
    expect(settledUnsafe.entries[0]?.observed_usd).toBe(3);

    // Re-running publish on attempt 2 consuming generate attempt 1's usage.json MUST count only incremental delta (never double-reject $0.25 under $0.40 cap).
    const dryRunLedger = join(artifactsDir, "dry-run-delta-ledger.json");
    const prevMaxWinForDelta = process.env.SELF_HEAL_MAX_WINDOW_USD;
    process.env.SELF_HEAL_MAX_WINDOW_USD = "0.4";
    try {
      const dry1 = await runPublish({
        cwd: publishRepo,
        triageFile: triagePath,
        proposalDir,
        verifyDir,
        verifyJobResult: "success",
        runId: "run-delta",
        runAttempt: 1,
        generateAttempt: 1,
        budgetLedgerPath: dryRunLedger,
        dryRun: true,
      });
      const dry2 = await runPublish({
        cwd: publishRepo,
        triageFile: triagePath,
        proposalDir,
        verifyDir,
        verifyJobResult: "success",
        runId: "run-delta",
        runAttempt: 2,
        generateAttempt: 1,
        budgetLedgerPath: dryRunLedger,
        dryRun: true,
      });
      expect(dry1.outcome).toBe("dry_run");
      expect(dry2.outcome).toBe("dry_run");
      expect((await readBudgetLedger(dryRunLedger)).entries).toHaveLength(1);
    } finally {
      if (prevMaxWinForDelta === undefined) delete process.env.SELF_HEAL_MAX_WINDOW_USD;
      else process.env.SELF_HEAL_MAX_WINDOW_USD = prevMaxWinForDelta;
    }

    // Re-running publish on attempt 2 consuming generate attempt 1's usage.json MUST still deduplicate to 1 entry ($0.25, NOT $0.50).
    await runPublish({
      cwd: publishRepo,
      triageFile: triagePath,
      proposalDir: missingPatchDir,
      verifyDir,
      runId: "run-missing-patch",
      runAttempt: 2,
      generateAttempt: 1,
      budgetLedgerPath: ledgerPath,
    });
    ledger = await readBudgetLedger(ledgerPath);
    expect(ledger.entries).toHaveLength(1);
    expect(ledger.entries[0]?.estimated_usd).toBe(0.25);

    // Re-running generate itself when provider is in cooldown (even with plenty of rolling budget) MUST stop at $0 (0 attempts)
    // AND piping that zero-call refusal into publish MUST NOT extend cooldown or consume a rolling window run slot.
    const beforeCooldownLedger = await readBudgetLedger(ledgerPath);
    const beforeCooldownRecordedAt = beforeCooldownLedger.entries[0]?.recorded_at;
    const cooldownBlockedDir = join(artifactsDir, "cooldown-blocked-gen");
    const cooldownBlockedGen = await runGenerate({
      cwd: genRepo,
      triageFile: triagePath,
      evidenceRoot: evidenceDir,
      outputDir: cooldownBlockedDir,
      budgetLedgerPath: ledgerPath,
      allowZeroEvidenceForTest: true,
      agentCommand: "echo SHOULD_NOT_RUN >&2; exit 99",
    });
    expect(cooldownBlockedGen.hasPatch).toBe(false);
    expect(cooldownBlockedGen.usage.status).toBe("deferred");
    expect(cooldownBlockedGen.usage.attempts).toBe(0);
    expect(cooldownBlockedGen.usage.error).toContain("cooldown");

    const cooldownBlockedPublish = await runPublish({
      cwd: publishRepo,
      triageFile: triagePath,
      proposalDir: cooldownBlockedDir,
      runId: "run-cooldown-noop",
      runAttempt: 1,
      budgetLedgerPath: ledgerPath,
    });
    expect(cooldownBlockedPublish.outcome).toBe("deferred");
    const afterCooldownLedger = await readBudgetLedger(ledgerPath);
    expect(afterCooldownLedger.entries).toHaveLength(1);
    expect(afterCooldownLedger.entries[0]?.recorded_at).toBe(beforeCooldownRecordedAt);

    // Re-running generate itself when rolling budget ledger is already exhausted MUST stop at $0 (0 attempts).
    const prevMaxWindow = process.env.SELF_HEAL_MAX_WINDOW_USD;
    process.env.SELF_HEAL_MAX_WINDOW_USD = "0.2";
    try {
      const blockedReRunGen = await runGenerate({
        cwd: genRepo,
        triageFile: triagePath,
        evidenceRoot: evidenceDir,
        outputDir: join(artifactsDir, "blocked-rerun-gen"),
        budgetLedgerPath: ledgerPath,
        allowZeroEvidenceForTest: true,
        agentCommand: "echo SHOULD_NOT_RUN >&2; exit 99",
      });
      expect(blockedReRunGen.hasPatch).toBe(false);
      expect(blockedReRunGen.usage.status).toBe("deferred");
      expect(blockedReRunGen.usage.attempts).toBe(0);
    } finally {
      if (prevMaxWindow === undefined) delete process.env.SELF_HEAL_MAX_WINDOW_USD;
      else process.env.SELF_HEAL_MAX_WINDOW_USD = prevMaxWindow;
    }

    // 2b. Truncated/corrupt usage.json MUST NOT throw SyntaxError before settlement; settles conservative maxRunUsd.
    const corruptUsageDir = join(artifactsDir, "corrupt-usage-proposal");
    await mkdir(corruptUsageDir, { recursive: true });
    await writeFile(join(corruptUsageDir, "usage.json"), '{"status":"no_patch",');
    const corruptOutcome = await runPublish({
      cwd: publishRepo,
      triageFile: triagePath,
      proposalDir: corruptUsageDir,
      runId: "run-corrupt-usage",
      runAttempt: 1,
      budgetLedgerPath: ledgerPath,
    });
    expect(corruptOutcome.outcome).toBe("generate_failed");
    ledger = await readBudgetLedger(ledgerPath);
    expect(ledger.entries).toHaveLength(2);
    expect(ledger.entries[1]?.usage_known).toBe(false);
    expect(ledger.entries[1]?.estimated_usd).toBe(2.0);

    // 3. Non-success verifyJobResult rejects publish even with valid receipt, while settling ledger.
    const badVerify = await runPublish({
      cwd: publishRepo,
      triageFile: triagePath,
      proposalDir,
      verifyDir,
      verifyJobResult: "failure",
      runId: "run-bad-verify",
      runAttempt: 1,
      budgetLedgerPath: ledgerPath,
    });
    expect(badVerify.outcome).toBe("rejected");
    expect(badVerify.violations.some((v) => v.includes("result: failure"))).toBe(true);
    expect((await readBudgetLedger(ledgerPath)).entries).toHaveLength(3);

    // 4. Push failure still settles ledger with outcome "publish_failed".
    git(["remote", "set-url", "origin", join(root, "nonexistent-remote.git")], publishRepo);
    const pushFailed = await runPublish({
      cwd: publishRepo,
      triageFile: triagePath,
      proposalDir,
      verifyDir,
      verifyJobResult: "success",
      runId: "run-push-fail",
      runAttempt: 1,
      budgetLedgerPath: ledgerPath,
    });
    expect(pushFailed.outcome).toBe("publish_failed");
    const finalLedger = await readBudgetLedger(ledgerPath);
    expect(finalLedger.entries).toHaveLength(4);
    expect(finalLedger.entries[3]?.outcome).toBe("publish_failed");
  }, 15_000);
});

describe("self-heal 4-job workflow security boundary", () => {
  it("isolates generate and verify from write credentials, keeps artifacts in runner.temp, and never executes candidate code in publish", async () => {
    const workflow = await readFile(
      new URL("../.github/workflows/self-heal.yml", import.meta.url),
      "utf8",
    );
    for (const forbiddenSecret of [
      "OPENAI_API_KEY",
      "ANTHROPIC_API_KEY",
      "AWS_ACCESS_KEY_ID",
      "AWS_SECRET_ACCESS_KEY",
      "AZURE_CLIENT_SECRET",
      "GOOGLE_SERVICE_ACCOUNT_JSON",
      "DATABRICKS_TOKEN",
    ]) {
      expect(workflow).not.toContain(forbiddenSecret);
    }

    const triageStart = workflow.indexOf("  triage:");
    const generateStart = workflow.indexOf("  generate:");
    const verifyStart = workflow.indexOf("  verify:");
    const publishStart = workflow.indexOf("  publish:");
    expect(triageStart).toBeGreaterThan(0);
    expect(generateStart).toBeGreaterThan(triageStart);
    expect(verifyStart).toBeGreaterThan(generateStart);
    expect(publishStart).toBeGreaterThan(verifyStart);

    const triageBlock = workflow.slice(triageStart, generateStart);
    const generateBlock = workflow.slice(generateStart, verifyStart);
    const verifyBlock = workflow.slice(verifyStart, publishStart);
    const publishBlock = workflow.slice(publishStart);

    // Triage queries all artifact pages via --paginate --slurp, traces exact shards via refresh-evidence-manifest.json,
    // fetches public evidence on manual dispatch (excluding azure-retail-prices from plain array context), requires source evidence, and surfaces missing config.
    expect(triageBlock).toContain("--paginate --slurp");
    expect(triageBlock).toContain("--select-upstream-artifacts");
    expect(triageBlock).toContain("refresh-evidence-manifest.json");
    expect(triageBlock).toContain("refusing to silently fall back to an older report");
    expect(triageBlock).toContain("Failed to download required evidence shard artifact");
    expect(triageBlock).toContain(
      "repos/${GITHUB_REPOSITORY}/actions/runs/${TRIGGER_RUN_ID}/artifacts",
    );
    expect(triageBlock).toContain("azure-retail-prices-*");
    expect(triageBlock).toContain("--require-refresh-report");
    expect(triageBlock).toContain("--require-source-evidence");
    expect(triageBlock).toContain("scripts/fetch-catalog-evidence.ts");
    expect(triageBlock).toContain("Surface missing self-heal generator configuration");
    expect(triageBlock).toContain("runner.temp");

    // Generate & Verify both run read-only with persist-credentials: false and ZERO write GH_TOKEN.
    for (const block of [generateBlock, verifyBlock]) {
      expect(block).toContain("contents: read");
      expect(block).toContain("persist-credentials: false");
      expect(block).not.toContain("contents: write");
      expect(block).not.toContain("GH_TOKEN");
      expect(block).toContain("runner.temp");
    }
    expect(verifyBlock).not.toContain("SELF_HEAL_API_KEY");

    // Downstream jobs download upstream artifacts by immutable artifact-ids so GitHub "Re-run failed jobs" works across attempts.
    expect(triageBlock).toContain(
      "triage_artifact_id: ${{ steps.upload_triage.outputs.artifact-id }}",
    );
    expect(generateBlock).toContain(
      "proposal_artifact_id: ${{ steps.upload_proposal.outputs.artifact-id }}",
    );
    expect(generateBlock).toContain("generate_attempt: ${{ github.run_attempt }}");
    expect(generateBlock).toContain("--budget-ledger");
    expect(generateBlock).toContain("artifact-ids: ${{ needs.triage.outputs.triage_artifact_id }}");
    expect(verifyBlock).toContain(
      "verify_artifact_id: ${{ steps.upload_verify.outputs.artifact-id }}",
    );
    expect(verifyBlock).toContain("artifact-ids: ${{ needs.triage.outputs.triage_artifact_id }}");
    expect(verifyBlock).toContain(
      "artifact-ids: ${{ needs.generate.outputs.proposal_artifact_id }}",
    );
    expect(publishBlock).toContain("artifact-ids: ${{ needs.triage.outputs.triage_artifact_id }}");
    expect(publishBlock).toContain(
      "artifact-ids: ${{ needs.generate.outputs.proposal_artifact_id }}",
    );
    expect(publishBlock).toContain("artifact-ids: ${{ needs.verify.outputs.verify_artifact_id }}");

    // Publish runs if: always(), checks needs.verify.result, keys settlement by generate_attempt, holds NO LLM secret, NEVER invokes validate-changes or replay, and gates refresh on auto_push.
    expect(publishBlock).toContain("if: always()");
    expect(publishBlock).toContain("VERIFY_JOB_RESULT: ${{ needs.verify.result }}");
    expect(publishBlock).toContain(
      "GENERATE_RUN_ATTEMPT: ${{ needs.generate.outputs.generate_attempt }}",
    );
    expect(publishBlock).not.toContain("SELF_HEAL_API_KEY");
    expect(publishBlock).not.toContain("validate-changes");
    expect(publishBlock).not.toContain("replay-catalog-evidence");
    expect(publishBlock).toContain("steps.publish.outputs.outcome == 'auto_push'");
    expect(publishBlock).toContain("steps.publish.outputs.published_sha != ''");
  });
});
