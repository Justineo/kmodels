import { load } from "cheerio";
import { markdownProse, markdownSection } from "./markdown.ts";
import { openApiYamlSchemaReader } from "./openapi-yaml.ts";
import { finalizePricingInputs } from "./pricing-input.ts";
import type { PricingReconciliationItem } from "./pricing-reconciliation.ts";
import type { SourcePricingInputFact } from "./pricing-source.ts";
import { contractExtensionEvidence, type SourceContractEvidence } from "./source-contract.ts";
import { yamlBlock } from "./yaml.ts";

interface Input {
  documents: readonly { url: string; body: string }[];
  sourceRef: string;
  onFinding?: (evidence: SourceContractEvidence) => void;
  onReconciliation?: (item: PricingReconciliationItem) => void;
}

interface Contract {
  protocol: "chat" | "completions" | "batch";
  field: "prompt_tokens" | "cached_tokens" | "completion_tokens";
  fact: Omit<SourcePricingInputFact, "source_ref">;
}

const documents = {
  chat: "https://inference-docs.cerebras.ai/api-reference/chat-completions.md",
  completions: "https://inference-docs.cerebras.ai/api-reference/completions.md",
  batch: "https://inference-docs.cerebras.ai/capabilities/batch.md",
  sdk: "https://raw.githubusercontent.com/Cerebras/cerebras-cloud-sdk-python/main/README.md",
};

const contracts: Contract[] = [
  ...completionContracts("chat"),
  ...completionContracts("completions"),
  ...(["input_tokens", "output_tokens"] as const).map((signal): Contract => {
    const field = signal === "input_tokens" ? "prompt_tokens" : "completion_tokens";
    return {
      protocol: "batch",
      field,
      fact: {
        key: `batch.result.${signal}`,
        channel: "result",
        locator: { kind: "json_pointer", value: `/response/usage/${field}` },
        availability: "success_only",
      },
    };
  }),
];

