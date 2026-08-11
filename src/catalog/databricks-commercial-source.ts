import { z } from "zod";
import type { LinkedBundle } from "./bundle.ts";
import type { PricingReconciliationItem } from "./pricing-reconciliation.ts";
import { multiplyDecimal } from "./pricing.ts";
import type { SourceCommercialPricingFact, SourceRawPricingFact } from "./pricing-source.ts";

type Reconcile = (item: PricingReconciliationItem) => void;

interface Card {
  key: string;
  title: string;
  subtitle?: string;
  description?: string;
}

interface CardTerm {
  key: string;
  label: string;
  unit: string;
  impact?: SourceRawPricingFact["impact"];
}

interface CardSpec {
  page: string;
  key: string;
  title: string;
  bookKey: string;
  bookName: string;
  resourceKey: string;
  offerKey: string;
  offerName: string;
  billingMode: SourceCommercialPricingFact["billing_mode"];
  terms: readonly CardTerm[];
  regionModels?: boolean;
}

const pagePrefix = "/en-pricing-assets/page-data/product/pricing/";
const cardsPath = "/en-pricing-assets/data/pricing/cards.json";
const months = new Map(
  [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
  ].flatMap((month, index) => [
    [month, String(index + 1).padStart(2, "0")],
    [month.slice(0, 3), String(index + 1).padStart(2, "0")],
  ]),
);
const recordSchema = z.record(z.string(), z.unknown());
const cardSchema = z.object({
  fieldKey: z.string().min(1),
  fieldTitle: z.string().min(1),
  fieldSubtitle: z.string().nullable().optional(),
  fieldDescription: z.object({ processed: z.string() }).nullable().optional(),
});

