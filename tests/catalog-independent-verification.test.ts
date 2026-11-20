import { expect, it, vi } from "vite-plus/test";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkVerification,
  checkSessionVerification,
  checkTakeoverCheckpoint,
  closedCandidates,
  reusableBaseline,
  readTakeoverResponse,
  verificationVerdict,
} from "../scripts/repair/verification.ts";
import { codexRequest, boundedBody, serialRoute } from "../scripts/repair/codex-gateway.ts";
import { streamSettlement } from "../scripts/repair/codex-usage.ts";
import {
  checkEvidenceTree,
  codexArguments,
  containerArguments,
  saveBlindedBaseline,
  restoreBlindedBaseline,
} from "../scripts/repair/codex-runner.ts";
import { digest } from "../scripts/repair/state.ts";
import { verificationFeedback } from "../scripts/repair/verification-feedback.ts";
import { investigationRoute, reviewRoute, settlementReceipt } from "../scripts/repair/flow.ts";
import { parseInvestigationOutcome } from "../scripts/catalog-repair-publication.ts";

function report(verdict: "supported" | "concrete_error" | "insufficient_evidence" = "supported") {
  const files = new Map<string, string>([
    ["source", "Independent official source body"],
    [
      "consumer",
      JSON.stringify({
        schema_version: 1,
        command: "vp test --run tests/provider.test.ts",
        exit_code: 0,
      }),
    ],
  ]);
  const ref = (path: string) => ({ path, sha256: digest(files.get(path) ?? "") });
  const row = {
    id: "openai/pricing",
    verdict,
    reason: "Compared actual scoped consumer behavior to the official source",
    expected: "The price excludes cached tokens",
    actual: "The price includes cached tokens",
    evidence: [ref("source")],
    checks: [
      { kind: "consumer", output: ref("consumer") },
      { kind: "counterexample", output: ref("consumer") },
    ],
  };
  return {
    row,
    input: { candidates: [row] },
    read: async (path: string) => {
      const text = files.get(path);
      if (!text) throw new Error("Missing proof");
      return text;
    },
    files,
  };
}
it("checks session context without counting it as independent evidence", async () => {
  const s = report("concrete_error");
  const path = "/tmp/gh-aw/agent/independent-sources/source.json";
  const source = { path, sha256: digest("official source") };
  const patch = { path: "/input/patch.diff", sha256: digest("proposed edit") };
  const inputs = new Map([[patch.path, "proposed edit"]]);
  const read = vi.fn(async () => "official source");
  const verify = (evidence: (typeof source)[]) =>
    checkSessionVerification(
      JSON.stringify({
        candidates: [{ ...s.row, evidence, checks: [] }],
      }),
      [s.row.id],
      inputs,
      read,
    );
  expect((await verify([patch, source])).candidates[0]?.evidence).toEqual([source]);
  expect(read).toHaveBeenCalledExactlyOnceWith(path);
  await expect(verify([patch])).rejects.toThrow("original evidence");
  await expect(verify([{ ...patch, sha256: source.sha256 }])).rejects.toThrow(
    "changed session input",
  );
  await expect(verify([{ ...source, path: "/input/unlisted.txt" }])).rejects.toThrow(
    "evidence directory",
  );
});

it("preserves an unfinished takeover and applies the existing publication constraints to completed ones", () => {
  const result = (type: string, summary: string, body = "") =>
    readTakeoverResponse(JSON.stringify({ type, summary, body }));
  expect(result("report_incomplete", "Still missing the final regression receipt.")).toEqual({
    type: "report_incomplete",
    reason: "Still missing the final regression receipt.",
  });
  expect(result("noop", "Every candidate was checked.")).toEqual({
    type: "noop",
    message: "Every candidate was checked.",
  });
  expect(result("commit_repair", "Fix scope", "Checked both consumers.")).toEqual({
    type: "commit_repair",
    title: "Fix scope",
    body: "Checked both consumers.",
  });
  expect(() => result("commit_repair", "Unchecked patch")).toThrow();
});

