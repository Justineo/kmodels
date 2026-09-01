import { load } from "cheerio";
import { z } from "zod";
import { linkedBundleSchema, linkedDocumentBody } from "./bundle.ts";
import { modelIdSchema } from "./identity.ts";
import { apiEndpointKey, baseModel } from "./model.ts";
import type { SourceManifest } from "./manifests.ts";
import type { PricingReconciliationItem } from "./pricing-reconciliation.ts";
import { orderedTasks } from "./task.ts";
import { multiplyDecimal, publishedRate, rawPricingFact, scaleDecimal } from "./pricing.ts";
import type {
  ParsedProviderModel as ProviderModel,
  SourcePriceFact,
  SourceRawPricingFact,
} from "./pricing-source.ts";
import {
  assertItemCount,
  contractExtensionEvidence,
  recognizeItems,
  type SourceContractEvidence,
} from "./source-contract.ts";
import { extractXaiCommercialFacts, type XaiCommercialEvidence } from "./xai-commercial-source.ts";
import {
  modalitySchema,
  type Modality,
  type ModelTask,
  type Provider,
  unknownCapabilities,
} from "./schema.ts";

interface ParseInput {
  provider: Provider;
  source: SourceManifest;
  body: string;
  observedAt: string;
  onContractFinding?: (item: SourceContractEvidence) => void;
  onPricingReconciliation?: (item: PricingReconciliationItem) => void;
}

type ApiEndpoint = NonNullable<ProviderModel["api_endpoints"]>[number];

const integerString = z.string().regex(/^\d+$/);
const upperModalitySchema = z.enum(["TEXT", "IMAGE", "AUDIO", "VIDEO"]);
const aliasesSchema = z.array(modelIdSchema).default([]);
const commonModelShape = {
  name: modelIdSchema,
  version: z.string().min(1),
  inputModalities: z.array(upperModalitySchema).min(1),
  outputModalities: z.array(upperModalitySchema).min(1),
  aliases: aliasesSchema,
};
const languageModelSchema = z.object({
  ...commonModelShape,
  promptTextTokenPrice: integerString,
  promptImageTokenPrice: integerString,
  promptTextTokenPriceLongContext: integerString,
  cachedPromptTokenPrice: integerString,
  cachedPromptTokenPriceLongContext: integerString,
  completionTextTokenPrice: integerString,
  completionTokenPriceLongContext: integerString,
  maxPromptLength: z.number().int().positive(),
  longContextThreshold: integerString.default("0"),
  features: z
    .object({
      functionCalling: z.boolean().optional(),
      structuredOutputs: z.boolean().optional(),
      reasoning: z.boolean().optional(),
      reasoningEffortOptions: z
        .object({
          supportedEfforts: z.array(z.string().min(1)).min(1),
          defaultEffort: z.string().min(1),
        })
        .strip()
        .optional(),
    })
    .strip()
    .default({}),
});
const embeddingModelSchema = z.object({
  name: modelIdSchema,
  version: z.string().min(1),
  inputModalities: z.array(upperModalitySchema).min(1),
  aliases: aliasesSchema,
  promptTextTokenPrice: integerString,
  promptImageTokenPrice: integerString,
});
const imageModelSchema = z.object({
  ...commonModelShape,
  imagePrice: integerString.optional(),
  resolutionPricing: z
    .array(
      z
        .object({
          resolution: z.string().regex(/^IMAGE_RESOLUTION_[A-Z0-9]+$/u),
          pricePerImage: integerString,
          quality: z.string().min(1).optional(),
        })
        .strip(),
    )
    .min(1),
  pricePerInputImage: integerString.optional(),
});
const voiceEndpointSchema = z.discriminatedUnion("endpoint", [
  z
    .object({
      endpoint: z.literal("TTS"),
      basis: z.literal("REQUEST_RATE"),
      pricing: z.object({ perCharacter: integerString }),
    })
    .strip(),
  z
    .object({
      endpoint: z.literal("STT"),
      basis: z.literal("REQUEST_RATE"),
      pricing: z
        .object({
          perAudioSecond: integerString,
          perAudioSecondStreaming: integerString,
        })
        .strip(),
    })
    .strip(),
  z
    .object({
      endpoint: z.literal("REALTIME"),
      basis: z.literal("CONCURRENCY"),
      pricing: z
        .object({
          pstnMinutePrice: integerString.optional(),
          realtimeAudioSecondPrice: integerString,
          realtimeTextInputPrice: integerString,
        })
        .strip(),
    })
    .strip(),
]);
const voiceServiceSchema = z.object({
  ...commonModelShape,
  endpoints: z.array(voiceEndpointSchema).length(1),
});
const videoModelSchema = z.object({
  ...commonModelShape,
  resolutionPricing: z
    .array(
      z
        .object({
          resolution: z.string().regex(/^VIDEO_RESOLUTION_[A-Z0-9]+$/u),
          pricePerSecond: integerString,
        })
        .strip(),
    )
    .min(1),
  pricePerInputImage: integerString.optional(),
  pricePerInputVideoSecond: integerString.optional(),
});
const clusterSchema = z
  .object({
    clusterName: z.string().min(1),
    languageModels: z.array(languageModelSchema).default([]),
    embeddingModels: z.array(embeddingModelSchema).default([]),
    imageGenerationModels: z.array(imageModelSchema).default([]),
    audioModels: z.array(voiceServiceSchema).default([]),
    videoGenerationModels: z.array(videoModelSchema).default([]),
  })
  .strip();
const publicModelsEnvelopeSchema = z.object({
  clusterConfigs: z.array(z.record(z.string(), z.unknown())).min(1),
});
type PublicModels = { clusterConfigs: Array<z.infer<typeof clusterSchema>> };
const modelCategoryKeys = new Set([
  "languageModels",
  "embeddingModels",
  "imageGenerationModels",
  "audioModels",
  "videoGenerationModels",
]);
const publicModelFieldEntries = [
  [
    "languageModels",
    new Set([
      ...Object.keys(commonModelShape),
      "algorithm",
      "batchDiscountPercent",
      "cachedPromptTokenPrice",
      "cachedPromptTokenPriceLongContext",
      "cluster",
      "completionTextTokenPrice",
      "completionTokenPriceLongContext",
      "features",
      "longContextThreshold",
      "maxPromptLength",
      "promptImageTokenPrice",
      "promptTextTokenPrice",
      "promptTextTokenPriceLongContext",
      "provisionedThroughput",
      "rateLimits",
      "rpm",
      "rps",
      "tpm",
    ]),
  ],
  [
    "embeddingModels",
    new Set([
      "name",
      "version",
      "inputModalities",
      "aliases",
      "algorithm",
      "cluster",
      "promptTextTokenPrice",
      "promptImageTokenPrice",
      "provisionedThroughput",
      "rateLimits",
      "rpm",
      "rps",
      "tpm",
    ]),
  ],
  [
    "imageGenerationModels",
    new Set([
      ...Object.keys(commonModelShape),
      "cluster",
      "imagePrice",
      "pricePerInputImage",
      "rateLimits",
      "resolutionPricing",
      "rpm",
      "rps",
    ]),
  ],
  ["audioModels", new Set([...Object.keys(commonModelShape), "cluster", "endpoints"])],
  [
    "videoGenerationModels",
    new Set([
      ...Object.keys(commonModelShape),
      "cluster",
      "pricePerInputImage",
      "pricePerInputVideoSecond",
      "resolutionPricing",
      "rpm",
      "rps",
    ]),
  ],
] as const;
const voiceEndpointFields = new Set<string>([
  "endpoint",
  "basis",
  "concurrentSessions",
  "pricing",
  "rpm",
  "rps",
  "tiers",
]);
const voiceTierFields = new Set<string>(["tier", "concurrentSessions", "rpm", "rps"]);
const voicePricingFieldEntries = [
  ["TTS", new Set<string>(["perCharacter"])],
  ["STT", new Set<string>(["perAudioSecond", "perAudioSecondStreaming"])],
  [
    "REALTIME",
    new Set<string>([
      "pstnMinutePrice",
      "realtimeAudioSecondPrice",
      "realtimeAudioTokenPrice",
      "realtimeTextInputPrice",
    ]),
  ],
] as const;

const apiPriceSchema = z.number().int().nonnegative();
const imagePricingSchema = z
  .array(
    z
      .object({
        price_per_image: apiPriceSchema,
        quality: z.string().min(1),
        resolution: z.string().min(1),
      })
      .strip(),
  )
  .min(1)
  .optional();
const apiItemShape = {
  id: modelIdSchema,
  aliases: z.array(modelIdSchema),
  context_length: z.number().int().positive().nullable().optional(),
  created: z.number().int().nonnegative(),
  object: z.literal("model"),
  owned_by: z.string().min(1),
  prompt_text_token_price: apiPriceSchema.nullable().optional(),
  cached_prompt_text_token_price: apiPriceSchema.nullable().optional(),
  prompt_image_token_price: apiPriceSchema.nullable().optional(),
  completion_text_token_price: apiPriceSchema.nullable().optional(),
  prompt_text_token_price_long_context: apiPriceSchema.nullable().optional(),
  cached_prompt_text_token_price_long_context: apiPriceSchema.nullable().optional(),
  completion_text_token_price_long_context: apiPriceSchema.nullable().optional(),
  long_context_threshold: z.number().int().nonnegative().nullable().optional(),
  image_price: apiPriceSchema.nullable().optional(),
  pricing: imagePricingSchema,
} as const;
const apiItemSchema = z.object(apiItemShape).strip();
const apiListSchema = z
  .object({ data: z.array(z.unknown()).min(1), object: z.literal("list") })
  .strip();
