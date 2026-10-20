import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { appendFile, mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const evidenceDirectory = "/tmp/gh-aw/agent";
const reviewPath = `${evidenceDirectory}/catalog-repair-review.json`;

export const periodicReviewAreas = [
  "discovery",
  "identity_lifecycle",
  "pricing",
  "accounting",
  "publication",
  "consumers",
  "diagnostics_repair",
  "simplicity",
] as const;

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function record(value: unknown): Record<string, unknown> {
  if (!object(value)) throw new Error("Review requires JSON objects");
  return value;
}

function text(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "" || value.length > 8000)
    throw new Error("Review requires nonempty bounded explanations and commands");
  return value;
}

function records(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.length > 1000) throw new Error("Invalid review record list");
  return value.map(record);
}

export function reviewHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export interface ReviewSummary {
  repaired: number;
  not_a_defect: number;
  blocked: number;
  pending: number;
}

/** Check investigation evidence separately from the meaning of the agent's conclusions. */
export async function validateRepairReview(
  admissionText: string,
  reviewText: string,
  readEvidence: (path: string) => Promise<string>,
  options: {
    allowPending?: boolean;
    requireRepair?: boolean;
    requireNoDefect?: boolean;
    now?: number;
  } = {},
): Promise<ReviewSummary> {
  if (reviewText.length > 1024 * 1024) throw new Error("Repair review exceeds 1 MiB");
  const admission = record(JSON.parse(admissionText));
  const review = record(JSON.parse(reviewText));
  if (admission.schema_version !== 1 || review.admission_sha256 !== reviewHash(admissionText))
    throw new Error("Repair review does not match this run's prepared admission");
  const candidates = records(admission.candidates);
  const expected = new Map(candidates.map((candidate) => [text(candidate.id), candidate]));
  if (expected.size !== candidates.length) throw new Error("Duplicate prepared repair candidate");
  const rows = records(review.candidates);
  const seen = new Set<string>();
  const hashes = new Map<string, string>();
  const proof = async (value: unknown) => {
    const ref = record(value);
    const path = text(ref.path);
    const hash = text(ref.sha256);
    if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error("Review evidence requires a SHA-256 hash");
    let actual = hashes.get(path);
    if (actual === undefined) {
      actual = reviewHash(await readEvidence(path));
      hashes.set(path, actual);
    }
    if (hash !== actual) throw new Error(`Review evidence changed: ${path}`);
  };
  const checkProof = async (check: Record<string, unknown>) => {
    const command = text(check.command);
    text(check.result);
    await proof(check.output);
    const output = record(check.output);
    const receipt = record(JSON.parse(await readEvidence(text(output.path))));
    if (
      receipt.schema_version !== 1 ||
      receipt.command !== check.command ||
      receipt.kind !== check.kind ||
      receipt.phase !== check.phase ||
      receipt.exit_code !== check.exit_code ||
      (check.exit_code !== null && !Number.isInteger(check.exit_code))
    )
      throw new Error("Review check disagrees with its command receipt");
    if (
      (check.kind === "consumer" || check.kind === "transition") &&
      /(?:fetch|replay)-catalog-evidence\.ts\b/u.test(command)
    )
      throw new Error(
        "Source-only acquisition or parser replay cannot establish consumer or transition proof",
      );
  };
  const counts: ReviewSummary = { repaired: 0, not_a_defect: 0, blocked: 0, pending: 0 };
  for (const row of rows) {
    const id = text(row.id);
    const candidate = expected.get(id);
    if (candidate === undefined || seen.has(id))
      throw new Error(`Unknown or duplicate review: ${id}`);
    seen.add(id);
    text(row.reason);
    if (row.status === "pending") {
      text(row.next_action);
      if (!options.allowPending) throw new Error(`Candidate still needs investigation: ${id}`);
      const interruption = record(review.interruption);
      text(interruption.reason);
      if (interruption.kind === "budget") {
        const deadline = Date.parse(text(admission.investigation_deadline));
        if (!Number.isFinite(deadline) || (options.now ?? Date.now()) < deadline)
          throw new Error("Investigation budget remains; continue the pending candidates");
      } else if (interruption.kind === "environment") {
        const check = record(interruption.check);
        await checkProof(check);
        if (check.exit_code === 0)
          throw new Error("Environment interruption requires a failed command");
      } else {
        throw new Error("Pending candidates require a budget or environment interruption");
      }
      counts.pending += 1;
      continue;
    }
    const evidence = records(row.evidence);
    if (evidence.length === 0) throw new Error(`Missing source evidence: ${id}`);
    for (const ref of evidence) await proof(ref);
    const checks = records(row.checks);
    for (const check of checks) await checkProof(check);
    const has = (kind: string, phase?: string, success = false) =>
      checks.some(
        (check) =>
          check.kind === kind &&
          (phase === undefined || check.phase === phase) &&
          (!success || check.exit_code === 0),
      );
    if (
      ["scheduled_provider_review", "scheduled_architecture_review"].includes(
        text(candidate.trigger),
      )
    ) {
      const coverage = records(row.coverage);
      const areas = new Set<string>();
      for (const area of coverage) {
        const name = text(area.area);
        if (!periodicReviewAreas.some((value) => value === name) || areas.has(name))
          throw new Error(`Unknown or duplicate periodic review area: ${name}`);
        areas.add(name);
        text(area.reason);
        const evidence = records(area.evidence);
        if (evidence.length === 0) throw new Error(`Periodic review area needs evidence: ${name}`);
        for (const ref of evidence) await proof(ref);
        if (area.status === "blocked") {
          text(area.next_action);
          if (!has("alternative") || row.status === "not_a_defect")
            throw new Error(`Blocked periodic area cannot establish a healthy review: ${name}`);
        } else if (area.status === "reviewed") {
          const kind =
            name === "consumers" ? "consumer" : name === "publication" ? "transition" : undefined;
          if (kind !== undefined && !has(kind, undefined, true))
            throw new Error(`Periodic ${name} review needs a successful ${kind} check`);
        } else throw new Error(`Invalid periodic review area status: ${name}`);
      }
      const missing = periodicReviewAreas.filter((area) => !areas.has(area));
      if (missing.length > 0)
        throw new Error(`Periodic review coverage missing: ${missing.join(", ")}`);
    }
    switch (row.status) {
      case "repaired":
        if (
          !has("parser", "before") ||
          !has("parser", "after", true) ||
          !has("regression", "after", true)
        )
          throw new Error(
            `Repair needs before/after parser results and a passing regression: ${id}`,
          );
        counts.repaired += 1;
        break;
      case "not_a_defect":
      case "blocked": {
        if (!has("alternative")) throw new Error(`Second diagnostic pass missing: ${id}`);
        let sourceBlocked = false;
        if (row.status === "blocked") {
          const blocker = record(row.blocker);
          if (!["source", "contract", "tooling", "scope"].includes(text(blocker.kind)))
            throw new Error(`Invalid blocker category: ${id}`);
          text(blocker.next_action);
          const executionReviewed = id === "workflow/refresh-execution" && has("execution");
          sourceBlocked =
            (blocker.kind === "source" || blocker.kind === "tooling") &&
            !has("parser") &&
            !executionReviewed;
          if (!has("parser") && !executionReviewed && !(sourceBlocked && has("fetch")))
            throw new Error(`Blocker needs parser replay or failed acquisition evidence: ${id}`);
          if (
            sourceBlocked &&
            !has("parser") &&
            !checks.some((check) => check.kind === "fetch" && check.exit_code !== 0)
          )
            throw new Error(`Source blocker needs a failed fetch: ${id}`);
        } else if (!has("parser", undefined, true)) {
          throw new Error(`No-defect decision needs a successful parser replay: ${id}`);
        }
        if (
          !sourceBlocked &&
          [
            "source_location_change",
            "source_pricing_structure",
            "scheduled_provider_review",
          ].includes(text(candidate.trigger)) &&
          !has("navigation", undefined, true)
        )
          throw new Error(`Inspect first-party navigation or linked types before closing: ${id}`);
        counts[row.status] += 1;
        break;
      }
      default:
        throw new Error(`Unknown review status: ${id}`);
    }
  }
  const missing = [...expected.keys()].filter((id) => !seen.has(id));
  if (missing.length > 0) throw new Error(`Unreviewed repair candidates: ${missing.join(", ")}`);
  if (options.requireRepair && counts.repaired === 0)
    throw new Error("Publication requires at least one reviewed repair");
  if (
    options.requireNoDefect &&
    (candidates.length === 0 || counts.not_a_defect !== candidates.length)
  )
    throw new Error("A reviewed no-op requires every admitted candidate to be proven not a defect");
  return counts;
}

