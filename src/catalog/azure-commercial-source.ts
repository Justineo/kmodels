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
  modelRefs: readonly string[];
  modelRefsForLabel: (label: string) => string[];
  region: (value: string) => string;
  onPricingReconciliation?: (item: PricingReconciliationItem) => void;
}

interface EmbeddedPrice {
  path: string;
  table: string;
  row: string;
  prefix: string;
  header: string;
  segment: string;
  regional: Record<string, string>;
  locator: string;
}

interface RateSpec {
  bookKey: string;
  bookName: string;
  resourceKind?: SourceCommercialPricingFact["resource_kind"];
  resourceKey: string;
  modelRefs?: string[];
  offerKey: string;
  offerName: string;
  billingMode?: SourceCommercialPricingFact["billing_mode"];
  meter: SourcePriceFact["meter"];
  unit: SourcePriceFact["unit"];
  conditions?: SourcePriceFact["conditions"];
}

type MutableFact = Omit<SourceCommercialPricingFact, "source_ref">;

const decimal = z
  .union([z.string(), z.number().finite().nonnegative()])
  .transform((value) => String(value));
const amountSchema = z.object({ regional: z.record(z.string().min(1), decimal) });

const commercialPaths = new Set([
  "/en-us/pricing/details/azure-openai/",
  "/en-us/pricing/details/ai-foundry-models/fine-tuning-models/",
  "/en-us/pricing/details/foundry-agent-service/",
  "/en-us/pricing/details/content-safety/",
  "/en-us/pricing/details/foundryobservability/",
  "/en-us/pricing/details/microsoft-foundry/",
]);

export function azureCommercialFacts(input: Input): SourceCommercialPricingFact[] {
  const facts = new Map<string, MutableFact>();
  for (const document of input.documents) {
    const url = new URL(document.url);
    if (!commercialPaths.has(url.pathname)) continue;
    const prices = embeddedPrices(url, document.body);
    for (const price of prices) {
      const spec = rateSpec(price, input);
      if (spec === undefined) {
        addRawFact(facts, price, input);
        continue;
      }
      const fact = getFact(facts, spec);
      for (const [region, amount] of Object.entries(price.regional))
        fact.price_facts.push({
          meter: spec.meter,
          price: amount,
          currency: "USD",
          unit: spec.unit,
          conditions: { ...spec.conditions, region: input.region(region) },
          source_ref: input.sourceId,
          source_locator: { kind: "table", value: price.locator },
          derived: false,
          raw_price: amount,
          raw_unit: `${price.header} ${price.segment}`.trim(),
        });
      input.onPricingReconciliation?.({
        disposition: "normalized",
        reason_code: "commercial_public_price_bound",
        sample: sample(price),
      });
    }
    if (url.pathname === "/en-us/pricing/details/content-safety/")
      addContentSafetyAllowances(facts, document.body, input);
  }
  return [...facts.values()].map((fact) => ({ source_ref: input.sourceId, ...fact }));
}

function embeddedPrices(url: URL, body: string): EmbeddedPrice[] {
  const $ = load(body);
  const prices: EmbeddedPrice[] = [];
  for (const table of $("table").toArray()) {
    if ($(table).find("[data-amount]").length === 0) continue;
    const tableLabel =
      $(table).attr("aria-label") ??
      htmlText($(table).closest("section").find("h2").first().text());
    if (!isCommercialTable(url.pathname, tableLabel)) continue;
    const headers = $(table)
      .find("thead tr")
      .first()
      .find("th")
      .map((_index, header) => htmlText($(header).text()))
      .get();
    let tier = "";
    for (const row of $(table).find("tbody tr").toArray()) {
      const cells = $(row).find("td").toArray();
      const first = htmlText($(cells[0]).text());
      if (/^(?:free|standard)\b/i.test(first)) tier = first;
      const firstPriceCell = cells.findIndex((cell) => $(cell).find("[data-amount]").length > 0);
      const rowLabel = [
        ...(tier !== "" && !first.toLowerCase().startsWith(tier.toLowerCase()) ? [tier] : []),
        first,
      ].join(" ");
      const prefix = cells
        .slice(0, firstPriceCell < 0 ? 1 : firstPriceCell)
        .map((cell) => htmlText($(cell).text()))
        .filter(Boolean)
        .join(" ");
      for (const [cellIndex, cell] of cells.entries()) {
        const header = headers[cellIndex] ?? "";
        for (const element of $(cell).find("[data-amount]").toArray()) {
          const rawAmount = $(element).attr("data-amount");
          if (rawAmount === undefined) continue;
          const regional = amountSchema.parse(JSON.parse(rawAmount)).regional;
          const contents = $(element).parent().contents().toArray();
          const elementIndex = contents.indexOf(element);
          let start = elementIndex;
          while (start > 0) {
            const previous = contents[start - 1];
            if (previous?.type === "tag" && previous.name === "br") break;
            start -= 1;
          }
          let end = elementIndex + 1;
          while (end < contents.length) {
            const next = contents[end];
            if (next?.type === "tag" && next.name === "br") break;
            end += 1;
          }
          const segment = htmlText(
            contents
              .slice(start, end)
              .map((part) => $(part).text())
              .join(" "),
          );
          prices.push({
            path: url.pathname,
            table: tableLabel,
            row: rowLabel,
            prefix,
            header,
            segment,
            regional,
            locator: [url.href, tableLabel, prefix, header, segment]
              .filter(Boolean)
              .join(" / ")
              .slice(0, 512),
          });
        }
      }
    }
  }
  return prices;
}

