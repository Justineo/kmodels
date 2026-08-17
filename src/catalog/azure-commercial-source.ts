import { load } from "cheerio";
import { z } from "zod";
import { htmlText } from "./html.ts";
import type { PricingReconciliationItem } from "./pricing-reconciliation.ts";
import type {
  SourceCommercialPricingFact,
  SourcePriceFact,
  SourceRawPricingFact,
} from "./pricing-source.ts";

interface Input {
  documents: readonly { url: string; body: string }[];
  sourceId: string;
  region: (value: string) => string | undefined;
  onPricingReconciliation?: (item: PricingReconciliationItem) => void;
}

interface PriceRow {
  table: string;
  row: string;
  header: string;
  amountContext: string;
  segment: string;
  regional: Record<string, string>;
  locator: string;
}

interface RateSpec {
  key: string;
  name: string;
  meter: SourcePriceFact["meter"];
  unit: SourcePriceFact["unit"];
}

type MutableFact = Omit<SourceCommercialPricingFact, "source_ref">;
type LoadedDocument = ReturnType<typeof load>;
type Selection = ReturnType<LoadedDocument>;

const amountSchema = z.object({
  regional: z.record(
    z.string().min(1),
    z.union([z.string(), z.number().finite().nonnegative()]).transform(String),
  ),
});

export function azureCommercialFacts(input: Input): SourceCommercialPricingFact[] {
  const facts = new Map<string, MutableFact>();
  for (const document of input.documents) {
    const url = new URL(document.url);
    if (url.pathname !== "/en-us/pricing/details/azure-openai/") continue;
    for (const row of priceRows(url, document.body, input)) {
      const text = `${row.table} ${row.row} ${row.header} ${row.segment}`;
      if (/\b(?:storage|vector-storage)\b/i.test(text)) {
        input.onPricingReconciliation?.({
          disposition: "excluded",
          reason_code: "commercial_fact_outside_gateway_boundary",
          sample: sample(row),
        });
        continue;
      }
      const spec = rateSpec(text, row.amountContext);
      if (spec === undefined) {
        addRawFact(facts, row, input);
        continue;
      }
      let normalized = false;
      for (const [rawRegion, amount] of Object.entries(row.regional)) {
        const region = input.region(rawRegion);
        if (region === undefined) {
          input.onPricingReconciliation?.({
            disposition: "unsupported",
            reason_code: "commercial_region_unsupported",
            sample: `${sample(row)} / ${rawRegion}`.slice(0, 256),
          });
          continue;
        }
        const fact = getFact(facts, spec);
        fact.price_facts.push({
          meter: spec.meter,
          price: amount,
          currency: "USD",
          unit: spec.unit,
          conditions: { region },
          source_ref: input.sourceId,
          source_locator: { kind: "table", value: row.locator },
          derived: false,
          raw_price: amount,
          raw_unit: `${row.header} ${row.segment}`.trim(),
        });
        normalized = true;
      }
      if (normalized)
        input.onPricingReconciliation?.({
          disposition: "normalized",
          reason_code: "request_component_price_bound",
          sample: sample(row),
        });
    }
  }
  return [...facts.values()].map((fact) => ({ source_ref: input.sourceId, ...fact }));
}

function priceRows(url: URL, body: string, input: Input): PriceRow[] {
  const $ = load(body);
  const rows: PriceRow[] = [];
  for (const table of $("table").toArray()) {
    const tableLabel =
      $(table).attr("aria-label") ??
      htmlText($(table).closest("section").find("h2").first().text());
    if (!/built-in tools/i.test(tableLabel)) continue;
    const headers = $(table)
      .find("thead tr")
      .first()
      .find("th")
      .map((_index, header) => htmlText($(header).text()))
      .get();
    for (const row of $(table).find("tbody tr").toArray()) {
      const cells = $(row).find("td").toArray();
      const rowLabel = htmlText($(cells[0]).text());
      for (const [cellIndex, cell] of cells.entries()) {
        const header = headers[cellIndex] ?? "";
        for (const element of $(cell).find("[data-amount]").toArray()) {
          const raw = $(element).attr("data-amount");
          const regional = raw === undefined ? undefined : parseAmount(raw);
          if (regional === undefined) {
            input.onPricingReconciliation?.({
              disposition: "unsupported",
              reason_code: "commercial_amount_unreadable",
              sample: [tableLabel, rowLabel, header].filter(Boolean).join(" / ").slice(0, 256),
            });
            continue;
          }
          const amountContext = localAmountContext($, $(element));
          const segment = htmlText($(element).parent().text());
          rows.push({
            table: tableLabel,
            row: rowLabel,
            header,
            amountContext,
            segment,
            regional,
            locator: [url.href, tableLabel, rowLabel, header, amountContext, segment]
              .filter(Boolean)
              .join(" / ")
              .slice(0, 512),
          });
        }
      }
    }
  }
  return rows;
}

