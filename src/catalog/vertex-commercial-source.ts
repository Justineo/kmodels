import { load } from "cheerio";
import type {
  ParsedProviderModel,
  SourceCommercialPricingFact,
  SourcePriceFact,
  SourceRawPricingFact,
} from "./pricing-source.ts";
import { sourcePriceFactKey, sourceRawPricingFactKey } from "./pricing-source.ts";

type Fact = Omit<SourceCommercialPricingFact, "source_ref">;

interface Service {
  bookKey: string;
  name: string;
  resourceKey: string;
  meter: SourcePriceFact["meter"];
}

const services: Readonly<Record<string, Service>> = {
  google_search: {
    bookKey: "service:google-search",
    name: "Grounding with Google Search",
    resourceKey: "google-search",
    meter: "web_search",
  },
  google_image_search: {
    bookKey: "service:google-image-search",
    name: "Grounding with Google Image Search",
    resourceKey: "google-image-search",
    meter: "image_search",
  },
  google_maps: {
    bookKey: "service:google-maps",
    name: "Grounding with Google Maps",
    resourceKey: "google-maps",
    meter: "maps_search",
  },
  web_grounding_enterprise: {
    bookKey: "service:web-grounding-enterprise",
    name: "Web Grounding for Enterprise",
    resourceKey: "web-grounding-enterprise",
    meter: "web_search",
  },
  grounding_with_your_data: {
    bookKey: "service:grounded-generation",
    name: "Grounded Generation",
    resourceKey: "grounded-generation",
    meter: "grounded_generation",
  },
  web_search: {
    bookKey: "service:claude-web-search",
    name: "Claude Web Search",
    resourceKey: "claude-web-search",
    meter: "web_search",
  },
};

export function extractVertexCommercialFacts(
  models: Iterable<ParsedProviderModel>,
  sourceId: string,
  pricingBody?: string,
  resolveModelRefs?: (label: string) => string[],
  documents: readonly { url: string; body: string }[] = [],
): void {
  const facts = new Map<string, Fact>();
  const values = [...models];
  for (const model of values) {
    model.price_facts = model.price_facts.filter((rate) => {
      if (rate.meter === "cache_storage") {
        addRate(
          facts,
          resource(
            {
              bookKey: "service:explicit-cache-storage",
              name: "Explicit context cache storage",
              resourceKey: "explicit-cache-storage",
            },
            model,
            `storage:${model.uid}`,
            `Explicit cache storage for ${model.model_id}`,
          ),
          rate,
        );
        return false;
      }
      if (rate.meter !== "tool_call") return true;
      const service =
        rate.conditions.operation === undefined ? undefined : services[rate.conditions.operation];
      if (service === undefined) return true;
      addRate(
        facts,
        resource(service, model, `usage:${model.uid}`, `${service.name} for ${model.model_id}`),
        { ...rate, meter: service.meter },
      );
      return false;
    });
    model.raw_price_facts = model.raw_price_facts.filter((raw) => {
      if (!raw.term_key.startsWith("grounding_")) return true;
      const service =
        raw.conditions.operation === undefined ? undefined : services[raw.conditions.operation];
      if (service === undefined) return true;
      addRaw(
        facts,
        {
          ...resource(
            service,
            model,
            raw.impact === "allowance" ? "shared-allowance" : "billing-rules",
            raw.impact === "allowance"
              ? `${service.name} allowance`
              : `${service.name} billing rules`,
          ),
          pricing_state: raw.impact === "allowance" ? "included" : "not_published",
        },
        raw,
      );
      return false;
    });
  }
  if (sourceId === "vertex-google-models" && pricingBody !== undefined)
    addPlatformFacts(facts, values, sourceId, pricingBody, resolveModelRefs);
  if (sourceId === "vertex-google-models") {
    const agentSearch = documents.find(
      ({ url }) => new URL(url).pathname === "/generative-ai-app-builder/pricing",
    );
    if (agentSearch !== undefined) addAgentSearchFacts(facts, sourceId, agentSearch.body);
  }
  const carrier = values.sort((left, right) => left.uid.localeCompare(right.uid))[0];
  if (carrier === undefined || facts.size === 0) return;
  carrier.commercial_facts = [
    ...(carrier.commercial_facts ?? []),
    ...[...facts.values()].map((fact) => ({ source_ref: sourceId, ...fact })),
  ];
}

