import { load } from "cheerio";
import { z } from "zod";
import { publishedRate } from "./pricing.ts";
import type { PricingReconciliationItem } from "./pricing-reconciliation.ts";
import type {
  ParsedProviderModel,
  SourceCommercialPricingFact,
  SourcePriceFact,
  SourceRawPricingFact,
} from "./pricing-source.ts";

interface LinkedDocument {
  url: string;
  body: string;
}

interface Input {
  documents: readonly LinkedDocument[];
  models: readonly ParsedProviderModel[];
  reconcile?: (item: PricingReconciliationItem) => void;
  sourceId: string;
}

export interface MistralPricingRow {
  label: string;
  priceEur: string;
  priceUsd: string;
  prefix: string | null;
  suffix: string | null;
}

export interface MistralPricingCard {
  id: string;
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
    const title = heading || reviewedTitle || (id.startsWith("Classifier API model") ? id : "");
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
    const parsed = { id, title, text, rows, free };
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
  if (cards.length === 0)
    reconcile?.({ disposition: "unbound", reason_code: "commercial_companion_drift" });
  return cards;
}

export function extractMistralCommercialFacts(
  input: Input,
  cards: readonly MistralPricingCard[],
): void {
  const facts: SourceCommercialPricingFact[] = [];
  const bindingEvidence = commercialBindingEvidence(input);
  const agentModels = input.models
    .filter(
      ({ api_endpoints, status }) =>
        status !== "retired" &&
        api_endpoints?.some(({ name }) => name === "Agents" || name === "Conversations"),
    )
    .map(({ uid }) => uid)
    .sort();
  for (const card of cards) addCard(input, facts, card, agentModels, bindingEvidence);
  const carrier = [...input.models].sort((left, right) => left.uid.localeCompare(right.uid))[0];
  if (carrier !== undefined && facts.length > 0)
    carrier.commercial_facts = [...(carrier.commercial_facts ?? []), ...facts];
}

function addCard(
  input: Input,
  facts: SourceCommercialPricingFact[],
  card: MistralPricingCard,
  agentModels: string[],
  bindingEvidence: ReadonlySet<string>,
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
    facts.push(
      fact(
        input.sourceId,
        `service:${simple.key}`,
        simple.name,
        "service",
        simple.key,
        agentModels,
        "usage",
        simple.name,
        "usage",
        "numeric",
        rates,
        bindingEvidence.has(simple.key) ? [] : [bindingUnavailable(input.sourceId, simple.key)],
      ),
    );
    normalized(input, rates.length);
    return;
  }
  if (title === "Libraries")
    addLibraryRetrieval(input, facts, card, agentModels, bindingEvidence.has("library"));
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
  bindingAvailable: boolean,
): void {
  const row = card.rows.find((candidate) =>
    /Call.*call/i.test(`${candidate.label} ${candidate.suffix ?? ""}`),
  );
  if (row === undefined || row.prefix !== null) {
    unresolved(input, "Libraries: retrieval");
    return;
  }
  facts.push(
    fact(
      input.sourceId,
      "service:library-retrieval",
      "Document Library retrieval",
      "service",
      "library-retrieval",
      modelRefs,
      "usage",
      "Document Library retrieval",
      "usage",
      "numeric",
      rowRates(input.sourceId, row, "retrieval", "request"),
      bindingAvailable ? [] : [bindingUnavailable(input.sourceId, "library")],
    ),
  );
  normalized(input, 2);
}

function rowRates(
  sourceId: string,
  row: Pick<MistralPricingRow, "label" | "priceEur" | "priceUsd">,
  meter: SourcePriceFact["meter"],
  unit: SourcePriceFact["unit"],
  conditions: SourcePriceFact["conditions"] = {},
): SourcePriceFact[] {
  return (["USD", "EUR"] as const).map((currency) => {
    const price = currency === "USD" ? row.priceUsd : row.priceEur;
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

function commercialBindingEvidence(input: Input): Set<string> {
  const root = "/mistralai/platform-docs-public/main/src/content/en/docs/studio";
  const definitions = [
    [
      `${root}/agents/agent-tools/code_interpreter/page.mdx`,
      "code-execution",
      [/tool\.execution/, /connectors[\s\S]*code_interpreter/],
    ],
    [
      `${root}/agents/agent-tools/websearch/page.mdx`,
      "web-search",
      [/tool\.execution/, /connectors[\s\S]*web_search/],
    ],
    [
      `${root}/agents/agent-tools/websearch/page.mdx`,
      "premium-news",
      [/web_search_premium/, /tool\.execution/],
    ],
    [
      `${root}/agents/agent-tools/image_generation/page.mdx`,
      "image-generation",
      [/tool\.execution/, /image_generation/],
    ],
    [
      `${root}/libraries/page.mdx`,
      "library",
      [/document_library/, /connectors[\s\S]*document_library/],
    ],
  ] as const;
  const valid = new Set<string>();
  for (const [path, key, markers] of definitions)
    if (companion(input, path, markers) !== undefined) valid.add(key);
  return valid;
}

function bindingUnavailable(sourceRef: string, key: string): SourceRawPricingFact {
  return {
    source_ref: sourceRef,
    term_key: "charge_binding_unavailable",
    impact: "informational",
    reason: "unknown_applicability",
    conditions: {},
    raw: { label: `${key} usage counter was not verified` },
  };
}

function fact(
  source_ref: string,
  book_key: string,
  book_name: string,
  resource_kind: SourceCommercialPricingFact["resource_kind"],
  resource_key: string,
  model_refs: string[],
  offer_key: string,
  offer_name: string,
  billing_mode: SourceCommercialPricingFact["billing_mode"],
  pricing_state: SourceCommercialPricingFact["pricing_state"],
  price_facts: SourcePriceFact[],
  raw_price_facts: SourceRawPricingFact[],
): SourceCommercialPricingFact {
  return {
    source_ref,
    book_key,
    book_name,
    resource_kind,
    resource_key,
    model_refs,
    offer_key,
    offer_name,
    billing_mode,
    pricing_state,
    price_facts,
    raw_price_facts,
  };
}

function companion(input: Input, pathname: string, markers: readonly RegExp[]): string | undefined {
  const matches = input.documents.filter(({ url }) => new URL(url).pathname === pathname);
  const document = matches[0];
  if (
    matches.length === 1 &&
    document !== undefined &&
    markers.every((marker) => marker.test(document.body))
  )
    return document.body;
  input.reconcile?.({
    disposition: "unbound",
    reason_code:
      document === undefined ? "commercial_companion_missing" : "commercial_companion_drift",
    sample: pathname,
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