function localAmountContext($: LoadedDocument, element: Selection): string {
  const target = element.get(0);
  if (target === undefined) return "";
  const parent = element.parent();
  const index = parent
    .find("[data-amount]")
    .toArray()
    .findIndex((amount) => amount === target);
  if (index < 0) return "";
  const clone = parent.clone();
  clone.find("[data-amount]").each((amountIndex, amount) => {
    $(amount).replaceWith(` __KMODELS_AMOUNT_${amountIndex}__ `);
  });
  return htmlText(clone.text()).split(/__KMODELS_AMOUNT_\d+__/u)[index] ?? "";
}

function parseAmount(raw: string): Record<string, string> | undefined {
  try {
    const result = amountSchema.safeParse(JSON.parse(raw));
    return result.success ? result.data.regional : undefined;
  } catch {
    return;
  }
}

function rateSpec(text: string, amountContext: string): RateSpec | undefined {
  if (/file search tool call/i.test(text))
    return {
      key: "responses-file-search",
      name: "Responses File Search",
      meter: "file_search",
      unit: "thousand_requests",
    };
  if (/code interpreter/i.test(text))
    return {
      key: "responses-code-interpreter",
      name: "Responses Code Interpreter",
      meter: "code_execution",
      unit: "session",
    };
  if (/web search/i.test(text))
    return {
      key: "responses-web-search",
      name: "Responses Web Search",
      meter: "web_search",
      unit: /\b(?:1k|1,000|thousand)\b/i.test(text) ? "thousand_requests" : "request",
    };
  if (/computer use/i.test(text)) {
    const direction = amountContext || text;
    const input = /\binput\b/i.test(direction);
    const output = /\boutput\b/i.test(direction);
    if (input === output) return;
    return {
      key: "computer-use",
      name: "Computer Use",
      meter: output ? "output_text" : "input_text",
      unit: "million_tokens",
    };
  }
}

function getFact(facts: Map<string, MutableFact>, spec: RateSpec): MutableFact {
  const current = facts.get(spec.key);
  if (current !== undefined) return current;
  const created: MutableFact = {
    book_key: `service:${spec.key}`,
    book_name: spec.name,
    resource_kind: "service",
    resource_key: spec.key,
    model_refs: [],
    offer_key: "usage",
    offer_name: spec.name,
    billing_mode: "usage",
    pricing_state: "numeric",
    price_facts: [],
    raw_price_facts: [],
  };
  facts.set(spec.key, created);
  return created;
}

function addRawFact(facts: Map<string, MutableFact>, row: PriceRow, input: Input): void {
  const key = `unclassified-built-in:${slug(row.row)}`;
  const created: MutableFact = {
    book_key: `service:${key}`,
    book_name: `Unclassified built-in tool: ${row.row}`,
    resource_kind: "service" as const,
    resource_key: key,
    model_refs: [],
    offer_key: "usage",
    offer_name: row.row,
    billing_mode: "usage" as const,
    pricing_state: "not_published" as const,
    price_facts: [],
    raw_price_facts: [],
  };
  const current = facts.get(key) ?? created;
  const amount = [...new Set(Object.values(row.regional))].join(", ");
  current.raw_price_facts.push(rawFact(row, input.sourceId, amount));
  facts.set(key, current);
  input.onPricingReconciliation?.({
    disposition: "raw",
    reason_code: "request_component_price_unclassified",
    sample: sample(row),
  });
}

function rawFact(row: PriceRow, sourceRef: string, amount: string): SourceRawPricingFact {
  return {
    term_key: slug(`${row.row}-${row.header}-${row.segment}`),
    impact: "base_price",
    reason: "unknown_meter",
    conditions: {},
    source_ref: sourceRef,
    raw: {
      label: sample(row),
      amount,
      denomination: "USD",
      unit: `${row.header} ${row.segment}`.trim(),
    },
  };
}

function sample(row: PriceRow): string {
  return [row.table, row.row, row.header, row.segment].filter(Boolean).join(" / ").slice(0, 256);
}

function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "price"
  );
}
