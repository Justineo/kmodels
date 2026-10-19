import { load } from "cheerio";
import { z } from "zod";
import { linkedBundleSchema } from "./bundle.ts";
import { modelIdSchema } from "./identity.ts";
import { baseModel } from "./model.ts";
export { parseOpenAiAccounting } from "./openai-accounting.ts";
import { decimalsEqual, multiplyDecimal, rawPricingFact } from "./pricing.ts";
import { applyOpenAiCardRules } from "./openai-card-rules.ts";
import { openAiContainerMinimum } from "./openai-container-pricing.ts";
import { openAiSearchContent } from "./openai-search-content.ts";
import type { ProviderAtomRegistryEntry, RawPriceObservation } from "./pricing-schema.ts";
import {
  openAiModelPriceCells,
  parseOpenAiPricingCell,
  type OpenAiPricingTable,
  type OpenAiPricingTier,
  type OpenAiPricingClaim,
} from "./openai-pricing-cells.ts";
import type { PricingReconciliationItem } from "./pricing-reconciliation.ts";
import {
  sourcePriceFactKey,
  type ParsedProviderModel as ProviderModel,
  type SourceCommercialPricingFact,
  type SourcePriceFact,
  type SourceRawPricingFact,
  type SourcePriceStateFact,
} from "./pricing-source.ts";
import { assertItemCount, contractExtensionEvidence, recognizeItems } from "./source-contract.ts";
import { classifyModelTasks } from "./task.ts";
import { modalitySchema, type Modality, type ModelTask, unknownCapabilities } from "./schema.ts";
import type { SourceParseInput as ParseInput, SourceParseResult } from "./source-parse.ts";

const openAiItemSchema = z.object({
  id: modelIdSchema,
  object: z.literal("model"),
  created: z.number().int().nonnegative(),
  owned_by: z.string().min(1),
});

const listSchema = z.object({ data: z.array(z.unknown()) });

type LoadedDocument = ReturnType<typeof load>;
type Selection = ReturnType<LoadedDocument>;

function parseJson(body: string): unknown {
  return JSON.parse(body);
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function normalizedText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function pricingOwners($: LoadedDocument): Selection {
  const headings = $("main div")
    .filter(
      (_index, element) =>
        $(element).children().length === 0 &&
        normalizedText($(element).text()) === "Pricing" &&
        $(element).parents("aside,blockquote,pre,code,script,style,template").length === 0,
    )
    .parent();
  const owners = headings.toArray();
  return headings.filter(
    (_index, element) =>
      !$(element)
        .parents()
        .toArray()
        .some((parent) => owners.includes(parent)),
  );
}

const openAiEndpointDefinitions = new Map<string, { name: string; tasks: ModelTask[] }>([
  ["v1/chat/completions", { name: "Chat Completions", tasks: ["text_generation"] }],
  ["v1/responses", { name: "Responses", tasks: ["text_generation"] }],
  ["v1/live/sessions", { name: "Live", tasks: ["speech_to_speech"] }],
  ["v1/realtime", { name: "Realtime", tasks: ["speech_to_speech"] }],
  ["v1/realtime/translations", { name: "Realtime translation", tasks: ["translation"] }],
  [
    "v1/realtime/transcription_sessions",
    { name: "Realtime transcription", tasks: ["transcription"] },
  ],
  ["v1/assistants", { name: "Assistants", tasks: ["text_generation"] }],
  ["v1/batch", { name: "Batch", tasks: [] }],
  ["v1/fine-tuning", { name: "Fine-tuning", tasks: [] }],
  ["v1/embeddings", { name: "Embeddings", tasks: ["embeddings"] }],
  ["v1/images/generations", { name: "Image generation", tasks: ["image_generation"] }],
  ["v1/videos", { name: "Videos", tasks: ["video_generation"] }],
  ["v1/images/edits", { name: "Image edit", tasks: ["image_generation"] }],
  ["v1/audio/speech", { name: "Speech generation", tasks: ["speech_synthesis"] }],
  ["v1/audio/transcriptions", { name: "Transcription", tasks: ["transcription"] }],
  ["v1/audio/translations", { name: "Translation", tasks: ["translation"] }],
  ["v1/moderations", { name: "Moderation", tasks: ["moderation"] }],
  ["v1/completions", { name: "Completions (legacy)", tasks: ["text_generation"] }],
]);

interface OpenAiEndpointEvidence {
  endpoints: NonNullable<ProviderModel["api_endpoints"]>;
  tasks: ModelTask[];
  support: ReadonlyMap<string, boolean>;
}

function markdownSection(body: string, heading: string): string | undefined {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((line) => line === `## ${heading}`);
  if (start < 0) return undefined;
  const end = lines.findIndex((line, index) => index > start && line.startsWith("## "));
  return lines
    .slice(start + 1, end < 0 ? undefined : end)
    .join("\n")
    .trim();
}

function openAiEndpointEvidence(
  body: string,
  fallback: ModelTask[],
  onFinding: ParseInput["onContractFinding"],
): OpenAiEndpointEvidence {
  const content = markdownSection(body, "Endpoints");
  if (content === undefined) {
    onFinding?.(contractExtensionEvidence(["/models/endpoints/table"]));
    return { endpoints: [], tasks: fallback, support: new Map() };
  }
  const lines = content.split(/\r?\n/);
  const headerIndex = lines.findIndex(
    (line) => markdownCells(line).join("\0") === ["Endpoint", "Route", "Support"].join("\0"),
  );
  if (headerIndex < 0 || lines[headerIndex + 1] === undefined) {
    onFinding?.(contractExtensionEvidence(["/models/endpoints/header"]));
    return { endpoints: [], tasks: fallback, support: new Map() };
  }
  const separators = markdownCells(lines[headerIndex + 1] ?? "");
  if (separators.length !== 3 || !separators.every((cell) => /^:?-{3,}:?$/.test(cell))) {
    onFinding?.(contractExtensionEvidence(["/models/endpoints/separator"]));
    return { endpoints: [], tasks: fallback, support: new Map() };
  }
  const endpoints: NonNullable<ProviderModel["api_endpoints"]> = [];
  const tasks: ModelTask[] = [];
  const groupedSupport = new Map<string, boolean | null>();
  const findings: string[] = [];
  for (let index = headerIndex + 2; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (!line.trim().startsWith("|")) break;
    const cells = markdownCells(line);
    if (cells.length !== 3) {
      findings.push(`/models/endpoints/row-${index - headerIndex - 1}`);
      continue;
    }
    const name = cells[0] ?? "";
    const path = (cells[1] ?? "").replace(/^`|`$/g, "");
    const support = cells[2];
    const definition = openAiEndpointDefinitions.get(path);
    if (definition === undefined || definition.name !== name) {
      findings.push(`/models/endpoints/${path || "unknown"}`);
      continue;
    }
    if (groupedSupport.has(path)) findings.push(`/models/endpoints/${path}/duplicate`);
    if (support !== "Supported" && support !== "Not supported")
      findings.push(`/models/endpoints/${path}/support`);
    const supported = support === "Supported" ? true : support === "Not supported" ? false : null;
    const current = groupedSupport.get(path);
    groupedSupport.set(path, current === undefined || current === supported ? supported : null);
  }
  const supportByPath = new Map<string, boolean>();
  for (const [path, supported] of groupedSupport) {
    if (supported === null) continue;
    supportByPath.set(path, supported);
    const definition = openAiEndpointDefinitions.get(path);
    if (supported && definition !== undefined) {
      endpoints.push({ name: definition.name, path });
      tasks.push(...definition.tasks);
    }
  }
  for (const path of openAiEndpointDefinitions.keys())
    if (!groupedSupport.has(path)) findings.push(`/models/endpoints/${path}/missing`);
  if (findings.length > 0) onFinding?.(contractExtensionEvidence(findings));
  return {
    endpoints,
    tasks: tasks.length > 0 ? unique(tasks) : fallback,
    support: supportByPath,
  };
}

function openAiMeter(
  group: string,
  label: string,
  tasks: ModelTask[],
): SourcePriceFact["meter"] | undefined {
  if (group === "Text tokens") {
    if (label === "Input") return "input_text";
    if (label === "Cached input") return "cache_read_text";
    if (label === "Cache writes") return "cache_write_text";
    if (label === "Output") return "output_text";
  }
  if (group === "Audio tokens") {
    if (label === "Input") return "input_audio";
    if (label === "Cached input") return "cache_read_audio";
    if (label === "Output") return "output_audio";
  }
  if (group === "Image tokens") {
    if (label === "Input") return "input_image";
    if (label === "Cached input") return "cache_read_image";
    if (label === "Output") return "output_image";
  }
  if (group === "Embeddings" && (label === "Cost" || label === "Price")) return "embedding";
  if (group === "Image generation") return "image_generation";
  if (group === "Video generation") return "video_generation";
  if (group === "Transcription audio duration" && label === "Price") return "input_audio";
  if (group === "Live session duration" && label === "Per minute") return "session_runtime";
  if (group === "Realtime audio duration" && label === "Price") {
    if (tasks.includes("transcription") || tasks.includes("translation")) return "input_audio";
    if (tasks.includes("speech_synthesis") || tasks.includes("speech_to_speech"))
      return "output_audio";
  }
}

function openAiCardTier(
  $: LoadedDocument,
  header: ReturnType<LoadedDocument>,
  group: string,
): "standard" | "batch" {
  const headers = header
    .parent()
    .children()
    .filter((_index, element) => normalizedText($(element).children().first().text()) === group);
  const toggleHeaders = headers.filter(
    (_index, element) => $(element).find('button[role="switch"]').length > 0,
  );
  if (toggleHeaders.length === 0) return "standard";
  if (toggleHeaders.length !== 1 || headers.length > 2)
    throw new Error(`Unsupported OpenAI ${group} price-tier selector`);
  const toggle = toggleHeaders.first().find('button[role="switch"]').attr("aria-checked");
  if (toggle !== "true" && toggle !== "false")
    throw new Error(`OpenAI ${group} price-tier selector omitted its state`);
  const primary = header.get(0) === toggleHeaders.get(0);
  return primary === (toggle === "true") ? "batch" : "standard";
}

function openAiPricing(
  $: LoadedDocument,
  sourceId: string,
  tasks: ModelTask[],
): ReturnType<typeof applyOpenAiCardRules> {
  const claims: OpenAiPricingClaim[] = [];
  const owners = pricingOwners($);
  if (owners.length === 0) return { rates: [], raw: [], items: [] };
  if (owners.length !== 1)
    return {
      rates: [],
      raw: [
        rawPricingFact(sourceId, "model-card-pricing", "base_price", "unknown_applicability", {
          fragment: normalizedText(owners.text()).slice(0, 4096) || "Pricing",
        }),
      ],
      items: [
        {
          disposition: "unresolved",
          reason_code: "model_card_price_scope_unresolved",
          sample: "Multiple Pricing owners",
        },
      ],
    };
  const content = owners.children().eq(1);
  const owned = (selector: string) =>
    content
      .find(selector)
      .filter(
        (_index, element) =>
          !$(element)
            .parentsUntil(content)
            .is("aside,blockquote,pre,code,script,style,template,section"),
      );
  const groups = new Set([
    "Text tokens",
    "Audio tokens",
    "Image tokens",
    "Embeddings",
    "Image generation",
    "Video generation",
    "Transcription audio duration",
    "Realtime audio duration",
    "Live session duration",
  ]);
  owned("div")
    .filter(
      (_index, element) =>
        $(element).children().length === 0 && normalizedText($(element).text()).startsWith("Per "),
    )
    .each((_index, element) => {
      const unitNode = $(element);
      const header = unitNode
        .parents()
        .filter((_parentIndex, parent) => {
          const children = $(parent).children();
          return children.length >= 2 && groups.has(normalizedText(children.first().text()));
        })
        .first();
      const group = normalizedText(header.children().first().text());
      const rawUnit = normalizedText(unitNode.text());
      let serviceTier: "standard" | "batch" | undefined;
      try {
        serviceTier = openAiCardTier($, header, group);
      } catch {
        // Keep the source quote, but do not infer a tier from an unreadable switch.
      }
      const unit: SourcePriceFact["unit"] | undefined =
        rawUnit === "Per 1M tokens"
          ? "million_tokens"
          : rawUnit === "Per image"
            ? "image"
            : rawUnit === "Per second"
              ? "second"
              : rawUnit === "Per minute"
                ? "minute"
                : undefined;
      const cards = header.next().children();
      let quality: string | undefined;
      cards.each((_cardIndex, card) => {
        const label = normalizedText($(card).children().first().text());
        const value = normalizedText($(card).children().last().text());
        if (label === "Quality" && !value.startsWith("$")) quality = value;
      });
      cards.each((_cardIndex, card) => {
        const label = normalizedText($(card).children().first().text());
        const rawPrice = normalizedText($(card).children().last().text());
        if (label === "Quality") return;
        const meter = openAiMeter(group, label, tasks);
        const conditions: SourcePriceFact["conditions"] =
          serviceTier === undefined ? {} : { service_tier: serviceTier };
        if (quality !== undefined) conditions.quality = quality;
        if (group === "Image generation" || group === "Video generation")
          conditions.resolution = label;
        const claim = parseOpenAiPricingCell(
          {
            label,
            value: rawPrice,
            ...(meter === undefined ? {} : { meter }),
            ...(unit === undefined || serviceTier === undefined ? {} : { unit }),
            rawUnit,
            conditions,
          },
          sourceId,
        );
        if (serviceTier === undefined && claim.raw !== undefined)
          claim.raw.reason = "unknown_applicability";
        claims.push(claim);
      });
    });

  owned("div")
    .filter(
      (_index, element) =>
        normalizedText($(element).children().first().text()) === "Pricing" &&
        $(element).children().length === 2,
    )
    .each((_index, element) => {
      const cards = $(element).next().children();
      let useCase: string | undefined;
      let rawPrice: string | undefined;
      let rawUnit: string | undefined;
      cards.each((_cardIndex, card) => {
        const label = normalizedText($(card).children().first().text());
        const value = normalizedText($(card).children().last().text());
        if (label.startsWith("Use case / ")) useCase = value;
        if (label.startsWith("Cost / ")) {
          rawPrice = value;
          rawUnit = label.slice("Cost / ".length);
        }
      });
      if (useCase === undefined || rawPrice === undefined || rawUnit === undefined) return;
      const meter: SourcePriceFact["meter"] | undefined =
        useCase === "Speech generation"
          ? "output_audio"
          : useCase === "Transcription"
            ? "input_audio"
            : undefined;
      const unit: SourcePriceFact["unit"] | undefined =
        rawUnit === "1M characters"
          ? "million_characters"
          : rawUnit === "minute"
            ? "minute"
            : undefined;
      claims.push(
        parseOpenAiPricingCell(
          {
            label: useCase,
            value: rawPrice,
            ...(meter === undefined ? {} : { meter }),
            ...(unit === undefined ? {} : { unit }),
            rawUnit: `per ${rawUnit}`,
            conditions: { service_tier: "standard" },
          },
          sourceId,
        ),
      );
    });
  const notes = owned("p")
    .map((_index, element) => normalizedText($(element).text()))
    .toArray();
  const result = applyOpenAiCardRules(claims, notes, sourceId);
  if (claims.length === 0)
    result.items.unshift({
      disposition: "unsupported",
      reason_code: "unreviewed_model_card_pricing",
      sample: normalizedText(content.text()).slice(0, 256) || "Pricing",
    });
  return result;
}

const openAiPricingSections = new Set([
  "Flagship models",
  "Cyber models",
  "GPT-Live sessions",
  "Realtime and audio generation models",
  "Image generation models",
  "Video generation models",
  "Transcription models",
  "Tools",
  "Specialized models",
  "Finetuning",
]);

const openAiPricingTiers = new Map<string, OpenAiPricingTier>([
  ["Standard", "standard"],
  ["Batch", "batch"],
  ["Flex", "flex"],
  ["Fast mode", "fast"],
  ["Fast", "fast"],
  ["Ultrafast", "ultrafast"],
]);

function openAiToolPricingText(body: string): string {
  let inTools = false;
  const lines: string[] = [];
  for (const line of body.split(/\r?\n/)) {
    const text = normalizedText(line);
    if (openAiPricingSections.has(text) || /^[A-Z][A-Za-z ]+ models$/.test(text))
      inTools = text === "Tools";
    else if (inTools) lines.push(line);
  }
  return normalizedText(lines.join("\n"));
}

function markdownCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .replaceAll("\\|", "\u0000")
    .split("|")
    .map((cell) => normalizedText(cell.replaceAll("\u0000", "|")));
}