/** Render only after validateRepairReview succeeds; a repaired item is not complete catalog health. */
export function repairScopeSummary(admissionText: string, reviewText: string): string {
  const admission = record(JSON.parse(admissionText));
  const rows = records(record(JSON.parse(reviewText)).candidates);
  const periodic = new Set(
    records(admission.candidates)
      .filter((candidate) =>
        ["scheduled_provider_review", "scheduled_architecture_review"].includes(
          text(candidate.trigger),
        ),
      )
      .map((candidate) => text(candidate.id)),
  );
  const summary = {
    candidates: rows.map((row) => ({
      id: text(row.id),
      status: text(row.status),
      ...(row.status === "blocked"
        ? { next_action: text(record(row.blocker).next_action) }
        : row.status === "pending"
          ? { next_action: text(row.next_action) }
          : {}),
      ...(!periodic.has(text(row.id))
        ? {}
        : row.status === "pending"
          ? { review_complete: false }
          : {
              review_complete: records(row.coverage).every((area) => area.status === "reviewed"),
              blocked_areas: records(row.coverage)
                .filter((area) => area.status === "blocked")
                .map((area) => ({ area: text(area.area), next_action: text(area.next_action) })),
            }),
    })),
    deferred: records(admission.deferred_candidates ?? []).map((candidate) => text(candidate.id)),
  };
  return `\n## Checked repair scope\n\nThese are admitted-scope evidence conclusions, not a whole-catalog health claim. Blocked areas and deferred candidates remain unresolved.\n\n\`\`\`json\n${JSON.stringify(summary, null, 2).replaceAll("`", "\\u0060")}\n\`\`\`\n`;
}

