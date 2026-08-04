import { load } from "cheerio";
import { z } from "zod";
import { modelIdSchema } from "./identity.ts";
import { baseModel } from "./model.ts";
import type { SourceManifest } from "./manifests.ts";
import { publishedRate } from "./pricing.ts";
import type { PricingReconciliationItem } from "./pricing-reconciliation.ts";
import type {
  ParsedProviderModel as ProviderModel,
  SourcePriceFact,
  SourceRawPricingFact,
} from "./pricing-source.ts";
import { assertItemCount } from "./source-contract.ts";
import { classifyModelTasks } from "./task.ts";
import { type Modality, type ModelTask, type Provider, unknownCapabilities } from "./schema.ts";

interface ParseInput {
  provider: Provider;
  source: SourceManifest;
  body: string;
  observedAt: string;
  onPricingReconciliation?: (item: PricingReconciliationItem) => void;
}

const badgeSchema = z.enum(["audio", "cloud", "embedding", "thinking", "tools", "vision"]);
const capabilitySchema = z.enum([
  "audio",
  "completion",
  "embedding",
  "image",
  "insert",
  "thinking",
  "tools",
  "vision",
]);
const detailsSchema = z.object({
  parent_model: z.string(),
  format: z.string(),
  family: z.string(),
  families: z.array(z.string()).nullable(),
  parameter_size: z.string(),
  quantization_level: z.string(),
});
const listItemSchema = z.object({
  name: modelIdSchema,
  model: modelIdSchema,
  modified_at: z.iso.datetime({ offset: true }),
  size: z.number().int().nonnegative(),
  digest: z.string().regex(/^[a-f0-9]{12,64}$/),
  details: detailsSchema,
});
const listSchema = z.object({ models: z.array(listItemSchema) });
const showSchema = z
  .object({
    capabilities: z.array(capabilitySchema).min(1),
    details: detailsSchema,
    model_info: z.record(z.string(), z.unknown()),
    modified_at: z.iso.datetime({ offset: true }),
    retirement_on: z.iso.datetime({ offset: true }).optional(),
  })
  .passthrough();
const errorSchema = z.strictObject({ error: z.string().min(1) });
const usageSchema = z.strictObject({
  model: modelIdSchema,
  label: z.enum(["low", "medium", "high", "extra high"]),
});
const pageSchema = z.strictObject({
  model: modelIdSchema,
  tags: z.array(z.union([usageSchema, z.strictObject({ model: modelIdSchema })])),
  cost: z
    .strictObject({
      input: z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/),
      cached: z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/),
      output: z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/),
      unit: z.literal("1M tokens"),
      accountEligibility: z.literal("extra_usage_balance"),
    })
    .optional(),
});
const bundleSchema = z.object({
  list: z.unknown(),
  catalog: z.object({ url: z.url(), body: z.string().min(1) }),
  pages: z.array(
    z.strictObject({
      model: modelIdSchema,
      url: z.url(),
      body: pageSchema,
    }),
  ),
  details: z.array(
    z.object({
      model: modelIdSchema,
      status: z.union([z.literal(200), z.literal(404), z.literal(410)]),
      body: z.unknown(),
    }),
  ),
  documents: z.array(z.strictObject({ url: z.url(), body: z.string().min(1) })),
});

const months = new Map(
  ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].map(
    (month, index) => [month, String(index + 1).padStart(2, "0")],
  ),
);

interface LibraryItem {
  id: string;
  description: string;
  badges: z.infer<typeof badgeSchema>[];
  updated: string;
}

const cloudFamily = "Ollama Cloud";
const libraryFamily = "Ollama Library";

function exactDate(value: string): string {
  const match = value.match(
    /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{1,2}), (\d{4}) \d{1,2}:\d{2} (?:AM|PM) UTC$/,
  );
  const month = match?.[1] === undefined ? undefined : months.get(match[1]);
  if (match?.[2] === undefined || match[3] === undefined || month === undefined)
    throw new Error("Ollama library update date changed shape");
  return `${match[3]}-${month}-${match[2].padStart(2, "0")}`;
}

