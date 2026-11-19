import { execFileSync, spawnSync } from "node:child_process";
import { access, appendFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { manifests } from "../../src/catalog/manifests.ts";
import { catalogRepairCandidates } from "../../src/catalog/catalog-repair.ts";
import { readReviewEvidence, validateRepairReview } from "../catalog-repair-review.ts";
import { githubApi, readState, repository, writeState } from "./store.ts";
import { recordDiscovery } from "./discovery.ts";
import { checkTakeoverCheckpoint } from "./verification.ts";
import { verificationFeedback } from "./verification-feedback.ts";
import {
  adoptionReady,
  candidateKey,
  recordAttempt,
  digest,
  leaseSchema,
  observeCandidates,
  recordOutcome,
  recordDeployment,
  prepareBudgetLease,
  reserveRunBudget,
  settleBudget,
  stateSchema,
  type MaintenanceState,
} from "./state.ts";

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}
function fingerprints(
  candidates: ReturnType<typeof catalogRepairCandidates>,
  state: unknown,
): Map<string, string> {
  const fetchState = z
    .object({ sources: z.record(z.string(), z.object({ contentHash: z.string().optional() })) })
    .parse(state);
  const tree = execFileSync("git", ["rev-parse", "HEAD:src/catalog"], { encoding: "utf8" }).trim();
  return new Map(
    candidates.map((candidate) => [
      candidateKey(candidate),
      digest(
        JSON.stringify({
          trigger: candidate.trigger,
          diagnostics: candidate.diagnostics,
          tree,
          sources: manifests
            .find((manifest) => manifest.provider.id === candidate.provider_id)
            ?.sources.map((source) => [
              source.id,
              source.url,
              source.extractorVersion,
              fetchState.sources[source.id]?.contentHash,
            ]),
        }),
      ),
    ]),
  );
}

async function observe(state: MaintenanceState): Promise<void> {
  const reportText = await readFile("data/refresh-summary.json", "utf8");
  const report: unknown = JSON.parse(reportText);
  const candidates = catalogRepairCandidates(report);
  const fetchState: unknown = JSON.parse(await readFile("data/fetch-state.json", "utf8"));
  observeCandidates(state, candidates, fingerprints(candidates, fetchState), new Date());
  const catalog = z
    .object({ sources: z.array(z.object({ id: z.string(), extractor_version: z.string() })) })
    .parse(JSON.parse(await readFile("data/catalog.json", "utf8")));
  const attempts = z
    .object({
      providers: z.array(
        z.object({
          provider_id: z.string(),
          attempt: z
            .object({
              outcome: z.string(),
              sources: z.array(z.object({ source_id: z.string(), outcome: z.string() })),
              pricing: z.object({ outcome: z.string() }).optional(),
            })
            .optional(),
        }),
      ),
    })
    .parse(report);
  for (const task of state.tasks.filter((task) =>
    ["code_published", "adopted"].includes(task.status),
  )) {
    const relevant = attempts.providers.filter((provider) =>
      ["catalog", "workflow"].includes(task.provider)
        ? provider.attempt?.sources.some((source) => source.source_id in task.source_versions)
        : provider.provider_id === task.provider,
    );
    const ancestor = task.code_revision
      ? spawnSync("git", ["merge-base", "--is-ancestor", task.code_revision, "HEAD"], {
          stdio: "ignore",
        }).status === 0
      : false;
    if (
      adoptionReady(task, {
        contains_revision: ancestor,
        accepted_sources: new Map(
          catalog.sources.map((source) => [source.id, source.extractor_version]),
        ),
        candidate_ids: new Set(candidates.map(candidateKey)),
        fresh:
          relevant.length > 0 &&
          relevant.every(
            ({ attempt }) =>
              attempt?.outcome === "accepted" &&
              (/pricing/.test(task.trigger)
                ? attempt.pricing?.outcome === "accepted"
                : attempt.pricing?.outcome !== "failed"),
          ) &&
          Object.keys(task.source_versions).every((id) =>
            relevant.some(({ attempt }) =>
              attempt?.sources.some(
                (source) =>
                  source.source_id === id && ["changed", "unchanged"].includes(source.outcome),
              ),
            ),
          ),
        // Only the observer invoked after successful refresh publication may confirm consumer checks.
        consumer_passed: process.env.MAINTENANCE_REFRESH_PUBLISHED === "true",
      })
    ) {
      task.status = "adopted";
      task.adopted_snapshot = digest(await readFile("data/catalog-snapshot.json", "utf8"));
      const deployment = state.deployments.findLast(
        (deployment) => deployment.snapshot_sha256 === task.adopted_snapshot,
      );
      delete task.deployed_run;
      if (deployment) task.deployed_run = deployment.run_id;
      task.next_action = deployment
        ? "Repair is adopted in the deployed catalog."
        : "Check deployment of the adopted snapshot revision.";
    }
  }
}