const detailedApiShape = {
  id: modelIdSchema,
  aliases: z.array(modelIdSchema),
  fingerprint: z.string().min(1),
  created: z.number().int().nonnegative(),
  object: z.literal("model"),
  owned_by: z.string().min(1),
  version: z.string().min(1),
  input_modalities: z.array(modalitySchema).min(1),
  output_modalities: z.array(modalitySchema).min(1),
};
const languageApiSchema = z
  .object({
    ...detailedApiShape,
    prompt_text_token_price: apiPriceSchema,
    cached_prompt_text_token_price: apiPriceSchema,
    prompt_image_token_price: apiPriceSchema,
    completion_text_token_price: apiPriceSchema,
    search_price: apiPriceSchema,
    prompt_text_token_price_long_context: apiPriceSchema,
    cached_prompt_text_token_price_long_context: apiPriceSchema,
    completion_text_token_price_long_context: apiPriceSchema,
    long_context_threshold: apiPriceSchema,
  })
  .strip();
const imageApiSchema = z
  .object({
    ...detailedApiShape,
    image_price: apiPriceSchema,
    max_prompt_length: z.number().int().positive(),
    pricing: imagePricingSchema,
  })
  .strip();
const videoApiSchema = z.object(detailedApiShape).strip();

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function upperModalities(values: z.infer<typeof upperModalitySchema>[]): Modality[] {
  return unique(
    values.map((value) => {
      switch (value) {
        case "TEXT":
          return "text";
        case "IMAGE":
          return "image";
        case "AUDIO":
          return "audio";
        case "VIDEO":
          return "video";
      }
    }),
  );
}

function model(input: ParseInput, id: string, values: Partial<ProviderModel>): ProviderModel {
  return {
    ...baseModel({
      providerId: input.provider.id,
      id,
      ...(values.version === undefined ? {} : { version: values.version }),
      name: values.name ?? id,
      sourceId: input.source.id,
      observedAt: input.observedAt,
    }),
    ...values,
  };
}

function reviewClaim<Value>(
  input: ParseInput,
  reasonCode: string,
  claim: () => Value,
): Value | undefined {
  try {
    return claim();
  } catch (error) {
    input.onPricingReconciliation?.({
      disposition: "unbound",
      reason_code: reasonCode,
      sample: (error instanceof Error ? error.message : String(error)).slice(0, 256),
    });
    return;
  }
}

function pricingWarning(termKey: string, fragment: string, sourceId: string): SourceRawPricingFact {
  return rawPricingFact(
    sourceId,
    termKey,
    "informational",
    "superseded_value",
    fragment,
    {},
    "prefer_exact_scoped_rate",
  );
}

function exactRate(
  meter: SourcePriceFact["meter"],
  raw: string,
  places: number,
  unit: SourcePriceFact["unit"],
  sourceId: string,
  rawUnit: string,
  conditions: SourcePriceFact["conditions"] = {},
): SourcePriceFact {
  return {
    ...publishedRate(meter, scaleDecimal(raw, -places), unit, sourceId, rawUnit, conditions),
    raw_price: raw,
  };
}

function tierRate(
  rate: SourcePriceFact,
  multiplier: string,
  tier: string,
  label: string,
): SourcePriceFact {
  return {
    ...rate,
    price: multiplyDecimal(rate.price, multiplier),
    conditions: { ...rate.conditions, service_tier: tier },
    derived: true,
    derivation: `${label} × ${multiplier}`,
  };
}

function textRates(
  value: z.infer<typeof languageModelSchema>,
  sourceId: string,
  published: TextPrice[] | undefined,
  batchSupported: boolean,
  batchMultiplier: string | undefined,
  priorityMultiplier: string | undefined,
): SourcePriceFact[] {
  const threshold = Number(value.longContextThreshold);
  const standard = threshold > 0 ? { context_max_tokens: threshold - 1 } : {};
  const long = threshold > 0 ? { context_min_tokens: threshold } : {};
  const shortRow = published?.find((row) => !row.long);
  const longRow = published?.find((row) => row.long);
  const rate = (
    meter: SourcePriceFact["meter"],
    raw: string,
    amount: string | undefined,
    conditions: SourcePriceFact["conditions"],
  ): SourcePriceFact =>
    amount === undefined
      ? exactRate(meter, raw, 4, "million_tokens", sourceId, "USD cents / 100M tokens", conditions)
      : publishedRate(meter, amount, "million_tokens", sourceId, "USD / 1M tokens", conditions);
  const rates = [
    rate("input_text", value.promptTextTokenPrice, shortRow?.input, standard),
    rate("input_image", value.promptImageTokenPrice, undefined, standard),
    rate("cache_read_text", value.cachedPromptTokenPrice, shortRow?.cached, standard),
    rate("output_text", value.completionTextTokenPrice, shortRow?.output, standard),
  ];
  if (threshold > 0)
    rates.push(
      rate("input_text", value.promptTextTokenPriceLongContext, longRow?.input, long),
      rate("input_image", value.promptTextTokenPriceLongContext, undefined, long),
      rate("cache_read_text", value.cachedPromptTokenPriceLongContext, longRow?.cached, long),
      rate("output_text", value.completionTokenPriceLongContext, longRow?.output, long),
    );
  const priority =
    priorityMultiplier === undefined
      ? []
      : rates.map((item) => tierRate(item, priorityMultiplier, "priority", "standard token price"));
  const batch = batchSupported
    ? rates.map((item) =>
        tierRate(
          item,
          batchMultiplier ?? "1",
          "batch",
          batchMultiplier === undefined
            ? "Batch models not listed for a discount use standard token price"
            : "standard token price",
        ),
      )
    : [];
  return [...rates, ...batch, ...priority];
}

function mediaRate(
  meter: SourcePriceFact["meter"],
  raw: string,
  unit: SourcePriceFact["unit"],
  sourceId: string,
  conditions: SourcePriceFact["conditions"] = {},
): SourcePriceFact {
  return exactRate(meter, raw, 10, unit, sourceId, "USD ticks", conditions);
}

function embeddedModels(input: ParseInput, body: string): PublicModels {
  const $ = load(body);
  const prefix = "globalThis.__XAI_PUBLIC_MODELS__=";
  const scripts = $("script")
    .toArray()
    .map((element) => $(element).text().trim())
    .filter((text) => text.startsWith(prefix));
  if (scripts.length !== 1) throw new Error("xAI catalog requires one public models payload");
  const script = scripts[0];
  if (script === undefined || !script.endsWith(";"))
    throw new Error("xAI public models payload was malformed");
  const value: unknown = JSON.parse(script.slice(prefix.length, -1));
  const envelope = publicModelsEnvelopeSchema.parse(value);
  const root = z.record(z.string(), z.unknown()).parse(value);
  const unknownCategories = unique(
    envelope.clusterConfigs.flatMap((cluster) =>
      Object.keys(cluster).filter((key) => key.endsWith("Models") && !modelCategoryKeys.has(key)),
    ),
  );
  const findings = [
    ...Object.keys(root)
      .filter((key) => key !== "clusterConfigs")
      .map((key) => `/${key}`),
    ...unknownCategories.map((category) => `/clusterConfigs/*/${category}`),
  ];
  for (const cluster of envelope.clusterConfigs)
    for (const [category, allowed] of publicModelFieldEntries) {
      const items = z.array(z.record(z.string(), z.unknown())).default([]).parse(cluster[category]);
      const unknownFields = unique(
        items.flatMap((item) => Object.keys(item).filter((key) => !allowed.has(key))),
      );
      findings.push(...unknownFields.map((field) => `/clusterConfigs/*/${category}/*/${field}`));
      if (category === "languageModels")
        for (const item of items) {
          const features = z.record(z.string(), z.unknown()).default({}).parse(item["features"]);
          findings.push(
            ...Object.keys(features)
              .filter(
                (key) =>
                  ![
                    "functionCalling",
                    "structuredOutputs",
                    "reasoning",
                    "reasoningEffortOptions",
                  ].includes(key),
              )
              .map((field) => `/clusterConfigs/*/languageModels/*/features/${field}`),
          );
        }
      if (category === "imageGenerationModels" || category === "videoGenerationModels")
        for (const item of items) {
          const rows = z
            .array(z.record(z.string(), z.unknown()))
            .default([])
            .parse(item["resolutionPricing"]);
          const allowedRowFields =
            category === "imageGenerationModels"
              ? new Set(["resolution", "pricePerImage", "quality"])
              : new Set(["resolution", "pricePerSecond"]);
          findings.push(
            ...unique(
              rows.flatMap((row) => Object.keys(row).filter((key) => !allowedRowFields.has(key))),
            ).map((field) => `/clusterConfigs/*/${category}/*/resolutionPricing/*/${field}`),
          );
        }
      if (category !== "audioModels") continue;
      for (const item of items) {
        const endpoints = z.array(z.record(z.string(), z.unknown())).parse(item["endpoints"]);
        for (const endpoint of endpoints) {
          const unknownEndpointFields = Object.keys(endpoint).filter(
            (key) => !voiceEndpointFields.has(key),
          );
          findings.push(
            ...unknownEndpointFields.map(
              (field) => `/clusterConfigs/*/audioModels/*/endpoints/*/${field}`,
            ),
          );
          const endpointName = z.string().parse(endpoint["endpoint"]);
          const pricingFields = voicePricingFieldEntries.find(
            ([candidate]) => candidate === endpointName,
          )?.[1];
          if (pricingFields === undefined) continue;
          const pricing = z.record(z.string(), z.unknown()).parse(endpoint["pricing"]);
          const unknownPricingFields = Object.keys(pricing).filter(
            (key) => !pricingFields.has(key),
          );
          findings.push(
            ...unknownPricingFields.map(
              (field) => `/clusterConfigs/*/audioModels/*/endpoints/*/pricing/${field}`,
            ),
          );
          const tiers = z
            .array(z.record(z.string(), z.unknown()))
            .default([])
            .parse(endpoint["tiers"]);
          const unknownTierFields = unique(
            tiers.flatMap((tier) => Object.keys(tier).filter((key) => !voiceTierFields.has(key))),
          );
          findings.push(
            ...unknownTierFields.map(
              (field) => `/clusterConfigs/*/audioModels/*/endpoints/*/tiers/*/${field}`,
            ),
          );
        }
      }
    }
  if (findings.length > 0) input.onContractFinding?.(contractExtensionEvidence(findings));
  return {
    clusterConfigs: recognizeItems({
      label: "xAI public model clusters",
      items: envelope.clusterConfigs,
      schema: clusterSchema,
      rootKeys: [
        "clusterName",
        "languageModels",
        "embeddingModels",
        "imageGenerationModels",
        "audioModels",
        "videoGenerationModels",
      ],
      skipInvalidItems: true,
      ...(input.onContractFinding === undefined ? {} : { onFinding: input.onContractFinding }),
    }),
  };
}

