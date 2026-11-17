import { createServer, type IncomingMessage } from "node:http";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import { fetchSource } from "../../src/catalog/fetch.ts";
import { researchPublicSource, reviewedPublicSource } from "../../src/catalog/public-evidence.ts";
import { manifests } from "../../src/catalog/manifests.ts";
import { digest, type BudgetLease } from "./state.ts";
import { catalogRepairModel, requestReservation, responseCost } from "./openai.ts";
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

export function codexRequest(input: unknown): { body: string; reservation: number } {
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
export function streamCharge(text: string): number {
  const events = text
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data: ") && line !== "data: [DONE]")
    .map((line): unknown => JSON.parse(line.slice(6)));
  const completed = events.flatMap((event) => {
    const result = z
      .object({
        type: z.literal("response.completed"),
        response: z.object({
          model: z.string(),
          usage: z.object({
            input_tokens: z.number().int().nonnegative(),
            output_tokens: z.number().int().nonnegative(),
          }),
        }),
      })
      .safeParse(event);
    return result.success ? [result.data.response] : [];
  });
  const response = completed[0];
  if (
    completed.length !== 1 ||
    !response ||
    (response.model !== catalogRepairModel && !response.model.startsWith(`${catalogRepairModel}-`))
  )
    throw new Error("Missing unique completed Codex usage; reservation retained");
  return responseCost(
    catalogRepairModel,
    response.usage.input_tokens,
    response.usage.output_tokens,
    false,
  );
}

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
  let reserved = 0;
  let phaseLimit = charged;
  let calls = 0;
  let fetches = 0;
  let busy = false;
  let poisoned = false;
  const save = () =>
    writePrivateJson(join(options.privateDirectory, "review-usage.json"), {
      lease_id: options.lease.id,
      charged_microusd: charged + reserved,
    });
  await save();
  const handle = async (req: IncomingMessage): Promise<{ type: string; body: string }> => {
    if (req.method !== "POST") throw new Error("Only bounded POST requests are supported");
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
    if (req.url !== "/v1/responses" || poisoned)
      throw new Error("Unsupported or stopped inference route");
    if (options.lease.month !== new Date().toISOString().slice(0, 7))
      throw new Error("OpenAI lease expired");
    if (++calls > 60) throw new Error("Codex request limit reached");
    const request = codexRequest(input);
    if (charged + request.reservation > Math.min(phaseLimit, options.lease.reserved_microusd))
      throw new Error("OpenAI phase budget exhausted");
    reserved = request.reservation;
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
      const cost = streamCharge(text);
      if (cost > reserved) {
        // An invalid price/token bound disables every remaining call and retains the full lease.
        poisoned = true;
        charged = options.lease.reserved_microusd;
        reserved = 0;
        await save();
        throw new Error("OpenAI usage exceeded its reserved bound");
      }
      charged += cost;
      reserved = 0;
      await save();
      return { type: "text/event-stream", body: text };
    } catch (error) {
      charged += reserved;
      reserved = 0;
      await save();
      throw error;
    }
  };
  const server = createServer((req, res) => {
    if (busy) {
      res.writeHead(429);
      res.end("Concurrent requests are not admitted");
      return;
    }
    busy = true;
    void handle(req)
      .then(({ type, body }) => {
        res.writeHead(200, { "Content-Type": type });
        res.end(body);
      })
      .catch((error: unknown) => {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: {
              message: error instanceof Error ? error.message : "Gateway failed",
              type: "invalid_request_error",
            },
          }),
        );
      })
      .finally(() => {
        busy = false;
      });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.socket, resolve);
  });
  await chmod(options.socket, 0o600);
  return {
    startPhase: (allowance: number) => {
      phaseLimit = Math.min(options.lease.reserved_microusd, charged + allowance);
    },
    charged: () => charged,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