function addAgentSearchFacts(facts: Map<string, Fact>, sourceId: string, body: string): void {
  const value = text(load(body)("main").text());
  const service = {
    book_key: "service:agent-search",
    book_name: "Agent Search",
    resource_kind: "service" as const,
    resource_key: "agent-search",
    model_refs: [],
    billing_mode: "usage" as const,
    pricing_state: "numeric" as const,
  };
  for (const [offerKey, offerName, pattern, operation] of [
    [
      "general-standard",
      "General Standard Edition",
      /Search Standard Edition.*?\$([\d.]+)\s*\/\s*1,?000 quer(?:y|ies)/i,
      "general_standard",
    ],
    [
      "general-enterprise",
      "General Enterprise Edition",
      /Search Enterprise Edition.*?\$([\d.]+)\s*\/\s*1,?000 quer(?:y|ies)/i,
      "general_enterprise",
    ],
  ] as const) {
    const price = value.match(pattern)?.[1];
    if (price === undefined) continue;
    addRate(
      facts,
      {
        ...service,
        offer_key: offerKey,
        offer_name: offerName,
        price_facts: [],
        raw_price_facts: [],
      },
      {
        meter: "retrieval",
        price,
        currency: "USD",
        unit: "thousand_requests",
        conditions: { operation },
        source_ref: sourceId,
        derived: false,
        raw_price: `$${price}`,
        raw_unit: "1,000 queries",
      },
    );
  }
  const advanced = value.match(
    /Advanced Generative Answers.*?\+?\$([\d.]+)\s*\/\s*1,?000 user input quer(?:y|ies)/i,
  )?.[1];
  if (advanced !== undefined)
    addRate(
      facts,
      {
        ...service,
        offer_key: "advanced-generative-answers",
        offer_name: "Advanced Generative Answers",
        price_facts: [],
        raw_price_facts: [],
      },
      {
        meter: "grounded_generation",
        price: advanced,
        currency: "USD",
        unit: "thousand_requests",
        conditions: { operation: "advanced_generative_answers" },
        source_ref: sourceId,
        derived: false,
        raw_price: `$${advanced}`,
        raw_unit: "1,000 user input queries",
      },
    );
  const grounded = value.match(
    /Grounded Generation for grounding on your own retrieved data.*?\$([\d.]+)\s*\/\s*1,?000 count/i,
  )?.[1];
  if (grounded !== undefined) {
    const fact: Fact = {
      book_key: "service:grounded-generation",
      book_name: "Grounded Generation",
      resource_kind: "service",
      resource_key: "grounded-generation",
      model_refs: [],
      offer_key: "own-retrieved-data",
      offer_name: "Grounding on retrieved customer data",
      billing_mode: "usage",
      pricing_state: "numeric",
      price_facts: [],
      raw_price_facts: [],
    };
    addRate(facts, fact, {
      meter: "grounded_generation",
      price: grounded,
      currency: "USD",
      unit: "thousand_requests",
      conditions: { operation: "own_retrieved_data" },
      source_ref: sourceId,
      derived: false,
      raw_price: `$${grounded}`,
      raw_unit: "1,000 requests",
    });
    const retrieval = value.match(
      /additional charges for data retrieval are determined by the select retrieval system[^.]*\./i,
    )?.[0];
    if (retrieval !== undefined)
      addRaw(facts, fact, {
        term_key: "retrieval_charged_separately",
        impact: "informational",
        reason: "requires_usage_aggregation",
        conditions: { operation: "own_retrieved_data" },
        source_ref: sourceId,
        raw: { fragment: retrieval },
      });
  }
  const allowance = value.match(/10,000 queries per account, per month at no cost/i)?.[0];
  if (allowance !== undefined)
    for (const offerKey of ["general-standard", "general-enterprise"]) {
      const fact: Fact = {
        ...service,
        offer_key: offerKey,
        offer_name:
          offerKey === "general-standard"
            ? "General Standard Edition"
            : "General Enterprise Edition",
        price_facts: [],
        raw_price_facts: [],
      };
      addRaw(facts, fact, {
        term_key: "monthly_free_trial_queries",
        impact: "allowance",
        reason: "unsupported_structure",
        conditions: {},
        source_ref: sourceId,
        raw: { amount: "10000", unit: "queries per account per month", fragment: allowance },
      });
    }
}

