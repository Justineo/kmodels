import { load } from "cheerio";
import { z } from "zod";
import { linkedBundleSchema, type LinkedBundle } from "./bundle.ts";
import { extractDashscopePricingInputs } from "./dashscope-accounting.ts";
import {
  extractDashscopeImageSearchFacts,
  extractDashscopeTextToImageSearchFacts,
  extractDashscopeWebSearchFacts,
  type DashscopeToolRate,
} from "./dashscope-commercial-source.ts";
import {
  htmlColumn as column,
  type HtmlCell as Cell,
  type HtmlTable as Table,
  htmlTables,
  htmlText as text,
  htmlValue as value,
} from "./html.ts";
import { modelIdSchema } from "./identity.ts";
import { uniqueCanonicalValues } from "./canonical-value.ts";
import { apiEndpointKey, baseModel } from "./model.ts";
import { orderedTasks } from "./task.ts";
import { markdownProse } from "./markdown.ts";
import type { SourceManifest } from "./manifests.ts";
import { decimalsEqual, multiplyDecimal, publishedRate, scaleDecimal } from "./pricing.ts";
import type { SourceParseInput as ParseInput, SourceParseResult } from "./source-parse.ts";
import type {
  ParsedProviderModel as ProviderModel,
  SourcePriceFact,
  SourceRawPricingFact,
} from "./pricing-source.ts";
import { parsedPriceFact, sourcePriceFactKey } from "./pricing-source.ts";
import {
  assertCoverage,
  assertItemCount,
  contractExtensionEvidence,
  recognizeItems,
} from "./source-contract.ts";
import { type Modality, type ModelTask } from "./schema.ts";

type TriState = ProviderModel["capabilities"]["reasoning"];
type ApiEndpoint = NonNullable<ProviderModel["api_endpoints"]>[number];

interface CommercialEvidence {
  cacheBody?: string;
  cacheRates: boolean;
  imageSearchBody?: string;
  textToImageSearchBody?: string;
  webSearchBody?: string;
}

const deploymentPlanSchema = z.object({
  plan: z.enum(["mu", "cu", "ptu", "ptu_v2", "lora"]),
});

const deploymentModelSchema = z.object({
  model_name: modelIdSchema,
  plans: z.array(z.unknown()),
});

const deploymentPageSchema = z.object({
  request_id: z.string().min(1).optional(),
  output: z.object({
    page_no: z.literal(1),
    page_size: z.number().int().min(1),
    total: z.number().int().nonnegative(),
    models: z.array(z.unknown()),
  }),
});

function markdownSections(body: string): string {
  const open: number[] = [];
  const result: string[] = [];
  for (const line of body.split(/\r?\n/)) {
    const heading = line.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (heading?.[1] === undefined || heading[2] === undefined) {
      result.push(line);
      continue;
    }
    const level = heading[1].length;
    while ((open.at(-1) ?? 0) >= level) {
      result.push("</section>");
      open.pop();
    }
    result.push(`<section><h${level}>${heading[2]}</h${level}>`);
    open.push(level);
  }
  while (open.length > 0) {
    result.push("</section>");
    open.pop();
  }
  return result.join("\n");
}

function tables(body: string, options: { precedingHeadings?: boolean } = {}): Table[] {
  return htmlTables(/^#{1,6}\s+/m.test(body) ? markdownSections(body) : body, options);
}

function markdownCell(cell: Cell): Cell {
  const clean = (value: string): string => value.replace(/\\([<>&])/g, "$1");
  return {
    text: clean(cell.text),
    parts: cell.parts.map(clean),
    quotes: cell.quotes.map(clean),
  };
}

function pricingSubheaders(row: Cell[]): string[] | undefined {
  const values = row.map(({ text: raw }) => text(raw));
  return values.length >= 2 &&
    values.every((item) =>
      /^(?:(?:Input|Output):\s*)?(?:Text(?:\s+Text-only input|\s+Multimodal input|\s*\/\s*(?:image|Image\/video))?|Text \+ audio\s+Audio only billed|Audio|Image|Image\/video|Video|Non-Thinking mode|Thinking mode(?:\s*\([^)]*\))?)$/i.test(
        item,
      ),
    )
    ? values
    : undefined;
}

function expandedPricingHeaders(headers: string[], subheaders: string[]): string[] {
  const prices = headers.flatMap((header, index) => (/price/i.test(header) ? [index] : []));
  if (prices.length !== 2)
    throw new Error("DashScope pricing subheader changed its price-column shape");
  let split: number;
  const explicitOutput = subheaders.findIndex((header) => /^Output:/i.test(header));
  if (explicitOutput >= 0) split = explicitOutput;
  else if (subheaders.every((header) => /mode/i.test(header))) split = 0;
  else {
    if (subheaders.length % 2 !== 0)
      throw new Error("DashScope pricing subheader changed its modality shape");
    split = subheaders.length / 2;
  }
  const groups = [subheaders.slice(0, split), subheaders.slice(split)];
  return headers.flatMap((header, index) => {
    const priceIndex = prices.indexOf(index);
    if (priceIndex < 0) return [header];
    const labels = groups[priceIndex] ?? [];
    return labels.length === 0 ? [header] : labels.map((label) => `${header} / ${label}`);
  });
}

function pricingCellKind(
  cell: Cell,
): "model" | "mode" | "price" | "quota" | "resolution" | "scope" | "tokens" | "type" {
  const raw = cell.text;
  if (
    /^(?:No free quota|\d[\d,.]*\s+(?:million tokens|tokens|characters|images|minutes|seconds))$/i.test(
      raw,
    )
  )
    return "quota";
  if (/Token/i.test(raw)) return "tokens";
  if (/^\d+(?:\.\d+)?[KkPp]$/.test(raw)) return "resolution";
  if (/\$[\d,.]+|\bDiscontinued\b|^(?:Free|Free trial|Limited-time free|--|-)$/i.test(raw))
    return "price";
  if (/mode/i.test(raw)) return "mode";
  if (
    dashscopeRegion(raw) !== undefined ||
    /^(?:International|Global|Chinese mainland|China \(mainland\)|EU|Japan|US)$/i.test(raw)
  )
    return "scope";
  if (/audio=|video type|Audio video|Silent video/i.test(raw)) return "type";
  return "model";
}

function pricingHeaderMatches(header: string, kind: ReturnType<typeof pricingCellKind>): boolean {
  if (kind === "model") return /^(?:Model ID|Model name|Model)$/i.test(header);
  if (kind === "tokens") return /Input token(?:s| range)/i.test(header);
  if (kind === "resolution") return /resolution/i.test(header);
  if (kind === "price") return /price/i.test(header);
  if (kind === "quota") return /Free quota/i.test(header);
  if (kind === "mode") return /mode/i.test(header);
  if (kind === "scope") return /Deployment (?:scope|region)|Service deployment scope/i.test(header);
  return /type/i.test(header);
}

function normalizePricingRow(headers: string[], rawRow: Cell[], previous?: Cell[]): Cell[] {
  const row = rawRow.map(markdownCell);
  if (row.length > headers.length)
    throw new Error("DashScope pricing row exceeded its expanded header");
  if (row.length === headers.length) {
    const discontinued = row.find((cell) =>
      /\bDiscontinued\b|^(?:Free|Free trial|Limited-time free)$/i.test(cell.text),
    );
    return discontinued === undefined
      ? row
      : row.map((cell, index) => (/price/i.test(headers[index] ?? "") ? discontinued : cell));
  }
  if (previous === undefined) throw new Error("DashScope pricing sparse row omitted its base row");
  const normalized = [...previous];
  let after = -1;
  for (const [cellIndex, cell] of row.entries()) {
    const kind = pricingCellKind(cell);
    const remainingPrices = row
      .slice(cellIndex)
      .filter((candidate) => pricingCellKind(candidate) === "price").length;
    const candidates = headers.flatMap((header, index) =>
      index > after && pricingHeaderMatches(header, kind) ? [index] : [],
    );
    const target =
      kind === "price" && candidates.length >= remainingPrices
        ? candidates.at(-remainingPrices)
        : candidates[0];
    if (target === undefined)
      throw new Error(`DashScope pricing sparse ${kind} cell changed shape: ${cell.text}`);
    normalized[target] = cell;
    after = target;
  }
  const discontinued = row.find((cell) =>
    /\bDiscontinued\b|^(?:Free|Free trial|Limited-time free)$/i.test(cell.text),
  );
  if (discontinued !== undefined)
    for (const [index, header] of headers.entries())
      if (/price/i.test(header)) normalized[index] = discontinued;
  return normalized;
}

function normalizePricingRows(
  headers: string[],
  rows: Cell[][],
  onFinding: (row: number) => void,
): Cell[][] {
  const result: Cell[][] = [];
  let previous: Cell[] | undefined;
  for (const [index, row] of rows.entries()) {
    try {
      previous = normalizePricingRow(headers, row, previous);
      result.push(previous);
    } catch {
      onFinding(index);
    }
  }
  return result;
}

