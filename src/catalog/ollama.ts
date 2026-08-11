import { load } from "cheerio";
import { z } from "zod";
import {
  attachOllamaCloudCommercialFacts,
  attachOllamaLocalCommercialFacts,
  type OllamaCommercialEvidence,
} from "./ollama-commercial-source.ts";
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
import {
  assertItemCount,
  contractExtensionEvidence,
  type SourceContractEvidence,
  type ZodContractObservation,
  zodContractEvidence,
} from "./source-contract.ts";
import { classifyModelTasks } from "./task.ts";
import { type Modality, type ModelTask, type Provider, unknownCapabilities } from "./schema.ts";

interface ParseInput {
  provider: Provider;
  source: SourceManifest;
  body: string;
  observedAt: string;
  onContractFinding?: (evidence: SourceContractEvidence) => void;
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
const listItemSchema = z.object({ model: modelIdSchema }).passthrough();
const listSchema = z.object({ models: z.array(z.unknown()) }).passthrough();
const detailSchema = z
  .object({
    model: modelIdSchema,
    status: z.union([z.literal(200), z.literal(404), z.literal(410)]),
    body: z.unknown(),
  })
  .passthrough();
const pageEntrySchema = z
  .object({ model: modelIdSchema, url: z.url(), body: z.unknown() })
  .passthrough();
const documentSchema = z.object({ url: z.url(), body: z.string().min(1) }).passthrough();
const bundleSchema = z
  .object({
    list: z.unknown(),
    catalog: z.object({ url: z.url(), body: z.string() }).passthrough().optional(),
    pages: z.array(z.unknown()).default([]),
    details: z.array(z.unknown()).default([]),
    documents: z.array(z.unknown()).default([]),
  })
  .passthrough();

const months = new Map(
  ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].map(
    (month, index) => [month, String(index + 1).padStart(2, "0")],
  ),
);
const fullMonths = new Map(
  [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ].map((month, index) => [month, String(index + 1).padStart(2, "0")]),
);

interface LibraryItem {
  id: string;
  description?: string;
  badges: z.infer<typeof badgeSchema>[];
  updated?: string;
}

interface ListClaims {
  modified?: string;
}

interface ShowClaims {
  capabilities: Set<z.infer<typeof capabilitySchema>>;
  modelInfo: Record<string, unknown>;
  modified?: string;
  retirement?: string;
}

interface Retirement {
  date: string;
  replacement?: string;
}

interface PagePricing {
  rates: SourcePriceFact[];
  raw: SourceRawPricingFact[];
}

const cloudFamily = "Ollama Cloud";
const libraryFamily = "Ollama Library";

function diagnostic(input: ParseInput, path: string): void {
  input.onContractFinding?.(contractExtensionEvidence([path]));
}

function recognizedRows<T>(
  input: ParseInput,
  items: readonly unknown[],
  schema: z.ZodType<T>,
  modelId: (item: unknown) => string | undefined,
): T[] {
  const result: T[] = [];
  const invalid: ZodContractObservation[] = [];
  for (const [itemIndex, item] of items.entries()) {
    const parsed = schema.safeParse(item);
    if (parsed.success) result.push(parsed.data);
    else {
      const id = modelId(item);
      invalid.push({
        error: parsed.error,
        input: item,
        itemIndex,
        ...(id === undefined ? {} : { modelId: id }),
      });
    }
  }
  if (invalid.length > 0)
    input.onContractFinding?.(zodContractEvidence(invalid, items.length, "accept_with_signal"));
  return result;
}

function rawModelId(value: unknown): string | undefined {
  if (value === null || typeof value !== "object") return;
  const model = Reflect.get(value, "model");
  return typeof model === "string" ? model : undefined;
}

function exactDate(value: string): string | undefined {
  const match = value.match(
    /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{1,2}), (\d{4}) \d{1,2}:\d{2} (?:AM|PM) UTC$/,
  );
  const month = match?.[1] === undefined ? undefined : months.get(match[1]);
  return match?.[2] === undefined || match[3] === undefined || month === undefined
    ? undefined
    : `${match[3]}-${month}-${match[2].padStart(2, "0")}`;
}

function englishDate(value: string): string | undefined {
  const match = value.match(/^([A-Z][a-z]+) (\d{1,2}), (\d{4})$/);
  const month = match?.[1] === undefined ? undefined : fullMonths.get(match[1]);
  return match?.[2] === undefined || match[3] === undefined || month === undefined
    ? undefined
    : `${match[3]}-${month}-${match[2].padStart(2, "0")}`;
}

