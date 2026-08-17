import { load } from "cheerio";
import { z } from "zod";
import { linkedBundleSchema, linkedDocumentBody } from "./bundle.ts";
import { parseCoherePublicPricingProducts } from "./cohere.ts";
import { isCredentialLikeIdentifier, modelIdSchema } from "./identity.ts";
import { baseModel, modelRouteKey } from "./model.ts";
import { huggingFacePartnerIds, type SourceManifest } from "./manifests.ts";
import type { PricingReconciliationItem } from "./pricing-reconciliation.ts";
import { orderedTasks, providerTasks } from "./task.ts";
import { decimalsEqual, publishedRate, scaleDecimal } from "./pricing.ts";
import type {
  ParsedProviderModel as ProviderModel,
  SourcePriceFact,
  SourceRawPricingFact,
} from "./pricing-source.ts";
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
  catalogModels?: readonly Pick<ProviderModel, "model_id" | "price_facts" | "routes">[];
  onPricingReconciliation?: (item: PricingReconciliationItem) => void;
}

interface TaskFacts {
  tasks: ModelTask[];
  input: Modality[];
  output: Modality[];
}

const decimal = z
  .union([z.string(), z.number().finite().nonnegative()])
  .transform((value) => String(value))
  .pipe(z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/));
const hubIdSchema = modelIdSchema.refine((value) => {
  const parts = value.split("/");
  return parts.length === 2 && parts.every((part) => /^[a-z0-9][a-z0-9._-]*$/i.test(part));
}, "Expected a Hugging Face repository ID");
const mappingEntrySchema = z.object({
  _id: z.string().min(1),
  providerId: z.string().min(1),
  status: z.literal("live"),
  adapterType: z.unknown().optional(),
  tags: z.unknown().optional(),
});
const mappingSchema = z.record(z.string().min(1), z.record(z.string().min(1), z.unknown()));
const mappingBundleSchema = z.object({
  partners: z.array(
    z.object({
      provider: z.enum(huggingFacePartnerIds),
      models: mappingSchema,
    }),
  ),
  documents: z.array(z.object({ url: z.url(), body: z.string().min(1) })).min(1),
});
const routeSchema = z.object({
  provider: z.enum(huggingFacePartnerIds),
  status: z.enum(["live", "error"]),
  context_length: z.unknown().optional(),
  pricing: z.unknown().optional(),
  is_free: z.unknown().optional(),
  supports_tools: z.unknown().optional(),
  supports_structured_output: z.unknown().optional(),
  first_token_latency_ms: z.unknown().optional(),
  throughput: z.unknown().optional(),
  is_model_author: z.unknown().optional(),
});
const architectureSchema = z.object({
  input_modalities: z.array(modalitySchema),
  output_modalities: z.array(modalitySchema),
});
const routerItemSchema = z.object({
  id: hubIdSchema,
  object: z.literal("model"),
  created: z.unknown().optional(),
  owned_by: z.unknown().optional(),
  architecture: z.unknown().optional(),
  providers: z.array(z.unknown()).min(1),
});
const routerSchema = z.object({ object: z.literal("list"), data: z.array(z.unknown()) });
const hubItemSchema = z.object({
  _id: z.unknown().optional(),
  id: hubIdSchema,
  lastModified: z.iso.datetime({ offset: true }),
});
const hubSchema = z.object({
  models: z.array(z.unknown()),
});
const featherlessIndexSchema = z.object({ data: z.array(z.unknown()) });
const featherlessItemSchema = z.object({
  id: z.unknown(),
  context_length: z.unknown().optional(),
  max_completion_tokens: z.unknown().optional(),
  pricing: z.unknown().optional(),
});
const featherlessPricingSchema = z.object({
  prompt: z.unknown().optional(),
  completion: z.unknown().optional(),
  input: z.unknown().optional(),
  output: z.unknown().optional(),
});

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function diagnosticSample(...values: string[]): string {
  return values.join(":").slice(0, 256);
}

function modalityEntries(
  tasks: readonly string[],
  input: Modality[],
  output: Modality[],
): [string, Pick<TaskFacts, "input" | "output">][] {
  return tasks.map((task) => [task, { input, output }]);
}

const taskModalities = new Map([
  ...modalityEntries(
    [
      "conversational",
      "fill-mask",
      "question-answering",
      "summarization",
      "table-question-answering",
      "text-classification",
      "text-generation",
      "text-to-text-generation",
      "token-classification",
      "translation",
      "zero-shot-classification",
    ],
    ["text"],
    ["text"],
  ),
  ...modalityEntries(
    ["document-question-answering", "image-text-to-text"],
    ["text", "image"],
    ["text"],
  ),
  ...modalityEntries(
    [
      "image-classification",
      "image-to-text",
      "visual-question-answering",
      "zero-shot-image-classification",
    ],
    ["image"],
    ["text"],
  ),
  ...modalityEntries(["feature-extraction"], ["text"], ["embedding"]),
  ...modalityEntries(["sentence-similarity", "text-ranking"], ["text"], []),
  ...modalityEntries(["audio-classification", "automatic-speech-recognition"], ["audio"], ["text"]),
  ...modalityEntries(["text-to-audio", "text-to-speech"], ["text"], ["audio"]),
  ...modalityEntries(["audio-to-audio"], ["audio"], ["audio"]),
  ...modalityEntries(["text-to-image"], ["text"], ["image"]),
  ...modalityEntries(["image-segmentation", "image-to-image"], ["image"], ["image"]),
  ...modalityEntries(["text-to-video"], ["text"], ["video"]),
  ...modalityEntries(["image-text-to-video"], ["text", "image"], ["video"]),
  ...modalityEntries(["image-to-video"], ["image"], ["video"]),
  ...modalityEntries(["object-detection"], ["image"], []),
  ...modalityEntries(["tabular-classification"], [], ["text"]),
]);

function facts(task: string): TaskFacts {
  const modalities = taskModalities.get(task) ?? { input: [], output: [] };
  return { tasks: providerTasks(task), ...modalities };
}

function validTagFilter(rawId: string, entry: z.infer<typeof mappingEntrySchema>): boolean {
  const filterTags = rawId.slice("tag-filter=".length).split(",");
  const parsedTags = z.array(z.string().min(1)).min(1).safeParse(entry.tags);
  if (
    !parsedTags.success ||
    entry.adapterType !== "lora" ||
    filterTags.some((tag) => tag.length === 0) ||
    new Set(filterTags).size !== filterTags.length ||
    new Set(parsedTags.data).size !== parsedTags.data.length
  )
    return false;
  const entryTags = parsedTags.data;
  return [...filterTags].sort().join("\0") === [...entryTags].sort().join("\0");
}