function addPlatformFacts(
  facts: Map<string, Fact>,
  models: readonly ParsedProviderModel[],
  sourceId: string,
  body: string,
  resolveModelRefs: ((label: string) => string[]) | undefined,
): void {
  const $ = load(body);
  const normalizedBody = text($(".devsite-article-body").text());
  $(".devsite-article-body table").each((_index, element) => {
    const table = $(element);
    const headers = table
      .find("tr")
      .first()
      .find("th,td")
      .map((_cellIndex, cell) => text($(cell).text()))
      .get();
    const section = text(table.prevAll("h2").first().text());
    if (section === "Provisioned Throughput")
      addProvisionedThroughput(facts, sourceId, $, table, headers, normalizedBody);
    if (section === "Model Tuning") addTuning(facts, sourceId, $, table, headers, resolveModelRefs);
    if (text(table.prevAll("h2,h3").first().text()) === "Agents") {
      addAgentRates(facts, sourceId, $, table, headers);
      addAgentGrounding(facts, sourceId, $, table, headers);
    }
    const component = text(table.prevAll("h2,h3").first().text());
    if (component === "CodeMender" || component === "AlphaEvolve")
      addCompositeAgent(facts, sourceId, $, table, component, resolveModelRefs);
  });
  addTunedInferencePolicy(facts, models, sourceId, normalizedBody);
  addModelOptimizerPolicy(facts, sourceId, normalizedBody);
}

function addModelOptimizerPolicy(facts: Map<string, Fact>, sourceId: string, body: string): void {
  const fragment = body.match(
    /Agent Platform Model Optimizer applies dynamic pricing\..*?individual customer results may vary/i,
  )?.[0];
  if (fragment === undefined) return;
  const fact: Fact = {
    book_key: "service:model-optimizer",
    book_name: "Agent Platform Model Optimizer",
    resource_kind: "service",
    resource_key: "model-optimizer",
    model_refs: [],
    offer_key: "dynamic-routing",
    offer_name: "Dynamic model routing",
    billing_mode: "usage",
    pricing_state: "numeric",
    price_facts: [],
    raw_price_facts: [],
  };
  addRaw(facts, fact, {
    term_key: "dynamic_model_price",
    impact: "base_price",
    reason: "unknown_amount",
    conditions: {},
    source_ref: sourceId,
    raw: { fragment },
  });
  addRaw(facts, fact, {
    term_key: "one_dollar_sku_purchasing_unit",
    impact: "informational",
    reason: "unsupported_structure",
    conditions: {},
    source_ref: sourceId,
    raw: {
      amount: "1",
      denomination: "USD",
      unit: "SKU purchasing unit",
      fragment,
    },
  });
}

function addCompositeAgent(
  facts: Map<string, Fact>,
  sourceId: string,
  $: ReturnType<typeof load>,
  table: ReturnType<ReturnType<typeof load>>,
  name: "AlphaEvolve" | "CodeMender",
  resolveModelRefs: ((label: string) => string[]) | undefined,
): void {
  const resourceKey = name.toLowerCase();
  let modelRefs: string[] = [];
  let modelLabel = "";
  table
    .find("tr")
    .slice(1)
    .each((_rowIndex, row) => {
      const cells = $(row).find("th,td");
      if (cells.length < 2) return;
      const directLabel = text(cells.eq(0).text());
      const directRefs = resolveModelRefs?.(directLabel) ?? [];
      const descriptorIndex = directRefs.length > 0 ? 1 : 0;
      if (directRefs.length > 0) {
        modelRefs = directRefs;
        modelLabel = directLabel;
      }
      if (modelRefs.length === 0) return;
      const descriptor = text(cells.eq(descriptorIndex).text());
      const prices = cells
        .slice(descriptorIndex + 1)
        .map((_cellIndex, cell) =>
          text($(cell).text())
            .match(/\$([\d,.]+)/)?.[1]
            ?.replaceAll(",", ""),
        )
        .get()
        .filter((value): value is string => value !== undefined);
      const price = prices[name === "AlphaEvolve" ? prices.length - 2 : prices.length - 1];
      const meter: SourcePriceFact["meter"] | undefined = /cached/i.test(descriptor)
        ? "cache_read_text"
        : /output/i.test(descriptor)
          ? "output_text"
          : /input/i.test(descriptor)
            ? "input_text"
            : undefined;
      if (price === undefined || meter === undefined) return;
      const fact: Fact = {
        book_key: `service:${resourceKey}`,
        book_name: name,
        resource_kind: "service",
        resource_key: resourceKey,
        model_refs: modelRefs,
        offer_key: `${resourceKey}:${modelRefs.join("+")}`,
        offer_name: `${name} with ${modelLabel}`,
        billing_mode: "usage",
        pricing_state: "numeric",
        price_facts: [],
        raw_price_facts: [],
      };
      addRate(facts, fact, {
        meter,
        price,
        currency: "USD",
        unit: "million_tokens",
        conditions: { operation: resourceKey },
        source_ref: sourceId,
        derived: false,
        raw_price: price,
        raw_unit: descriptor,
      });
      const total = name === "AlphaEvolve" ? prices.at(-1) : undefined;
      if (total !== undefined)
        addRaw(facts, fact, {
          term_key: "published_total_example",
          impact: "informational",
          reason: "unsupported_structure",
          conditions: { operation: resourceKey },
          source_ref: sourceId,
          raw: {
            amount: total,
            denomination: "USD",
            unit: "per million tokens",
            label: `${modelLabel}; ${descriptor}; published total`,
          },
        });
    });
}

