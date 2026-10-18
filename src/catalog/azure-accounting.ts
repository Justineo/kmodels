import { load } from "cheerio";
import { linkedBundleSchema } from "./bundle.ts";
import { finalizePricingInputs } from "./pricing-input.ts";
import type { SourcePricingInputFact } from "./pricing-source.ts";
import { contractExtensionEvidence } from "./source-contract.ts";
import type { SourceParseInput as Input, SourceParseResult } from "./source-parse.ts";

interface SchemaContract {
  document: string;
  schema: string;
  property: string;
  key: string;
  channel: SourcePricingInputFact["channel"];
  pointer: string;
  availability: SourcePricingInputFact["availability"];
  reduction?: SourcePricingInputFact["reduction"];
  absentValue?: "zero";
  type: "integer" | "number" | "array" | "enum";
  nested: boolean;
}

const chatDocument = "/azureopenai/chat";
const responseDocument = "/azureopenai/responses";
const batchDocument = "/azureopenai/batch";
const embeddingDocument = "/azureopenai/embeddings";
const mediaDocument = "/azure/foundry/openai/reference-preview-latest";
const cacheDocument = "/azure/foundry/openai/how-to/prompt-caching";

const responseContracts: readonly SchemaContract[] = [
  schemaContract(
    chatDocument,
    "openaicompletionusage",
    "prompt_tokens",
    "chat.input_tokens",
    "/usage/prompt_tokens",
  ),
  schemaContract(
    chatDocument,
    "openaicompletionusageprompttokensdetails",
    "cached_tokens",
    "chat.cached_input_tokens",
    "/usage/prompt_tokens_details/cached_tokens",
    { absentValue: "zero" },
  ),
  schemaContract(
    chatDocument,
    "openaicompletionusage",
    "completion_tokens",
    "chat.output_tokens",
    "/usage/completion_tokens",
  ),
  schemaContract(
    chatDocument,
    "openaicompletionusageprompttokensdetails",
    "audio_tokens",
    "chat.input_audio_tokens",
    "/usage/prompt_tokens_details/audio_tokens",
    { absentValue: "zero" },
  ),
  schemaContract(
    chatDocument,
    "openaicompletionusagecompletiontokensdetails",
    "audio_tokens",
    "chat.output_audio_tokens",
    "/usage/completion_tokens_details/audio_tokens",
    { absentValue: "zero" },
  ),
  schemaContract(
    responseDocument,
    "openairesponseusage",
    "input_tokens",
    "responses.input_tokens",
    "/usage/input_tokens",
  ),
  schemaContract(
    responseDocument,
    "openairesponseusageinputtokensdetails",
    "cached_tokens",
    "responses.cached_input_tokens",
    "/usage/input_tokens_details/cached_tokens",
  ),
  schemaContract(
    responseDocument,
    "openairesponseusage",
    "output_tokens",
    "responses.output_tokens",
    "/usage/output_tokens",
  ),
  schemaContract(
    responseDocument,
    "openairesponseusageoutputtokensdetails",
    "reasoning_tokens",
    "responses.reasoning_tokens",
    "/usage/output_tokens_details/reasoning_tokens",
  ),
  schemaContract(
    batchDocument,
    "openaibatchusage",
    "input_tokens",
    "batch.input_tokens",
    "/usage/input_tokens",
    {
      channel: "result",
    },
  ),
  schemaContract(
    batchDocument,
    "openaibatchusageinputtokensdetails",
    "cached_tokens",
    "batch.cached_input_tokens",
    "/usage/input_tokens_details/cached_tokens",
    { channel: "result" },
  ),
  schemaContract(
    batchDocument,
    "openaibatchusage",
    "output_tokens",
    "batch.output_tokens",
    "/usage/output_tokens",
    {
      channel: "result",
    },
  ),
  schemaContract(
    batchDocument,
    "openaibatchusageoutputtokensdetails",
    "reasoning_tokens",
    "batch.reasoning_tokens",
    "/usage/output_tokens_details/reasoning_tokens",
    { channel: "result" },
  ),
  schemaContract(
    embeddingDocument,
    "openaicreateembeddingresponseusage",
    "prompt_tokens",
    "embeddings.input_tokens",
    "/usage/prompt_tokens",
  ),
  schemaContract(mediaDocument, "azureimagesresponse", "data", "images.generated_images", "/data", {
    availability: "success_only",
    reduction: { kind: "array_length" },
    type: "array",
  }),
  schemaContract(mediaDocument, "azureimagesresponse", "quality", "images.quality", "/quality", {
    availability: "conditional",
    type: "enum",
  }),
  schemaContract(mediaDocument, "azureimagesresponse", "size", "images.resolution", "/size", {
    availability: "conditional",
    type: "enum",
  }),
  schemaContract(
    mediaDocument,
    "azureimagesresponse",
    "input_tokens",
    "images.input_tokens",
    "/usage/input_tokens",
    { availability: "conditional", nested: true },
  ),
  schemaContract(
    mediaDocument,
    "azureimagesresponse",
    "text_tokens",
    "images.input_text_tokens",
    "/usage/input_tokens_details/text_tokens",
    { availability: "conditional", nested: true },
  ),
  schemaContract(
    mediaDocument,
    "azureimagesresponse",
    "image_tokens",
    "images.input_image_tokens",
    "/usage/input_tokens_details/image_tokens",
    { availability: "conditional", nested: true },
  ),
  schemaContract(
    mediaDocument,
    "azureimagesresponse",
    "output_tokens",
    "images.output_image_tokens",
    "/usage/output_tokens",
    { availability: "conditional", nested: true },
  ),
  schemaContract(
    mediaDocument,
    "azureaudiotranscriptionresponse",
    "duration",
    "audio.transcription_seconds",
    "/duration",
    { availability: "conditional", type: "number" },
  ),
  schemaContract(
    mediaDocument,
    "azureaudiotranslationresponse",
    "duration",
    "audio.translation_seconds",
    "/duration",
    { availability: "conditional", type: "number" },
  ),
  schemaContract(
    mediaDocument,
    "videogeneration",
    "n_seconds",
    "video.generated_seconds",
    "/n_seconds",
    {
      channel: "result",
      availability: "success_only",
    },
  ),
];