function recommendedSection(body: string): string {
  const heading = /^###\s+Recommended models\s*\r?$/im.exec(body);
  if (heading === null) return "";
  const tail = body.slice(heading.index + heading[0].length);
  const next = /^###\s+/m.exec(tail);
  return next === null ? tail : tail.slice(0, next.index);
}

function officialTaskDocumentCandidates(
  documents: z.infer<typeof mappingBundleSchema>["documents"],
): Set<string> {
  const recommended = new Set<string>();
  const featured = new Set<string>();
  for (const { body } of documents) {
    for (const match of recommendedSection(body).matchAll(
      /^- \[([^\]\r\n]+)\]\((https:\/\/huggingface\.co\/[^\s)#?]+)\)(?::|\s|$)/gm,
    )) {
      const label = match[1];
      const target = match[2];
      if (label === undefined || target === undefined) continue;
      const parsedId = hubIdSchema.safeParse(label);
      if (!parsedId.success) continue;
      const url = new URL(target);
      if (url.pathname === `/${parsedId.data}`) recommended.add(parsedId.data);
    }
    for (const match of body.matchAll(/providersMapping=\{\s*(\{[^\r\n]+\})\s*\}/g)) {
      const raw = match[1];
      if (raw === undefined) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        continue;
      }
      const mapping = z.record(z.string(), z.unknown()).safeParse(parsed);
      if (!mapping.success) continue;
      for (const value of Object.values(mapping.data)) {
        const entry = z.object({ modelId: z.unknown() }).safeParse(value);
        if (!entry.success) continue;
        const parsedId = hubIdSchema.safeParse(entry.data.modelId);
        if (parsedId.success) featured.add(parsedId.data);
      }
    }
  }
  assertItemCount("Hugging Face recommended task models", recommended.size, 1, 10_000);
  assertItemCount("Hugging Face featured task models", featured.size, 1, 10_000);
  return new Set([...recommended, ...featured]);
}

