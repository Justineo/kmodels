import { load } from "cheerio";
import { z } from "zod";
import type { LinkedBundle } from "./bundle.ts";
import { attachCommercialFacts, rawPricingFact, scaleDecimal } from "./pricing.ts";
import type { PricingReconciliationItem } from "./pricing-reconciliation.ts";
import type {
  ParsedProviderModel,
  SourceCommercialPricingFact,
  SourcePriceFact,
  SourceRawPricingFact,
} from "./pricing-source.ts";

interface Input {
  bundle: LinkedBundle;
  models: ParsedProviderModel[];
  sourceId: string;
  report?: (item: PricingReconciliationItem) => void;
}

const jobsHardwareSchema = z.array(
  z.object({
    name: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    prettyName: z.string().min(1),
    unitCostMicroUSD: z.number().int().nonnegative(),
    unitCostUSD: z.number().finite().nonnegative(),
    unitLabel: z.literal("minute"),
  }),
);

export function extractHuggingFaceCommercialFacts(input: Input): void {
  const documents = new Map(
    input.bundle.documents.map(({ url, body }) => [new URL(url).pathname, body]),
  );
  const facts: SourceCommercialPricingFact[] = [];
  const add = (values: SourceCommercialPricingFact[]): void => {
    facts.push(...values);
  };

  companion(
    input,
    documents,
    "/docs/inference-endpoints/en/support/pricing.md",
    "endpoint_pricing_drift",
    ["billed per minute", "initializing", "running", "| Provider | Instance Type |"],
    (body) => add(endpointFacts(input, body)),
  );
  companion(
    input,
    documents,
    "/docs/hub/en/spaces-gpus.md",
    "spaces_hardware_pricing_drift",
    [
      "Billing on Spaces is based on hardware usage",
      "computed by the minute",
      "Starting",
      "Running",
    ],
    (body) => add(spacesFacts(input, body)),
  );
  companion(input, documents, "/api/jobs/hardware", "jobs_hardware_pricing_drift", [], (body) =>
    add(jobsHardwareFacts(input, body)),
  );
  companion(
    input,
    documents,
    "/docs/hub/en/jobs-pricing.md",
    "jobs_service_pricing_drift",
    ["computed by the minute", "Starting or Running", "Exposed ports", "$0.01"],
    (body) => add(jobsServiceFacts(input, body)),
  );
  companion(
    input,
    documents,
    "/docs/hub/en/spaces-zerogpu.md",
    "zerogpu_pricing_drift",
    ["Included daily GPU quota", "$1 per 10 minutes", "resets exactly 24 hours", "2×"],
    (body) => add(zeroGpuFacts(input, body)),
  );
  companion(
    input,
    documents,
    "/docs/hub/en/storage-limits.md",
    "storage_pricing_drift",
    ["Public Storage add-on", "Private storage Pay-as-you-go", "$18/TB/mo"],
    (body) => add(storageFacts(input, body)),
  );

  const enterprise = documents.get("/enterprise");
  companion(
    input,
    documents,
    "/pricing",
    "hub_plan_pricing_drift",
    ["PRO Account", "Team", "Enterprise"],
    (body) => add(planFacts(input, body, enterprise)),
  );

  const inferencePricing = documents.get("/docs/inference-providers/en/pricing.md");
  if (inferencePricing === undefined)
    input.report?.({
      disposition: "unbound",
      reason_code: "inference_provider_billing_drift_missing",
      sample: "/docs/inference-providers/en/pricing.md",
    });
  else add(inferenceProviderFacts(input, inferencePricing));

  attachCommercialFacts(input.models, facts);
}

function companion(
  input: Input,
  documents: ReadonlyMap<string, string>,
  path: string,
  reason: string,
  required: readonly string[],
  extract: (body: string) => void,
): void {
  const body = documents.get(path);
  if (body === undefined) {
    input.report?.({ disposition: "unbound", reason_code: `${reason}_missing`, sample: path });
    return;
  }
  if (required.some((value) => !body.includes(value)))
    input.report?.({ disposition: "unbound", reason_code: reason, sample: path });
  try {
    extract(body);
  } catch (error) {
    input.report?.({
      disposition: "unsupported",
      reason_code: reason,
      sample: `${path}: ${error instanceof Error ? error.message : String(error)}`.slice(0, 256),
    });
  }
}