function libraryItems(body: string): LibraryItem[] {
  const $ = load(body);
  const items = new Map<string, LibraryItem>();
  $('a[href^="/library/"]').each((_index, element) => {
    const anchor = $(element);
    const href = anchor.attr("href");
    const match = href?.match(/^\/library\/([a-z0-9][a-z0-9._-]*)$/i);
    if (match?.[1] === undefined) return;
    const id = modelIdSchema.parse(match[1]);
    const intro = anchor.children("div").first();
    const title = intro.find("h2").first().text().replace(/\s+/g, " ").trim();
    const description = intro.children("p").first().text().replace(/\s+/g, " ").trim();
    const badgeResults = anchor
      .find('span[class*="bg-indigo"], span[class*="bg-cyan"]')
      .map((_badgeIndex, badge) => badgeSchema.safeParse($(badge).text().trim()))
      .get();
    const updated = anchor
      .find("span[title]")
      .filter((_spanIndex, span) => $(span).text().includes("Updated"));
    if (
      title !== id ||
      description === "" ||
      badgeResults.some((result) => !result.success) ||
      updated.length !== 1
    )
      throw new Error("Ollama library card schema drift");
    const updateTitle = updated.attr("title");
    if (updateTitle === undefined) throw new Error("Ollama library card omitted update time");
    const item = {
      id,
      description,
      badges: badgeResults.flatMap((result) => (result.success ? [result.data] : [])),
      updated: exactDate(updateTitle),
    };
    const previous = items.get(id);
    if (previous !== undefined && JSON.stringify(previous) !== JSON.stringify(item))
      throw new Error("Ollama library contained conflicting model cards");
    items.set(id, item);
  });
  return [...items.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function facts(
  item: LibraryItem,
): Pick<
  ProviderModel,
  "capabilities" | "description" | "modalities" | "service_families" | "tasks" | "updated_date"
> {
  const badges = new Set(item.badges);
  const embedding = badges.has("embedding");
  const input: Modality[] = ["text"];
  if (badges.has("vision")) input.push("image");
  if (badges.has("audio")) input.push("audio");
  const modalities: ProviderModel["modalities"] = {
    input,
    output: embedding ? ["embedding"] : ["text"],
  };
  return {
    description: item.description,
    service_families: [libraryFamily],
    tasks: classifyModelTasks({
      modelId: item.id,
      name: item.id,
      rawType: embedding ? "embedding" : "language",
      modalities,
      fallback: embedding ? "embeddings" : "text_generation",
    }),
    modalities,
    capabilities: {
      ...unknownCapabilities(),
      reasoning: badges.has("thinking") ? true : "unknown",
      tool_call: badges.has("tools") ? true : "unknown",
    },
    updated_date: item.updated,
  };
}

function libraryModel(input: ParseInput, item: LibraryItem): ProviderModel {
  return {
    ...baseModel({
      providerId: input.provider.id,
      id: item.id,
      name: item.id,
      sourceId: input.source.id,
      observedAt: input.observedAt,
    }),
    ...facts(item),
    pricing_state: item.badges.includes("cloud") ? "not_published" : "not_applicable",
    status: "active",
  };
}

export function parseOllamaLibrary(input: ParseInput): ProviderModel[] {
  if (input.source.extractor.kind !== "ollama-library")
    throw new Error("Invalid Ollama library extractor");
  const models = libraryItems(input.body);
  const { minModels, maxModels } = input.source.extractor;
  assertItemCount("Ollama library models", models.length, minModels, maxModels);
  return models.map((item) => {
    const model = libraryModel(input, item);
    input.onPricingReconciliation?.({
      disposition: "explicit_non_numeric",
      reason_code: model.pricing_state,
      sample: model.model_id,
    });
    return model;
  });
}

function number(info: Record<string, unknown>, key: string): number | undefined {
  const value = info[key];
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function cloudModel(
  input: ParseInput,
  id: string,
  raw: unknown,
  listed?: z.infer<typeof listItemSchema>,
  library = false,
): ProviderModel {
  const show = showSchema.parse(raw);
  if (listed !== undefined && listed.name !== listed.model)
    throw new Error("Ollama cloud list identity mismatch");
  if (show.details.parent_model !== id) throw new Error("Ollama cloud model identity mismatch");
  if (listed !== undefined && show.modified_at !== listed.modified_at)
    throw new Error("Ollama cloud model update time mismatch");
  const capabilities = new Set(show.capabilities);
  if (
    !capabilities.has("completion") &&
    !capabilities.has("embedding") &&
    !capabilities.has("image")
  )
    throw new Error("Ollama cloud model omitted an operation capability");
  const modalityInput: Modality[] = ["text"];
  if (capabilities.has("vision")) modalityInput.push("image");
  if (capabilities.has("audio")) modalityInput.push("audio");
  const output: Modality[] = [];
  if (capabilities.has("completion")) output.push("text");
  if (capabilities.has("embedding")) output.push("embedding");
  if (capabilities.has("image")) output.push("image");
  const modalities = { input: modalityInput, output };
  const tasks: ModelTask[] = [];
  if (capabilities.has("completion")) tasks.push("text_generation");
  if (capabilities.has("embedding")) tasks.push("embeddings");
  if (capabilities.has("image")) tasks.push("image_generation");
  const architecture = show.model_info["general.architecture"];
  const context =
    typeof architecture === "string"
      ? number(show.model_info, `${architecture}.context_length`)
      : undefined;
  const dimension =
    capabilities.has("embedding") && typeof architecture === "string"
      ? number(show.model_info, `${architecture}.embedding_length`)
      : undefined;
  const retirement = show.retirement_on?.slice(0, 10);
  const retired = retirement !== undefined && retirement <= input.observedAt.slice(0, 10);
  return {
    ...baseModel({
      providerId: input.provider.id,
      id,
      name: id,
      sourceId: input.source.id,
      observedAt: input.observedAt,
    }),
    tasks,
    service_families: library ? [cloudFamily, libraryFamily] : [cloudFamily],
    modalities,
    capabilities: {
      ...unknownCapabilities(),
      reasoning: capabilities.has("thinking") ? true : "unknown",
      tool_call: capabilities.has("tools") ? true : "unknown",
      streaming: capabilities.has("completion") || capabilities.has("image") ? true : "unknown",
    },
    limits: {
      ...(context === undefined ? {} : { context_tokens: context }),
      ...(dimension === undefined ? {} : { embedding_dimensions: [dimension] }),
    },
    updated_date: show.modified_at.slice(0, 10),
    status: library || retirement === undefined ? "active" : retired ? "retired" : "deprecated",
    retired_at: library ? undefined : retirement,
    pricing_state: "not_published",
  };
}

function retiredModel(input: ParseInput, item: LibraryItem, raw: unknown): ProviderModel {
  const { error } = errorSchema.parse(raw);
  const match = error.match(
    /^(.+?) was retired at (\d{4}-\d{2}-\d{2}) \d{2}:\d{2}:\d{2} [+-]\d{4} [A-Z]+(?: \(ref: [0-9a-f-]{36}\))?$/,
  );
  if (match?.[1] !== item.id || match[2] === undefined)
    throw new Error("Ollama cloud retirement response changed shape");
  return {
    ...libraryModel(input, item),
    service_families: [cloudFamily, libraryFamily],
    pricing_state: "not_published",
  };
}

interface PagePricing {
  rates: SourcePriceFact[];
  raw: SourceRawPricingFact[];
}

function usageLevel(label: z.infer<typeof usageSchema>["label"]): number {
  switch (label) {
    case "low":
      return 1;
    case "medium":
      return 2;
    case "high":
      return 3;
    case "extra high":
      return 4;
  }
}

function pagePricing(
  bundle: z.infer<typeof bundleSchema>,
  sourceId: string,
): Map<string, PagePricing> {
  const result = new Map<string, PagePricing>();
  const pricing = (id: string): PagePricing => {
    const current = result.get(id);
    if (current !== undefined) return current;
    const created = { rates: [], raw: [] };
    result.set(id, created);
    return created;
  };
  for (const page of bundle.pages) {
    if (page.model !== page.body.model || new URL(page.url).pathname !== `/library/${page.model}`)
      throw new Error("Ollama cloud model-page identity mismatch");
    for (const tag of page.body.tags) {
      if (!("label" in tag)) continue;
      const value = pricing(tag.model);
      if (value.raw.length > 0) throw new Error("Ollama cloud model has conflicting usage levels");
      const level = usageLevel(tag.label);
      value.raw.push({
        term_key: "ollama_cloud_usage_level",
        impact: "allowance",
        reason: "requires_usage_aggregation",
        conditions: { account_eligibility: "included_plan_allowance" },
        source_ref: sourceId,
        raw: {
          label: `${tag.label} usage`,
          amount: String(level),
          unit: "usage level",
        },
      });
    }
    if (page.body.cost === undefined) continue;
    const value = pricing(page.model);
    if (value.rates.length > 0) throw new Error("Ollama cloud model has duplicate cost cards");
    const conditions = { account_eligibility: page.body.cost.accountEligibility };
    value.rates.push(
      publishedRate(
        "input_text",
        page.body.cost.input,
        "million_tokens",
        sourceId,
        page.body.cost.unit,
        conditions,
      ),
      publishedRate(
        "cache_read_text",
        page.body.cost.cached,
        "million_tokens",
        sourceId,
        page.body.cost.unit,
        conditions,
      ),
      publishedRate(
        "output_text",
        page.body.cost.output,
        "million_tokens",
        sourceId,
        page.body.cost.unit,
        conditions,
      ),
    );
  }
  return result;
}

function applyPagePricing(model: ProviderModel, pricing: PagePricing | undefined): ProviderModel {
  if (pricing === undefined) return model;
  return {
    ...model,
    pricing_state: pricing.rates.length > 0 ? "numeric" : "unknown",
    price_facts: pricing.rates,
    raw_price_facts: pricing.raw,
  };
}

function document(bundle: z.infer<typeof bundleSchema>, url: string): string {
  const matches = bundle.documents.filter((item) => item.url === url);
  const [match] = matches;
  if (matches.length !== 1 || match === undefined)
    throw new Error(`Ollama bundle omitted or duplicated ${url}`);
  return match.body;
}

function normalized(body: string): string {
  return load(body)
    .root()
    .text()
    .replace(/\\([_$*])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function requireClaims(
  bundle: z.infer<typeof bundleSchema>,
  url: string,
  claims: readonly RegExp[],
  label: string,
): string {
  const body = document(bundle, url);
  const text = normalized(body);
  if (claims.some((claim) => !claim.test(text))) throw new Error(`Ollama ${label} contract drift`);
  return body;
}

const docsCommercialPaths = new Set([
  "/api/anthropic-compatibility",
  "/api/authentication",
  "/api/openai-compatibility",
  "/api/usage",
  "/capabilities/thinking",
  "/capabilities/tool-calling",
  "/capabilities/vision",
  "/capabilities/web-search",
  "/cloud",
  "/openapi.yaml",
]);

function commercialIndexEntry(path: string, line: string): boolean {
  const normalizedPath = path.replace(/\.md$/, "");
  if (docsCommercialPaths.has(normalizedPath)) return true;
  if (normalizedPath.startsWith("/integrations/")) return false;
  return /\b(?:batch|billing|cache|costs?|credits?|meters?|pricing|quotas?|rates?|subscriptions?|usage)\b/i.test(
    line,
  );
}

function indexedCommercialUrls(body: string, origin: string): Set<string> {
  return new Set(
    [...body.matchAll(/^- \[[^\]]+\]\((https?:\/\/[^)]+)\).*$/gm)].flatMap((match) => {
      const href = match[1];
      const line = match[0];
      if (href === undefined || line === undefined) return [];
      const url = new URL(href);
      return url.origin === origin && commercialIndexEntry(url.pathname, line)
        ? [`${url.origin}${url.pathname.replace(/\.md$/, "")}`]
        : [];
    }),
  );
}

function validateCommercialIndexes(bundle: z.infer<typeof bundleSchema>): void {
  const selected = new Set(
    bundle.documents.map(({ url }) => {
      const value = new URL(url);
      return `${value.origin}${value.pathname.replace(/\.md$/, "")}`;
    }),
  );
  const docs = indexedCommercialUrls(
    document(bundle, "https://docs.ollama.com/llms.txt"),
    "https://docs.ollama.com",
  );
  const site = indexedCommercialUrls(
    document(bundle, "https://ollama.com/llms.txt"),
    "https://ollama.com",
  );
  const indexed = new Set([...docs, ...site]);
  if (indexed.size === 0) throw new Error("Ollama indexes omitted commercial pages");
  const missing = [...indexed].filter((path) => !selected.has(path)).sort();
  if (missing.length > 0)
    throw new Error(`Ollama indexes have unreviewed commercial pages: ${missing.join(", ")}`);
}

function commercialEvidence(bundle: z.infer<typeof bundleSchema>): PricingReconciliationItem[] {
  validateCommercialIndexes(bundle);
  requireClaims(
    bundle,
    "https://ollama.com/pricing",
    [
      /Free.*\$0/,
      /Pro.*\$20 \/ mo.*\$200\/yr billed annually/,
      /Max.*\$100 \/ mo.*New sign-ups paused/,
      /Team.*\$25 \/ seat \/ mo.*5-seat minimum, usage included/,
      /Enterprise.*Custom.*Volume pricing and custom terms/,
      /session limits that reset every 5 hours and weekly limits that reset every 7 days/,
      /based on the model and the number of input, cached input, and output tokens processed/,
      /included with their seat first.*shared extra usage balance at the model's token rate/,
      /Pro and Max users can add extra usage balance/,
      /Free\s*1.*Pro\s*3.*Max\s*10/,
    ],
    "pricing",
  );
  requireClaims(
    bundle,
    "https://ollama.com/terms",
    [
      /Subscriptions automatically renew unless cancelled before the renewal date/,
      /responsible for all applicable taxes/,
      /Purchased extra usage credits expire one year/,
    ],
    "payment terms",
  );
  requireClaims(
    bundle,
    "https://docs.ollama.com/api/usage.md",
    [
      /prompt_eval_count.*input tokens/,
      /eval_count.*output tokens/,
      /streaming responses.*final chunk.*done.*true/,
    ],
    "native usage",
  );
  const openapi = requireClaims(
    bundle,
    "https://docs.ollama.com/openapi.yaml",
    [/\/api\/generate:/, /\/api\/chat:/, /\/api\/embed:/, /prompt_eval_count:/, /eval_count:/],
    "OpenAPI usage",
  );
  if (/cached_tokens|cache_read|cached input/i.test(openapi))
    throw new Error("Ollama OpenAPI cached-token accounting changed");
  requireClaims(
    bundle,
    "https://docs.ollama.com/api/openai-compatibility.md",
    [
      /stream_options.*include_usage/,
      /Vision.*Tools.*Reasoning\/thinking control/,
      /reasoning_effort/,
    ],
    "OpenAI compatibility",
  );
  requireClaims(
    bundle,
    "https://docs.ollama.com/api/anthropic-compatibility.md",
    [
      /`usage`.*input_tokens.*output_tokens/,
      /Token counts are approximations based on the underlying model's tokenizer/,
      /Prompt caching.*`cache_control` blocks for caching prefixes/,
    ],
    "Anthropic compatibility",
  );
  requireClaims(
    bundle,
    "https://docs.ollama.com/api/authentication.md",
    [
      /No authentication is required.*locally/,
      /API keys.*programmatic access to ollama\.com's API/,
    ],
    "authentication",
  );
  requireClaims(
    bundle,
    "https://docs.ollama.com/cloud.md",
    [
      /cloud models require an account/i,
      /Cloud models can also be accessed directly on ollama\.com's API.*remote Ollama host/,
      /curl https:\/\/ollama\.com\/api\/tags/,
      /curl https:\/\/ollama\.com\/api\/chat/,
      /deprecate and retire older cloud models/,
    ],
    "Cloud routing",
  );
  requireClaims(
    bundle,
    "https://docs.ollama.com/capabilities/web-search.md",
    [/POST https:\/\/ollama\.com\/api\/web_search/, /A free Ollama account is required/],
    "web search",
  );
  requireClaims(
    bundle,
    "https://docs.ollama.com/capabilities/tool-calling.md",
    [/execute the appropriate tool/, /include its response in a follow-up request/],
    "tool execution",
  );
  requireClaims(
    bundle,
    "https://docs.ollama.com/capabilities/thinking.md",
    [/think.*low.*medium.*high.*max/, /thinking.*reasoning trace.*final answer/],
    "thinking",
  );
  requireClaims(
    bundle,
    "https://docs.ollama.com/capabilities/vision.md",
    [/Vision models accept images alongside text/, /REST API expects base64-encoded image data/],
    "vision",
  );
  return [
    { disposition: "excluded", reason_code: "free_subscription_plan_out_of_catalog" },
    { disposition: "excluded", reason_code: "pro_subscription_plan_out_of_catalog" },
    { disposition: "excluded", reason_code: "max_subscription_plan_out_of_catalog" },
    { disposition: "excluded", reason_code: "team_subscription_plan_out_of_catalog" },
    { disposition: "excluded", reason_code: "enterprise_contract_out_of_catalog" },
    { disposition: "excluded", reason_code: "included_usage_allowance_out_of_catalog" },
    { disposition: "excluded", reason_code: "extra_usage_balance_out_of_catalog" },
    { disposition: "excluded", reason_code: "plan_capacity_limits_out_of_catalog" },
    { disposition: "excluded", reason_code: "credit_expiry_taxes_out_of_catalog" },
    { disposition: "excluded", reason_code: "client_executed_tools_out_of_catalog" },
    { disposition: "excluded", reason_code: "cloud_auth_routing_out_of_catalog" },
    { disposition: "unbound", reason_code: "included_usage_limits_not_published" },
    { disposition: "unbound", reason_code: "usage_cost_ledger_api_not_documented" },
    { disposition: "unbound", reason_code: "cached_token_count_not_returned" },
    { disposition: "unbound", reason_code: "anthropic_token_counts_approximate" },
    { disposition: "unbound", reason_code: "thinking_token_accounting_not_documented" },
    { disposition: "unbound", reason_code: "vision_token_accounting_not_documented" },
    { disposition: "unbound", reason_code: "web_search_rate_not_published" },
  ];
}

export function parseOllamaCloud(input: ParseInput): ProviderModel[] {
  if (input.source.extractor.kind !== "ollama-cloud")
    throw new Error("Invalid Ollama cloud extractor");
  const bundle = bundleSchema.parse(JSON.parse(input.body));
  if (bundle.catalog.url !== "https://ollama.com/search?c=cloud")
    throw new Error("Ollama cloud bundle contained an unexpected catalog URL");
  const list = listSchema.parse(bundle.list);
  const { minModels, maxModels } = input.source.extractor;
  assertItemCount("Ollama cloud models", list.models.length, minModels, maxModels);
  const listed = new Map(list.models.map((item) => [item.model, item]));
  if (listed.size !== list.models.length)
    throw new Error("Ollama cloud list contained duplicate IDs");
  const catalog = new Map(
    libraryItems(bundle.catalog.body)
      .filter((item) => item.badges.includes("cloud"))
      .map((item) => [item.id, item]),
  );
  assertItemCount("Ollama cloud catalog", catalog.size, minModels, maxModels);
  const pages = new Map(bundle.pages.map((page) => [page.model, page]));
  if (
    pages.size !== bundle.pages.length ||
    pages.size !== catalog.size ||
    [...catalog.keys()].some((id) => !pages.has(id))
  )
    throw new Error("Ollama cloud bundle omitted model pages");
  const details = new Map(bundle.details.map((detail) => [detail.model, detail]));
  if (details.size !== bundle.details.length)
    throw new Error("Ollama cloud bundle contained duplicate detail responses");
  const expected = new Set([...listed.keys(), ...catalog.keys()]);
  if (details.size !== expected.size || [...expected].some((id) => !details.has(id)))
    throw new Error("Ollama cloud bundle omitted model details");

  const models = list.models.map((item) => {
    const detail = details.get(item.model);
    if (detail?.status !== 200) throw new Error("Ollama cloud listed model was unavailable");
    return cloudModel(input, item.model, detail.body, item, catalog.has(item.model));
  });
  for (const [id, item] of catalog) {
    if (listed.has(id)) continue;
    const detail = details.get(id);
    if (detail?.status === 200) models.push(cloudModel(input, id, detail.body, undefined, true));
    else if (detail?.status === 410) models.push(retiredModel(input, item, detail.body));
    else if (detail?.status !== 404)
      throw new Error("Ollama cloud catalog probe returned an unexpected status");
  }
  const pricing = pagePricing(bundle, input.source.id);
  const ids = new Set(models.map(({ model_id }) => model_id));
  const unbound = [...pricing.keys()].filter((id) => !ids.has(id)).sort();
  if (unbound.length > 0)
    throw new Error(`Ollama model-page pricing did not bind: ${unbound.join(", ")}`);
  const result = models
    .map((model) => applyPagePricing(model, pricing.get(model.model_id)))
    .sort((left, right) => left.uid.localeCompare(right.uid));
  for (const model of result) {
    input.onPricingReconciliation?.(
      model.price_facts.length > 0
        ? {
            disposition: "normalized",
            reason_code: "model_token_rate_card",
            sample: model.model_id,
          }
        : model.raw_price_facts.length > 0
          ? {
              disposition: "raw",
              reason_code: "cloud_usage_level_preserved",
              sample: model.model_id,
            }
          : {
              disposition: "explicit_non_numeric",
              reason_code: "not_published",
              sample: model.model_id,
            },
    );
  }
  for (const item of commercialEvidence(bundle)) input.onPricingReconciliation?.(item);
  return result;
}