const cardSpecs: readonly CardSpec[] = [
  {
    page: "ai-gateway",
    key: "payload_logging",
    title: "Inference Tables",
    bookKey: "service:ai-gateway",
    bookName: "Unity AI Gateway",
    resourceKey: "ai-gateway",
    offerKey: "inference-tables",
    offerName: "Inference Tables",
    billingMode: "usage",
    terms: [
      { key: "payload_gb", label: "Payload data", unit: "GB" },
      { key: "payload_tokens", label: "Payload tokens", unit: "million tokens" },
    ],
  },
  {
    page: "ai-gateway",
    key: "usage_tracking",
    title: "Usage Tracking",
    bookKey: "service:ai-gateway",
    bookName: "Unity AI Gateway",
    resourceKey: "ai-gateway",
    offerKey: "usage-tracking",
    offerName: "Usage Tracking",
    billingMode: "usage",
    terms: [
      { key: "payload_gb", label: "Usage payload data", unit: "GB" },
      { key: "payload_tokens", label: "Tracked tokens", unit: "million tokens" },
    ],
  },
  {
    page: "agent-bricks",
    key: "knowledge_assistant_answers",
    title: "Knowledge Assistant",
    bookKey: "service:agent-bricks",
    bookName: "Agent Bricks",
    resourceKey: "agent-bricks",
    offerKey: "knowledge-assistant",
    offerName: "Knowledge Assistant answers",
    billingMode: "usage",
    terms: [{ key: "knowledge_answer", label: "Knowledge-backed answer", unit: "answer" }],
  },
  {
    page: "agent-bricks",
    key: "supervisor_agent_step_usage",
    title: "Supervisor Agent",
    bookKey: "service:agent-bricks",
    bookName: "Agent Bricks",
    resourceKey: "agent-bricks",
    offerKey: "supervisor-agent",
    offerName: "Supervisor Agent steps",
    billingMode: "usage",
    terms: [{ key: "supervisor_step", label: "Supervisor step", unit: "step" }],
  },
  {
    page: "ai-search",
    key: "vector_search_standard",
    title: "AI Search Standard",
    bookKey: "service:ai-search",
    bookName: "AI Search",
    resourceKey: "ai-search",
    offerKey: "standard",
    offerName: "AI Search Standard",
    billingMode: "hybrid",
    terms: [
      { key: "compute", label: "Search compute unit", unit: "unit-hour" },
      { key: "storage", label: "Search storage", unit: "GB-month" },
    ],
  },
  {
    page: "ai-search",
    key: "vector_search_storage_optimized",
    title: "AI Search Storage Optimized",
    bookKey: "service:ai-search",
    bookName: "AI Search",
    resourceKey: "ai-search",
    offerKey: "storage-optimized",
    offerName: "AI Search Storage Optimized",
    billingMode: "hybrid",
    terms: [
      { key: "compute", label: "Search compute unit", unit: "unit-hour" },
      { key: "storage", label: "Search storage", unit: "GB-month" },
    ],
  },
  {
    page: "agent-evaluation",
    key: "agent_evaluation",
    title: "Agent Evaluation",
    bookKey: "service:agent-evaluation",
    bookName: "Agent Evaluation",
    resourceKey: "agent-evaluation",
    offerKey: "evaluation",
    offerName: "Agent Evaluation",
    billingMode: "usage",
    regionModels: true,
    terms: [
      { key: "judge_input", label: "Judge input", unit: "million input tokens" },
      { key: "judge_output", label: "Judge output", unit: "million output tokens" },
    ],
  },
  {
    page: "agent-evaluation",
    key: "synthetic_data_for_agent_evaluation",
    title: "Agent Evaluation Synthetic Data",
    bookKey: "service:agent-evaluation",
    bookName: "Agent Evaluation",
    resourceKey: "agent-evaluation",
    offerKey: "synthetic-questions",
    offerName: "Synthetic questions",
    billingMode: "usage",
    terms: [{ key: "synthetic_question", label: "Synthetic question", unit: "question" }],
  },
  {
    page: "model-serving",
    key: "serverless_real-time_inference",
    title: "CPU Serving",
    bookKey: "service:model-serving",
    bookName: "Model Serving",
    resourceKey: "model-serving",
    offerKey: "cpu-serving",
    offerName: "CPU Serving",
    billingMode: "capacity",
    terms: [
      {
        key: "list_price_settlement",
        label: "Serverless Real-time Inference list price",
        unit: "DBU",
        impact: "informational",
      },
    ],
  },
  {
    page: "model-serving",
    key: "foundation_model_apis",
    title: "GPU Serving",
    bookKey: "service:model-serving",
    bookName: "Model Serving",
    resourceKey: "model-serving",
    offerKey: "gpu-serving",
    offerName: "GPU Serving",
    billingMode: "capacity",
    terms: [
      {
        key: "list_price_settlement",
        label: "Serverless Real-time Inference list price",
        unit: "DBU",
        impact: "informational",
      },
    ],
  },
  {
    page: "ai-runtime",
    key: "A10 On Demand",
    title: "A10 On Demand",
    bookKey: "service:ai-runtime",
    bookName: "AI Runtime",
    resourceKey: "ai-runtime",
    offerKey: "a10",
    offerName: "A10 On Demand",
    billingMode: "capacity",
    terms: [{ key: "gpu_runtime", label: "A10 runtime", unit: "GPU-hour" }],
  },
  {
    page: "ai-runtime",
    key: "H100 On Demand",
    title: "H100 On Demand",
    bookKey: "service:ai-runtime",
    bookName: "AI Runtime",
    resourceKey: "ai-runtime",
    offerKey: "h100",
    offerName: "H100 On Demand",
    billingMode: "capacity",
    terms: [{ key: "gpu_runtime", label: "H100 runtime", unit: "GPU-hour" }],
  },
  {
    page: "foundation-model-training",
    key: "foundation_model_training",
    title: "Model Training - fine-tuning",
    bookKey: "service:model-training",
    bookName: "Foundation Model Training",
    resourceKey: "model-training",
    offerKey: "foundation-model-training",
    offerName: "Foundation Model Training",
    billingMode: "usage",
    terms: [
      {
        key: "list_price_settlement",
        label: "Model Training list price",
        unit: "DBU",
        impact: "informational",
      },
    ],
  },
  {
    page: "foundation-model-training",
    key: "model_training_-_forecasting",
    title: "Model Training - forecasting",
    bookKey: "service:model-training",
    bookName: "Foundation Model Training",
    resourceKey: "model-training",
    offerKey: "forecasting",
    offerName: "Model Training - Forecasting",
    billingMode: "usage",
    terms: [
      {
        key: "list_price_settlement",
        label: "Model Training list price",
        unit: "DBU",
        impact: "informational",
      },
    ],
  },
  ...["ai_parse_document", "ai_extract", "ai_classify"].map(
    (key): CardSpec => ({
      page: "ai-functions",
      key,
      title:
        key === "ai_parse_document"
          ? "AI Parse Document"
          : key === "ai_extract"
            ? "AI Extract"
            : "AI Classify",
      bookKey: "service:ai-functions",
      bookName: "AI Functions",
      resourceKey: "ai-functions",
      offerKey: key.replaceAll("_", "-"),
      offerName: key,
      billingMode: "usage",
      terms: [
        {
          key: "list_price_settlement",
          label: "AI Functions list price",
          unit: "DBU",
          impact: "informational",
        },
      ],
    }),
  ),
  ...["Genie One", "Genie Agents", "Genie Code"].map(
    (title): CardSpec => ({
      page: "genie",
      key: "serverless_real-time_inference",
      title,
      bookKey: "service:genie",
      bookName: "Genie",
      resourceKey: "genie",
      offerKey: title.toLowerCase().replaceAll(" ", "-"),
      offerName: title,
      billingMode: "hybrid",
      terms: [
        {
          key: "list_price_settlement",
          label: "Genie LLM list price",
          unit: "DBU",
          impact: "informational",
        },
      ],
    }),
  ),
  {
    page: "genie",
    key: "coming_soon",
    title: "Genie Ontology",
    bookKey: "service:genie",
    bookName: "Genie",
    resourceKey: "genie",
    offerKey: "ontology",
    offerName: "Genie Ontology",
    billingMode: "usage",
    terms: [],
  },
];