function endpointFacts(input: Input, body: string): SourceCommercialPricingFact[] {
  const facts: SourceCommercialPricingFact[] = [];
  const monthlyExample = /monthly[\s\S]{0,160}?\$([0-9]+(?:\.[0-9]+)?)\/hr/i.exec(body)?.[1];
  for (const row of markdownRows(body)) {
    if (row.length < 4 || !/^(?:aws|azure|gcp)$/i.test(clean(row[0] ?? ""))) continue;
    const rawRow = row.join(" | ");
    const provider = clean(row[0] ?? "").toLowerCase();
    const type = clean(row[1] ?? "");
    const size = clean(row[2] ?? "");
    const amount = dollars(row[3]);
    if (type === "" || size === "" || amount === undefined) continue;
    if (/deprecated/i.test(rawRow)) {
      input.report?.({
        disposition: "excluded",
        reason_code: "deprecated_endpoint_capacity_excluded",
        sample: `${provider}:${type}:${size}`,
      });
      continue;
    }
    const key = `${provider}:${type}:${size}`;
    const exampleConflict =
      key === "aws:intel-spr:x2" && monthlyExample !== undefined && monthlyExample !== amount;
    if (exampleConflict)
      input.report?.({
        disposition: "ambiguous",
        reason_code: "endpoint_capacity_example_conflict",
        sample: `${key}: $${amount}/hour vs $${monthlyExample}/hour`,
      });
    facts.push(
      commercial(input, {
        bookKey: "capacity:inference-endpoints",
        bookName: "Inference Endpoints hardware",
        resourceKind: "capacity",
        resourceKey: "inference-endpoints",
        offerKey: key,
        offerName: `Inference Endpoint ${provider} ${type} ${size}`,
        billingMode: "capacity",
        state: "numeric",
        rates: [rate(input, "compute", amount, "hour", { capacity: key })],
        rawFacts: exampleConflict
          ? [
              raw(
                input,
                "endpoint_monthly_example",
                "informational",
                "superseded_value",
                {
                  amount: `$${monthlyExample}/hour`,
                  label: "The exact current capacity table owns the normalized hourly amount",
                },
                { capacity: key },
                "exact_capacity_table_over_monthly_example",
              ),
            ]
          : [],
      }),
    );
  }
  if (facts.length === 0) throw new Error("no current Endpoint capacity rows");
  return facts;
}

function spacesFacts(input: Input, body: string): SourceCommercialPricingFact[] {
  const facts: SourceCommercialPricingFact[] = [];
  for (const row of markdownRows(body)) {
    if (row.length < 6) continue;
    const name = clean(row[0] ?? "");
    const price = clean(row.at(-1) ?? "");
    if (name === "" || /removed|deprecated/i.test(row.join(" | "))) continue;
    const key = slug(name);
    if (/^free!?$/i.test(price)) {
      facts.push(
        commercial(input, {
          bookKey: "capacity:spaces-hardware",
          bookName: "Spaces hardware",
          resourceKind: "capacity",
          resourceKey: "spaces-hardware",
          offerKey: key,
          offerName: name,
          billingMode: "capacity",
          state: "free",
        }),
      );
      continue;
    }
    const amount = dollars(price);
    if (amount === undefined) continue;
    facts.push(
      commercial(input, {
        bookKey: "capacity:spaces-hardware",
        bookName: "Spaces hardware",
        resourceKind: "capacity",
        resourceKey: "spaces-hardware",
        offerKey: key,
        offerName: name,
        billingMode: "capacity",
        state: "numeric",
        rates: [rate(input, "compute", amount, "hour", { capacity: key })],
      }),
    );
  }
  if (facts.length === 0) throw new Error("no Spaces hardware rows");
  return facts;
}

function jobsHardwareFacts(input: Input, body: string): SourceCommercialPricingFact[] {
  const payload = z.array(z.unknown()).parse(JSON.parse(body));
  const seen = new Set<string>();
  return payload.flatMap((item, index) => {
    const parsed = jobsHardwareSchema.element.safeParse(item);
    if (!parsed.success) {
      input.report?.({
        disposition: "excluded",
        reason_code: "invalid_jobs_hardware_row",
        sample: `item:${index}`,
      });
      return [];
    }
    const { name, prettyName, unitCostMicroUSD, unitCostUSD } = parsed.data;
    if (seen.has(name)) {
      input.report?.({
        disposition: "excluded",
        reason_code: "duplicate_jobs_hardware_sku",
        sample: name,
      });
      return [];
    }
    seen.add(name);
    const amount = scaleDecimal(String(unitCostMicroUSD), -6);
    const conflict = Number(amount) !== unitCostUSD;
    if (conflict)
      input.report?.({
        disposition: "ambiguous",
        reason_code: "jobs_hardware_amount_conflict",
        sample: name,
      });
    return [
      commercial(input, {
        bookKey: "capacity:jobs-hardware",
        bookName: "Jobs hardware",
        resourceKind: "capacity",
        resourceKey: "jobs-hardware",
        offerKey: name,
        offerName: prettyName,
        billingMode: "capacity",
        state: "numeric",
        rates: [rate(input, "compute", amount, "minute", { capacity: name })],
        rawFacts: conflict
          ? [
              raw(
                input,
                "jobs_hardware_decimal_projection",
                "informational",
                "superseded_value",
                {
                  amount: `$${unitCostUSD}/minute`,
                  label: "The integer micro-USD API field owns the normalized amount",
                },
                { capacity: name },
              ),
            ]
          : [],
      }),
    ];
  });
}

