import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import { fetchSource } from "../../src/catalog/fetch.ts";
import { researchPublicSource, reviewedPublicSource } from "../../src/catalog/public-evidence.ts";
import { manifests } from "../../src/catalog/manifests.ts";
import { digest, type BudgetLease } from "./state.ts";
import { catalogRepairModel, requestReservation } from "./openai.ts";
import { streamSettlement } from "./codex-usage.ts";
import { writePrivateJson } from "./files.ts";

export async function boundedBody(stream: AsyncIterable<unknown>, limit: number): Promise<string> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const value of stream) {
    if (!(value instanceof Uint8Array) && typeof value !== "string")
      throw new Error("Invalid HTTP chunk");
    const chunk = Buffer.from(value);
    size += chunk.length;
    if (size > limit) throw new Error("Gateway HTTP body exceeds its limit");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function codexRequest(
  input: unknown,
  finish = false,
): { body: string; reservation: number } {
  const request = z
    .object({
      model: z.literal(catalogRepairModel),
      input: z.array(z.unknown()),
      instructions: z.string().optional(),
      tools: z.array(z.unknown()).max(100).optional(),
      previous_response_id: z.never().optional(),
      conversation: z.never().optional(),
    })
    .passthrough()
    .parse(input);
  const localTools = (value: unknown, depth = 0): void => {
    if (depth > 8) throw new Error("Tool namespaces exceed their bound");
    for (const item of z.array(z.unknown()).max(100).parse(value)) {
      const tool = z
        .object({
          type: z.enum(["function", "custom", "namespace"]),
          tools: z.unknown().optional(),
        })
        .parse(item);
      if (tool.type === "namespace") localTools(tool.tools, depth + 1);
      else if (tool.tools !== undefined) throw new Error("Unexpected nested tools");
    }
  };
  if (request.tools) localTools(request.tools);
  // Newer Codex versions send incremental tool definitions as input items.
  for (const item of request.input) {
    const definition = z
      .object({ type: z.literal("additional_tools"), tools: z.unknown() })
      .safeParse(item);
    if (definition.success) localTools(definition.data.tools);
  }
  // No hosted tools, images, conversation handles, background calls, websocket or alternate endpoints.
  const body = JSON.stringify({
    ...request,
    ...(finish
      ? {
          tool_choice: "none",
          instructions:
            (request.instructions ?? "") +
            "\nTool use is closed. For a compaction request, summarize the completed checks, receipt paths and unresolved claims for the final turn. Otherwise return your assessment or requested JSON now using completed evidence. Identify every unresolved claim.",
        }
      : {}),
    model: catalogRepairModel,
    reasoning: { effort: "high" },
    stream: true,
    store: false,
    background: false,
    service_tier: "default",
    max_output_tokens: 4096,
  });
  if (Buffer.byteLength(body) > 160_000 || /"type"\s*:\s*"(?:input_image|input_file)"/.test(body))
    throw new Error("Narrow the Codex context to bounded text evidence");
  return {
    body,
    reservation: requestReservation(catalogRepairModel, false, Buffer.byteLength(body)),
  };
}

export function serialRoute(serve: (req: IncomingMessage, res: ServerResponse) => Promise<void>) {
  let running: Promise<void> | undefined;
  const waiting = new Set<() => void>();
  const submit = (req: IncomingMessage, res: ServerResponse) => {
    const start = () => {
      running = serve(req, res).finally(() => {
        running = undefined;
        waiting.values().next().value?.();
      });
    };
    if (!running) {
      start();
      return;
    }
    if (waiting.size >= 8) {
      res.writeHead(429).end("Gateway request queue is full");
      return;
    }
    const remove = () => {
      waiting.delete(next);
      clearTimeout(timer);
      res.off("close", remove);
    };
    const next = () => {
      remove();
      start();
    };
    const timer = setTimeout(() => {
      remove();
      res.writeHead(503).end("Gateway request timed out in queue");
    }, 180_000);
    waiting.add(next);
    res.once("close", remove);
  };
  return {
    submit,
    drain: async () => {
      while (running) await running;
    },
  };
}

export class InferenceAllowanceExhausted extends Error {}

export async function startCodexGateway(options: {
  key: string;
  lease: BudgetLease;
  charged: number;
  privateDirectory: string;
  socket: string;
  providers: Set<string>;
  fetcher?: typeof fetch;
}) {
  let charged = options.charged;
  type Receipt = {
    call: number;
    reserved_microusd: number;
    status: "reserved" | "settled" | "retained" | "over_bound";
    charged_microusd: number;
    settlement?: ReturnType<typeof streamSettlement>;
  };
  const requests: Receipt[] = [];
  let phaseLimit = charged;
  let fetches = 0;
  let poisoned = false;
  let denied: InferenceAllowanceExhausted | undefined;
  const save = async () => {
    try {
      await writePrivateJson(join(options.privateDirectory, "review-usage.json"), {
        lease_id: options.lease.id,
        opening_charged_microusd: options.charged,
        charged_microusd: charged,
        requests,
      });
    } catch (error) {
      poisoned = true;
      throw error;
    }
  };
  await save();
  const handle = async (req: IncomingMessage): Promise<{ type: string; body: string }> => {
    const input: unknown = JSON.parse(await boundedBody(req, 170_000));
    if (req.url === "/source") {
      if (++fetches > 40) throw new Error("Independent source acquisition limit reached");
      const query = z.strictObject({ source: z.string(), url: z.string().optional() }).parse(input);
      const owner = manifests.find((manifest) =>
        manifest.sources.some((source) => source.id === query.source),
      );
      if (!owner || !(options.providers.has("catalog") || options.providers.has(owner.provider.id)))
        throw new Error("Source is outside immutable admission");
      const source = query.url
        ? researchPublicSource(query.source, query.url)
        : reviewedPublicSource(query.source);
      const result = await fetchSource(source);
      const receipt = JSON.stringify({
        source_id: source.id,
        scope: query.url ? "research" : "source",
        source_url: source.url,
        observed_at: new Date().toISOString(),
        source_hash: digest(result.body),
        body: result.body,
      });
      const name = `${randomUUID()}.json`;
      // Only this trusted directory is written; the model sees a read-only bind mount.
      await mkdir(join(options.privateDirectory, "sources"), { recursive: true });
      await writeFile(join(options.privateDirectory, "sources", name), receipt, { flag: "wx" });
      return {
        type: "application/json",
        body: JSON.stringify({
          path: `/tmp/gh-aw/agent/independent-sources/${name}`,
          sha256: digest(receipt),
        }),
      };
    }
    if (poisoned) throw new Error("Stopped inference route");
    if (options.lease.month !== new Date().toISOString().slice(0, 7))
      throw new InferenceAllowanceExhausted("OpenAI lease expired");
    let request = codexRequest(input);
    // Codex can spend the next Responses call compacting context after a tool result.
    // Stop requesting tools with room for both compaction and the actual final answer.
    if (phaseLimit - charged < request.reservation * 1.5 + 250_000)
      request = codexRequest(input, true);
    if (charged + request.reservation > Math.min(phaseLimit, options.lease.reserved_microusd))
      throw new InferenceAllowanceExhausted("OpenAI phase budget exhausted");
    const receipt: Receipt = {
      call: requests.length + 1,
      reserved_microusd: request.reservation,
      status: "reserved",
      charged_microusd: request.reservation,
    };
    requests.push(receipt);
    charged += request.reservation;
    await save();
    try {
      const response = await (options.fetcher ?? fetch)("https://api.openai.com/v1/responses", {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(180_000),
        headers: { Authorization: `Bearer ${options.key}`, "Content-Type": "application/json" },
        body: request.body,
      });
      if (!response.ok || !response.body) throw new Error(`OpenAI failed (${response.status})`);
      const text = await boundedBody(response.body, 8 * 1024 * 1024);
      const settlement = streamSettlement(text);
      receipt.settlement = settlement;
      if (settlement.charged_microusd > request.reservation) {
        // An invalid price/token bound disables every remaining call and retains the full lease.
        poisoned = true;
        receipt.status = "over_bound";
        receipt.charged_microusd += options.lease.reserved_microusd - charged;
        charged = options.lease.reserved_microusd;
        throw new Error("OpenAI usage exceeded its reserved bound");
      }
      receipt.status = "settled";
      receipt.charged_microusd = settlement.charged_microusd;
      charged -= request.reservation - settlement.charged_microusd;
      await save();
      return { type: "text/event-stream", body: text };
    } catch (error) {
      if (receipt.status === "reserved") receipt.status = "retained";
      await save();
      throw error;
    }
  };
  const serve = async (req: IncomingMessage, res: ServerResponse) => {
    if (req.url === "/v1/responses") denied = undefined;
    try {
      const { type, body } = await handle(req);
      res.writeHead(200, { "Content-Type": type }).end(body);
    } catch (error) {
      if (error instanceof InferenceAllowanceExhausted) denied = error;
      res.writeHead(400, { "Content-Type": "application/json" }).end(
        JSON.stringify({
          error: {
            message: error instanceof Error ? error.message : "Gateway failed",
            type: "invalid_request_error",
          },
        }),
      );
    }
  };
  const source = serialRoute(serve);
  const inference = serialRoute(serve);
  const server = createServer((req, res) => {
    if (req.method === "POST" && req.url === "/source") source.submit(req, res);
    else if (req.method === "POST" && req.url === "/v1/responses") inference.submit(req, res);
    else res.writeHead(400).end("Unsupported gateway request");
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.socket, resolve);
  });
  await chmod(options.socket, 0o600);
  return {
    startPhase: (allowance = options.lease.reserved_microusd - charged) => {
      denied = undefined;
      phaseLimit = Math.min(options.lease.reserved_microusd, charged + allowance);
    },
    charged: () => charged,
    lastDenial: () => denied,
    remaining: () => phaseLimit - charged,
    close: async () => {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      // A disconnected client can leave an active acquisition or settlement on the host.
      await Promise.all([source.drain(), inference.drain()]);
    },
  };
}
