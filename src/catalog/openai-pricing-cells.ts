import { publishedRate } from "./pricing.ts";
import type { PricingReconciliationItem } from "./pricing-reconciliation.ts";
import type { SourcePriceFact, SourceRawPricingFact } from "./pricing-source.ts";
import type { ModelTask } from "./schema.ts";
import { openAiTextQuantity } from "./openai-commercial-source.ts";

export type OpenAiPricingTier = "standard" | "batch" | "flex" | "fast" | "ultrafast";
export interface OpenAiPricingTable {
  section: string;
  tier?: OpenAiPricingTier;
  headers: string[];
  rows: string[][];
}
export interface OpenAiPricingCell {
  label: string;
  value: string;
  meter?: SourcePriceFact["meter"];
  unit?: SourcePriceFact["unit"];
  rawUnit: string;
  textTokens?: boolean;
  conditions: SourcePriceFact["conditions"];
  excluded?: "commercial_fact_outside_invocation_scope" | "price_estimate_not_billing_basis";
}
export interface OpenAiPricingClaim {
  item: PricingReconciliationItem;
  rate?: SourcePriceFact;
  raw?: SourceRawPricingFact;
}

export function parseOpenAiPricingCell(
  cell: OpenAiPricingCell,
  sourceId: string,
): OpenAiPricingClaim {
  const sample = (cell.label + ": " + cell.value).slice(0, 256);
  const item = (disposition: PricingReconciliationItem["disposition"], reason_code: string) => ({
    disposition,
    reason_code,
    sample,
  });
  if (cell.excluded !== undefined) return { item: item("excluded", cell.excluded) };
  if (cell.value === "-" || cell.value === "")
    return { item: item("excluded", "pricing_cell_not_quoted") };
  const amount =
    cell.value === "Free"
      ? "0"
      : cell.value.match(/^\$((?:0|[1-9]\d*)(?:\.\d+)?)(?: \/ (?:minute|1M characters))?$/)?.[1];
  const unitAgrees = cell.value.endsWith(" / minute")
    ? cell.unit === "minute"
    : cell.value.endsWith(" / 1M characters")
      ? cell.unit === "million_characters"
      : true;
  if (amount !== undefined && cell.meter !== undefined && cell.unit !== undefined && unitAgrees) {
    const rate = publishedRate(
      cell.meter,
      amount,
      cell.unit,
      sourceId,
      cell.rawUnit,
      cell.conditions,
    );
    if (cell.value === "Free") rate.raw_price = "Free";
    const quantity =
      cell.textTokens === true && cell.unit === "million_tokens"
        ? openAiTextQuantity(cell.meter)
        : undefined;
    if (quantity !== undefined)
      rate.charge_binding = {
        signal: quantity.signal,
        aggregation: "request",
        observations: [
          {
            source_ref: sourceId,
            locator: { kind: "table", value: `Text tokens: ${cell.label}` },
            raw: { label: `Text tokens: ${cell.label}`, amount: cell.value, unit: cell.rawUnit },
          },
        ],
      };
    return {
      rate,
      item: item(
        cell.value === "Free" ? "explicit_non_numeric" : "normalized",
        cell.value === "Free" ? "free_pricing_cell_bound" : "pricing_cell_bound",
      ),
    };
  }
  return {
    raw: {
      term_key:
        "unparsed:" +
        (cell.meter ??
          cell.label
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .slice(0, 80)),
      impact: "base_price",
      reason:
        cell.meter === undefined
          ? "unknown_meter"
          : cell.unit === undefined || !unitAgrees
            ? "unknown_unit"
            : "unknown_amount",
      conditions: cell.conditions,
      source_ref: sourceId,
      raw: {
        label: cell.label,
        amount: cell.value,
        meter: cell.meter ?? cell.label,
        unit: cell.rawUnit,
        ...(cell.value.startsWith("$") ? { denomination: "USD" } : {}),
      },
    },
    item: item("raw", "unsupported_pricing_cell_preserved"),
  };
}

function missing(value: string): boolean {
  return value === "" || value === "-";
}

const modalityMeters = new Map<string, readonly SourcePriceFact["meter"][]>([
  ["Text", ["input_text", "cache_read_text", "output_text"]],
  ["Audio", ["input_audio", "cache_read_audio", "output_audio"]],
  ["Image", ["input_image", "cache_read_image", "output_image"]],
]);

