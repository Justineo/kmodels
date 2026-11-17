import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { afterEach, expect, it, vi } from "vite-plus/test";
import {
  adoptionReady,
  candidateKey,
  chooseProvider,
  difficulty,
  digest,
  emptyState,
  observeCandidates,
  recordOutcome,
  reserveBudget,
  extendBudget,
  verificationAllowance,
  boundedIncidentBatch,
  reserveLimit,
  settleBudget,
} from "../scripts/repair/state.ts";
import { askOpenAI, assistanceModel, assistanceRequest } from "../scripts/repair/openai.ts";
import { recordDiscovery } from "../scripts/repair/discovery.ts";
import { readSharedFile } from "../scripts/repair/files.ts";
import { boundedEvidence } from "../scripts/repair/broker.ts";
import { captureRepairSource } from "../src/catalog/catalog-repair-capture.ts";
import { researchPublicSource, reviewedPublicSource } from "../src/catalog/public-evidence.ts";
import type { CatalogRepairCandidate } from "../src/catalog/catalog-repair.ts";

const directories: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function directory() {
  const path = await realpath(await mkdtemp(join(tmpdir(), "maintenance-")));
  directories.push(path);
  return path;
}
const now = new Date("2026-11-17T00:00:00Z");
function candidate(
  provider = "openai",
  trigger: CatalogRepairCandidate["trigger"] = "pricing_validation",
): CatalogRepairCandidate {
  return {
    provider_id: provider,
    subject_id: "pricing",
    scope: "provider",
    trigger,
    message: "A consumed fact failed",
    diagnostics: [],
  };
}
function taskState() {
  const state = emptyState();
  const item = candidate();
  observeCandidates(state, [item], new Map([[candidateKey(item), digest("source-v1")]]), now);
  const task = state.tasks[0];
  if (!task) throw new Error("Missing fixture task");
  return { state, task, item };
}

it("reserves across runs, retains unknown spend and only refunds trusted settlements", () => {
  const state = emptyState();
  for (let i = 1; i <= 120; i++) reserveBudget(state, `${i}-1`, now, true);
  expect(state.leases.reduce((sum, lease) => sum + lease.reserved_microusd, 0)).toBe(reserveLimit);
  expect(reserveBudget(state, "1-1", now, true)).toBe(state.leases[0]);
  expect(state.leases).toHaveLength(120);
  settleBudget(state, "1-1", 1234);
  expect(reserveBudget(state, "121-1", now, true).reserved_microusd).toBe(1_000_000 - 1234);
  expect(() => settleBudget(state, "1-1", 0)).toThrow("Conflicting");
  expect(() => settleBudget(state, "2-1", 1_000_001)).toThrow("Invalid");
  expect(() => settleBudget(state, "2-1", -1)).toThrow("Invalid");
  expect(
    reserveBudget(state, "122-1", new Date("2026-12-01T00:00:00Z"), true).reserved_microusd,
  ).toBe(1_000_000);
  expect(reserveBudget(state, "123-1", now, false).reserved_microusd).toBe(0);
});

it("extends only active same-month leases and preserves the total monthly ceiling", () => {
  const state = emptyState();
  const lease = reserveBudget(state, "1-1", now, false);
  expect(lease.reserved_microusd).toBe(0);
  expect(verificationAllowance("routine")).toBe(1_000_000);
  expect(verificationAllowance("semantic")).toBe(1_000_000);
  expect(verificationAllowance("complex")).toBe(2_000_000);
  extendBudget(state, lease.id, verificationAllowance("complex"), now);
  expect(lease.reserved_microusd).toBe(2_000_000);
  extendBudget(state, lease.id, 4_000_000, now);
  extendBudget(state, lease.id, 4_000_000, now);
  expect(lease.reserved_microusd).toBe(4_000_000);
  expect(() => extendBudget(state, lease.id, 8_000_000, now)).toThrow();
  expect(() => extendBudget(state, lease.id, 4_000_000, new Date("2026-12-01"))).toThrow();
  settleBudget(state, lease.id, 750_000);
  expect(() => extendBudget(state, lease.id, 4_000_000, now)).toThrow();
  for (let i = 2; i < 120; i++) reserveBudget(state, `${i}-1`, now, true);
  expect(extendBudget(state, "119-1", 4_000_000, now).reserved_microusd).toBe(0);
});

