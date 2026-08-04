import { z } from "zod";
import { linkedBundleSchema } from "./bundle.ts";
import { isCredentialLikeIdentifier, modelIdSchema } from "./identity.ts";
import { baseModel, modelRouteKey } from "./model.ts";
import type { SourceManifest } from "./manifests.ts";
import type { PricingReconciliationItem } from "./pricing-reconciliation.ts";
import { orderedTasks } from "./task.ts";
import { publishedRate } from "./pricing.ts";
import type { ParsedProviderModel as ProviderModel, SourcePriceFact } from "./pricing-source.ts";
import { assertItemCount } from "./source-contract.ts";
import {
  modalitySchema,
  type Modality,
  type ModelRoute,
  type ModelTask,
  type Provider,
  unknownCapabilities,
} from "./schema.ts";

interface Input {
  provider: Provider;
  source: SourceManifest;
  body: string;
  observedAt: string;
  onPricingReconciliation?: (item: PricingReconciliationItem) => void;
}

interface TaskFacts {
  tasks: ModelTask[];
  input: Modality[];
  output: Modality[];
}

const decimal = z
  .union([z.string(), z.number().finite().nonnegative()])
  .transform((value) => String(value));
const hubIdSchema = modelIdSchema.refine((value) => {
  const parts = value.split("/");
  return parts.length === 2 && parts.every((part) => /^[a-z0-9][a-z0-9._-]*$/i.test(part));
}, "Expected a Hugging Face repository ID");
const mappingEntrySchema = z.object({
  _id: z.string().min(1),
  providerId: z.string().min(1),
  status: z.literal("live"),
  adapterType: z.literal("lora").optional(),
  tags: z.array(z.string().min(1)).min(1).optional(),
});
const mappingSchema = z.record(z.string().min(1), z.record(z.string().min(1), mappingEntrySchema));
const routeSchema = z.object({
  provider: z.string().min(1),
  status: z.enum(["live", "error"]),
  context_length: z.number().int().positive().optional(),
  pricing: z.object({ input: decimal, output: decimal }).optional(),
  is_free: z.boolean().optional(),
  supports_tools: z.boolean().optional(),
  supports_structured_output: z.boolean().optional(),
  first_token_latency_ms: z.number().finite().nonnegative().optional(),
  throughput: z.number().finite().nonnegative().optional(),
  is_model_author: z.boolean().optional(),
});
const routerItemSchema = z.object({
  id: hubIdSchema,
  object: z.literal("model"),
  created: z.number().int().nonnegative(),
  owned_by: z.string().min(1),
  architecture: z.object({
    input_modalities: z.array(modalitySchema),
    output_modalities: z.array(modalitySchema),
  }),
  providers: z.array(routeSchema).min(1),
});
const routerSchema = z.object({ object: z.literal("list"), data: z.array(routerItemSchema) });
const hubSchema = z.object({
  models: z.array(
    z.object({
      id: hubIdSchema,
      lastModified: z.iso.datetime({ offset: true }),
    }),
  ),
});

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function facts(task: string): TaskFacts {
  switch (task) {
    case "conversational":
    case "text-generation":
    case "summarization":
    case "question-answering":
    case "table-question-answering":
    case "fill-mask":
      return { tasks: ["text_generation"], input: ["text"], output: ["text"] };
    case "translation":
      return { tasks: ["translation"], input: ["text"], output: ["text"] };
    case "document-question-answering":
      return { tasks: ["text_generation"], input: ["text", "image"], output: ["text"] };
    case "image-to-text":
    case "visual-question-answering":
      return { tasks: ["text_generation"], input: ["image"], output: ["text"] };
    case "feature-extraction":
    case "sentence-similarity":
      return { tasks: ["embeddings"], input: ["text"], output: ["embedding"] };
    case "text-ranking":
      return { tasks: ["reranking"], input: ["text"], output: [] };
    case "automatic-speech-recognition":
      return { tasks: ["transcription"], input: ["audio"], output: ["text"] };
    case "text-to-speech":
      return { tasks: ["speech_synthesis"], input: ["text"], output: ["audio"] };
    case "text-to-audio":
      return { tasks: ["audio_generation"], input: ["text"], output: ["audio"] };
    case "audio-to-audio":
      return { tasks: ["audio_generation"], input: ["audio"], output: ["audio"] };
    case "text-to-image":
      return { tasks: ["image_generation"], input: ["text"], output: ["image"] };
    case "image-to-image":
      return { tasks: ["image_generation"], input: ["image"], output: ["image"] };
    case "text-to-video":
      return { tasks: ["video_generation"], input: ["text"], output: ["video"] };
    case "image-to-video":
      return { tasks: ["video_generation"], input: ["image"], output: ["video"] };
    case "audio-classification":
      return { tasks: ["classification"], input: ["audio"], output: ["text"] };
    case "image-classification":
    case "zero-shot-image-classification":
      return { tasks: ["classification"], input: ["image"], output: ["text"] };
    case "image-segmentation":
      return { tasks: ["segmentation"], input: ["image"], output: ["image"] };
    case "object-detection":
      return { tasks: ["object_detection"], input: ["image"], output: [] };
    case "text-classification":
    case "token-classification":
    case "zero-shot-classification":
    case "tabular-classification":
      return { tasks: ["classification"], input: ["text"], output: ["text"] };
    default:
      return { tasks: [], input: [], output: [] };
  }
}

