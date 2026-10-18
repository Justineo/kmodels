import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vite-plus/test";
import {
  readReviewEvidence,
  reviewHash,
  validateRepairReview,
} from "../scripts/catalog-repair-review.ts";

function scenario() {
  const id = "vertex/vertex-pricing";
  const admission = JSON.stringify({
    schema_version: 1,
    investigation_deadline: "2026-10-18T04:20:00Z",
    candidates: [{ id, trigger: "source_pricing_structure" }],
  });
  const files = new Map<string, string>();
  const ref = (path: string, body: string) => {
    files.set(path, body);
    return { path, sha256: reviewHash(body) };
  };
  let number = 0;
  const check = (kind: string, phase = "investigation", exit = 0) => {
    const command = `vp node /tmp/replay-${++number}.mjs`;
    const receipt = {
      schema_version: 1,
      kind,
      phase,
      command,
      exit_code: exit,
      stdout: "Observed result",
    };
    return {
      ...receipt,
      result: "Inspected exact fields",
      output: ref(`/checks/${number}`, JSON.stringify(receipt)),
    };
  };
  const evidence = [ref("/source", "Published method links to a parameter type")];
  const blocked = () => ({
    id,
    status: "blocked",
    reason: "Remaining operation result is undocumented",
    evidence,
    checks: [check("parser"), check("alternative"), check("navigation")],
    blocker: { kind: "contract", next_action: "Verify the completed-operation envelope" },
  });
  const repaired = () => ({
    id,
    status: "repaired",
    reason: "Recovered the four request selectors",
    evidence,
    checks: [check("parser", "before"), check("parser", "after"), check("regression", "after")],
  });
  const report = (rows: unknown[], extra = {}) =>
    JSON.stringify({ admission_sha256: reviewHash(admission), candidates: rows, ...extra });
  const read = async (path: string) => {
    const body = files.get(path);
    if (body === undefined) throw new Error("Missing evidence artifact");
    return body;
  };
  return { id, admission, files, check, blocked, repaired, report, read };
}

it("rejects missing, duplicate, unknown, or stale candidate reviews", async () => {
  const s = scenario();
  await expect(validateRepairReview(s.admission, s.report([]), s.read)).rejects.toThrow(
    "Unreviewed",
  );
  const row = s.blocked();
  await expect(validateRepairReview(s.admission, s.report([row, row]), s.read)).rejects.toThrow(
    "duplicate",
  );
  await expect(
    validateRepairReview(s.admission, s.report([{ ...row, id: "other" }]), s.read),
  ).rejects.toThrow("Unknown");
  await expect(validateRepairReview(s.admission + " ", s.report([row]), s.read)).rejects.toThrow(
    "this run",
  );
});

it("rejects the Veo early-stop pattern: a non-fixed URL error does not establish missing contracts", async () => {
  const s = scenario();
  const row = {
    ...s.blocked(),
    checks: [s.check("parser"), s.check("alternative"), s.check("navigation", "investigation", 1)],
  };
  await expect(validateRepairReview(s.admission, s.report([row]), s.read)).rejects.toThrow(
    "navigation or linked types",
  );
  row.checks.push(s.check("navigation"));
  expect(await validateRepairReview(s.admission, s.report([row]), s.read)).toMatchObject({
    blocked: 1,
  });
});

it("requires actual parser results and a second diagnostic pass, not passing fallback tests", async () => {
  const s = scenario();
  const row = {
    ...s.blocked(),
    status: "not_a_defect",
    checks: [s.check("regression"), s.check("alternative"), s.check("navigation")],
  };
  await expect(validateRepairReview(s.admission, s.report([row]), s.read)).rejects.toThrow(
    "parser replay",
  );
  await expect(
    validateRepairReview(
      s.admission,
      s.report([{ ...s.blocked(), checks: [s.check("parser")] }]),
      s.read,
    ),
  ).rejects.toThrow("Second diagnostic pass");
});

it("requires navigation even when an available source is labeled a source blocker", async () => {
  const s = scenario();
  const row = {
    ...s.blocked(),
    blocker: { kind: "source", next_action: "Find replacement service tables" },
    checks: [s.check("parser"), s.check("alternative")],
  };
  await expect(validateRepairReview(s.admission, s.report([row]), s.read)).rejects.toThrow(
    "navigation or linked types",
  );
});

it("allows unavailable-source blockers only with failed acquisition and alternative diagnostics", async () => {
  const s = scenario();
  const row = {
    ...s.blocked(),
    blocker: { kind: "source", next_action: "Recheck first-party source availability" },
    checks: [s.check("fetch"), s.check("alternative")],
  };
  await expect(validateRepairReview(s.admission, s.report([row]), s.read)).rejects.toThrow(
    "failed fetch",
  );
  row.checks[0] = s.check("fetch", "investigation", 1);
  expect(await validateRepairReview(s.admission, s.report([row]), s.read)).toMatchObject({
    blocked: 1,
  });
});

