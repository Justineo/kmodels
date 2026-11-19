import { expect, it, vi } from "vite-plus/test";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkVerification,
  checkTakeoverCheckpoint,
  closedCandidates,
  verificationVerdict,
} from "../scripts/repair/verification.ts";
import {
  codexRequest,
  streamCharge,
  boundedBody,
  serialRoute,
} from "../scripts/repair/codex-gateway.ts";
import {
  checkEvidenceTree,
  codexArguments,
  containerArguments,
} from "../scripts/repair/codex-runner.ts";
import { digest } from "../scripts/repair/state.ts";

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
  expect(streamCharge(event)).toBe(400);
  expect(streamCharge(event.replace("gpt-6.2-sol", "gpt-6.2-sol-2026-11-17"))).toBe(400);
  expect(() => streamCharge(event.replace("gpt-6.2-sol", "gpt-6.1-sol"))).toThrow(
    "reservation retained",
  );
  expect(() => streamCharge(event + event)).toThrow("unique completed");
  expect(() => streamCharge('data: {"type":"response.failed"}\n\n')).toThrow();
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