it("bounds incident batches while retaining deferred work and respecting task cooldown", () => {
  const { state, task } = taskState();
  recordOutcome(task, { status: "not_a_defect", reason: "Verified" }, now);
  const items = [
    candidate(),
    ...["a", "b", "c"].map((subject_id) => ({ ...candidate(), subject_id })),
  ];
  const batch = boundedIncidentBatch(items, state, now);
  expect(batch.selected.map((item) => item.subject_id)).toEqual(["a", "b"]);
  expect(batch.deferred.map((item) => item.subject_id)).toEqual(["pricing", "c"]);
});

it("reopens changed evidence and protects aged tasks from severity starvation", () => {
  const { state, task, item } = taskState();
  recordOutcome(task, { status: "not_a_defect", reason: "Checked the contract" }, now);
  expect(chooseProvider(state, [item], now)).toBeUndefined();
  task.coverage = [{ area: "pricing", status: "complete", reason: "Prior proof" }];
  observeCandidates(state, [item], new Map([[task.id, digest("source-v2")]]), now);
  expect(task.status).toBe("pending");
  expect(task.coverage).toEqual([]);
  expect(chooseProvider(state, [item], now)).toBe("openai");
  const older = candidate("vertex", "source_location_change");
  observeCandidates(
    state,
    [older],
    new Map([[candidateKey(older), digest("old")]]),
    new Date("2026-11-01T00:00:00Z"),
  );
  expect(chooseProvider(state, [item, older], now)).toBe("vertex");
  expect(chooseProvider(state, [candidate("new-provider"), older], now)).toBe("vertex");
  expect(chooseProvider(emptyState(), [candidate("new-provider")], now)).toBe("new-provider");
  expect(difficulty([task])).toBe("semantic");
  task.attempts = 2;
  expect(difficulty([task])).toBe("complex");
});

it("requires publication, fresh accepted versions and consumer proof before adoption", () => {
  const { task } = taskState();
  recordOutcome(task, { status: "repaired", reason: "Agent proposal" }, now);
  expect(task.status).toBe("pending");
  recordOutcome(
    task,
    { status: "repaired", reason: "Trusted publication", published_revision: "a".repeat(40) },
    now,
  );
  task.source_versions = { "openai-pricing": "v2" };
  const observation = {
    contains_revision: true,
    fresh: true,
    consumer_passed: true,
    accepted_sources: new Map([["openai-pricing", "v2"]]),
    candidate_ids: new Set<string>(),
  };
  expect(adoptionReady(task, observation)).toBe(true);
  for (const field of ["contains_revision", "fresh", "consumer_passed"] as const)
    expect(adoptionReady(task, { ...observation, [field]: false })).toBe(false);
  expect(adoptionReady(task, { ...observation, candidate_ids: new Set([task.id]) })).toBe(false);
  expect(
    adoptionReady(task, { ...observation, accepted_sources: new Map([["openai-pricing", "v1"]]) }),
  ).toBe(false);
  task.source_versions = {};
  expect(adoptionReady(task, observation)).toBe(false);
});

it("turns structural source changes into leads without declaring a defect or reacting to amounts", () => {
  const state = emptyState();
  const first = "<h2>Model prices</h2><table><th>Input tokens</th><td>$1</td></table>";
  recordDiscovery(state, "openai", "openai-pricing", first, now);
  recordDiscovery(state, "openai", "openai-pricing", first.replace("$1", "$2"), now);
  expect(state.tasks).toEqual([]);
  recordDiscovery(state, "openai", "openai-pricing", first + "<h3>Cached input prices</h3>", now);
  expect(state.tasks[0]).toMatchObject({ status: "pending", trigger: "source_contract_change" });
  expect(state.tasks[0]?.reason).toContain("not a proven defect");
});