export function openAiModelPriceCells(
  table: OpenAiPricingTable,
  row: readonly string[],
  tasks: readonly ModelTask[],
): OpenAiPricingCell[] | undefined {
  const cell = (header: string) => row[table.headers.indexOf(header)] ?? "";
  const conditions = { service_tier: table.tier ?? "standard" };
  const make = (
    label: string,
    meter: SourcePriceFact["meter"] | undefined,
    unit: SourcePriceFact["unit"] | undefined = "million_tokens",
    scope: SourcePriceFact["conditions"] = conditions,
  ): OpenAiPricingCell => {
    const value = cell(label);
    return {
      label,
      value,
      ...(meter === undefined ? {} : { meter }),
      ...(unit === undefined ? {} : { unit }),
      conditions: scope,
      rawUnit:
        unit === "million_tokens"
          ? "per 1M tokens"
          : unit === "million_characters"
            ? "per 1M characters"
            : unit === undefined
              ? label
              : "per " + unit,
    };
  };
  const headers = table.headers.join("|");
  if (table.section === "GPT-Live sessions" && headers === "Model|Price per minute")
    return [make("Price per minute", "session_runtime", "minute", {})];
  if (headers.startsWith("Model|Short context input|")) {
    return table.headers.slice(1).map((header) => {
      const match = header.match(
        /^(?:(Short|Long) context )?(input|cached input|cache writes|output)$/,
      );
      const meter =
        match?.[2] === "input"
          ? "input_text"
          : match?.[2] === "cached input"
            ? "cache_read_text"
            : match?.[2] === "cache writes"
              ? "cache_write_text"
              : match?.[2] === "output"
                ? "output_text"
                : undefined;
      const context =
        match?.[1] === undefined
          ? {}
          : match[1] === "Short"
            ? { context_max_tokens: 272000 }
            : { context_min_tokens: 272001 };
      return make(header, meter, meter === undefined ? undefined : "million_tokens", {
        ...conditions,
        ...context,
      });
    });
  }
  if (
    headers === "Model|Modality|Input|Cached input|Output" ||
    headers === "Model|Modality|Input|Cached input|Output / cost"
  ) {
    const modality = cell("Modality");
    return [
      "Input",
      "Cached input",
      table.headers.includes("Output") ? "Output" : "Output / cost",
    ].map((header, index) => {
      const duration = cell(header).endsWith(" / minute");
      const characters = cell(header).endsWith(" / 1M characters");
      const meter = !modalityMeters.has(modality)
        ? undefined
        : duration
          ? tasks.some((task) => task === "transcription" || task === "translation")
            ? "input_audio"
            : "output_audio"
          : characters
            ? "output_audio"
            : modalityMeters.get(modality)?.[index];
      return {
        ...make(
          header,
          meter,
          duration ? "minute" : characters ? "million_characters" : "million_tokens",
        ),
        ...(modality === "Text" && !duration && !characters ? { textTokens: true } : {}),
      };
    });
  }
  if (headers === "Model|Size|Portrait|Landscape|Price per second")
    return [
      make("Price per second", "video_generation", "second", {
        ...conditions,
        resolution: cell("Size"),
      }),
    ];
  if (headers === "Model|Use case|Input|Output|Estimated cost") {
    const native = !missing(cell("Input")) || !missing(cell("Output"));
    return [
      make("Input", "input_audio"),
      make("Output", "output_audio"),
      {
        ...make("Estimated cost", "input_audio", "minute"),
        ...(native ? { excluded: "price_estimate_not_billing_basis" as const } : {}),
      },
    ];
  }
  if (headers === "Category|Model|Input|Cached input|Output")
    return [
      make("Input", cell("Category") === "Embedding" ? "embedding" : "input_text"),
      make("Cached input", "cache_read_text"),
      make("Output", "output_text"),
    ];
  if (
    table.section === "Finetuning" &&
    ["Model", "Training", "Input", "Cached input", "Output"].every((header) =>
      table.headers.includes(header),
    )
  ) {
    const dataSharing = cell("Model").endsWith(" (data sharing)");
    const scope = { ...conditions, account_eligibility: dataSharing ? "data_sharing" : "default" };
    return [
      { ...make("Training", undefined), excluded: "commercial_fact_outside_invocation_scope" },
      make("Input", "input_text", "million_tokens", scope),
      make("Cached input", "cache_read_text", "million_tokens", scope),
      make("Output", "output_text", "million_tokens", scope),
    ];
  }
  return undefined;
}
