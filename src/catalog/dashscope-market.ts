import { z } from "zod";
import { modelIdSchema } from "./identity.ts";
import { recognizeValue } from "./source-contract.ts";
import { baseModel } from "./model.ts";
import type { SourceParseInput } from "./source-parse.ts";
import type {
  ParsedProviderModel,
  SourceCommercialPricingFact,
  SourcePriceFact,
  SourceRawPricingFact,
} from "./pricing-source.ts";
import { publishedRate } from "./pricing.ts";

const marketApi = "zeldaHttp.dashscopeModel./zelda/api/v1/modelCenter/listFoundationModels";

export const dashscopeMarketRegions = [
  {
    id: "cn-beijing",
    label: "China (Beijing)",
    host: "bailian-cs.console.alibabacloud.com",
    consoleSite: "BAILIAN_ALIBABACLOUD",
    scopes: [{ id: "asia-pacific-china", label: "Chinese mainland" }],
  },
  {
    id: "ap-southeast-1",
    label: "Singapore",
    host: "bailian-singapore-cs.alibabacloud.com",
    consoleSite: "MODELSTUDIO_ALBABACLOUD",
    scopes: [{ id: "international", label: "International" }],
  },
  {
    id: "eu-central-1",
    label: "Germany (Frankfurt)",
    host: "modelstudio-eu-central-1-cs.data.alibabacloud.com",
    consoleSite: "EU_CENTRAL_1_ALIBABACLOUD",
    scopes: [
      { id: "global", label: "Global" },
      { id: "european-union", label: "EU" },
    ],
  },
  {
    id: "ap-northeast-1",
    label: "Japan (Tokyo)",
    host: "modelstudio-ap-northeast-1-cs.data.alibabacloud.com",
    consoleSite: "AP_NORTHEAST_1_ALIBABACLOUD",
    scopes: [
      { id: "global", label: "Global" },
      { id: "japan", label: "Japan" },
    ],
  },
  {
    id: "cn-hongkong",
    label: "Hong Kong (China)",
    host: "modelstudio-cn-hk-cs.data.alibabacloud.com",
    consoleSite: "CN_HONGKONG_ALIBABACLOUD",
    scopes: [
      { id: "global", label: "Global" },
      { id: "cn-hongkong", label: "Hong Kong (China)" },
    ],
  },
  {
    id: "us-east-1",
    label: "US (Virginia)",
    host: "modelstudio-us-va-cs.data.alibabacloud.com",
    consoleSite: "US_EAST_1_ALIBABACLOUD",
    scopes: [
      { id: "global", label: "Global" },
      { id: "united-states", label: "US" },
    ],
  },
] as const;

export type DashscopeMarketRegion = (typeof dashscopeMarketRegions)[number];
export type DashscopeMarketScope = DashscopeMarketRegion["scopes"][number];

const marketPageSchema = z.object({
  code: z.literal("200"),
  httpStatusCode: z.literal("200"),
  successResponse: z.literal(true),
  data: z.object({
    success: z.literal(true),
    httpStatus: z.literal(200),
    DataV2: z.object({
      ret: z.tuple([z.literal("SUCCESS::接口调用成功")]),
      data: z.object({
        codeEnum: z.literal("SUCCESS"),
        code: z.literal("200"),
        data: z.object({
          total: z.number().int().nonnegative(),
          pageNo: z.number().int().positive(),
          pageSize: z.number().int().positive(),
          list: z.array(z.unknown()),
        }),
      }),
    }),
  }),
});

const marketIdentitySchema = z.object({
  model: modelIdSchema,
  scope: z.enum(["PUBLIC", "APPLY"]),
  serviceSites: z.array(z.string().min(1)),
});

export function dashscopeMarketPage(value: unknown) {
  return recognizeValue("DashScope public model market", marketPageSchema, value).data.DataV2.data
    .data;
}

export function dashscopeMarketIdentity(value: unknown) {
  return recognizeValue("DashScope public market model", marketIdentitySchema, value);
}

