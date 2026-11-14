import { createScanner, parseTree, type Node as JsonNode, type ParseError } from "jsonc-parser";
import { deepseekApiDocument, type DeepseekFieldPath } from "./deepseek-api-document.ts";
import { uniquePricingInputFacts } from "./pricing-input.ts";
import type { SourcePricingInputFact } from "./pricing-source.ts";
import { contractExtensionEvidence, type SourceContractEvidence } from "./source-contract.ts";

interface Document {
  url: string;
  body: string;
}
interface Contract {
  key: string;
  document: string;
  field: DeepseekFieldPath;
  channel: SourcePricingInputFact["channel"];
  locator: SourcePricingInputFact["locator"];
  availability: SourcePricingInputFact["availability"];
}
const chatPath = "/api/create-chat-completion";
const responsesPath = "/api/create-response";
const fimPath = "/api/create-completion";
const messagesPath = "/api/create-message";
const operations = new Map([
  [chatPath, "/chat/completions"],
  [responsesPath, "/responses"],
  [fimPath, "/completions"],
  [messagesPath, "/anthropic/v1/messages"],
  ["/api/ocr", "/v1/tools/ocr"],
]);
const contracts = [
  ...usage("chat", chatPath, "prompt_cache_hit_tokens", "cached_input_tokens"),
  ...usage("chat", chatPath, "prompt_cache_miss_tokens", "uncached_input_tokens"),
  ...usage("chat", chatPath, "completion_tokens", "output_tokens"),
  ...usage("fim", fimPath, "prompt_cache_hit_tokens", "cached_input_tokens"),
  ...usage("fim", fimPath, "prompt_cache_miss_tokens", "uncached_input_tokens"),
  ...usage("fim", fimPath, "completion_tokens", "output_tokens"),
  ...usage("responses", responsesPath, "input_tokens", "input_tokens"),
  ...usage("responses", responsesPath, "input_tokens_details.cached_tokens", "cached_input_tokens"),
  ...usage("responses", responsesPath, "output_tokens", "output_tokens"),
];
export function extractDeepseekPricingInputs(
  documents: readonly Document[],
  sourceRef: string,
  onFinding?: (evidence: SourceContractEvidence) => void,
): SourcePricingInputFact[] {
  const bodies = new Map<string, string | null>();
  for (const { url, body } of documents) {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.hostname !== "api-docs.deepseek.com") continue;
    const path = parsed.pathname.replace(/\/$/, "");
    if (operations.has(path)) bodies.set(path, bodies.has(path) ? null : body);
  }
  const readers = new Map<
    string,
    { api: ReturnType<typeof deepseekApiDocument>; stream: boolean }
  >();
  for (const [path, operation] of operations) {
    const body = bodies.get(path);
    if (body == null) continue;
    try {
      const api = deepseekApiDocument(body, operation);
      const streamText = api.text("request", [["stream", "boolean"]]);
      const stream =
        streamText !== undefined &&
        (path === messagesPath
          ? streamText.includes("ending with message_stop") && messageEnvelope(api.responseSamples)
          : path === responsesPath
            ? ["response.completed", "response.incomplete", "response.failed"].every((type) =>
                streamText.includes(type),
              ) && responseEnvelope(api.responseSamples)
            : completionStream(api));
      readers.set(path, { api, stream });
    } catch {
      // A different or ambiguous operation cannot own these usage paths.
    }
  }
  const currentContracts = [
    ...contracts,
    ...(bodies.has(messagesPath)
      ? [
          ...usage("messages", messagesPath, "input_tokens", "uncached_input_tokens"),
          ...usage("messages", messagesPath, "cache_read_input_tokens", "cached_input_tokens"),
          ...usage("messages", messagesPath, "output_tokens", "output_tokens"),
        ]
      : []),
    ...(documents.some(({ url }) => url === "https://api-docs.deepseek.com/guides/web_tools")
      ? (["chat", "responses", "messages"] as const).flatMap((protocol) =>
          ["tool_search", "tool_fetch", "tool_image_search"].flatMap((key) =>
            usage(
              protocol,
              protocol === "chat"
                ? chatPath
                : protocol === "responses"
                  ? responsesPath
                  : messagesPath,
              `server_tool_use.${key}`,
              key,
            ),
          ),
        )
      : []),
    ...(bodies.has("/api/ocr")
      ? [
          {
            key: "ocr.processed_pages",
            document: "/api/ocr",
            field: [["page_count", "integer"]],
            channel: "response",
            locator: { kind: "json_pointer", value: "/page_count" },
            availability: "success_only",
          } satisfies Contract,
        ]
      : []),
  ];
  return uniquePricingInputFacts(
    currentContracts.flatMap((item): SourcePricingInputFact[] => {
      const reader = readers.get(item.document);
      const streaming = item.channel === "stream_event";
      const media =
        streaming && item.document === fimPath ? "text/event-stream" : "application/json";
      if (
        reader === undefined ||
        !reader.api.has("response", item.field, media) ||
        (streaming && !reader.stream)
      ) {
        onFinding?.(contractExtensionEvidence(["/documents" + item.document + "/" + item.key]));
        return [];
      }
      if (
        item.key.startsWith("messages.") &&
        item.key.endsWith("uncached_input_tokens") &&
        !reader.api
          .text("response", item.field)
          ?.includes("Input tokens not served from the context cache")
      ) {
        onFinding?.(contractExtensionEvidence(["/documents" + item.document + "/" + item.key]));
        return [];
      }
      const parentText =
        item.field[1]?.[0] === "server_tool_use"
          ? (reader.api.text("response", item.field.slice(0, -1)) ?? "")
          : "";
      const omittedZero =
        parentText.includes("omitted when all counts are zero") ||
        (parentText.includes("otherwise omitted") &&
          parentText.includes("All fields are present when this object is returned"));
      return [
        {
          key: item.key,
          channel: item.channel,
          locator: item.locator,
          availability: item.availability,
          ...(omittedZero ? { absent_value: "zero" } : {}),
          source_ref: sourceRef,
        },
      ];
    }),
  );
}
function usage(
  protocol: "chat" | "fim" | "responses" | "messages",
  document: string,
  field: string,
  key: string,
): Contract[] {
  const names = ["usage", ...field.split(".")];
  const steps: DeepseekFieldPath = names.map((name, index) => [
    name,
    index === names.length - 1 ? "integer" : "object",
  ]);
  return (["response", "stream_event"] as const).map((channel) => ({
    key: protocol + (channel === "stream_event" ? ".stream." : ".") + key,
    document,
    field: steps,
    channel,
    locator: {
      kind: "json_pointer",
      value:
        "/" +
        (protocol === "responses" && channel === "stream_event" ? "response/" : "") +
        names.join("/"),
    },
    availability: channel === "stream_event" ? "terminal_only" : "success_only",
  }));
}
function completionStream(api: ReturnType<typeof deepseekApiDocument>): boolean {
  const text = api.text("request", [
    ["stream_options", "object"],
    ["include_usage", "boolean"],
  ]);
  return (
    text !== undefined &&
    /last (?:content )?chunk before the [`\s]*data:\s*\[DONE\]/i.test(text) &&
    /token\s+usage\s+statistics\s+for\s+the\s+entire\s+request/i.test(text)
  );
}
function jsonProperty(node: JsonNode | undefined, name: string): JsonNode | undefined {
  if (node?.type !== "object") return;
  const matches =
    node.children?.filter((child) => {
      const key: unknown = child.children?.[0]?.value;
      return child.type === "property" && key === name;
    }) ?? [];
  return matches.length === 1 ? matches[0]?.children?.[1] : undefined;
}
function sampleObject(text: string): JsonNode | undefined {
  const scanner = createScanner(text, false);
  const tokens: string[] = [];
  let depth = 0;
  for (scanner.scan(); scanner.getTokenLength() > 0; scanner.scan()) {
    const raw = text.slice(
      scanner.getTokenOffset(),
      scanner.getTokenOffset() + scanner.getTokenLength(),
    );
    if (raw.trim() === "") continue;
    if (tokens.length === 0 && raw !== "{") return;
    tokens.push(raw);
    if (raw === "{" || raw === "[") depth += 1;
    if (raw === "}" || raw === "]") depth -= 1;
    if (depth === 0) break;
  }
  if (depth !== 0 || tokens.length === 0) return;
  const parts: string[] = [];
  for (const [index, token] of tokens.entries()) {
    if (token === "...") {
      const previous = tokens[index - 1];
      if ((previous !== "{" && previous !== ",") || tokens[index + 1] !== "}") return;
      continue;
    }
    parts.push(token);
  }
  const errors: ParseError[] = [];
  const root = parseTree(parts.join(" "), errors, {
    allowTrailingComma: true,
    disallowComments: true,
  });
  return errors.length === 0 ? root : undefined;
}
function responseEnvelope(samples: readonly string[]): boolean {
  for (const sample of samples) {
    // The renderer can join SSE lines; the event, type and owned JSON path must still agree.
    for (const match of sample.matchAll(
      /event:\s*(response\.(?:completed|incomplete|failed))\s*data:\s*/g,
    )) {
      const root = sampleObject(sample.slice(match.index + match[0].length));
      const type: unknown = jsonProperty(root, "type")?.value;
      const response = jsonProperty(root, "response");
      const object: unknown = jsonProperty(response, "object")?.value;
      if (
        type === match[1] &&
        object === "response" &&
        jsonProperty(response, "usage")?.type === "object"
      )
        return true;
    }
  }
  return false;
}

function messageEnvelope(samples: readonly string[]): boolean {
  return samples.some((sample) =>
    [...sample.matchAll(/event:\s*message_delta\s*data:\s*/g)].some((match) => {
      const root = sampleObject(sample.slice(match.index + match[0].length));
      return (
        jsonProperty(root, "type")?.value === "message_delta" &&
        jsonProperty(root, "usage")?.type === "object"
      );
    }),
  );
}
