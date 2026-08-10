import { publishedRate } from "./pricing.ts";
import type { PricingReconciliationItem } from "./pricing-reconciliation.ts";
import type {
  ParsedProviderModel,
  SourceCommercialPricingFact,
  SourcePriceFact,
  SourceRawPricingFact,
} from "./pricing-source.ts";

export interface CohereCommercialProduct {
  modelName: string;
  per: string;
  labels: string[];
  description: string;
}

interface LinkedDocument {
  url: string;
  body: string;
}

interface Input {
  documents: readonly LinkedDocument[];
  embedJobModelIds: ReadonlySet<string>;
  models: ReadonlyMap<string, ParsedProviderModel>;
  products: readonly CohereCommercialProduct[];
  reconcile?: (item: PricingReconciliationItem) => void;
  resolve: (label: string, keepDate?: boolean) => ParsedProviderModel[];
  sourceId: string;
}

interface MarkdownTable {
  headers: string[];
  rows: string[][];
}

const standardPricingPath = "/docs/model-vault/standard/pricing.md";
const encryptedPricingPath = "/docs/model-vault/encrypted/pricing.md";

export function extractCohereCommercialFacts(input: Input): void {
  const facts: SourceCommercialPricingFact[] = [];
  addEvaluationAccess(input, facts);
  addProductOffers(input, facts);
  addStandardVault(input, facts);
  addEncryptedVault(input, facts);
  addAsyncServices(input, facts);
  addProviderServices(input, facts);
  validateVaultCompanions(input);
  const carrier = [...input.models.values()].sort((left, right) =>
    left.uid.localeCompare(right.uid),
  )[0];
  if (carrier !== undefined && facts.length > 0)
    carrier.commercial_facts = [...(carrier.commercial_facts ?? []), ...facts];
}