export async function readReviewEvidence(path: string, root = evidenceDirectory): Promise<string> {
  const canonical = await realpath(path);
  const local = relative(await realpath(root), canonical);
  if (local === "" || local === ".." || local.startsWith("../") || isAbsolute(local))
    throw new Error("Review evidence must remain inside the agent evidence directory");
  const info = await stat(canonical);
  if (!info.isFile() || info.size > 128 * 1024 * 1024)
    throw new Error("Review evidence is not a bounded regular file");
  return readFile(canonical, "utf8");
}

function outputTypes(output: string): string[] {
  let values: unknown[];
  try {
    const parsed: unknown = JSON.parse(output);
    values = object(parsed) && Array.isArray(parsed.items) ? parsed.items : [parsed];
  } catch {
    values = output
      .split(/\r?\n/)
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line));
  }
  return values.map((value) => text(record(value).type));
}

async function main(): Promise<void> {
  const operation = process.argv[2];
  if (operation === "hash") {
    const path = text(process.argv[3]);
    console.log(JSON.stringify({ path, sha256: reviewHash(await readReviewEvidence(path)) }));
    return;
  }
  if (operation === "probe") {
    const kind = text(process.argv[3]);
    const phase = text(process.argv[4]);
    const args = process.argv.slice(6);
    if (
      ![
        "fetch",
        "parser",
        "navigation",
        "alternative",
        "regression",
        "execution",
        "consumer",
        "transition",
      ].includes(kind) ||
      !["before", "after", "investigation"].includes(phase) ||
      process.argv[5] !== "--" ||
      !["node", "test", "check", "run", "env"].includes(args[0] ?? "")
    )
      throw new Error("Expected probe KIND PHASE -- VP_ARGUMENTS");
    const command = ["vp", ...args].map((arg) => JSON.stringify(arg)).join(" ");
    const started = new Date().toISOString();
    const result = spawnSync("vp", args, {
      encoding: "utf8",
      timeout: 300_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    const receipt = JSON.stringify({
      schema_version: 1,
      kind,
      phase,
      command,
      exit_code: result.status,
      started_at: started,
      finished_at: new Date().toISOString(),
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      error: result.error?.message,
      signal: result.signal,
    });
    const directory = `${evidenceDirectory}/review-checks`;
    await mkdir(directory, { recursive: true });
    const path = `${directory}/${randomUUID()}.json`;
    await writeFile(path, receipt);
    console.log(
      JSON.stringify({
        kind,
        phase,
        command,
        exit_code: result.status,
        output: { path, sha256: reviewHash(receipt) },
      }),
    );
    process.exitCode = result.status ?? 1;
    return;
  }
  if (
    !["check", "check-repair", "check-no-defect", "check-incomplete", "terminal"].includes(
      operation ?? "",
    )
  )
    throw new Error("Expected check, check-repair, check-no-defect, check-incomplete, or terminal");
  const admission = process.env.KMODELS_REPAIR_ADMISSION;
  if (!admission) throw new Error("Missing runner-owned repair admission");
  const types =
    operation === "terminal"
      ? outputTypes(await readFile(text(process.env.GH_AW_SAFE_OUTPUTS), "utf8"))
      : [];
  const admissionText = await readFile(admission, "utf8");
  const reviewText = await readReviewEvidence(reviewPath);
  const summary = await validateRepairReview(admissionText, reviewText, readReviewEvidence, {
    allowPending:
      operation === "check-incomplete" ||
      types.some((type) => ["report_incomplete", "missing_data", "missing_tool"].includes(type)),
    requireRepair: operation === "check-repair" || types.includes("commit_repair"),
    requireNoDefect: operation === "check-no-defect" || types.includes("noop"),
  });
  console.log(
    `Repair investigation evidence checked: ${JSON.stringify(summary)}. This checks evidence coverage, not semantic correctness.`,
  );
  if (operation === "terminal" && process.env.GITHUB_STEP_SUMMARY !== undefined)
    await appendFile(
      process.env.GITHUB_STEP_SUMMARY,
      repairScopeSummary(admissionText, reviewText),
    );
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await main();