export function parseHuggingFaceMapping(input: Input): ProviderModel[] {
  const config = input.source.extractor;
  if (config.kind !== "huggingface-mapping")
    throw new Error("Invalid Hugging Face mapping extractor");
  const bundle = mappingBundleSchema.parse(JSON.parse(input.body));
  const observedProviders = bundle.partners.map(({ provider }) => provider);
  if (
    new Set(observedProviders).size !== observedProviders.length ||
    observedProviders.join("\0") !== config.providers.join("\0")
  )
    throw new Error("Hugging Face partner mapping inventory changed");
  const documentedCandidates = officialTaskDocumentCandidates(bundle.documents);
  const models = new Map<string, ProviderModel>();
  const mappingIds = new Set<string>();
  let observedRouteCount = 0;
  for (const { provider, models: groups } of bundle.partners)
    for (const [task, entries] of Object.entries(groups)) {
      const observed = facts(task);
      for (const [rawId, rawEntry] of Object.entries(entries)) {
        const parsedEntry = mappingEntrySchema.safeParse(rawEntry);
        if (!parsedEntry.success) {
          input.onPricingReconciliation?.({
            disposition: "excluded",
            reason_code: "invalid_mapping_record",
            sample: diagnosticSample(provider, task, rawId),
          });
          continue;
        }
        const entry = parsedEntry.data;
        const mappingId = `${provider}\0${entry._id}`;
        if (mappingIds.has(mappingId)) {
          input.onPricingReconciliation?.({
            disposition: "excluded",
            reason_code: "duplicate_mapping_record",
            sample: diagnosticSample(provider, entry._id),
          });
          continue;
        }
        mappingIds.add(mappingId);
        if (rawId.startsWith("tag-filter=")) {
          input.onPricingReconciliation?.({
            disposition: "excluded",
            reason_code: validTagFilter(rawId, entry)
              ? "dynamic_lora_tag_filter_not_model_identity"
              : "invalid_dynamic_lora_filter",
            sample: diagnosticSample(provider, task, rawId),
          });
          continue;
        }
        if (isCredentialLikeIdentifier(rawId) || isCredentialLikeIdentifier(entry.providerId)) {
          input.onPricingReconciliation?.({
            disposition: "excluded",
            reason_code: "credential_like_identifier",
            sample: diagnosticSample(provider, task, rawId),
          });
          continue;
        }
        const parsedId = hubIdSchema.safeParse(rawId);
        if (!parsedId.success) {
          input.onPricingReconciliation?.({
            disposition: "excluded",
            reason_code: "invalid_model_id",
            sample: diagnosticSample(provider, task, rawId),
          });
          continue;
        }
        const id = parsedId.data;
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
          provider,
          provider_model_id: entry.providerId,
          task,
          status: "live",
        };
        if (
          current.routes?.some((value) => modelRouteKey(value) === modelRouteKey(route)) === true
        ) {
          input.onPricingReconciliation?.({
            disposition: "excluded",
            reason_code: "duplicate_mapping_route",
            sample: diagnosticSample(id, provider, task),
          });
          continue;
        }
        observedRouteCount += 1;
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
  assertItemCount(
    "Hugging Face concrete mapping routes",
    observedRouteCount,
    config.minRoutes,
    config.maxRoutes,
  );
  const admitted = new Map<string, ProviderModel>();
  let admittedRouteCount = 0;
  for (const [id, model] of models) {
    const routes = model.routes ?? [];
    const providers = new Set(routes.map(({ provider }) => provider));
    if (!providers.has("hf-inference") && providers.size < 2 && !documentedCandidates.has(id)) {
      input.onPricingReconciliation?.({
        disposition: "excluded",
        reason_code: "single_partner_inventory_without_product_evidence",
      });
      continue;
    }
    admitted.set(id, model);
    admittedRouteCount += routes.length;
    for (const route of routes)
      input.onPricingReconciliation?.({
        disposition: "unbound",
        reason_code:
          route.provider === "hf-inference"
            ? "hf_inference_compute_price_unbound"
            : "partner_route_price_not_published",
        sample: diagnosticSample(id, route.provider, route.task),
      });
  }
  assertItemCount("Hugging Face mappings", admitted.size, config.minModels, config.maxModels);
  assertItemCount(
    "Hugging Face catalog mapping routes",
    admittedRouteCount,
    config.minRoutes,
    config.maxRoutes,
  );
  return [...admitted.values()].sort((left, right) => left.uid.localeCompare(right.uid));
}

function availability(values: (boolean | undefined)[]): boolean | "unknown" {
  if (values.some((value) => value === true)) return true;
  if (values.length > 0 && values.every((value) => value === false)) return false;
  return "unknown";
}

interface RouteRateFacts {
  rates: SourcePriceFact[];
  rawFacts: SourceRawPricingFact[];
  invalidPrice: boolean;
}

const routePricingSchema = z.object({
  input: z.unknown().optional(),
  output: z.unknown().optional(),
});

function routePrices(raw: unknown): {
  input?: string;
  output?: string;
  invalid: boolean;
} {
  if (raw === undefined) return { invalid: false };
  const object = routePricingSchema.safeParse(raw);
  if (!object.success) return { invalid: true };
  const input = decimal.safeParse(object.data.input);
  const output = decimal.safeParse(object.data.output);
  return {
    ...(input.success ? { input: input.data } : {}),
    ...(output.success ? { output: output.data } : {}),
    invalid:
      (object.data.input !== undefined && !input.success) ||
      (object.data.output !== undefined && !output.success),
  };
}

function routeRates(route: z.infer<typeof routeSchema>, sourceId: string): RouteRateFacts {
  const conditions = {
    route_provider: route.provider,
    ...(route.is_free === true ? { promotion: false } : {}),
  };
  const prices = routePrices(route.pricing);
  const rates: SourcePriceFact[] = [];
  if (prices.input !== undefined)
    rates.push(
      publishedRate(
        "input_text",
        prices.input,
        "million_tokens",
        sourceId,
        "USD / million tokens",
        conditions,
      ),
    );
  if (prices.output !== undefined)
    rates.push(
      publishedRate(
        "output_text",
        prices.output,
        "million_tokens",
        sourceId,
        "USD / million tokens",
        conditions,
      ),
    );
  const rawFacts: SourceRawPricingFact[] = [];
  if (route.is_free === true)
    rawFacts.push({
      term_key: "route_promotional_free",
      impact: "base_price",
      reason: "unknown_amount",
      conditions: { route_provider: route.provider, promotion: true },
      source_ref: sourceId,
      raw: {
        label:
          "The route is currently free; its published list rates remain separate from the temporary promotion",
      },
    });
  if (prices.input === undefined || prices.output === undefined)
    rawFacts.push({
      term_key: "route_price_not_published",
      impact: "base_price",
      reason: "unknown_amount",
      conditions,
      source_ref: sourceId,
      raw: {
        label:
          prices.input === undefined && prices.output === undefined
            ? "Input and output route prices are not published"
            : prices.input === undefined
              ? "Input route price is not published"
              : "Output route price is not published",
      },
    });
  return {
    rates,
    rawFacts,
    invalidPrice:
      prices.invalid || (route.is_free !== undefined && typeof route.is_free !== "boolean"),
  };
}

function positiveInteger(value: unknown): number | undefined {
  const parsed = z.number().int().positive().safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function companion(bundle: z.infer<typeof linkedBundleSchema>, pathname: string): string {
  return linkedDocumentBody(
    bundle,
    pathname,
    `Hugging Face bundle requires exactly one ${pathname}`,
  );
}

function requireClaims(body: string, claims: readonly string[], message: string): void {
  if (claims.some((claim) => !body.includes(claim))) throw new Error(message);
}

function reviewedCompanion(
  input: Input,
  bundle: z.infer<typeof linkedBundleSchema>,
  pathname: string,
  claims: readonly string[],
  reasonCode: string,
): string | undefined {
  const matches = bundle.documents.filter(({ url }) => new URL(url).pathname === pathname);
  const body = matches[0]?.body;
  if (matches.length !== 1 || body === undefined || claims.some((claim) => !body.includes(claim))) {
    input.onPricingReconciliation?.({
      disposition: "unbound",
      reason_code: reasonCode,
      sample: pathname,
    });
    return;
  }
  return body;
}

function commercialEvidence(input: Input, bundle: z.infer<typeof linkedBundleSchema>): void {
  reviewedCompanion(
    input,
    bundle,
    "/docs/inference-providers/en/pricing.md",
    [
      "with no markup from Hugging Face",
      "same rates as the provider",
      "compute time x price of the underlying hardware",
    ],
    "inference_pricing_contract_drift",
  );

  const overview = reviewedCompanion(
    input,
    bundle,
    "/docs/inference-providers/en/index.md",
    [
      ":cheapest` for the most cost-efficient provider (lowest price per output token)",
      ":preferred` to follow your preference order",
      'provider="auto"',
      "Automatic Failover",
      "per-provider pricing",
      "throughput when available",
      "serverless inference",
      "single Hugging Face token",
    ],
    "provider_selection_contract_drift",
  );
  if (overview !== undefined) {
    const documented = new Set(
      unique(
        [...overview.matchAll(/\]\(\.\/providers\/([a-z0-9-]+)\)/g)].flatMap((match) =>
          match[1] === undefined ? [] : [match[1]],
        ),
      ),
    );
    for (const provider of huggingFacePartnerIds)
      if (!documented.has(provider))
        input.onPricingReconciliation?.({
          disposition: "unbound",
          reason_code: "documented_partner_missing",
          sample: provider,
        });
    for (const provider of documented)
      if (!huggingFacePartnerIds.includes(provider as (typeof huggingFacePartnerIds)[number]))
        input.onPricingReconciliation?.({
          disposition: "unsupported",
          reason_code: "documented_partner_not_collected",
          sample: provider,
        });
  }

  const providerRegistry = reviewedCompanion(
    input,
    bundle,
    "/huggingface/huggingface_hub/main/src/huggingface_hub/inference/_providers/__init__.py",
    ["PROVIDER_T", "Literal["],
    "sdk_provider_registry_drift",
  );
  if (providerRegistry !== undefined) {
    const providerLiteral = providerRegistry.match(/PROVIDER_T\s*=\s*Literal\[([\s\S]*?)\n\]/)?.[1];
    if (providerLiteral === undefined) {
      input.onPricingReconciliation?.({
        disposition: "unbound",
        reason_code: "sdk_provider_registry_drift",
      });
    } else {
      const sdkProviders = new Set(
        [...providerLiteral.matchAll(/^\s*"([a-z0-9-]+)",?\s*$/gm)].flatMap((match) =>
          match[1] === undefined ? [] : [match[1]],
        ),
      );
      for (const provider of [...huggingFacePartnerIds, "openai"])
        if (!sdkProviders.has(provider))
          input.onPricingReconciliation?.({
            disposition: "unbound",
            reason_code: "sdk_provider_missing",
            sample: provider,
          });
      for (const provider of sdkProviders)
        if (![...huggingFacePartnerIds, "openai"].includes(provider))
          input.onPricingReconciliation?.({
            disposition: "unsupported",
            reason_code: "sdk_provider_not_collected",
            sample: provider,
          });
    }
  }

  const sdk = reviewedCompanion(
    input,
    bundle,
    "/docs/huggingface_hub/en/guides/inference.md",
    [],
    "sdk_inference_contract_drift",
  );
  const overviewUsesFastest =
    overview?.includes(
      "automatically selects the fastest available provider for the specified model",
    ) === true;
  const sdkUsesPreference =
    sdk
      ?.replace(/\s+/g, " ")
      .includes(
        'default value is "auto" which will select the first of the providers available for the model, sorted by the user\'s order',
      ) === true;
  const autoPolicyConflict = overviewUsesFastest && sdkUsesPreference;
  if (overview !== undefined || sdk !== undefined)
    input.onPricingReconciliation?.({
      disposition: autoPolicyConflict ? "ambiguous" : "excluded",
      reason_code: autoPolicyConflict
        ? "auto_routing_policy_conflict"
        : overviewUsesFastest || sdkUsesPreference
          ? "auto_routing_policy_not_price_fact"
          : "auto_routing_policy_unresolved",
    });

  const chat = reviewedCompanion(
    input,
    bundle,
    "/docs/inference-providers/en/tasks/chat-completion.md",
    ["reasoning_effort", "include_usage", "completion_tokens", "prompt_tokens", "total_tokens"],
    "response_usage_contract_drift",
  );
  reviewedCompanion(
    input,
    bundle,
    "/docs/inference-providers/en/guides/responses-api.md",
    ["All Inference Providers chat completion models", "/v1/responses"],
    "responses_api_contract_drift",
  );
  if (chat !== undefined) {
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
}

export function parseHuggingFaceRouter(input: Input): ProviderModel[] {
  const config = input.source.extractor;
  if (config.kind !== "huggingface-router")
    throw new Error("Invalid Hugging Face router extractor");
  const bundle = linkedBundleSchema.parse(JSON.parse(input.body));
  const items = routerSchema.parse(JSON.parse(bundle.index.body)).data;
  const ids = new Set<string>();
  const models: ProviderModel[] = [];
  for (const [itemIndex, rawItem] of items.entries()) {
    const parsedItem = routerItemSchema.safeParse(rawItem);
    if (!parsedItem.success) {
      input.onPricingReconciliation?.({
        disposition: "excluded",
        reason_code: "invalid_router_model_record",
        sample: diagnosticSample("item", String(itemIndex)),
      });
      continue;
    }
    const item = parsedItem.data;
    if (isCredentialLikeIdentifier(item.id)) {
      input.onPricingReconciliation?.({
        disposition: "excluded",
        reason_code: "credential_like_identifier",
        sample: item.id,
      });
      continue;
    }
    if (ids.has(item.id)) {
      input.onPricingReconciliation?.({
        disposition: "excluded",
        reason_code: "duplicate_router_model",
        sample: item.id,
      });
      continue;
    }
    ids.add(item.id);
    const parsedArchitecture = architectureSchema.safeParse(item.architecture);
    if (!parsedArchitecture.success)
      input.onPricingReconciliation?.({
        disposition: "excluded",
        reason_code: "invalid_router_architecture",
        sample: item.id,
      });
    const providers = new Set<string>();
    const parsedRoutes: z.infer<typeof routeSchema>[] = [];
    for (const [routeIndex, rawRoute] of item.providers.entries()) {
      const parsedRoute = routeSchema.safeParse(rawRoute);
      if (!parsedRoute.success) {
        input.onPricingReconciliation?.({
          disposition: "excluded",
          reason_code: "invalid_router_route_record",
          sample: diagnosticSample(item.id, String(routeIndex)),
        });
        continue;
      }
      const route = parsedRoute.data;
      if (providers.has(route.provider)) {
        input.onPricingReconciliation?.({
          disposition: "excluded",
          reason_code: "duplicate_router_route",
          sample: diagnosticSample(item.id, route.provider),
        });
        continue;
      }
      providers.add(route.provider);
      parsedRoutes.push(route);
    }
    const routeFacts = parsedRoutes.map((route) => ({
      route,
      ...(route.status === "live"
        ? routeRates(route, input.source.id)
        : { rates: [], rawFacts: [], invalidPrice: false }),
    }));
    for (const { route, rates, rawFacts, invalidPrice } of routeFacts) {
      const sample = diagnosticSample(item.id, route.provider);
      if (route.status === "error") {
        input.onPricingReconciliation?.({
          disposition: "excluded",
          reason_code: "route_not_live",
          sample,
        });
        continue;
      }
      if (rawFacts.some(({ term_key }) => term_key === "route_promotional_free"))
        input.onPricingReconciliation?.({
          disposition: "explicit_non_numeric",
          reason_code: "route_promotional_free",
          sample,
        });
      if (invalidPrice)
        input.onPricingReconciliation?.({
          disposition: "ambiguous",
          reason_code: "route_price_field_invalid",
          sample,
        });
      if (rawFacts.some(({ term_key }) => term_key === "route_price_not_published"))
        input.onPricingReconciliation?.({
          disposition: "unbound",
          reason_code: "route_price_not_published",
          sample,
        });
      if (rates.length > 0)
        input.onPricingReconciliation?.({
          disposition: "normalized",
          reason_code: "route_price_normalized",
          sample,
        });
    }
    const routes = routeFacts.filter(({ route }) => route.status === "live");
    if (routes.length === 0) continue;
    const pricing = routes.flatMap(({ rates }) => rates);
    const rawPricing = routes.flatMap(({ rawFacts }) => rawFacts);
    const contexts = routes.flatMap((route) => {
      const context = positiveInteger(route.route.context_length);
      return context === undefined ? [] : [context];
    });
    const architecture = parsedArchitecture.success
      ? parsedArchitecture.data
      : { input_modalities: [], output_modalities: [] };
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
        input: unique(architecture.input_modalities),
        output: unique(architecture.output_modalities),
      },
      api_endpoints: [
        { name: "Chat Completions", path: "/v1/chat/completions" },
        { name: "Responses", path: "/v1/responses" },
      ],
      capabilities: {
        ...unknownCapabilities(),
        streaming: true,
        tool_call: availability(routes.map(({ route }) => optionalBoolean(route.supports_tools))),
        structured_output: availability(
          routes.map(({ route }) => optionalBoolean(route.supports_structured_output)),
        ),
      },
      limits: {
        context_tokens: contexts.length === 0 ? undefined : Math.max(...contexts),
      },
      pricing_state: pricing.length > 0 ? "numeric" : "unknown",
      price_facts: pricing,
      raw_price_facts: rawPricing,
      status: "active",
    });
  }
  assertItemCount("Hugging Face router models", models.length, config.minModels, config.maxModels);
  commercialEvidence(input, bundle);
  return models;
}

