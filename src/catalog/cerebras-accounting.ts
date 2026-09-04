import { finalizePricingInputs } from "./pricing-input.ts";
import type { PricingReconciliationItem } from "./pricing-reconciliation.ts";
import type { SourcePricingInputFact } from "./pricing-source.ts";
import { contractExtensionEvidence, type SourceContractEvidence } from "./source-contract.ts";

interface Input {
  documents: readonly { url: string; body: string }[];
  sourceRef: string;
  onFinding?: (evidence: SourceContractEvidence) => void;
  onReconciliation?: (item: PricingReconciliationItem) => void;
}

interface Contract {
  fact: Omit<SourcePricingInputFact, "source_ref">;
  requirements: readonly { path: string; markers: readonly RegExp[] }[];
}

const chatPath = "/api-reference/chat-completions";
const completionsPath = "/api-reference/completions";
const cachePath = "/capabilities/prompt-caching";
const batchPath = "/capabilities/batch";
const sdkReadmePath = "/Cerebras/cerebras-cloud-sdk-python/main/README";

const contracts: readonly Contract[] = [
  ...completionContracts("chat", chatPath, /chat\.completion\.chunk/),
  ...completionContracts("completions", completionsPath, /text_completion/),
  batchContract("input_tokens", "prompt_tokens"),
  batchContract("output_tokens", "completion_tokens"),
];

export function extractCerebrasPricingInputs(input: Input): SourcePricingInputFact[] {
  const documents = new Map(
    input.documents.map(({ url, body }) => [
      normalizePath(new URL(url).pathname),
      body.replace(/\\([_$*])/g, "$1").replace(/\s+/g, " "),
    ]),
  );
  const facts = contracts.flatMap(({ fact, requirements }): SourcePricingInputFact[] => {
    const present = requirements.every(({ path, markers }) => {
      const body = documents.get(path);
      return body !== undefined && markers.every((marker) => marker.test(body));
    });
    if (!present) {
      input.onFinding?.(contractExtensionEvidence([`/pricing-inputs/${fact.key}`]));
      return [];
    }
    return [{ ...fact, source_ref: input.sourceRef }];
  });
  return finalizePricingInputs(
    facts,
    contracts.length,
    "Cerebras pricing inputs",
    input.onReconciliation,
  );
}

function completionContracts(
  protocol: "chat" | "completions",
  path: string,
  streamObject: RegExp,
): Contract[] {
  return [
    ...usageContracts(protocol, path, "input_tokens", "prompt_tokens"),
    ...usageContracts(protocol, path, "cached_input_tokens", "cached_tokens", [
      {
        path: cachePath,
        markers: [
          /usage\.prompt_tokens_details\.cached_tokens/,
          /billed at the standard input token rate/,
        ],
      },
    ]),
    ...usageContracts(protocol, path, "output_tokens", "completion_tokens"),
  ].flatMap((contract): Contract[] => {
    if (contract.fact.channel !== "stream_event") return [contract];
    return [
      {
        ...contract,
        requirements: [
          ...contract.requirements,
          { path, markers: [streamObject] },
          {
            path: sdkReadmePath,
            markers: [/when streaming, `usage` and `time_info`[\s\S]{0,120}final chunk/i],
          },
        ],
      },
    ];
  });
}

function usageContracts(
  protocol: "chat" | "completions",
  path: string,
  signal: "cached_input_tokens" | "input_tokens" | "output_tokens",
  field: string,
  extraRequirements: Contract["requirements"] = [],
): Contract[] {
  const baseRequirements = [
    { path, markers: [new RegExp(`\\b${field}\\b`)] },
    ...extraRequirements,
  ];
  return [
    {
      fact: {
        key: `${protocol}.${signal}`,
        channel: "response",
        locator: { kind: "json_pointer", value: locator(field) },
        availability: "success_only",
      },
      requirements: baseRequirements,
    },
    {
      fact: {
        key: `${protocol}.stream.${signal}`,
        channel: "stream_event",
        locator: { kind: "json_pointer", value: locator(field) },
        availability: "terminal_only",
      },
      requirements: baseRequirements,
    },
  ];
}

function batchContract(signal: "input_tokens" | "output_tokens", field: string): Contract {
  return {
    fact: {
      key: `batch.result.${signal}`,
      channel: "result",
      locator: { kind: "json_pointer", value: `/response/usage/${field}` },
      availability: "success_only",
    },
    requirements: [
      {
        path: batchPath,
        markers: [
          /"status"\s*:\s*"succeeded"/,
          new RegExp(`"response"[\\s\\S]{0,600}"usage"[\\s\\S]{0,160}"${field}"`),
          /only charged for requests that completed/i,
        ],
      },
    ],
  };
}

function locator(field: string): string {
  return field === "cached_tokens"
    ? "/usage/prompt_tokens_details/cached_tokens"
    : `/usage/${field}`;
}

function normalizePath(path: string): string {
  return path.replace(/\.(?:md|py)$/, "").replace(/\/$/, "");
}