export function extractCerebrasPricingInputs(input: Input): SourcePricingInputFact[] {
  const bodies = new Map<string, string | undefined>();
  for (const { url, body } of input.documents) {
    if (!Object.values(documents).includes(url)) continue;
    bodies.set(url, bodies.has(url) ? undefined : body);
  }
  const streamPolicy = bodies.get(documents.sdk);
  const terminal =
    streamPolicy === undefined
      ? undefined
      : markdownSection(streamPolicy, 2, "Streaming responses");
  const finalUsage =
    terminal !== undefined &&
    /when streaming, `usage` and `time_info`[^.]{0,160}final chunk/i.test(markdownProse(terminal));
  const facts = contracts.flatMap(({ fact, protocol, field }): SourcePricingInputFact[] => {
    const body = bodies.get(documents[protocol]);
    const stream = fact.channel === "stream_event";
    const present =
      body !== undefined &&
      (!stream || finalUsage) &&
      (protocol === "chat"
        ? chatCounter(body, field, stream)
        : protocol === "completions"
          ? completionCounter(body, field, stream)
          : batchCounter(body, field));
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

function completionContracts(protocol: "chat" | "completions"): Contract[] {
  return (["input_tokens", "cached_input_tokens", "output_tokens"] as const).flatMap((signal) => {
    const field =
      signal === "input_tokens"
        ? "prompt_tokens"
        : signal === "output_tokens"
          ? "completion_tokens"
          : "cached_tokens";
    return (["response", "stream_event"] as const).map((channel) => ({
      protocol,
      field,
      fact: {
        key: `${protocol}.${channel === "stream_event" ? "stream." : ""}${signal}`,
        channel,
        locator: { kind: "json_pointer", value: `/${usagePath(field).join("/")}` },
        availability: channel === "stream_event" ? "terminal_only" : "success_only",
      },
    }));
  });
}

function usagePath(field: Contract["field"]): string[] {
  return field === "cached_tokens" ? ["usage", "prompt_tokens_details", field] : ["usage", field];
}

function chatCounter(body: string, field: Contract["field"], stream: boolean): boolean {
  const blocks = [
    ...body.matchAll(
      /^(`{3,})yaml POST \/v1\/chat\/completions[^\r\n]*\r?\n([^]*?)^\1[ \t]*\r?$/gm,
    ),
  ];
  const spec = blocks.length === 1 ? blocks[0]?.[2] : undefined;
  if (spec === undefined) return false;
  const operation = yamlPath(spec, ["paths", "/v1/chat/completions", "post"]);
  if (operation === undefined) return false;
  const media = yamlPath(operation, ["responses", "200", "content", "application/json"], 6);
  if (media === undefined) return false;
  const schema = yamlPath(media, ["schema"], 14);
  const reference =
    schema === undefined
      ? undefined
      : scalar(schema, "$ref", 16)?.match(/^#\/components\/schemas\/([A-Za-z0-9_-]+)$/u)?.[1];
  if (reference === undefined) return false;
  const types = openApiYamlSchemaReader(spec)(reference, usagePath(field));
  if (types.length !== 1 || types[0] !== "integer") return false;
  if (!stream) return true;
  const example = yamlPath(media, ["examples", "Streaming", "value"], 14);
  if (example === undefined || scalar(example, "object", 20) !== "chat.completion.chunk")
    return false;
  const usage = yamlPath(example, ["usage"], 20);
  return (
    usage !== undefined &&
    ["prompt_tokens", "completion_tokens"].every((name) => {
      const value = scalar(usage, name, 22);
      return value !== undefined && /^(?:0|[1-9]\d*)$/u.test(value);
    })
  );
}

function completionCounter(body: string, field: Contract["field"], stream: boolean): boolean {
  const signatures = [...body.matchAll(/^ *curl -X ([A-Z]+) (https:\/\/[^\s\\]+)[^\r\n]*$/gm)];
  if (
    signatures.length !== 1 ||
    signatures[0]?.[1] !== "POST" ||
    signatures[0]?.[2] !== "https://api.cerebras.ai/v1/completions"
  )
    return false;
  const response = markdownSection(body, 2, "Completion Response");
  if (response === undefined) return false;
  const $ = load(markdownProse(response), { xml: true });
  $("script, style, template, pre, code, blockquote").remove();
  const owner = "ResponseField, ParamField, [name], [path], [type]";
  let parent: ReturnType<typeof $> | undefined;
  for (const [index, name] of usagePath(field).entries()) {
    const matches = $.root()
      .find("ResponseField")
      .filter(
        (_index, node) =>
          $(node).attr("name") === name && $(node).parents(owner).first().get(0) === parent?.get(0),
      );
    const expected = index === usagePath(field).length - 1 ? "integer" : "object";
    if (matches.length !== 1 || matches.attr("type") !== expected) return false;
    parent = matches;
  }
  if (!stream) return true;
  const object = $.root()
    .find('ParamField[path="object"]')
    .filter((_index, node) => $(node).parents(owner).length === 0);
  return (
    object.length === 1 &&
    object.attr("type") === "string" &&
    /always `text_completion`/.test(object.text())
  );
}

function batchCounter(body: string, field: Contract["field"]): boolean {
  if (!/available endpoint is currently `\/v1\/chat\/completions`/.test(markdownProse(body)))
    return false;
  const values: unknown[] = [];
  for (const match of body.matchAll(/^( *)(`{3,})jsonl?[^\r\n]*\r?\n([^]*?)^\1\2[ \t]*\r?$/gm)) {
    const text = match[3] ?? "";
    let records: unknown[];
    try {
      records = [JSON.parse(text)];
    } catch {
      records = text.split(/\r?\n/u).flatMap((line): unknown[] => {
        try {
          return [JSON.parse(line)];
        } catch {
          return [];
        }
      });
    }
    for (const record of records) {
      if (atPath(record, ["status"]) !== "succeeded") continue;
      const value = atPath(record, ["response", "usage", field]);
      if (value !== undefined) values.push(value);
    }
  }
  return (
    values.length > 0 &&
    values.every((value) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0)
  );
}

function atPath(value: unknown, path: readonly string[]): unknown {
  for (const name of path) {
    if (!record(value) || !Object.hasOwn(value, name)) return;
    value = value[name];
  }
  return value;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function yamlPath(body: string, path: readonly string[], indentation = 0): string | undefined {
  for (const label of path) {
    const matches = [label, `'${label}'`, `"${label}"`].flatMap((key) => {
      const block = yamlBlock(body, key, indentation);
      return block === undefined ? [] : [block];
    });
    if (matches.length !== 1) return;
    body = matches[0] ?? "";
    indentation += 2;
  }
  return body;
}

function scalar(body: string, key: string, indentation: number): string | undefined {
  const prefix = " ".repeat(indentation) + key + ":";
  const values = body
    .split(/\r?\n/u)
    .filter((line) => line.startsWith(prefix))
    .map((line) => line.slice(prefix.length).trim());
  if (values.length !== 1) return;
  return values[0]?.replace(/^(['"])(.*)\1$/u, "$2");
}