function isCommercialTable(path: string, table: string): boolean {
  if (path !== "/en-us/pricing/details/azure-openai/") return true;
  return /built-in tools|provisioned|fine-tuning models/i.test(table);
}

function rateSpec(price: EmbeddedPrice, input: Input): RateSpec | undefined {
  const text = `${price.table} ${price.row} ${price.prefix} ${price.header} ${price.segment}`;
  if (price.path === "/en-us/pricing/details/foundry-agent-service/")
    return agentSpec(price, text, input.modelRefs);
  if (price.path === "/en-us/pricing/details/foundryobservability/")
    return evaluationSpec(text, input.modelRefs);
  if (price.path === "/en-us/pricing/details/content-safety/")
    return contentSafetySpec(price, text, input.modelRefs);
  if (price.path === "/en-us/pricing/details/microsoft-foundry/")
    return acuSpec(price, text, input.modelRefs);
  if (price.path === "/en-us/pricing/details/ai-foundry-models/fine-tuning-models/")
    return fineTuningSpec(price, text, input);
  if (price.path === "/en-us/pricing/details/azure-openai/")
    return openAiCommercialSpec(price, text, input);
}

function agentSpec(
  price: EmbeddedPrice,
  text: string,
  modelRefs: readonly string[],
): RateSpec | undefined {
  const common = { modelRefs: [...modelRefs] };
  if (/hosted agents/i.test(price.row) && /vcpu/i.test(price.segment))
    return serviceRate("hosted-agent-runtime", "Hosted agent runtime", "compute", "unit_hour", {
      ...common,
      conditions: { capacity: "vCPU" },
    });
  if (/hosted agents/i.test(price.row) && /memory|gib/i.test(price.segment))
    return serviceRate("hosted-agent-runtime", "Hosted agent runtime", "compute", "unit_hour", {
      ...common,
      conditions: { capacity: "GiB memory" },
    });
  if (/file search storage/i.test(text))
    return serviceRate(
      "agent-file-search-storage",
      "Agent File Search storage",
      "storage",
      "gigabyte_day",
      common,
    );
  if (/code interpreter/i.test(text))
    return serviceRate(
      "agent-code-interpreter",
      "Agent Code Interpreter",
      "code_execution",
      "session",
      common,
    );
  if (/custom search/i.test(text))
    return serviceRate(
      "agent-custom-search",
      "Agent Custom Search",
      "web_search",
      "thousand_requests",
      {
        ...common,
        conditions: { operation: "custom_search_transaction" },
      },
    );
  if (/web search/i.test(text))
    return serviceRate("agent-web-search", "Agent Web Search", "web_search", "thousand_requests", {
      ...common,
      conditions: { operation: "web_search_transaction" },
    });
}

function evaluationSpec(text: string, modelRefs: readonly string[]): RateSpec | undefined {
  const operation = /output/i.test(text)
    ? "output_tokens"
    : /input/i.test(text)
      ? "input_tokens"
      : undefined;
  if (operation === undefined) return;
  return serviceRate("ai-evaluation", "AI Evaluation", "evaluation", "million_tokens", {
    modelRefs: [...modelRefs],
    conditions: { operation },
  });
}

function contentSafetySpec(
  price: EmbeddedPrice,
  text: string,
  modelRefs: readonly string[],
): RateSpec | undefined {
  if (/standard/i.test(text)) {
    const modality = /image|multimodal/i.test(text) ? "image" : "text";
    return serviceRate("content-safety", "Content Safety", "content_safety", "thousand_items", {
      modelRefs: [...modelRefs],
      conditions: { account_eligibility: "standard", modality },
    });
  }
  if (/commitment tiers/i.test(price.table) && /price per year/i.test(price.header)) {
    const capacity = /image/i.test(price.row) ? "image" : "text";
    return {
      bookKey: "capacity:content-safety-disconnected",
      bookName: "Content Safety disconnected container",
      resourceKind: "capacity",
      resourceKey: "content-safety-disconnected",
      offerKey: capacity,
      offerName: `${capacity} annual commitment`,
      billingMode: "subscription",
      meter: "subscription",
      unit: "unit",
      conditions: { billing_period: "1_year", capacity },
    };
  }
}

