import { finalizePricingInputs } from "./pricing-input.ts";
import { markdownProse, markdownSection } from "./markdown.ts";
import type { PricingReconciliationItem } from "./pricing-reconciliation.ts";
import type { SourcePricingInputFact } from "./pricing-source.ts";
import { contractExtensionEvidence, type SourceContractEvidence } from "./source-contract.ts";

interface Contract {
  key: string;
  channel: SourcePricingInputFact["channel"];
  locator: SourcePricingInputFact["locator"];
  availability: SourcePricingInputFact["availability"];
  sections: readonly SectionRequirement[];
  reduction?: SourcePricingInputFact["reduction"];
  response?: ResponseContract;
}

interface ResponseContract {
  document: string;
  operation: string;
  fields: string[];
  type: "integer" | "number" | "string" | "array";
}

interface SectionRequirement {
  path: string;
  heading?: { level: number; title: string };
  markers: readonly RegExp[];
}

const chatPath = "/developers/rest-api-reference/inference/chat-completions";
const responsesPath = "/developers/rest-api-reference/inference/responses";
const costPath = "/developers/cost-tracking";
const toolPath = "/developers/tools/tool-usage-details";
const imagePath = "/developers/rest-api-reference/inference/images";
const videoPath = "/developers/rest-api-reference/inference/videos";
const speechToTextPath = "/developers/rest-api-reference/inference/speech-to-text";

const chatOperation = "POST /v1/chat/completions";
const responsesOperation = "POST /v1/responses";
const chatUsage = [
  ["prompt_text_tokens", "prompt_tokens_details.text_tokens"],
  ["cached_prompt_text_tokens", "prompt_tokens_details.cached_tokens"],
  ["prompt_image_tokens", "prompt_tokens_details.image_tokens"],
  ["completion_tokens", "completion_tokens"],
  ["reasoning_tokens", "completion_tokens_details.reasoning_tokens"],
  ["prompt_tokens", "prompt_tokens"],
] as const;

const contracts: readonly Contract[] = [
  ...chatUsage.map(([key, field]) =>
    responseContract("chat.usage." + key, chatPath, chatOperation, "usage." + field),
  ),
  responseContract("chat.served_service_tier", chatPath, chatOperation, "service_tier", "string"),
  ...chatUsage.map(([key, field]): Contract => ({
    ...responseContract("chat.stream.usage." + key, chatPath, chatOperation, "usage." + field),
    channel: "stream_event",
    sections: [
      { path: chatPath, markers: [] },
      { path: costPath, markers: [/stream_options/, /include_usage/, /final chunk/i] },
    ],
  })),
  ...[
    ["input_tokens", "input_tokens"],
    ["cached_input_tokens", "input_tokens_details.cached_tokens"],
    ["output_tokens", "output_tokens"],
  ].map(([key, field]) =>
    responseContract("responses.usage." + key, responsesPath, responsesOperation, "usage." + field),
  ),
  responseContract(
    "responses.served_service_tier",
    responsesPath,
    responsesOperation,
    "service_tier",
    "string",
  ),
  ...["x_posts_fetched", "x_users_fetched"].map((key) =>
    responseContract(
      "responses.usage." + key,
      responsesPath,
      responsesOperation,
      "usage.server_side_tool_usage_details." + key,
    ),
  ),
  ...[
    "prompt_tokens",
    "cached_prompt_text_tokens",
    "prompt_image_tokens",
    "completion_tokens",
    "reasoning_tokens",
  ].map((key): Contract => ({
    key: "sdk.agent." + key,
    channel: "response",
    locator: { kind: "provider_field", value: "ChatResponse.usage." + key },
    availability: "terminal_only",
    sections: [
      {
        path: toolPath,
        heading: { level: 3, title: "`" + key + "`" },
        markers: [key === "completion_tokens" ? /final text output/i : /\btokens\b/i],
      },
    ],
  })),
  ...[
    ["web_search", "SERVER_SIDE_TOOL_WEB_SEARCH"],
    ["x_search", "SERVER_SIDE_TOOL_X_SEARCH"],
    ["code_execution", "SERVER_SIDE_TOOL_CODE_EXECUTION"],
    ["collections_search", "SERVER_SIDE_TOOL_COLLECTIONS_SEARCH"],
  ].map(([key, category]): Contract => ({
    key: "sdk.server_side_tool_usage." + key,
    channel: "response",
    locator: { kind: "provider_field", value: "ChatResponse.server_side_tool_usage." + category },
    availability: "terminal_only",
    sections: [
      {
        path: toolPath,
        heading: { level: 3, title: "`server_side_tool_usage` - Successful Calls" },
        markers: [/invocation counts/i, /determines your billing/i],
      },
      {
        path: toolPath,
        heading: { level: 2, title: "Tool Call Function Names vs Usage Categories" },
        markers: [new RegExp("^\\| `" + category + "` \\|", "m")],
      },
    ],
  })),
  {
    ...responseContract(
      "image.generated_images",
      imagePath,
      "POST /v1/images/generations",
      "data",
      "array",
    ),
    reduction: { kind: "array_length" },
    availability: "success_only",
  },
  {
    ...responseContract(
      "video.generated_seconds",
      videoPath,
      "GET /v1/videos/\\{request\\_id}",
      "video.duration",
    ),
    channel: "result",
    availability: "success_only",
  },
  {
    ...responseContract(
      "stt.rest.audio_seconds",
      speechToTextPath,
      "POST /v1/stt",
      "duration",
      "number",
    ),
    availability: "success_only",
  },
];