function addEvaluationAccess(input: Input, facts: SourceCommercialPricingFact[]): void {
  const body = companion(input, "/docs/rate-limits.md", [
    /evaluation keys \(free but limited in usage\).*production keys \(paid/i,
  ]);
  if (body === undefined) return;
  const modelRefs = [...input.models.values()]
    .filter(({ api_endpoints, status }) => status !== "retired" && (api_endpoints?.length ?? 0) > 0)
    .map(({ uid }) => uid)
    .sort();
  if (modelRefs.length === 0) return;
  facts.push({
    ...resource(
      input.sourceId,
      "plan:hosted-api-access",
      "Cohere hosted API access",
      "plan",
      "hosted-api-access",
      modelRefs,
      "evaluation",
      "Evaluation API access",
      "usage",
    ),
    pricing_state: "free",
    price_facts: [],
    raw_price_facts: [
      raw(
        input.sourceId,
        "evaluation_limits",
        "informational",
        "unknown_applicability",
        "Evaluation keys are free but limited; exact model and account rate limits remain enrollment state",
      ),
    ],
  });
  input.reconcile?.({
    disposition: "explicit_non_numeric",
    reason_code: "evaluation_api_access_free",
  });
}

function addProductOffers(input: Input, facts: SourceCommercialPricingFact[]): void {
  for (const product of input.products) {
    const labels = product.labels.map((label) => label.toLowerCase());
    const matches = input.resolve(product.modelName);
    if (product.per === "Free" && labels.some((label) => label.includes("model download"))) {
      if (matches.length !== 1) {
        reconcileMatch(input, product.modelName, matches);
        continue;
      }
      const current = matches[0]!;
      facts.push({
        ...resource(
          input.sourceId,
          `distribution:${current.uid}`,
          `${current.name} model weights`,
          "distribution",
          `model-download:${current.uid}`,
          [current.uid],
          "download",
          "Model download",
          "one_time",
        ),
        pricing_state: "free",
        price_facts: [],
        raw_price_facts: [],
      });
      input.reconcile?.({
        disposition: "explicit_non_numeric",
        reason_code: "model_download_free",
        sample: current.model_id,
      });
    }

    if (
      matches.length === 0 &&
      /custom enterprise pricing|contact (?:our )?(?:team|sales)/i.test(product.description) &&
      /^(?:North|Compass)\b/i.test(product.modelName)
    ) {
      const key = product.modelName.toLowerCase().startsWith("north") ? "north" : "compass";
      facts.push({
        ...resource(
          input.sourceId,
          `service:${key}`,
          `Cohere ${key === "north" ? "North" : "Compass"}`,
          "service",
          key,
          [],
          "enterprise",
          `${key === "north" ? "North" : "Compass"} enterprise service`,
          "subscription",
        ),
        pricing_state: "custom_quote",
        price_facts: [],
        raw_price_facts: [],
      });
      input.reconcile?.({
        disposition: "explicit_non_numeric",
        reason_code: "provider_service_custom_quote",
        sample: product.modelName,
      });
    }

    if (product.modelName === "Transcribe") {
      const price = product.description.match(/\$+([\d.]+)\s*\/\s*hour\s*\/\s*instance/i)?.[1];
      if (price === undefined) {
        input.reconcile?.({
          disposition: "unbound",
          reason_code: "transcribe_vault_rate_drift",
        });
        continue;
      }
      if (matches.length !== 1) {
        reconcileMatch(input, product.modelName, matches);
        continue;
      }
      const current = matches[0]!;
      facts.push(
        capacityFact(
          input.sourceId,
          current,
          "starting-rate",
          "Starting rate",
          "hourly-rate",
          [
            capacityRate(input.sourceId, price, "unit_hour", "hour / instance", "Starting rate", {
              billing_period: "hourly",
            }),
          ],
          [
            raw(
              input.sourceId,
              "transcribe_vault_plan_binding",
              "informational",
              "unknown_applicability",
              "The marketing price publishes only a starting hourly Model Vault rate, without an exact Standard plan or tier binding",
            ),
          ],
        ),
      );
    }
  }
}

function addStandardVault(input: Input, facts: SourceCommercialPricingFact[]): void {
  const body = companion(input, standardPricingPath, [
    /# Standard Vault Pricing/,
    /Additional capacity billed per instance-hour/,
    /All rates are per instance/,
  ]);
  if (body === undefined) return;
  const supported = companion(input, "/docs/model-vault/standard/supported-models.md", [
    /Embed and Rerank.*self-serve/is,
    /generative models.*waitlist/is,
  ]);
  const tables = markdownTables(body);
  const capacity = tables.find(
    ({ headers }) =>
      headers.join("\0") ===
      ["Model", "Performance Tier", "Hourly rate", "Monthly rate", "Annual rate"].join("\0"),
  );
  if (capacity === undefined) {
    input.reconcile?.({ disposition: "unbound", reason_code: "standard_vault_table_drift" });
  } else {
    for (const row of capacity.rows) {
      const [label, tier, hourlyCell, monthlyCell, annualCell] = row;
      const hourly = amount(hourlyCell);
      const monthly = amount(monthlyCell);
      const annual = amount(annualCell);
      const matches = label === undefined ? [] : input.resolve(label);
      if (
        label === undefined ||
        tier === undefined ||
        hourly === undefined ||
        monthly === undefined ||
        annual === undefined
      ) {
        reconcileMatch(input, label ?? "Standard Vault row", matches, 3);
        continue;
      }
      const fixedRates = [
        capacityRate(input.sourceId, monthly, "unit_month", "month / instance", tier, {
          billing_period: "monthly",
        }),
        capacityRate(input.sourceId, annual, "unit_year", "year / instance", tier, {
          billing_period: "annual",
        }),
      ];
      const flexRates = [
        ...fixedRates,
        capacityRate(input.sourceId, hourly, "unit_hour", "hour / instance", tier, {
          billing_period: "hourly",
          operation: "autoscale_overage",
        }),
      ];
      if (matches.length !== 1) {
        const enrollment =
          supported === undefined ? [] : [standardEnrollment(input.sourceId, "open")];
        facts.push(
          unboundCapacityFact(input.sourceId, label, tier, "fixed", fixedRates, enrollment),
          unboundCapacityFact(input.sourceId, label, tier, "flex", flexRates, enrollment),
        );
        reconcileMatch(input, label, matches);
        continue;
      }
      const current = matches[0]!;
      facts.push(
        capacityFact(
          input.sourceId,
          current,
          tier,
          tier,
          "fixed",
          fixedRates,
          supported === undefined ? [] : [standardEnrollment(input.sourceId, "open")],
        ),
        capacityFact(
          input.sourceId,
          current,
          tier,
          tier,
          "flex",
          flexRates,
          supported === undefined ? [] : [standardEnrollment(input.sourceId, "open")],
        ),
      );
      input.reconcile?.({
        disposition: "normalized",
        reason_code: "standard_vault_capacity_rates",
        sample: `${current.model_id}:${tier}`,
      });
    }
  }

  const generative = tables.find(
    ({ headers }) => headers.join("\0") === ["Model", "Hourly rate", "XL hourly rate"].join("\0"),
  );
  if (generative === undefined) {
    input.reconcile?.({
      disposition: "unbound",
      reason_code: "standard_vault_generative_table_drift",
    });
    return;
  }
  for (const row of generative.rows) {
    const [label, regularCell, xlCell] = row;
    const matches = label === undefined ? [] : input.resolve(label);
    if (label === undefined) {
      reconcileMatch(input, label ?? "Standard Vault generative row", matches);
      continue;
    }
    for (const [tier, cell] of [
      ["Published hourly tier", regularCell],
      ["XL", xlCell],
    ] as const) {
      const price = amount(cell);
      if (price === undefined) continue;
      const rates = [
        capacityRate(input.sourceId, price, "unit_hour", "hour / instance", tier, {
          billing_period: "hourly",
          ...(matches.length === 1 ? {} : { model: label }),
        }),
      ];
      const rawFacts = [
        raw(
          input.sourceId,
          "generative_vault_plan_binding",
          "informational",
          "unknown_applicability",
          "The exact hourly rate is published, while its Fixed/Flex plan binding and monthly or annual commitment amounts are not",
        ),
        ...(supported === undefined ? [] : [standardEnrollment(input.sourceId, "waitlist")]),
      ];
      if (matches.length !== 1) {
        facts.push(
          unboundCapacityFact(input.sourceId, label, tier, "hourly-rate", rates, [
            ...rawFacts,
            raw(
              input.sourceId,
              "standard_vault_model_binding",
              "informational",
              "unknown_applicability",
              `The published Standard Vault row names ${label}, but no unique global model identity is established`,
            ),
          ]),
        );
        continue;
      }
      const current = matches[0]!;
      facts.push(
        capacityFact(
          input.sourceId,
          current,
          tier,
          tier,
          "hourly-rate",
          [
            capacityRate(input.sourceId, price, "unit_hour", "hour / instance", tier, {
              billing_period: "hourly",
            }),
          ],
          rawFacts,
        ),
      );
    }
    if (matches.length !== 1) reconcileMatch(input, label, matches);
  }
}

function addEncryptedVault(input: Input, facts: SourceCommercialPricingFact[]): void {
  const body = companion(input, encryptedPricingPath, [
    /offered free of charge to design partners/i,
    /(?:contact Cohere.*current rates|current rates.*contact Cohere)/is,
  ]);
  const supported = companion(input, "/docs/model-vault/encrypted/supported-models.md", [
    /Encrypted Vaults support the following model families/,
    /availability for a specific model.*contact(?:ing)? Cohere/is,
  ]);
  if (body === undefined || supported === undefined) return;
  const base = resource(
    input.sourceId,
    "capacity:encrypted-vault",
    "Model Vault Encrypted",
    "capacity",
    "encrypted-vault",
    [],
    "beta",
    "Encrypted Vault beta",
    "capacity",
  );
  facts.push(
    {
      ...base,
      pricing_state: "free",
      price_facts: [],
      raw_price_facts: [
        raw(
          input.sourceId,
          "design_partner_enrollment",
          "informational",
          "unknown_applicability",
          "Free beta access is limited to accepted design partners; exact model versions remain account scoped",
        ),
      ],
    },
    {
      ...base,
      offer_key: "general-availability",
      offer_name: "Encrypted Vault current commercial access",
      pricing_state: "custom_quote",
      price_facts: [],
      raw_price_facts: [],
    },
  );
  input.reconcile?.({
    disposition: "explicit_non_numeric",
    reason_code: "encrypted_vault_beta_and_quote",
  });
}

function addAsyncServices(input: Input, facts: SourceCommercialPricingFact[]): void {
  const batch = companion(input, "/reference/create-batch.md", [
    /POST https:\/\/api\.cohere\.com\/v2\/batches/,
    /input_tokens[\s\S]*output_tokens[\s\S]*num_successful_records[\s\S]*num_failed_records/,
  ]);
  if (batch !== undefined) {
    facts.push({
      ...resource(
        input.sourceId,
        "service:batch",
        "Cohere Batch",
        "service",
        "batch",
        [],
        "jobs",
        "Batch jobs",
        "usage",
      ),
      pricing_state: "not_published",
      price_facts: [],
      raw_price_facts: [
        raw(
          input.sourceId,
          "batch_price_and_model_scope",
          "base_price",
          "unknown_amount",
          "The Batch API publishes job and usage counters but no separate amount, same-price rule, or exhaustive supported-model list",
        ),
      ],
    });
  }

  const embedModels = [...input.embedJobModelIds]
    .flatMap((id) => {
      const current = input.models.get(id);
      return current === undefined || current.status === "retired" ? [] : [current.uid];
    })
    .sort();
  if (embedModels.length > 0) {
    facts.push({
      ...resource(
        input.sourceId,
        "service:embed-jobs",
        "Cohere Embed Jobs",
        "service",
        "embed-jobs",
        embedModels,
        "jobs",
        "Embed Jobs",
        "usage",
      ),
      pricing_state: "not_published",
      price_facts: [],
      raw_price_facts: [
        raw(
          input.sourceId,
          "embed_job_price_relation",
          "base_price",
          "unknown_amount",
          "Embed Job results expose billed units, but no first-party source publishes a separate amount or a same-price relation to synchronous Embed",
        ),
      ],
    });
  }
}

function addProviderServices(input: Input, facts: SourceCommercialPricingFact[]): void {
  const privateDeployment = companion(input, "/docs/private-deployment-overview.md", [
    /you manage the model deployment infrastructure/i,
    /On-premises \(on-prem\)/,
    /virtual\s+private cloud \(VPC\)/,
  ]);
  if (privateDeployment !== undefined) {
    const base = resource(
      input.sourceId,
      "service:private-deployment",
      "Cohere private deployment",
      "service",
      "private-deployment",
      [],
      "cohere-engagement",
      "Cohere private-deployment license and support",
      "subscription",
    );
    facts.push(
      {
        ...base,
        pricing_state: "custom_quote",
        price_facts: [],
        raw_price_facts: [],
      },
      {
        ...base,
        offer_key: "operator-infrastructure",
        offer_name: "Customer or cloud infrastructure",
        pricing_state: "externally_billed",
        price_facts: [],
        raw_price_facts: [
          raw(
            input.sourceId,
            "private_infrastructure_cost",
            "informational",
            "unknown_amount",
            "The customer procures and operates the private-deployment hardware or cloud infrastructure separately",
          ),
        ],
      },
    );
  }

  const migration = companion(input, "/v2/docs/migrating-v1-to-v2.md", [
    /web-search.*connector/i,
    /user-defined tool/i,
  ]);
  if (migration !== undefined)
    facts.push({
      ...resource(
        input.sourceId,
        "service:v1-web-search-connector",
        "Deprecated V1 web-search connector",
        "service",
        "v1-web-search-connector",
        [],
        "connector",
        "V1 web-search connector",
        "usage",
      ),
      pricing_state: "not_published",
      price_facts: [],
      raw_price_facts: [
        raw(
          input.sourceId,
          "v1_web_search_separate_charge",
          "base_price",
          "unknown_amount",
          "The deprecated provider-operated V1 connector has no published separate-charge amount and is not equivalent to V2 caller-defined tools",
        ),
      ],
    });

  companion(input, "/v2/docs/tool-use-overview.md", [/tools are functions/i, /execute the tool/i]);
}

function validateVaultCompanions(input: Input): void {
  companion(input, "/docs/model-vault.md", [
    /Cohere-managed.*single-tenant/is,
    /Standard or Encrypted/,
    /spend and usage hours/i,
  ]);
  companion(input, "/docs/model-vault/model-vault-with-north.md", [
    /North configuration.*Standard or Encrypted Model Vault/is,
    /separately managed resource/i,
  ]);
}

function capacityFact(
  sourceId: string,
  model: ParsedProviderModel,
  tierKey: string,
  tier: string,
  offerKey: string,
  priceFacts: SourcePriceFact[],
  rawFacts: SourceRawPricingFact[] = [],
): SourceCommercialPricingFact {
  return {
    ...resource(
      sourceId,
      `capacity:standard-vault:${model.uid}:${slug(tierKey)}`,
      `Standard Model Vault for ${model.name} · ${tier}`,
      "capacity",
      `standard-vault:${model.uid}:${slug(tierKey)}`,
      [model.uid],
      offerKey,
      standardOfferName(offerKey),
      offerKey === "flex" ? "hybrid" : "capacity",
    ),
    pricing_state: "numeric",
    price_facts: priceFacts,
    raw_price_facts: rawFacts,
  };
}

function unboundCapacityFact(
  sourceId: string,
  modelLabel: string,
  tier: string,
  offerKey: string,
  priceFacts: SourcePriceFact[],
  rawFacts: SourceRawPricingFact[],
): SourceCommercialPricingFact {
  const key = `unbound:${slug(modelLabel)}:${slug(tier)}`;
  return {
    ...resource(
      sourceId,
      `capacity:standard-vault:${key}`,
      `Standard Model Vault for ${modelLabel} · ${tier}`,
      "capacity",
      `standard-vault:${key}`,
      [],
      offerKey,
      standardOfferName(offerKey),
      offerKey === "flex" ? "hybrid" : "capacity",
    ),
    pricing_state: "numeric",
    price_facts: priceFacts.map((fact) => ({
      ...fact,
      conditions: { model: modelLabel, ...fact.conditions },
    })),
    raw_price_facts: rawFacts,
  };
}

function standardOfferName(key: string): string {
  if (key === "fixed") return "Standard Vault Fixed";
  if (key === "flex") return "Standard Vault Flex";
  return "Standard Vault published hourly rate";
}

function capacityRate(
  sourceId: string,
  price: string,
  unit: "unit_hour" | "unit_month" | "unit_year",
  rawUnit: string,
  tier: string,
  extra: SourcePriceFact["conditions"],
): SourcePriceFact {
  return publishedRate("provisioned_throughput", price, unit, sourceId, rawUnit, {
    endpoint: "Standard Model Vault",
    capacity: tier,
    ...extra,
  });
}

function resource(
  source_ref: string,
  book_key: string,
  book_name: string,
  resource_kind: SourceCommercialPricingFact["resource_kind"],
  resource_key: string,
  model_refs: string[],
  offer_key: string,
  offer_name: string,
  billing_mode: SourceCommercialPricingFact["billing_mode"],
): Pick<
  SourceCommercialPricingFact,
  | "billing_mode"
  | "book_key"
  | "book_name"
  | "model_refs"
  | "offer_key"
  | "offer_name"
  | "resource_key"
  | "resource_kind"
  | "source_ref"
> {
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
  };
}