function record(value: unknown): Record<string, unknown> | undefined {
  const result = recordSchema.safeParse(value);
  return result.success ? result.data : undefined;
}

function document(bundle: LinkedBundle, pathname: string): string | undefined {
  const matches = bundle.documents.filter(({ url }) => new URL(url).pathname === pathname);
  return matches.length === 1 ? matches[0]?.body : undefined;
}

function cards(value: unknown, result: Card[] = []): Card[] {
  const parsed = cardSchema.safeParse(value);
  if (parsed.success)
    result.push({
      key: parsed.data.fieldKey,
      title: parsed.data.fieldTitle,
      ...(parsed.data.fieldSubtitle === undefined || parsed.data.fieldSubtitle === null
        ? {}
        : { subtitle: parsed.data.fieldSubtitle }),
      ...(parsed.data.fieldDescription?.processed === undefined
        ? {}
        : { description: parsed.data.fieldDescription.processed }),
    });
  if (Array.isArray(value)) for (const item of value) cards(item, result);
  else {
    const object = record(value);
    if (object !== undefined) for (const item of Object.values(object)) cards(item, result);
  }
  return result;
}

function pageCards(body: string): Card[] | undefined {
  try {
    const value: unknown = JSON.parse(body);
    const unique = new Map(cards(value).map((card) => [`${card.key}\0${card.title}`, card]));
    return [...unique.values()];
  } catch {
    return undefined;
  }
}

function rawFact(
  sourceRef: string,
  term: CardTerm,
  amount: string,
  conditions: SourceRawPricingFact["conditions"],
): SourceRawPricingFact {
  return {
    term_key: term.key,
    impact: term.impact ?? "base_price",
    reason: term.key === "list_price_settlement" ? "requires_usage_aggregation" : "unknown_meter",
    conditions,
    source_ref: sourceRef,
    raw: {
      label: term.label,
      amount,
      denomination: "USD",
      unit: term.unit,
    },
  };
}