interface FeatherlessRate {
  rate?: SourcePriceFact;
  alternative?: SourcePriceFact;
  conflict: boolean;
  invalid: boolean;
}

function featherlessRate(
  meter: "input_text" | "output_text",
  perTokenRaw: unknown,
  perMillionRaw: unknown,
  sourceId: string,
  modelId: string,
): FeatherlessRate {
  const perToken = decimal.safeParse(perTokenRaw);
  const perMillion = decimal.safeParse(perMillionRaw);
  const normalizedToken = perToken.success ? scaleDecimal(perToken.data, 6) : undefined;
  const price = normalizedToken ?? (perMillion.success ? perMillion.data : undefined);
  if (price === undefined)
    return {
      conflict: false,
      invalid: perTokenRaw !== undefined || perMillionRaw !== undefined,
    };
  const rate: SourcePriceFact = {
    ...publishedRate(
      meter,
      price,
      "million_tokens",
      sourceId,
      normalizedToken === undefined
        ? "USD per million tokens"
        : "USD per token; normalized to USD per million tokens",
      { route_provider: "featherless-ai" },
    ),
    source_locator: {
      kind: "provider_key",
      value: `${modelId}:pricing.${meter === "input_text" ? "prompt" : "completion"}`,
    },
    resolution_policy: "featherless_native_price_over_huggingface_route_snapshot",
  };
  const alternative: SourcePriceFact | undefined =
    normalizedToken !== undefined &&
    perMillion.success &&
    !decimalsEqual(normalizedToken, perMillion.data)
      ? {
          ...publishedRate(
            meter,
            perMillion.data,
            "million_tokens",
            sourceId,
            "USD per million tokens",
            { route_provider: "featherless-ai" },
          ),
          source_locator: {
            kind: "provider_key",
            value: `${modelId}:pricing.${meter === "input_text" ? "input" : "output"}`,
          },
        }
      : undefined;
  return {
    rate,
    ...(alternative === undefined ? {} : { alternative }),
    conflict: alternative !== undefined,
    invalid:
      (perTokenRaw !== undefined && !perToken.success) ||
      (perMillionRaw !== undefined && !perMillion.success),
  };
}

