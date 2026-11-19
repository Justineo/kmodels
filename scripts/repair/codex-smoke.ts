import assert from "node:assert/strict";
import { request } from "node:http";
import { spawn } from "node:child_process";
import { z } from "zod";
import { mkdir, mkdtemp, readFile, rm, rmdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startRelay } from "./codex-relay.ts";
import { startCodexGateway, codexRequest } from "./codex-gateway.ts";
import { codexArguments, codexModelCatalog, containerArguments } from "./codex-runner.ts";
import { runAllowance } from "./state.ts";

// Protocol/isolation smoke with deterministic local Responses data, never paid inference.
const local = process.argv.includes("--local");
const directory = await mkdtemp(join(process.env.RUNNER_TEMP ?? tmpdir(), "codex-smoke-"));
const evidence = join(directory, "evidence");
const input = join(directory, "input");
const output = join(directory, "output");
for (const path of [evidence, input, output, join(directory, "home")]) await mkdir(path);
await mkdir(join(output, "sources"));
await mkdir(join(evidence, "independent-sources"));
await mkdir(join(evidence, "probes"));
const mountpoint = local ? undefined : await mkdir("repair-probes", { recursive: true });
await writeFile(
  join(evidence, "probes/protocol.test.ts"),
  `
import { readFileSync } from "node:fs";
import { expect, it } from "vite-plus/test";
import { canonicalJson } from "../src/catalog/canonical-value.ts";
it("reads the candidate snapshot offline", () => {
  expect(canonicalJson(JSON.parse(readFileSync("data/catalog-snapshot.json", "utf8")).version)).toBe("1");
});
`,
);
let calls = 0;
// The first tool response crosses the CLI's 24k compaction threshold.
const protocolCharge = 50_217 + 217 + 217;
let failNext = false;
let signalStart: () => void = () => undefined;
let failNetwork: (error: Error) => void = () => undefined;
const started = new Promise<void>((resolve) => {
  signalStart = resolve;
});
const network = new Promise<Response>((_resolve, reject) => {
  failNetwork = reject;
});
const gateway = await startCodexGateway({
  key: "not-a-real-key",
  lease: {
    id: "1-1",
    month: new Date().toISOString().slice(0, 7),
    reserved_microusd: runAllowance,
    charged_microusd: 0,
    settled: false,
  },
  charged: 0,
  privateDirectory: output,
  socket: join(directory, "api.sock"),
  providers: new Set(),
  fetcher: async (_url, options) => {
    calls += 1;
    if (failNext) {
      signalStart();
      return network;
    }
    if (typeof options?.body !== "string") throw new Error("Missing protocol request");
    const command = local
      ? "printf catalog-tool-%s ok"
      : 'test -z "${CATALOG_REPAIR_OPENAI_API_KEY:-}${GH_TOKEN:-}${GITHUB_TOKEN:-}" && test ! -w /workspace/package.json && test ! -w /workspace/.git/config && test -w /workspace/repair-probes && test ! -w /trusted/package.json && test ! -w /tmp/gh-aw/agent/independent-sources && test ! -e /var/run/docker.sock && test "$(ls /sys/class/net)" = lo && vp node /trusted/scripts/catalog-repair-review.ts probe consumer investigation -- test --configLoader runner --config /trusted/scripts/repair/probe.config.ts --run repair-probes/protocol.test.ts && printf catalog-tool-%s ok';
    const request = z
      .object({
        input: z.array(z.object({ type: z.string(), output: z.unknown().optional() })),
        tool_choice: z.unknown().optional(),
      })
      .parse(JSON.parse(options.body));
    if (calls === 1) assert.notEqual(request.tool_choice, "none");
    if (calls === 2 || calls === 3) assert.equal(request.tool_choice, "none");
    const checkpoint = "compacted-catalog-proof";
    if (calls === 3) assert.ok(options.body.includes(checkpoint), "Missing compacted context");
    if (
      calls === 2 &&
      !request.input.some(
        (item) =>
          item.type === "custom_tool_call_output" &&
          JSON.stringify(item.output)?.includes("catalog-tool-ok"),
      )
    )
      throw new Error("Missing real tool round-trip output");
    const outputText = calls === 2 ? checkpoint : "catalog-protocol-ok";
    const item =
      calls === 1
        ? {
            id: "ctc_smoke",
            type: "custom_tool_call",
            status: "completed",
            call_id: "call_smoke",
            name: "exec",
            namespace: "functions",
            input: `text(await tools.exec_command(${JSON.stringify({ cmd: command, max_output_tokens: 1000 })}));`,
          }
        : {
            id: "msg_smoke",
            type: "message",
            role: "assistant",
            status: "completed",
            content: [{ type: "output_text", text: outputText, annotations: [] }],
          };
    const response = {
      id: "resp_smoke",
      object: "response",
      created_at: 1,
      status: "completed",
      model: "gpt-6.2-sol",
      output: [item],
      usage: {
        input_tokens: calls === 1 ? 25010 : 10,
        output_tokens: 20,
        total_tokens: calls === 1 ? 25030 : 30,
        input_tokens_details: {
          cached_tokens: 4,
          cache_write_tokens: 3,
          cache_write_tokens_details: { ttl_30m_tokens: 2, ttl_12h_tokens: 1 },
        },
      },
    };
    const events = [
      { type: "response.created", response: { ...response, status: "in_progress", output: [] } },
      {
        type: "response.output_item.added",
        output_index: 0,
        item: { ...item, status: "in_progress", content: [] },
      },
      ...(calls === 1
        ? []
        : [
            {
              type: "response.output_text.delta",
              item_id: item.id,
              output_index: 0,
              content_index: 0,
              delta: outputText,
            },
          ]),
      { type: "response.output_item.done", output_index: 0, item },
      { type: "response.completed", response },
    ];
    return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), {
      headers: { "Content-Type": "text/event-stream" },
    });
  },
});
gateway.startPhase(runAllowance, 3);
const relay = local ? startRelay(join(directory, "api.sock"), 0) : undefined;
try {
  if (relay && !relay.listening)
    await new Promise<void>((resolve) => relay.once("listening", resolve));
  const address = relay?.address();
  const modelCatalog = join(input, "codex-model.json");
  await writeFile(modelCatalog, JSON.stringify(codexModelCatalog));
  const args = local
    ? codexArguments(modelCatalog).map((arg) =>
        arg
          .replace(
            "127.0.0.1:8765",
            `127.0.0.1:${address && typeof address !== "string" ? address.port : 8765}`,
          )
          .replace("/output/result.json", join(output, "result.json")),
      )
    : containerArguments(
        {
          name: "catalog-codex-smoke",
          work: process.cwd(),
          trusted: process.cwd(),
          input,
          output,
          evidence,
          sources: join(output, "sources"),
          gateway: directory,
          toolchain: process.env.VP_HOME ?? "/tmp/kmodels-vite-plus",
        },
        "/input/prompt.txt",
      );
  await writeFile(
    join(input, "prompt.txt"),
    "Run the supplied protocol check, then reply catalog-protocol-ok.",
  );
  await new Promise<void>((resolve, reject) => {
    const child = spawn(local ? "codex" : "docker", args, {
      env: { PATH: process.env.PATH, HOME: directory, CODEX_HOME: join(directory, "home") },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let log = "";
    child.stdout.on("data", (chunk: Buffer) => {
      log += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      log += chunk.toString();
    });
    child.stdin.end("Run the supplied protocol check, then reply catalog-protocol-ok.");
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
    }, 60000);
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(log.slice(-6000)));
    });
  });
  if (
    (await readFile(join(output, "result.json"), "utf8")).trim() !== "catalog-protocol-ok" ||
    calls !== 3 ||
    gateway.charged() !== protocolCharge
  )
    throw new Error("Codex protocol smoke did not complete with exact mocked usage");
  // Exercise ambiguous transport failure and contention against the same real Unix gateway.
  const requestInput = { model: "gpt-6.2-sol", input: [], instructions: "x".repeat(90_000) };
  const post = (path = "/v1/responses", body: unknown = requestInput) =>
    new Promise<number>((resolve, reject) => {
      const req = request(
        { socketPath: join(directory, "api.sock"), path, method: "POST" },
        (res) => {
          res.resume();
          res.on("end", () => resolve(res.statusCode ?? 0));
        },
      );
      req.on("error", reject);
      req.end(JSON.stringify(body));
    });
  assert.equal(gateway.remainingCalls(), 0);
  assert.equal(await post(), 400);
  gateway.startPhase(1_000_000);
  assert(codexRequest(requestInput).reservation > gateway.remaining());
  // Hold a source request open while the inference route evaluates its own budget.
  const source = request({
    socketPath: join(directory, "api.sock"),
    path: "/source",
    method: "POST",
    headers: { Expect: "100-continue" },
  });
  const ready = new Promise<void>((resolve, reject) => {
    source.once("continue", resolve);
    source.once("error", reject);
  });
  const sourceResult = new Promise<number>((resolve, reject) => {
    source.once("response", (response) => {
      response.resume();
      resolve(response.statusCode ?? 0);
    });
    source.once("error", reject);
  });
  source.flushHeaders();
  try {
    await ready;
    const queued = post("/source", { source: "outside-admission" });
    assert.equal(await post(), 400);
    source.end(JSON.stringify({ source: "outside-admission" }));
    assert.equal(await sourceResult, 400);
    assert.equal(await queued, 400);
  } finally {
    source.destroy();
  }
  assert.equal(calls, 3);
  gateway.startPhase();
  assert.equal(gateway.remaining(), runAllowance - protocolCharge);
  assert.equal(gateway.remainingCalls(), 57);
  gateway.startPhase(codexRequest(requestInput, true).reservation);
  failNext = true;
  const pending = post();
  await started;
  const reserved = protocolCharge + codexRequest(requestInput, true).reservation;
  const journal = async () =>
    z
      .object({
        charged_microusd: z.number(),
        requests: z.array(
          z.object({
            status: z.string(),
            charged_microusd: z.number(),
            settlement: z
              .object({
                charges: z.object({
                  cache_read: z.object({ tokens: z.number(), cost_nanousd: z.number() }),
                }),
              })
              .optional(),
          }),
        ),
      })
      .parse(JSON.parse(await readFile(join(output, "review-usage.json"), "utf8")));
  const pendingJournal = await journal();
  assert.equal(pendingJournal.charged_microusd, reserved);
  assert.deepEqual(
    pendingJournal.requests.map((row) => row.status),
    ["settled", "settled", "settled", "reserved"],
  );
  assert.deepEqual(pendingJournal.requests[0]?.settlement?.charges.cache_read, {
    tokens: 4,
    cost_nanousd: 400,
  });
  const queued = post();
  assert.equal(await post("/source", { source: "outside-admission" }), 400);
  failNetwork(new Error("Ambiguous transport failure"));
  assert.equal(await pending, 400);
  assert.equal(await queued, 400);
  assert.equal(gateway.charged(), reserved);
  gateway.startPhase(0);
  assert.equal(await post(), 400);
  assert.equal(calls, 4);
  failNext = false;
  gateway.startPhase();
  const burst = Array.from({ length: 4 }, () =>
    post("/v1/responses", {
      model: "gpt-6.2-sol",
      input: [{ type: "custom_tool_call_output", output: "catalog-tool-ok" }],
    }),
  );
  assert.deepEqual(await Promise.all(burst), [200, 200, 200, 200]);
  assert.equal(calls, 8);
  assert.equal(gateway.charged(), reserved + 4 * 217);
  const final = await journal();
  assert.equal(final.requests[3]?.status, "retained");
  assert.equal(
    final.requests.reduce((sum, row) => sum + row.charged_microusd, 0),
    final.charged_microusd,
  );
  console.log(
    "Codex tool protocol, private accounting and failure-budget smoke passed without paid inference.",
  );
} finally {
  relay?.closeAllConnections();
  relay?.close();
  await gateway.close();
  if (mountpoint) await rmdir(mountpoint);
  await rm(directory, { recursive: true, force: true });
}