function pricingTables(body: string, onFinding: (path: string) => void): Table[] {
  if (!markdownDocument(body)) {
    const $ = load(body);
    $("table").each((_index, element) => {
      const table = $(element);
      if (text(table.prev("p").text()) !== "Prices in USD per million tokens.") return;
      table
        .find("tr")
        .first()
        .children("th")
        .each((_column, cell) => {
          const match = text($(cell).text()).match(
            /^(Input|Output):\s*(text\/images\/video|text|audio)$/i,
          );
          if (match?.[1] === undefined || match[2] === undefined) return;
          $(cell).text(
            `${match[1]} price (USD/million tokens) / ${match[2].replace("images", "image")}`,
          );
        });
    });
    return tables($.html());
  }
  const parsed = tables(body);
  return parsed.flatMap((table, tableIndex) => {
    try {
      const first = table.rows[0];
      const subheaders = first === undefined ? undefined : pricingSubheaders(first);
      const headers =
        subheaders === undefined
          ? table.headers
          : expandedPricingHeaders(table.headers, subheaders);
      const rows = subheaders === undefined ? table.rows : table.rows.slice(1);
      return [
        {
          ...table,
          headers,
          rows: normalizePricingRows(headers, rows, (row) =>
            onFinding(`/tables/${tableIndex}/rows/${row}`),
          ),
        },
      ];
    } catch {
      onFinding(`/tables/${tableIndex}`);
      return [];
    }
  });
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function exactId(value: string): string | undefined {
  const parsed = modelIdSchema.safeParse(value.trim());
  return parsed.success ? parsed.data : undefined;
}

function cellIds(cell: Cell | undefined): string[] {
  if (cell === undefined) return [];
  return unique(
    [...cell.parts, cell.text].flatMap((part) =>
      part
        .split(",")
        .map((candidate) =>
          candidate.replace(/\s*\(Snapshot\)\s*$/i, "").replace(/\s+Invitational Preview\s*$/i, ""),
        )
        .flatMap((candidate) => exactId(candidate) ?? []),
    ),
  );
}

/** Task tables mix rendered HTML with literal Markdown code spans in the ID column. */
function catalogCellIds(cell: Cell | undefined): string[] {
  if (cell === undefined) return [];
  const markdownIds = [...cell.text.matchAll(/`([^`]+)`/g)].flatMap(
    (match) => exactId(match[1] ?? "") ?? [],
  );
  const listedIds = cell.text.split(/\s+\/\s+/).flatMap((part) => exactId(part) ?? []);
  return unique([...cellIds(cell), ...markdownIds, ...listedIds]);
}

function equivalentIds(cell: Cell | undefined): string[] {
  return unique(
    (cell?.quotes ?? [])
      .map((quote) => quote.match(/^Currently equivalent to ([a-z0-9][a-z0-9._:/-]*)$/i)?.[1])
      .flatMap((item) => (item === undefined ? [] : (exactId(item) ?? []))),
  );
}

function tokenCount(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const match = raw.replace(/,/g, "").match(/(\d+(?:\.\d+)?)\s*([kKmM])?/);
  if (match?.[1] === undefined) return undefined;
  const scale = match[2]?.toLowerCase() === "m" ? 1_000_000 : match[2] ? 1_000 : 1;
  const result = Number(match[1]) * scale;
  return Number.isSafeInteger(result) ? result : undefined;
}

function modalities(raw: string | undefined): Modality[] {
  if (raw === undefined) return [];
  const lower = raw.toLowerCase();
  return (["text", "image", "audio", "video"] as const).filter((item) => lower.includes(item));
}

function support(raw: string | undefined): TriState {
  if (raw === undefined || raw === "--" || raw === "-") return "unknown";
  if (/^Supported$/i.test(raw)) return true;
  if (/^(?:Unsupported|Not supported)$/i.test(raw)) return false;
  return "unknown";
}

function rowOperations(
  category: Extract<SourceManifest["extractor"], { kind: "dashscope-catalog" }>["category"],
  id: string,
  rawType: string | undefined,
  api: string | undefined,
  headings: string[],
): ModelTask[] {
  const evidence = `${id} ${rawType ?? ""} ${headings.join(" ")}`.toLowerCase();
  const result: ModelTask[] = [];
  if (category === "text" || category === "vision" || category === "omni")
    result.push("text_generation");
  if (category === "image") result.push("image_generation");
  if (category === "video") result.push("video_generation");
  if (category === "asr" || category === "omni") result.push("transcription");
  if (category === "tts") result.push("speech_synthesis");
  if (category === "embedding")
    result.push(/rerank/i.test(rawType ?? id) ? "reranking" : "embeddings");
  if (/ocr/.test(evidence)) result.push("ocr");
  if (/livetranslate|translation/.test(evidence)) result.push("translation");
  if (
    (category === "s2s" || category === "omni") &&
    /WebSocket|realtime/i.test(`${api ?? ""} ${id}`)
  )
    result.push("speech_to_speech");
  if (category === "s2s" && result.length === 0) result.push("speech_to_speech");
  return orderedTasks(result);
}

function rowModalities(
  category: Extract<SourceManifest["extractor"], { kind: "dashscope-catalog" }>["category"],
  table: Table,
  row: Cell[],
  rawType: string | undefined,
): ProviderModel["modalities"] {
  const observedInput = modalities(value(table, row, /^Input(?:$| \/)/i));
  const observedOutput = modalities(value(table, row, /^Output(?:$| \/)/i));
  if (observedInput.length > 0 || observedOutput.length > 0)
    return { input: observedInput, output: observedOutput };
  if (category === "text") return { input: ["text"], output: ["text"] };
  if (category === "vision") return { input: ["text", "image", "video"], output: ["text"] };
  if (category === "image")
    return {
      input:
        support(value(table, row, /^Editing(?:$| \/)/i)) === true ? ["text", "image"] : ["text"],
      output: ["image"],
    };
  if (category === "video")
    return {
      input: /image|reference|video edit/i.test(rawType ?? "") ? ["text", "image"] : ["text"],
      output: ["video"],
    };
  if (category === "asr") return { input: ["audio"], output: ["text"] };
  if (category === "tts") return { input: ["text"], output: ["audio"] };
  if (category === "s2s") return { input: ["text", "audio"], output: ["text", "audio"] };
  if (category === "omni")
    return { input: ["text", "image", "audio", "video"], output: ["text", "audio"] };
  if (/rerank/i.test(rawType ?? "")) return { input: ["text"], output: [] };
  return {
    input: /multimodal/i.test(rawType ?? "") ? ["text", "image", "video"] : ["text"],
    output: ["embedding"],
  };
}

function dimensions(raw: string | undefined): ProviderModel["limits"] {
  if (raw === undefined) return {};
  const numbers = [...raw.replace(/,/g, "").matchAll(/\d+/g)].map((match) => Number(match[0]));
  if (numbers.length === 0) return {};
  const defaultValue = raw.match(/default:\s*(\d+)/i)?.[1];
  const first = numbers[0];
  if (first === undefined) return {};
  const second = numbers[1];
  return {
    ...(second === undefined
      ? { embedding_dimensions: [first] }
      : { embedding_dimension_range: { min: first, max: second } }),
    ...(defaultValue === undefined
      ? {}
      : { recommended_embedding_dimensions: [Number(defaultValue)] }),
  };
}

function mergeState(
  current: TriState,
  incoming: TriState,
  field: string,
  onConflict?: (field: string) => void,
): TriState {
  if (incoming === "unknown") return current;
  if (current !== "unknown" && current !== incoming) {
    onConflict?.(field);
    return "unknown";
  }
  return incoming;
}

const statusRank: Record<ProviderModel["status"], number> = {
  unknown: 0,
  retired: 1,
  deprecated: 2,
  legacy: 3,
  active: 4,
};

function mergedPricingState(
  left: ProviderModel["pricing_state"],
  right: ProviderModel["pricing_state"],
  hasRates: boolean,
  onConflict?: (field: string) => void,
): ProviderModel["pricing_state"] {
  if (hasRates) return "numeric";
  if (left === "unknown") return right;
  if (right === "unknown" || left === right) return left;
  onConflict?.("pricing_state");
  return "unknown";
}

function merge(
  left: ProviderModel,
  right: ProviderModel,
  onConflict?: (field: string) => void,
): ProviderModel {
  const pricing = uniqueCanonicalValues(
    [...left.price_facts, ...right.price_facts].map(parsedPriceFact),
  );
  const amounts = new Map<string, string>();
  for (const rate of pricing) {
    const key = sourcePriceFactKey(rate),
      previous = amounts.get(key);
    if (previous !== undefined && !decimalsEqual(previous, rate.price)) onConflict?.("price_facts");
    else amounts.set(key, rate.price);
  }
  const endpoints = new Map(
    [...(left.api_endpoints ?? []), ...(right.api_endpoints ?? [])].map((item) => [
      apiEndpointKey(item),
      item,
    ]),
  );
  const availability = new Map(
    [...(left.availability ?? []), ...(right.availability ?? [])].map((item) => [
      `${item.region}\0${item.deployment_type}`,
      item,
    ]),
  );
  return {
    ...left,
    description: left.description ?? right.description,
    aliases: unique([...left.aliases, ...right.aliases]),
    tasks: orderedTasks([...left.tasks, ...right.tasks]),
    raw_type: left.raw_type ?? right.raw_type,
    api_endpoints:
      endpoints.size === 0
        ? undefined
        : [...endpoints.values()].sort((left, right) =>
            apiEndpointKey(left).localeCompare(apiEndpointKey(right)),
          ),
    modalities: {
      input: unique([...left.modalities.input, ...right.modalities.input]),
      output: unique([...left.modalities.output, ...right.modalities.output]),
    },
    capabilities: {
      reasoning: mergeState(
        left.capabilities.reasoning,
        right.capabilities.reasoning,
        "capabilities.reasoning",
        onConflict,
      ),
      tool_call: mergeState(
        left.capabilities.tool_call,
        right.capabilities.tool_call,
        "capabilities.tool_call",
        onConflict,
      ),
      structured_output: mergeState(
        left.capabilities.structured_output,
        right.capabilities.structured_output,
        "capabilities.structured_output",
        onConflict,
      ),
      streaming: mergeState(
        left.capabilities.streaming,
        right.capabilities.streaming,
        "capabilities.streaming",
        onConflict,
      ),
      batch: mergeState(
        left.capabilities.batch,
        right.capabilities.batch,
        "capabilities.batch",
        onConflict,
      ),
      prompt_cache: mergeState(
        left.capabilities.prompt_cache,
        right.capabilities.prompt_cache,
        "capabilities.prompt_cache",
        onConflict,
      ),
      fine_tuning: mergeState(
        left.capabilities.fine_tuning,
        right.capabilities.fine_tuning,
        "capabilities.fine_tuning",
        onConflict,
      ),
      citations: mergeState(
        left.capabilities.citations,
        right.capabilities.citations,
        "capabilities.citations",
        onConflict,
      ),
      code_execution: mergeState(
        left.capabilities.code_execution,
        right.capabilities.code_execution,
        "capabilities.code_execution",
        onConflict,
      ),
      context_management: mergeState(
        left.capabilities.context_management,
        right.capabilities.context_management,
        "capabilities.context_management",
        onConflict,
      ),
      effort_control: mergeState(
        left.capabilities.effort_control,
        right.capabilities.effort_control,
        "capabilities.effort_control",
        onConflict,
      ),
      computer_use: mergeState(
        left.capabilities.computer_use,
        right.capabilities.computer_use,
        "capabilities.computer_use",
        onConflict,
      ),
    },
    limits: {
      ...left.limits,
      ...right.limits,
      context_tokens:
        Math.max(left.limits.context_tokens ?? 0, right.limits.context_tokens ?? 0) || undefined,
      max_output_tokens:
        Math.max(left.limits.max_output_tokens ?? 0, right.limits.max_output_tokens ?? 0) ||
        undefined,
    },
    status: statusRank[right.status] > statusRank[left.status] ? right.status : left.status,
    release_stage: right.release_stage === "unknown" ? left.release_stage : right.release_stage,
    replacement_model_ids: unique([...left.replacement_model_ids, ...right.replacement_model_ids]),
    pricing_state: mergedPricingState(
      left.pricing_state,
      right.pricing_state,
      pricing.length > 0,
      onConflict,
    ),
    price_facts: pricing,
    raw_price_facts: uniqueCanonicalValues([...left.raw_price_facts, ...right.raw_price_facts]),
    availability: availability.size === 0 ? undefined : [...availability.values()],
  };
}

function add(
  models: Map<string, ProviderModel>,
  model: ProviderModel,
  onConflict?: (field: string) => void,
): void {
  const current = models.get(model.model_id);
  models.set(model.model_id, current === undefined ? model : merge(current, model, onConflict));
}

function bounded(
  models: Map<string, ProviderModel>,
  min: number,
  max: number,
  label: string,
): ProviderModel[] {
  assertItemCount(`${label} models`, models.size, min, max);
  return [...models.values()].sort((left, right) => left.uid.localeCompare(right.uid));
}

export function parseDashscopeCatalog(input: ParseInput): SourceParseResult {
  const extractor = input.source.extractor;
  if (extractor.kind !== "dashscope-catalog") throw new Error("Wrong DashScope catalog extractor");
  const models = new Map<string, ProviderModel>();
  const findings: string[] = [];
  let catalogTables = 0;
  // The Markdown endpoint also publishes JSX numeric span attributes in raw tables.
  const body = input.body.replace(/\b(rowSpan|colSpan)=\{(\d+)\}/g, '$1="$2"');
  for (const [tableIndex, table] of tables(body, { precedingHeadings: true }).entries()) {
    if (
      !table.headings.some((heading) =>
        /^(?:Recommended models|All models|Legacy models)$/.test(heading),
      )
    )
      continue;
    catalogTables += 1;
    const idIndex = column(table.headers, /^(?:Model ID|Model name|Model)$/i);
    assertItemCount("DashScope catalog model column", idIndex === undefined ? 0 : 1, 1, 1, [
      "tables",
      tableIndex,
      "headers",
    ]);
    if (idIndex === undefined) continue;
    let observedRows = 0;
    let coveredRows = 0;
    for (const [rowIndex, row] of table.rows.entries()) {
      if (row.length === 0 || (row.length > 1 && row.every((cell) => cell === row[0]))) continue;
      observedRows += 1;
      const rawType = value(table, row, /^(?:Type|Mode)(?:$| \/)/i);
      const api = value(table, row, /^API(?:$| \/)/i);
      const rowIds = catalogCellIds(row[idIndex]);
      if (rowIds.length === 0) {
        findings.push(`/tables/${tableIndex}/rows/${rowIndex}/model`);
        continue;
      }
      coveredRows += 1;
      for (const id of rowIds) {
        const realtime = /WebSocket|realtime/i.test(api ?? "");
        const context = tokenCount(value(table, row, /^Context(?:$| \/)/i));
        const output = tokenCount(value(table, row, /^Max output(?:$| \/)/i));
        const dimensionLimits = dimensions(value(table, row, /^Dimension(?:$| \/)/i));
        const embeddingTokens = tokenCount(value(table, row, /^Max tokens(?:$| \/)/i));
        const model = baseModel({
          providerId: input.provider.id,
          id,
          name: id,
          sourceId: input.source.id,
          observedAt: input.observedAt,
        });
        add(
          models,
          {
            ...model,
            description: value(table, row, /^(?:Description|Use case|Use cases)(?:$| \/)/i),
            tasks: rowOperations(extractor.category, id, rawType, api, table.headings),
            raw_type: rawType ?? api,
            delivery_modes: realtime ? ["realtime"] : undefined,
            delivery_mode_evidence:
              !realtime || api === undefined
                ? undefined
                : [
                    {
                      mode: "realtime",
                      source_ref: input.source.id,
                      namespace: `${input.provider.id}.api`,
                      raw_value: api,
                      kind: "provider_type",
                    },
                  ],
            modalities: rowModalities(extractor.category, table, row, rawType),
            capabilities: {
              ...model.capabilities,
              reasoning: support(value(table, row, /^Thinking mode(?:$| \/)/i)),
              tool_call: support(value(table, row, /^Function (?:Calling|calling)(?:$| \/)/)),
              structured_output: support(value(table, row, /^Structured output(?:$| \/)/i)),
              streaming: /WebSocket/i.test(api ?? "") ? true : "unknown",
            },
            limits: {
              ...dimensionLimits,
              ...(context === undefined ? {} : { context_tokens: context }),
              ...(output === undefined ? {} : { max_output_tokens: output }),
              ...(embeddingTokens === undefined ? {} : { max_input_tokens: embeddingTokens }),
            },
            status: "active",
            release_stage: /preview/i.test(`${id} ${row[idIndex]?.text ?? ""}`)
              ? "preview"
              : "unknown",
            pricing_state: "unknown",
            scope: "regional_catalog",
          },
          (field) => findings.push(`/tables/${tableIndex}/rows/${rowIndex}/${field}`),
        );
      }
    }
    assertCoverage("DashScope catalog model rows", coveredRows, observedRows, 1, [
      "tables",
      tableIndex,
      "rows",
    ]);
  }
  assertItemCount("DashScope catalog tables", catalogTables, 1);
  if (findings.length > 0) input.onContractFinding?.(contractExtensionEvidence(findings));
  return { models: bounded(models, 1, extractor.maxModels, `DashScope ${extractor.category}`) };
}

const recommendedEndpoints = new Map<string, { name: string; protocol: "https:" | "wss:" }>([
  [
    "/api/v1/services/aigc/image-generation/generation",
    { name: "Image Generation", protocol: "https:" },
  ],
  [
    "/api/v1/services/aigc/multimodal-generation/generation",
    { name: "Multimodal Generation", protocol: "https:" },
  ],
  [
    "/api/v1/services/aigc/video-generation/video-synthesis",
    { name: "Video Synthesis", protocol: "https:" },
  ],
  ["/api-ws/v1/inference", { name: "Realtime Inference", protocol: "wss:" }],
  ["/api/v1/services/audio/asr/transcription", { name: "Speech Recognition", protocol: "https:" }],
  ["/api-ws/v1/realtime", { name: "Realtime", protocol: "wss:" }],
  ["/compatible-mode/v1/embeddings", { name: "Embeddings", protocol: "https:" }],
  [
    "/api/v1/services/embeddings/multimodal-embedding/multimodal-embedding",
    { name: "Multimodal Embeddings", protocol: "https:" },
  ],
  ["/api/v1/services/rerank/text-rerank/text-rerank", { name: "Rerank", protocol: "https:" }],
]);

const recommendedRegions = new Map([
  ["Beijing", "China (Beijing)"],
  ["Hong Kong", "Hong Kong (China)"],
  ["Singapore", "Singapore"],
  ["Tokyo", "Japan (Tokyo)"],
  ["Frankfurt", "Germany (Frankfurt)"],
  ["US (Virginia)", "US (Virginia)"],
  ["Virginia", "US (Virginia)"],
  ["International", "International"],
]);

const recommendedWorkspaceRegions = new Map([
  ["cn-beijing", "China (Beijing)"],
  ["cn-hongkong", "Hong Kong (China)"],
  ["ap-southeast-1", "Singapore"],
  ["ap-northeast-1", "Japan (Tokyo)"],
  ["eu-central-1", "Germany (Frankfurt)"],
  ["us-east-1", "US (Virginia)"],
]);

const recommendedBasePaths = new Set(["/compatible-mode/v1", "/apps/anthropic", "/api/v1"]);

function recommendedEndpoint(raw: string): ApiEndpoint {
  const url = new URL(raw);
  const fact = recommendedEndpoints.get(url.pathname);
  if (
    fact === undefined ||
    url.protocol !== fact.protocol ||
    url.hostname !== "dashscope-intl.aliyuncs.com" ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== "" ||
    url.search !== "" ||
    url.hash !== ""
  )
    throw new Error(`Unsupported DashScope recommended-model endpoint: ${raw}`);
  return { name: fact.name, path: url.pathname };
}

function recommendedMarkdownRegions(raw: string): string[] {
  const labels = [...recommendedRegions.keys()].sort((left, right) => right.length - left.length);
  const regions: string[] = [];
  let offset = 0;
  while (offset < raw.length) {
    while (/\s/.test(raw[offset] ?? "")) offset += 1;
    if (offset >= raw.length) break;
    const label = labels.find((candidate) => raw.startsWith(candidate, offset));
    if (label === undefined)
      throw new Error(`Unsupported DashScope recommended-model region list: ${raw}`);
    const region = recommendedRegions.get(label);
    if (region === undefined)
      throw new Error(`Unsupported DashScope recommended-model region: ${label}`);
    regions.push(region);
    offset += label.length;
  }
  if (regions.length === 0)
    throw new Error("DashScope recommended-model Markdown card omitted regions");
  return unique(regions);
}

function markdownInlineText(raw: string): string {
  let result = raw;
  for (;;) {
    const next = result.replace(/\[([^\]]*)\]\([^)]+\)/g, "$1");
    if (next === result) break;
    result = next;
  }
  return text(result.replace(/`/g, ""));
}

