import { load } from "cheerio";
import { z } from "zod";
import { linkedBundleSchema } from "./bundle.ts";
import { modelIdSchema } from "./identity.ts";
import { apiEndpointKey, baseModel } from "./model.ts";
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
  recognizeItems,
  type SourceContractEvidence,
} from "./source-contract.ts";
import { type Modality, type ModelTask, type Provider, unknownCapabilities } from "./schema.ts";
import type { SourceManifest } from "./manifests.ts";
import { classifyModelTasks } from "./task.ts";

interface Input {
  provider: Provider;
  source: SourceManifest;
  body: string;
  observedAt: string;
  catalogModels?: readonly Pick<
    ProviderModel,
    | "aliases"
    | "api_endpoints"
    | "capabilities"
    | "model_id"
    | "name"
    | "status"
    | "tasks"
    | "version"
  >[];
  onContractFinding?: (evidence: SourceContractEvidence) => void;
  onPricingReconciliation?: (item: PricingReconciliationItem) => void;
}

const endpointSchema = z.enum([
  "chat",
  "embed",
  "embed_image",
  "classify",
  "summarize",
  "rerank",
  "rate",
  "generate",
  "transcriptions",
]);
const apiItemSchema = z.object({
  name: modelIdSchema,
  is_deprecated: z.boolean().optional(),
  endpoints: z.array(z.string().min(1)).optional(),
  context_length: z.number().int().nonnegative().optional(),
});
const apiSchema = z.object({
  models: z.array(z.unknown()).min(1),
  next_page_token: z.string().min(1).optional(),
});
const pricingSchema = z.object({
  inputLabel: z.string().min(1),
  inputPrice: z.number().finite().nonnegative().nullable().optional(),
  outputLabel: z.string().min(1).optional(),
  outputPrice: z.number().finite().nonnegative().nullable().optional(),
  overridePer: z.string().min(1).optional(),
});
const pricingModelSchema = z.object({
  modelName: z.string().min(1),
  per: z.string().min(1),
  pricings: z.array(pricingSchema).optional(),
  portableDescription: z.array(z.unknown()).optional(),
});
export type CoherePublicPricingProduct = z.infer<typeof pricingModelSchema>;

type Document = ReturnType<typeof load>;
type ApiEndpoint = NonNullable<ProviderModel["api_endpoints"]>[number];
type Reconcile = Input["onPricingReconciliation"];

interface LinkedDocument {
  url: string;
  body: string;
}

interface EndpointDefinition {
  documentPath: string;
  title: string;
  marker: string;
  operation: ModelTask;
  endpoint: ApiEndpoint;
  href?: string;
  hrefAliases?: string[];
  labels: string[];
  modelList?: "embed_jobs" | "generate";
}

interface EndpointReference {
  operation: ModelTask;
  endpoint: ApiEndpoint;
  labels: string[];
  modelIds?: Set<string>;
}

interface EndpointReferences {
  byHref: Map<string, EndpointReference>;
  byLabel: Map<string, EndpointReference>;
}

interface ApiEndpointFact {
  operation?: ModelTask;
  endpoint?: ApiEndpoint;
}

const endpointDefinitions: EndpointDefinition[] = [
  {
    documentPath: "/reference/chat.md",
    title: "Chat",
    marker: "POST https://api.cohere.com/v2/chat",
    operation: "text_generation",
    endpoint: { name: "Chat V2", path: "v2/chat" },
    href: "/reference/chat",
    labels: ["Chat", "Chat V2"],
  },
  {
    documentPath: "/reference/chat-v1.md",
    title: "Chat (V1)",
    marker: "POST https://api.cohere.com/v1/chat",
    operation: "text_generation",
    endpoint: { name: "Chat V1", path: "v1/chat" },
    labels: ["Chat V1"],
  },
  {
    documentPath: "/reference/embed.md",
    title: "Embed API (v2)",
    marker: "POST https://api.cohere.com/v2/embed",
    operation: "embeddings",
    endpoint: { name: "Embed", path: "v2/embed" },
    href: "/reference/embed",
    labels: ["Embed"],
  },
  {
    documentPath: "/reference/create-embed-job.md",
    title: "Create an Embed Job",
    marker: "POST https://api.cohere.com/v1/embed-jobs",
    operation: "embeddings",
    endpoint: { name: "Embed Jobs", path: "v1/embed-jobs" },
    href: "/reference/embed-jobs",
    labels: ["Embed Jobs"],
    modelList: "embed_jobs",
  },
  {
    documentPath: "/reference/rerank.md",
    title: "Rerank API (v2)",
    marker: "POST https://api.cohere.com/v2/rerank",
    operation: "reranking",
    endpoint: { name: "Rerank", path: "v2/rerank" },
    href: "/reference/rerank",
    labels: ["Rerank"],
  },
  {
    documentPath: "/reference/create-audio-transcription.md",
    title: "Create a transcription",
    marker: "POST https://api.cohere.com/v2/audio/transcriptions",
    operation: "transcription",
    endpoint: { name: "Audio Transcriptions", path: "v2/audio/transcriptions" },
    href: "/reference/create-audio-transcription",
    hrefAliases: ["/v2/reference/create-audio-transcription"],
    labels: ["Audio Transcriptions"],
  },
  {
    documentPath: "/docs/compatibility-api.md",
    title: "Using Cohere models via the OpenAI SDK",
    marker: "https://api.cohere.ai/compatibility/v1/chat/completions",
    operation: "text_generation",
    endpoint: { name: "Chat Completions", path: "compatibility/v1/chat/completions" },
    labels: ["Chat Completions"],
  },
  {
    documentPath: "/v1/reference/generate.md",
    title: "Generate",
    marker: "POST https://api.cohere.com/v1/generate",
    operation: "text_generation",
    endpoint: { name: "Generate", path: "v1/generate" },
    labels: ["Generate"],
    modelList: "generate",
  },
];

const accountingReferences: readonly {
  documentPath: string;
  markers: readonly RegExp[];
  gap: "policy" | "chat-v2" | "chat-v1" | "embed-v2" | "rerank-v2";
}[] = [
  {
    documentPath: "/docs/how-does-cohere-pricing-work.md",
    markers: [
      /billed_units[\s\S]*input_tokens[\s\S]*output_tokens[\s\S]*tokens/,
      /billed[^\n]*tokens are the tokens that you(?:'|’)re actually[^\n]*billed/i,
    ],
    gap: "policy",
  },
  {
    documentPath: "/reference/chat.md",
    markers: [
      /The number of billed input tokens[\s\S]*The number of billed output tokens/,
      /cached_tokens[\s\S]*The number of prompt tokens that hit the inference cache/,
    ],
    gap: "chat-v2",
  },
  {
    documentPath: "/reference/chat-v1.md",
    markers: [/billed_units[\s\S]*input_tokens[\s\S]*output_tokens[\s\S]*tokens/],
    gap: "chat-v1",
  },
  {
    documentPath: "/reference/embed.md",
    markers: [
      /The number of billed images[\s\S]*The number of billed input tokens[\s\S]*The number of billed image tokens/,
    ],
    gap: "embed-v2",
  },
  {
    documentPath: "/reference/rerank.md",
    markers: [/The number of billed search units/, /"billed_units"[\s\S]*"search_units"/],
    gap: "rerank-v2",
  },
];

const apiEndpointFacts = new Map<z.infer<typeof endpointSchema>, ApiEndpointFact>([
  ["chat", { operation: "text_generation" }],
  ["embed", { operation: "embeddings" }],
  ["embed_image", { operation: "embeddings" }],
  [
    "classify",
    { operation: "classification", endpoint: { name: "Classify", path: "v1/classify" } },
  ],
  [
    "summarize",
    { operation: "text_generation", endpoint: { name: "Summarize", path: "v1/summarize" } },
  ],
  ["rerank", { operation: "reranking" }],
  ["rate", {}],
  [
    "generate",
    { operation: "text_generation", endpoint: { name: "Generate", path: "v1/generate" } },
  ],
  ["transcriptions", { operation: "transcription" }],
]);

const operationsBySection = new Map<string, ModelTask[]>([
  ["Command", ["text_generation"]],
  ["Embed", ["embeddings"]],
  ["Rerank", ["reranking"]],
  ["Audio", ["transcription"]],
  ["Aya", ["text_generation"]],
]);

const months = new Map(
  ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].map(
    (month, index) => [month, String(index + 1).padStart(2, "0")],
  ),
);