export function dashscopeMarketRequest(
  region: DashscopeMarketRegion,
  scope: DashscopeMarketScope,
  pageNo: number,
  pageSize: number,
) {
  const url = new URL(`https://${region.host}/data/api.json`);
  url.search = new URLSearchParams({
    action: "IntlBroadScopeAspnGateway",
    product: "sfm_bailian",
    api: marketApi,
    _v: "",
  }).toString();
  return {
    url,
    form: [
      {
        name: "params",
        value: JSON.stringify({
          Api: marketApi,
          V: "1.0",
          Data: {
            input: {
              pageNo,
              pageSize,
              group: false,
              queryGroupByModel: false,
              supports: { inference: true },
              queryPrice: true,
              ignoreWorkspaceServiceSite: true,
              serviceSite: scope.id,
            },
            cornerstoneParam: {
              feURL: `https://modelstudio.console.alibabacloud.com/${region.id}/model/market`,
              protocol: "V2",
              console: "ONE_CONSOLE",
              productCode: "p_efm",
              switchUserType: 3,
              domain: "modelstudio.console.alibabacloud.com",
              consoleSite: region.consoleSite,
              xsp_lang: "en-US",
            },
          },
        }),
      },
      { name: "region", value: region.id },
    ],
  };
}

export const dashscopeMarketBundleSchema = z.object({
  market: z
    .array(
      z.object({
        region: z.string().min(1),
        scope: z.string().min(1),
        models: z.array(z.unknown()),
      }),
    )
    .optional(),
});

const marketPriceSchema = z.object({
  type: z.string().min(1),
  priceName: z.string().min(1),
  price: z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/),
  priceUnit: z.string().min(1),
  timeBand: z.string().optional(),
  discount: z.number().min(0).max(1).optional(),
});
const marketModelSchema = marketIdentitySchema.extend({
  supports: z.object({ inference: z.literal(true) }),
  prices: z.array(z.unknown()).optional(),
  multiPrices: z
    .array(
      z.object({
        rangeStart: z.number().nonnegative(),
        rangeEnd: z.number().positive(),
        rangeName: z.string().min(1),
        prices: z.array(z.unknown()),
      }),
    )
    .optional(),
  builtInToolMultiPrices: z
    .array(
      z.object({
        type: z.string().min(1),
        name: z.string().min(1),
        supportedApi: z.string().min(1),
        prices: z.array(
          z.object({
            price: z.string().min(1),
            priceUnit: z.string(),
            currency: z.string().min(1),
          }),
        ),
      }),
    )
    .optional(),
});

function tierConditions(label: string): SourcePriceFact["conditions"] {
  const match = label.match(/^(?:(\d+(?:\.\d+)?)([km])<)?Input<=(\d+(?:\.\d+)?)([km])$/i);
  if (match === null) return { context_tier: label };
  const tokens = (amount: string | undefined, suffix: string | undefined) =>
    Number(amount ?? 0) * (suffix?.toLowerCase() === "m" ? 1_000_000 : 1000);
  // The published billing labels and pricing guide use decimal K, unlike the console's UI bounds.
  return {
    context_min_tokens: tokens(match[1], match[2]),
    context_max_tokens: tokens(match[3], match[4]),
  };
}

function tokenMeter(type: string, id: string): SourcePriceFact["meter"] | undefined {
  if (type === "input_token") return "input_text";
  if (type === "output_token") return "output_text";
  if (type === "input_token_cache" || type === "input_token_cache_read") return "cache_read_text";
  if (type === "input_token_cache_creation_5m") return "cache_write_text";
  if (type === "embedding_token") return /rerank/.test(id) ? "input_text" : "embedding";
  return undefined;
}