function recommendedMarkdownRoute(raw: string): { endpoint?: ApiEndpoint; region: string } {
  const normalized = raw.replace("{WorkspaceId}", "workspace-id");
  const url = new URL(normalized);
  if (
    url.username !== "" ||
    url.password !== "" ||
    url.port !== "" ||
    url.search !== "" ||
    url.hash !== ""
  )
    throw new Error(`Unsupported DashScope recommended-model endpoint: ${raw}`);
  let region: string | undefined;
  if (url.hostname === "dashscope-intl.aliyuncs.com") region = "International";
  else if (url.hostname === "dashscope-us.aliyuncs.com") region = "US (Virginia)";
  else if (url.hostname === "dashscope.aliyuncs.com") region = "China (Beijing)";
  else {
    const match = url.hostname.match(/^workspace-id\.([a-z0-9-]+)\.maas\.aliyuncs\.com$/);
    region = match?.[1] === undefined ? undefined : recommendedWorkspaceRegions.get(match[1]);
  }
  const endpoint = recommendedEndpoints.get(url.pathname);
  const validBase = recommendedBasePaths.has(url.pathname) && url.protocol === "https:";
  if (
    region === undefined ||
    (!validBase && endpoint === undefined) ||
    (endpoint !== undefined && endpoint.protocol !== url.protocol)
  )
    throw new Error(`Unsupported DashScope recommended-model endpoint: ${raw}`);
  return {
    ...(endpoint === undefined ? {} : { endpoint: { name: endpoint.name, path: url.pathname } }),
    region,
  };
}

function recommendedListingTarget(raw: string): { id: string; region: string } {
  const url = new URL(raw);
  const pathDetail = url.pathname.match(/^\/([a-z0-9-]+)\/model\/market\/detail\/([^/]+)$/);
  const regionKey = pathDetail?.[1] ?? url.pathname.match(/^\/([a-z0-9-]+)\/?$/)?.[1];
  const region = regionKey === undefined ? undefined : recommendedWorkspaceRegions.get(regionKey);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "modelstudio.console.alibabacloud.com" ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== "" ||
    region === undefined
  )
    throw new Error(`Unsupported DashScope recommended-model listing URL: ${raw}`);
  const queryOffset = url.hash.indexOf("?");
  const query =
    queryOffset < 0 ? new URLSearchParams() : new URLSearchParams(url.hash.slice(queryOffset + 1));
  const detail = url.hash.match(/\/model-market\/detail\/([^?]+)/)?.[1];
  const id = exactId(
    pathDetail === null
      ? (query.get("modelId") ?? decodeURIComponent(detail ?? ""))
      : decodeURIComponent(pathDetail[2] ?? ""),
  );
  if (id === undefined)
    throw new Error(`DashScope recommended-model listing omitted an exact ID: ${raw}`);
  return { id, region };
}

function parseDashscopeRecommendedListing(input: ParseInput): Map<string, ProviderModel> {
  const models = new Map<string, ProviderModel>();
  const findings: string[] = [];
  for (const [index, line] of input.body.split(/\r?\n/).entries()) {
    const url =
      line.match(
        /<strong><a href="(https:\/\/modelstudio\.console\.alibabacloud\.com\/[^"]+)">/,
      )?.[1] ??
      line.match(
        /^\[!\[\]\([^)]+\)\s+[^\]]+]\((https:\/\/modelstudio\.console\.alibabacloud\.com\/[^)]+)\)\s*$/,
      )?.[1];
    if (url === undefined) continue;
    try {
      const { id, region } = recommendedListingTarget(url);
      add(models, {
        ...baseModel({
          providerId: input.provider.id,
          id,
          name: id,
          sourceId: input.source.id,
          observedAt: input.observedAt,
        }),
        availability: [{ region, deployment_type: "model_api" }],
        scope: "regional_catalog",
      });
    } catch {
      findings.push(`/links/${index}`);
    }
  }
  if (findings.length > 0) input.onContractFinding?.(contractExtensionEvidence(findings));
  return models;
}

function parseDashscopeRecommendedMarkdown(input: ParseInput): Map<string, ProviderModel> {
  if (!/Model ID\s*`/.test(input.body)) return parseDashscopeRecommendedListing(input);
  const lines = input.body.split(/\r?\n/);
  const starts = lines.flatMap((line, index) =>
    /^\[!\[\]\([^\n]+\) [^\n]+\]\([^\n]+\)\s*$/.test(line) ? [index] : [],
  );
  const models = new Map<string, ProviderModel>();
  const findings: string[] = [];
  for (const [position, start] of starts.entries()) {
    try {
      const firstLine = lines[start] ?? "";
      const heading = firstLine.match(/^\[!\[\]\([^\n]+\) (.+)\]\(/)?.[1] ?? "";
      const end = starts[position + 1] ?? lines.length;
      const block = lines.slice(start, end).join("\n");
      const publishedIds = unique(
        [...block.matchAll(/Model ID\s*`([^`]+)`/g)].flatMap(
          (match) => exactId(match[1] ?? "") ?? [],
        ),
      );
      const id = publishedIds[0];
      if (id === undefined || publishedIds.length !== 1 || !heading.startsWith(id))
        throw new Error("ID drift");
      const regions = recommendedMarkdownRegions(text(lines[start + 1] ?? ""));
      const routeValues = [
        ...block.matchAll(/(?:Base|Request) URL\s+(.+?)(?=\s+(?:API Key|Model ID)|$)/g),
      ]
        .map((match) => markdownInlineText(match[1] ?? ""))
        .map((line) => line.match(/(?:https|wss):\/\/\S+/)?.[0])
        .flatMap((route) => (route === undefined ? [] : [recommendedMarkdownRoute(route)]));
      if (routeValues.length === 0) throw new Error("Routes missing");
      const routeRegions = unique(routeValues.map(({ region }) => region));
      if (
        routeRegions.length !== regions.length ||
        routeRegions.some((region) => !regions.includes(region))
      )
        throw new Error("Route regions conflict");
      const endpoints = new Map(
        routeValues.flatMap(({ endpoint }) =>
          endpoint === undefined ? [] : [[apiEndpointKey(endpoint), endpoint] as const],
        ),
      );
      const model = baseModel({
        providerId: input.provider.id,
        id,
        name: id,
        sourceId: input.source.id,
        observedAt: input.observedAt,
      });
      add(models, {
        ...model,
        api_endpoints:
          endpoints.size === 0
            ? undefined
            : [...endpoints.values()].sort((left, right) =>
                apiEndpointKey(left).localeCompare(apiEndpointKey(right)),
              ),
        availability: regions.map((region) => ({ region, deployment_type: "model_api" })),
        scope: "regional_catalog",
      });
    } catch {
      findings.push(`/cards/${position}`);
    }
  }
  if (findings.length > 0) input.onContractFinding?.(contractExtensionEvidence(findings));
  return models;
}