function validateTagFilter(rawId: string, entry: z.infer<typeof mappingEntrySchema>): void {
  const filterTags = rawId.slice("tag-filter=".length).split(",");
  const entryTags = entry.tags ?? [];
  if (
    entry.adapterType !== "lora" ||
    filterTags.some((tag) => tag.length === 0) ||
    new Set(filterTags).size !== filterTags.length ||
    new Set(entryTags).size !== entryTags.length ||
    [...filterTags].sort().join("\0") !== [...entryTags].sort().join("\0")
  )
    throw new Error("Invalid Hugging Face tag filter contract");
}

export function parseHuggingFaceMapping(input: Input): ProviderModel[] {
  const config = input.source.extractor;
  if (config.kind !== "huggingface-mapping")
    throw new Error("Invalid Hugging Face mapping extractor");
  const groups = mappingSchema.parse(JSON.parse(input.body));
  const models = new Map<string, ProviderModel>();
  for (const [task, entries] of Object.entries(groups)) {
    const observed = facts(task);
    for (const [rawId, entry] of Object.entries(entries)) {
      if (rawId.startsWith("tag-filter=")) {
        validateTagFilter(rawId, entry);
        continue;
      }
      if (isCredentialLikeIdentifier(rawId) || isCredentialLikeIdentifier(entry.providerId))
        continue;
      const id = hubIdSchema.parse(rawId);
      const current = models.get(id) ?? {
        ...baseModel({
          providerId: input.provider.id,
          id,
          name: id,
          sourceId: input.source.id,
          observedAt: input.observedAt,
        }),
        status: "active",
      };
      const route: ModelRoute = {
        source_ref: input.source.id,
        provider: config.provider,
        provider_model_id: entry.providerId,
        task,
        status: "live",
      };
      const routes = [...(current.routes ?? []), route].sort((left, right) =>
        modelRouteKey(left).localeCompare(modelRouteKey(right)),
      );
      const tasks = orderedTasks([...current.tasks, ...observed.tasks]);
      models.set(id, {
        ...current,
        tasks,
        routes,
        modalities: {
          input: unique([...current.modalities.input, ...observed.input]),
          output: unique([...current.modalities.output, ...observed.output]),
        },
      });
    }
  }
  assertItemCount("Hugging Face mappings", models.size, config.minModels, config.maxModels);
  const values = [...models.values()].sort((left, right) => left.uid.localeCompare(right.uid));
  for (const value of values)
    input.onPricingReconciliation?.({
      disposition: "unbound",
      reason_code: "hf_inference_compute_price_unbound",
      sample: value.model_id,
    });
  return values;
}

function availability(values: (boolean | undefined)[]): boolean | "unknown" {
  if (values.some((value) => value === true)) return true;
  if (values.length > 0 && values.every((value) => value === false)) return false;
  return "unknown";
}

function routeRates(route: z.infer<typeof routeSchema>, sourceId: string): SourcePriceFact[] {
  const conditions = { route_provider: route.provider };
  if (route.is_free === true) {
    if (
      [route.pricing?.input, route.pricing?.output].some(
        (price) => price !== undefined && !/^0(?:\.0+)?$/.test(price),
      )
    )
      throw new Error(`Hugging Face route ${route.provider} is both free and priced`);
    return (["input_text", "output_text"] as const).map((meter) =>
      publishedRate(meter, "0", "million_tokens", sourceId, "currently free route", {
        ...conditions,
        promotion: true,
      }),
    );
  }
  const rates: SourcePriceFact[] = [];
  if (route.pricing?.input !== undefined)
    rates.push(
      publishedRate(
        "input_text",
        route.pricing.input,
        "million_tokens",
        sourceId,
        "USD / million tokens",
        conditions,
      ),
    );
  if (route.pricing?.output !== undefined)
    rates.push(
      publishedRate(
        "output_text",
        route.pricing.output,
        "million_tokens",
        sourceId,
        "USD / million tokens",
        conditions,
      ),
    );
  return rates;
}