function marketMeters(
  type: string,
  id: string,
):
  | {
      meters: SourcePriceFact["meter"][];
      unit: SourcePriceFact["unit"];
      conditions?: SourcePriceFact["conditions"];
    }
  | undefined {
  const token = tokenMeter(type, id);
  if (token !== undefined) return { meters: [token], unit: "million_tokens" };
  const textInput = ["text_input_token", "audio_text_input_token", "tts_input_token"];
  const textOutput = [
    "omni_text_output_token",
    "omni_no_audio_output_token",
    "audio_text_output_token",
    "asr_output_token",
    "translate_multi_text_output_token",
  ];
  const audioInput = [
    "omni_audio_input_token",
    "audio_input_token",
    "asr_input_token",
    "translate_audio_input_token",
  ];
  const audioOutput = ["tts_output_token", "translate_multi_output_token"];
  if (textInput.includes(type)) return { meters: ["input_text"], unit: "million_tokens" };
  if (textOutput.includes(type)) return { meters: ["output_text"], unit: "million_tokens" };
  if (audioInput.includes(type)) return { meters: ["input_audio"], unit: "million_tokens" };
  if (audioOutput.includes(type)) return { meters: ["output_audio"], unit: "million_tokens" };
  if (type === "omni_no_audio_input_token")
    return { meters: ["input_text", "input_image", "input_video"], unit: "million_tokens" };
  if (type === "vision_input_token")
    return { meters: ["input_image", "input_video"], unit: "million_tokens" };
  if (type === "translate_vision_input_token")
    return { meters: ["input_image"], unit: "million_tokens" };
  if (type === "embedding_image_token")
    return { meters: ["embedding"], unit: "million_tokens", conditions: { modality: "image" } };
  if (type === "purein_text_output_token" || type === "multiin_text_output_token")
    return {
      meters: ["output_text"],
      unit: "million_tokens",
      conditions: { modality: type.startsWith("purein") ? "text" : "multimodal" },
    };
  // Combined text/audio rows need model-specific accounting evidence. Their shared
  // console label disagrees with the newer model's pricing guide.
  if (type === "content_duration") return { meters: ["input_audio"], unit: "second" };
  if (type === "image_number") return { meters: ["image_generation"], unit: "image" };
  if (type === "image_standard" || type === "image_thinking")
    return {
      meters: ["image_generation"],
      unit: "image",
      conditions: { operation: type === "image_standard" ? "non_thinking_mode" : "thinking_mode" },
    };
  const image = type.match(/^(qima_input_|qima_output_|image_type_)([124]k)$/);
  if (image !== null)
    return {
      meters: [image[1] === "qima_input_" ? "input_image" : "image_generation"],
      unit: "image",
      conditions: { resolution: image[2]?.toUpperCase() },
    };
  const video = type.match(/^(?:video_ratio_(\d+p)|(\d+P)_no_audio)$/);
  if (video !== null)
    return {
      meters: ["video_generation"],
      unit: "second",
      conditions: {
        resolution: (video[1] ?? video[2])?.toUpperCase(),
        ...(video[2] === undefined ? {} : { audio: false }),
      },
    };
  if (type === "video_ratio" || type === "video_ratio_pro")
    return {
      meters: ["video_generation"],
      unit: "second",
      conditions: { quality: type === "video_ratio" ? "std" : "pro" },
    };
  return undefined;
}

function nativeUnit(unit: string): SourcePriceFact["unit"] | undefined {
  switch (unit) {
    case "Per 1M tokens":
      return "million_tokens";
    case "Per second":
      return "second";
    case "Per image":
      return "image";
    case "Per 1K calls":
      return "thousand_requests";
    case "Per call":
      return "request";
    default:
      return undefined;
  }
}

