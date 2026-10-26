import { load } from "cheerio";
import { z } from "zod";
import { commercialResource, publishedRate } from "./pricing.ts";
import type { PricingReconciliationItem } from "./pricing-reconciliation.ts";
import type {
  ParsedProviderModel,
  SourceCommercialPricingFact,
  SourcePriceFact,
} from "./pricing-source.ts";

interface Input {
  models: readonly Pick<ParsedProviderModel, "api_endpoints" | "status" | "uid">[];
  reconcile?: (item: PricingReconciliationItem) => void;
  sourceId: string;
}

export interface MistralPricingRow {
  label: string;
  priceEur?: string;
  priceUsd: string;
  prefix: string | null;
  suffix: string | null;
}

export interface MistralPricingCard {
  id: string;
  modelUrls: string[];
  title: string;
  text: string;
  rows: MistralPricingRow[];
  free: boolean;
}

const priceSchema = z.object({
  priceEur: z.number().nonnegative(),
  priceUsd: z.number().nonnegative(),
  prefix: z.string().nullable().default(null),
  suffix: z.string().nullable().default(null),
});

const serviceTitles = [
  "Enterprise APIs",
  "Agent API",
  "Libraries",
  "Code execution",
  "Web search",
  "Images",
  "Premium news",
  "Data capture",
] as const;

export function parseMistralPricingCards(
  body: string,
  reconcile?: Input["reconcile"],
): MistralPricingCard[] {
  const $ = load(body);
  const cards: MistralPricingCard[] = [];
  const seen = new Set<string>();
  for (const card of $("mistral-block-card-model").toArray()) {
    const element = $(card);
    const id = compact(element.find("mistral-atom-button-copy-clipboard").attr("data-text") ?? "");
    const text = compact(element.text());
    const heading = compact(element.find("h1,h2,h3,h4,h5,h6").first().text());
    const labels = element
      .find("p")
      .toArray()
      .map((paragraph) => compact($(paragraph).text()));
    const reviewedTitle =
      serviceTitles.find((candidate) => labels.includes(candidate)) ??
      labels.find((candidate) => /^Classifier API model \((?:3B|8B)\)$/i.test(candidate));
    const title =
      heading || reviewedTitle || labels[0] || (id.startsWith("Classifier API model") ? id : "");
    const rows: MistralPricingRow[] = [];
    for (const priceElement of element.find("mistral-atom-text-price").toArray()) {
      const price = $(priceElement);
      const label = compact(price.parent().children("p").first().text());
      const parsed = parseJson(price.attr("data-prices"), priceSchema);
      if (parsed === undefined) {
        reconcile?.({
          disposition: "unsupported",
          reason_code: "public_price_shape_unsupported",
          sample: `${id || title}: ${label}`,
        });
        continue;
      }
      rows.push({
        label,
        priceEur: decimal(parsed.priceEur),
        priceUsd: decimal(parsed.priceUsd),
        prefix: parsed.prefix,
        suffix: parsed.suffix,
      });
    }
    const free = labels.includes("Free");
    const modelUrls = [
      ...new Set(
        element
          .find("a[href]")
          .toArray()
          .flatMap((link) => {
            const href = $(link).attr("href");
            if (href === undefined) return [];
            try {
              const url = new URL(href);
              return url.origin === "https://docs.mistral.ai" &&
                /^\/models\/(?:model-cards\/)?[a-z0-9-]+\/?$/.test(url.pathname)
                ? [url.href]
                : [];
            } catch {
              return [];
            }
          }),
      ),
    ];
    const parsed = { id, modelUrls, title, text, rows, free };
    const fingerprint = JSON.stringify(id === "" ? parsed : { id, rows, free });
    if (seen.has(fingerprint)) {
      reconcileMany(reconcile, rows.length + Number(free), {
        disposition: "excluded",
        reason_code: "duplicate_public_price_card",
      });
      continue;
    }
    seen.add(fingerprint);
    cards.push(parsed);
  }
  if (cards.length === 0) {
    for (const table of $("table").toArray()) {
      const headers = $(table)
        .find("tr")
        .first()
        .find("th")
        .toArray()
        .map((cell) => compact($(cell).text()));
      if (
        headers.length !== 4 ||
        !headers.every(
          (header, index) => header === ["Model", "Input", "Cached input", "Output"][index],
        )
      )
        continue;
      for (const row of $(table).find("tr").slice(1).toArray()) {
        const cells = $(row).find("td").toArray();
        if (cells.length !== 4) continue;
        const modelCell = $(cells[0]);
        const title = compact(modelCell.find("a").first().text()).replace(/\s*↗$/u, "");
        const href = modelCell.find("a").first().attr("href");
        if (title === "" || href === undefined || !/^\/models\/[a-z0-9-]+\/?$/u.test(href))
          continue;
        const rows = cells.slice(1).flatMap((cell, index): MistralPricingRow[] => {
          const content = $(cell).clone();
          const sale = content.find("ins");
          const original = content.find("del");
          if (
            (sale.length > 0 || original.length > 0) &&
            (sale.length !== 1 || original.length !== 1)
          ) {
            reconcile?.({
              disposition: "unsupported",
              reason_code: "public_price_shape_unsupported",
              sample: `${title}: ${headers[index + 1]}`,
            });
            return [];
          }
          // The page labels its struck-through amount as the original, superseded price.
          content.find("del,.sr-only").remove();
          const value = compact(content.text());
          if (value === "—" || value.toLowerCase() === "free") return [];
          const match = value.match(
            /^\$(\d+(?:\.\d+)?)(?:\s*(\/\s*1000\s*pages|\/\s*min|\/\s*m\s*chars|\/\s*m\s*tokens))?$/iu,
          );
          if (match?.[1] === undefined) {
            reconcile?.({
              disposition: "unsupported",
              reason_code: "public_price_shape_unsupported",
              sample: `${title}: ${headers[index + 1]}`,
            });
            return [];
          }
          const suffix = match[2]
            ?.toLowerCase()
            .replace(/^\/\s*/u, "/ ")
            .replace(/\s+/g, " ");
          const column = headers[index + 1];
          if (column === undefined) return [];
          const label =
            suffix === "/ 1000 pages"
              ? column === "Input"
                ? "OCR"
                : `${column} (/1000 pages)`
              : suffix === "/ min"
                ? column === "Input"
                  ? "Audio Input/min"
                  : `${column} (/Min)`
                : suffix === "/ m chars"
                  ? column === "Input"
                    ? "Input (/M chars)"
                    : column === "Output"
                      ? "Output (/M chars)"
                      : `${column} (/M chars)`
                  : `${column} (/M tokens)`;
          return [
            {
              label,
              priceUsd: match[1],
              prefix: null,
              suffix: suffix === "/ 1000 pages" ? "/ 1000 pages" : null,
            },
          ];
        });
        const free = cells
          .slice(1)
          .every((cell) => compact($(cell).text()).toLowerCase() === "free");
        cards.push({
          id: "",
          modelUrls: [new URL(href, "https://docs.mistral.ai").href],
          title,
          text: compact($(row).text()),
          rows,
          free,
        });
      }
    }
  }
  if (cards.length === 0)
    reconcile?.({ disposition: "unbound", reason_code: "commercial_companion_drift" });
  return cards;
}