function schemaContract(
  document: string,
  schema: string,
  property: string,
  key: string,
  pointer: string,
  options: Partial<
    Pick<
      SchemaContract,
      "absentValue" | "availability" | "channel" | "reduction" | "type" | "nested"
    >
  > = {},
): SchemaContract {
  return {
    document,
    schema,
    property,
    key,
    channel: options.channel ?? "response",
    pointer,
    availability: options.availability ?? "terminal_only",
    type: options.type ?? "integer",
    nested: options.nested ?? false,
    ...(options.reduction === undefined ? {} : { reduction: options.reduction }),
    ...(options.absentValue === undefined ? {} : { absentValue: options.absentValue }),
  };
}

export function parseAzureAccounting(input: Input): SourceParseResult {
  if (input.source.extractor.kind !== "azure-accounting")
    throw new Error("Wrong Azure accounting extractor");

  const bundle = linkedBundleSchema.parse(JSON.parse(input.body));
  const bodies = new Map(
    [bundle.index, ...bundle.documents].map((document) => [
      accountingDocument(new URL(document.url).pathname),
      document.body,
    ]),
  );
  const facts = responseContracts.flatMap((contract) => {
    const body = bodies.get(contract.document);
    if (body === undefined || !schemaHasProperty(body, contract)) {
      input.onContractFinding?.(
        contractExtensionEvidence([
          `/documents${contract.document}/${contract.schema}/properties/${contract.property}`,
        ]),
      );
      return [];
    }
    return [pricingInput(input.source.id, contract)];
  });

  const chat = bodies.get(chatDocument);
  if (chatStreamContract(chat))
    facts.push(
      ...facts
        .filter(({ key, channel }) => key.startsWith("chat.") && channel === "response")
        .map((fact) => ({ ...fact, channel: "stream_event" as const })),
    );
  else
    input.onContractFinding?.(
      contractExtensionEvidence(["/documents/azureopenai/chat/stream-usage"]),
    );

  const cache = bodies.get(cacheDocument);
  if (cacheWriteContract(cache))
    facts.push({
      key: "chat.cache_write_tokens",
      channel: "response",
      locator: {
        kind: "json_pointer",
        value: "/usage/prompt_tokens_details/cache_write_tokens",
      },
      absent_value: "zero",
      availability: "terminal_only",
      source_ref: input.source.id,
    });
  else
    input.onContractFinding?.(
      contractExtensionEvidence([
        "/documents/azure/foundry/openai/how-to/prompt-caching/cache_write_tokens",
      ]),
    );

  if (facts.length === 0)
    throw new Error("Azure accounting contract contained no recognized pricing inputs");
  const expected =
    responseContracts.length +
    responseContracts.filter(({ document }) => document === chatDocument).length +
    1;
  const pricingInputs = finalizePricingInputs(
    facts,
    expected,
    "Azure pricing inputs",
    input.onPricingReconciliation,
  );

  return { models: [], pricing_inputs: pricingInputs };
}

function accountingDocument(pathname: string): string {
  return (
    [
      chatDocument,
      responseDocument,
      batchDocument,
      embeddingDocument,
      mediaDocument,
      cacheDocument,
    ].find((suffix) => pathname.endsWith(suffix)) ?? pathname
  );
}

function schemaHasProperty(body: string, contract: SchemaContract): boolean {
  const $ = load(body);
  const heading = $(`[id="${contract.schema}"]`);
  if (heading.length !== 1) return false;
  const table = heading.nextUntil("h2, h3").filter("table").first();
  const rows = table
    .find("tbody tr")
    .toArray()
    .filter((row) => {
      const name = normalize($(row).find("td").first().text());
      return (contract.nested ? name.replace(/^└─\s*/u, "") : name) === contract.property;
    });
  return (
    rows.length > 0 &&
    rows.every((row) => {
      const type = normalize($(row).find("td").eq(1).text());
      if (contract.type === "array") return /^array(?: of |$)/.test(type);
      if (contract.type === "enum") return /^enum(?: |$)/.test(type);
      return contract.type === "integer"
        ? /^integer(?: \((?:int32|int64)\))?(?: or null)?$/.test(type)
        : /^number(?: \((?:float|double)\))?(?: or null)?$/.test(type);
    })
  );
}

function chatStreamContract(body: string | undefined): boolean {
  if (body === undefined) return false;
  const text = normalize(load(body).text());
  return (
    text.includes("include_usage") &&
    text.includes("data: [DONE]") &&
    text.includes("stream is interrupted")
  );
}

function cacheWriteContract(body: string | undefined): boolean {
  if (body === undefined) return false;
  const text = normalize(load(body).text());
  return (
    text.includes("Standard pay-as-you-go deployments") &&
    text.includes("prompt_tokens_details") &&
    text.includes("cache_write_tokens")
  );
}

function pricingInput(sourceRef: string, contract: SchemaContract): SourcePricingInputFact {
  return {
    key: contract.key,
    channel: contract.channel,
    locator: { kind: "json_pointer", value: contract.pointer },
    ...(contract.reduction === undefined ? {} : { reduction: contract.reduction }),
    ...(contract.absentValue === undefined ? {} : { absent_value: contract.absentValue }),
    availability: contract.availability,
    source_ref: sourceRef,
  };
}

function normalize(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}