function acuSpec(
  price: EmbeddedPrice,
  _text: string,
  modelRefs: readonly string[],
): RateSpec | undefined {
  const amounts = price.prefix.match(/\d[\d,]*/g) ?? price.segment.match(/\d[\d,]*/g) ?? [];
  const units = amounts.find((value) => value.includes(",")) ?? amounts[1];
  const tier = price.row.match(/^\s*(\d+)\b/)?.[1] ?? "unknown";
  return {
    bookKey: "plan:agent-prepurchase",
    bookName: "Agent Prepurchase Plan",
    resourceKind: "plan",
    resourceKey: "agent-prepurchase",
    modelRefs: [...modelRefs],
    offerKey: `tier-${tier}`,
    offerName: `Agent Prepurchase tier ${tier}`,
    billingMode: "subscription",
    meter: "subscription",
    unit: "unit",
    conditions: {
      billing_period: "1_year",
      capacity: units === undefined ? `tier ${tier}` : `${units} ACU`,
    },
  };
}

function fineTuningSpec(price: EmbeddedPrice, text: string, input: Input): RateSpec | undefined {
  if (/managed compute/i.test(price.table)) {
    const accelerator = price.row
      .replace(/^managed\s+/i, "")
      .replace(/\s+global$/i, "")
      .trim();
    return {
      bookKey: "capacity:managed-compute",
      bookName: "Managed Compute",
      resourceKind: "capacity",
      resourceKey: "managed-compute",
      modelRefs: [...input.modelRefs],
      offerKey: "accelerator-hour",
      offerName: "Managed accelerator compute",
      billingMode: "capacity",
      meter: "compute",
      unit: "gpu_hour",
      conditions: { capacity: accelerator },
    };
  }
  if (!/fine-tuning models/i.test(price.table)) return;
  const refs = input.modelRefsForLabel(price.row);
  const key = slug(price.row.replace(/\b(?:global|data zone|regional)\b/gi, ""));
  const base = {
    bookKey: `service:fine-tuning:${key}`,
    bookName: `Fine-tuning ${price.row}`,
    resourceKind: "account_resource_template" as const,
    resourceKey: `fine-tuning:${key}`,
    modelRefs: refs,
    offerKey: "lifecycle",
    offerName: "Fine-tuned model lifecycle",
    billingMode: "hybrid" as const,
    conditions: deploymentConditions(price.row),
  };
  if (/training/i.test(price.header))
    return { ...base, meter: "training_input", unit: "million_tokens" };
  if (/hosting/i.test(price.header)) return { ...base, meter: "compute", unit: "hour" };
  if (/input usage/i.test(price.header))
    return { ...base, meter: "input_text", unit: "million_tokens" };
  if (/output usage/i.test(price.header))
    return { ...base, meter: "output_text", unit: "million_tokens" };
  if (/training|hosting|input|output/i.test(text)) return;
}

function openAiCommercialSpec(
  price: EmbeddedPrice,
  text: string,
  input: Input,
): RateSpec | undefined {
  if (/built-in tools/i.test(price.table)) {
    const common = { modelRefs: [...input.modelRefs] };
    if (/file search tool call/i.test(text))
      return serviceRate(
        "responses-file-search",
        "Responses File Search",
        "file_search",
        "thousand_requests",
        common,
      );
    if (/file search/i.test(text))
      return serviceRate(
        "responses-file-search-storage",
        "Responses File Search storage",
        "storage",
        "gigabyte_day",
        common,
      );
    if (/code interpreter/i.test(text))
      return serviceRate(
        "responses-code-interpreter",
        "Responses Code Interpreter",
        "code_execution",
        "session",
        common,
      );
    if (/computer use/i.test(text))
      return serviceRate(
        "computer-use",
        "Computer Use",
        /output/i.test(price.segment) ? "output_text" : "input_text",
        "million_tokens",
        common,
      );
  }
  if (/provisioned/i.test(price.table)) {
    const refs = input.modelRefsForLabel(price.row);
    const key = refs.join("+") || slug(price.row);
    const conditions = deploymentConditions(price.row);
    if (/hourly/i.test(price.header)) return;
    const period = /yearly/i.test(price.header)
      ? "1_year"
      : /monthly/i.test(price.header)
        ? "1_month"
        : undefined;
    if (period !== undefined)
      return {
        bookKey: `plan:ptu-reservation:${key}`,
        bookName: `PTU reservations for ${price.row}`,
        resourceKind: "plan",
        resourceKey: `ptu-reservation:${key}`,
        modelRefs: refs,
        offerKey: `reservation-${period}`,
        offerName: `PTU ${period === "1_year" ? "yearly" : "monthly"} reservation`,
        billingMode: "subscription",
        meter: "subscription",
        unit: "unit",
        conditions: { ...conditions, billing_period: period },
      };
  }
}