function raw(
  sourceRef: string,
  termKey: string,
  impact: SourceRawPricingFact["impact"],
  reason: SourceRawPricingFact["reason"],
  fragment: string,
): SourceRawPricingFact {
  return {
    term_key: termKey,
    impact,
    reason,
    conditions: {},
    source_ref: sourceRef,
    raw: { fragment },
  };
}

function standardEnrollment(sourceRef: string, state: "open" | "waitlist"): SourceRawPricingFact {
  return raw(
    sourceRef,
    `standard_vault_${state}_enrollment`,
    "informational",
    "unknown_applicability",
    state === "open"
      ? "Standard Vault Embed and Rerank capacity is generally self-serve"
      : "Standard Vault generative capacity may require waitlist enrollment",
  );
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
  return;
}

function reconcileMatch(
  input: Input,
  label: string,
  matches: readonly ParsedProviderModel[],
  count = 1,
): void {
  for (let index = 0; index < count; index += 1)
    input.reconcile?.({
      disposition: matches.length === 0 ? "unbound" : "ambiguous",
      reason_code: matches.length === 0 ? "pricing_product_unbound" : "pricing_product_ambiguous",
      sample: label,
    });
}

function markdownTables(body: string): MarkdownTable[] {
  const lines = body.split(/\r?\n/);
  const result: MarkdownTable[] = [];
  for (let index = 0; index + 1 < lines.length; index += 1) {
    const headers = markdownRow(lines[index] ?? "");
    const separator = markdownRow(lines[index + 1] ?? "");
    if (
      headers.length === 0 ||
      separator.length !== headers.length ||
      !separator.every((cell) => /^:?-{3,}:?$/.test(cell))
    )
      continue;
    const rows: string[][] = [];
    for (index += 2; index < lines.length; index += 1) {
      const row = markdownRow(lines[index] ?? "");
      if (row.length !== headers.length) break;
      rows.push(row);
    }
    result.push({ headers, rows });
  }
  return result;
}

function markdownRow(line: string): string[] {
  const value = line.trim();
  if (!value.startsWith("|") || !value.endsWith("|")) return [];
  return value
    .slice(1, -1)
    .split("|")
    .map((cell) => cell.trim().replaceAll("\\$", "$"));
}

function amount(value: string | undefined): string | undefined {
  if (value === undefined || /^(?:--|—|-)$/.test(value.trim())) return;
  return value
    .trim()
    .match(/^\$([\d,]+(?:\.\d+)?)$/)?.[1]
    ?.replaceAll(",", "");
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