it("requires before/after results and a passing regression for a claimed repair", async () => {
  const s = scenario();
  await expect(
    validateRepairReview(
      s.admission,
      s.report([{ ...s.repaired(), checks: [s.check("parser", "before")] }]),
      s.read,
    ),
  ).rejects.toThrow("before/after");
  expect(
    await validateRepairReview(s.admission, s.report([s.repaired()]), s.read, {
      requireRepair: true,
    }),
  ).toMatchObject({ repaired: 1 });
  await expect(
    validateRepairReview(s.admission, s.report([s.blocked()]), s.read, { requireRepair: true }),
  ).rejects.toThrow("at least one");
  const premature = s.repaired();
  premature.checks[2] = s.check("regression", "before");
  await expect(validateRepairReview(s.admission, s.report([premature]), s.read)).rejects.toThrow(
    "passing regression",
  );
});

it("checks artifact hashes and command receipt status rather than accepting a claimed pass", async () => {
  const s = scenario();
  const row = s.repaired();
  s.files.set("/source", "changed source");
  await expect(validateRepairReview(s.admission, s.report([row]), s.read)).rejects.toThrow(
    "evidence changed",
  );
  s.files.set("/source", "Published method links to a parameter type");
  const failed = s.check("regression", "after", 1);
  row.checks[2] = { ...failed, exit_code: 0 };
  await expect(validateRepairReview(s.admission, s.report([row]), s.read)).rejects.toThrow(
    "disagrees",
  );
});

it("keeps budget-exhausted candidates pending and never admits them as completed repairs", async () => {
  const s = scenario();
  const row = {
    id: s.id,
    status: "pending",
    reason: "Need to inspect the linked type",
    next_action: "Replay that type",
  };
  const review = s.report([row], {
    interruption: { kind: "budget", reason: "Investigation time exhausted" },
  });
  await expect(
    validateRepairReview(s.admission, review, s.read, {
      allowPending: true,
      now: Date.parse("2026-10-18T04:10:00Z"),
    }),
  ).rejects.toThrow("budget remains");
  const now = Date.parse("2026-10-18T04:21:00Z");
  expect(
    await validateRepairReview(s.admission, review, s.read, { allowPending: true, now }),
  ).toMatchObject({ pending: 1 });
  await expect(validateRepairReview(s.admission, review, s.read, { now })).rejects.toThrow(
    "still needs investigation",
  );
});

it("requires a failed command receipt to stop pending work for an environment failure", async () => {
  const s = scenario();
  const rows = [
    {
      id: s.id,
      status: "pending",
      reason: "Toolchain failed",
      next_action: "Restore the prepared runtime",
    },
  ];
  const review = (exit: number) =>
    s.report(rows, {
      interruption: {
        kind: "environment",
        reason: "Runtime is unavailable",
        check: s.check("alternative", "investigation", exit),
      },
    });
  await expect(
    validateRepairReview(s.admission, review(0), s.read, { allowPending: true }),
  ).rejects.toThrow("failed command");
  expect(
    await validateRepairReview(s.admission, review(1), s.read, { allowPending: true }),
  ).toMatchObject({ pending: 1 });
});

it("allows an independent repair to be delivered with explicitly evidenced remaining blockers", async () => {
  const s = scenario();
  const admission = JSON.stringify({
    schema_version: 1,
    candidates: [
      { id: s.id, trigger: "source_pricing_structure" },
      { id: "mistral/pricing_validation", trigger: "pricing_validation" },
    ],
  });
  const review = JSON.stringify({
    admission_sha256: reviewHash(admission),
    candidates: [s.repaired(), { ...s.blocked(), id: "mistral/pricing_validation" }],
  });
  expect(await validateRepairReview(admission, review, s.read, { requireRepair: true })).toEqual({
    repaired: 1,
    blocked: 1,
    pending: 0,
    not_a_defect: 0,
  });
});

it("accepts sanitized failed-execution review without requiring live collection or credentials", async () => {
  const s = scenario();
  const row = {
    ...s.blocked(),
    blocker: { kind: "scope", next_action: "Operator must fix the workflow" },
    checks: [s.check("execution"), s.check("alternative")],
  };
  await expect(validateRepairReview(s.admission, s.report([row]), s.read)).rejects.toThrow(
    "parser replay",
  );
  const admission = JSON.stringify({
    schema_version: 1,
    candidates: [{ id: "workflow/refresh-execution", trigger: "provider_validation" }],
  });
  const review = JSON.stringify({
    admission_sha256: reviewHash(admission),
    candidates: [{ ...row, id: "workflow/refresh-execution" }],
  });
  expect(await validateRepairReview(admission, review, s.read)).toMatchObject({ blocked: 1 });
});

it("does not follow review artifacts outside the evidence directory, including symlinks", async () => {
  const directory = await mkdtemp(join(tmpdir(), "kmodels-review-"));
  try {
    const root = join(directory, "evidence");
    await mkdir(root);
    const outside = join(directory, "outside");
    await writeFile(outside, "private material");
    await symlink(outside, join(root, "link"));
    await expect(readReviewEvidence(outside, root)).rejects.toThrow("inside the agent");
    await expect(readReviewEvidence(join(root, "link"), root)).rejects.toThrow("inside the agent");
    await writeFile(join(root, "result"), "parser result");
    expect(await readReviewEvidence(join(root, "result"), root)).toBe("parser result");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