function addAgentRates(
  facts: Map<string, Fact>,
  sourceId: string,
  $: ReturnType<typeof load>,
  table: ReturnType<ReturnType<typeof load>>,
  headers: string[],
): void {
  if (
    headers[0] !== "Model" ||
    headers[1] !== "Type" ||
    !headers.some((header) => /Price \(\/1M tokens\)/i.test(header))
  )
    return;
  let agent = "";
  table
    .find("tr")
    .slice(1)
    .each((_rowIndex, row) => {
      const cells = $(row).find("th,td");
      if (cells.length < 2) return;
      const first = text(cells.eq(0).text());
      const ownsIdentity = /\bAgent\b/i.test(first);
      if (ownsIdentity) agent = first;
      if (agent === "") return;
      const descriptorIndex = ownsIdentity ? 1 : 0;
      const descriptor = text(cells.eq(descriptorIndex).text());
      const offset = headers.length - cells.length;
      cells.slice(descriptorIndex + 1).each((cellIndex, cell) => {
        const header = headers[descriptorIndex + 1 + cellIndex + offset] ?? "";
        const price = text($(cell).text())
          .match(/\$([\d,.]+)/)?.[1]
          ?.replaceAll(",", "");
        if (price === undefined) return;
        const cached = /cached/i.test(header);
        const meter: SourcePriceFact["meter"] | undefined = /output/i.test(descriptor)
          ? cached
            ? undefined
            : "output_text"
          : /input/i.test(descriptor)
            ? cached
              ? "cache_read_text"
              : "input_text"
            : undefined;
        if (meter === undefined) return;
        const key = agent
          .toLowerCase()
          .replaceAll(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "");
        addRate(
          facts,
          {
            book_key: `service:agent:${key}`,
            book_name: agent,
            resource_kind: "service",
            resource_key: `agent:${key}`,
            model_refs: [],
            offer_key: "execution",
            offer_name: `${agent} execution`,
            billing_mode: "usage",
            pricing_state: "numeric",
            price_facts: [],
            raw_price_facts: [],
          },
          {
            meter,
            price,
            currency: "USD",
            unit: "million_tokens",
            conditions: { operation: key },
            source_ref: sourceId,
            derived: false,
            raw_price: text($(cell).text()),
            raw_unit: header,
          },
        );
      });
    });
}