export function parseHuggingFaceFeatherless(input: Input): ProviderModel[] {
  const config = input.source.extractor;
  if (config.kind !== "huggingface-featherless")
    throw new Error("Invalid Hugging Face Featherless extractor");
  const bundle = linkedBundleSchema.parse(JSON.parse(input.body));
  requireClaims(
    companion(bundle, "/docs/api-reference-models"),
    [
      "This endpoint can be called from either an authenticated or unauthenticated context.",
      "When omitted, only active models are returned.",
      "per-token pricing (always included",
      "per-token prices in USD as decimal strings",
    ],
    "Featherless models API reference drifted",
  );
  requireClaims(
    companion(bundle, "/docs/request-pricing-and-credits"),
    [
      "Formula: input tokens x input price + output tokens x output price.",
      "Prices are listed per 1M tokens.",
      "exact price of a specific model",
    ],
    "Featherless request-pricing reference drifted",
  );
  const items = featherlessIndexSchema.parse(JSON.parse(bundle.index.body)).data;
  const eligible =
    input.catalogModels === undefined
      ? undefined
      : new Set(
          input.catalogModels.flatMap((model) =>
            model.routes?.some(({ provider }) => provider === "featherless-ai") === true
              ? [model.model_id]
              : [],
          ),
        );
  const observedEligible = new Set<string>();
  const models = new Map<string, ProviderModel>();
  for (const [index, rawItem] of items.entries()) {
    const parsedItem = featherlessItemSchema.safeParse(rawItem);
    if (!parsedItem.success) {
      input.onPricingReconciliation?.({
        disposition: "excluded",
        reason_code: "invalid_featherless_model_record",
        sample: `item:${index}`,
      });
      continue;
    }
    const parsedId = modelIdSchema.safeParse(parsedItem.data.id);
    if (!parsedId.success || isCredentialLikeIdentifier(String(parsedItem.data.id))) {
      input.onPricingReconciliation?.({
        disposition: "excluded",
        reason_code: "invalid_featherless_model_id",
        sample: `item:${index}`,
      });
      continue;
    }
    const id = parsedId.data;
    if (eligible !== undefined && !eligible.has(id)) {
      input.onPricingReconciliation?.({
        disposition: "excluded",
        reason_code: "featherless_model_not_hf_route",
        sample: id,
      });
      continue;
    }
    observedEligible.add(id);
    const parsedPricing = featherlessPricingSchema.safeParse(parsedItem.data.pricing);
    const inputRate = featherlessRate(
      "input_text",
      parsedPricing.success ? parsedPricing.data.prompt : undefined,
      parsedPricing.success ? parsedPricing.data.input : undefined,
      input.source.id,
      id,
    );
    const outputRate = featherlessRate(
      "output_text",
      parsedPricing.success ? parsedPricing.data.completion : undefined,
      parsedPricing.success ? parsedPricing.data.output : undefined,
      input.source.id,
      id,
    );
    const rates = [
      inputRate.rate,
      inputRate.alternative,
      outputRate.rate,
      outputRate.alternative,
    ].filter((rate): rate is SourcePriceFact => rate !== undefined);
    const conflicted = inputRate.conflict || outputRate.conflict;
    const invalid = !parsedPricing.success || inputRate.invalid || outputRate.invalid;
    input.onPricingReconciliation?.({
      disposition:
        conflicted || invalid ? "ambiguous" : rates.length > 0 ? "normalized" : "unresolved",
      reason_code: conflicted
        ? "featherless_price_unit_conflict"
        : invalid
          ? "featherless_price_field_invalid"
          : rates.length > 0
            ? "featherless_price_normalized"
            : "featherless_price_not_published",
      sample: id,
    });
    const context = positiveInteger(parsedItem.data.context_length);
    const maxOutput = positiveInteger(parsedItem.data.max_completion_tokens);
    const incoming: ProviderModel = {
      ...baseModel({
        providerId: input.provider.id,
        id,
        name: id,
        sourceId: input.source.id,
        observedAt: input.observedAt,
      }),
      limits: {
        ...(context === undefined ? {} : { context_tokens: context }),
        ...(maxOutput === undefined ? {} : { max_output_tokens: maxOutput }),
      },
      pricing_state: rates.length === 0 ? "unknown" : "numeric",
      price_facts: rates,
    };
    const current = models.get(id);
    if (current === undefined) {
      models.set(id, incoming);
      continue;
    }
    input.onPricingReconciliation?.({
      disposition: "ambiguous",
      reason_code: "duplicate_featherless_model",
      sample: id,
    });
    const factKey = (rate: SourcePriceFact): string =>
      JSON.stringify([
        rate.meter,
        rate.price,
        rate.currency,
        rate.unit,
        rate.conditions,
        rate.resolution_policy,
      ]);
    const facts = new Map(current.price_facts.map((rate) => [factKey(rate), rate]));
    for (const rate of incoming.price_facts) {
      const conflicts = current.price_facts.some(
        (previous) =>
          previous.meter === rate.meter &&
          JSON.stringify(previous.conditions) === JSON.stringify(rate.conditions) &&
          !decimalsEqual(previous.price, rate.price),
      );
      if (conflicts)
        input.onPricingReconciliation?.({
          disposition: "ambiguous",
          reason_code: "duplicate_featherless_price_conflict",
          sample: diagnosticSample(id, rate.meter),
        });
      facts.set(factKey(rate), rate);
    }
    models.set(id, {
      ...current,
      limits: { ...incoming.limits, ...current.limits },
      pricing_state: facts.size === 0 ? "unknown" : "numeric",
      price_facts: [...facts.values()],
    });
  }
  if (eligible !== undefined)
    for (const id of eligible)
      if (!observedEligible.has(id))
        input.onPricingReconciliation?.({
          disposition: "unresolved",
          reason_code: "hf_live_route_absent_from_featherless_active_catalog",
          sample: id,
        });
  assertItemCount(
    "Hugging Face Featherless models",
    models.size,
    config.minModels,
    config.maxModels,
  );
  return [...models.values()].sort((left, right) => left.uid.localeCompare(right.uid));
}