/** Retain every public price cell; normalize only reviewed meter and applicability contracts. */
export function parseDashscopeMarket(input: SourceParseInput, value: unknown) {
  const { market = [] } = dashscopeMarketBundleSchema.parse(value);
  const models: ParsedProviderModel[] = [];
  const commercial: SourceCommercialPricingFact[] = [];
  const inferenceUrls = new Map<string, string>();
  const scopes = new Set<string>();
  for (const context of market) {
    const region = dashscopeMarketRegions.find(({ id }) => id === context.region);
    const scope = region?.scopes.find(({ id }) => id === context.scope);
    if (region === undefined || scope === undefined)
      throw new Error("Unreviewed DashScope market context");
    const scopeKey = `${region.id}:${scope.id}`;
    if (scopes.has(scopeKey)) throw new Error("Duplicate DashScope market context");
    scopes.add(scopeKey);
    const ids = new Set<string>();
    for (const value of context.models) {
      const row = recognizeValue("DashScope market model prices", marketModelSchema, value);
      if (ids.has(row.model) || !row.serviceSites.includes(scope.id))
        throw new Error("Invalid DashScope market model scope");
      ids.add(row.model);
      if (!inferenceUrls.has(row.model))
        inferenceUrls.set(
          row.model,
          `https://modelstudio.console.alibabacloud.com/${region.id}/model/market/detail/${encodeURIComponent(row.model)}`,
        );
      const model = baseModel({
        providerId: input.provider.id,
        id: row.model,
        name: row.model,
        sourceId: input.source.id,
        observedAt: input.observedAt,
      });
      const conditions = { region: region.label, deployment_scope: scope.label };
      const rates: SourcePriceFact[] = [];
      const raw: SourceRawPricingFact[] = [];
      const groups = [
        { prices: row.prices ?? [], conditions: {} },
        ...(row.multiPrices ?? []).map((tier) => ({
          prices: tier.prices,
          conditions: tierConditions(tier.rangeName),
        })),
      ];
      for (const group of groups) {
        const prices = group.prices.map((price) =>
          recognizeValue("DashScope market price cell", marketPriceSchema, price),
        );
        const thinking = prices.some(({ type }) => type.startsWith("thinking_"));
        const audioOutput = prices.some(({ type }) =>
          /^(?:omni_audio|audio|multi)_output_token$/.test(type),
        );
        for (const price of prices) {
          const type = price.type.replace(/^thinking_/, "").replace(/_batch$/, "");
          const mapping = marketMeters(type, row.model);
          const publishedResolution = price.priceName.match(/\b(\d+[pk])\b/i)?.[1]?.toUpperCase();
          const resolutionConflict =
            mapping?.conditions?.resolution !== undefined &&
            publishedResolution !== undefined &&
            mapping.conditions.resolution !== publishedResolution;
          const batch = price.type.endsWith("_batch");
          const applicable: SourcePriceFact["conditions"] = {
            ...conditions,
            ...group.conditions,
            ...(resolutionConflict ? {} : mapping?.conditions),
            ...(audioOutput &&
            mapping?.meters.includes("output_text") &&
            type !== "omni_text_output_token"
              ? { audio: false }
              : {}),
            ...(type === "embedding_token" &&
            prices.some(({ type }) => type === "embedding_image_token")
              ? { modality: "text" }
              : {}),
            ...(batch ? { service_tier: "batch" } : {}),
            ...(thinking && mapping !== undefined
              ? {
                  operation: price.type.startsWith("thinking_")
                    ? "thinking_mode"
                    : "non_thinking_mode",
                }
              : {}),
            ...(price.timeBand === undefined || price.timeBand === "standard"
              ? {}
              : { billing_period: price.timeBand }),
            ...(type === "input_token_cache" ? { cache_mode: "implicit" } : {}),
            ...(type === "input_token_cache_read" || type === "input_token_cache_creation_5m"
              ? { cache_mode: "explicit", cache_ttl_seconds: 300 }
              : {}),
          };
          if (
            mapping !== undefined &&
            !resolutionConflict &&
            nativeUnit(price.priceUnit) === mapping.unit
          ) {
            for (const meter of mapping.meters)
              rates.push({
                ...publishedRate(
                  meter,
                  price.price,
                  mapping.unit,
                  input.source.id,
                  price.priceUnit,
                ),
                conditions: applicable,
                raw_price: price.price,
                raw_unit: price.priceUnit,
                source_locator: {
                  kind: "provider_key",
                  value: `${scopeKey}/${row.model}/${price.type}/${price.timeBand ?? "standard"}`,
                },
              });
            input.onPricingReconciliation?.({
              disposition: "normalized",
              reason_code: "market_price_normalized",
              sample: `${scopeKey}:${row.model}:${price.type}`,
            });
          } else {
            raw.push({
              term_key: `market:${price.type}`,
              impact: "base_price",
              reason:
                resolutionConflict ||
                ["omni_audio_output_token", "audio_output_token", "multi_output_token"].includes(
                  type,
                )
                  ? "unknown_applicability"
                  : mapping === undefined
                    ? "unknown_meter"
                    : "unknown_unit",
              conditions: applicable,
              source_ref: input.source.id,
              raw: {
                label: price.priceName,
                meter: price.type,
                amount: price.price,
                denomination: "USD",
                ...(price.priceUnit === "" ? {} : { unit: price.priceUnit }),
                fragment: JSON.stringify(price),
              },
            });
            input.onPricingReconciliation?.({
              disposition: "raw",
              reason_code: "market_price_not_normalized",
              sample: `${scopeKey}:${row.model}:${price.type}`,
            });
          }
          if (price.discount !== undefined) {
            raw.push({
              term_key: `market:discount:${price.type}`,
              impact: "informational",
              reason: "unknown_applicability",
              conditions: applicable,
              source_ref: input.source.id,
              raw: {
                label: `${price.priceName} limited-time discount`,
                amount: String(price.discount),
                formula: `Original USD ${price.price} × ${price.discount}`,
                fragment: JSON.stringify(price),
              },
            });
          }
        }
      }
      model.price_facts = rates;
      model.raw_price_facts = raw;
      model.pricing_state = rates.length > 0 ? "numeric" : "unknown";
      model.scope = "regional_catalog";
      model.availability = [{ region: region.label, deployment_type: "model_api" }];
      if (rates.some(({ meter }) => meter.startsWith("cache_")))
        model.capabilities.prompt_cache = true;
      models.push(model);
      for (const tool of row.builtInToolMultiPrices ?? []) {
        const normalized = tool.prices.flatMap((price): SourcePriceFact[] => {
          const unit = nativeUnit(price.priceUnit);
          if (unit === undefined || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(price.price)) return [];
          return [
            {
              ...publishedRate("tool_call", price.price, unit, input.source.id, price.priceUnit),
              currency: price.currency,
              conditions: { ...conditions, operation: tool.supportedApi },
              raw_price: price.price,
              raw_unit: price.priceUnit,
            },
          ];
        });
        commercial.push({
          source_ref: input.source.id,
          book_key: `service:market:${tool.type}`,
          book_name: `Model Studio ${tool.name} (${tool.supportedApi})`,
          resource_kind: "service",
          resource_key: tool.type,
          model_refs: [model.uid],
          offer_key: `${scopeKey}:${tool.supportedApi}`,
          offer_name: `${tool.name} in ${region.label} / ${scope.label}`,
          billing_mode: "usage",
          pricing_state: normalized.length > 0 ? "numeric" : "unknown",
          price_facts: normalized,
          raw_price_facts: tool.prices
            .filter(
              (price) =>
                nativeUnit(price.priceUnit) === undefined ||
                !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(price.price),
            )
            .map((price) => ({
              term_key: tool.type,
              impact: "base_price",
              reason: "unknown_unit",
              conditions: { ...conditions, operation: tool.supportedApi },
              source_ref: input.source.id,
              raw: {
                label: tool.name,
                meter: tool.type,
                amount: price.price,
                denomination: price.currency,
                ...(price.priceUnit === "" ? {} : { unit: price.priceUnit }),
                fragment: JSON.stringify(tool),
              },
            })),
        });
        input.onPricingReconciliation?.({
          disposition: normalized.length === tool.prices.length ? "normalized" : "raw",
          reason_code: "market_tool_price",
          sample: `${scopeKey}:${row.model}:${tool.type}`,
        });
      }
    }
  }
  return { models, commercial, inferenceUrls };
}
