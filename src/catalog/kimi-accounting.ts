import { z } from "zod";
import { finalizePricingInputs } from "./pricing-input.ts";
import type { PricingReconciliationItem } from "./pricing-reconciliation.ts";
import type { SourcePricingInputFact } from "./pricing-source.ts";
import { contractExtensionEvidence, type SourceContractEvidence } from "./source-contract.ts";

interface OpenApiInput {
  spec: unknown;
  sourceRef: string;
  baseUrl: string;
  onFinding?: (evidence: SourceContractEvidence) => void;
  onReconciliation?: (item: PricingReconciliationItem) => void;
}

interface DocumentInput {
  documents: readonly { url: string; body: string }[];
  sourceRef: string;
  onFinding?: (evidence: SourceContractEvidence) => void;
  onReconciliation?: (item: PricingReconciliationItem) => void;
}

export interface KimiEndpointClaim {
  name: string;
  path: string;
  modelIds: string[];
}

export interface KimiOpenApiAccounting {
  endpoints: KimiEndpointClaim[];
  pricingInputs: SourcePricingInputFact[];
}

interface JsonSpec {
  paths: Record<string, unknown>;
  schemas: Record<string, unknown>;
}

interface InputContract {
  key: string;
  channel: SourcePricingInputFact["channel"];
  locator: SourcePricingInputFact["locator"];
  availability: SourcePricingInputFact["availability"];
  verify: (spec: JsonSpec) => void;
}

const openApiSchema = z.object({
  paths: z.record(z.string(), z.unknown()),
  components: z.object({ schemas: z.record(z.string(), z.unknown()) }),
});
const objectSchema = z.record(z.string(), z.unknown());
const referenceSchema = z.object({
  $ref: z.string().regex(/^#\/components\/schemas\/[A-Za-z0-9]+$/),
});
const chatPath = "/v1/chat/completions";
const responsesPath = "/v1/responses";
const messagesPath = "/anthropic/v1/messages";

const openApiContracts: readonly InputContract[] = [
  ...chatUsage("input_tokens", "prompt_tokens"),
  ...chatUsage("cached_input_tokens", "cached_tokens"),
  ...chatUsage("output_tokens", "completion_tokens"),
  responseUsage("input_tokens", ["input_tokens"], /including cached tokens|含命中缓存/i),
  responseUsage("cached_input_tokens", ["input_tokens_details", "cached_tokens"]),
  responseUsage("output_tokens", ["output_tokens"], /including reasoning tokens|含推理 Token/i),
  ...messagesUsage("uncached_input_tokens", ["input_tokens"], /excluding cache hits|不含命中缓存/i),
  ...messagesUsage("cached_input_tokens", ["cache_read_input_tokens"]),
  ...messagesUsage("output_tokens", ["output_tokens"], /including reasoning tokens|含推理 Token/i),
];

export function extractKimiOpenApiAccounting(input: OpenApiInput): KimiOpenApiAccounting {
  const parsed = openApiSchema.parse(input.spec);
  const spec = { paths: parsed.paths, schemas: parsed.components.schemas };
  const endpoints = [
    ...reviewEndpoint(input, "responses_endpoint_contract", () => responsesEndpoint(spec)),
    ...reviewEndpoint(input, "messages_endpoint_contract", () => messagesEndpoint(spec)),
  ];
  const region = regionKey(input.baseUrl);
  const facts: SourcePricingInputFact[] = [
    {
      key: `request.api_origin.${region}`,
      channel: "request",
      locator: { kind: "provider_field", value: "HttpRequest.api_origin" },
      availability: "always",
      source_ref: input.sourceRef,
    },
    ...openApiContracts.flatMap((contract) => {
      try {
        contract.verify(spec);
        return [
          {
            key: contract.key,
            channel: contract.channel,
            locator: contract.locator,
            availability: contract.availability,
            source_ref: input.sourceRef,
          } satisfies SourcePricingInputFact,
        ];
      } catch {
        input.onFinding?.(contractExtensionEvidence([`/pricing-inputs/${contract.key}`]));
        return [];
      }
    }),
  ];
  const pricingInputs = finalizePricingInputs(
    facts,
    openApiContracts.length + 1,
    "Kimi OpenAPI pricing inputs",
    input.onReconciliation,
  );
  return { endpoints, pricingInputs };
}

export function extractKimiCommercialPricingInputs(input: DocumentInput): SourcePricingInputFact[] {
  const documents = new Map(
    input.documents.map(({ url, body }) => [normalizePath(new URL(url).pathname), body]),
  );
  const contracts: ReadonlyArray<{
    fact: Omit<SourcePricingInputFact, "source_ref">;
    requirements: readonly { path: string; markers: readonly RegExp[] }[];
  }> = [
    batchContract("input_tokens", "prompt_tokens"),
    batchContract("output_tokens", "completion_tokens"),
    {
      fact: {
        key: "web_search.chat.billable_calls",
        channel: "response",
        locator: {
          kind: "provider_field",
          value: "KimiChatResponse.billable_builtin_web_search_calls",
        },
        availability: "success_only",
      },
      requirements: [
        {
          path: "/docs/pricing/tools",
          markers: [
            /finish_reason\s*=\s*tool_calls/,
            /tool_call\.function\.name\s*=\s*\$web_search/,
          ],
        },
        { path: "/docs/guide/use-web-search", markers: [/\$web_search/, /tool_calls?/] },
      ],
    },
    {
      fact: {
        key: "web_search.formula.created_fibers",
        channel: "response",
        locator: {
          kind: "provider_field",
          value: "KimiFormulaFiber.created_web_search_fibers",
        },
        availability: "success_only",
      },
      requirements: [
        {
          path: "/docs/guide/use-official-tools",
          markers: [
            /moonshot\/web-search:latest/,
            /POST \/v1\/formulas\/\{uri\}\/fibers/,
            /(?:produces the tool_call billing|产生工具调用计费)/i,
          ],
        },
      ],
    },
  ];
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
    "Kimi commercial pricing inputs",
    input.onReconciliation,
  );
}