const nativePricingAuthority = "native_provider_price_over_huggingface_route_snapshot";
const nativePricingProviders = ["cohere", "fireworks-ai", "groq", "zai-org"] as const;
type NativePricingProvider = (typeof nativePricingProviders)[number];
type CatalogModel = NonNullable<Input["catalogModels"]>[number];

interface NativeRoute {
  model: CatalogModel;
  provider: NativePricingProvider;
  providerModelId: string;
}

interface NativePriceRow {
  input: string;
  output: string;
  locator: string;
}

function nativeDocument(
  input: Input,
  bundle: z.infer<typeof linkedBundleSchema>,
  hostname: string,
  pathname: string,
): string | undefined {
  const matches = bundle.documents.filter(({ url }) => {
    const parsed = new URL(url);
    return parsed.hostname === hostname && parsed.pathname === pathname;
  });
  if (matches.length === 1) return matches[0]?.body;
  input.onPricingReconciliation?.({
    disposition: "unresolved",
    reason_code:
      matches.length === 0
        ? "native_pricing_document_missing"
        : "native_pricing_document_duplicate",
    sample: `${hostname}${pathname}`,
  });
  return;
}

function routePriceFacts(
  model: CatalogModel,
  provider: NativePricingProvider,
  meter: "input_text" | "output_text",
): SourcePriceFact[] {
  return model.price_facts.filter(
    (fact) => fact.meter === meter && fact.conditions.route_provider === provider,
  );
}

function nativePartnerRoutes(
  input: Input,
  bundle: z.infer<typeof linkedBundleSchema>,
): Map<string, Map<NativePricingProvider, Set<string>>> {
  const current = new Set(input.catalogModels?.map(({ model_id }) => model_id) ?? []);
  const result = new Map<string, Map<NativePricingProvider, Set<string>>>();
  for (const document of bundle.documents) {
    const url = new URL(document.url);
    if (url.hostname !== "huggingface.co") continue;
    const match = /^\/api\/partners\/(cohere|fireworks-ai|groq|zai-org)\/models$/.exec(
      url.pathname,
    );
    const provider = match?.[1] as NativePricingProvider | undefined;
    if (provider === undefined) continue;
    let value: unknown;
    try {
      value = JSON.parse(document.body);
    } catch {
      input.onPricingReconciliation?.({
        disposition: "unresolved",
        reason_code: "native_route_mapping_invalid",
        sample: provider,
      });
      continue;
    }
    const parsed = mappingSchema.safeParse(value);
    if (!parsed.success) {
      input.onPricingReconciliation?.({
        disposition: "unresolved",
        reason_code: "native_route_mapping_invalid",
        sample: provider,
      });
      continue;
    }
    for (const entries of Object.values(parsed.data))
      for (const [rawId, rawEntry] of Object.entries(entries)) {
        const id = hubIdSchema.safeParse(rawId);
        const entry = mappingEntrySchema.safeParse(rawEntry);
        if (!id.success || !entry.success || !current.has(id.data)) continue;
        const providers = result.get(id.data) ?? new Map();
        const providerModelIds = providers.get(provider) ?? new Set();
        providerModelIds.add(entry.data.providerId);
        providers.set(provider, providerModelIds);
        result.set(id.data, providers);
      }
  }
  return result;
}

function nativeRoutes(input: Input, bundle: z.infer<typeof linkedBundleSchema>): NativeRoute[] {
  if (input.catalogModels === undefined) return [];
  const partnerRoutes = nativePartnerRoutes(input, bundle);
  const result: NativeRoute[] = [];
  for (const model of input.catalogModels) {
    for (const provider of nativePricingProviders) {
      const providerModelIds = unique([
        ...(model.routes ?? []).flatMap((route) =>
          route.status === "live" && route.provider === provider ? [route.provider_model_id] : [],
        ),
        ...(partnerRoutes.get(model.model_id)?.get(provider) ?? []),
      ]);
      if (providerModelIds.length === 0) continue;
      if (providerModelIds.length > 1) {
        input.onPricingReconciliation?.({
          disposition: "ambiguous",
          reason_code: "native_route_model_id_ambiguous",
          sample: diagnosticSample(model.model_id, provider),
        });
        continue;
      }
      const providerModelId = providerModelIds[0];
      if (providerModelId === undefined) continue;
      const complete = (["input_text", "output_text"] as const).every(
        (meter) => routePriceFacts(model, provider, meter).length > 0,
      );
      if (!complete) result.push({ model, provider, providerModelId });
    }
  }
  return result;
}

function normalizeNativeName(value: string): string {
  return value.toLowerCase().replaceAll(/[^a-z0-9]/g, "");
}

function pricedToken(value: string): string | undefined {
  const parsed = /^\$((?:0|[1-9]\d*)(?:\.\d+)?)$/.exec(value.trim());
  return parsed?.[1];
}

interface FireworksRow extends NativePriceRow {
  slug: string;
  title: string;
}

function fireworksRows(body: string): FireworksRow[] {
  const $ = load(body);
  const rows = new Map<string, FireworksRow>();
  $('a[href^="/models/"]').each((_index, element) => {
    const href = $(element).attr("href");
    const title = $(element).find("h3").first().text().trim();
    if (href === undefined || title.length === 0) return;
    const text = $(element).text().replaceAll(/\s+/g, " ").trim();
    const price =
      /\$((?:0|[1-9]\d*)(?:\.\d+)?)\/M Input\s*•\s*\$((?:0|[1-9]\d*)(?:\.\d+)?)\/M Output/.exec(
        text,
      );
    const slug = new URL(href, "https://fireworks.ai").pathname.split("/").at(-1);
    if (price?.[1] === undefined || price[2] === undefined || slug === undefined) return;
    rows.set(href, {
      input: price[1],
      output: price[2],
      locator: `fireworks:${href}`,
      slug,
      title,
    });
  });
  return [...rows.values()];
}