function cardTermFact(
  sourceRef: string,
  term: CardTerm,
  value: unknown,
  conditions: SourceRawPricingFact["conditions"],
): SourceRawPricingFact {
  if (typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value))
    return rawFact(sourceRef, term, value, conditions);
  return {
    term_key: term.key,
    impact: term.impact ?? "base_price",
    reason: typeof value === "string" ? "unknown_amount" : "unsupported_structure",
    conditions,
    source_ref: sourceRef,
    raw: {
      label: term.label,
      ...(typeof value === "string" ? { amount: value } : {}),
      denomination: "USD",
      unit: term.unit,
    },
  };
}

function promotionEnd(value: string | undefined): string | undefined {
  const match = value?.match(/([A-Z]+)\s+(\d{1,2}),\s+(\d{4})/i);
  const month = match?.[1] === undefined ? undefined : months.get(match[1].toLowerCase());
  if (month === undefined || match?.[2] === undefined || match[3] === undefined) return;
  return `${match[3]}-${month}-${match[2].padStart(2, "0")}`;
}

function nextDate(value: string): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function genieVariants(
  card: Card,
  facts: SourceRawPricingFact[],
  sourceRef: string,
): SourceRawPricingFact[] {
  const until = promotionEnd(card.subtitle);
  if (until === undefined) return facts;
  const standard = facts.map((item) => ({
    ...item,
    conditions: { ...item.conditions, effective_from: nextDate(until) },
  }));
  if (/\bFREE\b/i.test(card.subtitle ?? ""))
    return [
      ...standard,
      {
        term_key: "free_promotion",
        impact: "base_price",
        reason: "unknown_meter",
        conditions: { promotion: true, effective_until: until },
        source_ref: sourceRef,
        raw: {
          label: `${card.title} LLM promotion`,
          amount: "0",
          denomination: "USD",
          unit: "DBU",
          validity: card.subtitle,
        },
      },
    ];
  if (/SAVE 25%/i.test(card.subtitle ?? ""))
    return [
      ...standard,
      ...facts.map((item) => ({
        ...item,
        conditions: { ...item.conditions, promotion: true, effective_until: until },
        raw: {
          ...item.raw,
          ...(item.raw.amount === undefined
            ? {}
            : { amount: multiplyDecimal(item.raw.amount, "0.75") }),
          formula: "75% of the displayed list-price factor",
          validity: card.subtitle,
        },
      })),
    ];
  return facts;
}

function regionKey(value: string): string {
  return (
    value
      .toLowerCase()
      .match(/[a-z0-9]+/g)
      ?.join("_") ?? value
  );
}

function scalarVariants(
  root: Record<string, unknown>,
  spec: CardSpec,
  sourceRef: string,
): SourceRawPricingFact[] {
  const facts: SourceRawPricingFact[] = [];
  for (const plan of ["standard", "premium", "enterprise"]) {
    const clouds = record(root[plan]);
    if (clouds === undefined) continue;
    for (const [cloud, productsValue] of Object.entries(clouds)) {
      const products = record(productsValue);
      const regions = products === undefined ? undefined : record(products[spec.key]);
      if (regions === undefined) continue;
      for (const [region, value] of Object.entries(regions)) {
        if (typeof value !== "string") continue;
        const amounts = value.split("|");
        const conditions = {
          deployment_scope: cloud.toLowerCase(),
          service_tier: plan,
          region: regionKey(region),
        };
        if (amounts.length !== spec.terms.length) {
          facts.push({
            term_key: "unreviewed_card_value",
            impact: "base_price",
            reason: "unsupported_structure",
            conditions,
            source_ref: sourceRef,
            raw: { label: spec.title, amount: value, denomination: "USD" },
          });
          continue;
        }
        for (const [index, term] of spec.terms.entries()) {
          const amount = amounts[index];
          if (term !== undefined) facts.push(cardTermFact(sourceRef, term, amount, conditions));
        }
      }
    }
  }
  return facts;
}

