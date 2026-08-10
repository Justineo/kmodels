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
    const title =
      heading ||
      (id.startsWith("Classifier API model")
        ? id
        : (serviceTitles.find((candidate) => text.startsWith(candidate)) ?? ""));
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
    const free = element
      .find("p")
      .toArray()
      .some((paragraph) => compact($(paragraph).text()) === "Free");
    const parsed = { id, title, text, rows, free };
    const fingerprint = JSON.stringify(parsed);
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
  addVibePlans(input, facts);
  addEnterpriseServices(input, facts);
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
  if (title === "Enterprise APIs") {
    const uplift = card.text.match(/([0-9]+(?:\.[0-9]+)?)% above list pricing/i)?.[1];
    if (uplift === undefined) unresolved(input, "Enterprise API uplift");
    facts.push(
      fact(
        input.sourceId,
        "service:enterprise-api",
        "Enterprise API",
        "service",
        "enterprise-api",
        [],
        "enterprise",
        "Enterprise API",
        "usage",
        "custom_quote",
        [],
        uplift === undefined
          ? []
          : [
              raw(
                input.sourceId,
                "select_api_uplift",
                "informational",
                "unknown_applicability",
                `Enterprise APIs are available for ${uplift}% above list pricing on select APIs`,
              ),
            ],
      ),
    );
    input.reconcile?.({
      disposition: "explicit_non_numeric",
      reason_code: "provider_service_custom_quote",
      sample: "Enterprise API",
    });
    if (uplift !== undefined)
      input.reconcile?.({ disposition: "raw", reason_code: "enterprise_api_selective_uplift" });
    return;
  }
  if (title === "Agent API") {
    const composition = /model cost per M token\s*\+\s*tool call/i.test(card.text);
    if (!composition) unresolved(input, "Agent API composition");
    facts.push(
      fact(
        input.sourceId,
        "account:agent",
        "Agent",
        "account_resource_template",
        "agent",
        agentModels,
        "execution",
        "Agent execution",
        "usage",
        "not_published",
        [],
        composition
          ? [
              raw(
                input.sourceId,
                "agent_price_formula",
                "informational",
                "unknown_applicability",
                "Agent API price is model cost plus exact built-in tool charges; no generic orchestration surcharge is published",
              ),
            ]
          : [],
      ),
    );
    input.reconcile?.({
      disposition: "explicit_non_numeric",
      reason_code: "price_not_published",
      sample: "Agent API",
    });
    if (composition)
      input.reconcile?.({ disposition: "raw", reason_code: "agent_api_composition" });
    return;
  }
  if (title.startsWith("Classifier API model")) {
    addClassifier(input, facts, card, title);
    return;
  }
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
        simple.projected ? agentModels : [],
        "usage",
        simple.name,
        "usage",
        "numeric",
        rates,
        simple.projected && !bindingEvidence.has(simple.key)
          ? [bindingUnavailable(input.sourceId, simple.key)]
          : [],
      ),
    );
    normalized(input, rates.length);
    return;
  }
  if (title === "Libraries")
    addLibraries(input, facts, card, agentModels, bindingEvidence.has("library"));
  else if (card.id === "")
    unresolved(input, title || card.text.slice(0, 128), "unknown_public_pricing_card");
}

