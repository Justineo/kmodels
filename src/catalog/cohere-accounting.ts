import { finalizePricingInputs } from "./pricing-input.ts";
import { markdownProse as prose, markdownSection as section } from "./markdown.ts";
import type { PricingReconciliationItem } from "./pricing-reconciliation.ts";
import type { SourcePricingInputFact } from "./pricing-source.ts";
import { contractExtensionEvidence, type SourceContractEvidence } from "./source-contract.ts";

interface Contract {
  document: string;
  endpoint: string;
  key: string;
  channel: SourcePricingInputFact["channel"];
  locator: string;
  terminal?: { field: string; value: string };
}

type Document = { url: string; body: string };

const contracts: readonly Contract[] = [
  {
    document: "/v2/reference/parse.md",
    endpoint: "/v2/parse",
    key: "parse.v2.pages",
    channel: "response",
    locator: "/meta/billed_units/pages",
  },
  ...billedToken("/reference/chat.md", "/v2/chat", "chat.v2", "response", "/usage/billed_units"),
  ...billedToken(
    "/reference/chat-stream.md",
    "/v2/chat",
    "chat.v2",
    "stream_event",
    "/delta/usage/billed_units",
    { field: "type", value: "message-end" },
  ),
  ...billedToken("/reference/chat-v1.md", "/v1/chat", "chat.v1", "response", "/meta/billed_units"),
  ...billedToken(
    "/reference/chat-stream-v1.md",
    "/v1/chat",
    "chat.v1",
    "stream_event",
    "/response/meta/billed_units",
    { field: "event_type", value: "stream-end" },
  ),
  {
    document: "/reference/embed.md",
    endpoint: "/v2/embed",
    key: "embed.v2.input_tokens",
    channel: "response",
    locator: "/meta/billed_units/input_tokens",
  },
  {
    document: "/reference/embed.md",
    endpoint: "/v2/embed",
    key: "embed.v2.image_tokens",
    channel: "response",
    locator: "/meta/billed_units/image_tokens",
  },
  {
    document: "/reference/rerank.md",
    endpoint: "/v2/rerank",
    key: "rerank.v2.search_units",
    channel: "response",
    locator: "/meta/billed_units/search_units",
  },
];

export function extractCoherePricingInputs(
  documents: readonly Document[],
  sourceRef: string,
  onFinding?: (evidence: SourceContractEvidence) => void,
  onReconciliation?: (item: PricingReconciliationItem) => void,
): SourcePricingInputFact[] {
  const bodies = documentsByPath(documents);
  const facts = contracts.flatMap((contract) => {
    const body = bodies.get(contract.document);
    if (body !== undefined && responseCounter(body, contract))
      return [
        {
          key: contract.key,
          channel: contract.channel,
          locator: { kind: "json_pointer" as const, value: contract.locator },
          availability: "terminal_only" as const,
          source_ref: sourceRef,
        },
      ];
    onFinding?.(contractExtensionEvidence([`/documents${contract.document}${contract.locator}`]));
    return [];
  });
  return finalizePricingInputs(facts, contracts.length, "Cohere pricing inputs", onReconciliation);
}

function documentsByPath(documents: readonly Document[]): ReadonlyMap<string, string> {
  const result = new Map<string, string>();
  for (const document of documents) {
    const url = new URL(document.url);
    if (
      url.origin !== "https://docs.cohere.com" ||
      url.username !== "" ||
      url.password !== "" ||
      url.search !== "" ||
      url.hash !== ""
    )
      continue;
    const path = url.pathname;
    if (result.has(path)) throw new Error(`Cohere accounting duplicated ${path}`);
    result.set(path, document.body);
  }
  return result;
}

function billedToken(
  document: string,
  endpoint: string,
  prefix: string,
  channel: SourcePricingInputFact["channel"],
  pointer: string,
  terminal?: Contract["terminal"],
): Contract[] {
  return (["input", "output"] as const).map((direction) => ({
    document,
    endpoint,
    key: `${prefix}.${direction}_tokens`,
    channel,
    locator: `${pointer}/${direction}_tokens`,
    ...(terminal === undefined ? {} : { terminal }),
  }));
}