export function extractXaiPricingInputs(
  llms: string,
  sourceRef: string,
  onFinding?: (evidence: SourceContractEvidence) => void,
  onReconciliation?: (item: PricingReconciliationItem) => void,
): SourcePricingInputFact[] {
  const sections = splitSections(llms);
  const chat = sections.get(chatPath);
  const chatOperationBody =
    chat === undefined ? undefined : markdownSection(chat, 2, chatOperation);
  const chatResponse =
    chatOperationBody === undefined
      ? undefined
      : markdownSection(chatOperationBody, 3, "Response Body");
  const fastIsPriority =
    chatResponse !== undefined &&
    /^\* `service_tier` \([^\n]+\)[^\n]*`Fast` and `Priority` are interchangeable/m.test(
      markdownProse(chatResponse).replaceAll("\\`", "`"),
    );
  const facts = contracts.flatMap((contract) => {
    const present = contract.sections.every(({ path, heading, markers }) => {
      const document = sections.get(path);
      const body =
        document === undefined || heading === undefined
          ? document
          : markdownSection(document, heading.level, heading.title);
      return (
        body !== undefined &&
        (contract.response?.document !== path || responseField(body, contract.response)) &&
        markers.every((marker) => marker.test(markdownProse(body)))
      );
    });
    if (!present) {
      onFinding?.(
        contractExtensionEvidence([
          "/documents" + contract.sections.map(({ path }) => path).join("+") + "/" + contract.key,
        ]),
      );
      return [];
    }
    return [
      {
        key:
          fastIsPriority && contract.key.endsWith(".served_service_tier")
            ? contract.key + ".fast_priority_alias"
            : contract.key,
        channel: contract.channel,
        locator: contract.locator,
        ...(contract.reduction === undefined ? {} : { reduction: contract.reduction }),
        availability: contract.availability,
        source_ref: sourceRef,
      },
    ];
  });
  return finalizePricingInputs(facts, contracts.length, "xAI pricing inputs", onReconciliation);
}

function responseContract(
  key: string,
  document: string,
  operation: string,
  field: string,
  type: ResponseContract["type"] = "integer",
): Contract {
  return {
    key,
    channel: "response",
    locator: { kind: "json_pointer", value: "/" + field.replaceAll(".", "/") },
    availability: "terminal_only",
    sections: [{ path: document, markers: [] }],
    response: { document, operation, fields: field.split("."), type },
  };
}

interface Field {
  name?: string;
  type?: string;
  children: Field[];
}

function responseField(body: string, contract: ResponseContract): boolean {
  const operation = markdownSection(body, 2, contract.operation);
  const response =
    operation === undefined ? undefined : markdownSection(operation, 3, "Response Body");
  if (response === undefined) return false;
  let fields = responseFields(response);
  for (const [index, name] of contract.fields.entries()) {
    const matches = fields.filter((field) => field.name === name);
    const field = matches[0];
    if (matches.length !== 1 || field?.type === undefined) return false;
    const expected = index === contract.fields.length - 1 ? contract.type : "object";
    const types =
      field.type
        .split(",")[0]
        ?.split("|")
        .map((value) => value.trim())
        .filter((value) => value !== "null") ?? [];
    if (
      types.length === 0 ||
      !types.every(
        (type) =>
          type === expected ||
          (expected === "array" && /^array\\?<object>$/.test(type)) ||
          (expected === "string" && /^"[^"\n]+"$/.test(type)),
      )
    )
      return false;
    fields = field.children;
  }
  return contract.fields.length > 0;
}

function responseFields(body: string): Field[] {
  const roots: Field[] = [];
  const parents: Array<{ indent: number; field: Field }> = [];
  for (const line of markdownProse(body).split(/\r?\n/u)) {
    const bullet = line.match(/^( *)\* (.+)$/u);
    if (bullet?.[1] === undefined || bullet[2] === undefined) continue;
    const indent = bullet[1].length;
    while ((parents.at(-1)?.indent ?? -1) >= indent) parents.pop();
    const parent = parents.at(-1);
    if (parent === undefined && indent !== 0) continue;
    const owned = parent === undefined || indent === parent.indent + 2;
    const property = owned ? bullet[2].match(/^`([a-z_]+)` \(([^)]+)\)/u) : undefined;
    const field: Field = {
      ...(property?.[1] === undefined ? {} : { name: property[1] }),
      ...(property?.[2] === undefined ? {} : { type: property[2] }),
      children: [],
    };
    (parent?.field.children ?? roots).push(field);
    parents.push({ indent, field });
  }
  return roots;
}

function splitSections(body: string): ReadonlyMap<string, string | undefined> {
  const result = new Map<string, string | undefined>();
  const matches = [...markdownProse(body).matchAll(/^===([^=\n]+)===\s*$/gm)];
  for (const [index, match] of matches.entries()) {
    const path = match[1];
    if (path === undefined || match.index === undefined)
      throw new Error("xAI accounting section marker was malformed");
    const start = match.index + match[0].length;
    const end = matches[index + 1]?.index ?? body.length;
    result.set(path, result.has(path) ? undefined : body.slice(start, end).trim());
  }
  return result;
}
