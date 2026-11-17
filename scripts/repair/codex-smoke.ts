import assert from "node:assert/strict";
import { request } from "node:http";
import { spawn } from "node:child_process";
import { z } from "zod";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startRelay } from "./codex-relay.ts";
import { startCodexGateway, codexRequest } from "./codex-gateway.ts";
import { codexArguments, containerArguments } from "./codex-runner.ts";

// Protocol/isolation smoke with deterministic local Responses data, never paid inference.
const local = process.argv.includes("--local");
const directory = await mkdtemp(join(process.env.RUNNER_TEMP ?? tmpdir(), "codex-smoke-"));
const evidence = join(directory, "evidence");
const input = join(directory, "input");
const output = join(directory, "output");
for (const path of [evidence, input, output, join(directory, "home")]) await mkdir(path);
await mkdir(join(output, "sources"));
await mkdir(join(evidence, "independent-sources"));
let calls = 0;
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
    reserved_microusd: 8_000_000,
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
      : 'test -z "${CATALOG_REPAIR_OPENAI_API_KEY:-}${GH_TOKEN:-}${GITHUB_TOKEN:-}" && test ! -w /workspace/.git/config && test ! -w /trusted/package.json && test ! -w /tmp/gh-aw/agent/independent-sources && test ! -e /var/run/docker.sock && test "$(ls /sys/class/net)" = lo && printf catalog-tool-%s ok';
    const request = z
      .object({ input: z.array(z.object({ type: z.string(), output: z.unknown().optional() })) })
      .parse(JSON.parse(options.body));
    if (
      calls > 1 &&
      !request.input.some(
        (item) =>
          item.type === "custom_tool_call_output" &&
          JSON.stringify(item.output)?.includes("catalog-tool-ok"),
      )
    )
      throw new Error("Missing real tool round-trip output");
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
            content: [{ type: "output_text", text: "catalog-protocol-ok", annotations: [] }],
          };
    const response = {
      id: "resp_smoke",
      object: "response",
      created_at: 1,
      status: "completed",
      model: "gpt-6.1-sol",
      output: [item],
      usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
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
              delta: "catalog-protocol-ok",
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
gateway.startPhase(2_500_000);
const relay = local ? startRelay(join(directory, "api.sock"), 0) : undefined;
try {
  if (relay && !relay.listening)
    await new Promise<void>((resolve) => relay.once("listening", resolve));
  const address = relay?.address();
  const args = local
    ? codexArguments().map((arg) =>
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
    calls !== 2 ||
    gateway.charged() !== 800
  )
    throw new Error("Codex protocol smoke did not complete with exact mocked usage");
  // Exercise ambiguous transport failure and contention against the same real Unix gateway.
  const requestInput = { model: "gpt-6.1-sol", input: [] };
  const post = () =>
    new Promise<number>((resolve, reject) => {
      const req = request(
        { socketPath: join(directory, "api.sock"), path: "/v1/responses", method: "POST" },
        (res) => {
          res.resume();
          res.on("end", () => resolve(res.statusCode ?? 0));
        },
      );
      req.on("error", reject);
      req.end(JSON.stringify(requestInput));
    });
  failNext = true;
  gateway.startPhase(1_000_000);
  const pending = post();
  await started;
  const reserved = 800 + codexRequest(requestInput).reservation;
  const journal = z
    .object({ charged_microusd: z.number() })
    .parse(JSON.parse(await readFile(join(output, "review-usage.json"), "utf8")));
  assert.equal(journal.charged_microusd, reserved);
  assert.equal(await post(), 429);
  failNetwork(new Error("Ambiguous transport failure"));
  assert.equal(await pending, 400);
  assert.equal(gateway.charged(), reserved);
  gateway.startPhase(0);
  assert.equal(await post(), 400);
  assert.equal(calls, 3);
  console.log(
    "Codex tool protocol, private accounting and failure-budget smoke passed without paid inference.",
  );
} finally {
  relay?.closeAllConnections();
  relay?.close();
  await gateway.close();
  await rm(directory, { recursive: true, force: true });
}
