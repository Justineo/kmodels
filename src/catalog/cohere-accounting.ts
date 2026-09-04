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
    if (body !== undefined && contract.markers.every((marker) => marker.test(body)))
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