function libraryItems(body: string, input: ParseInput): LibraryItem[] {
  const $ = load(body);
  const items = new Map<string, LibraryItem>();
  $('a[href^="/library/"]').each((index, element) => {
    const anchor = $(element);
    const match = anchor.attr("href")?.match(/^\/library\/([a-z0-9][a-z0-9._-]*)$/i);
    if (match?.[1] === undefined) return;
    const parsedId = modelIdSchema.safeParse(match[1]);
    if (!parsedId.success) return;
    const id = parsedId.data;
    const intro = anchor.children("div").first();
    const title = intro.find("h2").first().text().replace(/\s+/g, " ").trim();
    const description = intro.children("p").first().text().replace(/\s+/g, " ").trim();
    const badgeValues = anchor
      .find('span[class*="bg-indigo"], span[class*="bg-cyan"]')
      .map((_badgeIndex, badge) => $(badge).text().trim())
      .get();
    const badges = badgeValues.flatMap((value) => {
      const parsed = badgeSchema.safeParse(value);
      if (parsed.success) return [parsed.data];
      diagnostic(input, `/library/cards/${index}/badges`);
      return [];
    });
    const updateTitles = anchor
      .find("span[title]")
      .filter((_spanIndex, span) => $(span).text().includes("Updated"))
      .map((_spanIndex, span) => $(span).attr("title"))
      .get();
    const updated = updateTitles.length === 1 ? exactDate(updateTitles[0] ?? "") : undefined;
    if (title !== id) diagnostic(input, `/library/cards/${index}/title`);
    if (description === "") diagnostic(input, `/library/cards/${index}/description`);
    if (updated === undefined) diagnostic(input, `/library/cards/${index}/updated`);
    const item: LibraryItem = {
      id,
      badges: [...new Set(badges)],
      ...(description === "" ? {} : { description }),
      ...(updated === undefined ? {} : { updated }),
    };
    const previous = items.get(id);
    if (previous === undefined) items.set(id, item);
    else if (JSON.stringify(previous) !== JSON.stringify(item))
      diagnostic(input, `/library/cards/${index}/duplicate`);
  });
  return [...items.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function facts(
  item: LibraryItem,
): Pick<ProviderModel, "capabilities" | "modalities" | "service_families" | "tasks"> &
  Partial<Pick<ProviderModel, "description" | "updated_date">> {
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
    ...(item.description === undefined ? {} : { description: item.description }),
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
    ...(item.updated === undefined ? {} : { updated_date: item.updated }),
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
    pricing_state: "not_applicable",
    status: "active",
  };
}

export function parseOllamaLibrary(input: ParseInput): ProviderModel[] {
  if (input.source.extractor.kind !== "ollama-library")
    throw new Error("Invalid Ollama library extractor");
  const items = libraryItems(input.body, input);
  const { minModels, maxModels } = input.source.extractor;
  assertItemCount("Ollama library models", items.length, minModels, maxModels);
  const models = items.map((item) => libraryModel(input, item));
  attachOllamaLocalCommercialFacts(models, input.source.id);
  for (const model of models)
    input.onPricingReconciliation?.({
      disposition: "explicit_non_numeric",
      reason_code: "not_applicable",
      sample: model.model_id,
    });
  return models;
}

function validDateTime(value: unknown): string | undefined {
  const parsed = z.iso.datetime({ offset: true }).safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function listClaims(input: ParseInput, item: z.infer<typeof listItemSchema>): ListClaims {
  const known = new Set([
    "name",
    "model",
    "remote_model",
    "remote_host",
    "modified_at",
    "size",
    "digest",
    "details",
  ]);
  for (const key of Object.keys(item)) if (!known.has(key)) diagnostic(input, `/list/${key}`);
  const name = Reflect.get(item, "name");
  if (name !== undefined && name !== item.model) diagnostic(input, "/list/name");
  const modified = validDateTime(Reflect.get(item, "modified_at"));
  if (Reflect.get(item, "modified_at") !== undefined && modified === undefined)
    diagnostic(input, "/list/modified_at");
  return modified === undefined ? {} : { modified };
}

function showClaims(input: ParseInput, id: string, raw: unknown): ShowClaims | undefined {
  if (raw === null || typeof raw !== "object") {
    diagnostic(input, "/show");
    return;
  }
  const known = new Set([
    "parameters",
    "license",
    "modified_at",
    "details",
    "template",
    "capabilities",
    "model_info",
    "retirement_on",
  ]);
  for (const key of Object.keys(raw)) if (!known.has(key)) diagnostic(input, `/show/${key}`);
  const details = Reflect.get(raw, "details");
  const parent =
    details !== null && typeof details === "object"
      ? Reflect.get(details, "parent_model")
      : undefined;
  if (parent !== undefined && parent !== id) {
    diagnostic(input, "/show/details/parent_model");
    return;
  }
  if (details !== null && typeof details === "object") {
    const knownDetails = new Set([
      "parent_model",
      "format",
      "family",
      "families",
      "parameter_size",
      "quantization_level",
    ]);
    for (const key of Object.keys(details))
      if (!knownDetails.has(key)) diagnostic(input, `/show/details/${key}`);
  }
  const rawCapabilities = Reflect.get(raw, "capabilities");
  const capabilities = new Set<z.infer<typeof capabilitySchema>>();
  if (Array.isArray(rawCapabilities))
    for (const value of rawCapabilities) {
      const parsed = capabilitySchema.safeParse(value);
      if (parsed.success) capabilities.add(parsed.data);
      else diagnostic(input, "/show/capabilities");
    }
  else if (rawCapabilities !== undefined) diagnostic(input, "/show/capabilities");
  const rawInfo = Reflect.get(raw, "model_info");
  const modelInfo =
    rawInfo !== null && typeof rawInfo === "object" && !Array.isArray(rawInfo)
      ? (rawInfo as Record<string, unknown>)
      : {};
  if (rawInfo !== undefined && Object.keys(modelInfo).length === 0)
    diagnostic(input, "/show/model_info");
  const modified = validDateTime(Reflect.get(raw, "modified_at"));
  const retirement = validDateTime(Reflect.get(raw, "retirement_on"));
  if (Reflect.get(raw, "modified_at") !== undefined && modified === undefined)
    diagnostic(input, "/show/modified_at");
  if (Reflect.get(raw, "retirement_on") !== undefined && retirement === undefined)
    diagnostic(input, "/show/retirement_on");
  return {
    capabilities,
    modelInfo,
    ...(modified === undefined ? {} : { modified }),
    ...(retirement === undefined ? {} : { retirement: retirement.slice(0, 10) }),
  };
}

function positiveInteger(info: Record<string, unknown>, key: string): number | undefined {
  const value = info[key];
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function latestDate(...values: (string | undefined)[]): string | undefined {
  return values
    .filter((value): value is string => value !== undefined)
    .sort()
    .at(-1)
    ?.slice(0, 10);
}

function cloudModel(
  input: ParseInput,
  id: string,
  listed: ListClaims | undefined,
  show: ShowClaims | undefined,
  library: LibraryItem | undefined,
  retirement: Retirement | undefined,
): ProviderModel {
  if (
    listed?.modified !== undefined &&
    show?.modified !== undefined &&
    listed.modified !== show.modified
  )
    diagnostic(input, "/cloud/modified_at_conflict");
  const capabilities = show?.capabilities ?? new Set<z.infer<typeof capabilitySchema>>();
  const architecture = show?.modelInfo["general.architecture"];
  const context =
    typeof architecture === "string"
      ? positiveInteger(show?.modelInfo ?? {}, `${architecture}.context_length`)
      : undefined;
  const dimension =
    capabilities.has("embedding") && typeof architecture === "string"
      ? positiveInteger(show?.modelInfo ?? {}, `${architecture}.embedding_length`)
      : undefined;
  const modalityInput: Modality[] = ["text"];
  if (capabilities.has("vision")) modalityInput.push("image");
  if (capabilities.has("audio")) modalityInput.push("audio");
  const output: Modality[] = [];
  if (capabilities.has("completion")) output.push("text");
  if (capabilities.has("embedding")) output.push("embedding");
  if (capabilities.has("image")) output.push("image");
  const tasks: ModelTask[] = [];
  if (capabilities.has("completion")) tasks.push("text_generation");
  if (capabilities.has("embedding")) tasks.push("embeddings");
  if (capabilities.has("image")) tasks.push("image_generation");
  const libraryFacts = library === undefined ? undefined : facts(library);
  const retirementDate = show?.retirement ?? retirement?.date;
  const currentLibrary = library !== undefined;
  const retired = retirementDate !== undefined && retirementDate <= input.observedAt.slice(0, 10);
  const endpoints = [
    ...(capabilities.has("completion")
      ? [
          { name: "Generate", path: "/api/generate" },
          { name: "Chat", path: "/api/chat" },
        ]
      : []),
    ...(capabilities.has("embedding") ? [{ name: "Embed", path: "/api/embed" }] : []),
  ];
  const routeRetirement: SourceRawPricingFact[] =
    currentLibrary && retirementDate !== undefined
      ? [
          {
            term_key: "ollama_cloud_route_retirement",
            impact: "informational",
            reason: "unsupported_structure",
            conditions: {},
            source_ref: input.source.id,
            raw: {
              fragment: `Ollama Cloud route retires on ${retirementDate}${
                retirement?.replacement === undefined
                  ? ""
                  : ` with ${retirement.replacement} as the recommended alternative`
              }; local Library availability is unaffected`,
            },
          },
        ]
      : [];
  const updatedDate = latestDate(show?.modified, listed?.modified, library?.updated);
  return {
    ...baseModel({
      providerId: input.provider.id,
      id,
      name: id,
      sourceId: input.source.id,
      observedAt: input.observedAt,
    }),
    ...(libraryFacts?.description === undefined ? {} : { description: libraryFacts.description }),
    tasks: tasks.length > 0 ? tasks : (libraryFacts?.tasks ?? []),
    service_families: currentLibrary ? [cloudFamily, libraryFamily] : [cloudFamily],
    modalities:
      output.length > 0
        ? { input: modalityInput, output }
        : (libraryFacts?.modalities ?? { input: [], output: [] }),
    ...(endpoints.length === 0 ? {} : { api_endpoints: endpoints }),
    capabilities: {
      ...unknownCapabilities(),
      ...libraryFacts?.capabilities,
      reasoning: capabilities.has("thinking")
        ? true
        : (libraryFacts?.capabilities.reasoning ?? "unknown"),
      tool_call: capabilities.has("tools")
        ? true
        : (libraryFacts?.capabilities.tool_call ?? "unknown"),
      streaming: capabilities.has("completion") || capabilities.has("image") ? true : "unknown",
    },
    limits: {
      ...(context === undefined ? {} : { context_tokens: context }),
      ...(dimension === undefined ? {} : { embedding_dimensions: [dimension] }),
    },
    ...(updatedDate === undefined ? {} : { updated_date: updatedDate }),
    status:
      currentLibrary || retirementDate === undefined
        ? "active"
        : retired
          ? "retired"
          : "deprecated",
    ...(currentLibrary || retirementDate === undefined ? {} : { retired_at: retirementDate }),
    ...(currentLibrary || retirement?.replacement === undefined
      ? {}
      : { replacement_model_ids: [retirement.replacement] }),
    pricing_state: "not_published",
    raw_price_facts: routeRetirement,
  };
}

function usageLevel(value: unknown): number | undefined {
  switch (value) {
    case "low":
      return 1;
    case "medium":
      return 2;
    case "high":
      return 3;
    case "extra high":
      return 4;
    default:
      return;
  }
}

function pricingFor(result: Map<string, PagePricing>, id: string): PagePricing {
  const current = result.get(id);
  if (current !== undefined) return current;
  const created = { rates: [], raw: [] };
  result.set(id, created);
  return created;
}

function pagePricing(
  input: ParseInput,
  pages: readonly z.infer<typeof pageEntrySchema>[],
): { pricing: Map<string, PagePricing>; pageModels: Set<string> } {
  const pricing = new Map<string, PagePricing>();
  const pageModels = new Set<string>();
  for (const page of pages) {
    pageModels.add(page.model);
    if (new URL(page.url).pathname !== `/library/${page.model}`)
      diagnostic(input, "/pages/url_identity");
    if (page.body === null || typeof page.body !== "object") {
      diagnostic(input, "/pages/body");
      continue;
    }
    const bodyModel = Reflect.get(page.body, "model");
    if (bodyModel !== undefined && bodyModel !== page.model)
      diagnostic(input, "/pages/model_identity");
    const title = Reflect.get(page.body, "title");
    if (title !== undefined && title !== page.model) diagnostic(input, "/pages/title_identity");
    const tags = Reflect.get(page.body, "tags");
    if (Array.isArray(tags))
      for (const tag of tags) {
        if (tag === null || typeof tag !== "object") {
          diagnostic(input, "/pages/tags");
          continue;
        }
        const parsedId = modelIdSchema.safeParse(Reflect.get(tag, "model"));
        if (!parsedId.success) {
          diagnostic(input, "/pages/tags/model");
          continue;
        }
        pageModels.add(parsedId.data);
        const level = usageLevel(Reflect.get(tag, "label"));
        if (Reflect.get(tag, "label") !== undefined && level === undefined)
          diagnostic(input, "/pages/tags/label");
        if (level !== undefined)
          pricingFor(pricing, parsedId.data).raw.push({
            term_key: "ollama_cloud_usage_level",
            impact: "allowance",
            reason: "requires_usage_aggregation",
            conditions: { account_eligibility: "included_plan_allowance" },
            source_ref: input.source.id,
            raw: {
              label: `${String(Reflect.get(tag, "label"))} usage`,
              amount: String(level),
              unit: "usage level",
            },
          });
      }
    else if (tags !== undefined) diagnostic(input, "/pages/tags");
    const cost = Reflect.get(page.body, "cost");
    if (cost === undefined) continue;
    if (cost === null || typeof cost !== "object") {
      diagnostic(input, "/pages/cost");
      continue;
    }
    const value = pricingFor(pricing, page.model);
    const eligibility = Reflect.get(cost, "accountEligibility");
    const conditions =
      eligibility === "extra_usage_balance" ? { account_eligibility: "extra_usage_balance" } : {};
    if (eligibility !== undefined && eligibility !== "extra_usage_balance")
      diagnostic(input, "/pages/cost/accountEligibility");
    for (const [field, meter] of [
      ["input", "input_text"],
      ["cached", "cache_read_text"],
      ["output", "output_text"],
    ] as const) {
      const amount = Reflect.get(cost, field);
      if (typeof amount === "string" && /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(amount))
        value.rates.push(
          publishedRate(meter, amount, "million_tokens", input.source.id, "1M tokens", conditions),
        );
      else if (amount !== undefined) diagnostic(input, `/pages/cost/${field}`);
    }
    const plans = Reflect.get(cost, "plans");
    const gate =
      Array.isArray(plans) &&
      plans.length === 2 &&
      new Set(plans).size === 2 &&
      plans.includes("Pro") &&
      plans.includes("Max");
    if (gate)
      value.raw.push({
        term_key: "ollama_cloud_plan_gate",
        impact: "informational",
        reason: "unsupported_structure",
        conditions: {},
        source_ref: input.source.id,
        raw: { fragment: `Requires ${plans.join(" or ")} and consumes extra usage credits` },
      });
    else if (plans !== undefined) diagnostic(input, "/pages/cost/plans");
  }
  return { pricing, pageModels };
}

function applyPagePricing(model: ProviderModel, pricing: PagePricing | undefined): ProviderModel {
  if (pricing === undefined) return model;
  return {
    ...model,
    pricing_state: pricing.rates.length > 0 ? "numeric" : "not_published",
    price_facts: [...model.price_facts, ...pricing.rates],
    raw_price_facts: [...model.raw_price_facts, ...pricing.raw],
  };
}

function documents(input: ParseInput, bundle: z.infer<typeof bundleSchema>): Map<string, string> {
  const rows = recognizedRows(input, bundle.documents, documentSchema, () => undefined);
  const result = new Map<string, string>();
  for (const item of rows) {
    if (result.has(item.url)) diagnostic(input, "/documents/duplicate");
    else result.set(item.url, item.body);
  }
  return result;
}

function normalized(body: string): string {
  return load(body)
    .root()
    .text()
    .replace(/\\([_$*])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function claim(
  input: ParseInput,
  docs: ReadonlyMap<string, string>,
  url: string,
  patterns: readonly RegExp[],
  reasonCode: string,
): boolean {
  const body = docs.get(url);
  if (body !== undefined && patterns.every((pattern) => pattern.test(normalized(body))))
    return true;
  input.onPricingReconciliation?.({ disposition: "unbound", reason_code: reasonCode, sample: url });
  return false;
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

function auditIndexes(input: ParseInput, docs: ReadonlyMap<string, string>): void {
  const selected = new Set(
    [...docs.keys()].map((url) => {
      const value = new URL(url);
      return `${value.origin}${value.pathname.replace(/\.md$/, "")}`;
    }),
  );
  const docsIndex = docs.get("https://docs.ollama.com/llms.txt");
  const siteIndex = docs.get("https://ollama.com/llms.txt");
  if (docsIndex === undefined || siteIndex === undefined)
    input.onPricingReconciliation?.({
      disposition: "unbound",
      reason_code: "commercial_index_unavailable",
    });
  const indexed = new Set([
    ...indexedCommercialUrls(docsIndex ?? "", "https://docs.ollama.com"),
    ...indexedCommercialUrls(siteIndex ?? "", "https://ollama.com"),
  ]);
  if (indexed.size === 0)
    input.onPricingReconciliation?.({
      disposition: "unbound",
      reason_code: "commercial_index_unrecognized",
    });
  for (const url of indexed)
    if (!selected.has(url))
      input.onPricingReconciliation?.({
        disposition: "unbound",
        reason_code: "commercial_page_pending_review",
        sample: url,
      });
}

function commercialEvidence(
  input: ParseInput,
  docs: ReadonlyMap<string, string>,
): OllamaCommercialEvidence {
  auditIndexes(input, docs);
  const pricing = docs.get("https://ollama.com/pricing");
  const pricingText = pricing === undefined ? "" : normalized(pricing);
  const terms = docs.get("https://ollama.com/terms");
  const termsText = terms === undefined ? "" : normalized(terms);
  const decimal = "((?:0|[1-9]\\d*)(?:\\.\\d+)?)";
  const pro = pricingText.match(
    new RegExp(`Pro.*?\\$${decimal} / mo.*?\\$${decimal}/yr billed annually`, "i"),
  );
  const max = pricingText.match(new RegExp(`Max.*?\\$${decimal} / mo`, "i"));
  const team = pricingText.match(new RegExp(`Team.*?\\$${decimal} / seat / mo`, "i"));
  const free = /Free.*\$0/i.test(pricingText);
  const enterprise = /Enterprise.*Custom.*Volume pricing and custom terms/i.test(pricingText);
  const allowance =
    /session limits that reset every 5 hours and weekly limits that reset every 7 days/i.test(
      pricingText,
    );
  const extraUsage = /Pro and Max users can add extra usage balance/i.test(pricingText);
  const teamExtraUsage = /For teams, each member's usage.*shared extra usage balance/i.test(
    pricingText,
  );
  const teamAutomaticBilling =
    /automatic usage billing can be disabled|turn off automatic usage billing/i.test(pricingText);
  const concurrency = (plan: string): number | undefined => {
    const match = pricingText.match(new RegExp(`${plan}\\s+(\\d+)`, "i"));
    return match?.[1] === undefined ? undefined : Number(match[1]);
  };
  const webSearch = claim(
    input,
    docs,
    "https://docs.ollama.com/capabilities/web-search.md",
    [/POST https:\/\/ollama\.com\/api\/web_search/, /A free Ollama account is required/],
    "web_search_claim_unavailable",
  );
  const webFetch = /POST https:\/\/ollama\.com\/api\/web_fetch/.test(
    docs.get("https://docs.ollama.com/capabilities/web-search.md") ?? "",
  );
  if (!webFetch)
    input.onPricingReconciliation?.({
      disposition: "unbound",
      reason_code: "web_fetch_claim_unavailable",
    });
  claim(
    input,
    docs,
    "https://docs.ollama.com/api/usage.md",
    [/prompt_eval_count.*input tokens/, /eval_count.*output tokens/, /final chunk.*done.*true/],
    "native_usage_claim_unavailable",
  );
  const openapi = docs.get("https://docs.ollama.com/openapi.yaml") ?? "";
  const cacheCounter = /cached_tokens|cache_read/i.test(openapi);
  if (!cacheCounter)
    input.onPricingReconciliation?.({
      disposition: "unbound",
      reason_code: "cached_token_count_not_returned",
    });
  for (const [url, patterns, reasonCode] of [
    [
      "https://docs.ollama.com/api/introduction.md",
      [/http:\/\/localhost:11434\/api/, /https:\/\/ollama\.com\/api/, /backwards compatible/i],
      "api_introduction_claim_unavailable",
    ],
    [
      "https://docs.ollama.com/api/tags.md",
      [
        /\/api\/tags/,
        /operationId: list/,
        /ListResponse/,
        /ModelSummary/,
        /name:.*model:.*remote_model:.*remote_host:.*modified_at:.*size:.*digest:.*details:/,
      ],
      "list_contract_claim_unavailable",
    ],
    [
      "https://docs.ollama.com/api-reference/show-model-details.md",
      [
        /\/api\/show/,
        /operationId: show/,
        /ShowRequest/,
        /ShowResponse/,
        /parameters:.*license:.*modified_at:.*details:.*template:.*capabilities:.*model_info:/,
      ],
      "show_contract_claim_unavailable",
    ],
    [
      "https://docs.ollama.com/openapi.yaml",
      [
        /openapi: 3\.1\.0/,
        /version: 0\.1\.0/,
        /url: http:\/\/localhost:11434/,
        /bearerAuth:.*type: http.*scheme: bearer.*bearerFormat: API Key/,
        /\/api\/generate:/,
        /\/api\/chat:/,
        /\/api\/embed:/,
        /\/api\/tags:.*operationId: list/,
        /\/api\/show:.*operationId: show/,
        /prompt_eval_count:/,
        /eval_count:/,
      ],
      "openapi_contract_claim_unavailable",
    ],
    [
      "https://docs.ollama.com/api/openai-compatibility.md",
      [/include_usage/, /reasoning_effort/],
      "openai_compatibility_claim_unavailable",
    ],
    [
      "https://docs.ollama.com/api/anthropic-compatibility.md",
      [/input_tokens/, /output_tokens/, /approximations/i],
      "anthropic_compatibility_claim_unavailable",
    ],
    [
      "https://docs.ollama.com/api/authentication.md",
      [/No authentication is required.*locally/i, /API keys/i],
      "authentication_claim_unavailable",
    ],
    [
      "https://docs.ollama.com/capabilities/tool-calling.md",
      [/appropriate tool/i, /follow-up request/i],
      "tool_execution_claim_unavailable",
    ],
    [
      "https://docs.ollama.com/capabilities/thinking.md",
      [/thinking/i, /reasoning trace/i],
      "thinking_claim_unavailable",
    ],
    [
      "https://docs.ollama.com/capabilities/vision.md",
      [/accept images alongside text/i, /base64-encoded image data/i],
      "vision_claim_unavailable",
    ],
  ] as const)
    claim(input, docs, url, patterns, reasonCode);
  if (
    !claim(
      input,
      docs,
      "https://docs.ollama.com/cloud.md",
      [
        /cloud models require an account/i,
        /curl https:\/\/ollama\.com\/api\/tags/,
        /retire older cloud models/i,
      ],
      "cloud_route_claim_unavailable",
    )
  )
    diagnostic(input, "/documents/cloud");
  if (!free)
    input.onPricingReconciliation?.({
      disposition: "unbound",
      reason_code: "free_plan_claim_unavailable",
    });
  if (pro?.[1] === undefined || pro[2] === undefined)
    input.onPricingReconciliation?.({
      disposition: "unbound",
      reason_code: "pro_plan_claim_unavailable",
    });
  if (max?.[1] === undefined)
    input.onPricingReconciliation?.({
      disposition: "unbound",
      reason_code: "max_plan_claim_unavailable",
    });
  if (team?.[1] === undefined)
    input.onPricingReconciliation?.({
      disposition: "unbound",
      reason_code: "team_plan_claim_unavailable",
    });
  if (!enterprise)
    input.onPricingReconciliation?.({
      disposition: "unbound",
      reason_code: "enterprise_claim_unavailable",
    });
  const freeConcurrency = concurrency("Free");
  const proConcurrency = concurrency("Pro");
  const maxConcurrency = concurrency("Max");
  const minimumSeats = /5-seat minimum/i.test(pricingText) ? 5 : undefined;
  return {
    free,
    ...(freeConcurrency === undefined ? {} : { freeConcurrency }),
    ...(pro?.[1] === undefined || pro[2] === undefined
      ? {}
      : {
          pro: {
            monthly: pro[1],
            annual: pro[2],
            ...(/50x more(?: cloud usage)? than Free|50 times Free/i.test(pricingText)
              ? { usageMultiple: 50 }
              : {}),
            ...(proConcurrency === undefined ? {} : { concurrency: proConcurrency }),
          },
        }),
    ...(max?.[1] === undefined
      ? {}
      : {
          max: {
            monthly: max[1],
            closedToNew: /New sign-ups paused/i.test(pricingText),
            ...(/5x more(?: usage)? than Pro|5 times Pro/i.test(pricingText)
              ? { usageMultiple: 5 }
              : {}),
            ...(maxConcurrency === undefined ? {} : { concurrency: maxConcurrency }),
          },
        }),
    ...(team?.[1] === undefined
      ? {}
      : {
          team: {
            seatMonthly: team[1],
            ...(minimumSeats === undefined ? {} : { minimumSeats }),
            waitlist: /Join waitlist|waitlist/i.test(pricingText),
          },
        }),
    enterprise,
    allowance,
    extraUsage,
    teamExtraUsage,
    teamAutomaticBilling,
    creditExpiry: /Purchased extra usage credits expire one year/i.test(termsText),
    webSearch,
    webFetch,
  };
}

function retirementRows(body: string): Map<string, Retirement> {
  const result = new Map<string, Retirement>();
  let pastDate: string | undefined;
  for (const line of body.split("\n")) {
    const title = line.match(/<Accordion title="([A-Z][a-z]+ \d{1,2}, \d{4})">/)?.[1];
    if (title !== undefined) pastDate = englishDate(title);
    const upcoming = line.match(
      /^\|\s*([A-Z][a-z]+ \d{1,2}, \d{4})\s*\|\s*`([^`]+)`\s*\|\s*(?:`([^`]+)`)?\s*\|$/,
    );
    const past = line.match(/^\|\s*`([^`]+)`\s*\|\s*(?:`([^`]+)`)?\s*\|$/);
    const date = upcoming?.[1] === undefined ? pastDate : englishDate(upcoming[1]);
    const rawId = upcoming?.[2] ?? past?.[1];
    const rawReplacement = upcoming?.[3] ?? past?.[2];
    const id = modelIdSchema.safeParse(rawId);
    const replacement = modelIdSchema.safeParse(rawReplacement);
    if (date === undefined || !id.success) continue;
    result.set(id.data, {
      date,
      ...(replacement.success ? { replacement: replacement.data } : {}),
    });
  }
  return result;
}

function retirementResponse(id: string, raw: unknown): Retirement | undefined {
  if (raw === null || typeof raw !== "object") return;
  const error = Reflect.get(raw, "error");
  if (typeof error !== "string") return;
  const match = error.match(/^(.+?) was retired at (\d{4}-\d{2}-\d{2}) /);
  return match?.[1] === id && match[2] !== undefined ? { date: match[2] } : undefined;
}

export function parseOllamaCloud(input: ParseInput): ProviderModel[] {
  if (input.source.extractor.kind !== "ollama-cloud")
    throw new Error("Invalid Ollama cloud extractor");
  const bundle = bundleSchema.parse(JSON.parse(input.body));
  const list = listSchema.safeParse(bundle.list);
  if (!list.success)
    input.onContractFinding?.(
      zodContractEvidence(
        [{ error: list.error, input: bundle.list, itemIndex: 0 }],
        1,
        "accept_with_signal",
      ),
    );
  const listItems = recognizedRows(
    input,
    list.success ? list.data.models : [],
    listItemSchema,
    rawModelId,
  );
  const listed = new Map<string, ListClaims>();
  for (const item of listItems) {
    if (listed.has(item.model)) diagnostic(input, "/list/duplicate");
    else listed.set(item.model, listClaims(input, item));
  }
  const catalogItems =
    bundle.catalog?.url === "https://ollama.com/search?c=cloud"
      ? libraryItems(bundle.catalog.body, input)
      : [];
  if (bundle.catalog !== undefined && bundle.catalog.url !== "https://ollama.com/search?c=cloud")
    diagnostic(input, "/catalog/url");
  const catalog = new Map(catalogItems.map((item) => [item.id, item]));
  const { minModels, maxModels } = input.source.extractor;
  assertItemCount("Ollama cloud list upper bound", listed.size, 0, maxModels);
  assertItemCount("Ollama cloud catalog upper bound", catalog.size, 0, maxModels);
  assertItemCount(
    "Ollama cloud independent inventory",
    Math.max(listed.size, catalog.size),
    minModels,
    maxModels,
  );

  const pageRows = recognizedRows(input, bundle.pages, pageEntrySchema, rawModelId);
  const { pricing, pageModels } = pagePricing(input, pageRows);
  const detailRows = recognizedRows(input, bundle.details, detailSchema, rawModelId);
  const details = new Map<string, z.infer<typeof detailSchema>>();
  for (const detail of detailRows) {
    if (details.has(detail.model)) diagnostic(input, "/details/duplicate");
    else details.set(detail.model, detail);
  }
  const docs = documents(input, bundle);
  const retirements = retirementRows(docs.get("https://docs.ollama.com/cloud.md") ?? "");
  for (const detail of detailRows) {
    if (detail.status !== 410) continue;
    const retirement = retirementResponse(detail.model, detail.body);
    if (retirement === undefined) diagnostic(input, "/details/retirement");
    else if (!retirements.has(detail.model)) retirements.set(detail.model, retirement);
  }

  const ids = new Set([...listed.keys(), ...catalog.keys(), ...pageModels]);
  const models = [...ids].map((id) => {
    const detail = details.get(id);
    const show = detail?.status === 200 ? showClaims(input, id, detail.body) : undefined;
    return cloudModel(input, id, listed.get(id), show, catalog.get(id), retirements.get(id));
  });
  const result = models
    .map((model) => applyPagePricing(model, pricing.get(model.model_id)))
    .sort((left, right) => left.uid.localeCompare(right.uid));
  for (const id of pricing.keys())
    if (!ids.has(id))
      input.onPricingReconciliation?.({
        disposition: "unbound",
        reason_code: "model_page_price_unbound",
        sample: id,
      });
  for (const model of result)
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
  attachOllamaCloudCommercialFacts(result, input.source.id, commercialEvidence(input, docs));
  return result;
}