export function parseDashscopeRecommended(input: ParseInput): SourceParseResult {
  const extractor = input.source.extractor;
  if (extractor.kind !== "dashscope-recommended")
    throw new Error("Wrong DashScope recommended-model extractor");
  const $ = load(input.body);
  const models =
    $(".bl-cardwrap").length === 0
      ? parseDashscopeRecommendedMarkdown(input)
      : new Map<string, ProviderModel>();
  const findings: string[] = [];
  $(".bl-cardwrap").each((index, element) => {
    try {
      const card = $(element);
      const names = unique(
        card
          .find(".bl-card-name")
          .map((_nameIndex, name) => text($(name).text()))
          .get()
          .filter(Boolean),
      );
      const id = names.length === 1 ? exactId(names[0] ?? "") : undefined;
      const publishedIds = unique(
        card
          .find(".bl-pop-row")
          .filter((_rowIndex, row) => text($(row).find(".bl-pop-k").first().text()) === "Model ID")
          .map((_rowIndex, row) => exactId(text($(row).find("code").first().text())) ?? "")
          .get()
          .filter(Boolean),
      );
      if (id === undefined || publishedIds.length !== 1 || publishedIds[0] !== id)
        throw new Error("DashScope recommended-model card ID drifted");
      const availability = unique(
        card
          .find(".bl-pop > .bl-tabs > label")
          .map((_regionIndex, label) => text($(label).text()))
          .get()
          .filter(Boolean),
      ).map((raw) => {
        const region = recommendedRegions.get(raw);
        if (region === undefined)
          throw new Error(`Unsupported DashScope recommended-model region: ${raw}`);
        return { region, deployment_type: "model_api" };
      });
      if (availability.length === 0)
        throw new Error(`DashScope recommended-model card omitted regions for ${id}`);
      const endpoints = new Map(
        card
          .find(".bl-pop-row")
          .filter(
            (_rowIndex, row) => text($(row).find(".bl-pop-k").first().text()) === "Request URL",
          )
          .map((_rowIndex, row) => recommendedEndpoint(text($(row).find("code").first().text())))
          .get()
          .map((endpoint) => [apiEndpointKey(endpoint), endpoint]),
      );
      const model = baseModel({
        providerId: input.provider.id,
        id,
        name: id,
        sourceId: input.source.id,
        observedAt: input.observedAt,
      });
      add(models, {
        ...model,
        api_endpoints:
          endpoints.size === 0
            ? undefined
            : [...endpoints.values()].sort((left, right) =>
                apiEndpointKey(left).localeCompare(apiEndpointKey(right)),
              ),
        availability,
        scope: "regional_catalog",
      });
    } catch {
      findings.push(`/cards/${index}`);
    }
  });
  if (findings.length > 0) input.onContractFinding?.(contractExtensionEvidence(findings));
  return {
    models: bounded(
      models,
      extractor.minModels,
      extractor.maxModels,
      "DashScope recommended-model",
    ),
  };
}

function decimal(raw: string): string | undefined {
  const normalized = raw.replace(/,/g, "");
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(normalized)) return undefined;
  const [whole = "0", fraction = ""] = normalized.split(".");
  const trimmed = fraction.replace(/0+$/, "");
  return trimmed === "" ? whole : `${whole}.${trimmed}`;
}

function unit(header: string, raw: string): SourcePriceFact["unit"] | undefined {
  const evidence = `${header} ${raw}`.toLowerCase();
  if (/million (?:input )?tokens/.test(evidence)) return "million_tokens";
  if (/10,000 characters/.test(evidence)) return "million_characters";
  if (/\/image|per image/.test(evidence)) return "image";
  if (/\/second|per second/.test(evidence)) return "second";
  if (/voice clone/.test(evidence)) return "request";
  return undefined;
}

function meter(
  header: string,
  headings: string[],
  tasks: ModelTask[],
  rateUnit: SourcePriceFact["unit"],
  conditions: SourcePriceFact["conditions"],
): SourcePriceFact["meter"] {
  const evidence = `${header} ${headings.join(" ")}`.toLowerCase();
  const direction = /output/.test(header.toLowerCase()) ? "output" : "input";
  const modality = conditions.modality;
  if (/^Cache-hit input price \(per million tokens\)$/i.test(header)) return "cache_read_text";
  if (
    /^(?:Input|Output) price \(per million tokens\)$/i.test(header) &&
    tasks.includes("text_generation")
  )
    return direction === "output" ? "output_text" : "input_text";
  if (tasks.includes("embeddings")) return "embedding";
  if (tasks.includes("reranking") || /\b(?:input|output)\b/i.test(header)) {
    if (modality === "text") return direction === "output" ? "output_text" : "input_text";
    if (modality === "audio") return direction === "output" ? "output_audio" : "input_audio";
    if (modality === "image") return direction === "output" ? "output_image" : "input_image";
    if (modality === "video") return direction === "output" ? "output_video" : "input_video";
  }
  if (tasks.includes("image_generation") && direction === "input" && /input/i.test(header))
    return "input_image";
  if (rateUnit === "image")
    return direction === "input" && /input/i.test(header) ? "input_image" : "image_generation";
  if (tasks.includes("image_generation")) return "image_generation";
  if (tasks.includes("video_generation")) return "video_generation";
  if (/voice clone/.test(evidence)) return "speech_generation";
  if (tasks.includes("speech_synthesis") || tasks.includes("audio_generation"))
    return direction === "output" ? "output_audio" : "input_text";
  if (tasks.includes("transcription"))
    return direction === "output" ? "output_text" : "input_audio";
  if (/output/.test(header.toLowerCase())) {
    if (/audio/.test(header.toLowerCase())) return "output_audio";
    if (/image/.test(header.toLowerCase())) return "output_image";
    if (/video/.test(header.toLowerCase())) return "output_video";
    return "output_text";
  }
  if (/audio/.test(header.toLowerCase())) return "input_audio";
  if (/image/.test(header.toLowerCase())) return "input_image";
  if (/video/.test(header.toLowerCase())) return "input_video";
  return "input_text";
}

function dashscopeRegion(raw: string): string | undefined {
  if (
    !/^(?:Singapore|China \(Beijing\)|Hong Kong \(China\)|China \(Hong Kong\)|Germany \(Frankfurt\)|Japan \(Tokyo\)|US \(Virginia\))$/.test(
      raw,
    )
  )
    return undefined;
  return raw === "China (Hong Kong)" ? "Hong Kong (China)" : raw;
}

const deploymentRegions = new Map([
  ["international", "Singapore"],
  ["chinese mainland", "China (Beijing)"],
  ["china (mainland)", "China (Beijing)"],
  ["eu", "Germany (Frankfurt)"],
  ["japan", "Japan (Tokyo)"],
  ["us", "US (Virginia)"],
]);

function deploymentRegion(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const direct = dashscopeRegion(raw);
  if (direct !== undefined) return direct;
  return deploymentRegions.get(raw.toLowerCase());
}

function priceConditions(table: Table, row: Cell[], header: string): SourcePriceFact["conditions"] {
  const deployment = value(table, row, /^Deployment (?:scope|region)|^Service deployment scope/i);
  const region =
    table.headings.map(dashscopeRegion).find((item) => item !== undefined) ??
    deploymentRegion(deployment);
  const tier = value(table, row, /^Input token(?:s| range) per request/i);
  const range = tier
    ?.replace(/,/g, "")
    .match(/(?:(\d+(?:\.\d+)?[KM]?)<)?Token≤(\d+(?:\.\d+)?[KM]?)/i);
  const mode = value(table, row, /^(?:Mode|Output video mode)(?:$| \/)/i);
  const videoType = value(table, row, /^Output video type$/i);
  const audio =
    videoType !== undefined && /^Audio video(?: audio=true)?$/i.test(videoType)
      ? true
      : videoType !== undefined && /^Silent video(?: audio=false)?$/i.test(videoType)
        ? false
        : undefined;
  const exclusiveMinimum = tokenCount(range?.[1]);
  const subheading = header.split(" / ").at(-1);
  const operation = mode ?? (/thinking mode/i.test(subheading ?? "") ? subheading : undefined);
  const resolution = value(table, row, /^(?:Output (?:image|video) )?resolution|^Max resolution/i);
  return {
    ...(region === undefined ? {} : { region }),
    ...(deployment === undefined ? {} : { deployment_scope: deployment }),
    ...(exclusiveMinimum === undefined ? {} : { context_min_tokens: exclusiveMinimum + 1 }),
    ...(range?.[2] === undefined ? {} : { context_max_tokens: tokenCount(range[2]) }),
    ...(tier === undefined || /No tiered|flat-rate/i.test(tier) ? {} : { context_tier: tier }),
    ...(operation === undefined
      ? {}
      : { operation: text(operation).toLowerCase().replace(/\W+/g, "_") }),
    ...(resolution === undefined ? {} : { resolution }),
    ...(audio === undefined ? {} : { audio }),
    ...(subheading === undefined || !/^(?:Text|Audio|Image|Video|Image\/video)/i.test(subheading)
      ? {}
      : { modality: text(subheading).toLowerCase() }),
  };
}

interface PriceSegment {
  price: string;
  label?: string;
  promotion?: boolean;
  accountEligibility?: string;
}

function priceSegments(cell: Cell, header: string): PriceSegment[] {
  const hourly = cell.text.match(/^Busy hours:\s*\$?([\d,.]+)\s*Idle hours:\s*\$?([\d,.]+)$/i);
  if (hourly !== null) {
    const busy = decimal(hourly[1] ?? "");
    const idle = decimal(hourly[2] ?? "");
    if (busy !== undefined && idle !== undefined)
      return [
        { price: busy, label: "Busy hours" },
        { price: idle, label: "Idle hours" },
      ];
  }
  const parts = (cell.parts.length === 0 ? [cell.text] : cell.parts).map((part) => {
    const trimmed = part.trim();
    if (/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(trimmed) && /USD\s*\/\s*million tokens/i.test(header))
      return `$${trimmed}`;
    return part.replace(
      /((?:0|[1-9]\d*)(?:\.\d+)?)\s+USD\s*\/\s*million tokens\b/gi,
      (_match, amount: string) => `$${amount}`,
    );
  });
  const pricedParts = parts.filter((part) =>
    /(?:\$|USD\s+)[\d,.]+|^(?:Free|Free trial|Limited-time free)$/i.test(part.trim()),
  );
  return pricedParts.flatMap((raw): PriceSegment[] => {
    const free = raw.trim().match(/^(Free|Free trial|Limited-time free)$/i)?.[1];
    if (free !== undefined)
      return [
        {
          price: "0",
          promotion: !/^Free$/i.test(free),
          ...(/^Free trial$/i.test(free) ? { accountEligibility: "free_trial" } : {}),
        },
      ];
    const matches = [...raw.matchAll(/(?:\$|USD\s+)([\d,.]+)/gi)];
    return matches.flatMap((match, index) => {
      const price = match[1] === undefined ? undefined : decimal(match[1]);
      if (price === undefined) return [];
      const start =
        index === 0 ? 0 : (matches[index - 1]?.index ?? 0) + (matches[index - 1]?.[0].length ?? 0);
      const label = text(raw.slice(start, match.index));
      return [
        {
          price,
          ...(label === "" || (pricedParts.length === 1 && matches.length === 1) ? {} : { label }),
        },
      ];
    });
  });
}

function segmentConditions(label: string | undefined): SourcePriceFact["conditions"] {
  if (label === undefined) return {};
  const resolution = label.match(/\b\d{3,4}P\b/i)?.[0];
  const promptExtend = label.match(/prompt_extend=(true|false)/i)?.[0];
  const modality = label.match(
    /(?:Image\/video|Text|Audio|Image|Video)(?:\s+input)?\s*:?[\s]*$/i,
  )?.[0];
  const normalized = text(label.replace(/^(?:List price|Output video):\s*/i, "")).replace(
    /[:：]+$/,
    "",
  );
  const operation =
    normalized === "" || /^(?:Image\/video|Text|Audio|Image|Video)(?:\s+input)?$/i.test(normalized)
      ? undefined
      : normalized;
  return {
    ...(resolution === undefined ? {} : { resolution }),
    ...(promptExtend === undefined ? {} : { operation: promptExtend }),
    ...(modality === undefined
      ? {}
      : {
          modality: modality
            .replace(/\s+input\s*:?\s*$/i, "")
            .replace(/[:\s]+$/g, "")
            .toLowerCase(),
        }),
    ...(resolution === undefined && promptExtend === undefined && operation !== undefined
      ? { operation: operation.toLowerCase().replace(/\W+/g, "_") }
      : {}),
  };
}

function normalizedPrice(price: string, rateUnit: SourcePriceFact["unit"]): string {
  return rateUnit === "million_characters" ? scaleDecimal(price, 2) : price;
}