function jobsServiceFacts(input: Input, body: string): SourceCommercialPricingFact[] {
  const match =
    /Exposed ports[\s\S]{0,400}?\|\s*Exposed ports\s*\|\s*\$([0-9]+(?:\.[0-9]+)?)/i.exec(body);
  const amount = match?.[1];
  if (amount === undefined) throw new Error("exposed-port rate missing");
  return [
    commercial(input, {
      bookKey: "service:jobs-exposed-ports",
      bookName: "Jobs exposed ports",
      resourceKind: "service",
      resourceKey: "jobs-exposed-ports",
      offerKey: "per-job",
      offerName: "One or more exposed ports per Job",
      billingMode: "usage",
      state: "numeric",
      rates: [rate(input, "compute", amount, "hour")],
    }),
  ];
}

function zeroGpuFacts(input: Input, body: string): SourceCommercialPricingFact[] {
  const facts: SourceCommercialPricingFact[] = [];
  const tiers = new Map<string, { key: string; paid: boolean }>([
    ["Unauthenticated", { key: "anonymous", paid: false }],
    ["Free account", { key: "free", paid: false }],
    ["PRO account", { key: "pro", paid: true }],
    ["Team organization member", { key: "team", paid: true }],
    ["Enterprise organization member", { key: "enterprise", paid: true }],
  ]);
  for (const row of markdownRows(body)) {
    const label = clean(row[0] ?? "");
    const tier = tiers.get(label);
    if (tier === undefined) continue;
    const minutes = /^(\d+) minutes/.exec(clean(row[1] ?? ""))?.[1];
    if (minutes === undefined) {
      input.report?.({
        disposition: "excluded",
        reason_code: "invalid_zerogpu_allowance",
        sample: label,
      });
      continue;
    }
    facts.push(
      commercial(input, {
        bookKey: "capacity:zerogpu",
        bookName: "Spaces ZeroGPU",
        resourceKind: "capacity",
        resourceKey: "zerogpu",
        offerKey: tier.key,
        offerName: `${label} daily quota`,
        billingMode: "hybrid",
        state: tier.paid ? "numeric" : "included",
        rates: tier.paid
          ? [
              {
                ...rate(input, "compute", "0.1", "minute", {
                  account_eligibility: tier.key,
                }),
                derived: true,
                derivation: "$1 per 10 GPU minutes divided by 10",
              },
            ]
          : [],
        rawFacts: [
          raw(
            input,
            "daily_gpu_minutes",
            "allowance",
            "unsupported_structure",
            {
              amount: minutes,
              unit: "GPU minutes",
              label: `${minutes} included GPU minutes; resets 24 hours after first usage; xlarge consumes 2× quota`,
            },
            { account_eligibility: tier.key },
          ),
          raw(
            input,
            "xlarge_quota_multiplier",
            "allowance",
            "requires_usage_aggregation",
            { label: "xlarge ZeroGPU consumes 2× the published GPU-minute quota" },
            { account_eligibility: tier.key },
          ),
        ],
      }),
    );
  }
  if (facts.length === 0) throw new Error("no ZeroGPU account tiers");
  return facts;
}