async function main(): Promise<void> {
  const command = process.argv[2];
  const repo = repository();
  const { state, sha } = readState(repo);
  const now = new Date();
  if (command === "prepare") {
    await observe(state);
    const lease = prepareBudgetLease(
      state,
      `${env("GITHUB_RUN_ID")}-${env("GITHUB_RUN_ATTEMPT")}`,
      now,
    );
    writeState(repo, state, sha);
    const directory = env("MAINTENANCE_OUTPUT");
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "state.json"), JSON.stringify(state));
    await writeFile(join(directory, "lease.json"), JSON.stringify(lease));
    return;
  }
  if (command === "reserve-verification" || command === "reserve-takeover") {
    const input = env("MAINTENANCE_INPUT");
    const output = env("MAINTENANCE_OUTPUT");
    const admissionText = await readFile(
      join(input, "investigation", env("RUNNER_TEMP"), "gh-aw/repair-admission.json"),
      "utf8",
    );
    const admission = z
      .object({
        base_sha: z.literal(env("GITHUB_SHA")),
        difficulty: z.enum(["routine", "semantic", "complex"]),
        candidates: z.array(z.unknown()),
      })
      .parse(JSON.parse(admissionText));
    const id = `${env("GITHUB_RUN_ID")}-${env("GITHUB_RUN_ATTEMPT")}`;
    let charged = 0;
    if (command === "reserve-takeover") {
      const prior = join(input, "initial");
      const evidence = join(prior, "effective-evidence");
      await checkTakeoverCheckpoint({
        decision: JSON.parse(await readFile(join(prior, "decision.json"), "utf8")),
        report: JSON.parse(await readFile(join(prior, "initial-verification.json"), "utf8")),
        admission: admissionText,
        review: await readFile(
          join(input, "investigation/tmp/gh-aw/agent/catalog-repair-review.json"),
          "utf8",
        ),
        patch: await readFile(join(input, "repair.patch"), "utf8"),
        read: (path) =>
          readReviewEvidence(join(evidence, relative("/tmp/gh-aw/agent", path)), evidence),
      });
      charged = z
        .object({ lease_id: z.literal(id), charged_microusd: z.number().int().nonnegative() })
        .parse(
          JSON.parse(await readFile(join(prior, "review-usage.json"), "utf8")),
        ).charged_microusd;
    }
    const lease = state.leases.find((item) => item.id === id);
    if (!lease || charged > lease.reserved_microusd)
      throw new Error("Missing or invalid prior budget");
    if (process.env.MAINTENANCE_OPENAI_AVAILABLE === "true" && admission.candidates.length)
      reserveRunBudget(state, id, now);
    writeState(repo, state, sha);
    await mkdir(output, { recursive: true });
    await writeFile(join(output, "lease.json"), JSON.stringify(lease));
    await writeFile(join(output, "state.json"), JSON.stringify(state));
    await writeFile(
      join(output, "usage.json"),
      JSON.stringify({ lease_id: id, charged_microusd: charged }),
    );
    return;
  }
  if (command === "finish") {
    const directory = env("MAINTENANCE_INPUT");
    const leasePath = join(directory, "catalog-maintenance-preparation/lease.json");
    const usagePath = join(directory, "catalog-maintenance-usage/usage.json");
    const exists = (path: string) =>
      access(path).then(
        () => true,
        () => false,
      );
    const reviewedUsagePath = join(directory, "catalog-maintenance-review/review-usage.json");
    const initialUsagePath = join(directory, "catalog-maintenance-initial/review-usage.json");
    let settlementPath: string | undefined;
    if (await exists(reviewedUsagePath)) settlementPath = reviewedUsagePath;
    else if (process.env.MAINTENANCE_REVIEW_RESULT === "skipped") {
      if (await exists(initialUsagePath)) settlementPath = initialUsagePath;
      else if (process.env.MAINTENANCE_INITIAL_RESULT === "skipped" && (await exists(usagePath)))
        settlementPath = usagePath;
    }
    if (settlementPath) {
      const lease = leaseSchema.parse(JSON.parse(await readFile(leasePath, "utf8")));
      const usage = z
        .object({ lease_id: z.literal(lease.id), charged_microusd: z.number().int().nonnegative() })
        .parse(JSON.parse(await readFile(settlementPath, "utf8")));
      settleBudget(state, lease.id, usage.charged_microusd);
    }
    const independentDirectory = join(directory, "catalog-maintenance-review");
    const decisionPath = join(independentDirectory, "decision.json");
    const decision = (await exists(decisionPath))
      ? z
          .object({
            admission_sha256: z.string(),
            review_sha256: z.string(),
            patch_sha256: z.string(),
            verdict: z.enum(["supported", "concrete_error", "insufficient_evidence"]),
            verified_candidate_ids: z.array(z.string()),
            takeover_attempted: z.boolean(),
            takeover_candidate_ids: z.array(z.string()).optional(),
          })
          .parse(JSON.parse(await readFile(decisionPath, "utf8")))
      : undefined;
    const finalReview =
      decision?.verdict === "supported" &&
      (await exists(join(independentDirectory, "review.json")));
    const admissionPath = finalReview
      ? join(independentDirectory, "admission.json")
      : join(directory, "investigation", env("RUNNER_TEMP"), "gh-aw/repair-admission.json");
    const reviewPath = finalReview
      ? join(independentDirectory, "review.json")
      : join(directory, "investigation/tmp/gh-aw/agent/catalog-repair-review.json");
    const publicationPath = join(directory, "catalog-maintenance-publication/publication.json");
    const published = (await exists(publicationPath))
      ? z
          .object({
            revision: z.string().regex(/^[a-f0-9]{40}$/),
            patch_sha256: z.string().regex(/^[a-f0-9]{64}$/),
            providers: z.record(z.string(), z.record(z.string(), z.string())),
          })
          .parse(JSON.parse(await readFile(publicationPath, "utf8")))
      : undefined;
    if ((await exists(admissionPath)) && (await exists(reviewPath))) {
      const feedback = await verificationFeedback(directory);
      const prepared = stateSchema.parse(
        JSON.parse(
          await readFile(join(directory, "catalog-maintenance-preparation/state.json"), "utf8"),
        ),
      );
      const run = env("GITHUB_RUN_ID");
      const attempt = z.coerce.number().int().positive().parse(env("GITHUB_RUN_ATTEMPT"));
      const admissionText = await readFile(admissionPath, "utf8");
      const admission = z
        .object({
          candidates: z.array(
            z.object({ id: z.string(), trigger: z.string(), description: z.string() }),
          ),
        })
        .parse(JSON.parse(admissionText));
      const text = await readFile(reviewPath, "utf8");
      const review = z
        .object({
          candidates: z.array(
            z.object({
              id: z.string(),
              status: z.enum(["pending", "blocked", "not_a_defect", "repaired"]),
              reason: z.string().max(8000),
              next_action: z.string().optional(),
              blocker: z.object({ next_action: z.string() }).optional(),
              coverage: z
                .array(z.object({ area: z.string(), status: z.string(), reason: z.string() }))
                .max(8)
                .optional(),
            }),
          ),
        })
        .parse(JSON.parse(text));
      const evidenceRoot = finalReview
        ? join(independentDirectory, "effective-evidence")
        : resolve(reviewPath, "..");
      let verified = false;
      try {
        await validateRepairReview(
          admissionText,
          text,
          (path) =>
            readReviewEvidence(
              join(evidenceRoot, relative("/tmp/gh-aw/agent", path)),
              evidenceRoot,
            ),
          {
            allowPending: true,
            requireRepair: review.candidates.some((candidate) => candidate.status === "repaired"),
            ...(published ? { patchHash: published.patch_sha256 } : {}),
          },
        );
        verified = true;
      } catch {
        /* Partial notes survive as leads; invalid receipts never close a task. */
      }
      for (const admitted of admission.candidates) {
        const provider = admitted.id.split("/")[0];
        if (
          !provider ||
          !["catalog", "workflow", ...manifests.map((manifest) => manifest.provider.id)].includes(
            provider,
          )
        )
          continue;
        let task = state.tasks.find((task) => task.id === admitted.id);
        if (!task) {
          task = {
            id: admitted.id,
            provider,
            trigger: admitted.trigger,
            fingerprint: digest(admitted.id),
            first_seen: now.toISOString(),
            last_seen: now.toISOString(),
            attempts: 0,
            status: "pending",
            reason: admitted.description,
            next_action: "Resume the unfinished review",
            coverage: [],
            source_versions: {},
          };
          state.tasks.push(task);
        }
        if (!recordAttempt(task, prepared, run, attempt, now)) continue;
        if (
          decision?.takeover_attempted &&
          (decision.takeover_candidate_ids?.includes(task.id) ??
            feedback.initialErrors.has(task.id))
        )
          task.takeover_fingerprint = task.fingerprint;
        const row = review.candidates.find((row) => row.id === task.id);
        if (row) {
          const supported =
            finalReview &&
            process.env.MAINTENANCE_REVIEW_RESULT === "success" &&
            decision?.verdict === "supported" &&
            decision.admission_sha256 === digest(admissionText) &&
            decision.review_sha256 === digest(text) &&
            decision.verified_candidate_ids.includes(task.id);
          const closed = row.status === "repaired" || row.status === "not_a_defect";
          const accepted = verified && (!closed || supported);
          const publication =
            published &&
            published.revision === process.env.MAINTENANCE_PUBLISHED_REVISION &&
            decision?.patch_sha256 === published.patch_sha256
              ? published.revision
              : undefined;
          recordOutcome(
            task,
            {
              status: accepted ? row.status : "pending",
              reason: row.reason,
              next_action:
                closed && !supported
                  ? feedback.nextAction(task.id) ||
                    "Independent verification did not support this conclusion. Inspect the initial and final verifier artifacts for evidence or resource limits."
                  : row.status === "repaired" && !publication
                    ? "The proposed patch was not published. Inspect the prior semantic-review and publication-validation feedback, revise the failed claim, and rerun its focused proof before resubmitting."
                    : (row.blocker?.next_action ??
                      row.next_action ??
                      "Inspect prior evidence and continue"),
              ...(accepted && row.status === "repaired" && publication
                ? { published_revision: publication }
                : {}),
            },
            now,
          );
          if (accepted && row.coverage) task.coverage = row.coverage;
          if (task.status === "code_published")
            task.source_versions = published?.providers[task.provider] ?? {};
        }
      }
    }
    writeState(repo, state, sha);
  } else if (command === "record-deployment") {
    const receipt = JSON.parse(await readFile(process.argv[3] ?? "", "utf8"));
    if (recordDeployment(state, env("GITHUB_RUN_ID"), receipt)) writeState(repo, state, sha);
  } else if (command === "observe") {
    const event = z
      .object({
        workflow_run: z.object({
          id: z.number().int().positive(),
          run_attempt: z.number().int().positive(),
          head_branch: z.literal("main"),
          head_repository: z.object({ full_name: z.literal(repo) }),
          conclusion: z.literal("success"),
          name: z.literal("Refresh catalog"),
          path: z.literal(".github/workflows/catalog.yml"),
        }),
      })
      .parse(JSON.parse(await readFile(env("GITHUB_EVENT_PATH"), "utf8")));
    const run = event.workflow_run;
    const log = execFileSync(
      "git",
      ["log", "-1", "--format=%B", "--", "data/catalog-snapshot.json"],
      { encoding: "utf8" },
    );
    if (log.includes(`/actions/runs/${run.id}`)) process.env.MAINTENANCE_REFRESH_PUBLISHED = "true";
    await observe(state);
    const artifacts = z
      .object({
        artifacts: z.array(
          z.object({ name: z.string(), expired: z.boolean(), size_in_bytes: z.number() }),
        ),
      })
      .parse(githubApi(`repos/${repo}/actions/runs/${run.id}/artifacts?per_page=100`));
    for (const artifact of artifacts.artifacts.filter(
      (artifact) =>
        !artifact.expired &&
        artifact.name.startsWith(`catalog-public-evidence-${run.id}-attempt-${run.run_attempt}-`),
    )) {
      if (artifact.size_in_bytes > 64 * 1024 * 1024) continue;
      const path = join(env("RUNNER_TEMP"), "discovery", artifact.name);
      execFileSync(
        "gh",
        ["run", "download", String(run.id), "--name", artifact.name, "--dir", path],
        { timeout: 180000 },
      );
      for (const name of (await readdir(path)).filter((name) => name.endsWith(".json.gz"))) {
        const receipt = z
          .object({ source_id: z.string(), source_hash: z.string(), body: z.string().optional() })
          .parse(
            JSON.parse(
              gunzipSync(await readFile(join(path, name)), {
                maxOutputLength: 34 * 1024 * 1024,
              }).toString("utf8"),
            ),
          );
        const manifest = manifests.find((manifest) =>
          manifest.sources.some((source) => source.id === receipt.source_id),
        );
        if (manifest && receipt.body && digest(receipt.body) === receipt.source_hash)
          recordDiscovery(state, manifest.provider.id, receipt.source_id, receipt.body, now);
      }
    }
    const current = new Set(
      catalogRepairCandidates(JSON.parse(await readFile("data/refresh-summary.json", "utf8"))).map(
        candidateKey,
      ),
    );
    const ready = state.tasks.some(
      (task) =>
        task.status === "pending" &&
        (current.has(task.id) || task.id.includes("/discovery:")) &&
        (!task.retry_at || Date.parse(task.retry_at) <= now.getTime()),
    );
    if (
      ready &&
      (!state.last_dispatch || now.getTime() - Date.parse(state.last_dispatch) >= 6 * 3600000)
    ) {
      // Persist the dispatch claim before sending: an ambiguous API response cannot multiply jobs.
      state.last_dispatch = now.toISOString();
      writeState(repo, state, sha);
      execFileSync("gh", ["workflow", "run", "catalog-repair.lock.yml", "--ref", "main"], {
        timeout: 60000,
      });
      return;
    }
    writeState(repo, state, sha);
  } else throw new Error("Expected prepare, finish or observe");
  if (process.env.GITHUB_STEP_SUMMARY)
    await appendFile(
      process.env.GITHUB_STEP_SUMMARY,
      `\n## Catalog maintenance\n\n${JSON.stringify(
        state.tasks.map(({ id, status, next_action }) => ({ id, status, next_action })),
        null,
        2,
      )}\n`,
    );
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