function distinct<T extends { name: string }>(values: T[], category: string): T[] {
  const models = new Map<string, T>();
  for (const value of values) {
    const current = models.get(value.name);
    if (current !== undefined && JSON.stringify(current) !== JSON.stringify(value))
      throw new Error(`xAI ${category} model differs across public clusters`);
    models.set(value.name, value);
  }
  return [...models.values()];
}

function modelRegions(catalog: PublicModels): Map<string, string[]> {
  const regions = new Map<string, string[]>();
  for (const cluster of catalog.clusterConfigs) {
    const models = [
      ...cluster.languageModels,
      ...cluster.embeddingModels,
      ...cluster.imageGenerationModels,
      ...cluster.audioModels,
      ...cluster.videoGenerationModels,
    ];
    for (const value of models)
      regions.set(value.name, unique([...(regions.get(value.name) ?? []), cluster.clusterName]));
  }
  return regions;
}

function regionalRates(rates: SourcePriceFact[], regions: string[]): SourcePriceFact[] {
  if (regions.length === 0) throw new Error("xAI priced model omitted its public region");
  return regions.flatMap((region) =>
    rates.map((rate) => ({
      ...rate,
      conditions: { ...rate.conditions, region },
    })),
  );
}

function companion(bundle: z.infer<typeof linkedBundleSchema>, pathname: string): string {
  return linkedDocumentBody(bundle, pathname, `xAI bundle requires exactly one ${pathname}`);
}

function section(body: string, pathname: string): string {
  const marker = `===${pathname}===`;
  const start = body.indexOf(marker);
  if (start < 0 || body.indexOf(marker, start + marker.length) >= 0)
    throw new Error(`xAI llms.txt requires one ${pathname} section`);
  const end = body.indexOf("\n\n===", start + marker.length);
  return body.slice(start + marker.length, end < 0 ? undefined : end).trim();
}

const generalApiFields = [
  "aliases",
  "cached_prompt_text_token_price",
  "cached_prompt_text_token_price_long_context",
  "completion_text_token_price",
  "completion_text_token_price_long_context",
  "context_length",
  "created",
  "id",
  "image_price",
  "long_context_threshold",
  "object",
  "owned_by",
  "pricing",
  "prompt_image_token_price",
  "prompt_text_token_price",
  "prompt_text_token_price_long_context",
] as const;
const detailedApiFields = [
  "aliases",
  "created",
  "fingerprint",
  "id",
  "input_modalities",
  "object",
  "output_modalities",
  "owned_by",
  "version",
] as const;
const languageApiFields = [
  ...detailedApiFields,
  "cached_prompt_text_token_price",
  "cached_prompt_text_token_price_long_context",
  "completion_text_token_price",
  "completion_text_token_price_long_context",
  "long_context_threshold",
  "prompt_image_token_price",
  "prompt_text_token_price",
  "prompt_text_token_price_long_context",
  "search_price",
] as const;
const imageApiFields = [
  ...detailedApiFields,
  "image_price",
  "max_prompt_length",
  "pricing",
] as const;

const modelApiRoutes = [
  { path: "/v1/models", container: "data", fields: generalApiFields },
  { path: "/v1/models/{model_id}", fields: generalApiFields },
  { path: "/v1/language-models", container: "models", fields: languageApiFields },
  { path: "/v1/language-models/{model_id}", fields: languageApiFields },
  { path: "/v1/image-generation-models", container: "models", fields: imageApiFields },
  { path: "/v1/image-generation-models/{model_id}", fields: imageApiFields },
  { path: "/v1/video-generation-models", container: "models", fields: detailedApiFields },
  { path: "/v1/video-generation-models/{model_id}", fields: detailedApiFields },
] as const;

function assertSameFields(actual: string[], expected: readonly string[], label: string): void {
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  if (
    actualSet.size !== actual.length ||
    actualSet.size !== expectedSet.size ||
    [...actualSet].some((field) => !expectedSet.has(field))
  )
    throw new Error(`xAI ${label} fields changed`);
}

function assertModelApiContract(llms: string): void {
  const body = section(llms, "/developers/rest-api-reference/inference/models");
  const headings = [...body.matchAll(/^## GET (\/v1\/[^\n]+)$/gm)].flatMap((match) => {
    if (match.index === undefined || match[1] === undefined) return [];
    return [{ path: match[1].replaceAll("\\", ""), start: match.index }];
  });
  assertSameFields(
    headings.map(({ path }) => path),
    modelApiRoutes.map(({ path }) => path),
    "documented model API routes",
  );
  const recordSchema = z.record(z.string(), z.unknown());
  const knownImageExampleFields = new Set([
    "prompt_text_token_price",
    "prompt_image_token_price",
    "generated_image_token_price",
  ]);
  for (const expected of modelApiRoutes) {
    const index = headings.findIndex(({ path }) => path === expected.path);
    const heading = headings[index];
    if (index < 0 || heading === undefined)
      throw new Error(`xAI documented model API route disappeared: ${expected.path}`);
    const routeBody = body.slice(heading.start, headings[index + 1]?.start);
    const responseBody = routeBody
      .split("### Response Body", 2)[1]
      ?.split(/\\?\*\\?\*Response example:/, 1)[0];
    if (responseBody === undefined)
      throw new Error(`xAI ${expected.path} response contract disappeared`);
    const container = "container" in expected ? expected.container : undefined;
    const itemFields = [
      ...responseBody.matchAll(container === undefined ? /^\* `([^`]+)`/gm : /^  \* `([^`]+)`/gm),
    ].flatMap((match) => (match[1] === undefined ? [] : [match[1]]));
    assertSameFields(itemFields, expected.fields, `${expected.path} response`);
    if (container !== undefined) {
      const topLevelFields = [...responseBody.matchAll(/^\* `([^`]+)`/gm)].flatMap((match) =>
        match[1] === undefined ? [] : [match[1]],
      );
      assertSameFields(
        topLevelFields,
        expected.path === "/v1/models" ? [container, "object"] : [container],
        `${expected.path} envelope`,
      );
    }

    const json = routeBody.match(/```json\n([\s\S]*?)\n```/)?.[1];
    if (json === undefined) throw new Error(`xAI ${expected.path} response example disappeared`);
    const envelope = recordSchema.parse(JSON.parse(json));
    const example =
      container === undefined
        ? envelope
        : z.array(recordSchema).min(1).parse(envelope[container])[0];
    if (example === undefined) throw new Error(`xAI ${expected.path} response example was empty`);
    const allowed = new Set<string>(expected.fields);
    const unexpected = Object.keys(example).filter(
      (field) =>
        !allowed.has(field) &&
        !(expected.path.includes("image-generation-models") && knownImageExampleFields.has(field)),
    );
    if (unexpected.length > 0)
      throw new Error(
        `xAI ${expected.path} response example added fields: ${unexpected.join(", ")}`,
      );
    if (["id", "created", "object", "owned_by"].some((field) => !(field in example)))
      throw new Error(`xAI ${expected.path} response example lost common identity fields`);
  }
}

const endpointEvidence = [
  ["/developers/model-capabilities/text/generate-text", "Responses", "/v1/responses"],
  [
    "/developers/model-capabilities/legacy/chat-completions",
    "Chat Completions",
    "/v1/chat/completions",
  ],
  ["/developers/model-capabilities/text/multi-agent", "Responses", "/v1/responses"],
  [
    "/developers/model-capabilities/images/generation",
    "Image Generations",
    "/v1/images/generations",
  ],
  ["/developers/model-capabilities/images/editing", "Image Edits", "/v1/images/edits"],
  [
    "/developers/model-capabilities/video/generation",
    "Video Generations",
    "/v1/videos/generations",
  ],
  ["/developers/model-capabilities/imagine", "Video Generations", "/v1/videos/generations"],
] as const;

function requestModels(body: string, requestUrl: string): string[] {
  const ids = unique(
    [...body.matchAll(/```[^\n]*\n([\s\S]*?)```/g)]
      .flatMap((match) => (match[1]?.includes(requestUrl) ? [match[1]] : []))
      .flatMap((block) =>
        [...block.matchAll(/(?:"model"|model)\s*[:=]\s*["'](grok-[a-z0-9._-]+)["']/gi)].flatMap(
          (match) => (match[1] === undefined ? [] : [modelIdSchema.parse(match[1])]),
        ),
      ),
  );
  if (ids.length === 0) throw new Error(`xAI request example omitted a model for ${requestUrl}`);
  return ids;
}

function resolveModel(
  id: string,
  models: { name: string; aliases: string[] }[],
  evidence: string,
): string {
  const matches = models.filter((value) => value.name === id || value.aliases.includes(id));
  const value = matches[0];
  if (value === undefined || matches.length > 1)
    throw new Error(`xAI ${evidence} model ${id} did not resolve exactly once`);
  return value.name;
}

function endpointFacts(
  input: ParseInput,
  llms: string,
  models: { name: string; aliases: string[] }[],
): Map<string, ApiEndpoint[]> {
  const endpoints = new Map<string, ApiEndpoint[]>();
  for (const [pathname, name, path] of endpointEvidence) {
    const ids = reviewClaim(input, "endpoint_contract_drift", () =>
      requestModels(section(llms, pathname), `https://api.x.ai${path}`).map((modelId) =>
        resolveModel(modelId, models, "endpoint"),
      ),
    );
    for (const id of ids ?? []) {
      endpoints.set(id, [...(endpoints.get(id) ?? []), { name, path }]);
    }
  }
  for (const [id, values] of endpoints)
    endpoints.set(
      id,
      [...new Map(values.map((value) => [apiEndpointKey(value), value])).values()].sort(
        (left, right) => apiEndpointKey(left).localeCompare(apiEndpointKey(right)),
      ),
    );
  return endpoints;
}

