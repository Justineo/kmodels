import { finalizePricingInputs } from "./pricing-input.ts";
import type { PricingReconciliationItem } from "./pricing-reconciliation.ts";
import type { SourcePricingInputFact } from "./pricing-source.ts";
import { contractExtensionEvidence, type SourceContractEvidence } from "./source-contract.ts";

interface Contract {
  document: string;
  key: string;
  channel: SourcePricingInputFact["channel"];
  locator: string;
  markers: readonly RegExp[];
}

type Document = { url: string; body: string };

const contracts: readonly Contract[] = [
  {
    document: "/v2/reference/parse.md",
    key: "parse.v2.pages",
    channel: "response",
    locator: "/meta/billed_units/pages",
    markers: [/POST https:\/\/api\.cohere\.com\/v2\/parse/, billedField("pages")],
  },
  ...billedToken("/reference/chat.md", "chat.v2", "response", "/usage/billed_units"),
  ...billedToken(
    "/reference/chat-stream.md",
    "chat.v2",
    "stream_event",
    "/delta/usage/billed_units",
    /message-end/,
  ),
  ...billedToken("/reference/chat-v1.md", "chat.v1", "response", "/meta/billed_units"),
  ...billedToken(
    "/reference/chat-stream-v1.md",
    "chat.v1",
    "stream_event",
    "/response/meta/billed_units",
    /stream-end/,
  ),
  {
    document: "/reference/embed.md",
    key: "embed.v2.input_tokens",
    channel: "response",
    locator: "/meta/billed_units/input_tokens",
    markers: [billedField("input_tokens")],
  },
  {
    document: "/reference/embed.md",
    key: "embed.v2.image_tokens",
    channel: "response",
    locator: "/meta/billed_units/image_tokens",
    markers: [billedField("image_tokens")],
  },
  {
    document: "/reference/rerank.md",
    key: "rerank.v2.search_units",
    channel: "response",
    locator: "/meta/billed_units/search_units",
    markers: [billedField("search_units")],
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
    if (
      body !== undefined &&
      (contract.markers.every((marker) => marker.test(body)) ||
        (contract.document === "/reference/embed.md" &&
          /POST https:\/\/api\.cohere\.com\/v2\/embed\b/.test(body) &&
          embedResponseField(body, contract.locator)))
    )
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
    const path = new URL(document.url).pathname;
    if (result.has(path)) throw new Error(`Cohere accounting duplicated ${path}`);
    result.set(path, document.body);
  }
  return result;
}

function billedToken(
  document: string,
  prefix: string,
  channel: SourcePricingInputFact["channel"],
  pointer: string,
  marker?: RegExp,
): Contract[] {
  return (["input", "output"] as const).map((direction) => ({
    document,
    key: `${prefix}.${direction}_tokens`,
    channel,
    locator: `${pointer}/${direction}_tokens`,
    markers: [...(marker === undefined ? [] : [marker]), billedField(`${direction}_tokens`)],
  }));
}

function billedField(field: string): RegExp {
  return new RegExp(`\\bbilled_units\\b[^\\n{(]*[{(][^})]*\\b${field}\\b`);
}

/** The published response schema uses indentation and named types to distinguish billed fields. */
function embedResponseField(body: string, locator: string): boolean {
  const response = body.split(/^## Response[ \t]*\r?$/m)[1]?.split(/^## /m)[0];
  if (response === undefined) return false;
  const path = locator.split("/").filter((value) => value !== "");
  const parents: string[] = [];
  for (const line of response.split(/\r?\n/)) {
    const field = markdownField(line);
    if (field === undefined) continue;
    if (field.depth > parents.length) continue;
    parents.length = field.depth;
    parents.push(field.name);
    if (`/${parents.join("/")}` === locator && /^double(?:,|$)/.test(field.type)) return true;
  }
  if (path.length === 0) return false;

  let field = fieldAtDepth(response, path[0] ?? "", 0);
  for (let index = 1; field !== undefined && index < path.length; index += 1) {
    const typeName = field.type.match(/^([A-Z][A-Za-z0-9_]*)/)?.[1];
    if (typeName === undefined) return false;
    const section = namedTypeSection(body, typeName);
    if (section === undefined) return false;
    field = fieldAtDepth(section, path[index] ?? "", 0);
  }
  return field !== undefined && /^double(?:,|$)/.test(field.type);
}

interface MarkdownField {
  depth: number;
  name: string;
  type: string;
}

function markdownField(line: string): MarkdownField | undefined {
  const match = line.match(/^( *)- `([a-z_]+)` \(([^)]+)\)/);
  if (match?.[1] === undefined || match[2] === undefined || match[3] === undefined) return;
  const depth = match[1].length / 2;
  if (!Number.isInteger(depth)) return;
  return { depth, name: match[2], type: match[3] };
}

function fieldAtDepth(section: string, name: string, depth: number): MarkdownField | undefined {
  return section
    .split(/\r?\n/)
    .map(markdownField)
    .find((field) => {
      return field?.name === name && field.depth === depth;
    });
}

function namedTypeSection(body: string, typeName: string): string | undefined {
  const heading = new RegExp(`^### ${typeName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "m");
  const match = heading.exec(body);
  if (match === null) return;
  const start = match.index + match[0].length;
  const remaining = body.slice(start);
  const nextHeading = remaining.search(/^### /m);
  return remaining.slice(0, nextHeading < 0 ? remaining.length : nextHeading);
}
