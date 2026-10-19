import { publishedRate } from "./pricing.ts";
import type { SourcePriceFact, SourceRawPricingFact } from "./pricing-source.ts";

export type AnthropicPriceKind = "base" | "batch" | "fast";
interface Column {
  header: string;
  meter: SourcePriceFact["meter"];
  ttl?: number;
}
const columns: Record<AnthropicPriceKind, readonly Column[]> = {
  base: [
    { header: "base input tokens", meter: "input_text" },
    { header: "5m cache writes", meter: "cache_write_text", ttl: 300 },
    { header: "1h cache writes", meter: "cache_write_text", ttl: 3600 },
    { header: "cache hits and refreshes", meter: "cache_read_text" },
    { header: "output tokens", meter: "output_text" },
  ],
  batch: [
    { header: "batch input", meter: "input_text" },
    { header: "batch output", meter: "output_text" },
  ],
  fast: [
    { header: "input", meter: "input_text" },
    { header: "output", meter: "output_text" },
  ],
};

function columnName(header: string): string {
  return header.toLowerCase().replaceAll(" & ", " and ");
}

export function anthropicPriceKind(headers: readonly string[]): AnthropicPriceKind | undefined {
  const names = headers.map(columnName);
  if (names[0] !== "model") return;
  if (
    names.includes("base input tokens") ||
    names.filter((name) => columns.base.some(({ header }) => header === name)).length >= 2
  )
    return "base";
  if (names.includes("batch input")) return "batch";
  if (names.includes("input") && names.includes("output")) return "fast";
}

export function anthropicPriceRow(
  kind: AnthropicPriceKind,
  headers: readonly string[],
  values: readonly string[],
  conditions: SourcePriceFact["conditions"],
  validScope: boolean,
  sourceId: string,
) {
  const rates: SourcePriceFact[] = [];
  const raw: SourceRawPricingFact[] = [];
  const reviewed = columns[kind];
  const names = headers.map(columnName);
  const shape = headers.length === values.length;
  const addRaw = (
    column: Column | undefined,
    header: string,
    value: string,
    reason: SourceRawPricingFact["reason"],
  ) => {
    raw.push({
      term_key: `unparsed:${column?.meter ?? "pricing-column"}${column?.ttl === undefined ? "" : ":" + column.ttl}`,
      impact: "base_price",
      reason,
      conditions: {
        ...conditions,
        ...(column?.ttl === undefined ? {} : { cache_ttl_seconds: column.ttl }),
      },
      source_ref: sourceId,
      raw: {
        label: `${values[0] ?? ""} / ${header}`,
        ...(column === undefined ? {} : { meter: column.meter }),
        ...(reason === "unsupported_structure"
          ? { fragment: `${headers.join(" | ")}\n${values.join(" | ")}`.slice(0, 4096) }
          : {
              amount: value,
              unit: / \/ MTok(?:\d+)?$/.test(value) ? "MTok" : value,
              ...(value.startsWith("$")
                ? { denomination: value.match(/^\$[\d.]+ ([A-Z]{3}) \/ /)?.[1] ?? "USD" }
                : {}),
            }),
      },
    });
  };
  if (!shape) {
    addRaw(undefined, headers.join(" | "), values.join(" | "), "unsupported_structure");
    return { rates, raw };
  }
  for (let index = 1; index < headers.length; index += 1) {
    const header = headers[index] ?? "";
    const column = reviewed.find(({ header }) => header === names[index]);
    const value = values[index] ?? "";
    const amount = value.match(/^\$((?:0|[1-9]\d*)(?:\.\d+)?)(?: USD)? \/ MTok(?:\d+)?$/)?.[1];
    if (column !== undefined && amount !== undefined && validScope) {
      rates.push(
        publishedRate(column.meter, amount, "million_tokens", sourceId, "MTok", {
          ...conditions,
          ...(column.ttl === undefined ? {} : { cache_ttl_seconds: column.ttl }),
        }),
      );
    } else
      addRaw(
        column,
        header,
        value,
        !validScope
          ? "unknown_applicability"
          : column === undefined
            ? "unknown_meter"
            : !/ \/ MTok(?:\d+)?$/.test(value)
              ? "unknown_unit"
              : !value.startsWith("$")
                ? "unknown_denomination"
                : "unknown_amount",
      );
  }
  for (const column of reviewed)
    if (!names.includes(column.header))
      addRaw(column, headers.join(" | "), values.join(" | "), "unsupported_structure");
  return { rates, raw };
}