function regionModelVariants(
  root: Record<string, unknown>,
  spec: CardSpec,
  sourceRef: string,
): SourceRawPricingFact[] {
  const regionModels = record(root["regionModels"]);
  const facts: SourceRawPricingFact[] = [];
  if (regionModels === undefined) return facts;
  for (const [cloud, productsValue] of Object.entries(regionModels)) {
    const products = record(productsValue);
    const regions = products === undefined ? undefined : record(products[spec.key]);
    if (regions === undefined) continue;
    for (const [region, value] of Object.entries(regions)) {
      const prices = record(value);
      const amounts = [prices?.["inputPrice"], prices?.["outputPrice"]];
      const conditions = { deployment_scope: cloud.toLowerCase(), region: regionKey(region) };
      for (const [index, term] of spec.terms.entries()) {
        const amount = amounts[index];
        if (term !== undefined) facts.push(cardTermFact(sourceRef, term, amount, conditions));
      }
    }
  }
  return facts;
}

function unreviewedVariants(
  root: Record<string, unknown>,
  card: Card,
  sourceRef: string,
): SourceRawPricingFact[] {
  const facts: SourceRawPricingFact[] = [];
  for (const plan of ["standard", "premium", "enterprise"]) {
    const clouds = record(root[plan]);
    if (clouds === undefined) continue;
    for (const [cloud, productsValue] of Object.entries(clouds)) {
      const products = record(productsValue);
      const regions = products === undefined ? undefined : record(products[card.key]);
      if (regions === undefined) continue;
      for (const [region, value] of Object.entries(regions)) {
        if (typeof value !== "string") continue;
        facts.push({
          term_key: "unreviewed_card_value",
          impact: "base_price",
          reason: "unsupported_structure",
          conditions: {
            deployment_scope: cloud.toLowerCase(),
            service_tier: plan,
            region: regionKey(region),
          },
          source_ref: sourceRef,
          raw: {
            label: `${card.title} (${card.key})`,
            amount: value,
            ...(card.description === undefined ? {} : { fragment: card.description }),
          },
        });
      }
    }
  }
  if (facts.length > 0) return facts;
  return [
    {
      term_key: "unreviewed_card",
      impact: "base_price",
      reason: "unsupported_structure",
      conditions: {},
      source_ref: sourceRef,
      raw: {
        label: `${card.title} (${card.key})`,
        ...(card.description === undefined ? {} : { fragment: card.description }),
      },
    },
  ];
}

function fact(
  spec: CardSpec,
  sourceRef: string,
  rawPriceFacts: SourceRawPricingFact[],
  pricingState: SourceCommercialPricingFact["pricing_state"] = rawPriceFacts.length > 0
    ? "numeric"
    : "not_published",
): SourceCommercialPricingFact {
  return {
    source_ref: sourceRef,
    book_key: spec.bookKey,
    book_name: spec.bookName,
    resource_kind: "service",
    resource_key: spec.resourceKey,
    model_refs: [],
    offer_key: spec.offerKey,
    offer_name: spec.offerName,
    billing_mode: spec.billingMode,
    pricing_state: pricingState,
    price_facts: [],
    raw_price_facts: rawPriceFacts,
  };
}

function pageFragments(body: string): string[] {
  try {
    const value: unknown = JSON.parse(body);
    const result: string[] = [];
    const visit = (item: unknown): void => {
      if (typeof item === "string") result.push(item);
      else if (Array.isArray(item)) for (const child of item) visit(child);
      else {
        const object = record(item);
        if (object !== undefined) for (const child of Object.values(object)) visit(child);
      }
    };
    visit(value);
    return result;
  } catch {
    return [];
  }
}