function storageFacts(input: Input, body: string): SourceCommercialPricingFact[] {
  const facts: SourceCommercialPricingFact[] = [];
  const publicSection = section(body, "### Public Storage add-on", "### Private storage");
  for (const row of markdownRows(publicSection)) {
    const capacity = /^(\d+) TB$/.exec(clean(row[0] ?? ""))?.[1];
    const amount = dollars(row[1]);
    if (capacity === undefined || amount === undefined) continue;
    facts.push(
      commercial(input, {
        bookKey: "service:public-storage-addon",
        bookName: "Public storage add-on",
        resourceKind: "service",
        resourceKey: "public-storage-addon",
        offerKey: `${capacity}tb`,
        offerName: `${capacity} TB public storage add-on`,
        billingMode: "subscription",
        state: "numeric",
        rates: [
          rate(input, "storage", amount, "unit_month", {
            account_eligibility: "paid-plan",
            capacity: `${capacity}tb`,
          }),
        ],
      }),
    );
  }
  const privateSection = section(body, "### Private storage Pay-as-you-go");
  for (const row of markdownRows(privateSection)) {
    const band = clean(row[0] ?? "");
    const amount = /\$([0-9]+(?:\.[0-9]+)?)\/TB\/mo/i.exec(clean(row[1] ?? ""))?.[1];
    if (!/^(?:Base|\d+TB\+)$/.test(band) || amount === undefined) continue;
    facts.push(
      commercial(input, {
        bookKey: "service:private-storage",
        bookName: "Private storage pay-as-you-go",
        resourceKind: "service",
        resourceKey: "private-storage",
        offerKey: slug(band),
        offerName: `${band} private storage overage`,
        billingMode: "usage",
        state: "not_published",
        rawFacts: [
          raw(
            input,
            "private_storage_tb_month",
            "base_price",
            "unknown_unit",
            {
              amount: `$${amount}/TB/mo`,
            },
            { capacity: band },
          ),
        ],
      }),
    );
  }
  if (facts.length === 0) throw new Error("no storage rates");
  return facts;
}

function planFacts(
  input: Input,
  pricingBody: string,
  enterpriseBody: string | undefined,
): SourceCommercialPricingFact[] {
  const $ = load(pricingBody);
  const amount = (heading: string): string | undefined => {
    const element = $("h3")
      .filter((_index, element) => $(element).text().trim() === heading)
      .first()
      .parents()
      .toArray()
      .find(
        (ancestor) =>
          $(ancestor).find("h3").length === 1 &&
          /\$[0-9]+(?:\.[0-9]+)?\s*\/month/i.test($(ancestor).text()),
      );
    return element === undefined
      ? undefined
      : /\$([0-9]+(?:\.[0-9]+)?)\s*\/month/i.exec($(element).text())?.[1];
  };
  const pro = amount("PRO Account");
  const team = amount("Team");
  const enterprise = amount("Enterprise");
  const facts: SourceCommercialPricingFact[] = [];
  for (const [key, name, price, capacity] of [
    ["pro", "PRO Account", pro, "per-account"],
    ["team", "Team", team, "per-user"],
  ] as const)
    if (price === undefined)
      input.report?.({
        disposition: "unbound",
        reason_code: "hub_plan_amount_missing",
        sample: key,
      });
    else facts.push(plan(input, key, name, price, capacity));
  const custom =
    enterpriseBody !== undefined && /Custom pricing/i.test(load(enterpriseBody).text());
  if (!custom) {
    input.report?.({
      disposition: "unbound",
      reason_code: "enterprise_procurement_scope_missing",
      sample: "/enterprise",
    });
  }
  facts.push(
    commercial(input, {
      bookKey: "plan:hub",
      bookName: "Hugging Face Hub plans",
      resourceKind: "plan",
      resourceKey: "hub-plan",
      offerKey: "enterprise",
      offerName: "Enterprise",
      billingMode: "subscription",
      state: custom ? "custom_quote" : "not_published",
      rawFacts:
        enterprise === undefined
          ? []
          : [
              raw(input, "enterprise_public_card", "base_price", "unknown_applicability", {
                amount: `$${enterprise}/month per user`,
                label:
                  "The general pricing card publishes a representative amount while the dedicated Enterprise surface says custom pricing",
              }),
            ],
    }),
  );
  if (custom && enterprise !== undefined)
    input.report?.({
      disposition: "ambiguous",
      reason_code: "enterprise_plan_price_conflict",
      sample: `$${enterprise}/month/user vs custom pricing`,
    });
  if (facts.length === 0) throw new Error("no Hub plan pricing claims");
  return facts;
}

function plan(
  input: Input,
  key: string,
  name: string,
  amount: string,
  capacity: string,
): SourceCommercialPricingFact {
  return commercial(input, {
    bookKey: "plan:hub",
    bookName: "Hugging Face Hub plans",
    resourceKind: "plan",
    resourceKey: "hub-plan",
    offerKey: key,
    offerName: name,
    billingMode: "subscription",
    state: "numeric",
    rates: [rate(input, "subscription", amount, "unit_month", { capacity })],
  });
}