function text(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function dimmed(style: string | undefined): boolean {
  return /opacity\s*:\s*0\.5/.test(style ?? "");
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function validModelIds(values: string[]): string[] {
  return values.flatMap((value) => {
    const parsed = modelIdSchema.safeParse(value);
    return parsed.success ? [parsed.data] : [];
  });
}

function date(value: string): string | undefined {
  const iso = value.match(/\b(\d{4}-\d{2}-\d{2})\b/)?.[1];
  if (iso !== undefined) return iso;
  const match = value.match(
    /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/i,
  );
  const month =
    match?.[1] === undefined ? undefined : months.get(match[1].slice(0, 3).toLowerCase());
  return month === undefined || match?.[2] === undefined || match[3] === undefined
    ? undefined
    : `${match[3]}-${month}-${match[2].padStart(2, "0")}`;
}

function tokens(value: string): number | undefined {
  const match = value
    .replaceAll(",", "")
    .trim()
    .match(/^(\d+(?:\.\d+)?)\s*([km])?(?:\s*tokens?)?$/i);
  if (match?.[1] === undefined) return undefined;
  const number = Number(match[1]);
  const multiplier = match[2]?.toLowerCase() === "m" ? 1_000_000 : match[2] ? 1_000 : 1;
  const result = number * multiplier;
  return Number.isSafeInteger(result) && result > 0 ? result : undefined;
}

function operationsFromEndpointLabels(
  labels: string[],
  references: EndpointReferences,
): ModelTask[] {
  return unique(labels.flatMap((label) => references.byLabel.get(label)?.operation ?? []));
}

function listedModelIds(
  body: string,
  kind: NonNullable<EndpointDefinition["modelList"]>,
): Set<string> {
  const section =
    kind === "embed_jobs"
      ? body.match(
          /Available models and corresponding embedding dimensions:\s*((?:-\s+`[^`]+`\s*:\s*\d+\s*)+)/,
        )?.[1]
      : text(body).match(/Currently available models are (.*?)(?: Smaller,|$)/)?.[1];
  if (section === undefined) throw new Error(`Cohere ${kind} model list drifted`);
  const values = [...section.matchAll(/`([^`]+)`/g)].map((match) => modelIdSchema.parse(match[1]));
  const ids = new Set(values);
  if (ids.size === 0 || ids.size !== values.length)
    throw new Error(`Cohere ${kind} model list drifted`);
  return ids;
}

function endpointReferences(
  documents: LinkedDocument[],
  reconcile?: Reconcile,
): EndpointReferences {
  const byHref = new Map<string, EndpointReference>();
  const byLabel = new Map<string, EndpointReference>();
  for (const definition of endpointDefinitions) {
    const matches = documents.filter(
      (document) => new URL(document.url).pathname === definition.documentPath,
    );
    const document = matches[0];
    if (
      matches.length !== 1 ||
      document === undefined ||
      document.body.match(/^# ([^\n]+)$/m)?.[1] !== definition.title ||
      !document.body.includes(definition.marker)
    ) {
      reconcile?.({
        disposition: "unbound",
        reason_code: "endpoint_reference_drift",
        sample: definition.documentPath,
      });
      continue;
    }
    let modelIds: Set<string> | undefined;
    try {
      modelIds =
        definition.modelList === undefined
          ? undefined
          : listedModelIds(document.body, definition.modelList);
    } catch {
      reconcile?.({
        disposition: "unbound",
        reason_code: "endpoint_model_list_drift",
        sample: definition.documentPath,
      });
      continue;
    }
    const reference: EndpointReference =
      modelIds === undefined
        ? {
            operation: definition.operation,
            endpoint: definition.endpoint,
            labels: definition.labels,
          }
        : {
            operation: definition.operation,
            endpoint: definition.endpoint,
            labels: definition.labels,
            modelIds,
          };
    for (const href of [definition.href, ...(definition.hrefAliases ?? [])])
      if (href !== undefined) byHref.set(href, reference);
    for (const label of definition.labels) byLabel.set(label, reference);
  }
  return { byHref, byLabel };
}

function validateAccountingReferences(
  documents: LinkedDocument[],
  reconcile?: Reconcile,
): Set<string> {
  const valid = new Set<string>();
  for (const reference of accountingReferences) {
    const matches = documents.filter(
      (document) => new URL(document.url).pathname === reference.documentPath,
    );
    const document = matches[0];
    if (
      matches.length !== 1 ||
      document === undefined ||
      reference.markers.some((marker) => !marker.test(document.body))
    ) {
      reconcile?.({
        disposition: "unbound",
        reason_code: "accounting_reference_drift",
        sample: reference.documentPath,
      });
      continue;
    }
    valid.add(reference.documentPath);
  }
  return valid;
}

function withEndpoints(current: ProviderModel, values: ApiEndpoint[]): ProviderModel {
  if (values.length === 0) return current;
  const merged = new Map(
    [...(current.api_endpoints ?? []), ...values].map((value) => [apiEndpointKey(value), value]),
  );
  return {
    ...current,
    api_endpoints: [...merged.values()].sort((left, right) =>
      apiEndpointKey(left).localeCompare(apiEndpointKey(right)),
    ),
  };
}

function linkedEndpoints(
  labels: string[],
  links: { label: string; href: string | undefined }[],
  id: string,
  references: EndpointReferences,
): ApiEndpoint[] {
  if (labels.join("\0") !== links.map(({ label }) => label).join("\0")) return [];
  return links.flatMap(({ label, href }) => {
    const url = href === undefined ? undefined : new URL(href, "https://docs.cohere.com");
    const reference =
      url?.origin === "https://docs.cohere.com" ? references.byHref.get(url.pathname) : undefined;
    if (reference === undefined || !reference.labels.includes(label)) return [];
    return reference.modelIds !== undefined && !reference.modelIds.has(id)
      ? []
      : [reference.endpoint];
  });
}

function model(
  models: Map<string, ProviderModel>,
  input: Input,
  id: string,
  tasks: ModelTask[],
): ProviderModel {
  const current = models.get(id);
  if (current !== undefined) return current;
  const created = {
    ...baseModel({
      providerId: input.provider.id,
      id,
      name: id,
      sourceId: input.source.id,
      observedAt: input.observedAt,
    }),
    tasks,
  };
  models.set(id, created);
  return created;
}

function update(
  models: Map<string, ProviderModel>,
  id: string,
  change: (current: ProviderModel) => ProviderModel,
): void {
  const current = models.get(id);
  if (current === undefined) throw new Error(`Cohere model was not observed: ${id}`);
  models.set(id, change(current));
}

function rootTables(
  input: Input,
  models: Map<string, ProviderModel>,
  body: string,
  references: EndpointReferences,
): void {
  const $ = load(body);
  let sectionOperations: ModelTask[] | undefined;
  $("main h2,main table").each((_tableIndex, table) => {
    if ($(table).is("h2")) {
      sectionOperations = operationsBySection.get(text($(table).text()));
      return;
    }
    const headers = $(table)
      .find("tr")
      .first()
      .find("th,td")
      .map((_index, cell) => text($(cell).text()))
      .get();
    if (headers[0] !== "Model Name") return;
    const defaultOperations = sectionOperations;
    if (defaultOperations === undefined) return;
    const column = (name: string): number => headers.indexOf(name);
    $(table)
      .find("tr")
      .slice(1)
      .each((_rowIndex, row) => {
        const elements = $(row).find("td");
        const cells = elements.map((_index, cell) => text($(cell).text())).get();
        const parsedId = modelIdSchema.safeParse(cells[0]);
        if (!parsedId.success) return;
        const id = parsedId.data;
        model(models, input, id, defaultOperations);
        if (!headers.includes("Description") && !headers.includes("Status")) return;
        const value = (name: string): string | undefined => {
          const index = column(name);
          return index < 0 ? undefined : cells[index];
        };
        const statusText = value("Status");
        const description = value("Description");
        const modality = value("Modality") ?? value("Modalities") ?? "";
        const endpoint = value("Endpoints") ?? "";
        const endpointIndex = column("Endpoints");
        const endpointCell = endpointIndex < 0 ? undefined : elements.eq(endpointIndex);
        const endpointLabels = endpoint.split(",").map(text).filter(Boolean);
        const apiEndpoints =
          endpointCell === undefined
            ? []
            : linkedEndpoints(
                endpointLabels,
                endpointCell
                  .find("a[href]")
                  .map((_index, element) => ({
                    label: text($(element).text()),
                    href: $(element).attr("href"),
                  }))
                  .get(),
                id,
                references,
              );
        const context = tokens(value("Context Length") ?? "");
        const output = tokens(value("Maximum Output Tokens") ?? "");
        const dimensions = unique(
          [...(value("Dimensions") ?? "").matchAll(/\d[\d,]*/g)]
            .map((match) => Number(match[0]?.replace(/,/g, "")))
            .filter((item) => Number.isSafeInteger(item) && item > 0),
        );
        const observedTasks = unique([
          ...defaultOperations,
          ...operationsFromEndpointLabels(endpointLabels, references),
        ]);
        const isEmbedding = observedTasks.includes("embeddings");
        const isTranscription = observedTasks.includes("transcription");
        const inputModalities: Modality[] = [];
        if (modality.toLowerCase().includes("text")) inputModalities.push("text");
        if (modality.toLowerCase().includes("image")) inputModalities.push("image");
        if (modality.toLowerCase().includes("pdf")) inputModalities.push("pdf");
        if (isTranscription) inputModalities.push("audio");
        const outputModalities: Modality[] = [];
        if (isEmbedding) outputModalities.push("embedding");
        if (isTranscription || observedTasks.includes("text_generation"))
          outputModalities.push("text");
        const modelTasks = unique([
          ...observedTasks,
          ...classifyModelTasks({
            modelId: id,
            name: id,
            rawType: undefined,
            modalities: { input: inputModalities, output: outputModalities },
          }),
        ]);
        const deprecated = statusText?.startsWith("Deprecated") ?? false;
        const retired = statusText?.startsWith("Retired") ?? false;
        const active = statusText === undefined || statusText === "Live";
        update(models, id, (current) =>
          withEndpoints(
            {
              ...current,
              description: description || current.description,
              tasks: modelTasks,
              modalities:
                inputModalities.length + outputModalities.length > 0
                  ? { input: [...inputModalities], output: [...outputModalities] }
                  : current.modalities,
              limits: {
                ...current.limits,
                ...(context === undefined ? {} : { context_tokens: context }),
                ...(output === undefined ? {} : { max_output_tokens: output }),
                ...(dimensions.length === 0 ? {} : { embedding_dimensions: dimensions }),
                ...(dimensions.length <= 1
                  ? {}
                  : {
                      recommended_embedding_dimensions: [dimensions.at(-1) ?? 0].filter(
                        (item) => item > 0,
                      ),
                    }),
              },
              status: retired
                ? "retired"
                : deprecated
                  ? "deprecated"
                  : active
                    ? "active"
                    : current.status,
              deprecated_at: deprecated ? date(statusText ?? "") : current.deprecated_at,
              retired_at: retired ? date(statusText ?? "") : current.retired_at,
            },
            apiEndpoints,
          ),
        );
      });
  });
}

function cardTitle($: Document): string | undefined {
  const value = text($("h1").first().text())
    .replace(/^Cohere(?:'s|’s)\s+/i, "")
    .replace(/\s+Models?$/i, "");
  return value || undefined;
}

function cardId($: Document): string | undefined {
  const value = $("strong")
    .filter((_index, element) => text($(element).text()) === "Model ID")
    .first()
    .next()
    .text();
  const parsed = modelIdSchema.safeParse(text(value));
  return parsed.success ? parsed.data : undefined;
}

function cardMatchesPath(id: string, pathname: string): boolean {
  const page = pathname.split("/").filter(Boolean).at(-1);
  const normalized = (value: string): string =>
    value
      .replace(/-\d{2}-\d{4}$/, "")
      .toLowerCase()
      .replace(/[+]/g, "plus")
      .replace(/[^a-z0-9]+/g, "");
  return page !== undefined && normalized(id) === normalized(page);
}

function documentedCardId(
  observedId: string,
  title: string | undefined,
  url: URL,
  documents: LinkedDocument[],
  models: Map<string, ProviderModel>,
): string | undefined {
  if (title === undefined || !cardMatchesPath(title, url.pathname)) return undefined;
  const escapedTitle = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `${escapedTitle} is [^.]{0,300}?through the SDK with ([a-z0-9](?:[a-z0-9._-]*[a-z0-9])?)\\b`,
    "gi",
  );
  const candidates = new Set<string>();
  for (const document of documents) {
    if (!new URL(document.url).pathname.includes("/changelog")) continue;
    const prose = text(load(document.body).text());
    for (const match of prose.matchAll(pattern)) {
      const parsed = modelIdSchema.safeParse(match[1]);
      if (
        parsed.success &&
        parsed.data !== observedId &&
        cardMatchesPath(parsed.data, url.pathname) &&
        models.has(parsed.data)
      )
        candidates.add(parsed.data);
    }
  }
  const candidate = [...candidates][0];
  if (candidates.size !== 1 || candidate === undefined) return undefined;
  const observedIdHasOwnCard = documents.some((document) => {
    const documentUrl = new URL(document.url);
    if (documentUrl.href === url.href || !documentUrl.pathname.startsWith("/docs/")) return false;
    const $ = load(document.body);
    return (
      cardId($) === observedId &&
      cardMatchesPath(observedId, documentUrl.pathname) &&
      cardMatchesPath(cardTitle($) ?? "", documentUrl.pathname)
    );
  });
  return observedIdHasOwnCard ? candidate : undefined;
}

function addRate(
  current: ProviderModel,
  rate: SourcePriceFact,
  reconcile?: Reconcile,
): ProviderModel {
  const key = (item: SourcePriceFact): string =>
    JSON.stringify([item.meter, item.unit, item.conditions, item.source_ref]);
  const conflict = conflictingPrice(rate);
  const hasConflict = current.raw_price_facts.some(
    (item) =>
      item.term_key === conflict.term_key &&
      item.source_ref === conflict.source_ref &&
      JSON.stringify(item.conditions) === JSON.stringify(conflict.conditions),
  );
  if (hasConflict) {
    const duplicate = current.raw_price_facts.some(
      (item) => JSON.stringify(item) === JSON.stringify(conflict),
    );
    reconcile?.({
      disposition: duplicate ? "excluded" : "unresolved",
      reason_code: duplicate ? "duplicate_price_fact" : "price_fact_conflict",
      sample: current.model_id,
    });
    return duplicate
      ? current
      : { ...current, raw_price_facts: [...current.raw_price_facts, conflict] };
  }
  const existing = current.price_facts.find((item) => key(item) === key(rate));
  if (existing !== undefined) {
    const decimal = (value: string): string => {
      const [whole = "", fraction = ""] = value.split(".");
      const normalizedWhole = whole.replace(/^0+(?=\d)/, "") || "0";
      const normalizedFraction = fraction.replace(/0+$/, "");
      return normalizedFraction ? `${normalizedWhole}.${normalizedFraction}` : normalizedWhole;
    };
    if (decimal(existing.price) !== decimal(rate.price)) {
      reconcile?.({
        disposition: "unresolved",
        reason_code: "price_fact_conflict",
        sample: current.model_id,
      });
      const remaining = current.price_facts.filter((item) => item !== existing);
      return {
        ...current,
        price_facts: remaining,
        raw_price_facts: [...current.raw_price_facts, conflictingPrice(existing), conflict],
        pricing_state: remaining.length === 0 ? "unknown" : "numeric",
      };
    }
    reconcile?.({ disposition: "excluded", reason_code: "duplicate_price_fact" });
    return current;
  }
  reconcile?.({ disposition: "normalized", reason_code: "normalized_price_fact" });
  return {
    ...current,
    price_facts: [...current.price_facts, rate],
    pricing_state:
      current.pricing_state === "free" && rate.meter === "provisioned_throughput"
        ? "free"
        : "numeric",
  };
}

function conflictingPrice(rate: SourcePriceFact): SourceRawPricingFact {
  return {
    term_key: `conflicting_${rate.meter}`,
    impact: "base_price",
    reason: "conflicting_values",
    conditions: rate.conditions,
    source_ref: rate.source_ref,
    raw: {
      amount: rate.raw_price ?? rate.price,
      denomination: rate.currency,
      unit: rate.raw_unit ?? rate.unit,
      meter: rate.meter,
    },
  };
}

function modelCard(
  input: Input,
  models: Map<string, ProviderModel>,
  url: URL,
  body: string,
  references: EndpointReferences,
  documents: LinkedDocument[],
): void {
  const $ = load(body);
  const observedId = cardId($);
  const title = cardTitle($);
  const documentedId =
    observedId === undefined || cardMatchesPath(observedId, url.pathname)
      ? undefined
      : documentedCardId(observedId, title, url, documents, models);
  const id = documentedId ?? observedId;
  const pricing = text(
    $(".fern-card")
      .filter((_index, card) => text($(card).text()).startsWith("Pricing"))
      .text(),
  );
  const direct = pricing.match(
    /Input\s*\$([\d.]+)\s*\/\s*1M tokens\s*Output\s*\$([\d.]+)\s*\/\s*1M tokens/i,
  );
  if (id === undefined || !cardMatchesPath(id, url.pathname)) {
    const count =
      direct !== null
        ? 2
        : Number(/\bfree\b/i.test(pricing)) +
          Number(/contact (?:our )?sales|Model Vault/i.test(pricing));
    for (let index = 0; index < count; index += 1)
      input.onPricingReconciliation?.({
        disposition: id === undefined ? "unbound" : "ambiguous",
        reason_code:
          id === undefined ? "model_card_pricing_without_id" : "model_card_identity_conflict",
        sample: id === undefined ? url.pathname : `${url.pathname} -> ${id}`,
      });
    return;
  }
  if (documentedId !== undefined)
    input.onPricingReconciliation?.({
      disposition: "excluded",
      reason_code: "model_card_documented_id_override",
      sample: `${url.pathname}: ${observedId} -> ${documentedId}`,
    });
  const description = text(
    $("h2")
      .filter((_index, heading) => text($(heading).text()) === "Description")
      .first()
      .next("p")
      .text(),
  );
  const capabilities = { ...unknownCapabilities() };
  const capabilityCard = $(".fern-card").filter((_index, card) =>
    text($(card).text()).startsWith("Capabilities"),
  );
  const capability = new Map<string, boolean>();
  capabilityCard.find("span").each((_index, element) => {
    const label = text($(element).text());
    if (
      !["Citations", "Tool Use", "Structured Outputs", "Reasoning", "Image Inputs"].includes(label)
    )
      return;
    capability.set(label, !dimmed($(element).attr("style")));
  });
  capabilities.citations = capability.get("Citations") ?? "unknown";
  capabilities.tool_call = capability.get("Tool Use") ?? "unknown";
  capabilities.structured_output = capability.get("Structured Outputs") ?? "unknown";
  capabilities.reasoning = capability.get("Reasoning") ?? "unknown";
  const specification = text(
    $(".fern-card")
      .filter((_index, card) => text($(card).text()).startsWith("Specifications"))
      .text(),
  );
  const context = tokens(
    specification.match(/Context Window:\s*([\d,.]+\s*[km]?(?:\s*tokens)?)/i)?.[1] ?? "",
  );
  const output = tokens(
    specification.match(/Max Output Tokens:\s*([\d,.]+\s*[km]?(?:\s*tokens)?)/i)?.[1] ?? "",
  );
  const endpointCard = $(".fern-card").filter((_index, card) =>
    text($(card).text()).startsWith("API Endpoints"),
  );
  const endpointLabels = endpointCard
    .find("span")
    .filter((_index, element) => !dimmed($(element).attr("style")))
    .map((_index, element) => text($(element).text()))
    .get();
  const endpointTasks = operationsFromEndpointLabels(endpointLabels, references);
  const apiEndpoints = endpointLabels.flatMap((label) => {
    const reference = references.byLabel.get(label);
    return reference === undefined ? [] : [reference.endpoint];
  });
  const current = model(models, input, id, endpointTasks);
  const tasks = unique([...current.tasks, ...endpointTasks]);
  const inputModalities = [...current.modalities.input];
  const outputModalities = [...current.modalities.output];
  if (tasks.includes("text_generation")) {
    inputModalities.push("text");
    outputModalities.push("text");
  }
  if (capability.get("Image Inputs") === true) inputModalities.push("image");
  update(models, id, (current) =>
    withEndpoints(
      {
        ...current,
        name: title ?? current.name,
        description: description || current.description,
        tasks,
        modalities: {
          input: unique(inputModalities),
          output: unique(outputModalities),
        },
        capabilities: { ...current.capabilities, ...capabilities },
        limits: {
          ...current.limits,
          ...(context === undefined ? {} : { context_tokens: context }),
          ...(output === undefined ? {} : { max_output_tokens: output }),
        },
        release_date:
          date(
            $("strong")
              .filter((_index, element) => /^Release Date:?$/i.test(text($(element).text())))
              .first()
              .parent()
              .text(),
          ) ?? current.release_date,
        status: "active",
      },
      apiEndpoints,
    ),
  );
  if (direct?.[1] !== undefined && direct[2] !== undefined) {
    const inputPrice = direct[1];
    const outputPrice = direct[2];
    update(models, id, (current) =>
      addRate(
        addRate(
          current,
          publishedRate("input_text", inputPrice, "million_tokens", input.source.id, "1M tokens"),
          input.onPricingReconciliation,
        ),
        publishedRate("output_text", outputPrice, "million_tokens", input.source.id, "1M tokens"),
        input.onPricingReconciliation,
      ),
    );
  } else if (/free until rate limits/i.test(pricing)) {
    update(models, id, (current) => ({ ...current, pricing_state: "free" }));
    input.onPricingReconciliation?.({
      disposition: "explicit_non_numeric",
      reason_code: "free_until_rate_limits",
    });
  } else if (/contact (?:our )?sales|Model Vault/i.test(pricing)) {
    input.onPricingReconciliation?.({
      disposition: "excluded",
      reason_code: "out_of_scope_capacity_offer",
      sample: id,
    });
  }
  if (
    (direct !== null || /free until rate limits/i.test(pricing)) &&
    /Model Vault|contact (?:our )?sales/i.test(pricing)
  )
    input.onPricingReconciliation?.({
      disposition: "excluded",
      reason_code: "out_of_scope_capacity_offer",
      sample: id,
    });
}

function transcribePage(
  input: Input,
  models: Map<string, ProviderModel>,
  url: URL,
  body: string,
  references: EndpointReferences,
): void {
  const $ = load(body);
  const label = $("strong")
    .filter((_index, element) => /^Model name:?$/i.test(text($(element).text())))
    .first()
    .parent()
    .text();
  const parsed = modelIdSchema.safeParse(text(label).replace(/^Model name:\s*/i, ""));
  if (!parsed.success) return;
  const expected = url.pathname.endsWith("transcribe-arabic")
    ? /^cohere-transcribe-arabic-\d{2}-\d{4}$/
    : /^cohere-transcribe-\d{2}-\d{4}$/;
  if (!expected.test(parsed.data)) return;
  const description = $(".fern-prose p")
    .map((_index, element) => text($(element).text()))
    .get()
    .find((value) => value.length >= 40);
  const endpointHref = $("a")
    .filter(
      (_index, element) =>
        text($(element).text()) === "Audio Transcriptions API reference documentation",
    )
    .first()
    .attr("href");
  const endpointUrl =
    endpointHref === undefined ? undefined : new URL(endpointHref, "https://docs.cohere.com");
  const endpoint =
    endpointUrl?.origin === "https://docs.cohere.com"
      ? references.byHref.get(endpointUrl.pathname)
      : undefined;
  const endpoints = endpoint?.endpoint.name === "Audio Transcriptions" ? [endpoint.endpoint] : [];
  const free = /via our API for free[\s\S]*Model Vault/i.test(text($(".fern-prose").text()));
  model(models, input, parsed.data, ["transcription"]);
  update(models, parsed.data, (current) =>
    withEndpoints(
      {
        ...current,
        name: text($("h1").first().text()) || current.name,
        description: current.description ?? description,
        tasks: ["transcription"],
        modalities: { input: ["audio"], output: ["text"] },
        status: "active",
        pricing_state: free ? "free" : current.pricing_state,
      },
      endpoints,
    ),
  );
  if (free) {
    input.onPricingReconciliation?.({
      disposition: "explicit_non_numeric",
      reason_code: "free_until_rate_limits",
    });
    input.onPricingReconciliation?.({
      disposition: "excluded",
      reason_code: "out_of_scope_capacity_offer",
      sample: parsed.data,
    });
  }
}

function lifecycle(input: Input, models: Map<string, ProviderModel>, body: string): void {
  const $ = load(body);
  const observedDate = input.observedAt.slice(0, 10);
  let factCount = 0;
  const lifecycleTask = (value: string): ModelTask | undefined =>
    /embed/i.test(value)
      ? "embeddings"
      : /chat|command/i.test(value)
        ? "text_generation"
        : /rerank/i.test(value)
          ? "reranking"
          : /audio|transcri/i.test(value)
            ? "transcription"
            : undefined;
  const replacements = (ids: string[], operation: ModelTask, replacementIds: string[]): void => {
    const valid = unique(replacementIds).filter((id) => models.has(id));
    if (valid.length === 0) return;
    for (const id of ids) {
      const current = models.get(id);
      if (current === undefined || !current.tasks.includes(operation)) continue;
      update(models, id, (item) => ({
        ...item,
        replacement_model_ids: unique([...item.replacement_model_ids, ...valid]),
      }));
    }
  };

  $("main h3").each((_headingIndex, heading) => {
    const at = date(text($(heading).text()));
    if (at === undefined) return;
    const section = $(heading).nextUntil("h3");
    const lists = section.filter("ul").add(section.find("ul"));
    const statusList = lists
      .filter((_listIndex, list) =>
        /(?:models?.*(?:will be )?retired|retired models?|deprecated models?)/i.test(
          text($(list).prevAll("p,h4").first().text()),
        ),
      )
      .first();
    if (statusList.length === 0) return;
    const statusText = text(statusList.prevAll("p,h4").first().text());
    const validIds = validModelIds(
      statusList
        .children("li")
        .children("code")
        .map((_index, element) => text($(element).text()))
        .get(),
    );
    if (validIds.length === 0)
      throw new Error(`Cohere lifecycle section ${text($(heading).text())} contained no model IDs`);
    const retirement = /\bretir(?:e|ed)\b/i.test(statusText);
    const status = retirement && at <= observedDate ? "retired" : "deprecated";
    for (const id of validIds) {
      model(models, input, id, []);
      update(models, id, (current) => ({
        ...current,
        status,
        deprecated_at: retirement ? current.deprecated_at : at,
        retired_at: retirement ? at : current.retired_at,
      }));
    }
    factCount += validIds.length;

    section.find("li").each((_itemIndex, item) => {
      const nested = $(item).children("ul");
      if (nested.length === 0) return;
      const label = text($(item).clone().children("ul").remove().end().text());
      const operation = lifecycleTask(label);
      if (operation === undefined) return;
      replacements(
        validIds,
        operation,
        validModelIds(
          nested
            .find("code")
            .map((_index, element) => text($(element).text()))
            .get(),
        ),
      );
    });
    section
      .filter("p")
      .add(section.find("p"))
      .filter((_paragraphIndex, paragraph) =>
        /replacements?.*recommend/i.test(text($(paragraph).text())),
      )
      .each((_paragraphIndex, paragraph) => {
        const label = text($(paragraph).text());
        const operation = lifecycleTask(label);
        if (operation === undefined) return;
        replacements(
          validIds,
          operation,
          validModelIds(
            $(paragraph)
              .find("code")
              .map((_index, element) => text($(element).text()))
              .get(),
          ),
        );
      });
  });

  $("main table").each((_tableIndex, table) => {
    const headers = $(table)
      .find("tr")
      .first()
      .find("th,td")
      .map((_index, cell) => text($(cell).text()))
      .get();
    const shutdownIndex = headers.indexOf("Shutdown Date");
    const modelIndex = headers.indexOf("Deprecated Model");
    const priceIndex = headers.indexOf("Deprecated Model Price");
    const replacementIndex = headers.indexOf("Recommended Replacement");
    if (shutdownIndex < 0 || modelIndex < 0 || replacementIndex < 0) return;
    $(table)
      .find("tr")
      .slice(1)
      .each((_rowIndex, row) => {
        const elements = $(row).find("td");
        const cells = elements.map((_cellIndex, cell) => text($(cell).text())).get();
        const at = date(cells[shutdownIndex] ?? "");
        const id = modelIdSchema.safeParse(cells[modelIndex]);
        if (at === undefined || !id.success) return;
        const replacementIds = elements
          .eq(replacementIndex)
          .find("code")
          .map((_index, element) => text($(element).text()))
          .get();
        const fallbackReplacement = modelIdSchema.safeParse(cells[replacementIndex]);
        if (fallbackReplacement.success) replacementIds.push(fallbackReplacement.data);
        model(models, input, id.data, []);
        update(models, id.data, (current) => ({
          ...current,
          status: at <= observedDate ? "retired" : "deprecated",
          retired_at: at,
          replacement_model_ids: unique([
            ...current.replacement_model_ids,
            ...validModelIds(replacementIds),
          ]),
        }));
        factCount += 1;
        if (/\$[\d.]+\s*\/\s*1K searches/i.test(cells[priceIndex] ?? ""))
          input.onPricingReconciliation?.({
            disposition: "excluded",
            reason_code: "historical_retired_price",
          });
      });
  });
  if (factCount === 0) throw new Error("Cohere lifecycle structure drifted");
}

function key(value: string, keepDate: boolean): string {
  return value
    .toLowerCase()
    .replace(/[+]/g, " plus ")
    .replace(/\bc4ai\b|\bcohere(?:'s|’s)?\b|\bmodel\b/g, " ")
    .replace(keepDate ? /$^/ : /-\d{2}-\d{4}\b/g, " ")
    .replace(/\bv(?=\d)/g, "")
    .replace(/(\d+)\.0\b/g, "$1")
    .replace(/[^a-z0-9]+/g, "");
}

function productMatches(
  models: Map<string, ProviderModel>,
  label: string,
  keepDate = false,
): ProviderModel[] {
  const target = key(label, keepDate);
  const matches = [...models.values()].filter(
    (item) =>
      item.status !== "retired" &&
      (key(item.model_id, keepDate) === target || key(item.name, keepDate) === target),
  );
  const active = matches.filter(({ status }) => status === "active");
  return active.length > 0 ? active : matches;
}

function reconcileUnmatched(
  label: string,
  matches: readonly ProviderModel[],
  reconcile?: Reconcile,
  count = 1,
): void {
  for (let index = 0; index < count; index += 1)
    reconcile?.({
      disposition: matches.length === 0 ? "unbound" : "ambiguous",
      reason_code: matches.length === 0 ? "pricing_product_unbound" : "pricing_product_ambiguous",
      sample: label,
    });
}

function collectPricing(value: unknown, result: z.infer<typeof pricingModelSchema>[]): void {
  const parsed = pricingModelSchema.safeParse(value);
  if (parsed.success) result.push(parsed.data);
  if (Array.isArray(value)) {
    for (const item of value) collectPricing(item, result);
    return;
  }
  const record = z.record(z.string(), z.unknown()).safeParse(value);
  if (record.success) for (const item of Object.values(record.data)) collectPricing(item, result);
}

function pricingModels($: Document, reconcile?: Reconcile): z.infer<typeof pricingModelSchema>[] {
  const result: z.infer<typeof pricingModelSchema>[] = [];
  $("script").each((_index, element) => {
    const script = ($(element).html() ?? "").trim();
    const prefix = "self.__next_f.push(";
    if (!script.startsWith(prefix) || !script.endsWith(")")) return;
    let value: unknown;
    try {
      value = JSON.parse(script.slice(prefix.length, -1));
    } catch {
      return;
    }
    const frame = z.array(z.unknown()).safeParse(value);
    if (!frame.success) return;
    const payload = z.string().safeParse(frame.data[1]);
    const colon = payload.success ? payload.data.indexOf(":") : -1;
    if (!payload.success || colon < 0) return;
    try {
      collectPricing(JSON.parse(payload.data.slice(colon + 1)), result);
    } catch {
      return;
    }
  });
  const products = new Map<string, z.infer<typeof pricingModelSchema>>();
  const conflicts = new Set<string>();
  const comparable = (item: z.infer<typeof pricingModelSchema>): string =>
    JSON.stringify({
      ...item,
      pricings: item.pricings?.toSorted((left, right) =>
        JSON.stringify(left).localeCompare(JSON.stringify(right)),
      ),
    });
  for (const item of result) {
    if (conflicts.has(item.modelName)) continue;
    const existing = products.get(item.modelName);
    if (existing !== undefined && comparable(existing) !== comparable(item)) {
      products.delete(item.modelName);
      conflicts.add(item.modelName);
      reconcile?.({
        disposition: "unresolved",
        reason_code: "responsive_pricing_conflict",
        sample: item.modelName,
      });
      continue;
    }
    if (!products.has(item.modelName)) products.set(item.modelName, item);
  }
  return [...products.values()];
}

export function parseCoherePublicPricingProducts(
  body: string,
  reconcile?: Reconcile,
): CoherePublicPricingProduct[] {
  return pricingModels(load(body), reconcile);
}

function nestedText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(nestedText).join(" ");
  const record = z.record(z.string(), z.unknown()).safeParse(value);
  return record.success ? Object.values(record.data).map(nestedText).join(" ") : "";
}

function applyPricing(
  input: Input,
  models: Map<string, ProviderModel>,
  body: string,
  minimum: number,
  maximum: number,
): void {
  const $ = load(body);
  const products = parseCoherePublicPricingProducts(body, input.onPricingReconciliation);
  assertItemCount("Cohere pricing products", products.length, minimum, maximum);
  for (const product of products) {
    const description = nestedText(product.portableDescription);
    const matches = productMatches(models, product.modelName);
    const current = matches.length === 1 ? matches[0] : undefined;
    if (current === undefined) {
      if (/custom enterprise pricing|contact (?:our )?(?:team|sales)/i.test(description))
        input.onPricingReconciliation?.({
          disposition: "excluded",
          reason_code: /North|Compass/i.test(product.modelName)
            ? "out_of_scope_orchestration_offer"
            : "out_of_scope_capacity_offer",
          sample: product.modelName,
        });
      else reconcileUnmatched(product.modelName, matches, input.onPricingReconciliation);
      continue;
    }
    if (product.per === "Free") {
      if (product.pricings?.some(({ inputLabel }) => /API key/i.test(inputLabel)) === true) {
        update(models, current.model_id, (item) => ({
          ...item,
          pricing_state: "free",
        }));
        input.onPricingReconciliation?.({
          disposition: "explicit_non_numeric",
          reason_code: "free",
        });
      }
      continue;
    }
    if (product.per !== "1M tokens") {
      input.onPricingReconciliation?.({
        disposition: "unbound",
        reason_code: "unsupported_pricing_unit",
        sample: `${product.modelName}: ${product.per}`,
      });
      continue;
    }
    for (const item of product.pricings ?? []) {
      const unit = item.overridePer ?? product.per;
      const add = (label: string, price: number): void => {
        const normalized = label.toLowerCase();
        const rate = (() => {
          if (unit === "1K searches")
            return publishedRate(
              "rerank_request",
              String(price),
              "thousand_search_units",
              input.source.id,
              unit,
            );
          if (unit !== "1M tokens") return;
          if (current.tasks.includes("embeddings"))
            return publishedRate(
              "embedding",
              String(price),
              "million_tokens",
              input.source.id,
              unit,
              {
                modality: normalized.includes("image") ? "image" : "text",
              },
            );
          if (normalized === "input" || normalized === "output")
            return publishedRate(
              normalized === "output" ? "output_text" : "input_text",
              String(price),
              "million_tokens",
              input.source.id,
              unit,
            );
        })();
        if (rate === undefined) {
          input.onPricingReconciliation?.({
            disposition: "unbound",
            reason_code: "unsupported_pricing_meter",
            sample: `${product.modelName}: ${label} per ${unit}`,
          });
          return;
        }
        update(models, current.model_id, (modelValue) =>
          addRate(modelValue, rate, input.onPricingReconciliation),
        );
      };
      if (item.inputPrice === null)
        input.onPricingReconciliation?.({
          disposition: "explicit_non_numeric",
          reason_code: "price_not_published",
        });
      else if (item.inputPrice !== undefined) add(item.inputLabel, item.inputPrice);
      if (item.outputPrice === null)
        input.onPricingReconciliation?.({
          disposition: "explicit_non_numeric",
          reason_code: "price_not_published",
        });
      else if (item.outputLabel !== undefined && item.outputPrice !== undefined)
        add(item.outputLabel, item.outputPrice);
    }
  }
  const legacy =
    /(.+?) pricing is \$[\d.]+\/1M tokens for input and \$[\d.]+\/1M tokens for output/i;
  $("li,p")
    .filter((_index, element) => $(element).find("li,p").length === 0)
    .each((_index, element) => {
      const label = text($(element).text()).match(legacy)?.[1];
      if (label === undefined) return;
      if (!/Command(?:-light| R(?:\+)?(?: \d{2}-\d{4})?)?$/i.test(label)) return;
      for (let index = 0; index < 2; index += 1)
        input.onPricingReconciliation?.({
          disposition: "excluded",
          reason_code: "out_of_scope_account_offer",
          sample: label,
        });
    });
  const aya = text($("body").text()).match(
    /Aya Expanse models \(8B and 32B\).*?\$([\d.]+)\/1M tokens for input and \$([\d.]+)\/1M tokens for output/i,
  );
  if (aya?.[1] !== undefined && aya[2] !== undefined)
    for (const id of ["c4ai-aya-expanse-8b", "c4ai-aya-expanse-32b"]) {
      const target = models.get(id);
      if (target === undefined) {
        reconcileUnmatched(id, [], input.onPricingReconciliation, 2);
      } else if (target.status === "retired") {
        for (let index = 0; index < 2; index += 1)
          input.onPricingReconciliation?.({
            disposition: "excluded",
            reason_code: "historical_retired_price",
          });
      } else
        update(models, id, (item) =>
          addRate(
            addRate(
              item,
              publishedRate(
                "input_text",
                aya[1] ?? "",
                "million_tokens",
                input.source.id,
                "1M tokens",
              ),
              input.onPricingReconciliation,
            ),
            publishedRate(
              "output_text",
              aya[2] ?? "",
              "million_tokens",
              input.source.id,
              "1M tokens",
            ),
            input.onPricingReconciliation,
          ),
        );
    }
}

function applyAliasPricing(models: Map<string, ProviderModel>): void {
  for (const current of models.values()) {
    const targetId = current.description?.match(
      /^Alias for ([a-z0-9](?:[a-z0-9._:/-]*[a-z0-9])?)\.?$/i,
    )?.[1];
    const parsed = modelIdSchema.safeParse(targetId);
    const target = parsed.success ? models.get(parsed.data) : undefined;
    if (
      target === undefined ||
      current.pricing_state !== "unknown" ||
      (target.pricing_state === "unknown" && target.price_facts.length === 0)
    )
      continue;
    models.set(current.model_id, {
      ...current,
      pricing_state: target.pricing_state,
      price_facts: [...target.price_facts],
      raw_price_facts: [...target.raw_price_facts],
    });
  }
}

function finalizeRetiredPricing(models: Map<string, ProviderModel>): void {
  for (const current of models.values())
    if (current.status === "retired")
      models.set(current.model_id, {
        ...current,
        pricing_state: "not_applicable",
        price_facts: [],
        raw_price_facts: [],
      });
}

function addAccountingGaps(
  models: Map<string, ProviderModel>,
  valid: ReadonlySet<string>,
  sourceRef: string,
): void {
  const gaps = accountingReferences
    .filter(({ documentPath }) => !valid.has(documentPath))
    .map(({ gap }) => gap);
  if (gaps.length === 0) return;
  for (const current of models.values()) {
    const paths = new Set(current.api_endpoints?.map(({ path }) => path) ?? []);
    const relevant = gaps.filter(
      (gap) =>
        gap === "policy" ||
        (gap === "chat-v2" && paths.has("v2/chat")) ||
        (gap === "chat-v1" && paths.has("v1/chat")) ||
        (gap === "embed-v2" && paths.has("v2/embed")) ||
        (gap === "rerank-v2" && paths.has("v2/rerank")),
    );
    if (relevant.length === 0) continue;
    models.set(current.model_id, {
      ...current,
      raw_price_facts: [
        ...current.raw_price_facts,
        ...relevant.map(
          (gap) =>
            ({
              term_key: `accounting_binding_unavailable:${gap}`,
              impact: "informational",
              reason: "unknown_meter",
              conditions: {},
              source_ref: sourceRef,
              raw: {
                fragment: `The exact Cohere billed-unit binding is unavailable because ${gap} evidence drifted`,
              },
            }) satisfies SourceRawPricingFact,
        ),
      ],
    });
  }
}

function includesId(value: string, id: string): boolean {
  return [...value.matchAll(/[a-z0-9][a-z0-9._:/-]*/gi)].some(
    (match) => match[0].replace(/[.,;:]+$/, "").toLowerCase() === id.toLowerCase(),
  );
}

function applyRelease(
  models: Map<string, ProviderModel>,
  value: string,
  released: string | undefined,
  display?: string,
): void {
  if (released === undefined) return;
  const matches = [...models.values()].filter(
    (current) => /[-._/:]/.test(current.model_id) && includesId(value, current.model_id),
  );
  for (const current of matches)
    update(models, current.model_id, (item) => ({
      ...item,
      name:
        matches.length === 1 && display !== undefined && item.name === item.model_id
          ? display
          : item.name,
      release_date: released,
    }));
}

function releases(models: Map<string, ProviderModel>, body: string, root: boolean): void {
  const $ = load(body);
  if (!root) {
    const value = text($(".fern-prose").text());
    if (!/(?:announc|releas|refresh)/i.test(value) || /(?:deprecat|retirement notice)/i.test(value))
      return;
    const display = text($("h2,h3").first().text())
      .replace(/^(?:Announcing|Meet)\s+/i, "")
      .replace(/^Cohere(?:'s|’s)\s+/i, "")
      .replace(/\s+Model(?: is Here!)?$/i, "");
    applyRelease(
      models,
      value,
      date(text($(".fern-docs-badge").first().text())),
      display || undefined,
    );
    return;
  }
  const entries = new Map<string, string>();
  $(".fern-docs-badge").each((_index, badge) => {
    const link = $(badge).closest("a");
    const path = link.attr("href");
    if (path !== undefined && !entries.has(path)) entries.set(path, text($(badge).text()));
  });
  const prose = $(".fern-prose")
    .map((_index, element) => text($(element).text()))
    .get()
    .filter(Boolean);
  const dated = [...entries];
  if (dated.length !== prose.length) {
    return;
  }
  for (const [index, [path, at]] of dated.entries()) {
    if (/(?:retirement|deprecat)/i.test(path)) continue;
    const content = prose[index];
    if (content) applyRelease(models, content, date(at));
  }
}

function applyGenerateEndpoint(
  models: Map<string, ProviderModel>,
  references: EndpointReferences,
): void {
  const reference = references.byLabel.get("Generate");
  if (reference?.modelIds === undefined) return;
  for (const id of reference.modelIds) {
    if (!models.has(id)) continue;
    update(models, id, (current) => withEndpoints(current, [reference.endpoint]));
  }
}

function exactDocument(documents: LinkedDocument[], pathname: string): LinkedDocument {
  const matches = documents.filter(({ url }) => new URL(url).pathname === pathname);
  const document = matches[0];
  if (matches.length !== 1 || document === undefined)
    throw new Error(`Cohere companion document is missing: ${pathname}`);
  return document;
}

function indexedModelDocuments(
  index: LinkedDocument,
  documents: LinkedDocument[],
  minimum: number,
  maximum: number,
): LinkedDocument[] {
  const paths = new Set<string>();
  const origin = new URL(index.url).origin;
  for (const match of index.body.matchAll(/\[[^\]]+\]\(([^)\s]+)\)/g)) {
    const target = match[1];
    if (target === undefined) continue;
    let url: URL;
    try {
      url = new URL(target, index.url);
    } catch {
      continue;
    }
    if (url.origin !== origin || !/^\/docs\/[a-z0-9.-]+\.md$/.test(url.pathname)) continue;
    paths.add(url.pathname.slice(0, -".md".length));
  }
  assertItemCount("Cohere model documents", paths.size, minimum, maximum);
  const byPath = new Map<string, LinkedDocument>();
  for (const document of documents) {
    const pathname = new URL(document.url).pathname;
    if (!paths.has(pathname)) continue;
    if (byPath.has(pathname)) throw new Error(`Duplicate Cohere model document: ${pathname}`);
    byPath.set(pathname, document);
  }
  return [...paths].flatMap((pathname) => byPath.get(pathname) ?? []);
}

export function parseCohereCatalog(input: Input): ProviderModel[] {
  if (input.source.extractor.kind !== "cohere-catalog")
    throw new Error("Invalid Cohere catalog extractor");
  const configuration = input.source.extractor;
  const linkedDocuments = input.source.linkedDocuments;
  if (linkedDocuments === undefined) throw new Error("Cohere catalog requires linked documents");
  const bundle = linkedBundleSchema.parse(JSON.parse(input.body));
  const models = new Map<string, ProviderModel>();
  const references = endpointReferences(bundle.documents, input.onPricingReconciliation);
  const accounting = validateAccountingReferences(bundle.documents, input.onPricingReconciliation);
  const modelDocuments = indexedModelDocuments(
    bundle.index,
    bundle.documents,
    linkedDocuments.minDocuments,
    linkedDocuments.maxDocuments,
  );
  rootTables(input, models, exactDocument(bundle.documents, "/docs/models").body, references);
  for (const document of modelDocuments) {
    const url = new URL(document.url);
    modelCard(input, models, url, document.body, references, bundle.documents);
    if (/^\/docs\/transcribe(?:-arabic)?$/.test(url.pathname))
      transcribePage(input, models, url, document.body, references);
  }
  for (const document of bundle.documents) {
    const url = new URL(document.url);
    if (url.pathname === "/docs/deprecations") lifecycle(input, models, document.body);
  }
  applyGenerateEndpoint(models, references);
  for (const document of bundle.documents) {
    const url = new URL(document.url);
    if (url.pathname.includes("/changelog"))
      releases(models, document.body, url.pathname === "/v2/changelog");
  }
  applyAliasPricing(models);
  finalizeRetiredPricing(models);
  addAccountingGaps(models, accounting, input.source.id);
  assertItemCount(
    "Cohere model catalog",
    models.size,
    configuration.minModels,
    configuration.maxModels,
  );
  return [...models.values()].sort((left, right) => left.model_id.localeCompare(right.model_id));
}

export function parseCoherePricing(input: Input): ProviderModel[] {
  if (input.source.extractor.kind !== "cohere-pricing")
    throw new Error("Invalid Cohere pricing extractor");
  if (input.catalogModels === undefined) throw new Error("Cohere pricing requires the catalog");
  const models = new Map(
    input.catalogModels.map((target) => {
      const value = {
        ...baseModel({
          providerId: input.provider.id,
          id: target.model_id,
          ...(target.version === undefined ? {} : { version: target.version }),
          name: target.name,
          sourceId: input.source.id,
          observedAt: input.observedAt,
        }),
        aliases: [...target.aliases],
        tasks: [...target.tasks],
        status: target.status,
      } satisfies ProviderModel;
      return [value.model_id, value] as const;
    }),
  );
  applyPricing(
    input,
    models,
    input.body,
    input.source.extractor.minProducts,
    input.source.extractor.maxProducts,
  );
  finalizeRetiredPricing(models);
  return [...models.values()]
    .filter(
      ({ price_facts, raw_price_facts, pricing_state }) =>
        price_facts.length > 0 || raw_price_facts.length > 0 || pricing_state !== "unknown",
    )
    .sort((left, right) => left.model_id.localeCompare(right.model_id));
}

export function parseCohereApi(input: Input): ProviderModel[] {
  if (input.source.extractor.kind !== "cohere-api") throw new Error("Invalid Cohere API extractor");
  const value = apiSchema.parse(JSON.parse(input.body));
  if (value.next_page_token !== undefined)
    throw new Error("Cohere Models API response was truncated");
  const items = recognizeItems({
    label: "Cohere API model",
    items: value.models,
    schema: apiItemSchema,
    modelId: "name",
    rootKeys: [...Object.keys(apiItemSchema.shape), ...(input.source.extractor.knownFields ?? [])],
    skipInvalidItems: true,
    ...(input.onContractFinding === undefined ? {} : { onFinding: input.onContractFinding }),
  });
  const unknownEndpoints = new Set<string>();
  const models: ProviderModel[] = items.map((item) => {
    const facts = (item.endpoints ?? []).flatMap((endpoint) => {
      const parsed = endpointSchema.safeParse(endpoint);
      if (!parsed.success) {
        unknownEndpoints.add(endpoint);
        return [];
      }
      return [apiEndpointFacts.get(parsed.data) ?? {}];
    });
    const tasks = unique(
      facts.flatMap((fact) => (fact.operation === undefined ? [] : [fact.operation])),
    );
    const apiEndpoints = unique(
      facts.flatMap(({ endpoint }) => (endpoint === undefined ? [] : [endpoint])),
    ).sort((left, right) => apiEndpointKey(left).localeCompare(apiEndpointKey(right)));
    return {
      ...baseModel({
        providerId: input.provider.id,
        id: item.name,
        name: item.name,
        sourceId: input.source.id,
        observedAt: input.observedAt,
      }),
      tasks,
      api_endpoints: apiEndpoints.length === 0 ? undefined : apiEndpoints,
      limits:
        item.context_length === undefined || item.context_length === 0
          ? {}
          : { context_tokens: item.context_length },
      status: item.is_deprecated === true ? ("deprecated" as const) : ("unknown" as const),
    };
  });
  if (unknownEndpoints.size > 0)
    input.onContractFinding?.(contractExtensionEvidence(["/models/*/endpoints/*"]));
  return models;
}