function rowPrices(
  input: ParseInput,
  table: Table,
  row: Cell[],
  tasks: ModelTask[],
  sample: string,
): { rates: SourcePriceFact[]; raw: SourceRawPricingFact[] } {
  const result: SourcePriceFact[] = [];
  const unresolved: SourceRawPricingFact[] = [];
  const idIndex = column(table.headers, /^(?:Model ID|Model name|Model)$/i);
  const idCell = idIndex === undefined ? undefined : row[idIndex];
  const priceIndexes = table.headers.flatMap((header, index) =>
    /price/i.test(header) ? [index] : [],
  );
  const sharedRateUnits = [
    ...new Set(
      priceIndexes.flatMap((index) => {
        const header = table.headers[index];
        if (header === undefined) return [];
        const rateUnit = unit(header, row[index]?.text ?? "");
        return rateUnit === undefined ? [] : [rateUnit];
      }),
    ),
  ];
  for (const [index, header] of table.headers.entries()) {
    if (!/price/i.test(header)) continue;
    const effectiveHeader =
      /Qwen-TTS-Realtime/i.test(table.headings.join(" ")) && index === priceIndexes[1]
        ? header.replace(/^Input/i, "Output")
        : header;
    const cell = row[index];
    if (cell === undefined) continue;
    const raw = cell.text;
    const rateUnit =
      unit(effectiveHeader, raw) ?? (sharedRateUnits.length === 1 ? sharedRateUnits[0] : undefined);
    const segments = priceSegments(cell, effectiveHeader);
    if (segments.length === 0) {
      if (raw === "" || /^(?:--|-)$/.test(raw) || /\bDiscontinued\b/i.test(raw)) continue;
      input.onPricingReconciliation?.({
        disposition: /contact (?:sales|us)/i.test(raw) ? "explicit_non_numeric" : "unsupported",
        reason_code: /contact (?:sales|us)/i.test(raw)
          ? "custom_quote_price"
          : "pricing_cell_unsupported",
        sample: `${sample}:${header}:${raw}`.slice(0, 256),
      });
      continue;
    }
    if (rateUnit === undefined) {
      input.onPricingReconciliation?.({
        disposition: "unsupported",
        reason_code: "pricing_unit_unsupported",
        sample: `${sample}:${effectiveHeader}:${raw}`.slice(0, 256),
      });
      continue;
    }
    const baseConditions = priceConditions(table, row, effectiveHeader);
    const discounts = [...raw.matchAll(/(?<![\w.,+-])(?:(night|daytime)\s+)?(\d+)% off\b/gi)];
    const discountClaim = /%\s*off\b/i.test(raw);
    const discountKnown =
      /^List price\s/i.test(raw) &&
      segments.length === 1 &&
      discounts.length > 0 &&
      discounts.length === [...raw.matchAll(/%\s*off\b/gi)].length &&
      discounts.every((match) => Number(match[2]) <= 100);
    if (discountClaim && !discountKnown)
      input.onPricingReconciliation?.({
        disposition: "unresolved",
        reason_code: "pricing_policy_unavailable",
        sample: `${sample}:${effectiveHeader}:${raw}`.slice(0, 256),
      });
    for (const segment of segments) {
      const conditions = {
        ...baseConditions,
        ...segmentConditions(segment.label),
        ...(discountKnown ? { promotion: false } : {}),
        ...(segment.promotion === true ? { promotion: true } : {}),
        ...(segment.accountEligibility === undefined
          ? {}
          : { account_eligibility: segment.accountEligibility }),
      };
      const modalities =
        conditions.modality === "text/image/video"
          ? ["text", "image", "video"]
          : [conditions.modality];
      for (const modality of modalities) {
        const scopedConditions = modality === undefined ? conditions : { ...conditions, modality };
        const meterName = meter(effectiveHeader, table.headings, tasks, rateUnit, scopedConditions);
        if (discountClaim && !discountKnown) {
          unresolved.push({
            term_key: `unparsed:${meterName}:discount`,
            impact: "base_price",
            reason: "unknown_applicability",
            conditions: scopedConditions,
            source_ref: input.source.id,
            raw: {
              fragment: raw.slice(0, 4096),
              amount: segment.price,
              meter: meterName,
              denomination: "USD",
              unit: header,
            },
          });
          continue;
        }
        const base: SourcePriceFact = {
          meter: meterName,
          price: normalizedPrice(segment.price, rateUnit),
          currency: "USD",
          unit: rateUnit,
          conditions: scopedConditions,
          source_ref: input.source.id,
          derived: rateUnit === "million_characters",
          derivation:
            rateUnit === "million_characters"
              ? "source price per 10,000 characters × 100"
              : undefined,
          raw_price: segment.price,
          raw_unit: header,
        };
        result.push(base);
        for (const match of discounts) {
          const percent = Number(match[2]);
          const remainder = 100 - percent;
          const factor =
            remainder === 100
              ? "1"
              : remainder === 0
                ? "0"
                : `0.${String(remainder).padStart(2, "0")}`;
          result.push({
            ...base,
            price: multiplyDecimal(base.price, factor),
            conditions: {
              ...base.conditions,
              ...(match[1] === undefined ? {} : { billing_period: match[1].toLowerCase() }),
              promotion: true,
            },
            derived: true,
            derivation: `source list price × ${factor}`,
          });
        }
        if (/50%\s+batch inference discount/i.test(idCell?.text ?? ""))
          result.push({
            ...base,
            price: multiplyDecimal(base.price, "0.5"),
            conditions: { ...base.conditions, service_tier: "batch" },
            derived: true,
            derivation: "source real-time price × 0.5",
          });
      }
    }
  }
  return { rates: result, raw: unresolved };
}

function priceOperations(id: string, headings: string[], headers: string[]): ModelTask[] {
  const evidence = `${id} ${headings.join(" ")}`.toLowerCase();
  const section = headings.find((heading) => dashscopeRegion(heading) === undefined);
  const result: ModelTask[] = [];
  if (/embedding/.test(evidence)) result.push("embeddings");
  if (/rerank/.test(evidence)) result.push("reranking");
  if (/image generation|image processing|text-to-image|image translation/.test(evidence))
    result.push("image_generation");
  if (
    /video generation|video processing/.test(evidence) ||
    headers.some((header) => /^Output video (?:type|mode|resolution)$/i.test(header))
  )
    result.push("video_generation");
  if (/music generation/.test(evidence)) result.push("audio_generation");
  if (/speech synthesis|tts|cosyvoice|voice (?:clone|design|enrollment)/.test(evidence))
    result.push("speech_synthesis");
  if (/livetranslate/.test(evidence) || /translation/i.test(section ?? ""))
    result.push("translation");
  if (/speech recognition|(?:^|[ -])asr|paraformer/.test(evidence)) result.push("transcription");
  if (
    /speech[- ]to[- ]speech|(?:audio|omni)[\s\S]*realtime|realtime[\s\S]*(?:audio|omni)/.test(
      evidence,
    )
  )
    result.push("speech_to_speech");
  if (/intent/.test(evidence)) result.push("classification");
  if (/ocr/.test(evidence)) result.push("ocr");
  if (result.length === 0) result.push("text_generation");
  return orderedTasks(result);
}

function priceModalities(
  tasks: ModelTask[],
  modelRates: SourcePriceFact[],
  headings: string[],
): ProviderModel["modalities"] {
  const input: Modality[] = [];
  const output: Modality[] = [];
  for (const item of modelRates) {
    if (
      item.meter === "embedding" ||
      item.meter === "input_text" ||
      item.meter === "input_image" ||
      item.meter === "input_audio" ||
      item.meter === "input_video"
    ) {
      for (const modality of item.conditions.modality?.split("/") ?? []) {
        if (
          modality === "text" ||
          modality === "image" ||
          modality === "audio" ||
          modality === "video"
        )
          input.push(modality);
      }
    }
    if (item.meter === "input_text" || item.meter === "embedding") input.push("text");
    if (item.meter === "input_image") input.push("image");
    if (item.meter === "input_audio") input.push("audio");
    if (item.meter === "input_video") input.push("video");
    if (item.meter === "output_text") output.push("text");
    if (item.meter === "output_image" || item.meter === "image_generation") output.push("image");
    if (item.meter === "output_audio") output.push("audio");
    if (item.meter === "output_video" || item.meter === "video_generation") output.push("video");
  }
  if (tasks.includes("embeddings") && /multimodal embedding/i.test(headings.join(" ")))
    input.push("text", "image", "video");
  if (tasks.includes("embeddings")) output.push("embedding");
  if (tasks.includes("speech_synthesis") || tasks.includes("audio_generation"))
    output.push("audio");
  if (tasks.includes("transcription")) output.push("text");
  if (tasks.includes("speech_to_speech")) {
    input.push("audio");
    output.push("audio");
  }
  return { input: unique(input), output: unique(output) };
}

function companion(input: ParseInput, bundle: LinkedBundle, pathname: string): string | undefined {
  const normalized = (value: string): string => value.replace(/\.md$/, "").replace(/\/$/, "");
  const matches = bundle.documents.filter(
    ({ url }) => normalized(new URL(url).pathname) === normalized(pathname),
  );
  if (matches.length === 1) return matches[0]?.body;
  input.onPricingReconciliation?.({
    disposition: matches.length === 0 ? "unbound" : "unsupported",
    reason_code:
      matches.length === 0 ? "commercial_companion_missing" : "commercial_companion_duplicate",
    sample: pathname,
  });
  return undefined;
}

function documentText(body: string): string {
  const markup = /^#{1,6}\s+/m.test(body)
    ? body.replaceAll("**", "").replaceAll("\\<", "&lt;").replaceAll("\\>", "&gt;")
    : body;
  return text(load(markup).root().text());
}

function hasClaims(
  input: ParseInput,
  body: string | undefined,
  claims: readonly string[],
  reasonCode: string,
): boolean {
  if (body === undefined) return false;
  const normalized = documentText(body).toLowerCase();
  const missing = claims.filter((claim) => !normalized.includes(claim.toLowerCase()));
  if (missing.length === 0) return true;
  input.onPricingReconciliation?.({
    disposition: "unbound",
    reason_code: reasonCode,
    sample: missing.slice(0, 3).join(" | "),
  });
  return false;
}

function markdownDocument(body: string): boolean {
  return /^#{1,6}\s+/m.test(body);
}

function commercialEvidence(input: ParseInput, bundle: LinkedBundle): CommercialEvidence {
  const cacheBody = companion(input, bundle, "/help/en/model-studio/context-cache");
  const cacheRates = hasClaims(
    input,
    cacheBody,
    [
      "125% of the standard input token price",
      "10% of the standard input token price",
      "20% of the standard input token price",
    ],
    "context_cache_rate_drift",
  );
  const webSearchBody = companion(input, bundle, "/help/en/model-studio/web-search");
  const imageSearchBody = companion(input, bundle, "/help/en/model-studio/image-search");
  const textToImageSearchBody = companion(input, bundle, "/help/en/model-studio/web-search-image");
  return {
    ...(cacheBody === undefined ? {} : { cacheBody }),
    cacheRates,
    ...(imageSearchBody === undefined ? {} : { imageSearchBody }),
    ...(textToImageSearchBody === undefined ? {} : { textToImageSearchBody }),
    ...(webSearchBody === undefined ? {} : { webSearchBody }),
  };
}

const webSearchScopes = new Set(["International", "Global", "Chinese mainland"]);
const webSearchMarkdownScopes = new Set(["Singapore", "China (Beijing)", "Global"]);