function inferenceProviderFacts(input: Input, body: string): SourceCommercialPricingFact[] {
  const refs = input.models.map(({ uid }) => uid);
  const facts: SourceCommercialPricingFact[] = [];
  if (body.includes("Hugging Face won't charge you for the call"))
    facts.push(
      commercial(input, {
        bookKey: "account:custom-provider-key",
        bookName: "Custom provider key",
        resourceKind: "account_resource_template",
        resourceKey: "custom-provider-key",
        modelRefs: refs,
        offerKey: "external-provider-billing",
        offerName: "Direct provider billing",
        billingMode: "usage",
        state: "externally_billed",
      }),
    );
  else
    input.report?.({
      disposition: "unbound",
      reason_code: "custom_provider_key_billing_drift",
    });

  if (body.includes("compute time x price of the underlying hardware"))
    facts.push(
      commercial(input, {
        bookKey: "service:hf-inference",
        bookName: "HF Inference serverless compute",
        resourceKind: "service",
        resourceKey: "hf-inference",
        modelRefs: input.models
          .filter((model) =>
            [...model.price_facts, ...model.raw_price_facts].some(
              ({ conditions }) => conditions.route_provider === "hf-inference",
            ),
          )
          .map(({ uid }) => uid),
        offerKey: "serverless",
        offerName: "HF Inference serverless execution",
        billingMode: "usage",
        state: "not_published",
        rawFacts: [
          raw(input, "compute_time_hardware_join", "base_price", "unknown_amount", {
            label:
              "Billed compute time × underlying hardware price; the public model route does not expose the hardware/time join",
          }),
        ],
      }),
    );
  else
    input.report?.({
      disposition: "unbound",
      reason_code: "hf_inference_compute_billing_drift",
    });
  return facts;
}

interface CommercialOptions {
  bookKey: string;
  bookName: string;
  resourceKind: SourceCommercialPricingFact["resource_kind"];
  resourceKey: string;
  modelRefs?: string[];
  offerKey: string;
  offerName: string;
  billingMode: SourceCommercialPricingFact["billing_mode"];
  state: SourceCommercialPricingFact["pricing_state"];
  rates?: SourcePriceFact[];
  rawFacts?: SourceRawPricingFact[];
}

function commercial(input: Input, options: CommercialOptions): SourceCommercialPricingFact {
  return {
    source_ref: input.sourceId,
    book_key: options.bookKey,
    book_name: options.bookName,
    resource_kind: options.resourceKind,
    resource_key: options.resourceKey,
    model_refs: options.modelRefs ?? [],
    offer_key: options.offerKey,
    offer_name: options.offerName,
    billing_mode: options.billingMode,
    pricing_state: options.state,
    price_facts: options.rates ?? [],
    raw_price_facts: options.rawFacts ?? [],
  };
}

function rate(
  input: Input,
  meter: SourcePriceFact["meter"],
  price: string,
  unit: SourcePriceFact["unit"],
  conditions: SourcePriceFact["conditions"] = {},
): SourcePriceFact {
  return {
    meter,
    price,
    currency: "USD",
    unit,
    conditions,
    source_ref: input.sourceId,
    derived: false,
    raw_price: `$${price}`,
    raw_unit: unit,
  };
}

function raw(
  input: Input,
  termKey: string,
  impact: SourceRawPricingFact["impact"],
  reason: SourceRawPricingFact["reason"],
  value: SourceRawPricingFact["raw"],
  conditions: SourceRawPricingFact["conditions"] = {},
  resolutionPolicy?: string,
): SourceRawPricingFact {
  return rawPricingFact(
    input.sourceId,
    termKey,
    impact,
    reason,
    value,
    conditions,
    resolutionPolicy,
  );
}

function markdownRows(body: string): string[][] {
  return body
    .split(/\r?\n/)
    .filter((line) => /^\s*\|.*\|\s*$/.test(line))
    .map((line) =>
      line
        .trim()
        .slice(1, -1)
        .split("|")
        .map((cell) => cell.trim()),
    )
    .filter((row) => !row.every((cell) => /^:?-{2,}:?$/.test(cell.replaceAll(" ", ""))));
}

function clean(value: string): string {
  return value
    .replaceAll("~~", "")
    .replaceAll("*", "")
    .replaceAll("`", "")
    .replace(/^_+|_+$/g, "")
    .trim();
}

function dollars(value: string | undefined): string | undefined {
  return value === undefined ? undefined : /\$([0-9]+(?:\.[0-9]+)?)/.exec(clean(value))?.[1];
}

function slug(value: string): string {
  return clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function section(body: string, start: string, end?: string): string {
  const from = body.indexOf(start);
  if (from < 0) return "";
  const tail = body.slice(from + start.length);
  const to = end === undefined ? -1 : tail.indexOf(end);
  return to < 0 ? tail : tail.slice(0, to);
}