it("reuses only a blinded baseline from the same admission and complete candidate set", () => {
  const checkpoint = {
    admission_sha256: digest("base and admission"),
    candidate_ids: ["a", "b"],
    assessment: "Independent baseline",
    has_files: false,
  };
  expect(reusableBaseline(checkpoint, "base and admission", ["b", "a"])).toEqual(checkpoint);
  expect(reusableBaseline(checkpoint, "new base", ["a", "b"])).toBeUndefined();
  expect(reusableBaseline(checkpoint, "base and admission", ["a"])).toBeUndefined();
  expect(reusableBaseline(undefined, "base and admission", ["a", "b"])).toBeUndefined();
});

it("restores only evidence frozen before the proposal was visible", async () => {
  const root = await mkdtemp(join(tmpdir(), "repair-baseline-"));
  try {
    const evidence = join(root, "evidence"),
      prior = join(root, "prior"),
      restored = join(root, "restored");
    await mkdir(join(evidence, "independent-sources"), { recursive: true });
    await mkdir(prior);
    await writeFile(join(evidence, "independent-sources", "original.json"), "gateway-owned");
    await writeFile(join(evidence, "consumer.txt"), "blinded evidence");
    await saveBlindedBaseline(
      prior,
      evidence,
      "same base and admission",
      ["model"],
      "original finding",
    );
    await writeFile(join(evidence, "consumer.txt"), "proposer edit");
    await writeFile(join(evidence, "proposer.txt"), "late evidence");
    expect(
      await restoreBlindedBaseline(prior, restored, "same base and admission", ["model"]),
    ).toBe("original finding");
    expect(await readFile(join(restored, "consumer.txt"), "utf8")).toBe("blinded evidence");
    expect(await readdir(restored)).toEqual(["consumer.txt"]);
    await rm(join(prior, "baseline-files"), { recursive: true });
    expect(
      await restoreBlindedBaseline(prior, restored, "same base and admission", ["model"]),
    ).toBeUndefined();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("keeps the initial contradiction and partial revised work available after an interruption", async () => {
  const root = await mkdtemp(join(tmpdir(), "repair-feedback-"));
  try {
    const initial = join(root, "catalog-maintenance-initial");
    const revised = join(root, "catalog-maintenance-review");
    await mkdir(initial);
    const { input, row } = report("concrete_error");
    await writeFile(join(initial, "initial-verification.json"), JSON.stringify(input));
    expect((await verificationFeedback(root)).nextAction(row.id)).toContain(row.actual);
    await mkdir(revised);
    await writeFile(
      join(revised, "progress.json"),
      JSON.stringify({ candidates: [{ id: row.id, next_action: "Replay the August control." }] }),
    );
    await writeFile(join(revised, "interruption.json"), JSON.stringify({ session: "verify" }));
    const feedback = await verificationFeedback(root);
    expect(feedback.nextAction(row.id)).toContain(row.expected);
    expect(feedback.nextAction(row.id)).toContain("Replay the August control.");
    expect(feedback.nextAction(row.id)).toContain("interrupted");
    expect(feedback.nextAction("other")).not.toContain(row.expected);
    expect([...feedback.initialErrors]).toEqual([row.id]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("independently checks repaired and no-defect conclusions, including mixed outcomes", () => {
  expect(
    closedCandidates({
      admission_sha256: "hash",
      candidates: [
        { id: "a", status: "repaired", reason: "fixed" },
        { id: "b", status: "not_a_defect", reason: "checked" },
        { id: "c", status: "blocked", reason: "source missing" },
        { id: "d", status: "pending", reason: "unfinished" },
      ],
    }),
  ).toEqual(["a", "b"]);
});
it("does not let a green parser or missing candidate establish a verified no-op", async () => {
  const s = report();
  expect(verificationVerdict(await checkVerification(s.input, [s.row.id], s.read))).toBe(
    "supported",
  );
  await expect(checkVerification(s.input, [s.row.id, "missing"], s.read)).rejects.toThrow(
    "every closed candidate",
  );
  await expect(
    checkVerification({ candidates: [s.row, s.row] }, [s.row.id], s.read),
  ).rejects.toThrow("exactly once");
  s.row.checks = [];
  await expect(checkVerification(s.input, [s.row.id], s.read)).rejects.toThrow("consumer proof");
  s.files.set("source", "modified evidence");
  await expect(checkVerification(s.input, [s.row.id], s.read)).rejects.toThrow("evidence changed");
});
it("escalates only a concrete contradiction and keeps uncertainty incomplete", async () => {
  const s = report("concrete_error");
  expect(verificationVerdict(await checkVerification(s.input, [s.row.id], s.read))).toBe(
    "concrete_error",
  );
  s.row.actual = s.row.expected;
  await expect(checkVerification(s.input, [s.row.id], s.read)).rejects.toThrow("contradiction");
  const unknown = report("insufficient_evidence");
  unknown.row.evidence = [];
  unknown.row.checks = [];
  expect(
    verificationVerdict(await checkVerification(unknown.input, [unknown.row.id], unknown.read)),
  ).toBe("insufficient_evidence");
});

it("routes only completed proposals with admitted work to independent verification", () => {
  const noop = { type: "noop", message: "No repair required" } as const;
  expect(investigationRoute(noop, 0)).toBe("idle");
  expect(investigationRoute(noop, 1)).toBe("verify");
  const patch = {
    type: "commit_repair",
    title: "Fix unit",
    body: "Reproduced with source data",
  } as const;
  expect(investigationRoute(patch, 2)).toBe("verify");
  expect(() => investigationRoute(patch, 0)).toThrow("admitted candidates");
  for (const type of ["missing_data", "missing_tool", "report_incomplete"]) {
    const unfinished = parseInvestigationOutcome(
      JSON.stringify({ type, reason: "Missing original offer" }),
    );
    expect(unfinished).toEqual({
      type: "report_incomplete",
      cause: type,
      reason: "Missing original offer",
    });
    for (const count of [0, 2]) expect(investigationRoute(unfinished, count)).toBe("pending");
  }
});

it.each([
  ["supported", "verified", "verified", "verified"],
  ["concrete_error", "needs_takeover", "pending", "pending"],
  ["insufficient_evidence", "pending", "pending", "pending"],
] as const)(
  "routes a checked %s verdict across initial and takeover stages",
  async (verdict, first, repeated, revised) => {
    const s = report(verdict);
    const checked = await checkVerification(s.input, [s.row.id], s.read);
    expect(reviewRoute(checked, "initial", false)).toBe(first);
    expect(reviewRoute(checked, "initial", true)).toBe(repeated);
    expect(reviewRoute(checked, "takeover", true)).toBe(revised);
  },
);

it("settles only from the last stage that could have spent money, including failed stages", () => {
  expect(settlementReceipt("skipped", "", "success")).toBe("catalog-maintenance-usage/usage.json");
  for (const initial of ["pending", "noop", "commit_repair"]) {
    expect(settlementReceipt("success", initial, "success")).toBe(
      "catalog-maintenance-initial/review-usage.json",
    );
  }
  expect(settlementReceipt("failure", "", "skipped")).toBe(
    "catalog-maintenance-initial/review-usage.json",
  );
  expect(settlementReceipt("success", "needs_takeover", "skipped")).toBe(
    "catalog-maintenance-initial/review-usage.json",
  );
  for (const result of ["success", "failure", "cancelled"])
    expect(settlementReceipt("success", "needs_takeover", result)).toBe(
      "catalog-maintenance-review/review-usage.json",
    );
});

it("requires a bound concrete-error checkpoint before additional budget or takeover", async () => {
  const s = report("concrete_error");
  const admission = "immutable admission";
  const review = JSON.stringify({
    admission_sha256: digest(admission),
    candidates: [{ id: s.row.id, status: "not_a_defect", reason: "Initial conclusion" }],
  });
  const decision = {
    verdict: "concrete_error",
    takeover_attempted: false,
    admission_sha256: digest(admission),
    review_sha256: digest(review),
    patch_sha256: digest(""),
  };
  const checkpoint = { decision, report: s.input, admission, review, patch: "", read: s.read };
  await expect(checkTakeoverCheckpoint(checkpoint)).resolves.toEqual(s.input);
  await expect(
    checkTakeoverCheckpoint({ ...checkpoint, patch: "different patch" }),
  ).rejects.toThrow();
  await expect(
    checkTakeoverCheckpoint({ ...checkpoint, decision: { ...decision, takeover_attempted: true } }),
  ).rejects.toThrow();
  const supported = report();
  await expect(
    checkTakeoverCheckpoint({ ...checkpoint, report: supported.input, read: supported.read }),
  ).rejects.toThrow("concrete error");
  s.files.set("source", "changed receipt");
  await expect(checkTakeoverCheckpoint(checkpoint)).rejects.toThrow("evidence changed");
});
it("bounds real Codex requests and prevents alternate models and hidden paid tools", () => {
  const request = codexRequest({
    model: "gpt-6.2-sol",
    input: [],
    max_output_tokens: 999999,
    store: true,
    service_tier: "priority",
    tools: [{ type: "function", name: "shell" }],
  });
  expect(JSON.parse(request.body)).toMatchObject({
    model: "gpt-6.2-sol",
    reasoning: { effort: "high" },
    store: false,
    service_tier: "default",
    max_output_tokens: 4096,
  });
  expect(request.reservation).toBeGreaterThan(0);
  const closing = codexRequest(
    { model: "gpt-6.2-sol", input: [], instructions: "Assess facts.", tools: [] },
    true,
  );
  expect(JSON.parse(closing.body)).toMatchObject({
    tool_choice: "none",
    instructions: expect.stringMatching(/^Assess facts\.[\s\S]*unresolved claim/),
  });
  for (const extra of [
    { model: "gpt-6.1-sol" },
    { model: "gpt-6-astra" },
    { previous_response_id: "secret-handle" },
    { tools: [{ type: "web_search" }] },
    {
      input: [
        {
          type: "additional_tools",
          tools: [{ type: "namespace", tools: [{ type: "web_search" }] }],
        },
      ],
    },
    { input: [{ type: "input_image", image_url: "data:image/png;base64,AAAA" }] },
    { instructions: "x".repeat(170000) },
  ])
    expect(() => codexRequest({ model: "gpt-6.2-sol", input: [], ...extra })).toThrow();
});
it("settles only one completed SSE response and charges reasoning output", async () => {
  const event =
    "data: " +
    JSON.stringify({
      type: "response.completed",
      response: { model: "gpt-6.2-sol", usage: { input_tokens: 10, output_tokens: 20 } },
    }) +
    "\n\n";
  expect(streamSettlement(event)).toMatchObject({
    charged_microusd: 250,
    charges: { unclassified_input: { tokens: 10, cost_nanousd: 50000 } },
  });
  expect(
    streamSettlement(event.replace("gpt-6.2-sol", "gpt-6.2-sol-2026-11-17")).charged_microusd,
  ).toBe(250);
  expect(() => streamSettlement(event.replace("gpt-6.2-sol", "gpt-6.1-sol"))).toThrow(
    "reservation retained",
  );
  expect(() => streamSettlement(event + event)).toThrow("unique completed");
  expect(() => streamSettlement('data: {"type":"response.failed"}\n\n')).toThrow();
  await expect(
    boundedBody(
      (async function* () {
        yield Buffer.from("123");
        yield Buffer.from("456");
      })(),
      5,
    ),
  ).rejects.toThrow("limit");
});
function settle(input: number, details: unknown) {
  return streamSettlement(
    "data: " +
      JSON.stringify({
        type: "response.completed",
        response: {
          model: "gpt-6.2-sol",
          service_tier: "default",
          usage: {
            input_tokens: input,
            input_tokens_details: details,
            output_tokens: 20,
            output_tokens_details: { reasoning_tokens: 15 },
          },
        },
      }),
  );
}
it("prices disjoint cache buckets at the total-input context boundary and rounds once", () => {
  const details = {
    cached_tokens: 4,
    cache_write_tokens: 3,
    cache_write_tokens_details: { ttl_30m_tokens: 1, ttl_12h_tokens: 2 },
  };
  const short = settle(272000, details);
  expect(short.charges).toMatchObject({
    ordinary_input: { tokens: 271993, cost_nanousd: 543986000 },
    cache_read: { tokens: 4, cost_nanousd: 400 },
    cache_write_30m: { tokens: 1, cost_nanousd: 2500 },
    cache_write_12h: { tokens: 2, cost_nanousd: 10000 },
    output: { tokens: 20, cost_nanousd: 200000 },
  });
  expect(short.charged_microusd).toBe(544199);
  const long = settle(272001, details);
  expect(long.context_band).toBe("long");
  expect(long.charged_microusd).toBe(1088302);
});
it("preserves ambiguous tokens separately and credits confirmed hits", () => {
  const partial = settle(100, { cached_tokens: 90 });
  expect(partial.charges.unclassified_input).toMatchObject({ tokens: 10, cost_nanousd: 50000 });
  expect(partial.charged_microusd).toBe(259);
  const aggregate = settle(100, { cached_tokens: 90, cache_write_tokens: 3 });
  expect(aggregate.charges.cache_write_unknown_ttl).toMatchObject({
    tokens: 3,
    cost_nanousd: 15000,
  });
  expect(aggregate.charged_microusd).toBe(238);
  expect(
    settle(10, { cached_tokens: 0, cache_write_tokens: 0 }).charges.ordinary_input.tokens,
  ).toBe(10);
});
it.each([
  { cached_tokens: 9, cache_write_tokens: 2 },
  { cached_tokens: -1 },
  { cache_write_tokens: 2, cache_write_tokens_details: { ttl_30m_tokens: 1, ttl_12h_tokens: 2 } },
  { cache_write_tokens_details: { ttl_30m_tokens: 1 } },
])("rejects inconsistent or malformed cache details", (details) => {
  expect(() => settle(10, details)).toThrow();
});
it("serves a burst in arrival order and drops excess, expired and disconnected requests", async () => {
  vi.useFakeTimers();
  let release: () => void = () => undefined;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  const processed: string[] = [];
  const route = serialRoute(async (req, res) => {
    processed.push(req.url ?? "");
    await hold;
    res.end();
  });
  const submit = (label: string) => {
    const req = new IncomingMessage(new Socket());
    req.url = label;
    const res = new ServerResponse(req);
    route.submit(req, res);
    return res;
  };
  try {
    submit("active");
    const expired = submit("expired");
    await vi.advanceTimersByTimeAsync(180_000);
    expect(expired.statusCode).toBe(503);
    const disconnected = submit("disconnected");
    const labels = Array.from({ length: 7 }, (_, index) => String(index));
    const waiting = labels.map(submit);
    expect(submit("excess").statusCode).toBe(429);
    disconnected.emit("close");
    waiting.push(submit("last"));
    expect(processed).toEqual(["active"]);
    release();
    await route.drain();
    expect(processed).toEqual(["active", ...labels, "last"]);
    expect(waiting.every((res) => res.statusCode === 200 && res.writableEnded)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    release();
    vi.useRealTimers();
  }
});

it("isolates Codex from host secrets, external networks, Git metadata and publication credentials", () => {
  const args = containerArguments(
    {
      name: "test",
      work: "/work",
      trusted: "/trusted-root",
      input: "/inputs",
      output: "/results",
      evidence: "/evidence",
      gateway: "/socket",
      sources: "/private/sources",
      toolchain: "/vp",
    },
    "/input/prompt.txt",
  );
  expect(args).toContain("none");
  expect(args).toContain("--read-only");
  expect(args).toContain("no-new-privileges");
  expect(args).toContain("type=bind,source=/work/.git,target=/workspace/.git,readonly");
  expect(args).toContain("type=bind,source=/work,target=/workspace,readonly");
  expect(args).toContain("type=bind,source=/evidence/probes,target=/workspace/repair-probes");
  expect(args).toContain(
    "type=bind,source=/private/sources,target=/tmp/gh-aw/agent/independent-sources,readonly",
  );
  expect(args.join(" ")).not.toMatch(
    /OPENAI_API_KEY|GH_TOKEN|docker.sock|--privileged|--network host/,
  );
  expect(codexArguments()).toContain("gpt-6.2-sol");
  expect(codexArguments()).toContain('model_reasoning_effort="high"');
  expect(codexArguments().join(" ")).toContain("request_max_retries=0");
});

it("rejects symlink evidence before any trusted copy or artifact upload", async () => {
  const directory = await mkdtemp(join(tmpdir(), "catalog-proof-"));
  try {
    await writeFile(join(directory, "receipt.json"), "{}");
    await checkEvidenceTree(directory);
    await symlink(join(directory, "receipt.json"), join(directory, "alias.json"));
    await expect(checkEvidenceTree(directory)).rejects.toThrow("regular files");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