function responseCounter(body: string, contract: Contract): boolean {
  const operations = [
    ...prose(body).matchAll(/^(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) \S+[ \t]*\r?$/gm),
  ];
  if (
    operations.length !== 1 ||
    operations[0]?.[0].trim() !== `POST https://api.cohere.com${contract.endpoint}`
  )
    return false;
  const response = section(body, 2, "Response");
  if (response === undefined) return false;
  const success =
    section(response, 3, "200") ?? (/^### /m.test(prose(response)) ? undefined : response);
  if (success === undefined) return false;
  const path = contract.locator.split("/").slice(1);
  return (
    schemaCounter(success, section(body, 2, "Types"), path, contract.terminal) ||
    exampleCounter(success, path, contract.terminal)
  );
}

interface MarkdownField {
  name?: string;
  type?: string;
  literal?: string;
  children: MarkdownField[];
}

function fields(body: string): MarkdownField[] {
  const roots: MarkdownField[] = [];
  const parents: Array<{ indent: number; field: MarkdownField }> = [];
  for (const line of prose(body).split(/\r?\n/)) {
    if (/^#+ /u.test(line)) break;
    const bullet = line.match(/^( *)- (.+)$/u);
    if (bullet?.[1] === undefined || bullet[2] === undefined) continue;
    const indent = bullet[1].length;
    while ((parents.at(-1)?.indent ?? -1) >= indent) parents.pop();
    const parent = parents.at(-1);
    if (parent === undefined && indent !== 0) continue;
    const field: MarkdownField = { children: [] };
    // Unreviewed indentation still owns descendants; it cannot promote a nested counter.
    const owned = parent === undefined || indent === parent.indent + 2;
    const property = owned ? bullet[2].match(/^`([a-z_]+)` \(([^)]+)\)/u) : undefined;
    const variant = owned ? bullet[2].match(/^`([a-z_]+)`: `([^`]+)` \(/u) : undefined;
    if (property?.[1] !== undefined && property[2] !== undefined) {
      field.name = property[1];
      field.type = property[2];
    } else if (variant?.[1] !== undefined && variant[2] !== undefined) {
      field.name = variant[1];
      field.literal = variant[2];
    }
    (parent?.field.children ?? roots).push(field);
    parents.push({ indent, field });
  }
  return roots;
}

function schemaCounter(
  response: string,
  types: string | undefined,
  path: string[],
  terminal: Contract["terminal"],
): boolean {
  let current = fields(response);
  if (terminal !== undefined) {
    const variants = current.filter(
      ({ name, literal }) => name === terminal.field && literal === terminal.value,
    );
    if (variants.length !== 1) return false;
    current = variants[0]?.children ?? [];
  }
  const visited = new Set<string>();
  for (const [index, name] of path.entries()) {
    const matches = current.filter((field) => field.name === name);
    const field = matches[0];
    if (matches.length !== 1 || field === undefined || field.type === undefined) return false;
    if (index === path.length - 1) return /^(?:double|integer|long)(?:,|$)/u.test(field.type);
    if (/^object(?:,|$)/u.test(field.type)) current = field.children;
    else {
      const typeName = field.type.match(/^([A-Z][A-Za-z0-9_]*)(?:,|$)/u)?.[1];
      if (typeName === undefined || types === undefined || visited.has(typeName)) return false;
      visited.add(typeName);
      const definition = section(types, 3, typeName);
      if (definition === undefined) return false;
      current = fields(definition);
    }
  }
  return false;
}

function exampleCounter(response: string, path: string[], terminal: Contract["terminal"]): boolean {
  if (/^#+ /m.test(prose(response))) return false;
  const values: unknown[] = [];
  for (const match of response.matchAll(/^```(json|text)[^\r\n]*\r?\n([^]*?)^```[ \t]*\r?$/gm)) {
    if (match[1] === "text" && terminal === undefined) continue;
    for (const frame of (match[2] ?? "").split(/\r?\n\r?\n(?=event:)/u)) {
      const event = frame.match(/^event: ([^\r\n]+?)[ \t]*\r?$/m)?.[1];
      if (event !== undefined && event !== terminal?.value) continue;
      try {
        const payload: unknown = JSON.parse(
          frame.replace(/^event: [^\r\n]*\r?\n/gm, "").replace(/^data: ?/gm, ""),
        );
        if (terminal !== undefined && atPath(payload, [terminal.field]) !== terminal.value)
          continue;
        const value = atPath(payload, path);
        if (value !== undefined) values.push(value);
      } catch {
        // An incomplete or malformed response example proves no counter path.
      }
    }
  }
  return (
    values.length > 0 &&
    values.every((value) => typeof value === "number" && Number.isFinite(value) && value >= 0)
  );
}

function atPath(value: unknown, path: string[]): unknown {
  for (const name of path) {
    if (!record(value) || !Object.hasOwn(value, name)) return;
    value = value[name];
  }
  return value;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