function companion(bundle: z.infer<typeof linkedBundleSchema>, pathname: string): string {
  const matches = bundle.documents.filter(({ url }) => new URL(url).pathname === pathname);
  if (matches.length !== 1) throw new Error(`Hugging Face bundle requires exactly one ${pathname}`);
  return matches[0]?.body ?? "";
}

function requireClaims(body: string, claims: readonly string[], message: string): void {
  if (claims.some((claim) => !body.includes(claim))) throw new Error(message);
}

function commercialEvidence(input: Input, bundle: z.infer<typeof linkedBundleSchema>): void {
  const pricing = companion(bundle, "/docs/inference-providers/en/pricing.md");
  requireClaims(
    pricing,
    [
      "with no markup from Hugging Face",
      "$0.10, subject to change",
      "$2.00 per seat",
      "same rates as the provider",
      "broken down by model and provider",
      "Hugging Face won't charge you for the call",
      "compute time x price of the underlying hardware",
      '"X-HF-Bill-To: my-org-name"',
      "set a spending limit",
      "disable a set of Inference Providers",
    ],
    "Hugging Face pricing and account-billing reference drifted",
  );

  const overview = companion(bundle, "/docs/inference-providers/en/index.md");
  requireClaims(
    overview,
    [
      ":cheapest` for the most cost-efficient provider (lowest price per output token)",
      ":preferred` to follow your preference order",
      'provider="auto"',
      "Automatic Failover",
      "per-provider pricing",
      "throughput when available",
    ],
    "Hugging Face provider-selection reference drifted",
  );
  const sdk = companion(bundle, "/docs/huggingface_hub/en/guides/inference.md");
  const overviewUsesFastest = overview.includes(
    "automatically selects the fastest available provider for the specified model",
  );
  const sdkUsesPreference = sdk
    .replace(/\s+/g, " ")
    .includes(
      'default value is "auto" which will select the first of the providers available for the model, sorted by the user\'s order',
    );
  const autoPolicyConflict = overviewUsesFastest && sdkUsesPreference;
  if (!overviewUsesFastest && !sdkUsesPreference)
    throw new Error("Hugging Face automatic provider-selection evidence drifted");
  input.onPricingReconciliation?.({
    disposition: autoPolicyConflict ? "ambiguous" : "excluded",
    reason_code: autoPolicyConflict
      ? "auto_routing_policy_conflict"
      : "auto_routing_policy_not_price_fact",
  });

  requireClaims(
    companion(bundle, "/docs/inference-providers/en/hub-api.md"),
    [
      "inference_provider=all",
      "inferenceProviderMapping",
      "`input` and `output` prices in USD per million tokens, when available",
      "temporary promo",
      "Output throughput in tokens per second",
    ],
    "Hugging Face Hub routing API reference drifted",
  );
  const chat = companion(bundle, "/docs/inference-providers/en/tasks/chat-completion.md");
  requireClaims(
    chat,
    ["reasoning_effort", "include_usage", "completion_tokens", "prompt_tokens", "total_tokens"],
    "Hugging Face response-usage reference drifted",
  );
  requireClaims(
    companion(bundle, "/docs/inference-providers/en/guides/responses-api.md"),
    ["All Inference Providers chat completion models", "/v1/responses"],
    "Hugging Face Responses API reference drifted",
  );
  requireClaims(
    companion(bundle, "/docs/inference-providers/en/register-as-a-provider.md"),
    [
      "placeholder",
      "background job runs every minute",
      "cost in nano-USD (10^-9 USD)",
      "up to 10,000 request IDs",
      "30 minutes",
      "completed successfully",
      "`Inference-Id`",
      "Price in US dollars per million input tokens",
    ],
    "Hugging Face provider-cost reconciliation reference drifted",
  );
  requireClaims(
    companion(bundle, "/docs/hub/en/billing.md"),
    ["monitor your usage at any time from your billing dashboard", "beginning of each month"],
    "Hugging Face billing-history reference drifted",
  );

  for (const reason_code of [
    "account_credits_not_public_rates",
    "byok_direct_provider_billing",
    "billing_dashboard_out_of_catalog",
    "organization_billing_controls_not_rates",
    "provider_cost_api_not_user_accessible",
    "partner_mapping_catalog_out_of_scope",
  ])
    input.onPricingReconciliation?.({ disposition: "excluded", reason_code });
  const responseReturnsCost = ["costNanoUsd", "cost_in_usd", "exact_cost"].some((field) =>
    chat.includes(field),
  );
  input.onPricingReconciliation?.({
    disposition: responseReturnsCost ? "unsupported" : "excluded",
    reason_code: responseReturnsCost
      ? "response_exact_cost_unmodeled"
      : "response_exact_cost_not_documented",
  });
}