function addAgentGrounding(
  facts: Map<string, Fact>,
  sourceId: string,
  $: ReturnType<typeof load>,
  table: ReturnType<ReturnType<typeof load>>,
  headers: string[],
): void {
  if (headers.join("\0") !== "Feature\0Pricing") return;
  table
    .find("tr")
    .slice(1)
    .each((_rowIndex, row) => {
      const cells = $(row).find("th,td");
      const label = text(cells.eq(0).text());
      const raw = text(cells.eq(1).text());
      const operations = /Google Search.*Web Grounding/i.test(label)
        ? ["google_search", "web_grounding_enterprise"]
        : /your data/i.test(label)
          ? ["grounding_with_your_data"]
          : [];
      const price = raw.match(/\$([\d,.]+)\s+per\s+(?:1,?000|1000)/i)?.[1]?.replaceAll(",", "");
      if (operations.length === 0 || price === undefined) return;
      for (const operation of operations) {
        const service = services[operation];
        if (service === undefined) continue;
        const fact: Fact = {
          book_key: service.bookKey,
          book_name: service.name,
          resource_kind: "service",
          resource_key: service.resourceKey,
          model_refs: [],
          offer_key: "agent:gemini-deep-research-agent",
          offer_name: `${service.name} for Gemini Deep Research Agent`,
          billing_mode: "usage",
          pricing_state: "numeric",
          price_facts: [],
          raw_price_facts: [],
        };
        addRate(facts, fact, {
          meter: service.meter,
          price,
          currency: "USD",
          unit:
            operation === "grounding_with_your_data"
              ? "thousand_requests"
              : "thousand_search_units",
          conditions: { operation },
          source_ref: sourceId,
          derived: false,
          raw_price: raw,
          raw_unit: operation === "grounding_with_your_data" ? "1,000 prompts" : "1,000 queries",
        });
        if (/at no (?:additional )?charge|at no charge/i.test(raw))
          addRaw(facts, fact, {
            term_key: "grounding_allowance",
            impact: "allowance",
            reason: "unsupported_structure",
            conditions: { operation },
            source_ref: sourceId,
            raw: { label, fragment: raw },
          });
        if (/charged for each individual|Input tokens .* are not charged/i.test(raw))
          addRaw(facts, fact, {
            term_key: "grounding_billing_rule",
            impact: "informational",
            reason: "unsupported_structure",
            conditions: { operation },
            source_ref: sourceId,
            raw: { label, fragment: raw },
          });
      }
    });
}

function addProvisionedThroughput(
  facts: Map<string, Fact>,
  sourceId: string,
  $: ReturnType<typeof load>,
  table: ReturnType<ReturnType<typeof load>>,
  headers: string[],
  body: string,
): void {
  if (headers.join("\0") !== "Duration\0Price per GSU\0Per") return;
  const fact: Fact = {
    book_key: "capacity:provisioned-throughput",
    book_name: "Provisioned Throughput",
    resource_kind: "capacity",
    resource_key: "provisioned-throughput",
    model_refs: [],
    offer_key: "commitment",
    offer_name: "Provisioned Throughput commitment",
    billing_mode: "capacity",
    pricing_state: "numeric",
    price_facts: [],
    raw_price_facts: [],
  };
  table
    .find("tr")
    .slice(1)
    .each((_rowIndex, row) => {
      const cells = $(row).find("th,td");
      if (cells.length < 3) return;
      const duration = text(cells.eq(0).text());
      const raw = text(cells.eq(1).text());
      const per = text(cells.eq(2).text());
      const unit = /^Week$/i.test(per)
        ? "unit_week"
        : /^Month$/i.test(per)
          ? "unit_month"
          : undefined;
      if (unit === undefined) return;
      for (const match of raw.matchAll(/\$([\d,.]+)\s*\((Global|Non-Global)\)/gi)) {
        const price = match[1]?.replaceAll(",", "");
        const scope = match[2]?.toLowerCase();
        if (price === undefined || (scope !== "global" && scope !== "non-global")) continue;
        addRate(facts, fact, {
          meter: "provisioned_throughput",
          price,
          currency: "USD",
          unit,
          conditions: {
            deployment_scope: scope,
            billing_period: duration.toLowerCase().replaceAll(/[^a-z0-9]+/g, "_"),
            ...(scope === "non-global" && /July 1, 2026/i.test(body)
              ? { effective_from: "2026-07-01" }
              : {}),
          },
          source_ref: sourceId,
          derived: false,
          raw_price: match[0],
          raw_unit: `${duration}; per ${per}`,
        });
      }
    });
}

