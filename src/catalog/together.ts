import { z } from "zod";
import { hostedInferencePrice, hostedUsageRate, usdAmount } from "./hosted-usage-rate.ts";
import { modelIdSchema } from "./identity.ts";
import { markdownSection, markdownTableRows } from "./markdown.ts";
import { baseModel } from "./model.ts";
import { publishedRate, rawPricingFact, wholeTokenCount } from "./pricing.ts";
import type { ParsedProviderModel, SourcePriceFact } from "./pricing-source.ts";
import { assertItemCount, assertSourceConstraint, parseSourceJson } from "./source-contract.ts";
import type { SourceParseInput, SourceParseResult } from "./source-parse.ts";
import type { Modality, ModelTask } from "./schema.ts";

const sectionRoutes = [
  [
    "Chat models",
    "text_generation",
    "Chat completions",
    "/v1/chat/completions",
    ["text"],
    ["text"],
  ],
  [
    "Vision models",
    "text_generation",
    "Chat completions",
    "/v1/chat/completions",
    ["text", "image"],
    ["text"],
  ],
  [
    "Image models",
    "image_generation",
    "Image generation",
    "/v1/images/generations",
    ["text"],
    ["image"],
  ],
  ["Video models", "video_generation", "Video generation", "/v2/videos", [], ["video"]],
  ["Embedding models", "embeddings", "Embeddings", "/v1/embeddings", ["text"], ["embedding"]],
  ["Rerank models", "reranking", "Rerank", "/v1/rerank", ["text"], []],
  ["Moderation models", "moderation", "Moderation", "/v1/moderations", ["text"], []],
] as const satisfies readonly (readonly [
  string,
  ModelTask,
  string,
  string,
  readonly Modality[],
  readonly Modality[],
])[];

const inputColumn = "Input pricing (per 1M tokens)";
const cachedColumn = "Cached input pricing (per 1M tokens)";
const outputColumn = "Output pricing (per 1M tokens)";
const usdTokenUnit = "USD per 1M tokens";
const usdCell = /\\?\$((?:0|[1-9]\d*)(?:\.\d+)?)/u;
type Row = Map<string, string>;

function cell(row: Row, column: string): string {
  const value = row.get(column);
  if (!value) throw new Error(`Together model table omitted ${column}`);
  return value;
}

function section(input: SourceParseInput, heading: string): string {
  const body = markdownSection(input.body, 2, heading);
  assertSourceConstraint(`Together catalog omitted ${heading}`, body !== undefined, undefined);
  return body;
}

function togetherModel(input: SourceParseInput, row: Row, idColumn: string): ParsedProviderModel {
  const id = modelIdSchema.parse(cell(row, idColumn).replace(/^\x60(.*)\x60$/u, "$1"));
  const name = cell(row, "Model name").replace(/\\([[\]])/gu, "$1");
  return {
    ...baseModel({
      providerId: input.provider.id,
      id,
      name,
      sourceId: input.source.id,
      observedAt: input.observedAt,
    }),
    status: "active",
  };
}

function tokenRates(
  input: SourceParseInput,
  id: string,
  values: readonly [string, string | undefined, string | undefined],
  conditions: SourcePriceFact["conditions"],
  sectionName: string,
): SourcePriceFact[] {
  const [standard, cached, output] = values;
  const prices = [
    [
      "input_text",
      standard,
      cached === undefined || cached === "-" ? "input_tokens" : "uncached_input_tokens",
      "Input",
    ],
    ["cache_read_text", cached, "cached_input_tokens", "Cached input"],
    ["output_text", output, "output_tokens", "Output"],
  ] as const;
  return prices.flatMap(([meter, raw, signal, label]) => {
    if (raw === undefined || raw === "-") return [];
    const amount = usdAmount(raw);
    assertSourceConstraint("Together token price changed format", amount !== undefined, undefined);
    return [
      hostedUsageRate(
        publishedRate(meter, amount, "million_tokens", input.source.id, usdTokenUnit, conditions),
        { kind: "table", value: `${sectionName}/${id}/${label}` },
        signal,
      ),
    ];
  });
}