function markdownCodeValues(value: string): string[] {
  return [...value.matchAll(/`([^`]+)`/g)].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]],
  );
}

const openAiRegionalProcessingRegions = [
  "United States",
  "Europe (EEA + Switzerland)",
  "United Arab Emirates",
] as const;
const openAiRegionalProcessingRegionSet = new Set<string>(openAiRegionalProcessingRegions);

export function parseOpenAiDataResidency(input: ParseInput): ProviderModel[] {
  const requiredHeaders = [
    "Endpoint or feature",
    "Service",
    "Storage regions",
    "Processing regions",
    "Supported models and snapshots",
    "Regional processing snapshot exceptions",
    "Notes",
  ];
  const lines = input.body.split(/\r?\n/);
  const models = new Map<string, ProviderModel>();
  let found = false;
  for (let index = 0; index < lines.length - 1; index += 1) {
    const headers = markdownCells(lines[index] ?? "");
    if (!requiredHeaders.every((header) => headers.includes(header))) continue;
    const separators = markdownCells(lines[index + 1] ?? "");
    if (
      separators.length !== headers.length ||
      !separators.every((cell) => /^:?-{3,}:?$/.test(cell))
    ) {
      input.onContractFinding?.(contractExtensionEvidence(["/data-residency/table/separators"]));
      continue;
    }
    if (found)
      input.onContractFinding?.(contractExtensionEvidence(["/data-residency/table/duplicate"]));
    if (headers.length !== requiredHeaders.length)
      input.onContractFinding?.(contractExtensionEvidence(["/data-residency/table/columns"]));
    found = true;
    const cell = (row: string[], header: string): string => row[headers.indexOf(header)] ?? "";
    index += 2;
    while (index < lines.length && normalizedText(lines[index] ?? "").startsWith("|")) {
      const row = markdownCells(lines[index] ?? "");
      if (row.length !== headers.length) {
        input.onContractFinding?.(
          contractExtensionEvidence([`/data-residency/table/row-${index}`]),
        );
        index += 1;
        continue;
      }
      const endpointCell = cell(row, "Endpoint or feature");
      const endpointPaths = markdownCodeValues(endpointCell).flatMap((value) =>
        value.startsWith("/v1/") ? value.split(/,\s*/).map((path) => path.slice(1)) : [],
      );
      if (endpointPaths.length === 0) {
        index += 1;
        continue;
      }
      const modelIds = markdownCodeValues(cell(row, "Supported models and snapshots")).filter(
        (id) => modelIdSchema.safeParse(id).success,
      );
      if (modelIds.length === 0) {
        index += 1;
        continue;
      }
      const endpointDefinitions = endpointPaths.flatMap((path) => {
        if (path === "v1/batches" || path === "v1/fine_tuning/jobs") return [];
        const definition = openAiEndpointDefinitions.get(path);
        if (definition === undefined) {
          input.onContractFinding?.(
            contractExtensionEvidence([`/data-residency/endpoints/${path}`]),
          );
          return [];
        }
        return [{ path, ...definition }];
      });
      const processingCell = cell(row, "Processing regions");
      let processingRegions =
        processingCell === "None" ? [] : processingCell.split(", ").map(normalizedText);
      const unknownRegions = processingRegions.filter(
        (region) => !openAiRegionalProcessingRegionSet.has(region),
      );
      if (unknownRegions.length > 0)
        input.onContractFinding?.(
          contractExtensionEvidence(
            unknownRegions.map((region) => `/data-residency/regions/${region}`),
          ),
        );
      processingRegions = processingRegions.filter((region) =>
        openAiRegionalProcessingRegionSet.has(region),
      );
      const exceptionCell = cell(row, "Regional processing snapshot exceptions");
      let exceptionIds = markdownCodeValues(exceptionCell).filter((id) => modelIds.includes(id));
      const validException =
        exceptionCell === "None" || exceptionCell.startsWith("United Arab Emirates:");
      if (!validException) {
        input.onContractFinding?.(
          contractExtensionEvidence(["/data-residency/regional-processing-exception"]),
        );
        processingRegions = processingRegions.filter((region) => region !== "United Arab Emirates");
        exceptionIds = [];
      } else if (markdownCodeValues(exceptionCell).length !== exceptionIds.length)
        input.onContractFinding?.(
          contractExtensionEvidence(["/data-residency/regional-processing-exception/models"]),
        );
      for (const modelId of modelIds) {
        const classifiedTasks = classifyModelTasks({
          modelId,
          name: modelId,
          rawType: undefined,
          modalities: { input: [], output: [] },
          fallback: "text_generation",
        });
        const combinedAudio = endpointPaths.length > 1;
        const rowTasks = combinedAudio
          ? classifiedTasks
          : unique(endpointDefinitions.flatMap(({ tasks }) => tasks));
        const endpoints = endpointDefinitions.flatMap(({ name, path, tasks }) =>
          combinedAudio && !tasks.some((task) => rowTasks.includes(task)) ? [] : [{ name, path }],
        );
        const availability: NonNullable<ProviderModel["availability"]> = processingRegions.flatMap(
          (region) =>
            region === "United Arab Emirates" &&
            exceptionIds.length > 0 &&
            !exceptionIds.includes(modelId)
              ? []
              : [{ region, deployment_type: "regional_processing" }],
        );
        const current =
          models.get(modelId) ??
          ({
            ...baseModel({
              providerId: input.provider.id,
              id: modelId,
              name: modelId,
              sourceId: input.source.id,
              observedAt: input.observedAt,
            }),
            status: "active",
          } satisfies ProviderModel);
        const apiEndpoints = [
          ...new Map(
            [...(current.api_endpoints ?? []), ...endpoints].map((endpoint) => [
              `${endpoint.path}\0${endpoint.name}`,
              endpoint,
            ]),
          ).values(),
        ];
        const regionalAvailability = [
          ...new Map(
            [...(current.availability ?? []), ...availability].map((item) => [
              `${item.region}\0${item.deployment_type}`,
              item,
            ]),
          ).values(),
        ].sort((left, right) =>
          `${left.region}\0${left.deployment_type}`.localeCompare(
            `${right.region}\0${right.deployment_type}`,
          ),
        );
        models.set(modelId, {
          ...current,
          tasks: unique([...current.tasks, ...rowTasks]),
          ...(apiEndpoints.length === 0 ? {} : { api_endpoints: apiEndpoints }),
          ...(regionalAvailability.length === 0 ? {} : { availability: regionalAvailability }),
        });
      }
      index += 1;
    }
    index -= 1;
  }
  if (!found) throw new Error("OpenAI data-residency model table was not found");
  if (input.source.extractor.kind !== "openai-data-residency")
    throw new Error("Invalid OpenAI data-residency extractor");
  if (models.size === 0) throw new Error("OpenAI data-residency table contained no model facts");
  return [...models.values()].sort((left, right) => left.uid.localeCompare(right.uid));
}

function openAiPricingTables(
  body: string,
  onReconciliation: ParseInput["onPricingReconciliation"],
): OpenAiPricingTable[] {
  const lines = body.split(/\r?\n/);
  const tables: OpenAiPricingTable[] = [];
  let section: string | undefined;
  let tier: OpenAiPricingTier | undefined;
  let reviewedTier = true;
  for (let index = 0; index < lines.length - 1; index += 1) {
    const line = normalizedText(lines[index] ?? "");
    if (openAiPricingSections.has(line)) {
      section = line;
      tier = undefined;
      reviewedTier = true;
      continue;
    }
    const observedTier = openAiPricingTiers.get(line);
    if (observedTier !== undefined) {
      tier = observedTier;
      reviewedTier = true;
      continue;
    }
    if (line === "Our latest models" || line === "Multimodal models") continue;
    if (/^(?:Standard|Batch|Flex|Fast|Ultrafast|Priority)\b/.test(line)) {
      reviewedTier = false;
      onReconciliation?.({
        disposition: "unsupported",
        reason_code: "unreviewed_pricing_tier",
        sample: line.slice(0, 256),
      });
      continue;
    }
    if (/^[A-Z][A-Za-z ]+ models$/.test(line)) {
      section = undefined;
      tier = undefined;
      reviewedTier = true;
      continue;
    }
    if (!line.startsWith("|") || !normalizedText(lines[index + 1] ?? "").startsWith("|")) continue;
    const headers = markdownCells(line);
    const separators = markdownCells(lines[index + 1] ?? "");
    if (
      headers.length !== separators.length ||
      !separators.every((cell) => /^:?-{3,}:?$/.test(cell))
    )
      continue;
    if (section === undefined || !reviewedTier) {
      onReconciliation?.({
        disposition: "unsupported",
        reason_code: "unreviewed_pricing_table",
        sample: headers.join(" | ").slice(0, 256),
      });
      continue;
    }
    const rows: string[][] = [];
    index += 2;
    while (index < lines.length && normalizedText(lines[index] ?? "").startsWith("|")) {
      const row = markdownCells(lines[index] ?? "");
      if (row.length === headers.length) rows.push(row);
      else
        onReconciliation?.({
          disposition: "unsupported",
          reason_code: "irregular_pricing_row",
          sample: normalizedText(lines[index] ?? "").slice(0, 256),
        });
      index += 1;
    }
    index -= 1;
    tables.push({
      section,
      ...(tier === undefined ? {} : { tier }),
      headers,
      rows,
    });
  }
  return tables;
}

function addUniqueModelIndex<T extends { model_id: string }>(
  index: Map<string, T | null>,
  key: string,
  model: T,
): void {
  const current = index.get(key);
  index.set(
    key,
    current === undefined
      ? model
      : current === null || current.model_id !== model.model_id
        ? null
        : current,
  );
}

type OpenAiCommercialModel = Pick<
  ProviderModel,
  "api_endpoints" | "capabilities" | "pricing_state" | "uid"
>;

function openAiToolCommercialFacts(
  table: OpenAiPricingTable,
  row: string[],
  sourceId: string,
  models: readonly OpenAiCommercialModel[],
  containerBilling: readonly string[],
): SourceCommercialPricingFact[] {
  const tool = row[table.headers.indexOf("Tool")] ?? row[0] ?? "";
  const details = row[table.headers.indexOf("Details")] ?? "";
  const published = row[table.headers.indexOf("Pricing")] ?? row.at(-1) ?? "";
  const responseModels = models.filter(
    ({ api_endpoints, pricing_state }) =>
      pricing_state !== "not_applicable" &&
      api_endpoints?.some(({ path }) => path === "v1/responses"),
  );
  const responseRefs = responseModels.map(({ uid }) => uid);
  const codeExecutionRefs = responseModels
    .filter(({ capabilities }) => capabilities.code_execution === true)
    .map(({ uid }) => uid);
  const fact = (
    key: string,
    name: string,
    offerKey: string,
    offerName: string,
    modelRefs: string[],
    priceFacts: SourcePriceFact[],
    rawPriceFacts: SourceCommercialPricingFact["raw_price_facts"] = [],
  ): SourceCommercialPricingFact => ({
    source_ref: sourceId,
    book_key: `service:${key}`,
    book_name: name,
    resource_kind: "service",
    resource_key: key,
    model_refs: modelRefs,
    offer_key: offerKey,
    offer_name: offerName,
    billing_mode: "usage",
    pricing_state: "numeric",
    price_facts: priceFacts,
    raw_price_facts: rawPriceFacts,
  });
  const callPrice = published.match(/^(.+?) \/ 1k calls(?: \+ .*)?$/i)?.[1];
  const callClaim = (meter: "web_search" | "file_search", conditions = {}) => {
    const claim = parseOpenAiPricingCell(
      {
        label: tool,
        value: callPrice ?? published,
        meter,
        ...(callPrice === undefined ? {} : { unit: "thousand_events" as const }),
        rawUnit: callPrice === undefined ? published : "per 1k calls",
        conditions,
      },
      sourceId,
    );
    if (claim.raw !== undefined) claim.raw.raw.fragment = published;
    return claim;
  };
  if (
    tool === "Web search" &&
    /^(?:Web search \(all models\)|Image Web search \(all models\)|Web search preview \((?:non-reasoning models|reasoning models, including `gpt-5`)\))$/.test(
      details,
    )
  ) {
    const preview = details.startsWith("Web search preview");
    const operation = preview
      ? details.includes("non-reasoning")
        ? "preview_non_reasoning"
        : "preview_reasoning"
      : details.startsWith("Image Web search")
        ? "image"
        : "search";
    const modelRefs = preview
      ? responseModels
          .filter(({ capabilities }) =>
            operation === "preview_non_reasoning"
              ? capabilities.reasoning === false
              : capabilities.reasoning === true,
          )
          .map(({ uid }) => uid)
      : responseRefs;
    const claim = callClaim("web_search", { operation });
    return [
      fact(
        "web-search",
        "Web Search",
        preview ? "preview" : "current",
        preview ? "Web Search Preview" : "Web Search",
        modelRefs,
        claim.rate === undefined ? [] : [claim.rate],
        claim.raw === undefined ? [] : [claim.raw],
      ),
    ];
  }
  if (tool === "File search" && details === "Tool call") {
    const claim = callClaim("file_search");
    return [
      fact(
        "file-search",
        "File Search",
        "usage",
        "File Search usage",
        responseRefs,
        claim.rate === undefined ? [] : [claim.rate],
        claim.raw === undefined ? [] : [claim.raw],
      ),
    ];
  }

  if (tool === "Containers" && details === "Hosted Shell and Code Interpreter") {
    const sessionUnit = " per 20-minute session per container.";
    const knownUnit = published.endsWith(sessionUnit);
    const claims = (knownUnit ? published.slice(0, -sessionUnit.length) : published)
      .split(", ")
      .map((entry): OpenAiPricingClaim => {
        const match = entry.match(/^([1-9]\d*) GB (.+)$/);
        if (match === null)
          return {
            raw: commercialRaw("unparsed:container_runtime", "base_price", entry, sourceId),
            item: { disposition: "raw", reason_code: "unsupported_pricing_cell_preserved" },
          };
        const memory = match[1];
        const amount = match[2];
        return parseOpenAiPricingCell(
          {
            label: "Containers",
            value: amount ?? entry,
            meter: "container_runtime",
            ...(knownUnit ? { unit: "container_session" } : {}),
            rawUnit: knownUnit ? "per 20-minute container session" : published,
            conditions: memory === undefined ? {} : { capacity: `${memory} GiB` },
          },
          sourceId,
        );
      });
    return [
      fact(
        "containers",
        "Code execution containers",
        "runtime",
        "Code execution runtime",
        codeExecutionRefs,
        claims.flatMap(({ rate }) => (rate === undefined ? [] : [rate])),
        [
          ...claims.flatMap(({ raw }) => (raw === undefined ? [] : [raw])),
          ...containerBilling.map((fragment) =>
            commercialRaw("billing-minimum", "base_price", fragment, sourceId),
          ),
        ],
      ),
    ];
  }
  return [];
}

function commercialRaw(
  termKey: string,
  impact: SourceCommercialPricingFact["raw_price_facts"][number]["impact"],
  fragment: string,
  sourceId: string,
): SourceCommercialPricingFact["raw_price_facts"][number] {
  return {
    term_key: termKey,
    impact,
    reason: "unsupported_structure",
    conditions: {},
    source_ref: sourceId,
    raw: { fragment },
  };
}

function openAiPricingAliases(body: string): Map<string, string> {
  const aliases = new Map<string, string>();
  const match = body.match(
    /`([^`]+)`\s+and\s+`([^`]+)`\s+are\s+aliases that currently point to\s+`([^`]+)`\s+and\s+`([^`]+)`, respectively\./,
  );
  if (match === null) return aliases;
  const pairs = [
    [match[1], match[3]],
    [match[2], match[4]],
  ] as const;
  for (const [alias, target] of pairs)
    if (
      alias !== undefined &&
      target !== undefined &&
      modelIdSchema.safeParse(alias).success &&
      modelIdSchema.safeParse(target).success
    )
      aliases.set(alias, target);
  return aliases;
}

function openAiRegionalUpliftEligible(
  model: Pick<ProviderModel, "availability" | "release_date">,
): boolean {
  return (
    model.release_date !== undefined &&
    model.release_date >= "2026-03-05" &&
    model.availability?.some(({ deployment_type }) => deployment_type === "regional_processing") ===
      true
  );
}

function openAiGlobalProcessingRates(
  rates: readonly SourcePriceFact[],
  model: Pick<ProviderModel, "availability" | "release_date">,
): SourcePriceFact[] {
  if (!openAiRegionalUpliftEligible(model)) return [...rates];
  return rates.map((rate) => ({
    ...rate,
    conditions: { ...rate.conditions, deployment_scope: "global_processing" },
  }));
}

function openAiRegionalProcessingRates(rates: readonly SourcePriceFact[]): SourcePriceFact[] {
  return rates.flatMap((rate): SourcePriceFact[] => {
    const global = {
      ...rate,
      conditions: { ...rate.conditions, deployment_scope: "global_processing" },
    };
    return [
      global,
      {
        ...rate,
        price: multiplyDecimal(rate.price, "1.1"),
        conditions: { ...rate.conditions, deployment_scope: "regional_processing" },
        derived: true,
        derivation: "1.1 × published rate for eligible regional-processing endpoints",
        raw_price: undefined,
        raw_unit: "published 10% regional-processing uplift",
      },
    ];
  });
}

export function parseOpenAiPricing(input: ParseInput): SourceParseResult {
  let containerChangelog = "";
  let fastGuide = "";
  let ultrafastGuide = "";
  if (input.body.trimStart().startsWith("{")) {
    const bundle = linkedBundleSchema.parse(parseJson(input.body));
    const documentBody = (path: string): string => {
      const documents = bundle.documents.filter(
        ({ url }) => url === `https://developers.openai.com/api/docs/${path}.md`,
      );
      return documents.length === 1 ? (documents[0]?.body ?? "") : "";
    };
    containerChangelog = documentBody("changelog");
    fastGuide = documentBody("guides/fast-mode");
    ultrafastGuide = documentBody("guides/ultrafast-mode");
    input = { ...input, body: bundle.index.body };
  }
  if (input.catalogModels === undefined)
    throw new Error("OpenAI pricing requires the collected catalog");
  const catalogModels = input.catalogModels;
  const exact = new Map(input.catalogModels.map((model) => [model.model_id, model]));
  const aliases = new Map<string, (typeof input.catalogModels)[number] | null>();
  const names = new Map<string, (typeof input.catalogModels)[number] | null>();
  for (const model of input.catalogModels) {
    addUniqueModelIndex(names, model.name.toLowerCase(), model);
    for (const alias of model.aliases) addUniqueModelIndex(aliases, alias, model);
  }
  const findTarget = (rawId: string): (typeof input.catalogModels)[number] | null | undefined => {
    const direct = exact.get(rawId);
    if (direct !== undefined) return direct;
    if (rawId === rawId.toLowerCase() && modelIdSchema.safeParse(rawId).success) return undefined;
    const alias = aliases.get(rawId);
    return alias === undefined ? names.get(rawId.toLowerCase()) : alias;
  };
  const created = new Map<string, ProviderModel>();
  const createTarget = (modelId: string): ProviderModel => {
    const model = {
      ...baseModel({
        providerId: input.provider.id,
        id: modelId,
        name: modelId,
        sourceId: input.source.id,
        observedAt: input.observedAt,
      }),
      tasks: classifyModelTasks({
        modelId,
        name: modelId,
        rawType: undefined,
        modalities: { input: [], output: [] },
        fallback: "text_generation",
      }),
    } satisfies ProviderModel;
    created.set(modelId, model);
    exact.set(modelId, model);
    return model;
  };
  const rates = new Map<string, Map<string, SourcePriceFact>>();
  const rawByModel = new Map<string, SourceRawPricingFact[]>();
  const items: PricingReconciliationItem[] = [];
  const record = (item: PricingReconciliationItem): void => {
    items.push(item);
  };
  const rateItems = new Map<string, PricingReconciliationItem[]>();
  const modelItems = new Map<
    string,
    { tier: string | undefined; item: PricingReconciliationItem }[]
  >();
  const track = (id: string, claim: OpenAiPricingClaim): void => {
    items.push(claim.item);
    const owners = modelItems.get(id) ?? [];
    owners.push({ tier: (claim.rate ?? claim.raw)?.conditions.service_tier, item: claim.item });
    modelItems.set(id, owners);
    if (claim.raw !== undefined) {
      const facts = rawByModel.get(id) ?? [];
      facts.push(claim.raw);
      rawByModel.set(id, facts);
    }
    const fact = claim.rate;
    if (fact === undefined) return;
    const key = sourcePriceFactKey(fact);
    const ownerKey = id + "\0" + key;
    const peers = rateItems.get(ownerKey) ?? [];
    peers.push(claim.item);
    rateItems.set(ownerKey, peers);
    const quotes = rates.get(id) ?? new Map<string, SourcePriceFact>();
    const sameScope = [...quotes.values()].filter((current) => sourcePriceFactKey(current) === key);
    if (sameScope.some((current) => decimalsEqual(current.price, fact.price))) {
      claim.item.disposition = "excluded";
      claim.item.reason_code = "duplicate_pricing_cell";
    } else {
      if (sameScope.length > 0)
        for (const item of peers) {
          item.disposition = "ambiguous";
          item.reason_code = "pricing_value_conflict";
        }
      quotes.set(JSON.stringify([key, fact.price]), fact);
    }
    rates.set(id, quotes);
  };
  const markScope = (id: string, tier: string | undefined, reason: string): void => {
    for (const owner of modelItems.get(id) ?? [])
      if (
        owner.tier === tier &&
        owner.item.disposition !== "ambiguous" &&
        owner.item.disposition !== "excluded"
      ) {
        owner.item.disposition = "raw";
        owner.item.reason_code = reason;
      }
  };
  const commercialFacts: SourceCommercialPricingFact[] = [];
  const vocabulary: ProviderAtomRegistryEntry[] = [];
  const pricingAliases = openAiPricingAliases(input.body);
  const toolsText = openAiToolPricingText(input.body);
  const containerBilling = [
    ...toolsText.matchAll(/Eligible container sessions will be billed[^.]*\./g),
  ].map(([fragment]) => fragment);
  const containerAnnouncements = [
    ...normalizedText(containerChangelog).matchAll(
      /Starting [^.]+, eligible container sessions will be billed[^.]*\.(?: The underlying[^.]*\.)?/g,
    ),
  ].map(([fragment]) => fragment);
  for (const table of openAiPricingTables(input.body, record)) {
    if (table.section === "Tools") {
      for (const row of table.rows) {
        const facts = openAiToolCommercialFacts(table, row, input.source.id, catalogModels, [
          ...containerBilling,
          ...containerAnnouncements,
        ]).filter(
          ({ price_facts, raw_price_facts }) => price_facts.length + raw_price_facts.length > 0,
        );
        commercialFacts.push(...facts);
        const details = row[table.headers.indexOf("Details")] ?? "";
        const outsideScope =
          (row[0] === "File search" && details === "Storage") ||
          (row[0] === "Agent Kit" && details === "ChatKit file and image upload storage");
        const quotes = facts.flatMap(({ price_facts }) => price_facts);
        const rawQuotes = facts
          .flatMap(({ raw_price_facts }) => raw_price_facts)
          .filter(({ term_key }) => term_key !== "billing-minimum");
        if (quotes.length > 0 || rawQuotes.length > 0)
          items.push(
            ...quotes.map((quote): PricingReconciliationItem => ({
              disposition: quote.raw_price === "Free" ? "explicit_non_numeric" : "normalized",
              reason_code: "provider_service_pricing_bound",
              sample: (row[0] ?? "Tool").slice(0, 256),
            })),
            ...rawQuotes.map((): PricingReconciliationItem => ({
              disposition: "raw",
              reason_code: "unsupported_pricing_cell_preserved",
              sample: (row[0] ?? "Tool").slice(0, 256),
            })),
          );
        else
          items.push({
            disposition: outsideScope ? "excluded" : "unsupported",
            reason_code: outsideScope
              ? "commercial_fact_outside_invocation_scope"
              : "provider_service_pricing_unmodeled",
            sample: (row[0] ?? "Tool").slice(0, 256),
          });
      }
      continue;
    }
    const modelIndex = table.headers.indexOf("Model");
    if (modelIndex < 0) {
      for (const row of table.rows)
        items.push({
          disposition: "unsupported",
          reason_code: "unreviewed_pricing_table",
          sample: row.join(" | ").slice(0, 256) || table.section,
        });
      continue;
    }
    for (const row of table.rows) {
      const rawId = (row[modelIndex] ?? "").replace(
        / \((?:<272K context length|legacy|data sharing)\)$/,
        "",
      );
      let target = findTarget(rawId);
      const tasks =
        target?.tasks ??
        classifyModelTasks({
          modelId: rawId,
          name: rawId,
          rawType: undefined,
          modalities: { input: [], output: [] },
          fallback: "text_generation",
        });
      const cells = openAiModelPriceCells(table, row, tasks);
      if (cells === undefined) {
        items.push({
          disposition: "unsupported",
          reason_code: "unreviewed_pricing_table",
          sample: table.headers.join(" | ").slice(0, 256),
        });
        continue;
      }
      const claims = cells.map((cell) => parseOpenAiPricingCell(cell, input.source.id));
      if (target === null || (target === undefined && !modelIdSchema.safeParse(rawId).success)) {
        for (const claim of claims) {
          claim.item.disposition = target === null ? "ambiguous" : "excluded";
          claim.item.reason_code =
            target === null ? "documented_alias_ambiguous" : "non_model_pricing_row";
          items.push(claim.item);
        }
        continue;
      }
      if (!claims.some(({ rate, raw }) => rate !== undefined || raw !== undefined)) {
        items.push(...claims.map(({ item }) => item));
        continue;
      }
      if (table.section === "Finetuning") {
        items.push(
          ...claims.map(({ item }) => {
            if (item.disposition === "normalized") {
              item.reason_code = "fine_tuned_inference_pricing_bound";
              item.sample = rawId;
            }
            return item;
          }),
        );
        commercialFacts.push({
          source_ref: input.source.id,
          book_key: "service:fine-tuned-inference:" + rawId,
          book_name: "Fine-tuned " + rawId + " inference",
          resource_kind: "service",
          resource_key: "fine-tuned-inference:" + rawId,
          model_refs: target === undefined ? [] : [target.uid],
          offer_key: "inference",
          offer_name: "Fine-tuned model inference",
          billing_mode: "usage",
          pricing_state: "numeric",
          price_facts: claims.flatMap(({ rate }) => (rate === undefined ? [] : [rate])),
          raw_price_facts: claims.flatMap(({ raw }) => (raw === undefined ? [] : [raw])),
        });
        continue;
      }
      target ??= createTarget(rawId);
      for (const claim of claims) {
        const fact = claim.rate;
        if (fact !== undefined) {
          const previous = target.price_facts.find(
            (current) => sourcePriceFactKey(current) === sourcePriceFactKey(fact),
          );
          if (previous !== undefined && !decimalsEqual(previous.price, fact.price)) {
            fact.resolution_policy = "openai_pricing_page_over_model_card";
            claim.item.reason_code = "first_party_price_conflict_resolved";
          }
        }
        track(target.model_id, claim);
      }
    }
  }
  if (input.source.extractor.kind !== "openai-pricing")
    throw new Error("Invalid OpenAI pricing extractor");
  for (const [aliasId, targetId] of pricingAliases) {
    const alias = exact.get(aliasId);
    const target = exact.get(targetId);
    const targetRates = rates.get(targetId);
    if (alias === undefined || target === undefined || targetRates === undefined) {
      record({
        disposition: "unbound",
        reason_code: "documented_alias_price_unbound",
        sample: `${aliasId} -> ${targetId}`,
      });
      continue;
    }
    rates.set(
      aliasId,
      new Map(
        [...targetRates].map(([key, fact]) => [
          key,
          {
            ...fact,
            derived: true,
            derivation: `OpenAI pricing documents ${aliasId} as routing to ${targetId} with matching pricing`,
            raw_price: undefined,
            raw_unit: undefined,
          },
        ]),
      ),
    );
    record({
      disposition: "normalized",
      reason_code: "documented_alias_price_bound",
      sample: `${aliasId} -> ${targetId}`,
    });
  }
  const fastEuRestriction = input.body
    .replace(/\s+/g, " ")
    .match(/Fast mode is unavailable for GPT-6 Astra with EU data residency\./)?.[0];
  const fastEuGuideRestriction = normalizedText(fastGuide).match(
    /Fast mode is not available with EU data residency for (.+?)\.(?:\s|$)/,
  );
  const fastEuModels = new Set(
    (fastEuGuideRestriction?.[1] ?? "")
      .split(/,\s*(?:or\s+)?|\s+or\s+/)
      .map((name) => name.trim().toLowerCase().replaceAll(" ", "-")),
  );
  const ultrafastRegionsKnown = normalizedText(ultrafastGuide).includes(
    "Ultrafast supports US data residency and global processing only.",
  );
  const fastRegionsKnown =
    fastEuGuideRestriction !== null ||
    fastEuRestriction !== undefined ||
    !/^\s*Fast\s*$/m.test(input.body);
  const hasRegionalUplift = /Regional processing .*10% uplift/i.test(input.body);
  const billingStarts = new Map(
    [...input.body.matchAll(/Billing for `([^`]+)` begins on ([^.\n]+)\.([^\n]*)/g)].flatMap(
      (match) =>
        match[1] === undefined || match[2] === undefined
          ? []
          : [
              [
                match[1],
                {
                  effectiveFrom: openAiShutdownDate(match[2]),
                  restrictedResearch:
                    match[3]?.includes("Access is limited to approved internal research") === true,
                },
              ] as const,
            ],
    ),
  );
  const modelIds = new Set([...rates.keys(), ...rawByModel.keys(), ...created.keys()]);
  const output = [...modelIds]
    .map((modelId): ProviderModel => {
      const target = exact.get(modelId);
      if (target === undefined) throw new Error("OpenAI pricing lost its catalog binding");
      const modelRates = rates.get(modelId);
      const billing = billingStarts.get(target.model_id);
      const rawPriceFacts = [...(rawByModel.get(modelId) ?? [])];
      const restriction = fastEuModels.has(target.model_id)
        ? fastEuGuideRestriction?.[0]
        : target.model_id === "gpt-6-astra"
          ? fastEuRestriction
          : undefined;
      const stateFacts: SourcePriceStateFact[] =
        restriction === undefined
          ? []
          : [
              {
                state: "not_supported",
                conditions: { service_tier: "fast", eu_data_residency: true },
                source_ref: input.source.id,
                source_locator: {
                  kind: "fragment",
                  value: fastEuModels.has(target.model_id)
                    ? "/api/docs/guides/fast-mode.md"
                    : "/api/docs/pricing.md",
                },
                raw: { fragment: restriction },
              },
            ];
      const priceFacts = [...(modelRates?.values() ?? [])].map((rate) =>
        restriction !== undefined && rate.conditions.service_tier === "fast"
          ? { ...rate, conditions: { ...rate.conditions, eu_data_residency: false } }
          : rate,
      );
      const scopedRates = priceFacts.flatMap((rate): SourcePriceFact[] => {
        const tier = rate.conditions.service_tier;
        if (
          (tier !== "ultrafast" || ultrafastRegionsKnown) &&
          (tier !== "fast" || fastRegionsKnown) &&
          (billing === undefined || billing.effectiveFrom !== undefined)
        )
          return [
            {
              ...rate,
              conditions: {
                ...rate.conditions,
                ...(billing?.effectiveFrom === undefined
                  ? {}
                  : { effective_from: billing.effectiveFrom }),
                ...(billing?.restrictedResearch === true
                  ? { account_eligibility: "approved_internal_research" }
                  : {}),
              },
            },
          ];
        const unresolved =
          billing !== undefined && billing.effectiveFrom === undefined
            ? "billing_start_unresolved"
            : `${tier}_region_scope_unresolved`;
        rawPriceFacts.push({
          term_key: "unparsed:" + rate.meter,
          impact: "base_price",
          reason: "unsupported_structure",
          conditions: rate.conditions,
          source_ref: input.source.id,
          raw: {
            label: rate.meter,
            meter: rate.meter,
            amount: rate.raw_price ?? rate.price,
            denomination: rate.currency,
            unit: rate.raw_unit ?? rate.unit,
          },
        });
        markScope(modelId, tier, unresolved);
        return [];
      });
      const publishedRates = (
        hasRegionalUplift && openAiRegionalUpliftEligible(target)
          ? openAiRegionalProcessingRates(scopedRates)
          : scopedRates
      ).map((rate) =>
        rate.conditions.service_tier === "ultrafast"
          ? {
              ...rate,
              conditions: {
                ...rate.conditions,
                deployment_scope: rate.conditions.deployment_scope ?? "global_processing",
                ...(rate.conditions.deployment_scope === "regional_processing"
                  ? { region: "United States" }
                  : {}),
              },
            }
          : rate,
      );
      const fullyFree =
        target.tasks.includes("moderation") &&
        rawPriceFacts.length === 0 &&
        publishedRates.length > 0 &&
        publishedRates.every(
          (rate) =>
            rate.raw_price === "Free" &&
            Object.keys(rate.conditions).every((key) => key === "service_tier") &&
            (rate.conditions.service_tier === undefined ||
              rate.conditions.service_tier === "standard"),
        );
      return {
        ...baseModel({
          providerId: input.provider.id,
          id: modelId,
          ...(target.version === undefined ? {} : { version: target.version }),
          name: target.name,
          sourceId: input.source.id,
          observedAt: input.observedAt,
        }),
        tasks: target.tasks,
        pricing_state: publishedRates.length === 0 ? "unknown" : fullyFree ? "free" : "numeric",
        price_facts: fullyFree ? [] : publishedRates,
        raw_price_facts: rawPriceFacts,
        ...(stateFacts.length === 0 ? {} : { state_facts: stateFacts }),
      };
    })
    .sort((left, right) => left.uid.localeCompare(right.uid));
  const fixedSearchContent = [
    ...toolsText.matchAll(
      /For gpt-4o-mini and gpt-4\.1-mini with the non-preview web search tool, search content tokens[^.]*\./g,
    ),
  ].map(([fragment]) => fragment);
  if (fixedSearchContent.length > 0) {
    const modelIds = (["gpt-4o-mini", "gpt-4.1-mini"] as const).filter((modelId) =>
      exact.has(modelId),
    );
    const content = openAiSearchContent(modelIds, input.source.id, fixedSearchContent);
    commercialFacts.push(...content.facts);
    vocabulary.push(...content.vocabulary);
    items.push(...content.items);
  }
  const minuteDeclarations = containerAnnouncements.map((fragment) => {
    const match = fragment.match(
      /^Starting ([A-Z][a-z]+ \d{1,2}, \d{4}), eligible container sessions will be billed per minute with a ([1-9]\d*)-minute minimum, instead of being billed at the full 20-minute session rate\. The underlying per-minute rate will remain the same\.$/,
    );
    const effectiveFrom = match?.[1] === undefined ? undefined : openAiShutdownDate(match[1]);
    return effectiveFrom === undefined || match?.[2] === undefined
      ? undefined
      : { effectiveFrom, minimum: match[2] };
  });
  const minutePolicy = minuteDeclarations[0];
  const pageMinimums = containerBilling.map(
    (fragment) =>
      fragment.match(
        /^Eligible container sessions will be billed by the minute, with a ([1-9]\d*)-minute minimum per session\.$/,
      )?.[1],
  );
  const minuteBillingKnown =
    minutePolicy !== undefined &&
    pageMinimums.length > 0 &&
    pageMinimums.every((minimum) => minimum === minutePolicy.minimum) &&
    minuteDeclarations.every(
      (declaration) =>
        declaration?.minimum === minutePolicy.minimum &&
        declaration.effectiveFrom === minutePolicy.effectiveFrom,
    );
  if (minuteBillingKnown) {
    const { effectiveFrom, minimum } = minutePolicy;
    const observations: RawPriceObservation[] = [
      ...containerBilling.map((fragment) => ({
        source_ref: input.source.id,
        locator: { kind: "fragment" as const, value: "/api/docs/pricing.md#tools" },
        raw: { fragment },
      })),
      ...containerAnnouncements.map((fragment) => ({
        source_ref: input.source.id,
        locator: { kind: "fragment" as const, value: "/api/docs/changelog.md" },
        raw: { fragment },
      })),
    ];
    const minute = openAiContainerMinimum(minimum, observations);
    vocabulary.push(...minute.vocabulary);
    for (const fact of commercialFacts) {
      if (fact.resource_key !== "containers") continue;
      fact.price_facts = fact.price_facts.flatMap((rate): SourcePriceFact[] => {
        if (rate.unit !== "container_session") return [rate];
        return [
          {
            ...rate,
            conditions: { ...rate.conditions, account_eligibility: "session_block_billing" },
          },
          {
            ...rate,
            price: multiplyDecimal(rate.price, "0.05"),
            unit: "minute",
            conditions: {
              ...rate.conditions,
              account_eligibility: "minute_billing",
              effective_from: effectiveFrom,
            },
            derived: true,
            derivation: "Unchanged per-minute rate = published 20-minute session price / 20",
            raw_unit: `per minute; minimum ${minimum} minutes per session`,
            charge_binding: minute.charge_binding,
          },
        ];
      });
      fact.raw_price_facts = fact.raw_price_facts.filter(
        ({ term_key }) => term_key !== "billing-minimum",
      );
    }
  }
  for (const fragment of [...containerBilling, ...containerAnnouncements])
    items.push({
      disposition: commercialFacts.some(
        (fact) =>
          fact.resource_key === "containers" &&
          fact.price_facts.some((rate) => rate.unit === "minute"),
      )
        ? "normalized"
        : "raw",
      reason_code: "container_billing_minimum",
      sample: fragment.slice(0, 256),
    });
  for (const item of items) input.onPricingReconciliation?.(item);
  if (output.length === 0 && commercialFacts.length === 0)
    throw new Error("OpenAI pricing contained no admitted facts");
  return { models: output, commercial_facts: commercialFacts, vocabulary };
}

function openAiModalitiesFromDetails(
  details: string,
  label: "Input" | "Output",
  onFinding: ParseInput["onContractFinding"],
): Modality[] {
  const match = details.match(new RegExp(`^- ${label} modalities: (.+)$`, "m"));
  if (match?.[1] === undefined) {
    onFinding?.(contractExtensionEvidence([`/models/modalities/${label.toLowerCase()}`]));
    return [];
  }
  const values = match[1].split(",").map((value) => value.trim());
  const modalities = values.flatMap((value): Modality[] => {
    const parsed = modalitySchema.safeParse(value);
    if (parsed.success) return [parsed.data];
    onFinding?.(
      contractExtensionEvidence([`/models/modalities/${label.toLowerCase()}/${value || "empty"}`]),
    );
    return [];
  });
  return unique(modalities);
}

function openAiLimit(
  details: string,
  label: "context window" | "max output tokens",
): number | undefined {
  const match = details.match(new RegExp(`^- ([\\d,]+) ${label}$`, "m"));
  return match?.[1] === undefined ? undefined : Number(match[1].replaceAll(",", ""));
}

function openAiListSection(body: string, heading: string): Set<string> | undefined {
  const section = markdownSection(body, heading);
  if (section === undefined) return undefined;
  return new Set(
    [...section.matchAll(/^- ([a-z][a-z0-9_]*)$/gm)].flatMap((match) =>
      match[1] === undefined ? [] : [match[1]],
    ),
  );
}

function openAiAliasesFromMarkdown(
  body: string,
  id: string,
  onFinding: ParseInput["onContractFinding"],
): string[] {
  const snapshots = markdownSection(body, "Snapshots");
  if (snapshots === undefined) onFinding?.(contractExtensionEvidence([`/models/${id}/snapshots`]));
  const aliases = markdownCodeValues(snapshots ?? "").filter(
    (value) => value !== id && modelIdSchema.safeParse(value).success,
  );
  for (const match of body.matchAll(/The `([^`]+)` alias routes requests to\b/g)) {
    const alias = match[1];
    if (alias !== undefined && alias !== id && modelIdSchema.safeParse(alias).success)
      aliases.push(alias);
  }
  return unique(aliases).sort();
}