function addTuning(
  facts: Map<string, Fact>,
  sourceId: string,
  $: ReturnType<typeof load>,
  table: ReturnType<ReturnType<typeof load>>,
  headers: string[],
  resolveModelRefs: ((label: string) => string[]) | undefined,
): void {
  const priceHeader = headers.find((header) =>
    /Price \(\/1M training (tokens|characters)\)/i.test(header),
  );
  if (headers[0] !== "Model" || headers[1] !== "Type" || priceHeader === undefined) return;
  const unit = /characters/i.test(priceHeader) ? "million_characters" : "million_tokens";
  table
    .find("tr")
    .slice(1)
    .each((_rowIndex, row) => {
      const cells = $(row).find("th,td");
      if (cells.length < 3) return;
      const label = text(cells.eq(0).text());
      const modelRefs = resolveModelRefs?.(label) ?? [];
      const price = text(cells.last().text())
        .match(/\$([\d,.]+)/)?.[1]
        ?.replaceAll(",", "");
      if (modelRefs.length === 0 || price === undefined) return;
      const methods = lines(cells.eq(1));
      for (const method of methods.length === 0 ? ["model_tuning"] : methods) {
        const operation = method
          .toLowerCase()
          .replaceAll(/[^a-z0-9]+/g, "_")
          .replace(/^_|_$/g, "");
        addRate(
          facts,
          {
            book_key: "service:model-tuning",
            book_name: "Model Tuning",
            resource_kind: "service",
            resource_key: "model-tuning",
            model_refs: modelRefs,
            offer_key: `training:${modelRefs.join("+")}:${operation}`,
            offer_name: `${method} for ${label}`,
            billing_mode: "usage",
            pricing_state: "numeric",
            price_facts: [],
            raw_price_facts: [],
          },
          {
            meter: "training_input",
            price,
            currency: "USD",
            unit,
            conditions: { operation },
            source_ref: sourceId,
            derived: false,
            raw_price: text(cells.last().text()),
            raw_unit: priceHeader,
          },
        );
      }
    });
}

function addTunedInferencePolicy(
  facts: Map<string, Fact>,
  models: readonly ParsedProviderModel[],
  sourceId: string,
  body: string,
): void {
  const fragment = body.match(
    /Starting from Gemini 3, tuned model endpoint prediction price will be 1\.5 times of the base model\. Old [^.]*models[^.]*price stays same as the base model\./i,
  )?.[0];
  if (fragment === undefined) return;
  const modelRefs = models
    .filter(({ model_id }) => /^gemini-3(?:[.-]|$)/.test(model_id))
    .map(({ uid }) => uid);
  if (modelRefs.length === 0) return;
  addRaw(
    facts,
    {
      book_key: "account:tuned-model",
      book_name: "Tuned model endpoint",
      resource_kind: "account_resource_template",
      resource_key: "tuned-model",
      model_refs: modelRefs,
      offer_key: "inference",
      offer_name: "Tuned-model inference",
      billing_mode: "usage",
      pricing_state: "numeric",
      price_facts: [],
      raw_price_facts: [],
    },
    {
      term_key: "gemini_3_tuned_inference_multiplier",
      impact: "base_price",
      reason: "requires_usage_aggregation",
      conditions: { operation: "tuned_inference" },
      source_ref: sourceId,
      raw: { amount: "1.5", unit: "times base-model prediction price", fragment },
    },
  );
}

function lines(cell: ReturnType<ReturnType<typeof load>>): string[] {
  const clone = cell.clone();
  clone.find("br").replaceWith("\n");
  return clone
    .text()
    .split("\n")
    .map(text)
    .filter((value) => value !== "");
}

function text(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function resource(
  service: Pick<Service, "bookKey" | "name" | "resourceKey">,
  model: ParsedProviderModel,
  offerKey: string,
  offerName: string,
): Fact {
  return {
    book_key: service.bookKey,
    book_name: service.name,
    resource_kind: "service",
    resource_key: service.resourceKey,
    model_refs: [model.uid],
    offer_key: offerKey,
    offer_name: offerName,
    billing_mode: "usage",
    pricing_state: "numeric",
    price_facts: [],
    raw_price_facts: [],
  };
}

function addRate(facts: Map<string, Fact>, fact: Fact, rate: SourcePriceFact): void {
  const current = addFact(facts, fact);
  if (
    !current.price_facts.some(
      (candidate) => sourcePriceFactKey(candidate) === sourcePriceFactKey(rate),
    )
  )
    current.price_facts.push(rate);
}

function addRaw(facts: Map<string, Fact>, fact: Fact, raw: SourceRawPricingFact): void {
  const current = addFact(facts, fact);
  if (
    !current.raw_price_facts.some(
      (candidate) => sourceRawPricingFactKey(candidate) === sourceRawPricingFactKey(raw),
    )
  )
    current.raw_price_facts.push(raw);
}

function addFact(facts: Map<string, Fact>, fact: Fact): Fact {
  const key = `${fact.book_key}\0${fact.offer_key}`;
  const current = facts.get(key);
  if (current === undefined) {
    facts.set(key, fact);
    return fact;
  }
  current.model_refs = [...new Set([...current.model_refs, ...fact.model_refs])].sort();
  return current;
}