function chatUsage(signal: string, field: string): InputContract[] {
  return [
    openApiInput(`chat.${signal}`, "response", `/usage/${field}`, "success_only", (spec) => {
      integerField(spec, responseSchema(spec, chatPath, "application/json"), ["usage", field]);
    }),
    openApiInput(
      `chat.stream.${signal}`,
      "stream_event",
      `/usage/${field}`,
      "terminal_only",
      (spec) => {
        integerField(spec, responseSchema(spec, chatPath, "text/event-stream"), ["usage", field]);
        chatStreamingUsage(spec);
      },
    ),
  ];
}

function responseUsage(
  signal: string,
  path: readonly string[],
  description?: RegExp,
): InputContract {
  return openApiInput(
    `responses.${signal}`,
    "response",
    `/usage/${path.join("/")}`,
    "success_only",
    (spec) =>
      integerField(
        spec,
        responseSchema(spec, responsesPath, "application/json"),
        ["usage", ...path],
        description,
      ),
  );
}

function messagesUsage(
  signal: string,
  path: readonly string[],
  description?: RegExp,
): InputContract[] {
  return [
    openApiInput(
      `messages.${signal}`,
      "response",
      `/usage/${path.join("/")}`,
      "success_only",
      (spec) =>
        integerField(
          spec,
          responseSchema(spec, messagesPath, "application/json"),
          ["usage", ...path],
          description,
        ),
    ),
    openApiInput(
      `messages.stream.${signal}`,
      "stream_event",
      `/usage/${path.join("/")}`,
      "terminal_only",
      (spec) => {
        const stream = dereference(spec, responseSchema(spec, messagesPath, "text/event-stream"));
        const delta = oneOf(stream).filter(
          (candidate) => object(candidate).title === "message_delta",
        );
        if (delta.length !== 1) throw new Error("Kimi Messages stream omitted message_delta");
        integerField(spec, delta[0], ["usage", ...path], description);
      },
    ),
  ];
}

function openApiInput(
  key: string,
  channel: SourcePricingInputFact["channel"],
  pointer: string,
  availability: SourcePricingInputFact["availability"],
  verify: InputContract["verify"],
): InputContract {
  return {
    key,
    channel,
    locator: { kind: "json_pointer", value: pointer },
    availability,
    verify,
  };
}

function batchContract(
  signal: string,
  field: string,
): {
  fact: Omit<SourcePricingInputFact, "source_ref">;
  requirements: readonly { path: string; markers: readonly RegExp[] }[];
} {
  return {
    fact: {
      key: `batch.result.${signal}`,
      channel: "result",
      locator: { kind: "json_pointer", value: `/response/body/usage/${field}` },
      availability: "success_only",
    },
    requirements: [
      {
        path: "/docs/guide/use-batch-api",
        markers: [new RegExp(`response[\\s\\S]*body[\\s\\S]*usage[\\s\\S]*${field}`)],
      },
      {
        path: "/docs/api/batch-create",
        markers: [/POST \/v1\/batches/, /\/v1\/chat\/completions/],
      },
    ],
  };
}

function responsesEndpoint(spec: JsonSpec): KimiEndpointClaim {
  const request = dereference(spec, requestSchema(spec, responsesPath));
  const model = object(schemaAt(spec, request, ["model"]));
  if (
    model.example !== "kimi-k3" ||
    !/currently supports `kimi-k3`|当前支持 `kimi-k3`/i.test(String(model.description))
  )
    throw new Error("Kimi Responses model scope changed");
  responseSchema(spec, responsesPath, "application/json");
  responseSchema(spec, responsesPath, "text/event-stream");
  return { name: "Responses", path: responsesPath, modelIds: ["kimi-k3"] };
}