function request(purpose: "research" | "repair" = "research") {
  return assistanceRequest.parse({
    id: "b8af4a72-99ad-4c5f-9d90-3d7c9d52c114",
    candidate_id: "openai/pricing",
    purpose,
    question: "Find authoritative pricing evidence",
  });
}
it("routes by difficulty and reserves before a bounded official-domain search", async () => {
  expect(assistanceModel("research", "routine")).toBe("gpt-6-luna");
  expect(assistanceModel("repair", "routine")).toBe("gpt-6.2-sol");
  expect(assistanceModel("research", "complex")).toBe("gpt-6.2-sol");
  const order: string[] = [];
  const reserve = vi.fn(async () => {
    order.push("reserve");
  });
  const settle = vi.fn(async () => {
    order.push("settle");
  });
  const fetcher: typeof fetch = async (url, options) => {
    order.push("http");
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(options?.redirect).toBe("error");
    if (typeof options?.body !== "string") throw new Error("Expected JSON request body");
    expect(JSON.parse(options.body)).toMatchObject({
      store: false,
      max_output_tokens: 4096,
      max_tool_calls: 1,
      tools: [{ type: "web_search", filters: { allowed_domains: ["developers.openai.com"] } }],
    });
    return Response.json({
      status: "completed",
      model: "gpt-6-luna",
      usage: { input_tokens: 1000, output_tokens: 20 },
      output: [
        {
          type: "message",
          content: [{ type: "output_text", text: "Inspect the original source" }],
        },
      ],
    });
  };
  const options = {
    key: "fake-test-key",
    request: request(),
    level: "routine" as const,
    domains: ["developers.openai.com"],
    evidence: "public",
    available: 2_000_000,
    reserve,
    settle,
    fetcher,
  };
  const result = await askOpenAI(options);
  expect(result.text).toContain("original source");
  expect(order).toEqual(["reserve", "http", "settle"]);
  order.length = 0;
  await expect(askOpenAI({ ...options, available: 0 })).rejects.toThrow("budget exhausted");
  expect(order).toEqual([]);
  await expect(askOpenAI({ ...options, domains: [] })).rejects.toThrow("reviewed public domains");
});

it("retains reservations on ambiguous HTTP failures without retrying or settling", async () => {
  const reserve = vi.fn(async () => {});
  const settle = vi.fn(async () => {});
  const fetcher = vi.fn<typeof fetch>(async () => new Response("unavailable", { status: 503 }));
  await expect(
    askOpenAI({
      key: "fake",
      request: request("repair"),
      level: "complex",
      domains: [],
      evidence: "",
      available: 3_000_000,
      reserve,
      settle,
      fetcher,
    }),
  ).rejects.toThrow("reservation retained");
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(reserve).toHaveBeenCalledTimes(1);
  expect(settle).not.toHaveBeenCalled();
});

it("bounds mailbox files and rejects symlinks, escapes and non-public expert evidence", async () => {
  const base = await directory();
  const root = join(base, "shared");
  await mkdir(root);
  const outside = join(base, "outside.json");
  await writeFile(outside, "private");
  await symlink(outside, join(root, "link.json"));
  await expect(readSharedFile(outside, root, 100)).rejects.toThrow("escaped");
  await expect(readSharedFile(join(root, "link.json"), root, 100)).rejects.toThrow();
  await expect(readSharedFile(root, root, 100)).rejects.toThrow();
  const path = join(root, "source.json");
  await writeFile(path, "x".repeat(101));
  await expect(readSharedFile(path, root, 100)).rejects.toThrow("bounded");
  await writeFile(
    path,
    JSON.stringify({
      source_id: "mistral-api",
      source_url: "https://api.mistral.ai/v1/models",
      body: "secret",
    }),
  );
  await expect(boundedEvidence(path, root)).rejects.toThrow("reviewed public source");
});

it("captures public bytes with identity but excludes authenticated source bodies", async () => {
  const root = await directory();
  vi.stubEnv("KMODELS_REPAIR_CAPTURE_DIRECTORY", root);
  const source = reviewedPublicSource("vertex-pricing");
  const body = "public source";
  await captureRepairSource(source, body, now.toISOString());
  await captureRepairSource(
    { ...source, id: "private-source", access: "authenticated" },
    "private",
    now.toISOString(),
  );
  const names = await readdir(root);
  expect(names).toHaveLength(1);
  const name = names[0];
  if (!name) throw new Error("Missing capture");
  expect(JSON.parse(gunzipSync(await readFile(join(root, name))).toString())).toMatchObject({
    body,
    source_hash: digest(body),
    source_id: source.id,
  });
});

it("fetches discovered first-party URLs without widening collection authority", () => {
  const source = researchPublicSource(
    "vertex-pricing",
    "https://docs.cloud.google.com/new-pricing",
  );
  expect(source.linkedDocuments).toBeUndefined();
  expect(source.transport).toBeUndefined();
  expect(source.maxResponseBytes).toBeLessThanOrEqual(4 * 1024 * 1024);
  for (const url of [
    "http://docs.cloud.google.com/page",
    "https://docs.cloud.google.com.evil.test/",
    "https://secret@docs.cloud.google.com/",
    "https://docs.cloud.google.com:444/page",
  ])
    expect(() => researchPublicSource("vertex-pricing", url)).toThrow();
  expect(() => researchPublicSource("mistral-api", "https://api.mistral.ai/new")).toThrow();
});