function zaiRows(body: string): { prices: Map<string, NativePriceRow>; free: Set<string> } {
  const $ = load(body);
  const prices = new Map<string, NativePriceRow>();
  const free = new Set<string>();
  $("table").each((_tableIndex, table) => {
    const headers = $(table)
      .find("th")
      .map((_index, header) => $(header).text().trim())
      .get();
    const modelIndex = headers.indexOf("Model");
    const inputIndex = headers.indexOf("Input");
    const outputIndex = headers.indexOf("Output");
    if (modelIndex < 0 || inputIndex < 0 || outputIndex < 0) return;
    $(table)
      .find("tbody tr")
      .each((_rowIndex, row) => {
        const cells = $(row)
          .find("td")
          .map((_index, cell) => $(cell).text().trim())
          .get();
        const model = cells[modelIndex];
        const rawInput = cells[inputIndex];
        const rawOutput = cells[outputIndex];
        if (model === undefined || rawInput === undefined || rawOutput === undefined) return;
        const key = model.toLowerCase();
        if (rawInput === "Free" && rawOutput === "Free") {
          free.add(key);
          return;
        }
        const inputPrice = pricedToken(rawInput);
        const outputPrice = pricedToken(rawOutput);
        if (inputPrice === undefined || outputPrice === undefined) return;
        prices.set(key, {
          input: inputPrice,
          output: outputPrice,
          locator: `zai:${model}`,
        });
      });
  });
  return { prices, free };
}

function groqSafeguardRow(body: string): NativePriceRow | undefined {
  const $ = load(body);
  const rawText = $.root().text();
  const heading = $("h3")
    .filter((_index, element) => $(element).text().trim() === "PRICING")
    .first();
  const section = heading.parent();
  const price = (label: "Input" | "Output"): string | undefined => {
    const labelElement = section
      .find("div")
      .filter((_index, element) => {
        const ownText = $(element).clone().children().remove().end().text().trim();
        return ownText === label;
      })
      .first();
    const values = labelElement
      .parent()
      .find("div")
      .map((_index, element) => pricedToken($(element).text()))
      .get()
      .filter((value): value is string => value !== undefined);
    return new Set(values).size === 1 ? values[0] : undefined;
  };
  const inputPrice = price("Input");
  const outputPrice = price("Output");
  if (
    !rawText.includes("openai/gpt-oss-safeguard-20b") ||
    inputPrice === undefined ||
    outputPrice === undefined
  )
    return;
  return {
    input: inputPrice,
    output: outputPrice,
    locator: "groq:openai/gpt-oss-safeguard-20b",
  };
}

const cohereProductByModel = new Map([
  ["command-a-03-2025", "Command A"],
  ["command-r-08-2024", "Command R"],
  ["command-r7b-12-2024", "Command R7B"],
] as const);

function cohereRows(body: string): Map<string, NativePriceRow> {
  const prices = new Map<string, NativePriceRow>();
  const products = parseCoherePublicPricingProducts(body);
  for (const [providerModelId, productName] of cohereProductByModel) {
    const product = products.find(({ modelName }) => modelName === productName);
    if (product?.per !== "1M tokens") continue;
    const inputs = new Set<string>();
    const outputs = new Set<string>();
    for (const item of product.pricings ?? []) {
      if ((item.overridePer ?? product.per) !== "1M tokens") continue;
      if (
        item.inputLabel.toLowerCase() === "input" &&
        item.inputPrice !== null &&
        item.inputPrice !== undefined
      )
        inputs.add(String(item.inputPrice));
      if (
        item.outputLabel?.toLowerCase() === "output" &&
        item.outputPrice !== null &&
        item.outputPrice !== undefined
      )
        outputs.add(String(item.outputPrice));
    }
    const inputPrice = [...inputs][0];
    const outputPrice = [...outputs][0];
    if (
      inputs.size !== 1 ||
      outputs.size !== 1 ||
      inputPrice === undefined ||
      outputPrice === undefined
    )
      continue;
    prices.set(providerModelId, {
      input: inputPrice,
      output: outputPrice,
      locator: `cohere:${providerModelId}`,
    });
  }
  const decoded = body.replaceAll('\\"', '"');
  for (const [providerModelId, productName] of cohereProductByModel) {
    if (prices.has(providerModelId)) continue;
    const escapedName = productName.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = new RegExp(
      `"modelName":"${escapedName}","per":"1M tokens"[\\s\\S]{0,2500}?"pricings":\\[\\{[\\s\\S]{0,1000}?"inputLabel":"Input","inputPrice":((?:0|[1-9]\\d*)(?:\\.\\d+)?),"outputLabel":"Output","outputPrice":((?:0|[1-9]\\d*)(?:\\.\\d+)?)`,
    ).exec(decoded);
    if (match?.[1] === undefined || match[2] === undefined) continue;
    prices.set(providerModelId, {
      input: match[1],
      output: match[2],
      locator: `cohere:${providerModelId}`,
    });
  }
  const aya =
    /Aya Expanse models \(8B and 32B\) on the API are charged at \$((?:0|[1-9]\d*)(?:\.\d+)?)\/1M tokens for input and \$((?:0|[1-9]\d*)(?:\.\d+)?)\/1M tokens for output/i.exec(
      load(body).root().text().replaceAll(/\s+/g, " "),
    );
  if (aya?.[1] !== undefined && aya[2] !== undefined)
    prices.set("c4ai-aya-expanse-32b", {
      input: aya[1],
      output: aya[2],
      locator: "cohere:c4ai-aya-expanse-32b",
    });
  return prices;
}

function cohereCommandARow(body: string): NativePriceRow | undefined {
  const $ = load(body);
  if ($("h1").filter((_index, element) => $(element).text().trim() === "Command A").length !== 1)
    return;
  const text = $.root().text().replaceAll(/\s+/g, "");
  const match =
    /Input\$((?:0|[1-9]\d*)(?:\.\d+)?)\/1MtokensOutput\$((?:0|[1-9]\d*)(?:\.\d+)?)\/1Mtokens/.exec(
      text,
    );
  if (match?.[1] === undefined || match[2] === undefined) return;
  return {
    input: match[1],
    output: match[2],
    locator: "cohere:command-a-03-2025",
  };
}

function nativeRate(
  input: Input,
  route: NativeRoute,
  meter: "input_text" | "output_text",
  price: string,
  locator: string,
): SourcePriceFact {
  return {
    ...publishedRate(
      meter,
      price,
      "million_tokens",
      input.source.id,
      "Native provider USD per million tokens; Hugging Face routes without markup",
      { route_provider: route.provider },
    ),
    source_locator: {
      kind: "provider_key",
      value: `${locator}:${meter === "input_text" ? "input" : "output"}`,
    },
    resolution_policy: nativePricingAuthority,
  };
}