function openAiIndexStatuses(
  body: string,
): Map<string, Pick<ProviderModel, "status" | "release_stage">> {
  const statuses = new Map<string, Pick<ProviderModel, "status" | "release_stage">>();
  for (const match of body.matchAll(
    /^- \[[^\]]+\]\(\/api\/docs\/models\/([a-z0-9._-]+)\.md\)(?::\s*(.*))?$/gm,
  )) {
    const id = match[1];
    if (id === undefined) continue;
    const deprecated = /\bDeprecated\b/i.test(match[2] ?? "");
    const current = statuses.get(id);
    statuses.set(id, {
      status: deprecated || current?.status === "deprecated" ? "deprecated" : "active",
      release_stage: id.includes("preview") ? "preview" : "unknown",
    });
  }
  if (statuses.size === 0) throw new Error("OpenAI catalog index contained no model links");
  return statuses;
}

function openAiMarkdownModel(
  input: ParseInput,
  body: string,
  expectedId: string,
  lifecycle: Pick<ProviderModel, "status" | "release_stage">,
): ProviderModel {
  const idMatches = [...body.matchAll(/^Model ID: `([^`]+)`$/gm)];
  const id = idMatches.length === 1 ? idMatches[0]?.[1] : undefined;
  if (id !== expectedId) throw new Error(`OpenAI model page identity disagreed for ${expectedId}`);
  let name = body.match(/^# (.+)$/m)?.[1]?.trim();
  if (name === undefined || name === "") {
    name = id;
    input.onContractFinding?.(contractExtensionEvidence([`/models/${id}/name`]));
  }
  const observedDetails = markdownSection(body, "Model details");
  const details = observedDetails ?? "";
  if (observedDetails === undefined)
    input.onContractFinding?.(contractExtensionEvidence([`/models/${id}/details`]));
  const observedModalities = {
    input: openAiModalitiesFromDetails(details, "Input", input.onContractFinding),
    output: openAiModalitiesFromDetails(details, "Output", input.onContractFinding),
  };
  const classifiedOperations = classifyModelTasks({
    modelId: id,
    name,
    rawType: undefined,
    modalities: observedModalities,
    fallback: "text_generation",
  });
  const endpointEvidence = openAiEndpointEvidence(
    body,
    classifiedOperations,
    input.onContractFinding,
  );
  const tasks = endpointEvidence.tasks;
  const modelModalities: ProviderModel["modalities"] = tasks.includes("embeddings")
    ? { input: observedModalities.input, output: ["embedding"] }
    : observedModalities;
  const features = openAiListSection(body, "Supported features");
  const tools = openAiListSection(body, "Supported tools");
  const feature = (name: string): boolean | "unknown" =>
    features === undefined ? "unknown" : features.has(name);
  const pricedCachedInput = /^\|\s*Cached input\s*\|\s*\$\d+(?:\.\d+)?\s*\|/im.test(body);
  const tool = (names: string[]): boolean | "unknown" =>
    tools === undefined ? "unknown" : names.some((value) => tools.has(value));
  const description = [...body.slice(0, body.indexOf("Model ID:")).matchAll(/^> (.+)$/gm)]
    .flatMap((match) =>
      match[1] === undefined || match[1].startsWith("For the complete documentation index")
        ? []
        : [match[1]],
    )
    .at(-1);
  return {
    ...baseModel({
      providerId: input.provider.id,
      id,
      name,
      sourceId: input.source.id,
      observedAt: input.observedAt,
    }),
    ...(description === undefined ? {} : { description: normalizedText(description) }),
    aliases: openAiAliasesFromMarkdown(body, id, input.onContractFinding),
    tasks,
    api_endpoints: endpointEvidence.endpoints,
    modalities: modelModalities,
    capabilities: {
      ...unknownCapabilities(),
      reasoning:
        observedDetails === undefined ? "unknown" : details.includes("- Reasoning token support"),
      tool_call: feature("function_calling"),
      structured_output: feature("structured_outputs"),
      streaming: feature("streaming"),
      batch: endpointEvidence.support.get("v1/batch") ?? "unknown",
      prompt_cache: pricedCachedInput || feature("prompt_caching"),
      fine_tuning: endpointEvidence.support.get("v1/fine-tuning") ?? "unknown",
      code_execution: tool(["code_interpreter", "hosted_shell"]),
      effort_control:
        /reasoning[._ ]effort supports:|configurable reasoning effort/i.test(body) || "unknown",
      computer_use:
        tool(["computer_use"]) === true ||
        /specialized model for the computer use tool|trained to understand and execute computer tasks/i.test(
          body,
        ) ||
        (tools === undefined ? "unknown" : false),
    },
    limits: {
      context_tokens: openAiLimit(details, "context window"),
      max_output_tokens: openAiLimit(details, "max output tokens"),
    },
    ...lifecycle,
    pricing_state: body.includes("free models designed to detect harmful content")
      ? "free"
      : body.includes("open-weight model")
        ? "not_applicable"
        : "unknown",
  };
}

export function parseOpenAiCatalog(input: ParseInput): ProviderModel[] {
  const bundle = linkedBundleSchema.parse(parseJson(input.body));
  const statuses = openAiIndexStatuses(bundle.index.body);
  const documents = new Map<string, typeof bundle.documents>();
  for (const document of bundle.documents) {
    const match = new URL(document.url).pathname.match(/^\/api\/docs\/models\/([a-z0-9._-]+)\.md$/);
    const id = match?.[1];
    if (id === undefined || id === "compare") continue;
    const current = documents.get(id) ?? [];
    current.push(document);
    documents.set(id, current);
  }
  const extra = [...documents.keys()].filter((id) => !statuses.has(id));
  if (extra.length > 0)
    input.onContractFinding?.(
      contractExtensionEvidence(extra.map((id) => `/models/${id}/unindexed`)),
    );
  return [...statuses.entries()]
    .map(([id, lifecycle]) => {
      const matches = documents.get(id) ?? [];
      const [document] = matches;
      if (matches.length === 1 && document !== undefined)
        try {
          return openAiMarkdownModel(input, document.body, id, lifecycle);
        } catch {
          input.onContractFinding?.(contractExtensionEvidence([`/models/${id}/card`]));
        }
      else input.onContractFinding?.(contractExtensionEvidence([`/models/${id}/document`]));
      return {
        ...baseModel({
          providerId: input.provider.id,
          id,
          name: id,
          sourceId: input.source.id,
          observedAt: input.observedAt,
        }),
        ...lifecycle,
      };
    })
    .sort((left, right) => left.uid.localeCompare(right.uid));
}

export function parseOpenAiModelPricing(input: ParseInput): ProviderModel[] {
  if (input.catalogModels === undefined)
    throw new Error("OpenAI model-card pricing requires the collected catalog");
  const bundle = linkedBundleSchema.parse(parseJson(input.body));
  const targets = new Map(input.catalogModels.map((model) => [model.model_id, model]));
  const index = load(bundle.index.body);
  const indexed = new Set<string>();
  index("a[href]").each((_index, element) => {
    const match = index(element)
      .attr("href")
      ?.match(/^\/api\/docs\/models\/([a-z0-9._-]+)$/);
    if (match?.[1] !== undefined) indexed.add(match[1]);
  });
  const documents = new Map<string, typeof bundle.documents>();
  for (const document of bundle.documents) {
    const id = new URL(document.url).pathname.split("/").at(-1);
    if (id === undefined || !modelIdSchema.safeParse(id).success || !indexed.has(id)) {
      input.onContractFinding?.(
        contractExtensionEvidence([`/models/${id ?? "unknown"}/pricing-document`]),
      );
      continue;
    }
    const current = documents.get(id) ?? [];
    current.push(document);
    documents.set(id, current);
  }
  return [...indexed]
    .flatMap((id): ProviderModel[] => {
      const matches = documents.get(id) ?? [];
      const [document] = matches;
      if (matches.length !== 1 || document === undefined) {
        input.onContractFinding?.(contractExtensionEvidence([`/models/${id}/pricing-document`]));
        input.onPricingReconciliation?.({
          disposition: "unbound",
          reason_code: "model_card_pricing_document_unbound",
          sample: id,
        });
        return [];
      }
      const target = targets.get(id);
      if (target === undefined) {
        input.onPricingReconciliation?.({
          disposition: "excluded",
          reason_code: "model_card_price_without_catalog_identity",
          sample: id,
        });
        return [];
      }
      const $ = load(document.body);
      let pricing: ReturnType<typeof openAiPricing>;
      try {
        pricing = openAiPricing($, input.source.id, target.tasks);
      } catch {
        input.onContractFinding?.(contractExtensionEvidence([`/models/${id}/pricing`]));
        return [];
      }
      const pageText = normalizedText($("main").text());
      const state =
        pricing.rates.length > 0
          ? "numeric"
          : pageText.includes("free models designed to detect harmful content")
            ? "free"
            : pageText.includes("open-weight model")
              ? "not_applicable"
              : "unknown";
      for (const item of pricing.items) input.onPricingReconciliation?.(item);
      if (pricing.items.length === 0)
        input.onPricingReconciliation?.({
          disposition: state === "unknown" ? "excluded" : "explicit_non_numeric",
          reason_code: state === "unknown" ? "model_card_without_pricing_claim" : state,
          sample: id,
        });
      return [
        {
          ...baseModel({
            providerId: input.provider.id,
            id,
            ...(target.version === undefined ? {} : { version: target.version }),
            name: target.name,
            sourceId: input.source.id,
            observedAt: input.observedAt,
          }),
          tasks: target.tasks,
          pricing_state: state,
          price_facts: openAiGlobalProcessingRates(pricing.rates, target),
          raw_price_facts: pricing.raw.map((fact) => ({
            ...fact,
            conditions: {
              ...fact.conditions,
              ...(openAiRegionalUpliftEligible(target)
                ? { deployment_scope: "global_processing" }
                : {}),
            },
          })),
        },
      ];
    })
    .sort((left, right) => left.uid.localeCompare(right.uid));
}

export function parseOpenAiApi(input: ParseInput): ProviderModel[] {
  const list = listSchema.parse(parseJson(input.body));
  assertItemCount("OpenAI model API", list.data.length, 1, undefined, ["data"]);
  return recognizeItems({
    label: "OpenAI model",
    items: list.data,
    schema: openAiItemSchema,
    modelId: "id",
  }).map((item) =>
    baseModel({
      providerId: input.provider.id,
      id: item.id,
      name: item.id,
      sourceId: input.source.id,
      observedAt: input.observedAt,
    }),
  );
}

const openAiMonths = new Map(
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
  ].map((month, index) => [month, index + 1]),
);

export function parseOpenAiChangelog(input: ParseInput): ProviderModel[] {
  if (input.catalogModels === undefined)
    throw new Error("OpenAI changelog requires the collected catalog");
  const known = new Map(input.catalogModels.map((model) => [model.model_id, model]));
  const releases = new Map<string, string>();
  const abbreviatedMonths = new Map(
    [...openAiMonths].map(([month, number]) => [month.slice(0, 3), number]),
  );
  let year: string | undefined;
  let month: number | undefined;
  let date: string | undefined;
  for (const rawLine of input.body.split(/\r?\n/)) {
    const line = normalizedText(rawLine);
    const monthHeading = line.match(/^## ([A-Z][a-z]+), (\d{4})$/);
    if (line.startsWith("## ")) {
      month = monthHeading?.[1] === undefined ? undefined : openAiMonths.get(monthHeading[1]);
      year = monthHeading?.[2];
      date = undefined;
      if (month === undefined || year === undefined)
        input.onContractFinding?.(contractExtensionEvidence(["/changelog/month"]));
      continue;
    }
    const dayHeading = line.match(/^### ([A-Z][a-z]{2}) ([1-9]|[12]\d|3[01])$/);
    if (line.startsWith("### ")) {
      const headingMonth =
        dayHeading?.[1] === undefined ? undefined : abbreviatedMonths.get(dayHeading[1]);
      const candidate =
        headingMonth === undefined ||
        headingMonth !== month ||
        dayHeading?.[2] === undefined ||
        year === undefined
          ? undefined
          : `${year}-${String(headingMonth).padStart(2, "0")}-${dayHeading[2].padStart(2, "0")}`;
      date =
        candidate !== undefined && z.iso.date().safeParse(candidate).success
          ? candidate
          : undefined;
      if (date === undefined)
        input.onContractFinding?.(contractExtensionEvidence(["/changelog/day"]));
      continue;
    }
    if (date === undefined || !line.startsWith("Feature ·")) continue;
    for (const match of line.matchAll(/(?:^| · )Model: ([a-z0-9._-]+)/g)) {
      const modelId = match[1];
      if (modelId === undefined || !known.has(modelId)) continue;
      const current = releases.get(modelId);
      if (current === undefined || date < current) releases.set(modelId, date);
    }
  }
  if (releases.size === 0) throw new Error("OpenAI changelog contained no known model releases");
  if (input.source.extractor.kind !== "openai-changelog")
    throw new Error("Invalid OpenAI changelog extractor");
  return [...releases]
    .map(([modelId, releaseDate]) => {
      const target = known.get(modelId);
      if (target === undefined) throw new Error("OpenAI changelog lost its catalog binding");
      return {
        ...baseModel({
          providerId: input.provider.id,
          id: modelId,
          ...(target.version === undefined ? {} : { version: target.version }),
          name: target.name,
          sourceId: input.source.id,
          observedAt: input.observedAt,
        }),
        tasks: target.tasks,
        release_date: releaseDate,
      };
    })
    .sort((left, right) => left.uid.localeCompare(right.uid));
}

function openAiShutdownDate(value: string): string | undefined {
  const normalized = normalizedText(value).replace(/[‐‑‒–—−]/g, "-");
  if (z.iso.date().safeParse(normalized).success) return normalized;
  const match = normalized.match(/^([A-Z][a-z]+) ([1-9]|[12]\d|3[01]), (\d{4})$/);
  if (match?.[1] === undefined || match[2] === undefined || match[3] === undefined)
    return undefined;
  const month = openAiMonths.get(match[1]);
  if (month === undefined) return undefined;
  const date = `${match[3]}-${String(month).padStart(2, "0")}-${match[2].padStart(2, "0")}`;
  return z.iso.date().safeParse(date).success ? date : undefined;
}

export function parseOpenAiDeprecations(input: ParseInput): ProviderModel[] {
  const models = new Map<string, ProviderModel>();
  const knownModelIds = new Set(input.catalogModels?.map(({ model_id }) => model_id) ?? []);
  const lines = input.body.split(/\r?\n/);
  for (let index = 0; index < lines.length - 1; index += 1) {
    if (!normalizedText(lines[index] ?? "").startsWith("|")) continue;
    const headers = markdownCells(lines[index] ?? "").map((header) => header.toLowerCase());
    const separators = markdownCells(lines[index + 1] ?? "");
    if (
      separators.length !== headers.length ||
      !separators.every((cell) => /^:?-{3,}:?$/.test(cell))
    )
      continue;
    const dateIndex = headers.findIndex((header) => header === "shutdown date");
    const modelIndex = headers.findIndex(
      (header) =>
        header === "model / system" ||
        header === "deprecated model" ||
        header === "legacy model" ||
        header === "model snapshot" ||
        header === "model",
    );
    const replacementIndex = headers.findIndex(
      (header) =>
        header === "recommended replacement" ||
        header === "recommended replacement base model" ||
        header === "substitute model",
    );
    if (dateIndex < 0 || modelIndex < 0) continue;
    index += 2;
    while (index < lines.length && normalizedText(lines[index] ?? "").startsWith("|")) {
      const cells = markdownCells(lines[index] ?? "");
      if (cells.length !== headers.length) {
        input.onContractFinding?.(contractExtensionEvidence(["/deprecations/irregular-row"]));
        index += 1;
        continue;
      }
      const retiredAt = openAiShutdownDate(cells[dateIndex] ?? "");
      if (retiredAt === undefined)
        input.onContractFinding?.(contractExtensionEvidence(["/deprecations/shutdown-date"]));
      if (retiredAt !== undefined) {
        const replacements =
          replacementIndex < 0
            ? []
            : unique(
                markdownCodeValues(cells[replacementIndex] ?? "").filter(
                  (id) => modelIdSchema.safeParse(id).success,
                ),
              );
        const modelCell = cells[modelIndex] ?? "";
        const ids = unique(
          markdownCodeValues(modelCell).filter((id) => modelIdSchema.safeParse(id).success),
        );
        const entries = normalizedText(modelCell).includes("|")
          ? ids[0] === undefined
            ? []
            : [{ id: ids[0], aliases: ids.slice(1) }]
          : ids.map((id) => ({ id, aliases: [] }));
        for (const { id, aliases } of entries) {
          const status = retiredAt <= input.observedAt.slice(0, 10) ? "retired" : "deprecated";
          if (
            input.catalogModels !== undefined &&
            !knownModelIds.has(id) &&
            (status === "retired" || /^ft(?::|-)/.test(id))
          )
            continue;
          const model: ProviderModel = {
            ...baseModel({
              providerId: input.provider.id,
              id,
              name: id,
              sourceId: input.source.id,
              observedAt: input.observedAt,
            }),
            aliases,
            tasks: classifyModelTasks({
              modelId: id,
              name: id,
              rawType: undefined,
              modalities: { input: [], output: [] },
              fallback: "text_generation",
            }),
            status,
            retired_at: retiredAt,
            replacement_model_ids: replacements,
          };
          const previous = models.get(id);
          models.set(id, {
            ...(previous === undefined || (previous.retired_at ?? "") <= retiredAt
              ? model
              : previous),
            aliases: unique([...(previous?.aliases ?? []), ...model.aliases]),
          });
        }
      }
      index += 1;
    }
    index -= 1;
  }
  if (models.size === 0) throw new Error("OpenAI deprecations page contained no model rows");
  return [...models.values()].sort((left, right) => left.uid.localeCompare(right.uid));
}
