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
const operations = new Map([
  [chatPath, "/chat/completions"],
  [responsesPath, "/responses"],
  [fimPath, "/completions"],
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
  const grouped = new Map<string, string[]>();
  for (const { url, body } of documents) {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.hostname !== "api-docs.deepseek.com") continue;
    const path = parsed.pathname.replace(/\/$/, "");
    grouped.set(path, [...(grouped.get(path) ?? []), body]);
  }
  const readers = new Map<
    string,
    { api: ReturnType<typeof deepseekApiDocument>; stream: boolean }
  >();
  for (const [path, operation] of operations) {
    const bodies = grouped.get(path);
    if (bodies?.length !== 1 || bodies[0] === undefined) continue;
    try {
      const api = deepseekApiDocument(bodies[0], operation);
      const streamText = api.text("request", [["stream", "boolean"]]);
      const stream =
        streamText !== undefined &&
        (path === responsesPath
          ? ["response.completed", "response.incomplete", "response.failed"].every((type) =>
              streamText.includes(type),
            ) && responseEnvelope(api.responseSamples)
          : completionStream(api));
      readers.set(path, { api, stream });
    } catch {
      // A different or ambiguous operation cannot own these usage paths.
    }
  }
  return uniquePricingInputFacts(
    contracts.flatMap((item): SourcePricingInputFact[] => {
      const reader = readers.get(item.document);
      if (
        reader === undefined ||
        !reader.api.has("response", item.field) ||
        (item.channel === "stream_event" && !reader.stream)
      ) {
        onFinding?.(contractExtensionEvidence(["/documents" + item.document + "/" + item.key]));
        return [];
      }
      return [
        {
          key: item.key,
          channel: item.channel,
          locator: item.locator,
          availability: item.availability,
          source_ref: sourceRef,
        },
      ];
    }),
  );
}
function usage(
  protocol: "chat" | "fim" | "responses",
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