interface ServiceDefinition {
  key: string;
  name: string;
  meter: SourcePriceFact["meter"];
  unit: SourcePriceFact["unit"];
  expected: RegExp;
  projected: boolean;
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
      projected: true,
    };
  if (title === "Web search")
    return {
      key: "web-search",
      name: title,
      meter: "web_search",
      unit: "thousand_requests",
      expected: /1K calls/i,
      projected: true,
      operation: "web_search",
    };
  if (title === "Premium news")
    return {
      key: "premium-news",
      name: title,
      meter: "web_search",
      unit: "thousand_requests",
      expected: /1K calls/i,
      projected: true,
      operation: "web_search_premium",
    };
  if (title === "Images")
    return {
      key: "image-generation",
      name: "Image generation",
      meter: "image_generation",
      unit: "thousand_items",
      expected: /1K images/i,
      projected: true,
      operation: "image_generation",
    };
  if (title === "Data capture")
    return {
      key: "data-capture",
      name: title,
      meter: "custom_reporting",
      unit: "million_tokens",
      expected: /M tokens/i,
      projected: false,
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

function addLibraries(
  input: Input,
  facts: SourceCommercialPricingFact[],
  card: MistralPricingCard,
  modelRefs: string[],
  bindingAvailable: boolean,
): void {
  const definitions = [
    ["ocr", "Library document OCR", "input_image", "thousand_pages", /OCR.*1K pages/i],
    ["indexing", "Library document indexing", "retrieval", "million_tokens", /Indexing.*M tokens/i],
    ["retrieval", "Document Library retrieval", "retrieval", "request", /Call.*call/i],
  ] as const;
  for (const [key, name, meter, unit, expected] of definitions) {
    const row = card.rows.find((candidate) =>
      expected.test(`${candidate.label} ${candidate.suffix ?? ""}`),
    );
    if (row === undefined || row.prefix !== null) {
      unresolved(input, `Libraries: ${key}`);
      continue;
    }
    facts.push(
      fact(
        input.sourceId,
        "account:library",
        "Library",
        "account_resource_template",
        "library",
        key === "retrieval" ? modelRefs : [],
        key,
        name,
        "usage",
        "numeric",
        rowRates(input.sourceId, row, meter, unit, { operation: key }),
        key === "retrieval" && !bindingAvailable
          ? [bindingUnavailable(input.sourceId, "library")]
          : [],
      ),
    );
    normalized(input, 2);
  }
}

function addClassifier(
  input: Input,
  facts: SourceCommercialPricingFact[],
  card: MistralPricingCard,
  title: string,
): void {
  const size = title.match(/\b(3B|8B)\b/i)?.[1]?.toLowerCase();
  if (size === undefined) {
    unresolved(input, title);
    return;
  }
  const minimum = card.text.match(
    /minimum fee per fine-tuning job of \$([0-9]+(?:\.[0-9]+)?)/i,
  )?.[1];
  if (minimum === undefined) unresolved(input, `${title}: minimum job charge`);
  const definitions = [
    ["training", "Classifier training", "training_input", "million_tokens", /Training.*M tokens/i],
    ["storage", "Classifier model storage", "storage", "unit_month", /Storage.*month.*model/i],
    ["input", "Classifier inference input", "input_text", "million_tokens", /Input.*M tokens/i],
    ["output", "Classifier inference output", "output_text", "million_tokens", /Output.*M tokens/i],
  ] as const;
  for (const [key, name, meter, unit, expected] of definitions) {
    const row = card.rows.find((candidate) =>
      expected.test(`${candidate.label} ${candidate.suffix ?? ""}`),
    );
    if (row === undefined || row.prefix !== null) {
      unresolved(input, `${title}: ${key}`);
      continue;
    }
    facts.push(
      fact(
        input.sourceId,
        `account:classifier-${size}`,
        `${title} fine-tuned model`,
        "account_resource_template",
        `classifier-${size}`,
        [],
        key,
        `${name} (${size.toUpperCase()})`,
        key === "storage" ? "subscription" : key === "training" ? "one_time" : "usage",
        "numeric",
        rowRates(input.sourceId, row, meter, unit),
        key === "training" && minimum !== undefined
          ? [
              raw(
                input.sourceId,
                "minimum_job_charge",
                "base_price",
                "requires_usage_aggregation",
                `Minimum fee per fine-tuning job is USD ${minimum}`,
              ),
            ]
          : [],
      ),
    );
    normalized(input, 2);
    if (key === "training" && minimum !== undefined)
      input.reconcile?.({
        disposition: "raw",
        reason_code: "minimum_job_charge_requires_aggregation",
        sample: title,
      });
  }
}

function addVibePlans(input: Input, facts: SourceCommercialPricingFact[]): void {
  const body = companion(input, "/pricing/", [
    /Vibe/i,
    /Pro/i,
    /Team/i,
    /Enterprise/i,
    /Education/i,
    /Free/i,
  ]);
  if (body === undefined) return;
  const $ = load(body);
  const prices = [
    ["pro", "Vibe Pro", "Pro"],
    ["team", "Vibe Team", "Team"],
    ["education", "Vibe Education", "Education plan"],
  ] as const;
  for (const [key, name, heading] of prices) {
    const plan = planPrice($, heading);
    if (plan === undefined) {
      unresolved(input, name, "commercial_companion_drift");
      continue;
    }
    facts.push(
      fact(
        input.sourceId,
        `plan:vibe-${key}`,
        name,
        "plan",
        `vibe-${key}`,
        [],
        "subscription",
        name,
        "subscription",
        "numeric",
        rowRates(
          input.sourceId,
          { ...plan, label: key === "team" ? "user / month" : "month" },
          "subscription",
          "unit_month",
        ),
        key === "team" && plan.minimumSeats !== undefined
          ? [
              raw(
                input.sourceId,
                "team_minimum",
                "informational",
                "requires_usage_aggregation",
                `The displayed Team minimum uses ${plan.minimumSeats} seats`,
              ),
            ]
          : [],
      ),
    );
    normalized(input, 2, "normalized_plan_price");
    if (key === "team" && plan.minimumSeats !== undefined)
      input.reconcile?.({
        disposition: "raw",
        reason_code: "plan_minimum_requires_aggregation",
        sample: name,
      });
  }
  for (const [key, name, state] of [
    ["free", "Vibe Free", "free"],
    ["enterprise", "Vibe Enterprise", "custom_quote"],
  ] as const)
    facts.push(
      fact(
        input.sourceId,
        `plan:vibe-${key}`,
        name,
        "plan",
        `vibe-${key}`,
        [],
        "subscription",
        name,
        "subscription",
        state,
        [],
        [],
      ),
    );
  for (const [name, reason_code] of [
    ["Vibe Free", "free"],
    ["Vibe Enterprise", "provider_service_custom_quote"],
  ] as const)
    input.reconcile?.({ disposition: "explicit_non_numeric", reason_code, sample: name });
}

function planPrice(
  $: ReturnType<typeof load>,
  heading: string,
): (MistralPricingRow & { minimumSeats?: number }) | undefined {
  const title = $("h1,h2,h3,h4,h5,h6,p")
    .toArray()
    .find((element) => compact($(element).text()) === heading);
  if (title === undefined) return;
  let container = $(title).parent();
  for (let depth = 0; depth < 8 && container.length > 0; depth += 1) {
    const prices = container.find("mistral-atom-text-price");
    const parsed = parseJson(prices.first().attr("data-prices"), priceSchema);
    if (parsed !== undefined) {
      const multipliers = prices.toArray().flatMap((element) => {
        const value = Number($(element).attr("data-multiplier"));
        return Number.isSafeInteger(value) && value > 1 ? [value] : [];
      });
      const minimumSeats = multipliers.length === 0 ? undefined : Math.max(...multipliers);
      return {
        label: heading,
        priceEur: decimal(parsed.priceEur),
        priceUsd: decimal(parsed.priceUsd),
        prefix: parsed.prefix,
        suffix: parsed.suffix,
        ...(minimumSeats === undefined ? {} : { minimumSeats }),
      };
    }
    container = container.parent();
  }
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

function addEnterpriseServices(input: Input, facts: SourceCommercialPricingFact[]): void {
  const services = [
    [
      "/products/forge/",
      "forge",
      "Mistral Forge",
      [/Train, align, and evaluate custom AI models/i, /Talk to an expert/i],
    ],
    [
      "/products/compute/",
      "compute",
      "Mistral Compute",
      [/Dedicated GPU clusters/i, /Kubernetes/i, /Slurm/i],
    ],
    [
      "/services/",
      "private-deployment",
      "Private deployment services",
      [/private cloud/i, /on-prem/i],
    ],
  ] as const;
  for (const [path, key, name, markers] of services) {
    if (companion(input, path, markers) === undefined) continue;
    facts.push(
      fact(
        input.sourceId,
        `service:${key}`,
        name,
        key === "compute" ? "capacity" : "service",
        key,
        [],
        "custom",
        name,
        key === "compute" ? "capacity" : "one_time",
        "custom_quote",
        [],
        [],
      ),
    );
    input.reconcile?.({
      disposition: "explicit_non_numeric",
      reason_code: "provider_service_custom_quote",
      sample: name,
    });
  }
}

function commercialBindingEvidence(input: Input): Set<string> {
  const root = "/mistralai/platform-docs-public/main/src/content/en/docs/studio-api";
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
  return raw(
    sourceRef,
    "charge_binding_unavailable",
    "informational",
    "unknown_applicability",
    `The ${key} execution-counter companion is missing or drifted; its price remains published without an automatic charge binding`,
  );
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

function raw(
  source_ref: string,
  term_key: string,
  impact: SourceRawPricingFact["impact"],
  reason: SourceRawPricingFact["reason"],
  fragment: string,
): SourceRawPricingFact {
  return { source_ref, term_key, impact, reason, conditions: {}, raw: { fragment } };
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

function normalized(
  input: Input,
  count: number,
  reason_code = "normalized_provider_service_price",
): void {
  reconcileMany(input.reconcile, count, { disposition: "normalized", reason_code });
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