function plain(value: string): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&amp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extraFacts(bundle: LinkedBundle, sourceRef: string): SourceCommercialPricingFact[] {
  const result: SourceCommercialPricingFact[] = [];
  const add = (
    spec: CardSpec,
    term: SourceRawPricingFact,
    billingMode: SourceCommercialPricingFact["billing_mode"] = spec.billingMode,
    pricingState?: SourceCommercialPricingFact["pricing_state"],
  ) => result.push(fact({ ...spec, billingMode }, sourceRef, [term], pricingState));
  const addInformation = (
    spec: CardSpec,
    key: string,
    label: string,
    fragment: string,
    pricingState?: SourceCommercialPricingFact["pricing_state"],
  ) =>
    add(
      spec,
      {
        term_key: key,
        impact: "informational",
        reason: "requires_usage_aggregation",
        conditions: {},
        source_ref: sourceRef,
        raw: { label, fragment: plain(fragment) },
      },
      spec.billingMode,
      pricingState,
    );

  const agentBricks = document(bundle, `${pagePrefix}agent-bricks/page-data.json`);
  if (agentBricks !== undefined) {
    const fragments = pageFragments(agentBricks);
    for (const [offerKey, pattern, key] of [
      [
        "knowledge-assistant",
        /Only charged for answers that require accessing/i,
        "native_components",
      ],
      ["supervisor-agent", /Plus charges for all sub-agents/i, "sub_agent_charges"],
    ] as const) {
      const spec = cardSpecs.find(
        ({ page, offerKey: offer }) => page === "agent-bricks" && offer === offerKey,
      );
      const fragment = fragments.find((value) => pattern.test(value));
      if (spec !== undefined && fragment !== undefined)
        addInformation(spec, key, spec.offerName, fragment);
    }
  }

  const aiFunctions = document(bundle, `${pagePrefix}ai-functions/page-data.json`);
  if (aiFunctions !== undefined) {
    const estimate = pageFragments(aiFunctions).find((value) =>
      /Estimated SRTI DBUs|Estimated DBUs for 1K inputs/i.test(value),
    );
    const spec = cardSpecs.find(({ page }) => page === "ai-functions");
    if (spec !== undefined && estimate !== undefined)
      addInformation(
        { ...spec, offerKey: "published-estimates", offerName: "Published workload estimates" },
        "workload_estimates",
        "Complexity-dependent AI Functions estimates",
        estimate,
        "not_published",
      );
  }

  const modelServing = document(bundle, `${pagePrefix}model-serving/page-data.json`);
  if (modelServing !== undefined) {
    const fragments = pageFragments(modelServing).join(" ");
    const cpu = fragments.match(
      /Standard workloads will be billed at (\d+(?:\.\d+)?) DBU per hour/i,
    )?.[1];
    const spec = cardSpecs.find(
      ({ page, offerKey }) => page === "model-serving" && offerKey === "cpu-serving",
    );
    if (cpu !== undefined && spec !== undefined)
      add(
        spec,
        {
          term_key: "cpu_capacity",
          impact: "base_price",
          reason: "unknown_meter",
          conditions: {},
          source_ref: sourceRef,
          raw: { label: "Standard CPU workload", amount: cpu, denomination: "DBU", unit: "hour" },
        },
        "capacity",
      );

    for (const fragment of pageFragments(modelServing)) {
      if (!/GPU configuration/i.test(fragment) || !/DBUs\s*\/\s*hour/i.test(fragment)) continue;
      const rows = [
        ...fragment.matchAll(
          /<tr[^>]*>\s*<td[^>]*>(.*?)<\/td>\s*<td[^>]*>(\d+(?:\.\d+)?)<\/td>\s*<\/tr>/gis,
        ),
      ];
      const gpuSpec = cardSpecs.find(
        ({ page, offerKey }) => page === "model-serving" && offerKey === "gpu-serving",
      );
      if (gpuSpec === undefined) continue;
      for (const row of rows) {
        const configuration = row[1]
          ?.replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        const amount = row[2];
        if (configuration === undefined || configuration === "" || amount === undefined) continue;
        add(
          gpuSpec,
          {
            term_key: "gpu_capacity",
            impact: "base_price",
            reason: "unknown_meter",
            conditions: { capacity: configuration },
            source_ref: sourceRef,
            raw: { label: configuration, amount, denomination: "DBU", unit: "GPU instance hour" },
          },
          "capacity",
        );
      }
    }
  }

  const search = document(bundle, `${pagePrefix}ai-search/page-data.json`);
  const searchSpec = cardSpecs.find(
    ({ page, offerKey }) => page === "ai-search" && offerKey === "standard",
  );
  if (search !== undefined && searchSpec !== undefined) {
    const sourceFragments = pageFragments(search);
    const fragments = sourceFragments.join(" ");
    if (/first 30 GB free/i.test(fragments))
      add(
        searchSpec,
        {
          term_key: "storage_allowance",
          impact: "allowance",
          reason: "unknown_meter",
          conditions: { billing_period: "monthly" },
          source_ref: sourceRef,
          raw: { label: "AI Search Standard storage allowance", amount: "30", unit: "GB" },
        },
        "hybrid",
      );
    const reranker = fragments.match(
      /Reranker queries will incur a charge of (\d+(?:\.\d+)?) DBUs?\s*\/\s*1k queries/i,
    )?.[1];
    if (reranker !== undefined)
      add(
        {
          ...searchSpec,
          offerKey: "reranker",
          offerName: "AI Search reranker",
          billingMode: "usage",
        },
        {
          term_key: "reranker_queries",
          impact: "base_price",
          reason: "unknown_meter",
          conditions: {},
          source_ref: sourceRef,
          raw: {
            label: "Reranker queries",
            amount: reranker,
            denomination: "DBU",
            unit: "1k queries",
          },
        },
        "usage",
      );
    const composition = sourceFragments.find((value) =>
      /AI Search incurs charges for/i.test(value),
    );
    if (composition !== undefined)
      addInformation(searchSpec, "native_components", "AI Search native components", composition);
  }

  const training = document(bundle, `${pagePrefix}foundation-model-training/page-data.json`);
  const forecastSpec = cardSpecs.find(
    ({ page, offerKey }) => page === "foundation-model-training" && offerKey === "forecasting",
  );
  if (training !== undefined && forecastSpec !== undefined) {
    const amount = pageFragments(training)
      .join(" ")
      .match(
        /forecasting service will be billed at a rate of (\d+(?:\.\d+)?) DBUs? per hour/i,
      )?.[1];
    if (amount !== undefined)
      add(forecastSpec, {
        term_key: "forecasting_compute",
        impact: "base_price",
        reason: "unknown_meter",
        conditions: {},
        source_ref: sourceRef,
        raw: { label: "Forecasting training", amount, denomination: "DBU", unit: "hour" },
      });
    const estimate = pageFragments(training).find((value) => /Approximate DBUs/i.test(value));
    const trainingSpec = cardSpecs.find(
      ({ page, offerKey }) =>
        page === "foundation-model-training" && offerKey === "foundation-model-training",
    );
    if (estimate !== undefined && trainingSpec !== undefined)
      addInformation(
        trainingSpec,
        "training_estimates",
        "Model- and data-dependent training estimates",
        estimate,
      );
  }

  const genie = document(bundle, `${pagePrefix}genie/page-data.json`);
  if (genie !== undefined) {
    const fragments = pageFragments(genie).join(" ");
    if (/150 DBUs of free usage every month/i.test(fragments)) {
      const spec = cardSpecs.find(({ page, title }) => page === "genie" && title === "Genie Code");
      if (spec !== undefined)
        add(
          {
            ...spec,
            offerKey: "shared-monthly-allowance",
            offerName: "Shared monthly Genie allowance",
          },
          {
            term_key: "genie_dbu_allowance",
            impact: "allowance",
            reason: "unknown_meter",
            conditions: { billing_period: "monthly", account_eligibility: "named_user" },
            source_ref: sourceRef,
            raw: { label: "Shared named-user Genie LLM allowance", amount: "150", unit: "DBU" },
          },
          "hybrid",
          "included",
        );
    }
    const compute = pageFragments(genie).find((value) =>
      /underlying compute costs, billed separately/i.test(value),
    );
    const spec = cardSpecs.find(({ page, title }) => page === "genie" && title === "Genie One");
    if (compute !== undefined && spec !== undefined)
      addInformation(spec, "underlying_compute", "Underlying Genie compute", compute);
  }

  result.push({
    source_ref: sourceRef,
    book_key: "account:dbu-settlement",
    book_name: "Databricks DBU settlement",
    resource_kind: "account_resource_template",
    resource_key: "dbu-settlement",
    model_refs: [],
    offer_key: "effective-list",
    offer_name: "Effective list price",
    billing_mode: "usage",
    pricing_state: "not_published",
    price_facts: [],
    raw_price_facts: [
      {
        term_key: "effective_list",
        impact: "informational",
        reason: "unknown_amount",
        conditions: { account_eligibility: "account_price_table" },
        source_ref: sourceRef,
        raw: {
          label: "system.billing.list_prices pricing.effective_list",
          unit: "USD per DBU",
          fragment:
            "Join the exact SKU, cloud, usage unit, and effective interval to billable DBUs.",
        },
      },
    ],
  });
  return result;
}