export function extractMistralCommercialFacts(
  input: Input,
  cards: readonly MistralPricingCard[],
): SourceCommercialPricingFact[] {
  const facts: SourceCommercialPricingFact[] = [];
  const agentModels = input.models
    .filter(
      ({ api_endpoints, status }) =>
        status !== "retired" &&
        api_endpoints?.some(({ name }) => name === "Agents" || name === "Conversations"),
    )
    .map(({ uid }) => uid)
    .sort();
  for (const card of cards) addCard(input, facts, card, agentModels);
  return facts;
}

function addCard(
  input: Input,
  facts: SourceCommercialPricingFact[],
  card: MistralPricingCard,
  agentModels: string[],
): void {
  const title = card.title || card.id;
  if (card.id !== "" && !card.id.startsWith("Classifier API model")) return;
  if (
    title === "Enterprise APIs" ||
    title === "Agent API" ||
    title === "Data capture" ||
    title.startsWith("Classifier API model")
  )
    return;
  const simple = serviceDefinition(title);
  if (simple !== undefined) {
    const row = card.rows[0];
    const rates = row === undefined ? undefined : serviceRates(input.sourceId, simple, row);
    if (rates === undefined) {
      unresolved(input, title);
      return;
    }
    facts.push({
      ...commercialResource(
        input.sourceId,
        `service:${simple.key}`,
        simple.name,
        "service",
        simple.key,
        agentModels,
        "usage",
      ),
      offer_key: "usage",
      offer_name: simple.name,
      pricing_state: "numeric",
      price_facts: rates,
      raw_price_facts: [],
    });
    normalized(input, rates.length);
    return;
  }
  if (title === "Libraries") addLibraryRetrieval(input, facts, card, agentModels);
  else if (card.id === "")
    unresolved(input, title || card.text.slice(0, 128), "unknown_public_pricing_card");
}