function markdownSectionTitle(line: string): string | undefined {
  const markup =
    line.match(/^#{1,6}\s+(.+?)\s*$/)?.[1] ?? line.match(/^\s*<Tab\s+title="([^"]+)">\s*$/)?.[1];
  return markup === undefined ? undefined : text(load(markup.replaceAll("**", "")).root().text());
}

function mentionedModelIds(body: string, knownIds: Set<string>): Set<string> {
  const normalized = documentText(body);
  const result = new Set(
    [...normalized.matchAll(/\b[a-z0-9][a-z0-9._/-]*[a-z0-9]\b/g)]
      .map((match) => match[0])
      .filter((id) => knownIds.has(id)),
  );
  for (const match of normalized.matchAll(
    /\b(qwen[a-z0-9._-]+), (qwen[a-z0-9._-]+-(\d{4}-\d{2}-\d{2})) and later snapshots\b/g,
  )) {
    const base = match[1];
    const firstDate = match[3];
    if (base === undefined || firstDate === undefined) continue;
    const snapshot = new RegExp(
      `^${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-(\\d{4}-\\d{2}-\\d{2})$`,
    );
    for (const id of knownIds) {
      const date = id.match(snapshot)?.[1];
      if (date !== undefined && date >= firstDate) result.add(id);
    }
  }
  return result;
}

function webSearchPrice(body: string, scope: string): string | undefined {
  const billing = toolBillingBody(body);
  if (billing === undefined) return;
  const normalized = documentText(billing);
  const label =
    scope === "International"
      ? "international deployment scope"
      : scope === "Global" || scope === "Chinese mainland"
        ? "Chinese mainland and global deployment scopes"
        : scope === "Singapore"
          ? "Singapore region"
          : "China (Beijing) region";
  const pattern = new RegExp(
    `${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^$]{0,120}\\$([0-9][0-9,]*(?:\\.[0-9]+)?)`,
    "i",
  );
  const amount = normalized.match(pattern)?.[1];
  return amount === undefined ? undefined : decimal(amount);
}

function toolBillingBody(body: string): string | undefined {
  if (markdownDocument(body)) {
    const lines = markdownProse(body).split(/\r?\n/);
    const starts = lines.flatMap((line, index) =>
      markdownSectionTitle(line) === "Billing" ? [index] : [],
    );
    if (starts.length === 0) return body;
    const start = starts[0];
    if (starts.length !== 1 || start === undefined) return;
    const depth = lines[start]?.match(/^#+/)?.[0].length ?? 2;
    const end = lines.findIndex(
      (line, index) =>
        index > start && /^#{1,6}\s/.test(line) && (line.match(/^#+/)?.[0].length ?? 7) <= depth,
    );
    return lines.slice(start + 1, end < 0 ? undefined : end).join("\n");
  }
  const $ = load(body),
    headings = $("h1,h2,h3").filter((_, node) => text($(node).text()) === "Billing");
  if (headings.length === 0) return body;
  if (headings.length !== 1) return;
  return headings
    .first()
    .nextUntil("h1,h2,h3")
    .toArray()
    .map((node) => $.html(node))
    .join("\n");
}

function namedToolRegions(input: ParseInput, raw: string): string[] {
  return unique(
    raw.split(/,\s*|\s+and\s+/).flatMap((label) => {
      const candidate = text(label.replace(/^and\s+/i, "")),
        region = dashscopeRegion(candidate);
      if (region !== undefined) return [region];
      input.onPricingReconciliation?.({
        disposition: "unbound",
        reason_code: "web_search_scope_unsupported",
        sample: candidate,
      });
      return [];
    }),
  );
}

function webSearchPolicyQuotes(
  input: ParseInput,
  body: string,
): Array<{ operation: string; price: string; regions: string[] }> | undefined {
  const billing = toolBillingBody(body);
  if (billing === undefined) return [];
  if (!/\bagent(?:\\?_max)?\s+policy/i.test(documentText(billing))) return;
  const result: Array<{ operation: string; price: string; regions: string[] }> = [];
  let operation: string | undefined,
    webUnit = false;
  for (const line of markdownProse(billing).split(/\r?\n/)) {
    const value = documentText(line.replaceAll("**", ""))
      .replace(/\\_/g, "_")
      .replace(/^\s*-\s*/, "");
    const policy = value.match(/^(agent(?:_max)?) policy(?: \(Limited-time offer\))?:$/i)?.[1];
    if (policy !== undefined) {
      operation = policy.toLowerCase();
      webUnit = false;
      continue;
    }
    if (/policy\s*(?:\(|:|$)/i.test(value)) {
      operation = undefined;
      webUnit = false;
      continue;
    }
    if (operation === undefined) continue;
    if (/^(?:The )?Fee per (?:1,000|1000) calls/i.test(value)) {
      webUnit = !/extractor/i.test(value);
      continue;
    }
    if (!webUnit) continue;
    const quote = value.match(/^For the (.+?) regions?:\s*\\?\$([0-9][0-9,]*(?:\.[0-9]+)?)\.?$/i);
    const price = quote?.[2] === undefined ? undefined : decimal(quote[2]);
    if (quote?.[1] === undefined || price === undefined) continue;
    const regions = namedToolRegions(input, quote[1]);
    if (regions.length > 0) result.push({ operation, price, regions });
  }
  if (result.length === 0)
    input.onPricingReconciliation?.({
      disposition: "unbound",
      reason_code: "web_search_policy_unavailable",
    });
  return result;
}

function regionalWebSearchRates(
  input: ParseInput,
  body: string,
  models: Map<string, ProviderModel>,
  sections: ReadonlyMap<string, string[]>,
): DashscopeToolRate[] | undefined {
  const quotes = webSearchPolicyQuotes(input, body);
  if (quotes === undefined) return;
  return [...sections].flatMap(([scope, lines]) => {
    const section = lines.join("\n"),
      ids = mentionedModelIds(section, new Set(models.keys()));
    const global = documentText(section).match(/supported in the (.+?) regions\b/i)?.[1];
    const regions =
      scope === "Global" ? (global === undefined ? [] : namedToolRegions(input, global)) : [scope];
    if (regions.length === 0)
      input.onPricingReconciliation?.({
        disposition: "unbound",
        reason_code: "web_search_model_scope_drift",
        sample: scope,
      });
    return quotes.flatMap((quote) =>
      quote.regions
        .filter((region) => regions.includes(region))
        .flatMap((region) =>
          [...ids].map((modelId) => ({
            modelId,
            scope,
            rate: publishedRate(
              "web_search",
              quote.price,
              "thousand_events",
              input.source.id,
              `USD per 1,000 ${quote.operation} web-search calls`,
              { region, operation: quote.operation },
            ),
          })),
        ),
    );
  });
}

function webSearchRate(
  input: ParseInput,
  body: string,
  scope: string,
  models: Map<string, ProviderModel>,
  section: string,
): DashscopeToolRate[] {
  const price = webSearchPrice(body, scope);
  if (price === undefined) {
    input.onPricingReconciliation?.({
      disposition: "unbound",
      reason_code: "web_search_price_unbound",
      sample: scope,
    });
    return [];
  }
  const ids = mentionedModelIds(section, new Set(models.keys()));
  if (ids.size === 0) {
    input.onPricingReconciliation?.({
      disposition: "unbound",
      reason_code: "web_search_model_scope_unbound",
      sample: scope,
    });
    return [];
  }
  return [...ids].map((modelId) => {
    const region = deploymentRegion(scope);
    const rate = publishedRate(
      "web_search",
      price,
      "thousand_events",
      input.source.id,
      "USD per 1,000 web-search calls",
      {
        ...(region === undefined ? {} : { region }),
        deployment_scope: scope,
        operation: "web_search",
      },
    );
    input.onPricingReconciliation?.({
      disposition: "normalized",
      reason_code: "web_search_rate_normalized",
      sample: `${modelId}:${scope}`,
    });
    return { modelId, scope, rate };
  });
}

function webSearchRates(
  input: ParseInput,
  body: string | undefined,
  models: Map<string, ProviderModel>,
): DashscopeToolRate[] {
  if (body === undefined) return [];
  if (markdownDocument(body)) {
    const lines = markdownProse(body).split(/\r?\n/);
    const supported = lines.findIndex((line) => markdownSectionTitle(line) === "Supported models");
    const end = lines.findIndex(
      (line, index) => index > supported && markdownSectionTitle(line) === "Quick start",
    );
    if (supported < 0 || end < 0) {
      input.onPricingReconciliation?.({
        disposition: "unbound",
        reason_code: "web_search_model_scope_drift",
      });
      return [];
    }
    const sections = new Map<string, string[]>();
    let scope: string | undefined;
    for (const line of lines.slice(supported + 1, end)) {
      const candidate = markdownSectionTitle(line);
      if (candidate !== undefined) {
        scope = webSearchMarkdownScopes.has(candidate) ? candidate : undefined;
        if (scope !== undefined) sections.set(scope, []);
      } else if (scope !== undefined) {
        sections.get(scope)?.push(line);
      }
    }
    for (const scope of ["Singapore", "China (Beijing)"])
      if (!sections.has(scope))
        input.onPricingReconciliation?.({
          disposition: "unbound",
          reason_code: "web_search_model_scope_drift",
          sample: scope,
        });
    const regional = regionalWebSearchRates(input, body, models, sections);
    if (regional !== undefined) return regional;
    return [...sections.keys()].flatMap((scope) =>
      webSearchRate(input, body, scope, models, (sections.get(scope) ?? []).join("\n")),
    );
  }
  const $ = load(body);
  const supported = $("h2")
    .filter((_index, heading) => text($(heading).text()) === "Supported models")
    .first()
    .parent("section");
  const sections = supported
    .children("section[data-tag='tabbed-content-box']")
    .first()
    .children("section")
    .toArray();
  const result: DashscopeToolRate[] = [];
  for (const section of sections) {
    const scope = text($(section).children("h2").first().text());
    if (!webSearchScopes.has(scope)) {
      input.onPricingReconciliation?.({
        disposition: "unsupported",
        reason_code: "web_search_scope_unsupported",
        sample: scope,
      });
      continue;
    }
    result.push(...webSearchRate(input, body, scope, models, $.html(section)));
  }
  for (const scope of webSearchScopes)
    if (!sections.some((section) => text($(section).children("h2").first().text()) === scope))
      input.onPricingReconciliation?.({
        disposition: "unbound",
        reason_code: "web_search_model_scope_drift",
        sample: scope,
      });
  return result;
}

function imageSearchRates(
  input: ParseInput,
  body: string | undefined,
  models: Map<string, ProviderModel>,
  operation: "image_search" | "web_search_image",
): DashscopeToolRate[] {
  if (body === undefined) return [];
  const billing = toolBillingBody(body);
  const normalized = billing === undefined ? "" : documentText(billing);
  const ids = mentionedModelIds(body, new Set(models.keys()));
  if (ids.size === 0) {
    input.onPricingReconciliation?.({
      disposition: "unbound",
      reason_code: `${operation}_model_scope_unbound`,
    });
    return [];
  }
  const scopes = [
    ["Singapore", /Singapore region[^$]{0,120}\$([0-9][0-9,]*(?:\.[0-9]+)?)/i],
    [
      "China (Beijing)",
      /(?:China \(Beijing\)|North China 2 \(Beijing\))[^$]{0,120}\$([0-9][0-9,]*(?:\.[0-9]+)?)/i,
    ],
  ] as const;
  return scopes.flatMap(([scope, pattern]) => {
    const reverse =
      scope === "Singapore"
        ? /\$([0-9][0-9,]*(?:\.[0-9]+)?)\s+for deployments in the Singapore region/i
        : /\$([0-9][0-9,]*(?:\.[0-9]+)?)\s+for deployments in North China 2 \(Beijing\)/i;
    const amount = normalized.match(pattern)?.[1] ?? normalized.match(reverse)?.[1];
    const price = amount === undefined ? undefined : decimal(amount);
    if (price === undefined) {
      input.onPricingReconciliation?.({
        disposition: "unbound",
        reason_code: `${operation}_price_unbound`,
        sample: scope,
      });
      return [];
    }
    return [...ids].map((modelId) => {
      const rate = publishedRate(
        "image_search",
        price,
        "thousand_events",
        input.source.id,
        `USD per 1,000 ${operation.replaceAll("_", "-")} calls`,
        {
          region: scope,
          operation,
        },
      );
      input.onPricingReconciliation?.({
        disposition: "normalized",
        reason_code: `${operation}_rate_normalized`,
        sample: `${modelId}:${scope}`,
      });
      return { modelId, scope, rate };
    });
  });
}

function cacheModels(input: ParseInput, body: string | undefined): Map<string, Set<string>> {
  if (body === undefined) return new Map();
  if (markdownDocument(body)) {
    const lines = markdownProse(body).split(/\r?\n/);
    const result = new Map<string, Set<string>>();
    for (const mode of ["Explicit cache", "Implicit cache"] as const) {
      const start = lines.findIndex((line) => markdownSectionTitle(line) === mode);
      const next = lines.findIndex(
        (line, index) =>
          index > start &&
          ["Explicit cache", "Implicit cache"].includes(markdownSectionTitle(line) ?? ""),
      );
      const end = next < 0 ? lines.length : next;
      const supported = lines.findIndex(
        (line, index) =>
          index > start && index < end && markdownSectionTitle(line) === "Supported models",
      );
      if (start < 0 || supported < 0) {
        input.onPricingReconciliation?.({
          disposition: "unbound",
          reason_code: "cache_model_scope_drift",
          sample: mode,
        });
        continue;
      }
      let region: string | undefined;
      let deployment: string | undefined;
      let scopeKnown = true;
      let observedRegions = 0;
      for (const line of lines.slice(supported + 1, end)) {
        if (/^\s*<\/Tab>\s*$/.test(line)) {
          region = undefined;
          deployment = undefined;
          scopeKnown = true;
          continue;
        }
        const heading = markdownSectionTitle(line);
        if (heading !== undefined) {
          const candidate = dashscopeRegion(heading);
          if (candidate !== undefined) {
            region = candidate;
            deployment = undefined;
            scopeKnown = true;
            observedRegions += 1;
            continue;
          }
          if (/^#{1,3}\s+/.test(line)) break;
          region = undefined;
          continue;
        }
        if (region === undefined) continue;
        const content = text(
          load(markdownInlineText(line.replace(/^\s*[-*>]\s*/, "")).replaceAll("**", ""))
            .root()
            .text(),
        );
        const scopeLabel = (
          content.match(/^(.+?) scope:$/i)?.[1] ??
          content.match(
            /^The following models are available in the (.+?) deployment scope\.$/i,
          )?.[1]
        )?.replace(/\s+service deployment$/i, "");
        const scope = scopeLabel === "China (Hong Kong)" ? "Hong Kong (China)" : scopeLabel;
        if (scope !== undefined) {
          scopeKnown = [
            "Global",
            "International",
            "Chinese mainland",
            "EU",
            "Japan",
            "US",
            "Hong Kong (China)",
          ].includes(scope);
          deployment = scopeKnown ? scope : undefined;
          if (!scopeKnown)
            input.onPricingReconciliation?.({
              disposition: "unbound",
              reason_code: "cache_model_scope_drift",
              sample: `${mode}:${region}:${scope}`,
            });
          continue;
        }
        if (!scopeKnown) continue;
        const suffix = content.split(":").at(-1);
        if (suffix === undefined) continue;
        for (const candidate of suffix.split(",")) {
          const id = exactId(candidate);
          if (id === undefined) continue;
          const key = cacheScopeKey(mode, region, deployment);
          const values = result.get(key) ?? new Set<string>();
          values.add(id);
          result.set(key, values);
        }
      }
      if (observedRegions === 0)
        input.onPricingReconciliation?.({
          disposition: "unbound",
          reason_code: "cache_model_scope_drift",
          sample: `${mode}:regions`,
        });
    }
    return result;
  }
  const $ = load(body);
  const result = new Map<string, Set<string>>();
  for (const mode of ["Explicit cache", "Implicit cache"] as const) {
    const root = $("h2")
      .filter((_index, element) => text($(element).text()) === mode)
      .first()
      .parent("section");
    root
      .find("h2")
      .filter((_index, element) => text($(element).text()) !== mode)
      .each((_index, heading) => {
        const region = dashscopeRegion(text($(heading).text()));
        if (region === undefined) return;
        $(heading)
          .parent("section")
          .find("p")
          .each((_paragraphIndex, paragraph) => {
            const suffix = text($(paragraph).text()).split(":").at(-1);
            if (suffix === undefined) return;
            for (const candidate of suffix.split(",")) {
              const id = exactId(candidate);
              if (id === undefined) continue;
              const key = cacheScopeKey(mode, region);
              const values = result.get(key) ?? new Set<string>();
              values.add(id);
              result.set(key, values);
            }
          });
      });
  }
  return result;
}

function cacheScopeKey(mode: string, region: string, deployment = ""): string {
  return `${mode}\0${region}\0${deployment}`;
}

function cacheApplies(
  cache: ReadonlyMap<string, ReadonlySet<string>>,
  mode: string,
  id: string,
  rate: SourcePriceFact,
): boolean {
  const { region, deployment_scope } = rate.conditions;
  return (
    region !== undefined &&
    (cache.get(cacheScopeKey(mode, region))?.has(id) === true ||
      cache.get(cacheScopeKey(mode, region, deployment_scope))?.has(id) === true)
  );
}

function cacheExceptions(
  body: string | undefined,
  percentage: 10 | 20,
  knownIds: Set<string>,
): Map<string, string> {
  const ids = new Map<string, string>();
  if (body === undefined) return ids;
  for (const fragment of documentText(body).split(/[!?]|\.(?=\s|$)|\n+/)) {
    if (!new RegExp(`not\\s+${percentage}%`, "i").test(fragment)) continue;
    for (const id of mentionedModelIds(fragment, knownIds)) ids.set(id, fragment.slice(0, 4096));
  }
  return ids;
}

function cacheRate(
  input: SourcePriceFact,
  meterName: "cache_read_text" | "cache_write_text",
  factor: string,
  cacheMode: "explicit" | "implicit",
  ttl?: number,
): SourcePriceFact {
  return {
    ...input,
    meter: meterName,
    price: multiplyDecimal(input.price, factor),
    conditions: {
      ...input.conditions,
      cache_mode: cacheMode,
      ...(ttl === undefined ? {} : { cache_ttl_seconds: ttl }),
    },
    derived: true,
    derivation: `source input price × ${factor}`,
  };
}

function publishedCacheRead(
  model: ProviderModel,
  input: SourcePriceFact,
  mode: "explicit" | "implicit",
): boolean {
  const scope = {
    ...input.conditions,
    cache_mode: mode,
    ...(mode === "explicit" ? { cache_ttl_seconds: 300 } : {}),
  };
  return model.price_facts.some(
    (rate) =>
      rate.meter === "cache_read_text" &&
      !rate.derived &&
      rate.unit === input.unit &&
      rate.currency === input.currency &&
      Object.entries(rate.conditions).every(([key, value]) => {
        if (value === undefined) return true;
        const expected: unknown = Reflect.get(scope, key);
        if (key === "context_min_tokens")
          return typeof expected === "number" && typeof value === "number" && expected >= value;
        if (key === "context_max_tokens")
          return typeof expected === "number" && typeof value === "number" && expected <= value;
        return expected === value;
      }),
  );
}

function unknownCacheRead(
  model: ProviderModel,
  input: SourcePriceFact,
  mode: "explicit" | "implicit",
  fragment: string,
): void {
  model.raw_price_facts.push({
    term_key: "unpublished_cache_read",
    impact: "base_price",
    reason: "unknown_amount",
    conditions: {
      ...input.conditions,
      cache_mode: mode,
      ...(mode === "explicit" ? { cache_ttl_seconds: 300 } : {}),
    },
    source_ref: input.source_ref,
    raw: {
      fragment,
      meter: "cache_read_text",
      unit: input.raw_unit ?? input.unit,
      denomination: input.currency,
    },
  });
}

function billingItemQuotes(
  input: ParseInput,
  table: Table,
  row: Cell[],
  billingItem: string,
): SourceRawPricingFact[] {
  return table.headers.flatMap((header, index) => {
    const cell = row[index];
    if (!/price/i.test(header) || cell === undefined) return [];
    return priceSegments(cell, header).map((segment) => ({
      term_key: "unparsed_billing_item",
      impact: "base_price" as const,
      reason: "unsupported_structure" as const,
      conditions: { ...priceConditions(table, row, header), operation: billingItem },
      source_ref: input.source.id,
      raw: {
        label: billingItem,
        fragment: `${billingItem}; ${cell.text}`.slice(0, 4096),
        amount: segment.price,
        denomination: "USD",
        unit: `${header}; ${cell.text}`,
      },
    }));
  });
}

export function parseDashscopePricing(input: ParseInput): SourceParseResult {
  const extractor = input.source.extractor;
  if (extractor.kind !== "dashscope-pricing") throw new Error("Wrong DashScope pricing extractor");
  const bundle = linkedBundleSchema.parse(JSON.parse(input.body));
  const evidence = commercialEvidence(input, bundle);
  const cache = cacheModels(input, evidence.cacheBody);
  const models = new Map<string, ProviderModel>();
  const findings: string[] = [];
  let observedRows = 0;
  let coveredRows = 0;
  for (const table of pricingTables(bundle.index.body, (path) => findings.push(path))) {
    const idIndex = column(table.headers, /^(?:Model ID|Model name|Model)$/i);
    if (table.headers.some((header) => /price/i.test(header)))
      assertItemCount("DashScope pricing model column", idIndex === undefined ? 0 : 1, 1, 1);
    if (idIndex === undefined) continue;
    assertItemCount(
      "DashScope pricing price columns",
      table.headers.filter((header) => /price|^(?:Input|Output):/i.test(header)).length,
      1,
    );
    for (const row of table.rows) {
      if (row.length === 0 || (row.length > 1 && row.every((cell) => cell === row[0]))) continue;
      observedRows += 1;
      const idCell = row[idIndex];
      const stripPreview = (value: string) => value.replace(/\s*\(Invitational preview\)\s*$/i, "");
      const rowIds = cellIds(
        idCell === undefined
          ? undefined
          : {
              ...idCell,
              text: stripPreview(idCell.text),
              parts: idCell.parts.map(stripPreview),
            },
      );
      if (rowIds.length === 0) {
        input.onPricingReconciliation?.({
          disposition: "unsupported",
          reason_code: "pricing_model_identity_unsupported",
          sample: `${idCell?.text ?? "missing"} (${table.headings.join(" / ")})`.slice(0, 256),
        });
        continue;
      }
      coveredRows += 1;
      const discontinued = row.some((cell) => /\bDiscontinued\b/i.test(cell.text));
      const customQuote = row.some((cell) => /contact (?:sales|us)/i.test(cell.text));
      for (const id of rowIds) {
        const tasks = priceOperations(id, table.headings, table.headers);
        // A new operation column cannot disappear into an unconditional model rate.
        const billingItem = value(table, row, /^Billing item$/i);
        const parsed =
          billingItem === undefined
            ? rowPrices(input, table, row, tasks, id)
            : { rates: [], raw: billingItemQuotes(input, table, row, billingItem) };
        const parsedRates = parsed.rates;
        if (billingItem !== undefined)
          input.onPricingReconciliation?.({
            disposition: "unsupported",
            reason_code: "pricing_billing_item_unsupported",
            sample: `${id}:${billingItem}`.slice(0, 256),
          });
        const modelRates = discontinued ? [] : parsedRates;
        if (discontinued) {
          input.onPricingReconciliation?.({
            disposition: "explicit_non_numeric",
            reason_code: "discontinued_price_not_applicable",
            sample: id,
          });
          if (parsedRates.length > 0)
            input.onPricingReconciliation?.({
              disposition: "ambiguous",
              reason_code: "discontinued_price_conflict",
              sample: id,
            });
        } else if (modelRates.length === 0 && !customQuote)
          input.onPricingReconciliation?.({
            disposition: "unbound",
            reason_code: "model_price_unbound",
            sample: id,
          });
        else
          for (const rate of modelRates)
            input.onPricingReconciliation?.({
              disposition: "normalized",
              reason_code: "price_fact_normalized",
              sample: `${id}:${rate.meter}:${rate.conditions.region ?? "all"}`,
            });
        const model = baseModel({
          providerId: input.provider.id,
          id,
          name: id,
          sourceId: input.source.id,
          observedAt: input.observedAt,
        });
        const regions = unique(
          modelRates.flatMap(({ conditions }) =>
            conditions.region === undefined ? [] : [conditions.region],
          ),
        );
        add(
          models,
          {
            ...model,
            aliases: equivalentIds(idCell),
            tasks,
            modalities: priceModalities(tasks, modelRates, table.headings),
            status: discontinued ? "retired" : "active",
            release_stage: /preview/i.test(`${id} ${idCell?.text ?? ""}`) ? "preview" : "unknown",
            pricing_state: discontinued
              ? "not_applicable"
              : modelRates.length > 0
                ? "numeric"
                : customQuote
                  ? "custom_quote"
                  : "unknown",
            price_facts: modelRates,
            raw_price_facts: discontinued ? [] : parsed.raw,
            availability:
              regions.length === 0
                ? undefined
                : regions.map((region) => ({ region, deployment_type: "model_api" })),
            scope: "regional_catalog",
          },
          (field) =>
            input.onPricingReconciliation?.({
              disposition: "ambiguous",
              reason_code: "pricing_claim_conflict",
              sample: `${id}:${field}`,
            }),
        );
      }
    }
  }
  assertCoverage("DashScope pricing model rows", coveredRows, observedRows, 1);
  const commercialFacts = [
    ...extractDashscopeWebSearchFacts(
      models,
      input.source.id,
      webSearchRates(input, evidence.webSearchBody, models),
    ),
    ...extractDashscopeImageSearchFacts(
      models,
      input.source.id,
      imageSearchRates(input, evidence.imageSearchBody, models, "image_search"),
    ),
    ...extractDashscopeTextToImageSearchFacts(
      models,
      input.source.id,
      imageSearchRates(input, evidence.textToImageSearchBody, models, "web_search_image"),
    ),
  ];
  for (const [key, idsForRegion] of cache) {
    const [mode = "", region = "", deployment = ""] = key.split("\0");
    for (const id of idsForRegion) {
      const current = models.get(id);
      const hasBaseRate = current?.price_facts.some(
        (item) =>
          item.meter === "input_text" &&
          item.conditions.region === region &&
          (deployment === "" || item.conditions.deployment_scope === deployment) &&
          item.conditions.promotion !== true &&
          item.conditions.service_tier === undefined,
      );
      if (hasBaseRate !== true)
        input.onPricingReconciliation?.({
          disposition: "unbound",
          reason_code: "cache_base_price_not_bound",
          sample: `${id}:${mode}:${region}`,
        });
      const model = baseModel({
        providerId: input.provider.id,
        id,
        name: id,
        sourceId: input.source.id,
        observedAt: input.observedAt,
      });
      add(
        models,
        {
          ...model,
          tasks: current?.tasks ?? ["text_generation"],
          modalities: current?.modalities ?? { input: ["text"], output: ["text"] },
          capabilities: { ...model.capabilities, prompt_cache: true },
          status: current?.status ?? "active",
          release_stage: current?.release_stage ?? (/preview/i.test(id) ? "preview" : "unknown"),
          availability: [{ region, deployment_type: "model_api" }],
          scope: "regional_catalog",
        },
        (field) =>
          input.onPricingReconciliation?.({
            disposition: "ambiguous",
            reason_code: "pricing_claim_conflict",
            sample: `${id}:${field}`,
          }),
      );
    }
  }
  const explicitExceptions = cacheExceptions(evidence.cacheBody, 10, new Set(models.keys()));
  const implicitExceptions = cacheExceptions(evidence.cacheBody, 20, new Set(models.keys()));
  for (const [id, model] of models) {
    if (!evidence.cacheRates) continue;
    const baseRates = model.price_facts.filter(
      (item) =>
        item.meter === "input_text" &&
        item.conditions.promotion !== true &&
        item.conditions.service_tier === undefined,
    );
    const derived: SourcePriceFact[] = [];
    for (const item of baseRates) {
      const region = item.conditions.region;
      if (region === undefined) continue;
      if (cacheApplies(cache, "Explicit cache", id, item)) {
        const rates = [cacheRate(item, "cache_write_text", "1.25", "explicit", 300)];
        const exception = explicitExceptions.get(id);
        if (!publishedCacheRead(model, item, "explicit")) {
          if (exception !== undefined) {
            unknownCacheRead(model, item, "explicit", exception);
            input.onPricingReconciliation?.({
              disposition: "raw",
              reason_code: "explicit_cache_price_not_public",
              sample: `${id}:${region}`,
            });
          } else rates.push(cacheRate(item, "cache_read_text", "0.1", "explicit", 300));
        }
        derived.push(...rates);
        for (const rate of rates)
          input.onPricingReconciliation?.({
            disposition: "normalized",
            reason_code: "cache_rate_normalized",
            sample: `${id}:${rate.meter}:${region}`,
          });
      }
      if (cacheApplies(cache, "Implicit cache", id, item)) {
        if (publishedCacheRead(model, item, "implicit")) continue;
        const exception = implicitExceptions.get(id);
        if (exception !== undefined) {
          unknownCacheRead(model, item, "implicit", exception);
          input.onPricingReconciliation?.({
            disposition: "raw",
            reason_code: "implicit_cache_price_not_public",
            sample: `${id}:${region}`,
          });
          continue;
        }
        const rate = cacheRate(item, "cache_read_text", "0.2", "implicit");
        derived.push(rate);
        input.onPricingReconciliation?.({
          disposition: "normalized",
          reason_code: "cache_rate_normalized",
          sample: `${id}:${rate.meter}:${region}`,
        });
      }
    }
    if (derived.length > 0)
      models.set(id, merge(model, { ...model, pricing_state: "numeric", price_facts: derived }));
  }
  const pricingInputs = extractDashscopePricingInputs(
    bundle.documents,
    input.source.id,
    input.onContractFinding,
    input.onPricingReconciliation,
  );
  if (findings.length > 0) input.onContractFinding?.(contractExtensionEvidence(findings));
  return {
    models: bounded(models, 1, extractor.maxModels, "DashScope pricing"),
    commercial_facts: commercialFacts,
    pricing_inputs: pricingInputs,
  };
}

function lifecycleOperations(category: string, id: string): ModelTask[] {
  const evidence = `${category} ${id}`.toLowerCase();
  if (/rerank|重排序/.test(evidence)) return ["reranking"];
  if (/embedding|向量/.test(evidence)) return ["embeddings"];
  if (/image|图片|图像/.test(evidence)) return ["image_generation"];
  if (/video|视频/.test(evidence)) return ["video_generation"];
  if (/tts|cosyvoice|语音合成/.test(evidence)) return ["speech_synthesis"];
  if (/asr|paraformer|语音识别/.test(evidence)) return ["transcription"];
  if (/livetranslate|translation|翻译/.test(evidence)) return ["translation"];
  if (/speech[- ]to[- ]speech|(?:audio|omni).*realtime|语音对话/.test(evidence))
    return ["speech_to_speech"];
  if (/ocr/.test(evidence)) return ["ocr"];
  return ["text_generation"];
}

function modelDate(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const exact = raw.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (exact?.[1] !== undefined && exact[2] !== undefined && exact[3] !== undefined) {
    const candidate = `${exact[1]}-${exact[2]}-${exact[3]}`;
    if (z.iso.date().safeParse(candidate).success) return candidate;
  }
  const chinese = raw.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (chinese?.[1] !== undefined && chinese[2] !== undefined && chinese[3] !== undefined) {
    const candidate = `${chinese[1]}-${chinese[2].padStart(2, "0")}-${chinese[3].padStart(2, "0")}`;
    if (z.iso.date().safeParse(candidate).success) return candidate;
  }
  const months = [
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
  ];
  const match = raw.match(new RegExp(`(${months.join("|")}) (\\d{1,2}), (\\d{4})`, "i"));
  if (match?.[1] === undefined || match[2] === undefined || match[3] === undefined)
    return undefined;
  const month = months.findIndex((value) => value.toLowerCase() === match[1]?.toLowerCase()) + 1;
  const candidate = `${match[3]}-${String(month).padStart(2, "0")}-${match[2].padStart(2, "0")}`;
  return z.iso.date().safeParse(candidate).success ? candidate : undefined;
}

function documentBodies(body: string): string[] {
  const bundle = linkedBundleSchema.parse(JSON.parse(body));
  return [bundle.index.body, ...bundle.documents.map((document) => document.body)];
}

export function parseDashscopeLifecycle(input: ParseInput): SourceParseResult {
  const extractor = input.source.extractor;
  if (extractor.kind !== "dashscope-lifecycle")
    throw new Error("Wrong DashScope lifecycle extractor");
  const models = new Map<string, ProviderModel>();
  const findings: string[] = [];
  for (const [documentIndex, body] of documentBodies(input.body).entries()) {
    for (const [tableIndex, table] of tables(body).entries()) {
      const modelColumn = column(table.headers, /^(?:Model name|模型(?:名称| ?ID))$/i);
      const replacementColumn = column(table.headers, /^(?:Replacement model|替代模型)$/i);
      if (modelColumn === undefined) continue;
      for (const [rowIndex, row] of table.rows.entries()) {
        const path = `/documents/${documentIndex}/tables/${tableIndex}/rows/${rowIndex}`;
        if (row.length !== table.headers.length) {
          findings.push(path);
          continue;
        }
        const category = value(table, row, /^(?:Category|类别|模型类型)$/i) ?? "";
        const retiredAt = modelDate(
          value(table, row, /^(?:Deprecation time|Retirement date|下线(?:时间|日期))$/i),
        );
        if (retiredAt === undefined) {
          findings.push(`${path}/retired_at`);
          continue;
        }
        const ids = cellIds(row[modelColumn]);
        if (ids.length === 0) {
          findings.push(`${path}/model`);
          continue;
        }
        const replacements = replacementColumn === undefined ? [] : cellIds(row[replacementColumn]);
        for (const id of ids) {
          const model = baseModel({
            providerId: input.provider.id,
            id,
            name: id,
            sourceId: input.source.id,
            observedAt: input.observedAt,
          });
          add(models, {
            ...model,
            tasks: lifecycleOperations(category, id),
            status: retiredAt <= input.observedAt.slice(0, 10) ? "retired" : "deprecated",
            retired_at: retiredAt,
            replacement_model_ids: replacements,
            pricing_state: "unknown",
            scope: "regional_catalog",
          });
        }
      }
    }
  }
  if (findings.length > 0) input.onContractFinding?.(contractExtensionEvidence(findings));
  return {
    models: bounded(models, extractor.minModels, extractor.maxModels, "DashScope lifecycle"),
  };
}

export function parseDashscopeReleases(input: ParseInput): SourceParseResult {
  const extractor = input.source.extractor;
  if (extractor.kind !== "dashscope-releases")
    throw new Error("Wrong DashScope releases extractor");
  const dates = new Map<string, string>();
  const findings: string[] = [];
  for (const [documentIndex, body] of documentBodies(input.body).entries()) {
    for (const [tableIndex, table] of tables(body).entries()) {
      const timeColumn = column(table.headers, /^(?:Time|Date|时间)$/i);
      const modelColumn = column(table.headers, /^(?:Model|Model ID|模型 ?ID)$/i);
      if (timeColumn === undefined || modelColumn === undefined) continue;
      for (const [rowIndex, row] of table.rows.entries()) {
        const path = `/documents/${documentIndex}/tables/${tableIndex}/rows/${rowIndex}`;
        const parsedDate = z.iso.date().safeParse(row[timeColumn]?.text);
        if (!parsedDate.success) {
          findings.push(`${path}/release_date`);
          continue;
        }
        const rowIds = cellIds(row[modelColumn]);
        const recoveredRowIds =
          rowIds.length === 0 && row.length === table.headers.length - 1 && modelColumn > 0
            ? cellIds(row[modelColumn - 1])
            : rowIds;
        if (recoveredRowIds.length === 0) {
          findings.push(`${path}/model`);
          continue;
        }
        for (const id of recoveredRowIds) {
          const current = dates.get(id);
          if (current === undefined || parsedDate.data < current) dates.set(id, parsedDate.data);
        }
      }
    }
  }
  if (findings.length > 0) input.onContractFinding?.(contractExtensionEvidence(findings));
  const models = new Map<string, ProviderModel>();
  for (const [id, releaseDate] of dates) {
    const model = baseModel({
      providerId: input.provider.id,
      id,
      name: id,
      sourceId: input.source.id,
      observedAt: input.observedAt,
    });
    models.set(id, {
      ...model,
      release_date: releaseDate,
      scope: "regional_catalog",
    });
  }
  return {
    models: bounded(models, extractor.minModels, extractor.maxModels, "DashScope releases"),
  };
}

export function parseDashscopeApi(input: ParseInput): SourceParseResult {
  const extractor = input.source.extractor;
  if (extractor.kind !== "dashscope-api") throw new Error("Wrong DashScope API extractor");
  const page = deploymentPageSchema.parse(JSON.parse(input.body)).output;
  if (page.total > page.page_size || page.models.length !== page.total)
    throw new Error("DashScope deployable-model pagination is incomplete");
  const items = recognizeItems({
    label: "DashScope deployable model",
    items: page.models,
    schema: deploymentModelSchema,
    modelId: "model_name",
    skipInvalidItems: true,
    ...(input.onContractFinding === undefined ? {} : { onFinding: input.onContractFinding }),
  });
  const models = new Map<string, ProviderModel>();
  const findings: string[] = [];
  for (const item of items) {
    const plans = item.plans.flatMap((plan, index) => {
      const parsed = deploymentPlanSchema.safeParse(plan);
      if (parsed.success) return [parsed.data.plan];
      findings.push(`/models/${item.model_name}/plans/${index}`);
      return [];
    });
    if (plans.length === 0) continue;
    const model = baseModel({
      providerId: input.provider.id,
      id: item.model_name,
      name: item.model_name,
      sourceId: input.source.id,
      observedAt: input.observedAt,
    });
    add(models, {
      ...model,
      availability: unique(plans).map((plan) => ({
        region: "Singapore",
        deployment_type: plan,
      })),
      scope: "runtime_observation",
    });
  }
  if (findings.length > 0) input.onContractFinding?.(contractExtensionEvidence(findings));
  return { models: bounded(models, extractor.minModels, extractor.maxModels, "DashScope API") };
}
