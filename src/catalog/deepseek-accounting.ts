import { finalizePricingInputs } from "./pricing-input.ts";
import type { PricingReconciliationItem } from "./pricing-reconciliation.ts";
import type { SourcePricingInputFact } from "./pricing-source.ts";
import { contractExtensionEvidence, type SourceContractEvidence } from "./source-contract.ts";

interface Document {
  url: string;
  body: string;
}

interface Contract {
  key: string;
  document: string;
  markers: readonly RegExp[];
  channel: SourcePricingInputFact["channel"];
  locator: SourcePricingInputFact["locator"];
  availability: SourcePricingInputFact["availability"];
}

const chatPath = "/api/create-chat-completion";
const responsesPath = "/api/create-response";
const fimPath = "/api/create-completion";

const contracts: readonly Contract[] = [
  ...completionUsage("chat", chatPath, "prompt_cache_hit_tokens", "cached_input_tokens"),
  ...completionUsage("chat", chatPath, "prompt_cache_miss_tokens", "uncached_input_tokens"),
  ...completionUsage("chat", chatPath, "completion_tokens", "output_tokens"),
  ...completionUsage("fim", fimPath, "prompt_cache_hit_tokens", "cached_input_tokens"),
  ...completionUsage("fim", fimPath, "prompt_cache_miss_tokens", "uncached_input_tokens"),
  ...completionUsage("fim", fimPath, "completion_tokens", "output_tokens"),
  ...responsesUsage("input_tokens", "input_tokens"),
  ...responsesUsage("input_tokens_details.cached_tokens", "cached_input_tokens"),
  ...responsesUsage("output_tokens", "output_tokens"),
];

export function extractDeepseekPricingInputs(
  documents: readonly Document[],
  sourceRef: string,
  onFinding?: (evidence: SourceContractEvidence) => void,
  onReconciliation?: (item: PricingReconciliationItem) => void,
): SourcePricingInputFact[] {
  const bodies = new Map(
    documents.map(({ url, body }) => [normalizePath(new URL(url).pathname), body]),
  );
  const facts = contracts.flatMap((item) => {
    const body = bodies.get(item.document);
    if (body === undefined || !item.markers.every((marker) => marker.test(body))) {
      onFinding?.(contractExtensionEvidence([`/documents${item.document}/${item.key}`]));
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
  });
  return finalizePricingInputs(
    facts,
    contracts.length,
    "DeepSeek pricing inputs",
    onReconciliation,
  );
}

function completionUsage(
  protocol: "chat" | "fim",
  document: string,
  field: string,
  key: string,
): Contract[] {
  return [
    contract(`${protocol}.${key}`, document, "response", `/usage/${field}`, [marker(field)]),
    contract(`${protocol}.stream.${key}`, document, "stream_event", `/usage/${field}`, [
      marker(field),
      /last (?:content )?chunk before the [`\s]*data:\s*\[DONE\]/i,
      /token\s+usage\s+statistics\s+for\s+the\s+entire\s+request/i,
    ]),
  ];
}

function responsesUsage(field: string, key: string): Contract[] {
  const path = field.replaceAll(".", "/");
  return [
    contract(`responses.${key}`, responsesPath, "response", `/usage/${path}`, [marker(field)]),
    contract(`responses.stream.${key}`, responsesPath, "stream_event", `/response/usage/${path}`, [
      marker(field),
      /response\.completed/,
      /response\.incomplete/,
      /response\.failed/,
    ]),
  ];
}

function contract(
  key: string,
  document: string,
  channel: SourcePricingInputFact["channel"],
  path: string,
  markers: readonly RegExp[],
): Contract {
  return {
    key,
    document,
    markers,
    channel,
    locator: { kind: "json_pointer", value: path },
    availability: channel === "stream_event" ? "terminal_only" : "success_only",
  };
}

function marker(field: string): RegExp {
  return new RegExp(field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
}

function normalizePath(path: string): string {
  return path.replace(/\/$/, "");
}
