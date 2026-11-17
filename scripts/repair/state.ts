import { createHash } from "node:crypto";
import { z } from "zod";
import type { CatalogRepairCandidate } from "../../src/catalog/catalog-repair.ts";

const timestamp = z.iso.datetime({ offset: true });
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const candidateKey = (candidate: CatalogRepairCandidate) =>
  `${candidate.provider_id}/${candidate.subject_id}`;
export const digest = (value: string) => createHash("sha256").update(value).digest("hex");
export const taskSchema = z.object({
  id: z.string().max(300),
  provider: z.string().max(100),
  trigger: z.string().max(100),
  fingerprint: hash,
  first_seen: timestamp,
  last_seen: timestamp,
  last_attempt: timestamp.optional(),
  retry_at: timestamp.optional(),
  attempts: z.number().int().nonnegative(),
  takeover_fingerprint: hash.optional(),
  status: z.enum(["pending", "blocked", "not_a_defect", "code_published", "adopted"]),
  reason: z.string().max(8000),
  next_action: z.string().max(8000),
  run_id: z.string().regex(/^\d+$/).optional(),
  evidence_run: z.string().regex(/^\d+$/).optional(),
  code_revision: z
    .string()
    .regex(/^[a-f0-9]{40}$/)
    .optional(),
  adopted_snapshot: hash.optional(),
  deployed_run: z.string().regex(/^\d+$/).optional(),
  source_versions: z.record(z.string(), z.string()).default({}),
  coverage: z
    .array(z.object({ area: z.string(), status: z.string(), reason: z.string().max(8000) }))
    .max(8)
    .default([]),
});
export type MaintenanceTask = z.infer<typeof taskSchema>;
export const leaseSchema = z.object({
  id: z.string().regex(/^\d+-\d+$/),
  month: z.string().regex(/^\d{4}-\d{2}$/),
  reserved_microusd: z.number().int().nonnegative(),
  charged_microusd: z.number().int().nonnegative(),
  settled: z.boolean(),
});
export type BudgetLease = z.infer<typeof leaseSchema>;
export const stateSchema = z.object({
  schema_version: z.literal(1),
  tasks: z.array(taskSchema).max(2000),
  leases: z.array(leaseSchema).max(3000),
  observations: z.record(z.string(), z.object({ hash, observed_at: timestamp })).default({}),
  last_dispatch: timestamp.optional(),
  deployments: z
    .array(
      z.object({
        revision: z.string(),
        run_id: z.string(),
        conclusion: z.string(),
        snapshot_sha256: hash,
      }),
    )
    .max(100)
    .default([]),
});
export type MaintenanceState = z.infer<typeof stateSchema>;
export const emptyState = (): MaintenanceState => ({
  schema_version: 1,
  tasks: [],
  leases: [],
  observations: {},
  deployments: [],
});

// All reservations, including interrupted calls, count against the UTC calendar month's limit.
export const monthlyLimit = 120_000_000;
export const reserveLimit = 110_000_000;
export const runAllowance = 8_000_000;
export function reserveBudget(
  state: MaintenanceState,
  id: string,
  now: Date,
  enabled: boolean,
): BudgetLease {
  const existing = state.leases.find((lease) => lease.id === id);
  if (existing) return existing;
  const month = now.toISOString().slice(0, 7);
  // A lease cannot be spent in a later month. Retain the last three UTC months for audit.
  const cutoff = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1))
    .toISOString()
    .slice(0, 7);
  state.leases = state.leases.filter((lease) => lease.month >= cutoff);
  const used = state.leases
    .filter((lease) => lease.month === month)
    .reduce(
      (sum, lease) => sum + (lease.settled ? lease.charged_microusd : lease.reserved_microusd),
      0,
    );
  const lease: BudgetLease = {
    id,
    month,
    reserved_microusd: enabled ? Math.max(0, Math.min(runAllowance, reserveLimit - used)) : 0,
    charged_microusd: 0,
    settled: false,
  };
  state.leases.push(lease);
  return lease;
}
export function settleBudget(state: MaintenanceState, id: string, charged: number): void {
  const lease = state.leases.find((item) => item.id === id);
  if (!lease || !Number.isSafeInteger(charged) || charged < 0 || charged > lease.reserved_microusd)
    throw new Error("Invalid maintenance budget settlement");
  if (lease.settled && lease.charged_microusd !== charged)
    throw new Error("Conflicting settlement");
  lease.charged_microusd = charged;
  lease.settled = true;
}