function addNativeRow(
  input: Input,
  models: Map<string, ProviderModel>,
  route: NativeRoute,
  row: NativePriceRow,
): boolean {
  const expected = { input_text: row.input, output_text: row.output } as const;
  for (const meter of ["input_text", "output_text"] as const) {
    const published = routePriceFacts(route.model, route.provider, meter);
    if (published.some(({ price }) => !decimalsEqual(price, expected[meter]))) {
      input.onPricingReconciliation?.({
        disposition: "ambiguous",
        reason_code: "native_route_price_conflict",
        sample: diagnosticSample(route.model.model_id, route.provider, meter),
      });
      return false;
    }
  }
  const rates = (["input_text", "output_text"] as const).flatMap((meter) =>
    routePriceFacts(route.model, route.provider, meter).length === 0
      ? [nativeRate(input, route, meter, expected[meter], row.locator)]
      : [],
  );
  if (rates.length === 0) return true;
  const current = models.get(route.model.model_id);
  const model =
    current ??
    ({
      ...baseModel({
        providerId: input.provider.id,
        id: route.model.model_id,
        name: route.model.model_id,
        sourceId: input.source.id,
        observedAt: input.observedAt,
      }),
      pricing_state: "numeric",
      price_facts: [],
    } satisfies ProviderModel);
  models.set(route.model.model_id, {
    ...model,
    pricing_state: "numeric",
    price_facts: [...model.price_facts, ...rates],
  });
  input.onPricingReconciliation?.({
    disposition: "normalized",
    reason_code: "native_route_price_normalized",
    sample: diagnosticSample(route.model.model_id, route.provider),
  });
  return true;
}

export function parseHuggingFaceNativePricing(input: Input): ProviderModel[] {
  const config = input.source.extractor;
  if (config.kind !== "huggingface-native-pricing")
    throw new Error("Invalid Hugging Face native pricing extractor");
  if (input.catalogModels === undefined)
    throw new Error("Hugging Face native pricing requires the catalog");
  const bundle = linkedBundleSchema.parse(JSON.parse(input.body));
  requireClaims(
    bundle.index.body,
    ["with no markup from Hugging Face", "same rates as the provider"],
    "Hugging Face native pass-through pricing contract drifted",
  );
  const routes = nativeRoutes(input, bundle);
  const models = new Map<string, ProviderModel>();
  const resolved = new Set<NativeRoute>();

  const fireworks = nativeDocument(input, bundle, "fireworks.ai", "/models");
  if (fireworks !== undefined) {
    const rows = fireworksRows(fireworks);
    for (const route of routes.filter(({ provider }) => provider === "fireworks-ai")) {
      const suffix = route.providerModelId.split("/").at(-1);
      const modelName = route.model.model_id.split("/").at(-1);
      const matches = rows.filter(
        ({ slug, title }) =>
          slug === suffix ||
          (modelName !== undefined &&
            normalizeNativeName(title) === normalizeNativeName(modelName)),
      );
      const row = matches.length === 1 ? matches[0] : undefined;
      if (row !== undefined && addNativeRow(input, models, route, row)) resolved.add(route);
      else if (matches.length > 1)
        input.onPricingReconciliation?.({
          disposition: "ambiguous",
          reason_code: "native_route_price_join_ambiguous",
          sample: diagnosticSample(route.model.model_id, route.provider),
        });
    }
  }

  const zai = nativeDocument(input, bundle, "docs.z.ai", "/guides/overview/pricing");
  if (zai !== undefined) {
    const rows = zaiRows(zai);
    for (const route of routes.filter(({ provider }) => provider === "zai-org")) {
      const key = route.providerModelId.toLowerCase();
      const row = rows.prices.get(key);
      if (row !== undefined && addNativeRow(input, models, route, row)) resolved.add(route);
      else if (rows.free.has(key))
        input.onPricingReconciliation?.({
          disposition: "ambiguous",
          reason_code: "native_free_conflicts_with_hf_paid_route",
          sample: diagnosticSample(route.model.model_id, route.providerModelId),
        });
    }
  }

  const groq = nativeDocument(
    input,
    bundle,
    "console.groq.com",
    "/docs/model/openai/gpt-oss-safeguard-20b",
  );
  if (groq !== undefined) {
    const row = groqSafeguardRow(groq);
    for (const route of routes.filter(
      ({ provider, providerModelId }) =>
        provider === "groq" && providerModelId === "openai/gpt-oss-safeguard-20b",
    ))
      if (row !== undefined && addNativeRow(input, models, route, row)) resolved.add(route);
  }

  const cohere = nativeDocument(input, bundle, "cohere.com", "/pricing");
  const commandA = nativeDocument(input, bundle, "docs.cohere.com", "/docs/command-a");
  if (cohere !== undefined || commandA !== undefined) {
    const rows = cohere === undefined ? new Map<string, NativePriceRow>() : cohereRows(cohere);
    const row = commandA === undefined ? undefined : cohereCommandARow(commandA);
    if (row !== undefined) rows.set("command-a-03-2025", row);
    for (const route of routes.filter(({ provider }) => provider === "cohere")) {
      const row = rows.get(route.providerModelId);
      if (row !== undefined && addNativeRow(input, models, route, row)) resolved.add(route);
    }
  }

  for (const route of routes)
    if (!resolved.has(route))
      input.onPricingReconciliation?.({
        disposition: "unresolved",
        reason_code: "native_route_price_not_exactly_joinable",
        sample: diagnosticSample(route.model.model_id, route.provider, route.providerModelId),
      });

  assertItemCount(
    "Hugging Face native pricing models",
    models.size,
    config.minModels,
    config.maxModels,
  );
  return [...models.values()].sort((left, right) => left.uid.localeCompare(right.uid));
}

export function parseHuggingFaceHub(input: Input): ProviderModel[] {
  const config = input.source.extractor;
  if (config.kind !== "huggingface-hub") throw new Error("Invalid Hugging Face Hub extractor");
  const items = hubSchema.parse(JSON.parse(input.body)).models;
  const latestModification = new Map<string, string>();
  for (const rawItem of items) {
    const parsedItem = hubItemSchema.safeParse(rawItem);
    if (!parsedItem.success || isCredentialLikeIdentifier(parsedItem.data.id)) continue;
    const { id, lastModified } = parsedItem.data;
    const current = latestModification.get(id);
    if (current === undefined || lastModified > current) latestModification.set(id, lastModified);
  }
  const models = [...latestModification].map(([id, lastModified]) => ({
    ...baseModel({
      providerId: input.provider.id,
      id,
      name: id,
      sourceId: input.source.id,
      observedAt: input.observedAt,
    }),
    updated_date: lastModified.slice(0, 10),
  }));
  assertItemCount("Hugging Face Hub models", models.length, config.minModels, config.maxModels);
  return models.sort((left, right) => left.uid.localeCompare(right.uid));
}