function mediaPrice(
  model: ParsedProviderModel,
  row: Row,
  sourceId: string,
  task: "image_generation" | "video_generation",
): void {
  const unit = task === "image_generation" ? cell(row, "Unit").replaceAll("\x60", "") : "video";
  const price = cell(row, task === "image_generation" ? "Price" : "Price per video");
  const amount = usdAmount(price);
  if (unit === "megapixel" && amount !== undefined) {
    // The headline amount is subject to Together's step-count formula.
    model.raw_price_facts.push(
      rawPricingFact(sourceId, task, "base_price", "requires_usage_aggregation", {
        amount: price,
        unit,
        formula:
          "Output megapixels multiplied by the requested-to-default step ratio when above the default step count",
      }),
    );
    return;
  }
  model.raw_price_facts.push(
    rawPricingFact(sourceId, task, "base_price", "unknown_applicability", {
      amount: price,
      unit,
      ...(row.has("Resolution / duration") ? { fragment: cell(row, "Resolution / duration") } : {}),
    }),
  );
}

function audioModel(input: SourceParseInput, row: Row): ParsedProviderModel {
  const model = togetherModel(input, row, "Model string for API");
  const modality = cell(row, "Modality");
  const speech = modality === "Text-to-Speech";
  assertSourceConstraint(
    "Unknown Together audio modality",
    speech || modality === "Speech-to-Text",
    undefined,
  );
  model.tasks = speech ? ["speech_synthesis"] : ["transcription"];
  model.modalities = speech
    ? { input: ["text"], output: ["audio"] }
    : { input: ["audio"], output: ["text"] };
  model.api_endpoints = speech
    ? [{ name: "Text to speech", path: "/v1/audio/speech" }]
    : [{ name: "Transcriptions", path: "/v1/audio/transcriptions" }];
  const raw = cell(row, "Pricing");
  const amount = raw.match(usdCell)?.[1];
  if (raw === "-") return model;
  if (amount !== undefined && speech && /^\\?\$[\d.]+ per 1M chars$/u.test(raw)) {
    model.price_facts.push(
      hostedUsageRate(
        publishedRate(
          "input_text",
          amount,
          "million_characters",
          input.source.id,
          "USD per 1M chars",
        ),
        { kind: "table", value: `Audio models/${model.model_id}/Pricing` },
        "input_characters",
      ),
    );
  } else if (amount !== undefined && !speech && /^\\?\$[\d.]+ per audio min$/u.test(raw)) {
    model.price_facts.push(
      hostedUsageRate(
        publishedRate("input_audio", amount, "minute", input.source.id, "USD per audio minute"),
        { kind: "table", value: `Audio models/${model.model_id}/Pricing` },
        "processed_audio_seconds",
      ),
    );
  } else {
    model.raw_price_facts.push(
      rawPricingFact(input.source.id, "audio", "base_price", "unsupported_structure", raw),
    );
  }
  return model;
}