export function parseHuggingFaceRouter(input: Input): ProviderModel[] {
  const config = input.source.extractor;
  if (config.kind !== "huggingface-router")
    throw new Error("Invalid Hugging Face router extractor");
  const bundle = linkedBundleSchema.parse(JSON.parse(input.body));
  commercialEvidence(input, bundle);
  const items = routerSchema.parse(JSON.parse(bundle.index.body)).data;
  const ids = new Set<string>();
  const models: ProviderModel[] = [];
  for (const item of items) {
    if (isCredentialLikeIdentifier(item.id)) continue;
    if (ids.has(item.id)) throw new Error(`Duplicate Hugging Face router model ${item.id}`);
    ids.add(item.id);
    const providers = new Set<string>();
    for (const route of item.providers) {
      if (providers.has(route.provider))
        throw new Error(`Duplicate Hugging Face route ${item.id}:${route.provider}`);
      providers.add(route.provider);
    }
    const routeFacts = item.providers.map((route) => ({
      route,
      rates: route.status === "live" ? routeRates(route, input.source.id) : [],
    }));
    for (const { route, rates } of routeFacts) {
      const sample = `${item.id}:${route.provider}`;
      if (route.status === "error") {
        input.onPricingReconciliation?.({
          disposition: "excluded",
          reason_code: "route_not_live",
          sample,
        });
      } else if (rates.length === 0) {
        input.onPricingReconciliation?.({
          disposition: "unbound",
          reason_code: "route_price_not_published",
          sample,
        });
      } else {
        input.onPricingReconciliation?.({
          disposition: "normalized",
          reason_code: "route_price_normalized",
          sample,
        });
      }
    }
    const routes = routeFacts.filter(({ route }) => route.status === "live");
    if (routes.length === 0) continue;
    const pricing = routes.flatMap(({ rates }) => rates);
    const contexts = routes.flatMap((route) =>
      route.route.context_length === undefined ? [] : [route.route.context_length],
    );
    models.push({
      ...baseModel({
        providerId: input.provider.id,
        id: item.id,
        name: item.id,
        sourceId: input.source.id,
        observedAt: input.observedAt,
      }),
      tasks: ["text_generation"],
      modalities: {
        input: unique(item.architecture.input_modalities),
        output: unique(item.architecture.output_modalities),
      },
      api_endpoints: [
        { name: "Chat Completions", path: "/v1/chat/completions" },
        { name: "Responses", path: "/v1/responses" },
      ],
      capabilities: {
        ...unknownCapabilities(),
        streaming: true,
        tool_call: availability(routes.map(({ route }) => route.supports_tools)),
        structured_output: availability(
          routes.map(({ route }) => route.supports_structured_output),
        ),
      },
      limits: {
        context_tokens: contexts.length === 0 ? undefined : Math.max(...contexts),
      },
      pricing_state: pricing.length === 0 ? "unknown" : "numeric",
      price_facts: pricing,
      status: "active",
    });
  }
  assertItemCount("Hugging Face router models", models.length, config.minModels, config.maxModels);
  return models;
}

export function parseHuggingFaceHub(input: Input): ProviderModel[] {
  const config = input.source.extractor;
  if (config.kind !== "huggingface-hub") throw new Error("Invalid Hugging Face Hub extractor");
  const items = hubSchema.parse(JSON.parse(input.body)).models;
  const ids = new Set<string>();
  const models = items.flatMap((item) => {
    if (isCredentialLikeIdentifier(item.id)) return [];
    if (ids.has(item.id)) throw new Error(`Duplicate Hugging Face Hub model ${item.id}`);
    ids.add(item.id);
    return [
      {
        ...baseModel({
          providerId: input.provider.id,
          id: item.id,
          name: item.id,
          sourceId: input.source.id,
          observedAt: input.observedAt,
        }),
        updated_date: item.lastModified.slice(0, 10),
      },
    ];
  });
  assertItemCount("Hugging Face Hub models", models.length, config.minModels, config.maxModels);
  return models.sort((left, right) => left.uid.localeCompare(right.uid));
}