function multiAgentModels(
  llms: string,
  models: { name: string; aliases: string[] }[],
): Set<string> {
  const body = section(llms, "/developers/model-capabilities/text/multi-agent");
  if (!body.includes("currently in **beta**"))
    throw new Error("xAI Multi-agent release-stage evidence changed");
  return new Set(
    requestModels(body, "https://api.x.ai/v1/responses").map((id) =>
      resolveModel(id, models, "Multi-agent"),
    ),
  );
}

function displayNames(html: string): Map<string, string> {
  const $ = load(html);
  const names = new Map<string, string>();
  $("a[href]").each((_index, element) => {
    const path = $(element).attr("href");
    const match = path?.match(/^\/developers\/models\/([a-z0-9._-]+)$/i);
    const spans = $(element)
      .find("span")
      .toArray()
      .map((span) => $(span).text().replace(/\s+/g, " ").trim())
      .filter(Boolean);
    const id = match?.[1];
    const name = spans.length === 1 ? spans[0] : undefined;
    if (id === undefined || name === undefined) return;
    const current = names.get(id);
    if (current !== undefined && current !== name)
      throw new Error(`xAI model ${id} has conflicting display names`);
    names.set(id, name);
  });
  return names;
}

interface ReleaseSection {
  date: string;
  body: string;
}

const monthNumber = new Map([
  ["january", 1],
  ["february", 2],
  ["march", 3],
  ["april", 4],
  ["may", 5],
  ["june", 6],
  ["july", 7],
  ["august", 8],
  ["september", 9],
  ["october", 10],
  ["november", 11],
  ["december", 12],
]);

function releaseSections(notes: string): ReleaseSection[] {
  const headings = [
    ...notes.matchAll(
      /^## (January|February|March|April|May|June|July|August|September|October|November|December)(?: (\d{4}))?$/gim,
    ),
  ].map((match) => ({
    index: match.index,
    month: monthNumber.get(match[1]?.toLowerCase() ?? ""),
    explicitYear: match[2] === undefined ? undefined : Number(match[2]),
  }));
  if (headings.length === 0 || headings.some(({ month }) => month === undefined))
    throw new Error("xAI release notes omitted month headings");
  const dated: ReleaseSection[] = [];
  let nextMonth = 13;
  let year: number | undefined;
  for (let index = headings.length - 1; index >= 0; index -= 1) {
    const heading = headings[index];
    if (heading === undefined || heading.month === undefined) continue;
    if (heading.explicitYear !== undefined) year = heading.explicitYear;
    else if (year !== undefined && heading.month < nextMonth) year += 1;
    if (year === undefined) throw new Error("xAI release notes omitted a year anchor");
    const end = headings[index + 1]?.index ?? notes.length;
    dated.push({
      date: `${year}-${String(heading.month).padStart(2, "0")}`,
      body: notes.slice(heading.index, end),
    });
    nextMonth = heading.month;
  }
  return dated;
}