export function parseTogetherServerless(input: SourceParseInput): SourceParseResult {
  const models = new Map<string, ParsedProviderModel>();
  const usPrices = new Map<string, Row>();
  const usSection = markdownSection(input.body, 2, "US-only inference");
  if (usSection !== undefined) {
    for (const row of markdownTableRows(usSection, ["Model", "Input", "Cached input", "Output"])) {
      const label = cell(row, "Model").match(/^(.+) \(US-only\)$/u)?.[1];
      assertSourceConstraint(
        "Invalid or repeated Together US model label",
        label !== undefined && !usPrices.has(label),
        undefined,
      );
      usPrices.set(label, row);
    }
  }
  const boundUs = new Set<string>();
  for (const [heading, task, endpoint, path, inputs, outputs] of sectionRoutes) {
    const body = section(input, heading);
    if (
      /^\s*There are currently no (?:embedding|rerank|moderation) models offered via serverless\./u.test(
        body,
      )
    )
      continue;
    const isText = task === "text_generation";
    const isMedia = task === "image_generation" || task === "video_generation";
    const idColumn = isMedia ? "Model string for API" : "API model string";
    const columns = [
      "Model name",
      idColumn,
      ...(isText ? ["Context length", inputColumn, outputColumn] : []),
    ];
    const rows = markdownTableRows(body, columns);
    const sectionIds = new Set<string>();
    for (const row of rows) {
      const model = togetherModel(input, row, idColumn);
      const id = model.model_id;
      assertSourceConstraint(
        "Together catalog repeated an ID within a model table",
        !sectionIds.has(id),
        undefined,
      );
      sectionIds.add(id);
      model.tasks = [task];
      model.modalities = { input: [...inputs], output: [...outputs] };
      model.api_endpoints = [{ name: endpoint, path }];
      if (isText) {
        const context = cell(row, "Context length");
        const count = wholeTokenCount(context);
        assertSourceConstraint(
          "Together context length changed format",
          count !== undefined || context === "-",
          undefined,
        );
        if (count !== undefined) model.limits.context_tokens = count;
        for (const [column, capability] of [
          ["Function calling", "tool_call"],
          ["Structured outputs", "structured_output"],
        ] as const) {
          const value = row.get(column);
          if (value === "Yes" || value === "No") model.capabilities[capability] = value === "Yes";
        }
        const existing = models.get(id);
        if (existing !== undefined) {
          assertSourceConstraint(
            "Together vision and chat catalog facts disagree",
            heading === "Vision models" &&
              existing.name === model.name &&
              existing.limits.context_tokens === count &&
              [inputColumn, outputColumn].every((column) => {
                const meter = column === inputColumn ? "input_text" : "output_text";
                const previous = existing.price_facts.find((rate) => rate.meter === meter);
                return previous?.price === usdAmount(cell(row, column));
              }),
            id,
          );
          existing.modalities.input = [...new Set([...existing.modalities.input, ...inputs])];
          continue;
        }
        const us = usPrices.get(model.name);
        const conditions = us === undefined ? {} : { endpoint: "api.together.ai" };
        const cached = row.get(cachedColumn);
        if (cached !== undefined && cached !== "-") model.capabilities.prompt_cache = true;
        model.price_facts = tokenRates(
          input,
          id,
          [cell(row, inputColumn), cached, cell(row, outputColumn)],
          conditions,
          heading,
        );
        if (us !== undefined) {
          assertSourceConstraint(
            "Together US label matched multiple models",
            !boundUs.has(model.name),
            undefined,
          );
          boundUs.add(model.name);
          model.price_facts.push(
            ...tokenRates(
              input,
              id,
              [cell(us, "Input"), cell(us, "Cached input"), cell(us, "Output")],
              { endpoint: "us-api.together.ai" },
              "US-only inference",
            ),
          );
        }
      } else if (isMedia) {
        mediaPrice(model, row, input.source.id, task);
      }
      assertSourceConstraint(
        "Together catalog assigned one ID to multiple product tables",
        !models.has(id),
        undefined,
      );
      models.set(id, model);
    }
  }
  for (const row of markdownTableRows(section(input, "Audio models"), [
    "Model name",
    "Model string for API",
    "Modality",
    "Pricing",
  ])) {
    const model = audioModel(input, row);
    assertSourceConstraint(
      "Together catalog repeated an audio ID",
      !models.has(model.model_id),
      undefined,
    );
    models.set(model.model_id, model);
  }
  assertSourceConstraint(
    "Together US prices did not match the serverless catalog",
    boundUs.size === usPrices.size,
    undefined,
  );
  assertItemCount("Together serverless models", models.size, 1, 500);
  const published = [...models.values()];
  return {
    models: published,
    inference_prices: published
      .filter((model) => model.price_facts.length > 0 || model.raw_price_facts.length > 0)
      .map((model) =>
        hostedInferencePrice(model, input.source.id, { kind: "table", value: model.model_id }),
      ),
  };
}

const apiModels = z
  .array(
    z.object({
      id: modelIdSchema,
      context_length: z.number().int().nonnegative().nullish(),
    }),
  )
  .min(1)
  .max(5_000);

export function parseTogetherApi(input: SourceParseInput): ParsedProviderModel[] {
  const rows = apiModels.parse(parseSourceJson(input.body, "Together models API"));
  assertSourceConstraint(
    "Together models API repeated a model ID",
    new Set(rows.map(({ id }) => id)).size === rows.length,
    undefined,
  );
  return rows.map(({ id, context_length }) => ({
    ...baseModel({
      providerId: input.provider.id,
      id,
      name: id,
      sourceId: input.source.id,
      observedAt: input.observedAt,
    }),
    limits: context_length ? { context_tokens: context_length } : {},
  }));
}