function messagesEndpoint(spec: JsonSpec): KimiEndpointClaim {
  const request = dereference(spec, requestSchema(spec, messagesPath));
  const model = object(schemaAt(spec, request, ["model"]));
  const values = z.array(z.string()).parse(model.enum);
  if (values.length !== 1 || values[0] !== "kimi-k3")
    throw new Error("Kimi Messages model scope changed");
  responseSchema(spec, messagesPath, "application/json");
  responseSchema(spec, messagesPath, "text/event-stream");
  return { name: "Anthropic Messages", path: messagesPath, modelIds: values };
}

function reviewEndpoint(
  input: OpenApiInput,
  reasonCode: string,
  claim: () => KimiEndpointClaim,
): KimiEndpointClaim[] {
  try {
    return [claim()];
  } catch (error) {
    input.onFinding?.(contractExtensionEvidence([`/paths/${reasonCode}`]));
    input.onReconciliation?.({
      disposition: "unbound",
      reason_code: reasonCode,
      sample: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

function regionKey(baseUrl: string): "china" | "international" {
  if (baseUrl === "https://api.moonshot.cn") return "china";
  if (baseUrl === "https://api.moonshot.ai") return "international";
  throw new Error(`Unsupported Kimi API origin: ${baseUrl}`);
}

function requestSchema(spec: JsonSpec, path: string): unknown {
  const post = object(property(object(property(spec.paths, path)), "post"));
  const requestBody = object(property(post, "requestBody"));
  const content = object(property(requestBody, "content"));
  return property(object(property(content, "application/json")), "schema");
}

function responseSchema(spec: JsonSpec, path: string, mediaType: string): unknown {
  const post = object(property(object(property(spec.paths, path)), "post"));
  const responses = object(property(post, "responses"));
  const success = object(property(responses, "200"));
  const content = object(property(success, "content"));
  return property(object(property(content, mediaType)), "schema");
}

function chatStreamingUsage(spec: JsonSpec): void {
  const request = object(requestSchema(spec, chatPath));
  const discriminator = object(property(request, "discriminator"));
  const mapping = object(property(discriminator, "mapping"));
  const refs = [
    ...new Set(Object.values(mapping).map((value) => referenceSchema.parse({ $ref: value }).$ref)),
  ];
  for (const ref of refs) {
    const requestComponent = object(dereference(spec, { $ref: ref }));
    const parts = z.array(z.unknown()).parse(requestComponent.allOf);
    const includeUsage = parts.flatMap((part) => {
      const reference = referenceSchema.safeParse(part);
      if (!reference.success) return [];
      const base = dereference(spec, reference.data);
      try {
        return [schemaAt(spec, base, ["stream_options", "include_usage"])];
      } catch {
        return [];
      }
    });
    if (includeUsage.length !== 1) throw new Error("Kimi Chat stream omitted include_usage");
    const field = object(includeUsage[0]);
    const description = String(field.description);
    if (
      field.type !== "boolean" ||
      !/(?:entire request|整个请求)/i.test(description) ||
      !/(?:interrupted|流中断)/i.test(description)
    )
      throw new Error("Kimi Chat stream usage scope changed");
  }
}

function integerField(
  spec: JsonSpec,
  schema: unknown,
  path: readonly string[],
  description?: RegExp,
): void {
  const field = object(schemaAt(spec, schema, path));
  if (field.type !== "integer") throw new Error(`Kimi usage field ${path.join(".")} changed`);
  if (description !== undefined && !description.test(String(field.description)))
    throw new Error(`Kimi usage field ${path.join(".")} semantics changed`);
}

function schemaAt(spec: JsonSpec, schema: unknown, path: readonly string[]): unknown {
  let current = dereferenceNonNull(spec, schema);
  for (const segment of path) {
    const properties = object(property(current, "properties"));
    current = dereferenceNonNull(spec, property(properties, segment));
  }
  return current;
}

function dereferenceNonNull(spec: JsonSpec, schema: unknown): unknown {
  const resolved = dereference(spec, schema);
  const variants = oneOf(resolved);
  if (variants.length === 0) return resolved;
  const nonNull = variants.filter((candidate) => object(candidate).type !== "null");
  if (nonNull.length !== 1) throw new Error("Kimi schema union is ambiguous");
  return dereference(spec, nonNull[0]);
}

function dereference(spec: JsonSpec, schema: unknown): unknown {
  const reference = referenceSchema.safeParse(schema);
  if (!reference.success) return schema;
  const name = reference.data.$ref.split("/").at(-1);
  if (name === undefined || spec.schemas[name] === undefined)
    throw new Error(`Kimi schema reference is missing: ${reference.data.$ref}`);
  return spec.schemas[name];
}

function property(value: unknown, key: string): unknown {
  const result = object(value)[key];
  if (result === undefined) throw new Error(`Kimi schema omitted ${key}`);
  return result;
}

function oneOf(value: unknown): unknown[] {
  const variants = object(value).oneOf;
  return variants === undefined ? [] : z.array(z.unknown()).parse(variants);
}

function object(value: unknown): Record<string, unknown> {
  return objectSchema.parse(value);
}

function normalizePath(path: string): string {
  return path.replace(/\/$/, "");
}
