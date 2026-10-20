import { z } from "zod";
import { modelIdSchema } from "./identity.ts";
import { markdownSection } from "./markdown.ts";
import { contractExtensionEvidence } from "./source-contract.ts";
import type { SourcePricingInputFact } from "./pricing-source.ts";
import type { SourceParseInput } from "./source-parse.ts";

type Input = Pick<SourceParseInput, "source" | "onContractFinding">;
const recordSchema = z.record(z.string(), z.unknown());

function usageContractFinding(input: Input, field: string): void {
  input.onContractFinding?.(
    contractExtensionEvidence([`/anthropic/accounting_contract_drift/Messages usage.${field}`]),
  );
}

function record(value: unknown): Record<string, unknown> | undefined {
  const parsed = recordSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function usageExamples(markdown: string): Record<string, unknown>[] {
  const usages: Record<string, unknown>[] = [];
  for (const match of markdown.matchAll(/^```json(?:[ \t][^\r\n]*)?\r?\n([\s\S]*?)^```[ \t]*$/gm)) {
    try {
      const root = record(JSON.parse(match[1] ?? ""));
      const usage = record(root?.usage);
      if (usage !== undefined) usages.push(usage);
    } catch {
      // A malformed example cannot establish a response-field contract.
    }
  }
  return usages;
}

function counter(values: unknown[]): boolean {
  const observed = values.filter((value) => value !== undefined);
  return (
    observed.length > 0 &&
    observed.every(
      (value) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0,
    )
  );
}

function iterations(usages: readonly Record<string, unknown>[]): Record<string, unknown>[] {
  return usages.flatMap((usage) => {
    const entries = z.array(z.unknown()).safeParse(usage.iterations);
    if (!entries.success) return [];
    return entries.data.flatMap((entry) => {
      const item = record(entry);
      if (item === undefined) return [];
      if (item.type === "message" || item.type === "compaction") return [item];
      if (item.type === "advisor_message" && modelIdSchema.safeParse(item.model).success)
        return [item];
      return [];
    });
  });
}

function usageInput(
  signal: string,
  field: string,
  input: Input,
  iteration = false,
): SourcePricingInputFact {
  return {
    key: `messages.usage.${signal}`,
    channel: "response",
    locator: iteration
      ? {
          kind: "provider_field",
          value: `usage.iterations[*].${field} attributed to advisor_message.model or response.model for message/compaction`,
        }
      : { kind: "json_pointer", value: `/usage/${field.replaceAll(".", "/")}` },
    availability: "conditional",
    source_ref: input.source.id,
  };
}

interface Field {
  indent: number;
  declaration: string;
  parent?: number;
  name?: string;
  type?: string;
}

function returnedUsageFields(markdown: string): Map<string, string[]> {
  if (!/^#{1,2} Create a Message\r?\n\r?\n\*\*post\*\* `\/v1\/messages`/im.test(markdown))
    return new Map();
  const sections = [2, 3].flatMap((depth) => markdownSection(markdown, depth, "Returns") ?? []);
  if (sections.length !== 1) return new Map();
  const body = sections[0] ?? "";
  const fields: Field[] = [];
  const ancestors: number[] = [];
  let fence: string | undefined;
  // Unreviewed list items still own descendants; nested usage must not become a root.
  for (const line of body.split(/\r?\n/)) {
    const marker = line.match(/^ *(`{3,}|~{3,})(.*)$/);
    if (marker?.[1] !== undefined) {
      if (fence === undefined) fence = marker[1];
      else if (
        marker[1][0] === fence[0] &&
        marker[1].length >= fence.length &&
        marker[2]?.trim() === ""
      )
        fence = undefined;
      continue;
    }
    if (fence !== undefined) continue;
    const bullet = line.match(/^( *)- (.+)$/);
    if (bullet?.[1] === undefined || bullet[2] === undefined) continue;
    const indent = bullet[1].length;
    while (ancestors.length > 0 && (fields[ancestors.at(-1) ?? -1]?.indent ?? -1) >= indent)
      ancestors.pop();
    const parent = ancestors.at(-1);
    const declaration = bullet[2].match(/^`([a-z_]+): ([^`]+)`$/);
    fields.push({
      indent,
      declaration: bullet[2],
      ...(parent === undefined ? {} : { parent }),
      ...(declaration?.[1] === undefined ? {} : { name: declaration[1] }),
      ...(declaration?.[2] === undefined ? {} : { type: declaration[2] }),
    });
    ancestors.push(fields.length - 1);
  }
  const messages = fields.flatMap((field, index) =>
    field.parent === undefined && field.declaration === "`Message object`" ? [index] : [],
  );
  if (messages.length > 1) return new Map();
  const message = messages[0];
  if (message !== undefined) {
    const types = fields.filter((field) => field.parent === message && field.name === "type");
    if (types.length !== 1 || types[0]?.type !== '"message"') return new Map();
  }
  const roots = fields.flatMap((field, index) =>
    field.parent === message && field.name === "usage" ? [index] : [],
  );
  const root = roots[0];
  if (roots.length !== 1 || root === undefined || fields[root]?.type !== "Usage") return new Map();
  const result = new Map<string, string[]>();
  for (const field of fields) {
    if (field.parent !== root || field.name === undefined || field.type === undefined) continue;
    result.set(field.name, [...(result.get(field.name) ?? []), field.type]);
  }
  return result;
}

export function anthropicMessageInputs(
  messages: string,
  promptCaching: string,
  input: Input,
): SourcePricingInputFact[] {
  const facts: SourcePricingInputFact[] = [];
  const fields = returnedUsageFields(messages);
  for (const [field, signal, type] of [
    ["cache_creation_input_tokens", undefined, "number"],
    ["cache_read_input_tokens", "cached_input_tokens", "number"],
    ["inference_geo", "selector.inference_geo", "string"],
    ["input_tokens", "uncached_input_tokens", "number"],
    ["output_tokens", "output_tokens", "number"],
    ["server_tool_use", undefined, "ServerToolUsage"],
    ["service_tier", "selector.served_service_tier", '"standard" or "priority" or "batch"'],
    ["speed", "selector.speed", '"standard" or "fast"'],
  ] as const) {
    const declarations = fields.get(field) ?? [];
    const declaredType = declarations[0]?.replace(/^optional /, "").replace(/ or null$/, "");
    if (declarations.length === 1 && declaredType === type) {
      if (signal !== undefined) facts.push(usageInput(signal, field, input));
    } else usageContractFinding(input, field);
  }
  const usages = usageExamples(promptCaching);
  const typedIterations = iterations(usages);
  const partition =
    /cache_creation_input_tokens[\s\S]{0,100}equals the sum of the values in the[\s\S]{0,30}cache_creation/.test(
      promptCaching,
    );
  for (const ttl of ["5m", "1h"] as const) {
    const field = `ephemeral_${ttl}_input_tokens`;
    const signal = `cache_write_${ttl}_input_tokens`;
    const path = `cache_creation.${field}`;
    if (partition && counter(usages.map((usage) => record(usage.cache_creation)?.[field])))
      facts.push(usageInput(signal, path, input));
    else usageContractFinding(input, path);
    if (partition && counter(typedIterations.map((entry) => record(entry.cache_creation)?.[field])))
      facts.push(usageInput(signal, path, input, true));
  }
  return facts;
}

export function anthropicSearchInput(
  markdown: string,
  input: Input,
): SourcePricingInputFact | undefined {
  if (
    !counter(
      usageExamples(markdown).map((usage) => record(usage.server_tool_use)?.web_search_requests),
    )
  )
    return;
  return {
    ...usageInput("successful_web_searches", "server_tool_use.web_search_requests", input),
    availability: "terminal_only",
  };
}

export function anthropicIterationInputs(markdown: string, input: Input): SourcePricingInputFact[] {
  const entries = iterations(usageExamples(markdown));
  return (
    [
      ["input_tokens", "uncached_input_tokens"],
      ["cache_read_input_tokens", "cached_input_tokens"],
      ["output_tokens", "output_tokens"],
    ] as const
  ).flatMap(([field, signal]) =>
    !counter(entries.map((entry) => entry[field])) ? [] : [usageInput(signal, field, input, true)],
  );
}