function serviceRate(
  key: string,
  name: string,
  meter: SourcePriceFact["meter"],
  unit: SourcePriceFact["unit"],
  input: {
    modelRefs?: string[];
    conditions?: SourcePriceFact["conditions"];
  } = {},
): RateSpec {
  return {
    bookKey: `service:${key}`,
    bookName: name,
    resourceKey: key,
    ...(input.modelRefs === undefined ? {} : { modelRefs: input.modelRefs }),
    offerKey: "usage",
    offerName: name,
    meter,
    unit,
    ...(input.conditions === undefined ? {} : { conditions: input.conditions }),
  };
}

function getFact(facts: Map<string, MutableFact>, spec: RateSpec): MutableFact {
  const identity = `${spec.bookKey}\0${spec.offerKey}`;
  const current = facts.get(identity);
  if (current !== undefined) return current;
  const created: MutableFact = {
    book_key: spec.bookKey,
    book_name: spec.bookName,
    resource_kind: spec.resourceKind ?? "service",
    resource_key: spec.resourceKey,
    model_refs: spec.modelRefs ?? [],
    offer_key: spec.offerKey,
    offer_name: spec.offerName,
    billing_mode: spec.billingMode ?? "usage",
    pricing_state: "numeric",
    price_facts: [],
    raw_price_facts: [],
  };
  facts.set(identity, created);
  return created;
}

function addRawFact(facts: Map<string, MutableFact>, price: EmbeddedPrice, input: Input): void {
  const page = price.path.split("/").filter(Boolean).at(-1) ?? "foundry";
  const spec: RateSpec = {
    bookKey: `service:unresolved:${page}`,
    bookName: `Unresolved ${page} commercial terms`,
    resourceKey: `unresolved:${page}`,
    modelRefs: [...input.modelRefs],
    offerKey: slug(`${price.table}-${price.row}`),
    offerName: [price.table, price.row].filter(Boolean).join(" — "),
    meter: "subscription",
    unit: "unit",
  };
  const fact = getFact(facts, spec);
  const values = [...new Set(Object.values(price.regional))];
  fact.raw_price_facts.push(rawFact(price, input.sourceId, values.join(", ")));
  input.onPricingReconciliation?.({
    disposition: "raw",
    reason_code: "commercial_public_price_unresolved",
    sample: sample(price),
  });
}

function addContentSafetyAllowances(
  facts: Map<string, MutableFact>,
  body: string,
  input: Input,
): void {
  const text = htmlText(load(body)("body").text());
  for (const [modality, pattern] of [
    ["text", /5,000\s+text records per month/i],
    ["image", /5,000\s+images per month/i],
  ] as const) {
    const match = text.match(pattern)?.[0];
    if (match === undefined) continue;
    const spec = serviceRate(
      "content-safety",
      "Content Safety",
      "content_safety",
      "thousand_items",
      {
        modelRefs: [...input.modelRefs],
      },
    );
    const fact = getFact(facts, {
      ...spec,
      offerKey: `free-${modality}`,
      offerName: `Free ${modality} allowance`,
    });
    fact.pricing_state = "included";
    fact.raw_price_facts.push({
      term_key: `free-${modality}-allowance`,
      impact: "allowance",
      reason: "unknown_applicability",
      conditions: { account_eligibility: "free", modality },
      source_ref: input.sourceId,
      raw: { fragment: match },
    });
  }
}

function rawFact(price: EmbeddedPrice, sourceRef: string, amount: string): SourceRawPricingFact {
  return {
    term_key: slug(`${price.table}-${price.row}-${price.header}-${price.segment}`),
    impact: "base_price",
    reason: "unknown_meter",
    conditions: {},
    source_ref: sourceRef,
    raw: {
      label: sample(price),
      amount,
      denomination: "USD",
      unit: `${price.header} ${price.segment}`.trim(),
    },
  };
}

function deploymentConditions(label: string): SourcePriceFact["conditions"] {
  const deployment_scope = /data zones?/i.test(label)
    ? "DataZone"
    : /global/i.test(label)
      ? "Global"
      : /regional/i.test(label)
        ? "Regional"
        : undefined;
  return deployment_scope === undefined ? {} : { deployment_scope };
}

function sample(price: EmbeddedPrice): string {
  return [price.table, price.row, price.header, price.segment]
    .filter(Boolean)
    .join(" / ")
    .slice(0, 256);
}

function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "price"
  );
}