function releaseDate(
  releases: ReleaseSection[],
  id: string,
  name: string,
  aliases: string[] = [],
): string | undefined {
  const family = id.replace(/-\d{4}-(?:non-)?reasoning$/, "").replace(/-\d{4}$/, "");
  const ids = new Set([id, ...aliases]);
  const names = unique([name, family])
    .filter((value) => value !== id)
    .map((value) => value.toLowerCase().replaceAll("-", " "));
  const matches = releases.filter(({ body }) =>
    body
      .split(/^### /m)
      .slice(1)
      .some((entry) => {
        const heading = entry.split("\n", 1)[0]?.toLowerCase().replaceAll("-", " ") ?? "";
        const codes = new Set([...entry.matchAll(/`([^`]+)`/g)].map((match) => match[1]));
        return (
          [...ids].some((value) => codes.has(value)) ||
          names.some((value) => heading.includes(value))
        );
      }),
  );
  return matches.map(({ date }) => date).sort()[0];
}

function updatedDate(aliases: string[]): string | undefined {
  const dates = aliases.flatMap((alias) => {
    const separated = alias.match(/-(\d{4}-\d{2}-\d{2})(?:$|-latest$)/)?.[1];
    if (separated !== undefined) return [separated];
    const compact = alias.match(/-(\d{4})(\d{2})(\d{2})(?:$|-latest$)/);
    return compact?.[1] === undefined || compact[2] === undefined || compact[3] === undefined
      ? []
      : [`${compact[1]}-${compact[2]}-${compact[3]}`];
  });
  return dates.sort().at(-1);
}

interface TextPrice {
  id: string;
  long: boolean;
  threshold: number;
  context: number;
  input: string;
  cached: string;
  output: string;
}

function count(value: string): number {
  const match = value.match(/^(\d+(?:\.\d+)?)([kM])$/);
  if (match?.[1] === undefined || match[2] === undefined)
    throw new Error(`Invalid xAI token count ${value}`);
  const result = Number(match[1]) * (match[2] === "M" ? 1_000_000 : 1_000);
  if (!Number.isSafeInteger(result)) throw new Error(`Invalid xAI token count ${value}`);
  return result;
}

function textPriceRows(pricing: string): TextPrice[] {
  requireClaims(
    pricing,
    ["Input / 1M tokens", "Cached input / 1M tokens", "Output / 1M tokens"],
    "xAI text-price denominator changed",
  );
  return [
    ...pricing.matchAll(
      /^\|\s*([a-z0-9._-]+)\s+\((<|≥|>=)\s*(\d+)k prompt tokens\)\s*\|\s*([\d.]+[kM])\s*\|\s*\$([\d.]+)\s*\|\s*\$([\d.]+)\s*\|\s*\$([\d.]+)\s*\|$/gim,
    ),
  ].map((match) => {
    const [id, operator, threshold, context, input, cached, output] = match.slice(1);
    if (
      id === undefined ||
      operator === undefined ||
      threshold === undefined ||
      context === undefined ||
      input === undefined ||
      cached === undefined ||
      output === undefined
    )
      throw new Error("Invalid xAI text pricing row");
    return {
      id,
      long: operator !== "<",
      threshold: Number(threshold) * 1_000,
      context: count(context),
      input: scaleDecimal(input, 0),
      cached: scaleDecimal(cached, 0),
      output: scaleDecimal(output, 0),
    };
  });
}

function batchPricingMultipliers(
  pricing: string,
  models: { name: string; aliases: string[] }[],
): Map<string, string> {
  const batch = pricing.slice(
    pricing.indexOf("## Batch API Pricing"),
    pricing.indexOf("## Priority Processing Pricing"),
  );
  const groups = [...batch.matchAll(/^\*\*(\d+)% off standard rates\*\*\n+((?:- [^\n]+\n?)+)/gm)];
  const batchMultipliers = new Map<string, string>();
  for (const match of groups) {
    const percent = match[1];
    const rows = match[2];
    if (percent === undefined || rows === undefined) continue;
    const value = Number(percent);
    if (!Number.isInteger(value) || value <= 0 || value >= 100)
      throw new Error("xAI batch discount was invalid");
    const multiplier = scaleDecimal(String(100 - value), -2);
    for (const row of rows.matchAll(/^- ([a-z0-9._-]+)$/gm)) {
      const rawId = row[1];
      if (rawId === undefined) throw new Error("xAI batch discount model was missing");
      const id = resolveModel(modelIdSchema.parse(rawId), models, "batch pricing");
      if (batchMultipliers.has(id)) throw new Error("xAI batch discount model was duplicated");
      batchMultipliers.set(id, multiplier);
    }
  }
  if (
    batchMultipliers.size === 0 ||
    !batch.includes("Models not listed above have no batch discount.") ||
    !batch.includes("The batch discount applies to all token types") ||
    !batch.includes(
      "Image and video generation are supported in the Batch API but are billed at standard rates.",
    )
  )
    throw new Error("xAI batch pricing terms were incomplete");
  return batchMultipliers;
}

function priorityPricingMultiplier(pricing: string): string {
  const priority = pricing.slice(pricing.indexOf("## Priority Processing Pricing"));
  const multiplier = priority.match(/billed at a \*\*([\d.]+)x\*\* premium/)?.[1];
  if (
    multiplier === undefined ||
    !priority.includes(`| Token pricing | Standard rates | **${multiplier}x** standard rates |`) ||
    !priority.includes(`The ${multiplier}x multiplier applies to all token types`)
  )
    throw new Error("xAI priority pricing terms were incomplete");
  return scaleDecimal(multiplier, 0);
}

function batchExclusions(llms: string, models: { name: string; aliases: string[] }[]): Set<string> {
  const body = section(llms, "/developers/advanced-api-usage/batch-api");
  const supported = [
    "/v1/chat/completions",
    "/v1/responses",
    "/v1/images/generations",
    "/v1/images/edits",
    "/v1/videos/generations",
    "/v1/videos/edits",
    "/v1/videos/extensions",
  ];
  if (supported.some((path) => !body.includes(`\`${path}\``)))
    throw new Error("xAI Batch API endpoint support changed");
  const unsupported = body.match(
    /(?:^>\s*)?((?:`[^`]+`(?:, | and )?)+) (?:is|are) not currently supported for Batch API requests/m,
  )?.[1];
  const ids = [...(unsupported?.matchAll(/`([^`]+)`/g) ?? [])].flatMap((match) =>
    match[1] === undefined ? [] : [modelIdSchema.parse(match[1])],
  );
  if (ids.length === 0) throw new Error("xAI Batch API model exclusions changed");
  return new Set(ids.map((id) => resolveModel(id, models, "Batch API exclusion")));
}

function assertStreaming(llms: string): void {
  const body = section(llms, "/developers/model-capabilities/text/streaming");
  if (
    !body.includes("supported by all models with text output capability") ||
    !body.includes("not supported by models with image output capability")
  )
    throw new Error("xAI streaming support evidence changed");
}

interface PublicPricingReview {
  text: Map<string, TextPrice[]>;
  warnings: Map<string, SourceRawPricingFact[]>;
}

function publicPricingReview(
  input: ParseInput,
  pricing: string,
  modelsPage: string,
  language: z.infer<typeof languageModelSchema>[],
  images: z.infer<typeof imageModelSchema>[],
  videos: z.infer<typeof videoModelSchema>[],
): PublicPricingReview {
  const rows = textPriceRows(pricing);
  const modelRows = textPriceRows(modelsPage);
  const text = new Map<string, TextPrice[]>();
  const warnings = new Map<string, SourceRawPricingFact[]>();
  const warn = (id: string, key: string, fragment: string): void => {
    warnings.set(id, [...(warnings.get(id) ?? []), pricingWarning(key, fragment, input.source.id)]);
    input.onPricingReconciliation?.({
      disposition: "ambiguous",
      reason_code: key,
      sample: id,
    });
  };
  for (const value of language) {
    const current = rows.filter(({ id }) => id === value.name);
    const standard = current.find(({ long }) => !long);
    const long = current.find((row) => row.long);
    const threshold = Number(value.longContextThreshold);
    if (
      current.length !== 2 ||
      standard === undefined ||
      long === undefined ||
      standard.context !== value.maxPromptLength ||
      long.context !== value.maxPromptLength ||
      standard.threshold !== threshold ||
      long.threshold !== threshold
    ) {
      warn(
        value.name,
        "public_text_pricing_scope_conflict",
        "The dedicated pricing rows do not align with the structured model context bands; structured fixed-point rates remain the fallback",
      );
      continue;
    }
    text.set(value.name, current);
    const structured = [
      scaleDecimal(value.promptTextTokenPrice, -4),
      scaleDecimal(value.cachedPromptTokenPrice, -4),
      scaleDecimal(value.completionTextTokenPrice, -4),
      scaleDecimal(value.promptTextTokenPriceLongContext, -4),
      scaleDecimal(value.cachedPromptTokenPriceLongContext, -4),
      scaleDecimal(value.completionTokenPriceLongContext, -4),
    ];
    const published = [
      standard.input,
      standard.cached,
      standard.output,
      long.input,
      long.cached,
      long.output,
    ];
    if (JSON.stringify(structured) !== JSON.stringify(published))
      warn(
        value.name,
        "structured_price_superseded",
        `Dedicated pricing page ${published.join("/")} supersedes embedded fixed-point values ${structured.join("/")} for the same text rate bands`,
      );
    const comparison = modelRows.filter(({ id }) => id === value.name);
    if (JSON.stringify(comparison) !== JSON.stringify(current))
      warn(
        value.name,
        "models_page_price_conflict",
        "The Models summary disagrees with the dedicated pricing page; the dedicated pricing page owns current public amounts",
      );
  }
  const summaryRows = (body: string) =>
    new Map(
      [...body.matchAll(/^\|\s*([a-z0-9._-]+)\s*\|\s*\$([\d.]+)\s*\/\s*(image|sec)\s*\|$/gim)].map(
        (match) => [match[1] ?? "", scaleDecimal(match[2] ?? "", 0)],
      ),
    );
  const rowsById = summaryRows(pricing);
  const modelRowsById = summaryRows(modelsPage);
  for (const value of images) {
    const raw = value.imagePrice ?? value.resolutionPricing[0]?.pricePerImage;
    const exact = raw === undefined ? undefined : scaleDecimal(raw, -10);
    if (exact === undefined || rowsById.get(value.name) !== exact)
      warn(
        value.name,
        "imagine_summary_price_conflict",
        "The dedicated pricing summary differs from the more specific embedded image-resolution rate; the exact resolution row is retained",
      );
    if (modelRowsById.get(value.name) !== rowsById.get(value.name))
      warn(
        value.name,
        "models_page_price_conflict",
        "The Models summary disagrees with the dedicated pricing page",
      );
  }
  for (const value of videos) {
    const raw = value.resolutionPricing[0]?.pricePerSecond;
    const exact = raw === undefined ? undefined : scaleDecimal(raw, -10);
    if (exact === undefined || rowsById.get(value.name) !== exact)
      warn(
        value.name,
        "imagine_summary_price_conflict",
        "The dedicated pricing summary differs from the more specific embedded video-resolution rate; the exact resolution row is retained",
      );
    if (modelRowsById.get(value.name) !== rowsById.get(value.name))
      warn(
        value.name,
        "models_page_price_conflict",
        "The Models summary disagrees with the dedicated pricing page",
      );
  }
  return { text, warnings };
}

function toolRates(input: ParseInput, pricing: string): XaiCommercialEvidence["toolRates"] {
  const rows = [
    ...pricing.matchAll(
      /^\|\s*([^|]+?)\s*\|\s*((?:`[^`]+`(?:,\s*)?)+)[^|]*\|[^|]+\|\s*\$([\d.]+)\s*\|$/gim,
    ),
  ].flatMap((match) => {
    const label = match[1]?.trim();
    const names = match[2];
    const price = match[3];
    if (label === undefined || names === undefined || price === undefined) return [];
    return [
      {
        label,
        names: [...names.matchAll(/`([^`]+)`/g)].flatMap((name) =>
          name[1] === undefined ? [] : [name[1]],
        ),
        price: scaleDecimal(price, 0),
      },
    ];
  });
  const definitions = [
    {
      key: "web-search",
      name: "Web Search",
      names: ["web_search"],
      meter: "web_search",
      supportsVoice: true,
    },
    {
      key: "x-search",
      name: "X Search",
      names: ["x_search"],
      meter: "retrieval",
      supportsVoice: true,
    },
    {
      key: "code-execution",
      name: "Code Execution",
      names: ["code_execution", "code_interpreter"],
      meter: "code_execution",
      supportsVoice: false,
    },
    {
      key: "attachment-search",
      name: "File Attachment Search",
      names: ["attachment_search"],
      meter: "file_search",
      supportsVoice: false,
    },
    {
      key: "collections-search",
      name: "Collections Search",
      names: ["collections_search", "file_search"],
      meter: "file_search",
      supportsVoice: true,
    },
  ] as const;
  return definitions.flatMap((definition) => {
    const reasonCode = `tool_${definition.key.replaceAll("-", "_")}_price_drift`;
    const value = reviewClaim(input, reasonCode, () => {
      requireClaims(pricing, ["Cost / 1k Calls"], "xAI tool-price denominator changed");
      const expectedNames = new Set<string>(definition.names);
      const matches = rows.filter(
        (row) =>
          row.label === definition.name.replace("File Attachment Search", "File Attachments") ||
          row.names.some((name) => expectedNames.has(name)),
      );
      const row = matches[0];
      if (
        row === undefined ||
        matches.length !== 1 ||
        JSON.stringify([...row.names].sort()) !== JSON.stringify([...definition.names].sort())
      )
        throw new Error(`xAI ${definition.name} pricing row changed`);
      return {
        key: definition.key,
        name: definition.name,
        supportsVoice: definition.supportsVoice,
        rate: publishedRate(
          definition.meter,
          row.price,
          "thousand_events",
          input.source.id,
          "USD / 1k successful tool calls",
        ),
      };
    });
    return value === undefined ? [] : [value];
  });
}

interface VoicePrices {
  realtime: Map<string, { audio: string; text: string }>;
  speech?: string;
  transcription?: string;
  streamingTranscription?: string;
}

function voicePrices(input: ParseInput, pricing: string): VoicePrices {
  const realtime =
    reviewClaim(input, "realtime_voice_price_drift", () => {
      const rows = new Map(
        [
          ...pricing.matchAll(
            /^\| Speech to Speech \(([^)]+)\) \| \$([\d.]+) \/ min \(\$[\d.]+ \/ hr\) audio<br\s*\/?>\$([\d.]+) \/ text input \|$/gim,
          ),
        ].map((match) => {
          const id = modelIdSchema.parse(match[1]);
          const audio = match[2];
          const text = match[3];
          if (audio === undefined || text === undefined)
            throw new Error("xAI realtime Voice pricing row was incomplete");
          return [id, { audio: scaleDecimal(audio, 0), text: scaleDecimal(text, 0) }] as const;
        }),
      );
      if (rows.size === 0) throw new Error("xAI realtime Voice pricing rows were not found");
      return rows;
    }) ?? new Map<string, { audio: string; text: string }>();
  const speech = reviewClaim(input, "tts_price_drift", () => {
    const amount = pricing.match(/^\| Text to Speech \| \$([\d.]+) \/ 1M chars \|$/m)?.[1];
    if (amount === undefined) throw new Error("xAI TTS pricing row was not found");
    return scaleDecimal(amount, 0);
  });
  const transcription = reviewClaim(input, "stt_price_drift", () => {
    const match = pricing.match(
      /^\| Speech to Text \| \$([\d.]+) \/ hr \(REST\), \$([\d.]+) \/ hr \(Streaming\) \|$/m,
    );
    const rest = match?.[1];
    const streaming = match?.[2];
    if (rest === undefined || streaming === undefined)
      throw new Error("xAI STT pricing row was not found");
    return {
      rest: scaleDecimal(rest, 0),
      streaming: scaleDecimal(streaming, 0),
    };
  });
  return {
    realtime,
    ...(speech === undefined ? {} : { speech }),
    ...(transcription === undefined
      ? {}
      : {
          transcription: transcription.rest,
          streamingTranscription: transcription.streaming,
        }),
  };
}

function assertSameVoicePrices(left: VoicePrices, right: VoicePrices): void {
  const entries = (value: VoicePrices): unknown[] => [
    [...value.realtime.entries()].sort(([leftId], [rightId]) => leftId.localeCompare(rightId)),
    value.speech,
    value.transcription,
    value.streamingTranscription,
  ];
  if (JSON.stringify(entries(left)) !== JSON.stringify(entries(right)))
    throw new Error("xAI pricing and model-page voice prices differ");
}

function requireClaims(body: string, claims: readonly string[], message: string): void {
  if (claims.some((claim) => !body.includes(claim))) throw new Error(message);
}

function commercialEvidence(
  input: ParseInput,
  llms: string,
  pricing: string,
  voice: VoicePrices | undefined,
): XaiCommercialEvidence {
  const imageGenerationTool =
    reviewClaim(input, "image_generation_tool_contract_drift", () => {
      requireClaims(
        section(llms, "/developers/tools/image-generation"),
        ["`grok-imagine-image-quality`", "`image_generation_call`", "no size or format parameters"],
        "xAI image-generation tool contract drifted",
      );
      return true;
    }) ?? false;
  const voiceTools =
    reviewClaim(input, "voice_tool_contract_drift", () => {
      requireClaims(
        section(llms, "/developers/model-capabilities/audio/speech-to-speech"),
        ["`file_search`", "`web_search`", "`x_search`", "`mcp`"],
        "xAI Voice tool contract drifted",
      );
      return true;
    }) ?? false;
  const fee = reviewClaim(input, "usage_guideline_violation_fee_drift", () => {
    const amount = pricing.match(
      /caught before generation in the Responses API[\s\S]*?\$([\d.]+)\s+usage guideline violation fee per request/i,
    )?.[1];
    if (amount === undefined) throw new Error("xAI usage-guideline violation fee was not found");
    return publishedRate(
      "content_safety",
      scaleDecimal(amount, 0),
      "request",
      input.source.id,
      "USD / rejected request",
    );
  });
  return {
    imageGenerationTool,
    toolRates: toolRates(input, pricing),
    ...(voice?.speech === undefined
      ? {}
      : {
          ttsRate: publishedRate(
            "output_audio",
            voice.speech,
            "million_characters",
            input.source.id,
            "USD / 1M characters",
          ),
        }),
    ...(voice?.transcription === undefined
      ? {}
      : {
          restSttRate: publishedRate(
            "input_audio",
            voice.transcription,
            "hour",
            input.source.id,
            "USD / hour",
          ),
        }),
    ...(voice?.streamingTranscription === undefined
      ? {}
      : {
          streamingSttRate: publishedRate(
            "input_audio",
            voice.streamingTranscription,
            "hour",
            input.source.id,
            "USD / hour",
          ),
        }),
    ...(fee === undefined ? {} : { violationRate: fee }),
    voiceTools,
  };
}

function voiceRates(prices: VoicePrices, id: string, sourceId: string): SourcePriceFact[] {
  const rate = prices.realtime.get(id);
  if (rate === undefined) throw new Error(`xAI voice pricing omitted ${id}`);
  return [
    publishedRate("output_audio", rate.audio, "minute", sourceId, "USD / min"),
    publishedRate("input_text", rate.text, "request", sourceId, "USD / text input", {
      operation: "conversation.item.create",
    }),
  ];
}

function assertVoiceServices(
  prices: VoicePrices,
  services: z.infer<typeof voiceServiceSchema>[],
): void {
  const endpoint = (name: "TTS" | "STT") => {
    const matches = services.flatMap((service) => {
      const value = service.endpoints[0];
      return value?.endpoint === name ? [value] : [];
    });
    return matches.length === 1 ? matches[0] : undefined;
  };
  const tts = endpoint("TTS");
  const stt = endpoint("STT");
  if (
    (prices.speech !== undefined && tts?.endpoint !== "TTS") ||
    ((prices.transcription !== undefined || prices.streamingTranscription !== undefined) &&
      stt?.endpoint !== "STT")
  )
    throw new Error("xAI voice service catalog was incomplete");
  const roundedCents = (ticksPerSecond: string, seconds: bigint): string =>
    ((BigInt(ticksPerSecond) * seconds + 50_000_000n) / 100_000_000n).toString();
  if (
    (prices.speech !== undefined &&
      tts?.endpoint === "TTS" &&
      scaleDecimal(tts.pricing.perCharacter, -4) !== prices.speech) ||
    (prices.transcription !== undefined &&
      stt?.endpoint === "STT" &&
      roundedCents(stt.pricing.perAudioSecond, 3_600n) !== scaleDecimal(prices.transcription, 2)) ||
    (prices.streamingTranscription !== undefined &&
      stt?.endpoint === "STT" &&
      roundedCents(stt.pricing.perAudioSecondStreaming, 3_600n) !==
        scaleDecimal(prices.streamingTranscription, 2))
  )
    throw new Error("xAI structured and published voice pricing differ");
  const realtime = services.flatMap((service) => {
    const value = service.endpoints[0];
    return value?.endpoint === "REALTIME" ? [{ id: service.name, value }] : [];
  });
  if (realtime.length === 0) throw new Error("xAI voice service catalog was incomplete");
  for (const service of realtime) {
    const audio = roundedCents(service.value.pricing.realtimeAudioSecondPrice, 60n);
    const text = scaleDecimal(service.value.pricing.realtimeTextInputPrice, -10);
    const exact = prices.realtime.get(service.id);
    const matches = (published: { audio: string; text: string }): boolean =>
      audio === scaleDecimal(published.audio, 2) && text === published.text;
    const published = exact === undefined ? [...prices.realtime.values()] : [exact];
    if (!published.some(matches))
      throw new Error(`xAI structured and published voice pricing differ for ${service.id}`);
  }
}

function preview(
  id: string,
  aliases: string[],
  releases: ReleaseSection[],
  documentedBeta: boolean,
): boolean {
  return (
    documentedBeta ||
    releases.some(
      ({ body }) =>
        [id, ...aliases].some((value) => body.includes(value)) &&
        /currently in early access/i.test(body),
    )
  );
}

function currentModels(
  input: ParseInput,
  catalog: PublicModels,
  html: string,
  llms: string,
): { evidence: XaiCommercialEvidence; models: ProviderModel[] } {
  const language = distinct(
    catalog.clusterConfigs.flatMap(({ languageModels }) => languageModels),
    "language",
  );
  const embeddings = distinct(
    catalog.clusterConfigs.flatMap(({ embeddingModels }) => embeddingModels),
    "embedding",
  );
  const images = distinct(
    catalog.clusterConfigs.flatMap(({ imageGenerationModels }) => imageGenerationModels),
    "image",
  );
  const voice = distinct(
    catalog.clusterConfigs.flatMap(({ audioModels }) => audioModels),
    "voice service",
  );
  const videos = distinct(
    catalog.clusterConfigs.flatMap(({ videoGenerationModels }) => videoGenerationModels),
    "video",
  );
  const regions = modelRegions(catalog);
  const ratesFor = (id: string, rates: SourcePriceFact[]): SourcePriceFact[] =>
    regionalRates(rates, regions.get(id) ?? []);
  const routable = [...language, ...embeddings, ...images, ...videos];
  const endpoints = endpointFacts(input, llms, routable);
  const multiAgent =
    reviewClaim(input, "multi_agent_contract_drift", () => multiAgentModels(llms, language)) ??
    new Set<string>();
  const excludedFromBatch = reviewClaim(input, "batch_contract_drift", () =>
    batchExclusions(llms, routable),
  );
  const streaming =
    reviewClaim(input, "streaming_contract_drift", () => {
      assertStreaming(llms);
      return true;
    }) ?? "unknown";
  const count = language.length + embeddings.length + images.length + voice.length + videos.length;
  const extractor = input.source.extractor;
  if (extractor.kind !== "xai-catalog") throw new Error("Invalid xAI catalog extractor");
  assertItemCount("xAI structured models", count, extractor.minModels, extractor.maxModels);
  const pricing = reviewClaim(input, "pricing_document_drift", () =>
    section(llms, "/developers/pricing"),
  );
  const modelsPage = reviewClaim(input, "models_document_drift", () =>
    section(llms, "/developers/models"),
  );
  const publicPrices =
    pricing === undefined || modelsPage === undefined
      ? {
          text: new Map<string, TextPrice[]>(),
          warnings: new Map<string, SourceRawPricingFact[]>(),
        }
      : (reviewClaim(input, "public_pricing_contract_drift", () =>
          publicPricingReview(input, pricing, modelsPage, language, images, videos),
        ) ?? {
          text: new Map<string, TextPrice[]>(),
          warnings: new Map<string, SourceRawPricingFact[]>(),
        });
  const prices =
    pricing === undefined
      ? undefined
      : reviewClaim(input, "voice_pricing_contract_drift", () => voicePrices(input, pricing));
  if (prices !== undefined && modelsPage !== undefined)
    reviewClaim(input, "voice_price_summary_conflict", () =>
      assertSameVoicePrices(prices, voicePrices(input, modelsPage)),
    );
  reviewClaim(input, "model_api_contract_drift", () => assertModelApiContract(llms));
  if (voice.length > 0 && prices !== undefined)
    reviewClaim(input, "voice_service_price_conflict", () => assertVoiceServices(prices, voice));
  const batchMultipliers =
    pricing === undefined
      ? undefined
      : reviewClaim(input, "batch_pricing_terms_contract_drift", () =>
          batchPricingMultipliers(pricing, language),
        );
  const priorityMultiplier =
    pricing === undefined
      ? undefined
      : reviewClaim(input, "priority_pricing_terms_contract_drift", () =>
          priorityPricingMultiplier(pricing),
        );
  const names =
    reviewClaim(input, "display_name_contract_drift", () => displayNames(html)) ?? new Map();
  const releases =
    reviewClaim(input, "release_notes_contract_drift", () =>
      releaseSections(section(llms, "/developers/release-notes")),
    ) ?? [];
  const details = (
    id: string,
    aliases: string[],
  ): Pick<ProviderModel, "name" | "release_date" | "updated_date"> => {
    const name = names.get(id) ?? id;
    return {
      name,
      release_date: releaseDate(releases, id, name, aliases),
      updated_date: updatedDate(aliases),
    };
  };
  const languageModels = language.map((value) => {
    const isMultiAgent = multiAgent.has(value.name);
    const releaseStage = preview(value.name, value.aliases, releases, isMultiAgent)
      ? "preview"
      : "unknown";
    return model(input, value.name, {
      ...details(value.name, value.aliases),
      version: value.version,
      aliases: value.aliases,
      tasks: ["text_generation"],
      api_endpoints: endpoints.get(value.name),
      modalities: {
        input: upperModalities(value.inputModalities),
        output: upperModalities(value.outputModalities),
      },
      capabilities: {
        ...unknownCapabilities(),
        reasoning: value.name.includes("non-reasoning")
          ? false
          : (value.features.reasoning ?? "unknown"),
        tool_call: value.features.functionCalling ?? "unknown",
        structured_output: value.features.structuredOutputs ?? "unknown",
        streaming,
        batch: excludedFromBatch === undefined ? "unknown" : !excludedFromBatch.has(value.name),
        prompt_cache: true,
        citations: isMultiAgent ? true : "unknown",
        code_execution: isMultiAgent ? true : "unknown",
        effort_control:
          isMultiAgent || value.features.reasoningEffortOptions !== undefined ? true : "unknown",
      },
      limits: { context_tokens: value.maxPromptLength },
      status: "active",
      release_stage: releaseStage,
      pricing_state: "numeric",
      price_facts: ratesFor(
        value.name,
        textRates(
          value,
          input.source.id,
          publicPrices.text.get(value.name),
          batchMultipliers !== undefined &&
            excludedFromBatch !== undefined &&
            !excludedFromBatch.has(value.name),
          batchMultipliers?.get(value.name),
          priorityMultiplier,
        ),
      ),
      raw_price_facts: publicPrices.warnings.get(value.name) ?? [],
    });
  });
  const embeddingModels = embeddings.map((value) => {
    const rates = ratesFor(
      value.name,
      [
        exactRate(
          "input_text",
          value.promptTextTokenPrice,
          4,
          "million_tokens",
          input.source.id,
          "USD cents / 100M tokens",
        ),
        exactRate(
          "input_image",
          value.promptImageTokenPrice,
          4,
          "million_tokens",
          input.source.id,
          "USD cents / 100M tokens",
        ),
      ].filter(({ price }) => price !== "0"),
    );
    return model(input, value.name, {
      ...details(value.name, value.aliases),
      version: value.version,
      aliases: value.aliases,
      tasks: ["embeddings"],
      api_endpoints: endpoints.get(value.name),
      modalities: { input: upperModalities(value.inputModalities), output: ["embedding"] },
      status: "active",
      pricing_state: rates.length > 0 ? "numeric" : "unknown",
      price_facts: rates,
    });
  });
  const imageModels = images.map((value) => {
    const rates = value.resolutionPricing.map(({ resolution, pricePerImage, quality }) =>
      mediaRate("image_generation", pricePerImage, "image", input.source.id, {
        resolution: resolution.replace("IMAGE_RESOLUTION_", ""),
        quality,
      }),
    );
    if (value.pricePerInputImage !== undefined)
      rates.push(mediaRate("input_image", value.pricePerInputImage, "image", input.source.id));
    return model(input, value.name, {
      ...details(value.name, value.aliases),
      version: value.version,
      aliases: value.aliases,
      tasks: ["image_generation"],
      api_endpoints: endpoints.get(value.name),
      modalities: {
        input: upperModalities(value.inputModalities),
        output: upperModalities(value.outputModalities),
      },
      capabilities: {
        ...unknownCapabilities(),
        streaming: false,
        batch: excludedFromBatch === undefined ? "unknown" : true,
      },
      status: "active",
      pricing_state: "numeric",
      price_facts: ratesFor(value.name, rates),
      raw_price_facts: publicPrices.warnings.get(value.name) ?? [],
    });
  });
  const videoModels = videos.map((value) => {
    const rates = value.resolutionPricing.map(({ resolution, pricePerSecond }) =>
      mediaRate("video_generation", pricePerSecond, "second", input.source.id, {
        resolution: resolution.replace("VIDEO_RESOLUTION_", "").toLowerCase(),
      }),
    );
    if (value.pricePerInputImage !== undefined)
      rates.push(mediaRate("input_image", value.pricePerInputImage, "image", input.source.id));
    if (value.pricePerInputVideoSecond !== undefined)
      rates.push(
        mediaRate("input_video", value.pricePerInputVideoSecond, "second", input.source.id),
      );
    return model(input, value.name, {
      ...details(value.name, value.aliases),
      version: value.version,
      aliases: value.aliases,
      tasks: ["video_generation"],
      api_endpoints: endpoints.get(value.name),
      modalities: {
        input: upperModalities(value.inputModalities),
        output: upperModalities(value.outputModalities),
      },
      capabilities: {
        ...unknownCapabilities(),
        batch: excludedFromBatch === undefined ? "unknown" : true,
      },
      status: "active",
      pricing_state: "numeric",
      price_facts: ratesFor(value.name, rates),
      raw_price_facts: publicPrices.warnings.get(value.name) ?? [],
    });
  });
  const realtime =
    reviewClaim(input, "voice_model_contract_drift", () =>
      voiceModels(input, llms, voice, prices, releases, regions),
    ) ?? fallbackVoiceModels(input, voice, prices, releases, regions);
  return {
    evidence: commercialEvidence(input, llms, pricing ?? "", prices),
    models: [...languageModels, ...embeddingModels, ...imageModels, ...videoModels, ...realtime],
  };
}

function voiceModels(
  input: ParseInput,
  llms: string,
  services: z.infer<typeof voiceServiceSchema>[],
  prices: VoicePrices | undefined,
  releases: ReleaseSection[],
  regions: Map<string, string[]>,
): ProviderModel[] {
  const voice = section(llms, "/developers/model-capabilities/audio/speech-to-speech");
  const tableStart = voice.indexOf("| Model | Description | |");
  const currentTableStart = tableStart < 0 ? voice.indexOf("| Model | Description |") : tableStart;
  const tableEnd = voice.indexOf("\n## ", currentTableStart);
  if (currentTableStart < 0) throw new Error("xAI voice model table was not found");
  const table = voice.slice(currentTableStart, tableEnd < 0 ? undefined : tableEnd);
  const rows = table.split("\n").flatMap((line) => {
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
    const id = cells[0]?.match(/^`([^`]+)`$/)?.[1];
    return id === undefined || cells[1] === undefined
      ? []
      : [
          {
            id: modelIdSchema.parse(id),
            description: cells[1],
            deprecated: cells[2] === "deprecated",
          },
        ];
  });
  const latestAlias = voice.match(
    /wss:\/\/api\.x\.ai\/v1\/realtime\?model=(grok-[a-z0-9._-]+)/i,
  )?.[1];
  if (latestAlias === undefined) throw new Error("xAI Realtime endpoint evidence changed");
  const alias = rows.find(({ id }) => id === latestAlias);
  const aliasDescription = alias?.description.match(
    /^Alias for `(grok-[^`]+)`\.(?:\s*Updates to `(grok-[^`]+)` on (January|February|March|April|May|June|July|August|September|October|November|December) (\d{1,2}), (\d{4})\.)?$/,
  );
  const initialAlias = aliasDescription?.[1];
  const updatedAlias = aliasDescription?.[2];
  const transitionMonth = monthNumber.get(aliasDescription?.[3]?.toLowerCase() ?? "");
  const transitionDay = aliasDescription?.[4];
  const transitionYear = aliasDescription?.[5];
  let latestModel = initialAlias;
  if (updatedAlias !== undefined) {
    if (
      transitionMonth === undefined ||
      transitionDay === undefined ||
      transitionYear === undefined
    )
      throw new Error("xAI voice model table was incomplete");
    const transitionDate = `${transitionYear}-${String(transitionMonth).padStart(2, "0")}-${transitionDay.padStart(2, "0")}`;
    if (new Date(`${transitionDate}T00:00:00.000Z`).toISOString().slice(0, 10) !== transitionDate)
      throw new Error("xAI voice model table was incomplete");
    if (input.observedAt.slice(0, 10) >= transitionDate) latestModel = updatedAlias;
  }
  const models = rows.filter(({ id }) => id !== latestAlias);
  if (
    latestModel === undefined ||
    models.length < 2 ||
    !models.some(({ id }) => id === latestModel)
  )
    throw new Error("xAI voice model table was incomplete");
  const latestServices = services.filter(({ aliases }) => aliases.includes(latestAlias));
  if (latestServices.length !== 1 || latestServices[0]?.name !== latestModel)
    throw new Error("xAI structured and documented voice aliases differ");
  const endpoint: ApiEndpoint = { name: "Realtime", path: "/v1/realtime" };
  return models.map((row) => {
    const matches = services.filter(({ name }) => name === row.id);
    const service = matches[0];
    if (
      service === undefined ||
      matches.length > 1 ||
      service.endpoints[0]?.endpoint !== "REALTIME"
    )
      throw new Error(`xAI structured voice model ${row.id} did not resolve exactly once`);
    return model(input, row.id, {
      version: service.version,
      description: row.description,
      aliases: service.aliases,
      tasks: ["text_generation", "speech_to_speech"],
      api_endpoints: [endpoint],
      modalities: {
        input: upperModalities(service.inputModalities),
        output: upperModalities(service.outputModalities),
      },
      capabilities: {
        ...unknownCapabilities(),
        reasoning: true,
        tool_call: true,
        streaming: true,
        effort_control: true,
      },
      release_date: releaseDate(releases, row.id, row.id),
      status: row.deprecated ? "deprecated" : "active",
      pricing_state: prices === undefined ? "unknown" : "numeric",
      price_facts:
        prices === undefined
          ? []
          : regionalRates(voiceRates(prices, row.id, input.source.id), regions.get(row.id) ?? []),
    });
  });
}

function fallbackVoiceModels(
  input: ParseInput,
  services: z.infer<typeof voiceServiceSchema>[],
  prices: VoicePrices | undefined,
  releases: ReleaseSection[],
  regions: Map<string, string[]>,
): ProviderModel[] {
  return services.flatMap((service) => {
    const endpoint = service.endpoints[0];
    if (endpoint?.endpoint !== "REALTIME" || !service.name.startsWith("grok-voice-")) return [];
    const rates =
      prices === undefined
        ? []
        : (reviewClaim(input, "voice_service_price_drift", () =>
            regionalRates(
              voiceRates(prices, service.name, input.source.id),
              regions.get(service.name) ?? [],
            ),
          ) ?? []);
    return [
      model(input, service.name, {
        version: service.version,
        aliases: service.aliases,
        tasks: ["text_generation", "speech_to_speech"],
        api_endpoints: [{ name: "Realtime", path: "/v1/realtime" }],
        modalities: {
          input: upperModalities(service.inputModalities),
          output: upperModalities(service.outputModalities),
        },
        capabilities: {
          ...unknownCapabilities(),
          reasoning: true,
          tool_call: true,
          streaming: true,
          effort_control: true,
        },
        release_date: releaseDate(releases, service.name, service.name, service.aliases),
        status: "active",
        pricing_state: rates.length > 0 ? "numeric" : "unknown",
        price_facts: rates,
      }),
    ];
  });
}

function lifecycleModels(input: ParseInput, llms: string): ProviderModel[] {
  const lifecycle = section(llms, "/developers/migration/may-15-retirement");
  const dateMatch = lifecycle.match(/Effective (May) (\d{1,2}), (\d{4}) at 12:00 PM PT/);
  if (dateMatch?.[2] === undefined || dateMatch[3] === undefined)
    throw new Error("xAI retirement date was not found");
  const date = `${dateMatch[3]}-05-${dateMatch[2].padStart(2, "0")}`;
  const intro = lifecycle.slice(0, lifecycle.indexOf("### How the redirects work"));
  const redirected = [...intro.matchAll(/^\* `([^`]+)`$/gm)].map((match) =>
    modelIdSchema.parse(match[1]),
  );
  const replacements = new Map(
    [...lifecycle.matchAll(/^\| `([^`]+)` \| `([^`]+)`/gm)].map((match) => [
      modelIdSchema.parse(match[1]),
      modelIdSchema.parse(match[2]),
    ]),
  );
  if (
    redirected.length === 0 ||
    replacements.size !== redirected.length ||
    redirected.some((id) => !replacements.has(id)) ||
    !/continue to resolve/i.test(lifecycle) ||
    !/automatically redirect/i.test(lifecycle)
  )
    throw new Error("xAI redirect model and replacement evidence changed");
  const isLegacy = input.observedAt.slice(0, 10) >= date;
  const releases =
    reviewClaim(input, "lifecycle_release_notes_contract_drift", () =>
      releaseSections(section(llms, "/developers/release-notes")),
    ) ?? [];
  return redirected.map((id) =>
    model(input, id, {
      release_date: releaseDate(releases, id, id),
      deprecated_at: date,
      status: isLegacy ? "legacy" : "deprecated",
      replacement_model_ids: [replacements.get(id) ?? ""].filter(Boolean),
    }),
  );
}

function combine(models: ProviderModel[]): ProviderModel[] {
  const values = new Map<string, ProviderModel>();
  const known = <T extends boolean | "unknown">(left: T, right: T): T =>
    right === "unknown" ? left : right;
  const rank = new Map<ProviderModel["status"], number>([
    ["unknown", 0],
    ["active", 1],
    ["legacy", 2],
    ["deprecated", 3],
    ["retired", 4],
  ]);
  for (const value of models) {
    const current = values.get(value.uid);
    if (current === undefined) {
      values.set(value.uid, value);
      continue;
    }
    values.set(value.uid, {
      ...current,
      name: current.name === current.model_id ? value.name : current.name,
      description: value.description ?? current.description,
      aliases: unique([...current.aliases, ...value.aliases]),
      tasks: orderedTasks([...current.tasks, ...value.tasks]),
      modalities: {
        input: unique([...current.modalities.input, ...value.modalities.input]),
        output: unique([...current.modalities.output, ...value.modalities.output]),
      },
      capabilities: {
        reasoning: known(current.capabilities.reasoning, value.capabilities.reasoning),
        tool_call: known(current.capabilities.tool_call, value.capabilities.tool_call),
        structured_output: known(
          current.capabilities.structured_output,
          value.capabilities.structured_output,
        ),
        streaming: known(current.capabilities.streaming, value.capabilities.streaming),
        batch: known(current.capabilities.batch, value.capabilities.batch),
        prompt_cache: known(current.capabilities.prompt_cache, value.capabilities.prompt_cache),
        fine_tuning: known(current.capabilities.fine_tuning, value.capabilities.fine_tuning),
        citations: known(current.capabilities.citations, value.capabilities.citations),
        code_execution: known(
          current.capabilities.code_execution,
          value.capabilities.code_execution,
        ),
        context_management: known(
          current.capabilities.context_management,
          value.capabilities.context_management,
        ),
        effort_control: known(
          current.capabilities.effort_control,
          value.capabilities.effort_control,
        ),
        computer_use: known(current.capabilities.computer_use, value.capabilities.computer_use),
      },
      limits: { ...current.limits, ...value.limits },
      release_date: current.release_date ?? value.release_date,
      updated_date: value.updated_date ?? current.updated_date,
      deprecated_at: value.deprecated_at ?? current.deprecated_at,
      retired_at: value.retired_at ?? current.retired_at,
      status:
        (rank.get(value.status) ?? 0) > (rank.get(current.status) ?? 0)
          ? value.status
          : current.status,
      release_stage:
        value.release_stage === "unknown" ? current.release_stage : value.release_stage,
      replacement_model_ids: unique([
        ...current.replacement_model_ids,
        ...value.replacement_model_ids,
      ]),
      pricing_state:
        current.pricing_state === "unknown" ? value.pricing_state : current.pricing_state,
      price_facts: [
        ...new Map(
          [...current.price_facts, ...value.price_facts].map((rate) => [
            `${rate.meter}\0${rate.price}\0${rate.unit}\0${JSON.stringify(rate.conditions)}`,
            rate,
          ]),
        ).values(),
      ],
      raw_price_facts: [
        ...new Map(
          [...current.raw_price_facts, ...value.raw_price_facts].map((fact) => [
            `${fact.term_key}\0${JSON.stringify(fact.conditions)}\0${JSON.stringify(fact.raw)}`,
            fact,
          ]),
        ).values(),
      ],
    });
  }
  return [...values.values()].sort((left, right) => left.uid.localeCompare(right.uid));
}

function redirectedModels(models: ProviderModel[]): ProviderModel[] {
  const byId = new Map<string, ProviderModel[]>();
  for (const value of models)
    byId.set(value.model_id, [...(byId.get(value.model_id) ?? []), value]);
  return models.map((value) => {
    const replacement = value.replacement_model_ids[0];
    if (
      value.status !== "legacy" ||
      replacement === undefined ||
      value.replacement_model_ids.length !== 1
    )
      return value;
    const targets = byId.get(replacement) ?? [];
    const target = targets[0];
    if (
      target === undefined ||
      targets.length !== 1 ||
      target.pricing_state !== "numeric" ||
      target.price_facts.length === 0 ||
      value.deprecated_at === undefined
    )
      throw new Error(`xAI redirect target ${replacement} did not resolve to one priced model`);
    return {
      ...value,
      tasks: target.tasks,
      modalities: target.modalities,
      capabilities: target.capabilities,
      limits: target.limits,
      pricing_state: "numeric",
      price_facts: target.price_facts.map((rate) => ({
        ...rate,
        conditions: { ...rate.conditions, effective_from: value.deprecated_at },
        derived: true,
        derivation: `Redirects to ${replacement} from ${value.deprecated_at}; ${
          rate.derivation ?? "published target rate"
        }`,
      })),
    };
  });
}

export function parseXaiCatalog(input: ParseInput): ProviderModel[] {
  const bundle = linkedBundleSchema.parse(JSON.parse(input.body));
  const llms = companion(bundle, "/llms.txt");
  const current = currentModels(
    input,
    embeddedModels(input, bundle.index.body),
    bundle.index.body,
    llms,
  );
  const lifecycle =
    reviewClaim(input, "lifecycle_contract_drift", () => lifecycleModels(input, llms)) ?? [];
  const combined = combine([...current.models, ...lifecycle]);
  const models =
    reviewClaim(input, "redirect_price_join_drift", () => redirectedModels(combined)) ?? combined;
  extractXaiCommercialFacts(models, input.source.id, current.evidence);
  for (const model of models)
    input.onPricingReconciliation?.({
      disposition: model.price_facts.length > 0 ? "normalized" : "unresolved",
      reason_code:
        model.price_facts.length > 0
          ? model.status === "legacy"
            ? "redirect_price_set_bound"
            : "public_price_set_bound"
          : "model_price_set_unresolved",
      sample: model.model_id,
    });
  return models;
}

export function parseXaiApi(input: ParseInput): ProviderModel[] {
  const extractor = input.source.extractor;
  if (extractor.kind !== "xai-api") throw new Error("Invalid xAI API extractor");
  const body: unknown = JSON.parse(input.body);
  if (extractor.category === "all") {
    const envelope = apiListSchema.parse(body);
    const values = recognizeItems({
      label: "xAI model inventory",
      items: envelope.data,
      schema: apiItemSchema,
      modelId: "id",
      rootKeys: Object.keys(apiItemShape),
      skipInvalidItems: true,
      ...(input.onContractFinding === undefined ? {} : { onFinding: input.onContractFinding }),
    });
    return values.map((value) =>
      model(input, value.id, {
        aliases: value.aliases,
        limits: value.context_length === null ? {} : { context_tokens: value.context_length },
        scope: "runtime_observation",
      }),
    );
  }
  const schema =
    extractor.category === "language"
      ? languageApiSchema
      : extractor.category === "image"
        ? imageApiSchema
        : videoApiSchema;
  const envelope = z
    .object({ models: z.array(z.unknown()).min(1) })
    .strip()
    .parse(body);
  const values = recognizeItems({
    label: `xAI ${extractor.category} model inventory`,
    items: envelope.models,
    schema,
    modelId: "id",
    rootKeys:
      extractor.category === "language"
        ? languageApiFields
        : extractor.category === "image"
          ? imageApiFields
          : detailedApiFields,
    skipInvalidItems: true,
    ...(input.onContractFinding === undefined ? {} : { onFinding: input.onContractFinding }),
  });
  const type: ModelTask =
    extractor.category === "language"
      ? "text_generation"
      : extractor.category === "image"
        ? "image_generation"
        : "video_generation";
  return values.map((value) =>
    model(input, value.id, {
      version: value.version,
      aliases: value.aliases,
      tasks: [type],
      modalities: { input: value.input_modalities, output: value.output_modalities },
      scope: "runtime_observation",
    }),
  );
}