export function databricksCommercialFacts(
  bundle: LinkedBundle,
  sourceRef: string,
  onPricingReconciliation?: Reconcile,
): SourceCommercialPricingFact[] {
  const cardsBody = document(bundle, cardsPath);
  if (cardsBody === undefined) {
    onPricingReconciliation?.({
      disposition: "unsupported",
      reason_code: "pricing_cards_unavailable",
      sample: cardsPath,
    });
    return [];
  }
  let root: Record<string, unknown>;
  try {
    root = recordSchema.parse(JSON.parse(cardsBody));
  } catch {
    onPricingReconciliation?.({
      disposition: "unsupported",
      reason_code: "pricing_cards_invalid",
      sample: cardsPath,
    });
    return [];
  }

  const result: SourceCommercialPricingFact[] = [];
  for (const page of new Set(cardSpecs.map(({ page }) => page))) {
    const pathname = `${pagePrefix}${page}/page-data.json`;
    const body = document(bundle, pathname);
    const observed = body === undefined ? undefined : pageCards(body);
    if (observed === undefined) {
      onPricingReconciliation?.({
        disposition: "unsupported",
        reason_code: "pricing_page_data_invalid",
        sample: page,
      });
      continue;
    }
    const identities = new Set(observed.map(({ key, title }) => `${key}\0${title}`));
    for (const spec of cardSpecs.filter((candidate) => candidate.page === page)) {
      if (!identities.has(`${spec.key}\0${spec.title}`)) {
        onPricingReconciliation?.({
          disposition: "unsupported",
          reason_code: "pricing_card_identity_drifted",
          sample: `${page}: ${spec.title}`,
        });
        continue;
      }
      const card = observed.find(({ key, title }) => key === spec.key && title === spec.title);
      let raw = spec.regionModels
        ? regionModelVariants(root, spec, sourceRef)
        : scalarVariants(root, spec, sourceRef);
      if (page === "genie" && card !== undefined && spec.offerKey !== "ontology")
        raw = genieVariants(card, raw, sourceRef);
      result.push(fact(spec, sourceRef, raw));
      onPricingReconciliation?.({
        disposition: raw.length > 0 ? "normalized" : "explicit_non_numeric",
        reason_code:
          raw.length > 0 ? "provider_service_price_bound" : "provider_service_price_absent",
        sample: `${page}: ${spec.title}`,
      });
    }

    const reviewed = new Set(
      cardSpecs
        .filter((candidate) => candidate.page === page)
        .map(({ key, title }) => `${key}\0${title}`),
    );
    for (const card of observed.filter(({ key, title }) => !reviewed.has(`${key}\0${title}`))) {
      const resourceKey = `unreviewed:${page}:${regionKey(card.key)}:${regionKey(card.title)}`;
      result.push({
        source_ref: sourceRef,
        book_key: `service:${resourceKey}`,
        book_name: card.title,
        resource_kind: "service",
        resource_key: resourceKey,
        model_refs: [],
        offer_key: "unreviewed",
        offer_name: card.title,
        billing_mode: "usage",
        pricing_state: "not_published",
        price_facts: [],
        raw_price_facts: unreviewedVariants(root, card, sourceRef),
      });
      onPricingReconciliation?.({
        disposition: "unsupported",
        reason_code: "unreviewed_pricing_card",
        sample: `${page}: ${card.title} (${card.key})`,
      });
    }
  }
  result.push(...extraFacts(bundle, sourceRef));
  return result;
}