export function observeCandidates(
  state: MaintenanceState,
  candidates: readonly CatalogRepairCandidate[],
  fingerprints: ReadonlyMap<string, string>,
  now: Date,
): void {
  for (const candidate of candidates) {
    const id = candidateKey(candidate);
    const fingerprint = fingerprints.get(id);
    if (!fingerprint) throw new Error(`Missing candidate fingerprint: ${id}`);
    const task = state.tasks.find((item) => item.id === id);
    if (task) {
      task.last_seen = now.toISOString();
      if (task.fingerprint !== fingerprint) {
        task.fingerprint = fingerprint;
        task.status = "pending";
        task.next_action =
          "Recheck changed source or implementation; previous conclusions are historical leads.";
        task.coverage = [];
        delete task.adopted_snapshot;
        delete task.deployed_run;
        delete task.retry_at;
      }
    } else
      state.tasks.push({
        id,
        provider: candidate.provider_id,
        trigger: candidate.trigger,
        fingerprint,
        first_seen: now.toISOString(),
        last_seen: now.toISOString(),
        attempts: 0,
        status: "pending",
        reason: candidate.message.slice(0, 8000),
        next_action: "Inspect original evidence and reproduce the consumed contract.",
        coverage: [],
        source_versions: {},
      });
  }
}

function priority(task: MaintenanceTask): number {
  if (/pricing_validation|provider_validation|source_parse/.test(task.trigger)) return 0;
  if (task.status === "code_published") return 1;
  if (/location|acquisition/.test(task.trigger)) return 2;
  return 3;
}
export function chooseProvider(
  state: MaintenanceState,
  candidates: readonly CatalogRepairCandidate[],
  now: Date,
): string | undefined {
  const ids = new Set(candidates.map(candidateKey));
  const known = new Set(state.tasks.map((task) => task.id));
  const unseen: MaintenanceTask[] = candidates
    .filter((candidate) => !known.has(candidateKey(candidate)))
    .map((candidate) => ({
      id: candidateKey(candidate),
      provider: candidate.provider_id,
      trigger: candidate.trigger,
      fingerprint: digest(candidateKey(candidate)),
      first_seen: now.toISOString(),
      last_seen: now.toISOString(),
      attempts: 0,
      status: "pending",
      reason: candidate.message,
      next_action: "Inspect new refresh evidence",
      source_versions: {},
      coverage: [],
    }));
  const available = [...state.tasks, ...unseen].filter(
    (task) =>
      ids.has(task.id) &&
      (task.retry_at === undefined || Date.parse(task.retry_at) <= now.getTime()),
  );
  // Age precedes severity after seven days, so busy providers cannot starve other work.
  const waited = (task: MaintenanceTask) =>
    now.getTime() - Date.parse(task.last_attempt ?? task.first_seen);
  available.sort(
    (a, b) =>
      Number(waited(b) >= 7 * 86400000) - Number(waited(a) >= 7 * 86400000) ||
      priority(a) - priority(b) ||
      waited(b) - waited(a) ||
      a.id.localeCompare(b.id),
  );
  return available[0]?.provider;
}

export function difficulty(tasks: readonly MaintenanceTask[]): "routine" | "semantic" | "complex" {
  if (tasks.some((task) => task.attempts >= 2 || /architecture/.test(task.trigger)))
    return "complex";
  if (tasks.some((task) => /pricing|contract|scheduled_provider/.test(task.trigger)))
    return "semantic";
  return "routine";
}
export const investigationMinutes = { routine: 20, semantic: 30, complex: 35 };

export function recordOutcome(
  task: MaintenanceTask,
  result: {
    status: "pending" | "blocked" | "not_a_defect" | "repaired";
    reason: string;
    next_action?: string;
    published_revision?: string;
  },
  now: Date,
): void {
  task.reason = result.reason.slice(0, 8000);
  task.next_action = (
    result.next_action ?? "Recheck evidence and continue the unfinished investigation."
  ).slice(0, 8000);
  task.status =
    result.status === "repaired"
      ? result.published_revision
        ? "code_published"
        : "pending"
      : result.status;
  if (result.published_revision) task.code_revision = result.published_revision;
  const delay =
    task.status === "not_a_defect"
      ? 7 * 86400000
      : task.status === "blocked"
        ? Math.min(72, 6 * 2 ** Math.min(task.attempts, 4)) * 3600000
        : 6 * 3600000;
  task.retry_at = new Date(now.getTime() + delay).toISOString();
}

export function adoptionReady(
  task: MaintenanceTask,
  observation: {
    contains_revision: boolean;
    accepted_sources: ReadonlyMap<string, string>;
    candidate_ids: ReadonlySet<string>;
    fresh: boolean;
    consumer_passed: boolean;
  },
): boolean {
  return (
    ["code_published", "adopted"].includes(task.status) &&
    observation.contains_revision &&
    observation.fresh &&
    observation.consumer_passed &&
    !observation.candidate_ids.has(task.id) &&
    Object.entries(task.source_versions).length > 0 &&
    Object.entries(task.source_versions).every(
      ([id, version]) => observation.accepted_sources.get(id) === version,
    )
  );
}