interface ServiceDefinition {
  key: string;
  name: string;
  meter: SourcePriceFact["meter"];
  unit: SourcePriceFact["unit"];
  expected: RegExp;
  operation?: string;
}

function serviceDefinition(title: string): ServiceDefinition | undefined {
  if (title === "Code execution")
    return {
      key: "code-execution",
      name: title,
      meter: "code_execution",
      unit: "thousand_requests",
      expected: /1K calls/i,
    };
  if (title === "Web search")
    return {
      key: "web-search",
      name: title,
      meter: "web_search",
      unit: "thousand_requests",
      expected: /1K calls/i,
      operation: "web_search",
    };
  if (title === "Premium news")
    return {
      key: "premium-news",
      name: title,
      meter: "web_search",
      unit: "thousand_requests",
      expected: /1K calls/i,
      operation: "web_search_premium",
    };
  if (title === "Images")
    return {
      key: "image-generation",
      name: "Image generation",
      meter: "image_generation",
      unit: "thousand_items",
      expected: /1K images/i,
      operation: "image_generation",
    };
}

function serviceRates(
  sourceId: string,
  service: ServiceDefinition,
  row: MistralPricingRow,
): SourcePriceFact[] | undefined {
  if (row.prefix !== null || !service.expected.test(`${row.label} ${row.suffix ?? ""}`)) return;
  return rowRates(
    sourceId,
    row,
    service.meter,
    service.unit,
    service.operation === undefined ? {} : { operation: service.operation },
  );
}

function addLibraryRetrieval(
  input: Input,
  facts: SourceCommercialPricingFact[],
  card: MistralPricingCard,
  modelRefs: string[],
): void {
  const row = card.rows.find((candidate) =>
    /Call.*call/i.test(`${candidate.label} ${candidate.suffix ?? ""}`),
  );
  if (row === undefined || row.prefix !== null) {
    unresolved(input, "Libraries: retrieval");
    return;
  }
  facts.push({
    ...commercialResource(
      input.sourceId,
      "service:library-retrieval",
      "Document Library retrieval",
      "service",
      "library-retrieval",
      modelRefs,
      "usage",
    ),
    offer_key: "usage",
    offer_name: "Document Library retrieval",
    pricing_state: "numeric",
    price_facts: rowRates(input.sourceId, row, "retrieval", "request"),
    raw_price_facts: [],
  });
  normalized(input, row.priceEur === undefined ? 1 : 2);
}

function rowRates(
  sourceId: string,
  row: Pick<MistralPricingRow, "label" | "priceEur" | "priceUsd">,
  meter: SourcePriceFact["meter"],
  unit: SourcePriceFact["unit"],
  conditions: SourcePriceFact["conditions"] = {},
): SourcePriceFact[] {
  return (["USD", "EUR"] as const).flatMap((currency) => {
    const price = currency === "USD" ? row.priceUsd : row.priceEur;
    if (price === undefined) return [];
    return {
      ...publishedRate(meter, price, unit, sourceId, row.label, {
        ...conditions,
        billing_currency: currency,
      }),
      currency,
      raw_price: price,
    };
  });
}

function parseJson<T>(value: string | undefined, schema: z.ZodType<T>): T | undefined {
  try {
    return schema.parse(JSON.parse(value ?? "null"));
  } catch {
    return;
  }
}

function decimal(value: number): string {
  const result = String(value);
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(result))
    throw new Error(`Unsupported Mistral price: ${result}`);
  return result;
}

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalized(input: Input, count: number): void {
  reconcileMany(input.reconcile, count, {
    disposition: "normalized",
    reason_code: "normalized_provider_service_price",
  });
}

function unresolved(
  input: Input,
  sample: string,
  reason_code = "provider_service_pricing_unbound",
): void {
  input.reconcile?.({ disposition: "unbound", reason_code, sample });
}

function reconcileMany(
  reconcile: Input["reconcile"],
  count: number,
  item: PricingReconciliationItem,
): void {
  for (let index = 0; index < count; index += 1) reconcile?.(item);
}
