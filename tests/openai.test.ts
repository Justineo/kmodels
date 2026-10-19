import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";
import { compareUtf8 } from "../src/catalog/canonical-value.ts";
import { parseSource } from "../src/catalog/adapters.ts";
import { assembleParsedProviderPricing } from "../src/catalog/pricing-adapter.ts";
import type { ProviderPricingPartition } from "../src/catalog/pricing-assembly.ts";
import { evaluateRateCost } from "../src/catalog/pricing-calculation.ts";
import { publishedRate } from "../src/catalog/pricing.ts";
import { applyGroups } from "../src/catalog/collector.ts";
import { manifests, type ProviderManifest, type SourceManifest } from "../src/catalog/manifests.ts";
import { baseModel } from "../src/catalog/model.ts";
import {
  sourcePricingReconciliation,
  type PricingReconciliationItem,
} from "../src/catalog/pricing-reconciliation.ts";
import type { ParsedProviderModel as ProviderModel } from "../src/catalog/pricing-source.ts";
import { validatePricingCatalog } from "../src/catalog/pricing-validation.ts";
import type { ModelTask, Provider } from "../src/catalog/schema.ts";
import type { SourceContractEvidence } from "../src/catalog/source-contract.ts";
import type { SourceParseResult } from "../src/catalog/source-parse.ts";

const observedAt = "2026-07-21T00:00:00.000Z";

async function fixture(path: string): Promise<string> {
  return readFile(new URL(`./fixtures/${path}`, import.meta.url), "utf8");
}

function validateParsedPricing(
  value: ProviderManifest,
  source: SourceManifest,
  models: ProviderModel[],
  partition: ProviderPricingPartition | undefined,
): void {
  if (partition === undefined) throw new Error("Missing parsed pricing partition");
  validatePricingCatalog(
    {
      provider_vocabularies: [partition.vocabulary],
      provider_snapshots: [partition.snapshot],
      model_dispositions: partition.model_dispositions,
      books: partition.books,
    },
    {
      providers: [provider(value)],
      models,
      sources: [
        {
          id: source.id,
          provider_id: value.provider.id,
          url: source.url,
          source: source.source ?? [source.type],
          stability: source.stability,
          scope: source.scope ?? "global",
          exhaustive: source.exhaustive ?? false,
          role: source.role ?? "catalog",
          field_paths: source.fields,
          ...(source.pricingEvidence === undefined
            ? {}
            : { pricing_evidence: source.pricingEvidence }),
          observed_at: observedAt,
          content_hash: "1".repeat(64),
          extractor_version: source.extractorVersion,
        },
      ],
    },
  );
}

const linkedBundleFixtureSchema = z.object({
  index: z.object({ url: z.string(), body: z.string() }),
  documents: z.array(z.object({ url: z.string(), body: z.string() })),
});

function linkedBundle(body: string): z.infer<typeof linkedBundleFixtureSchema> {
  return linkedBundleFixtureSchema.parse(JSON.parse(body));
}

function manifest(providerId: string): ProviderManifest {
  const value = manifests.find((item) => item.provider.id === providerId);
  if (value === undefined) throw new Error(`Missing manifest ${providerId}`);
  return value;
}

function provider(value: ProviderManifest): Provider {
  return { ...value.provider, source_ids: value.sources.map((source) => source.id) };
}

async function parsed(
  providerId: string,
  path: string,
  sourceId?: string,
  transform?: (body: string) => string,
): Promise<ProviderModel[]> {
  const value = manifest(providerId);
  const source =
    sourceId === undefined
      ? value.sources[0]
      : value.sources.find((candidate) => candidate.id === sourceId);
  if (source === undefined) throw new Error(`Missing source for ${providerId}`);
  const fixtureBody = await fixture(path);
  const body = transform?.(fixtureBody) ?? fixtureBody;
  return parseSource({
    provider: provider(value),
    source,
    body,
    observedAt,
  }).models;
}

function openAiModel(id: string, tasks: ModelTask[], name = id): ProviderModel {
  return {
    ...baseModel({
      providerId: "openai",
      id,
      name,
      sourceId: "openai-models",
      observedAt,
    }),
    tasks,
  };
}

function accountingBody(): string {
  return [
    "components:",
    "  schemas:",
    "    Response:",
    "      allOf:",
    "        - type: object",
    "          properties:",
    "            usage:",
    "              $ref: '#/components/schemas/ResponseUsage'",
    "            service_tier:",
    "              type: string",
    "    ResponseUsage:",
    "      type: object",
    "      properties:",
    "        input_tokens:",
    "          type: integer",
    "        input_tokens_details:",
    "          type: object",
    "          properties:",
    "            cached_tokens:",
    "              type: integer",
    "            cache_write_tokens:",
    "              type: integer",
    "        output_tokens:",
    "          type: integer",
    "    UsageWebSearchCallsResult:",
    "      properties:",
    "        num_requests:",
    "          type: integer",
    "    VideoResource:",
    "      properties:",
    "        seconds:",
    "          type: string",
  ].join("\n");
}

async function openAiModelPricing(
  path: string,
  catalogModels: ProviderModel[],
): Promise<ProviderModel[]> {
  const value = manifest("openai");
  const source = value.sources.find(({ id }) => id === "openai-overview");
  if (source === undefined) throw new Error("Missing OpenAI model-card pricing source");
  return parseSource({
    provider: provider(value),
    source,
    body: await fixture(path),
    observedAt,
    catalogModels,
  }).models;
}

describe("OpenAI adapters", () => {
  it.each([
    ["1", "2", "3"],
    ["3", "2", "1"],
    ["2", "3", "1"],
  ])(
    "preserves every same-page conflict through canonical assembly (%s, %s, %s)",
    (first, second, third) => {
      const value = manifest("openai");
      const source = value.sources.find(({ id }) => id === "openai-pricing");
      const overview = value.sources.find(({ id }) => id === "openai-overview");
      if (source === undefined || overview === undefined) throw new Error("Missing OpenAI source");
      const card = {
        ...openAiModel("gpt-test", ["text_generation"]),
        price_facts: [
          publishedRate("input_text", "0.5", "million_tokens", overview.id, "1M tokens", {
            service_tier: "standard",
          }),
        ],
      };
      const modelsSource = parseSource({
        provider: provider(value),
        source,
        observedAt,
        catalogModels: [card],
        body: [
          "Flagship models",
          "Standard",
          "| Model | Short context input | Short context output |",
          "| --- | --- | --- |",
          ...[first, second, third].map((amount) => `| gpt-test | $${amount} | $100 |`),
        ].join("\n"),
      });
      const models = modelsSource.models;
      const partition = assembleParsedProviderPricing(
        "openai",
        observedAt,
        [
          { source: overview, models: [card] },
          { source, ...modelsSource },
        ],
        models,
      );
      const terms = partition?.books[0]?.offers.find(
        ({ offer_key }) => offer_key === "sync",
      )?.terms;
      const input = terms?.find(({ term_key }) => term_key === "input_text");
      if (input?.kind !== "rate") throw new Error("Missing input rate");
      expect(input.variants).toHaveLength(1);
      expect(input.variants[0]).toMatchObject({
        price: { value: { numerator: "1", denominator: "2000000" } },
        applicability: {
          any_of: [
            {
              all_of: expect.arrayContaining([
                expect.objectContaining({
                  kind: "decimal_range",
                  dimension: { namespace: "kmodels", value: "context_tokens" },
                  lower: { inclusive: true, value: "272001" },
                }),
              ]),
            },
          ],
        },
      });
      expect(
        input.raw_variants
          .filter(({ reason }) => reason === "conflicting_values")
          .flatMap(({ observations }) => observations.map(({ raw }) => raw.amount))
          .sort((left, right) => String(left).localeCompare(String(right))),
      ).toEqual(["1", "2", "3"]);
      expect(terms?.find(({ term_key }) => term_key === "output_text")).toMatchObject({
        kind: "rate",
        variants: [expect.anything()],
      });
    },
  );
  it.each([
    [
      "wrong scalar type",
      (body: string) =>
        body.replace(
          "input_tokens:\n          type: integer",
          "input_tokens:\n          type: string",
        ),
    ],
    [
      "nested counter lookalike",
      (body: string) =>
        body.replace(
          "        input_tokens:\n          type: integer",
          "        details:\n          properties:\n            input_tokens:\n              type: integer",
        ),
    ],
    [
      "duplicate counter",
      (body: string) =>
        body.replace(
          "        input_tokens:\n          type: integer",
          "        input_tokens:\n          type: integer\n        input_tokens:\n          type: string",
        ),
    ],
    [
      "detached usage schema",
      (body: string) =>
        body.replace("#/components/schemas/ResponseUsage", "#/components/schemas/MissingUsage"),
    ],
    [
      "duplicate schema",
      (body: string) =>
        body +
        "\n    ResponseUsage:\n      properties:\n        input_tokens:\n          type: integer",
    ],
    [
      "conflicting union type",
      (body: string) =>
        body.replace(
          "input_tokens:\n          type: integer",
          "input_tokens:\n          anyOf:\n            - type: integer\n            - type: string",
        ),
    ],
    [
      "cyclic reference",
      (body: string) =>
        body.replace("#/components/schemas/ResponseUsage", "#/components/schemas/Response"),
    ],
  ])("rejects accounting drift: %s", (_name, change) => {
    const value = manifest("openai");
    const source = value.sources.find(({ id }) => id === "openai-accounting");
    if (source === undefined) throw new Error("Missing OpenAI accounting source");
    const parse = (body: string) =>
      parseSource({
        provider: provider(value),
        source,
        body,
        observedAt,
        catalogModels: [openAiModel("gpt-test", ["text_generation"])],
      }).pricing_inputs ?? [];
    expect(parse(accountingBody()).some(({ key }) => key === "responses.usage.input_tokens")).toBe(
      true,
    );
    const inputs = parse(change(accountingBody()));
    expect(inputs.some(({ key }) => key === "responses.usage.input_tokens")).toBe(false);
    expect(inputs.some(({ key }) => key === "responses.generated_seconds")).toBe(true);
  });
  it.each([
    ["unreviewed table", "| Model | Future input |\n| --- | --- |\n| gpt-new | $2 |"],
    [
      "unpriced row",
      "| Model | Short context input | Short context output |\n| --- | --- | --- |\n| gpt-new | - | - |",
    ],
  ])("does not create a pricing-only identity from an %s", (_name, table) => {
    const value = manifest("openai");
    const source = value.sources.find(({ id }) => id === "openai-pricing");
    if (source === undefined) throw new Error("Missing OpenAI pricing source");
    expect(
      () =>
        parseSource({
          provider: provider(value),
          source,
          body: `Flagship models\n${table}`,
          observedAt,
          catalogModels: [],
        }).models,
    ).toThrow("no admitted facts");
  });

  it("retains supported facts without adding identities from an unrelated price table", () => {
    const value = manifest("openai");
    const source = value.sources.find(({ id }) => id === "openai-pricing");
    if (source === undefined) throw new Error("Missing OpenAI pricing source");
    const models = parseSource({
      provider: provider(value),
      source,
      observedAt,
      catalogModels: [],
      body: "Flagship models\n| Model | Short context input | Short context output |\n| --- | --- | --- |\n| gpt-priced | $2 | $3 |\n\n| Model | Future input |\n| --- | --- |\n| gpt-new | $4 |",
    }).models;
    expect(models.map(({ model_id }) => model_id)).toEqual(["gpt-priced"]);
  });

  it("calculates eligible container sessions using unchanged per-minute prices and the published minimum", async () => {
    const value = manifest("openai");
    const source = value.sources.find(({ id }) => id === "openai-pricing");
    if (source === undefined) throw new Error("Missing OpenAI pricing source");
    const pricing = (await fixture("openai/pricing.md")).replace(
      "Tools\n",
      "Tools\n\nEligible container sessions will be billed by the minute, with a 5-minute minimum per session.\n",
    );
    const changelog = await fixture("openai/container-billing.md");
    const catalogModels = [openAiModel("gpt-5", ["text_generation"])];
    const modelsSource = parseSource({
      provider: provider(value),
      source,
      body: JSON.stringify({
        index: { url: source.url, body: pricing },
        documents: [
          { url: "https://developers.openai.com/api/docs/changelog.md", body: changelog },
        ],
      }),
      observedAt,
      catalogModels,
    });
    const models = modelsSource.models;
    const minuteFact = modelsSource.commercial_facts
      ?.find(({ resource_key }) => resource_key === "containers")
      ?.price_facts.find(({ unit }) => unit === "minute");
    if (minuteFact === undefined) throw new Error("Missing source minute rate");
    minuteFact.raw_unit = "per minute; minimum 999 minutes per session";
    const partition = assembleParsedProviderPricing(
      "openai",
      observedAt,
      [{ source, ...modelsSource }],
      models,
      value.pricingCategoricalLabels,
    );
    validateParsedPricing(value, source, models, partition);
    const book = partition?.books.find(({ book_key }) => book_key === "service:containers");
    expect(
      book?.offers.flatMap(({ terms }) => terms.filter((term) => term.kind === "raw")),
    ).toEqual([]);
    const minute = book?.offers
      .flatMap(({ terms }) => terms.flatMap((term) => (term.kind === "rate" ? term.variants : [])))
      .find(
        (variant) =>
          variant.price.value.numerator === "1" && variant.price.value.denominator === "40000",
      );
    if (minute === undefined) throw new Error("Missing one-GiB minute rate");
    expect(
      evaluateRateCost(minute, [
        {
          signal: {
            namespace: "provider",
            provider_id: "openai",
            value: "container_session_seconds_before_minimum",
          },
          value: { numerator: "120", denominator: "1" },
        },
      ]),
    ).toMatchObject({ kind: "resolved", amount: { numerator: "3", denominator: "400" } });
    expect(
      evaluateRateCost(minute, [
        {
          signal: {
            namespace: "provider",
            provider_id: "openai",
            value: "container_session_seconds_before_minimum",
          },
          value: { numerator: "480", denominator: "1" },
        },
      ]),
    ).toMatchObject({ kind: "resolved", amount: { numerator: "3", denominator: "250" } });
  });

  it.each([
    "changed-minimum",
    "equal",
    "conflicting-page",
    "conflicting-date",
    "unknown-page",
    "invalid-date",
    "missing-page",
    "missing-companion",
    "outside-tools",
    "unknown-companion",
  ] as const)("contains container billing declaration drift: %s", async (scenario) => {
    const value = manifest("openai");
    const source = value.sources.find(({ id }) => id === "openai-pricing");
    if (source === undefined) throw new Error("Missing OpenAI pricing source");
    let quote =
      "Eligible container sessions will be billed by the minute, with a 5-minute minimum per session.";
    let changelog = await fixture("openai/container-billing.md");
    switch (scenario) {
      case "changed-minimum":
        quote = quote.replace("5-minute", "7-minute");
        changelog = changelog.replace("5-minute", "7-minute");
        break;
      case "equal":
        quote += `\n${quote}`;
        changelog += `\n${changelog}`;
        break;
      case "conflicting-page":
        quote += `\n${quote.replace("5-minute", "7-minute")}`;
        break;
      case "conflicting-date":
        changelog += `\n${changelog.replace("Starting June 2", "Starting July 2")}`;
        break;
      case "unknown-page":
        quote = quote.replace("5-minute", "several-minute");
        break;
      case "invalid-date":
        changelog = changelog.replace("Starting June 2", "Starting February 30");
        break;
      case "missing-page":
        quote = "";
        break;
      case "missing-companion":
        changelog = "";
        break;
      case "outside-tools":
        break;
      case "unknown-companion":
        changelog = changelog.replace("will remain the same", "is subject to a separate agreement");
        break;
    }
    const body = await fixture("openai/pricing.md");
    const pricing =
      scenario === "outside-tools"
        ? `${body}\n${quote}`
        : body.replace("Tools\n", `Tools\n\n${quote}\n`);
    const result = parseSource({
      provider: provider(value),
      source,
      observedAt,
      catalogModels: [],
      body: JSON.stringify({
        index: { url: source.url, body: pricing },
        documents:
          changelog.length === 0
            ? []
            : [{ url: "https://developers.openai.com/api/docs/changelog.md", body: changelog }],
      }),
    });
    const partition = assembleParsedProviderPricing(
      "openai",
      observedAt,
      [{ source, ...result }],
      result.models,
      value.pricingCategoricalLabels,
    );
    validateParsedPricing(value, source, result.models, partition);
    const terms =
      partition?.books
        .find(({ book_key }) => book_key === "service:containers")
        ?.offers.flatMap(({ terms }) => terms) ?? [];
    const minute = terms
      .flatMap((term) => (term.kind === "rate" ? term.variants : []))
      .find(({ price }) => price.value.numerator === "1" && price.value.denominator === "40000");
    if (scenario === "changed-minimum" || scenario === "equal") {
      if (minute === undefined) throw new Error("Missing container minute rate");
      expect(
        evaluateRateCost(minute, [
          {
            signal: {
              namespace: "provider",
              provider_id: "openai",
              value: "container_session_seconds_before_minimum",
            },
            value: { numerator: "1", denominator: "1" },
          },
        ]),
      ).toMatchObject({
        kind: "resolved",
        amount:
          scenario === "changed-minimum"
            ? { numerator: "21", denominator: "2000" }
            : { numerator: "3", denominator: "400" },
      });
      expect(terms.some((term) => term.kind === "raw")).toBe(false);
    } else {
      expect(minute).toBeUndefined();
      expect(terms).toContainEqual(
        expect.objectContaining({ kind: "raw", term_key: "billing-minimum" }),
      );
    }
    expect(partition?.books.some(({ book_key }) => book_key === "model:openai/gpt-5.4")).toBe(true);
  });

  it("combines the complete model index with rich model pages", async () => {
    const models = await parsed("openai", "openai/catalog.json");
    const model = models.find((candidate) => candidate.model_id === "gpt-5.4");
    const embedding = models.find((candidate) => candidate.model_id === "text-embedding-3-large");
    expect({
      name: model?.name,
      tasks: model?.tasks,
      endpoints: model?.api_endpoints,
      aliases: model?.aliases,
      context: model?.limits.context_tokens,
      output: model?.limits.max_output_tokens,
      modalities: model?.modalities,
      capabilities: model?.capabilities,
      status: model?.status,
      embedding_type: embedding?.tasks,
      embedding_output: embedding?.modalities.output,
    }).toEqual({
      name: "GPT-5.4",
      tasks: ["text_generation"],
      endpoints: [
        { name: "Chat Completions", path: "v1/chat/completions" },
        { name: "Responses", path: "v1/responses" },
        { name: "Assistants", path: "v1/assistants" },
        { name: "Batch", path: "v1/batch" },
      ],
      aliases: ["gpt-5.4-2026-03-05"],
      context: 1_050_000,
      output: 128_000,
      modalities: { input: ["text", "image"], output: ["text"] },
      capabilities: {
        reasoning: true,
        tool_call: true,
        structured_output: true,
        streaming: true,
        batch: true,
        prompt_cache: true,
        fine_tuning: false,
        citations: "unknown",
        code_execution: true,
        context_management: "unknown",
        effort_control: true,
        computer_use: true,
      },
      status: "active",
      embedding_type: ["embeddings"],
      embedding_output: ["embedding"],
    });
    expect(model?.pricing_state).toBe("unknown");
  });

  it("uses a numeric cached-input rate as positive prompt-cache evidence", async () => {
    const models = await parsed("openai", "openai/catalog.json", undefined, (body) => {
      const bundle = linkedBundle(body);
      const embedding = bundle.documents.find(({ url }) => url.includes("text-embedding-3-large"));
      if (embedding === undefined) throw new Error("Missing OpenAI model fixture");
      embedding.body += "\n\n| Cached input | $0.02 | 1M tokens |";
      return JSON.stringify(bundle);
    });
    expect(
      models.find(({ model_id }) => model_id === "text-embedding-3-large")?.capabilities
        .prompt_cache,
    ).toBe(true);
  });

  it("keeps card-local pricing in a separately replaceable HTML overlay", async () => {
    const catalog = await parsed("openai", "openai/catalog.json");
    const availability: NonNullable<ProviderModel["availability"]> = [
      { region: "United States", deployment_type: "regional_processing" },
    ];
    const eligibleCatalog = catalog.map((model) =>
      model.model_id === "gpt-5.4"
        ? {
            ...model,
            release_date: "2026-03-05",
            availability,
          }
        : model,
    );
    const models = await openAiModelPricing("openai/pricing-catalog.json", eligibleCatalog);
    const model = models.find((candidate) => candidate.model_id === "gpt-5.4");
    expect(
      model?.price_facts.find(
        (rate) =>
          rate.meter === "cache_write_text" && rate.conditions.context_min_tokens === undefined,
      )?.price,
    ).toBe("3.125");
    expect(
      model?.price_facts.find(
        (rate) => rate.meter === "input_text" && rate.conditions.context_min_tokens === 272_001,
      )?.price,
    ).toBe("5");
    expect(
      model?.price_facts.find(
        (rate) =>
          rate.meter === "cache_read_text" && rate.conditions.context_min_tokens === 272_001,
      )?.price,
    ).toBe("0.5");
    expect(
      new Set(model?.price_facts.map(({ conditions }) => conditions.deployment_scope)),
    ).toEqual(new Set(["global_processing"]));
  });

  it("accepts explicit cache writes, long-context cache rates, and live session cards", async () => {
    const models = await openAiModelPricing("openai/current-price-cards.json", [
      openAiModel("gpt-6-sol", ["text_generation"]),
      openAiModel("gpt-live-1", ["speech_to_speech"]),
    ]);
    const sol = models.find(({ model_id }) => model_id === "gpt-6-sol");
    expect(sol?.price_facts).toHaveLength(8);
    expect(sol?.price_facts.filter(({ meter }) => meter === "cache_write_text")).toMatchObject([
      { price: "2.50", conditions: { service_tier: "standard" } },
      { price: "5", conditions: { service_tier: "standard", context_min_tokens: 272_001 } },
    ]);
    expect(models.find(({ model_id }) => model_id === "gpt-live-1")?.price_facts).toMatchObject([
      { meter: "session_runtime", price: "0.05", unit: "minute" },
    ]);
  });

  it("extracts OpenAI pricing inputs independently from the rate source", () => {
    const value = manifest("openai");
    const source = value.sources.find(({ id }) => id === "openai-accounting");
    if (source === undefined || source.extractor.kind !== "openai-accounting")
      throw new Error("Missing OpenAI accounting source");
    const findings: SourceContractEvidence[] = [];
    const parsed = parseSource({
      provider: provider(value),
      source,
      body: [
        "components:",
        "  schemas:",
        "    Response:",
        "      properties:",
        "        usage:",
        "          $ref: '#/components/schemas/ResponseUsage'",
        "    ResponseUsage:",
        "      properties:",
        "        input_tokens:",
        "          type: integer",
        "        input_tokens_details:",
        "          properties:",
        "            cached_tokens:",
        "              type: integer",
        "            cache_write_tokens:",
        "              type: integer",
        "        output_tokens:",
        "          type: integer",
        "    UsageWebSearchCallsResult:",
        "      properties:",
        "        num_requests:",
        "          type: integer",
      ].join("\n"),
      observedAt,
      onContractFinding: (finding) => findings.push(finding),
    });
    expect(parsed.models).toEqual([]);
    expect(parsed.pricing_inputs?.map(({ key }) => key)).toEqual([
      "responses.usage.cache_write_tokens",
      "responses.usage.cached_input_tokens",
      "responses.usage.input_tokens",
      "responses.usage.output_tokens",
    ]);
    expect(findings).not.toEqual([]);
  });

  it("distinguishes the standard and batch views behind a price-tier selector", async () => {
    const model = (
      await openAiModelPricing("openai/batch-catalog.json", [
        openAiModel("o3", ["text_generation"]),
      ])
    )[0];
    expect(
      model?.price_facts.map(({ meter, price, conditions }) => ({ meter, price, conditions })),
    ).toEqual([
      {
        meter: "input_text",
        price: "2.00",
        conditions: { service_tier: "standard" },
      },
      {
        meter: "output_text",
        price: "8.00",
        conditions: { service_tier: "standard" },
      },
      {
        meter: "input_text",
        price: "1.00",
        conditions: { service_tier: "batch" },
      },
      {
        meter: "output_text",
        price: "4.00",
        conditions: { service_tier: "batch" },
      },
    ]);
  });

  it("publishes an explicitly free hosted moderation offer as free", async () => {
    const value = manifest("openai");
    const pricingSource = value.sources.find(({ id }) => id === "openai-overview");
    if (pricingSource === undefined) throw new Error("Missing OpenAI model-card pricing source");
    const fixtureBundle = z
      .object({
        documents: z.array(z.object({ url: z.string(), body: z.string() })),
      })
      .parse(JSON.parse(await fixture("openai/pricing-catalog.json")));
    const template = fixtureBundle.documents.find(({ url }) =>
      url.endsWith("/text-embedding-3-large"),
    );
    if (template === undefined) throw new Error("Missing OpenAI model template");
    const body = JSON.stringify({
      index: {
        url: "https://developers.openai.com/api/docs/models/all",
        body: '<main><a href="/api/docs/models/omni-moderation-latest">Moderation</a></main>',
      },
      documents: [
        {
          url: "https://developers.openai.com/api/docs/models/omni-moderation-latest",
          body: template.body
            .replace(/<section><div>Pricing<\/div>.*?<\/section>/s, "")
            .replaceAll("text-embedding-3-large", "omni-moderation-latest")
            .replace(
              "Most capable embedding model",
              "free models designed to detect harmful content",
            )
            .replace("Embeddings</div><div>v1/embeddings", "Moderation</div><div>v1/moderations"),
        },
      ],
    });
    const [model] = parseSource({
      provider: provider(value),
      source: pricingSource,
      body,
      observedAt,
      catalogModels: [openAiModel("omni-moderation-latest", ["moderation"], "Moderation")],
    }).models;
    expect(model).toMatchObject({
      model_id: "omni-moderation-latest",
      tasks: ["moderation"],
      pricing_state: "free",
      price_facts: [],
    });
  });

  it("extracts exact regional-processing model and endpoint support", async () => {
    const value = manifest("openai");
    const configured = value.sources.find(({ id }) => id === "openai-data-residency");
    if (configured === undefined || configured.extractor.kind !== "openai-data-residency")
      throw new Error("Missing OpenAI data-residency source");
    const source = configured;
    const models = parseSource({
      provider: provider(value),
      source,
      body: await fixture("openai/data-residency.md"),
      observedAt,
    }).models;
    expect(models.find(({ model_id }) => model_id === "gpt-4o-2024-11-20")).toMatchObject({
      tasks: ["text_generation"],
      api_endpoints: [
        { name: "Chat Completions", path: "v1/chat/completions" },
        { name: "Responses", path: "v1/responses" },
      ],
      availability: [
        { region: "Europe (EEA + Switzerland)", deployment_type: "regional_processing" },
        { region: "United States", deployment_type: "regional_processing" },
      ],
    });
    expect(models.find(({ model_id }) => model_id === "gpt-5.2-2025-12-11")?.availability).toEqual([
      { region: "Europe (EEA + Switzerland)", deployment_type: "regional_processing" },
      { region: "United Arab Emirates", deployment_type: "regional_processing" },
      { region: "United States", deployment_type: "regional_processing" },
    ]);
    expect(models.find(({ model_id }) => model_id === "gpt-4o-tts")).toMatchObject({
      tasks: ["speech_synthesis"],
      api_endpoints: [{ name: "Speech generation", path: "v1/audio/speech" }],
    });
  });

  it("takes the earliest exact model release from changelog feature entries", async () => {
    const value = manifest("openai");
    const source = value.sources.find(({ id }) => id === "openai-changelog");
    if (source === undefined || source.extractor.kind !== "openai-changelog")
      throw new Error("Missing OpenAI changelog source");
    const catalogModels = [
      openAiModel("gpt-5.4", ["text_generation"]),
      openAiModel("gpt-5.4-pro", ["text_generation"]),
      openAiModel("gpt-5.6-sol", ["text_generation"]),
      openAiModel("gpt-image-2", ["image_generation"]),
    ];
    const models = parseSource({
      provider: provider(value),
      source,
      body: await fixture("openai/changelog.md"),
      observedAt,
      catalogModels,
    }).models;
    expect(models.map(({ model_id, release_date }) => ({ model_id, release_date }))).toEqual([
      { model_id: "gpt-5.4", release_date: "2026-03-05" },
      { model_id: "gpt-5.4-pro", release_date: "2026-03-05" },
      { model_id: "gpt-5.6-sol", release_date: "2026-07-09" },
      { model_id: "gpt-image-2", release_date: "2026-04-21" },
    ]);
  });

  it.each(["### Feb 30", "### Feb 0", "## Unreviewed date"])(
    "rejects changelog date drift without inheriting an older date (%s)",
    (heading) => {
      const value = manifest("openai");
      const source = value.sources.find(({ id }) => id === "openai-changelog");
      if (source === undefined) throw new Error("Missing OpenAI changelog");
      const models = parseSource({
        provider: provider(value),
        source,
        observedAt,
        catalogModels: [openAiModel("gpt-test", []), openAiModel("gpt-bad", [])],
        body: [
          "## February, 2026",
          "### Feb 1",
          "Feature · Model: gpt-test",
          heading,
          "Feature · Model: gpt-bad",
        ].join("\n"),
      }).models;
      expect(models.map(({ model_id, release_date }) => ({ model_id, release_date }))).toEqual([
        { model_id: "gpt-test", release_date: "2026-02-01" },
      ]);
    },
  );

  it("keeps reviewed residency facts when a row adds an unknown region", async () => {
    const value = manifest("openai");
    const source = value.sources.find(({ id }) => id === "openai-data-residency");
    if (source === undefined) throw new Error("Missing OpenAI data-residency source");
    let finding: SourceContractEvidence | undefined;
    const body = (await fixture("openai/data-residency.md")).replace(
      "United States, Europe (EEA + Switzerland)",
      "United States, Europe (EEA + Switzerland), Mars",
    );
    const models = parseSource({
      provider: provider(value),
      source,
      body,
      observedAt,
      onContractFinding: (value) => {
        finding = value;
      },
    }).models;
    expect(models.find(({ model_id }) => model_id === "gpt-4o-2024-11-20")?.availability).toEqual([
      { region: "Europe (EEA + Switzerland)", deployment_type: "regional_processing" },
      { region: "United States", deployment_type: "regional_processing" },
    ]);
    expect(finding).toMatchObject({ disposition: "accept_with_signal" });
  });

  it("fills missing prices, adds service tiers, and resolves source conflicts", async () => {
    const value = manifest("openai");
    const configured = value.sources.find(({ id }) => id === "openai-pricing");
    if (configured === undefined || configured.extractor.kind !== "openai-pricing")
      throw new Error("Missing OpenAI pricing source");
    const source = configured;
    const catalogSource = value.sources.find(({ id }) => id === "openai-models");
    if (catalogSource === undefined) throw new Error("Missing OpenAI catalog source");
    const catalog = parseSource({
      provider: provider(value),
      source: catalogSource,
      body: await fixture("openai/catalog.json"),
      observedAt,
    }).models;
    const pricingSource = value.sources.find(({ id }) => id === "openai-overview");
    if (pricingSource === undefined) throw new Error("Missing OpenAI model-card pricing source");
    const cardPricing = await openAiModelPricing("openai/pricing-catalog.json", catalog);
    const pricedCatalog = applyGroups(
      catalog,
      [{ source: pricingSource, models: cardPricing }],
      false,
    );
    const image = {
      ...baseModel({
        providerId: "openai",
        id: "gpt-image-2",
        name: "GPT Image 2",
        sourceId: "openai-models",
        observedAt,
      }),
      aliases: ["gpt-image-2-2026-04-21"],
      tasks: ["image_generation"],
    } satisfies ProviderModel;
    const transcribe = {
      ...baseModel({
        providerId: "openai",
        id: "gpt-transcribe",
        name: "GPT Transcribe",
        sourceId: "openai-models",
        observedAt,
      }),
      tasks: ["transcription"],
    } satisfies ProviderModel;
    const tokenTranscribe = {
      ...baseModel({
        providerId: "openai",
        id: "gpt-4o-transcribe",
        name: "GPT-4o Transcribe",
        sourceId: "openai-models",
        observedAt,
      }),
      tasks: ["transcription"],
      pricing_state: "numeric",
      price_facts: [
        publishedRate("input_audio", "2.5", "million_tokens", "openai-models", "per 1M tokens", {
          service_tier: "standard",
        }),
        publishedRate("output_audio", "10", "million_tokens", "openai-models", "per 1M tokens", {
          service_tier: "standard",
        }),
      ],
    } satisfies ProviderModel;
    const whisper = {
      ...baseModel({
        providerId: "openai",
        id: "whisper-1",
        name: "Whisper",
        sourceId: "openai-models",
        observedAt,
      }),
      tasks: ["transcription"],
    } satisfies ProviderModel;
    const pricingBody = await fixture("openai/pricing.md");
    const reconciliation: PricingReconciliationItem[] = [];
    const parsePricing = (body: string, reconcile = false) =>
      parseSource({
        provider: provider(value),
        source,
        body,
        observedAt,
        catalogModels: [...pricedCatalog, image, transcribe, tokenTranscribe, whisper],
        ...(reconcile ? { onPricingReconciliation: (item) => reconciliation.push(item) } : {}),
      });
    const parsedSource = parsePricing(pricingBody, true);
    const { models } = parsedSource;
    const gpt = models.find(({ model_id }) => model_id === "gpt-5.4");
    const imageRates = models.find(({ model_id }) => model_id === "gpt-image-2")?.price_facts;
    const transcribeRates = models.find(
      ({ model_id }) => model_id === "gpt-transcribe",
    )?.price_facts;
    expect(
      gpt?.price_facts.reduce<Record<string, number>>((counts, { conditions }) => {
        const tier = conditions.service_tier ?? "unknown";
        counts[tier] = (counts[tier] ?? 0) + 1;
        return counts;
      }, {}),
    ).toEqual({ standard: 6, batch: 6, flex: 6, fast: 3 });
    expect(imageRates).toHaveLength(10);
    expect(imageRates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          meter: "output_image",
          price: "30.00",
          conditions: { service_tier: "standard" },
        }),
        expect.objectContaining({
          meter: "output_image",
          price: "15.00",
          conditions: { service_tier: "batch" },
        }),
      ]),
    );
    expect(transcribeRates).toEqual([
      expect.objectContaining({
        meter: "input_audio",
        price: "0.0045",
        unit: "minute",
        conditions: { service_tier: "standard" },
      }),
    ]);
    expect(models.find(({ model_id }) => model_id === "whisper-1")?.price_facts).toEqual([
      expect.objectContaining({ meter: "input_audio", price: "0.006", unit: "minute" }),
    ]);
    expect(models.find(({ model_id }) => model_id === "gpt-5-search-api")).toMatchObject({
      tasks: ["text_generation"],
      pricing_state: "numeric",
      price_facts: expect.arrayContaining([
        expect.objectContaining({ meter: "input_text", price: "1.25" }),
        expect.objectContaining({ meter: "output_text", price: "10.00" }),
      ]),
    });
    expect(models.find(({ model_id }) => model_id === "omni-moderation-latest")).toMatchObject({
      tasks: ["moderation"],
      pricing_state: "free",
      price_facts: [],
    });
    expect(reconciliation).toContainEqual({
      disposition: "normalized",
      reason_code: "provider_service_pricing_bound",
      sample: "File search",
    });
    expect(reconciliation).toContainEqual({
      disposition: "normalized",
      reason_code: "fine_tuned_inference_pricing_bound",
      sample: "gpt-4.1-2025-04-14",
    });
    expect(reconciliation).toContainEqual({
      disposition: "excluded",
      reason_code: "commercial_fact_outside_invocation_scope",
      sample: "File search",
    });
    const commercial = parsedSource.commercial_facts ?? [];
    expect(commercial).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source_ref: "openai-pricing",
          resource_kind: "service",
          resource_key: "file-search",
          price_facts: [expect.objectContaining({ meter: "file_search" })],
        }),
        expect.objectContaining({
          source_ref: "openai-pricing",
          resource_kind: "service",
          resource_key: "fine-tuned-inference:gpt-4.1-2025-04-14",
        }),
        expect.objectContaining({
          resource_key: "containers",
          price_facts: expect.arrayContaining([
            expect.objectContaining({
              meter: "container_runtime",
              unit: "container_session",
              conditions: { capacity: "64 GiB" },
            }),
          ]),
        }),
        expect.objectContaining({
          resource_key: "fine-tuned-inference:o4-mini-2025-04-16",
          price_facts: expect.arrayContaining([expect.objectContaining({ meter: "input_text" })]),
        }),
      ]),
    );
    expect(
      commercial.some(({ resource_key }) =>
        ["vector-store-storage", "chatkit-storage"].includes(resource_key),
      ),
    ).toBe(false);
    expect(
      commercial
        .filter(({ resource_key }) => resource_key === "web-search")
        .flatMap(({ price_facts }) => price_facts)
        .map(({ conditions }) => conditions.operation ?? "")
        .sort(compareUtf8),
    ).toEqual(["image", "preview_non_reasoning", "preview_reasoning", "search"]);
    expect(models.find(({ model_id }) => model_id === "gpt-4o-transcribe")?.price_facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ meter: "input_audio", price: "2.50" }),
        expect.objectContaining({ meter: "output_audio", price: "10.00" }),
      ]),
    );
    const fineTunedFacts = commercial
      .filter(({ resource_key }) => resource_key === "fine-tuned-inference:o4-mini-2025-04-16")
      .flatMap(({ price_facts }) => price_facts);
    expect(fineTunedFacts).toHaveLength(12);
    expect(new Set(fineTunedFacts.map(({ conditions }) => conditions.account_eligibility))).toEqual(
      new Set(["default", "data_sharing"]),
    );
    const assembled = assembleParsedProviderPricing(
      "openai",
      observedAt,
      [{ source, ...parsedSource }],
      models,
    );
    const fineTuned = assembled?.books.find(
      ({ scope }) =>
        scope.kind === "provider_resource" &&
        scope.resource_key === "fine-tuned-inference:o4-mini-2025-04-16",
    );
    expect(fineTuned?.offers.map(({ offer_key }) => offer_key)).toEqual(["batch", "sync"]);
    expect(
      fineTuned?.offers.flatMap(({ terms }) =>
        terms.flatMap((term) => (term.kind === "rate" ? term.variants : [])),
      ),
    ).toHaveLength(12);
    expect(
      fineTuned?.offers.flatMap(({ terms }) =>
        terms.flatMap((term) =>
          term.kind === "rate"
            ? term.raw_variants.filter(({ reason }) => reason === "conflicting_values")
            : [],
        ),
      ),
    ).toEqual([]);
    const resolved = parsePricing(pricingBody.replace("$5.00", "$5.01")).models;
    expect(
      resolved
        .find(({ model_id }) => model_id === "gpt-5.4")
        ?.price_facts.find(
          ({ meter, conditions }) =>
            meter === "input_text" &&
            conditions.service_tier === "standard" &&
            conditions.context_min_tokens === 272_001,
        ),
    ).toMatchObject({
      price: "5.01",
      resolution_policy: "openai_pricing_page_over_model_card",
    });
  });

  it("keeps an explicitly priced snapshot separate from a card alias", () => {
    const value = manifest("openai");
    const configured = value.sources.find(({ id }) => id === "openai-pricing");
    if (configured === undefined || configured.extractor.kind !== "openai-pricing")
      throw new Error("Missing OpenAI pricing source");
    const source = configured;
    const card = {
      ...openAiModel("gpt-4o", ["text_generation"], "GPT-4o"),
      aliases: ["gpt-4o-2024-05-13"],
      pricing_state: "numeric",
      price_facts: [
        publishedRate("input_text", "2.50", "million_tokens", "openai-overview", "per 1M tokens", {
          service_tier: "standard",
        }),
      ],
    } satisfies ProviderModel;
    const models = parseSource({
      provider: provider(value),
      source,
      body: [
        "Flagship models",
        "Standard",
        "| Model | Short context input | Short context output |",
        "| --- | --- | --- |",
        "| gpt-4o-2024-05-13 | $5.00 | $15.00 |",
      ].join("\n"),
      observedAt,
      catalogModels: [card],
    }).models;
    expect(models).toEqual([
      expect.objectContaining({
        model_id: "gpt-4o-2024-05-13",
        pricing_state: "numeric",
        price_facts: expect.arrayContaining([
          expect.objectContaining({ meter: "input_text", price: "5.00" }),
        ]),
      }),
    ]);
  });

  it("applies an exact pricing-page alias without merging its catalog identity", () => {
    const value = manifest("openai");
    const source = value.sources.find(({ id }) => id === "openai-pricing");
    if (source === undefined) throw new Error("Missing OpenAI pricing source");
    const reconciliation: PricingReconciliationItem[] = [];
    const models = parseSource({
      provider: provider(value),
      source,
      body: [
        "Cyber models",
        "| Model | Short context input | Short context output |",
        "| --- | --- | --- |",
        "| gpt-5.6-sol | $5.00 | $30.00 |",
        "| gpt-5.6-cyber | $12.50 | $75.00 |",
        "`gpt-daybreak-blue-latest` and `gpt-daybreak-red-latest` ",
        "  are aliases that currently point to `gpt-5.6-sol` and ",
        "`gpt-5.6-cyber`, respectively.",
      ].join("\n"),
      observedAt,
      catalogModels: [
        openAiModel("gpt-daybreak-blue-latest", ["text_generation"]),
        openAiModel("gpt-daybreak-red-latest", ["text_generation"]),
        openAiModel("gpt-5.6-sol", ["text_generation"]),
        openAiModel("gpt-5.6-cyber", ["text_generation"]),
      ],
      onPricingReconciliation: (item) => reconciliation.push(item),
    }).models;
    expect(
      models.find(({ model_id }) => model_id === "gpt-daybreak-blue-latest")?.price_facts,
    ).toEqual([
      expect.objectContaining({
        meter: "input_text",
        price: "5.00",
        derived: true,
        derivation: expect.stringContaining("gpt-5.6-sol"),
      }),
      expect.objectContaining({ meter: "output_text", price: "30.00", derived: true }),
    ]);
    expect(
      models.find(({ model_id }) => model_id === "gpt-daybreak-red-latest")?.price_facts,
    ).toEqual([
      expect.objectContaining({ meter: "input_text", price: "12.50", derived: true }),
      expect.objectContaining({ meter: "output_text", price: "75.00", derived: true }),
    ]);
    expect(reconciliation).toContainEqual({
      disposition: "normalized",
      reason_code: "documented_alias_price_bound",
      sample: "gpt-daybreak-blue-latest -> gpt-5.6-sol",
    });
  });

  it("localizes pricing-table drift and conflicting cells", () => {
    const value = manifest("openai");
    const source = value.sources.find(({ id }) => id === "openai-pricing");
    if (source === undefined) throw new Error("Missing OpenAI pricing source");
    const reconciliation: PricingReconciliationItem[] = [];
    const models = parseSource({
      provider: provider(value),
      source,
      body: [
        "Flagship models",
        "Standard",
        "| Model | Short context input | Short context output |",
        "| --- | --- | --- |",
        "| gpt-test | $1.00 | $2.00 |",
        "| gpt-test | $1.10 | $2.00 |",
        `Priority ${"Plus ".repeat(60)}`,
        "| Model | Short context input | Short context output |",
        "| --- | --- | --- |",
        "| gpt-other | $3.00 | $4.00 |",
      ].join("\n"),
      observedAt,
      catalogModels: [openAiModel("gpt-test", ["text_generation"])],
      onPricingReconciliation: (item) => reconciliation.push(item),
    }).models;
    expect(models).toEqual([
      expect.objectContaining({
        model_id: "gpt-test",
        price_facts: [
          expect.objectContaining({ meter: "input_text", price: "1.00" }),
          expect.objectContaining({ meter: "output_text", price: "2.00" }),
          expect.objectContaining({ meter: "input_text", price: "1.10" }),
        ],
        raw_price_facts: [],
      }),
    ]);
    expect(reconciliation).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          disposition: "ambiguous",
          reason_code: "pricing_value_conflict",
        }),
        expect.objectContaining({
          disposition: "unsupported",
          reason_code: "unreviewed_pricing_tier",
        }),
      ]),
    );
    expect(reconciliation.every(({ sample }) => sample === undefined || sample.length <= 256)).toBe(
      true,
    );
    expect(() => sourcePricingReconciliation(models, reconciliation, true)).not.toThrow();
  });

  it("prices GPT-Live session seconds without minute rounding", async () => {
    const value = manifest("openai");
    const source = value.sources.find(({ id }) => id === "openai-pricing");
    if (source === undefined) throw new Error("Missing OpenAI pricing source");
    const modelsSource = parseSource({
      provider: provider(value),
      source,
      body: await fixture("openai/live-session-pricing.md"),
      observedAt,
      catalogModels: [openAiModel("gpt-live-1", ["speech_to_speech"])],
    });
    const models = modelsSource.models;
    expect(models[0]?.price_facts).toEqual([
      expect.objectContaining({
        meter: "session_runtime",
        price: "0.05",
        unit: "minute",
        raw_unit: "per minute",
      }),
    ]);
    const partition = assembleParsedProviderPricing(
      "openai",
      observedAt,
      [{ source, ...modelsSource }],
      models,
      value.pricingCategoricalLabels,
    );
    validateParsedPricing(value, source, models, partition);
    const rate = partition?.books
      .find(({ book_key }) => book_key === "model:openai/gpt-live-1")
      ?.offers.flatMap(({ terms }) =>
        terms.flatMap((term) => (term.kind === "rate" ? term.variants : [])),
      )[0];
    if (rate === undefined) throw new Error("Missing live session rate");
    expect(rate.charge_binding?.aggregation).toBe("session");
    expect(
      evaluateRateCost(rate, [
        {
          signal: { namespace: "kmodels", value: "active_seconds" },
          value: { numerator: "90", denominator: "1" },
        },
      ]),
    ).toMatchObject({ kind: "resolved", amount: { numerator: "3", denominator: "40" } });
  });

  it("publishes Fast with EU residency as unsupported and keeps the numeric region scopes disjoint", () => {
    const value = manifest("openai");
    const source = value.sources.find(({ id }) => id === "openai-pricing");
    if (source === undefined) throw new Error("Missing OpenAI pricing source");
    const model = {
      ...openAiModel("gpt-6-astra", ["text_generation"]),
      release_date: "2026-09-04",
      availability: [
        { region: "Europe (EEA + Switzerland)", deployment_type: "regional_processing" },
      ],
    } satisfies ProviderModel;
    const body = [
      "Flagship models",
      "Standard",
      "| Model | Short context input | Short context output |",
      "| --- | --- | --- |",
      "| gpt-6-astra | $5 | $30 |",
      "Fast mode",
      "| Model | Short context input | Short context output |",
      "| --- | --- | --- |",
      "| gpt-6-astra | $10 | $60 |",
      "Fast mode is unavailable for GPT-6 Astra with EU data residency. Use Standard processing for those requests.",
      "Regional processing (data residency) endpoints are charged a 10% uplift.",
    ].join("\n");
    const modelsSource = parseSource({
      provider: provider(value),
      source,
      body,
      observedAt,
      catalogModels: [model],
    });
    const models = modelsSource.models;
    const partition = assembleParsedProviderPricing(
      "openai",
      observedAt,
      [{ source, ...modelsSource }],
      models,
      value.pricingCategoricalLabels,
    );
    validateParsedPricing(value, source, models, partition);
    const offer = partition?.books[0]?.offers.find(({ offer_key }) => offer_key === "sync");
    expect(offer?.states.filter(({ state }) => state === "not_supported")).toEqual([
      expect.objectContaining({
        applicability: {
          any_of: [
            {
              all_of: expect.arrayContaining([
                expect.objectContaining({
                  kind: "boolean",
                  dimension: {
                    namespace: "provider",
                    provider_id: "openai",
                    value: "eu_data_residency",
                  },
                  value: true,
                }),
                expect.objectContaining({
                  kind: "categorical",
                  dimension: { namespace: "kmodels", value: "served_service_tier" },
                  values: [expect.objectContaining({ value: "fast" })],
                }),
              ]),
            },
          ],
        },
      }),
    ]);
    const rates = models[0]?.price_facts ?? [];
    expect(rates.filter(({ conditions }) => conditions.service_tier === "fast")).toHaveLength(4);
    expect(
      rates
        .filter(({ conditions }) => conditions.service_tier === "fast")
        .every(({ conditions }) => conditions.eu_data_residency === false),
    ).toBe(true);
    expect(
      rates
        .filter(({ conditions }) => conditions.service_tier === "standard")
        .every(({ conditions }) => conditions.eu_data_residency === undefined),
    ).toBe(true);
    expect(offer?.terms.some((term) => term.kind === "raw")).toBe(false);
    const ordinary = parseSource({
      provider: provider(value),
      source,
      body: body.replace("Fast mode is unavailable for GPT-6 Astra with EU data residency.", ""),
      observedAt,
      catalogModels: [model],
    }).models;
    expect(ordinary[0]?.raw_price_facts).toEqual([]);
    expect(
      ordinary[0]?.price_facts.every(
        ({ conditions }) => conditions.eu_data_residency === undefined,
      ),
    ).toBe(true);
  });

  it("preserves an exact model's future billing start and research eligibility", () => {
    const value = manifest("openai");
    const source = value.sources.find(({ id }) => id === "openai-pricing");
    if (source === undefined) throw new Error("Missing OpenAI pricing source");
    const body = [
      "Specialized models",
      "Standard",
      "| Category | Model | Input | Cached input | Output |",
      "| --- | --- | --- | --- | --- |",
      "| Life Sciences | gpt-rosalind-research | $5.00 | $0.50 | $25.00 |",
      "Billing for `gpt-rosalind-research` begins on October 5, 2026. Cache-write pricing does not apply to this model. Access is limited to approved internal research through the trusted-access program.",
    ].join("\n");
    const parse = (body: string) =>
      parseSource({
        provider: provider(value),
        source,
        body,
        observedAt,
        catalogModels: [openAiModel("gpt-rosalind-research", ["text_generation"])],
      }).models;
    const model = parse(body)[0];
    expect(model?.price_facts).toHaveLength(3);
    expect(
      model?.price_facts.every(
        ({ conditions }) =>
          conditions.effective_from === "2026-10-05" &&
          conditions.account_eligibility === "approved_internal_research",
      ),
    ).toBe(true);
    const unresolved = parse(body.replace("October 5, 2026", "a date to be announced"))[0];
    expect(unresolved?.price_facts).toEqual([]);
    expect(unresolved?.raw_price_facts).toHaveLength(3);
  });

  it("recovers renamed Fast and Ultrafast tables with first-party regional scopes", () => {
    const value = manifest("openai");
    const source = value.sources.find(({ id }) => id === "openai-pricing");
    if (source === undefined) throw new Error("Missing OpenAI pricing source");
    const catalogModels = ["gpt-6-astra", "gpt-6.1-sol"].map((id) => ({
      ...openAiModel(id, ["text_generation"]),
      release_date: "2026-09-04",
      availability: [{ region: "United States", deployment_type: "regional_processing" }],
    }));
    const index = {
      url: source.url,
      body: [
        "Flagship models",
        "Standard",
        "| Model | Short context input | Short context output |",
        "| --- | --- | --- |",
        "| gpt-6-astra | $10 | $50 |",
        "Fast",
        "| Model | Short context input | Short context output |",
        "| --- | --- | --- |",
        "| gpt-6-astra | $20 | $100 |",
        "| gpt-6.1-sol | $8 | $40 |",
        "Ultrafast",
        "| Model | Short context input | Short context output |",
        "| --- | --- | --- |",
        "| gpt-6-astra | $60 | $300 |",
        "Regional processing (data residency) endpoints are charged a 10% uplift.",
      ].join("\n"),
    };
    const documents = [
      {
        url: "https://developers.openai.com/api/docs/guides/fast-mode.md",
        body: "Fast mode is not available with EU data residency for GPT-6 Astra, GPT-6.1 Sol, GPT-6 Sol, or GPT-6 Luna.",
      },
      {
        url: "https://developers.openai.com/api/docs/guides/ultrafast-mode.md",
        body: "Ultrafast supports US data residency and global processing only.",
      },
    ];
    const parse = (companions: typeof documents) =>
      parseSource({
        provider: provider(value),
        source,
        observedAt,
        catalogModels,
        body: JSON.stringify({ index, documents: companions }),
      }).models;
    const models = parse(documents);
    const fast = models
      .flatMap(({ price_facts }) => price_facts)
      .filter(({ conditions }) => conditions.service_tier === "fast");
    expect(fast).toHaveLength(8);
    expect(fast.every(({ conditions }) => conditions.eu_data_residency === false)).toBe(true);
    const ultrafast = models
      .flatMap(({ price_facts }) => price_facts)
      .filter(({ conditions }) => conditions.service_tier === "ultrafast");
    expect(ultrafast.map(({ price, conditions }) => ({ price, conditions }))).toEqual([
      {
        price: "60",
        conditions: {
          service_tier: "ultrafast",
          deployment_scope: "global_processing",
          context_max_tokens: 272000,
        },
      },
      {
        price: "66",
        conditions: {
          service_tier: "ultrafast",
          deployment_scope: "regional_processing",
          region: "United States",
          context_max_tokens: 272000,
        },
      },
      {
        price: "300",
        conditions: {
          service_tier: "ultrafast",
          deployment_scope: "global_processing",
          context_max_tokens: 272000,
        },
      },
      {
        price: "330",
        conditions: {
          service_tier: "ultrafast",
          deployment_scope: "regional_processing",
          region: "United States",
          context_max_tokens: 272000,
        },
      },
    ]);
    const partition = assembleParsedProviderPricing(
      "openai",
      observedAt,
      [{ source, models }],
      models,
      value.pricingCategoricalLabels,
    );
    validateParsedPricing(value, source, models, partition);
    const degraded = parse(documents.slice(0, 1));
    expect(
      degraded
        .flatMap(({ price_facts }) => price_facts)
        .filter(({ conditions }) => conditions.service_tier === "fast"),
    ).toEqual(fast);
    expect(
      degraded
        .flatMap(({ raw_price_facts }) => raw_price_facts)
        .filter(({ conditions }) => conditions.service_tier === "ultrafast"),
    ).toHaveLength(2);
    const noGuides = parse([]);
    expect(
      noGuides
        .flatMap(({ price_facts }) => price_facts)
        .every(({ conditions }) => conditions.service_tier === "standard"),
    ).toBe(true);
    expect(noGuides.flatMap(({ raw_price_facts }) => raw_price_facts)).toHaveLength(6);
  });

  it("derives disjoint regional-processing rates from exact release eligibility", () => {
    const value = manifest("openai");
    const source = value.sources.find(({ id }) => id === "openai-pricing");
    if (source === undefined) throw new Error("Missing OpenAI pricing source");
    const model = {
      ...openAiModel("gpt-test", ["text_generation"]),
      release_date: "2026-03-05",
      availability: [{ region: "United States", deployment_type: "regional_processing" }],
    } satisfies ProviderModel;
    const oldModel = {
      ...openAiModel("gpt-old", ["text_generation"]),
      release_date: "2026-03-04",
      availability: [{ region: "United States", deployment_type: "regional_processing" }],
    } satisfies ProviderModel;
    const modelsSource = parseSource({
      provider: provider(value),
      source,
      body: [
        "Flagship models",
        "Standard",
        "| Model | Short context input | Short context output |",
        "| --- | --- | --- |",
        "| gpt-test | $1.00 | $2.00 |",
        "| gpt-old | $3.00 | $4.00 |",
        "Regional processing (data residency) endpoints are charged a 10% uplift for models released on or after March 5, 2026, that are eligible for data residency.",
      ].join("\n"),
      observedAt,
      catalogModels: [model, oldModel],
    });
    const models = modelsSource.models;
    expect(
      models
        .find(({ model_id }) => model_id === "gpt-test")
        ?.price_facts.map(({ meter, price, conditions }) => ({ meter, price, conditions })),
    ).toEqual([
      {
        meter: "input_text",
        price: "1.00",
        conditions: {
          service_tier: "standard",
          deployment_scope: "global_processing",
          context_max_tokens: 272000,
        },
      },
      {
        meter: "input_text",
        price: "1.1",
        conditions: {
          service_tier: "standard",
          deployment_scope: "regional_processing",
          context_max_tokens: 272000,
        },
      },
      {
        meter: "output_text",
        price: "2.00",
        conditions: {
          service_tier: "standard",
          deployment_scope: "global_processing",
          context_max_tokens: 272000,
        },
      },
      {
        meter: "output_text",
        price: "2.2",
        conditions: {
          service_tier: "standard",
          deployment_scope: "regional_processing",
          context_max_tokens: 272000,
        },
      },
    ]);
    expect(models.find(({ model_id }) => model_id === "gpt-test")?.raw_price_facts).toEqual([]);
    expect(
      models
        .find(({ model_id }) => model_id === "gpt-old")
        ?.price_facts.map(({ price, conditions }) => ({ price, conditions })),
    ).toEqual([
      { price: "3.00", conditions: { service_tier: "standard", context_max_tokens: 272000 } },
      { price: "4.00", conditions: { service_tier: "standard", context_max_tokens: 272000 } },
    ]);
    const assembled = assembleParsedProviderPricing(
      "openai",
      observedAt,
      [{ source, ...modelsSource }],
      [model, oldModel],
      value.pricingCategoricalLabels,
    );
    const terms = assembled?.books
      .find(({ book_key: key }) => key === "model:openai/gpt-test")
      ?.offers.flatMap(({ terms }) => terms);
    expect(terms?.flatMap((term) => (term.kind === "rate" ? term.raw_variants : []))).toEqual([]);
  });

  it("binds Realtime translation duration to audio input", async () => {
    const models = await openAiModelPricing("openai/realtime-translation-catalog.json", [
      openAiModel("gpt-realtime-translate", ["translation"]),
      openAiModel("gpt-transcribe", ["transcription"]),
    ]);
    expect(models.find(({ model_id }) => model_id === "gpt-realtime-translate")).toMatchObject({
      model_id: "gpt-realtime-translate",
      tasks: ["translation"],
      price_facts: [
        expect.objectContaining({ meter: "input_audio", price: "0.034", unit: "minute" }),
      ],
    });
    expect(models.find(({ model_id }) => model_id === "gpt-transcribe")).toMatchObject({
      tasks: ["transcription"],
      price_facts: [
        expect.objectContaining({ meter: "input_audio", price: "0.0045", unit: "minute" }),
      ],
    });
  });

  it("accepts reviewed Live endpoints and names identical to model IDs", async () => {
    const value = manifest("openai");
    const source = value.sources[0];
    if (source === undefined) throw new Error("Missing OpenAI catalog source");
    const body = (await fixture("openai/catalog.json")).replaceAll(
      "| Realtime |",
      "| Live | `v1/live/sessions` | Supported |\\n| Realtime |",
    );
    const findings: SourceContractEvidence[] = [];
    const models = parseSource({
      provider: provider(value),
      source,
      body,
      observedAt,
      onContractFinding: (finding) => findings.push(finding),
    }).models;
    expect(models[0]?.api_endpoints).toContainEqual({ name: "Live", path: "v1/live/sessions" });
    expect(models[0]?.tasks).toContain("speech_to_speech");
    expect(findings).toEqual([]);
  });

  it.each([
    ["Supported", "Not supported", "Supported"],
    ["Not supported", "Supported", "Not supported"],
    ["Supported", "Limited", "Supported"],
  ])("withholds contradictory endpoint peers (%s, %s, %s)", async (first, second, third) => {
    const models = await parsed("openai", "openai/catalog.json", undefined, (body) => {
      const bundle = linkedBundle(body);
      const doc = bundle.documents.find(({ url }) => url.endsWith("gpt-5.4.md"));
      if (doc === undefined) throw new Error("Missing GPT fixture");
      doc.body = doc.body.replace(
        "| Chat Completions | `v1/chat/completions` | Supported |",
        [first, second, third]
          .map((value) => `| Chat Completions | \`v1/chat/completions\` | ${value} |`)
          .join("\n"),
      );
      return JSON.stringify(bundle);
    });
    const model = models.find(({ model_id }) => model_id === "gpt-5.4");
    expect(model?.api_endpoints).not.toContainEqual(
      expect.objectContaining({ path: "v1/chat/completions" }),
    );
    expect(model?.api_endpoints).toContainEqual(expect.objectContaining({ path: "v1/responses" }));
    expect(model?.limits.context_tokens).toBe(1050000);
  });

  it("preserves model facts and signals an unreviewed endpoint card", async () => {
    const value = manifest("openai");
    const source = value.sources[0];
    if (source === undefined) throw new Error("Missing OpenAI catalog source");
    const body = (await fixture("openai/catalog.json")).replace(
      "v1/chat/completions",
      "v1/conversations",
    );
    let finding: SourceContractEvidence | undefined;
    const models = parseSource({
      provider: provider(value),
      source,
      body,
      observedAt,
      onContractFinding: (value) => {
        finding = value;
      },
    }).models;
    expect(models).not.toHaveLength(0);
    expect(finding).toMatchObject({ disposition: "accept_with_signal" });
  });

  it("parses scoped API inventory without treating it as the global catalog", async () => {
    const models = await parsed("openai", "openai/api.json", "openai-api");
    expect(models.map((model) => model.model_id)).toEqual(["gpt-5.4", "ft:gpt-5.4:example"]);
  });

  it("keeps an explicit routed alias inside its matching Markdown card", async () => {
    const body = (await fixture("openai/catalog.json")).replace(
      "GPT-5.4 is a professional reasoning model.",
      "GPT-5.4 is a professional reasoning model. The `gpt-5.4-latest` alias routes requests to GPT-5.4.",
    );
    const value = manifest("openai");
    const source = value.sources[0];
    if (source === undefined) throw new Error("Missing OpenAI catalog source");
    const models = parseSource({ provider: provider(value), source, body, observedAt }).models;
    expect(models.find(({ model_id }) => model_id === "gpt-5.4")?.aliases).toEqual([
      "gpt-5.4-2026-03-05",
      "gpt-5.4-latest",
    ]);
  });

  it("skips an irregular deprecation row without losing valid siblings", async () => {
    const models = await parsed("openai", "openai/deprecations.md", "openai-deprecations", (body) =>
      body.replace("| 2026-09-28", "| malformed |\n| 2026-09-28"),
    );
    expect(models.map(({ model_id }) => model_id)).toEqual([
      "gpt-4o-2024-05-13",
      "gpt-5.4",
      "text-embedding-3-large",
    ]);
  });

  it.each([false, true])(
    "keeps alias evidence when an earlier shutdown is encountered later (%s)",
    async (reverse) => {
      const rows = [
        "| 2026-09-01 | `gpt-test` \\| `gpt-old-alias` |",
        "| 2026-10-01 | `gpt-test` \\| `gpt-new-alias` |",
      ];
      const models = await parsed("openai", "openai/deprecations.md", "openai-deprecations", () =>
        [
          "| Shutdown date | Model |",
          "| --- | --- |",
          ...(reverse ? rows.toReversed() : rows),
        ].join("\n"),
      );
      expect(models[0]?.retired_at).toBe("2026-10-01");
      expect(models[0]?.aliases.toSorted()).toEqual(["gpt-new-alias", "gpt-old-alias"]);
    },
  );

  it("parses lifecycle dates and replacements from deprecation tables", async () => {
    const models = await parsed("openai", "openai/deprecations.md", "openai-deprecations");
    expect(
      models.map(({ model_id, status, retired_at, replacement_model_ids }) => ({
        model_id,
        status,
        retired_at,
        replacement_model_ids,
      })),
    ).toEqual([
      {
        model_id: "gpt-4o-2024-05-13",
        status: "deprecated",
        retired_at: "2026-10-23",
        replacement_model_ids: ["gpt-5.6-sol"],
      },
      {
        model_id: "gpt-5.4",
        status: "deprecated",
        retired_at: "2026-09-28",
        replacement_model_ids: ["gpt-5.6-sol"],
      },
      {
        model_id: "text-embedding-3-large",
        status: "retired",
        retired_at: "2026-02-17",
        replacement_model_ids: ["text-embedding-3-small"],
      },
    ]);

    const value = manifest("openai");
    const lifecycleSource = value.sources.find(({ id }) => id === "openai-deprecations");
    if (lifecycleSource === undefined) throw new Error("Missing OpenAI lifecycle source");
    const current = baseModel({
      providerId: "openai",
      id: "gpt-5.4",
      name: "GPT-5.4",
      sourceId: "openai-models",
      observedAt,
    });
    const bounded = parseSource({
      provider: provider(value),
      source: lifecycleSource,
      body: await fixture("openai/deprecations.md"),
      observedAt,
      catalogModels: [current],
    }).models;
    expect(bounded.map(({ model_id }) => model_id)).toEqual(["gpt-4o-2024-05-13", "gpt-5.4"]);
    expect(bounded.find(({ model_id }) => model_id === "gpt-5.4")?.aliases).toEqual([
      "gpt-5.4-completions",
    ]);
  });

  it("keeps indexed identity when a model page is missing or malformed", async () => {
    const value = manifest("openai");
    const source = value.sources[0];
    if (source === undefined) throw new Error("Missing OpenAI catalog source");
    let finding: SourceContractEvidence | undefined;
    const models = parseSource({
      provider: provider(value),
      source,
      body: await fixture("openai/broken-catalog.json"),
      observedAt,
      onContractFinding: (value) => {
        finding = value;
      },
    }).models;
    expect(models).toEqual([
      expect.objectContaining({ model_id: "gpt-5.4", name: "GPT-5.4", status: "active" }),
    ]);
    expect(finding).toMatchObject({ disposition: "accept_with_signal" });
  });
});

describe("OpenAI fixed search content", () => {
  it("admits a model-bound content rule without a model row in that pricing source", async () => {
    const value = manifest("openai");
    const source = value.sources.find(({ id }) => id === "openai-pricing");
    if (source === undefined) throw new Error("Missing OpenAI pricing source");
    const model = openAiModel("gpt-4o-mini", ["text_generation"]);
    const quote = (await fixture("openai/fixed-search.md")).match(/For gpt-4o-mini[^\n]+/)?.[0];
    if (quote === undefined) throw new Error("Missing fixed-content quote");
    const result = parseSource({
      provider: provider(value),
      source,
      observedAt,
      catalogModels: [model],
      body: `Tools\n${quote}`,
    });
    expect(result.models).toEqual([]);
    expect(result.commercial_facts).toEqual([
      expect.objectContaining({
        resource_key: "web-search-content:gpt-4o-mini",
        model_refs: [model.uid],
      }),
    ]);
    const partition = assembleParsedProviderPricing(
      "openai",
      observedAt,
      [{ source, ...result }],
      [model],
      value.pricingCategoricalLabels,
    );
    validateParsedPricing(value, source, [model], partition);
    expect(partition?.books[0]?.offers[0]?.terms[0]).toMatchObject({
      kind: "contribution",
      variants: [],
      raw_variants: [expect.objectContaining({ reason: "target_rate_not_normalized" })],
    });
  });

  it.each([false, true])(
    "preserves unrecognized fixed-content evidence alongside normalized rules: %s",
    async (includeKnown) => {
      const value = manifest("openai");
      const source = value.sources.find(({ id }) => id === "openai-pricing");
      if (source === undefined) throw new Error("Missing OpenAI pricing source");
      const body = await fixture("openai/fixed-search.md");
      const fragment =
        "For gpt-4o-mini and gpt-4.1-mini with the non-preview web search tool, search content tokens have an unpublished fixed block size.";
      const modelsSource = parseSource({
        provider: provider(value),
        source,
        body: includeKnown
          ? `${body}\n${fragment}`
          : body.replace(/For gpt-4o-mini[^\n]+/, fragment),
        observedAt,
        catalogModels: [],
      });
      const models = modelsSource.models;
      const partition = assembleParsedProviderPricing(
        "openai",
        observedAt,
        [{ source, ...modelsSource }],
        models,
        value.pricingCategoricalLabels,
      );
      validateParsedPricing(value, source, models, partition);
      const term = partition?.books.find(
        ({ book_key }) => book_key === "service:web-search-content:gpt-4o-mini",
      )?.offers[0]?.terms[0];
      expect(term?.kind).toBe("contribution");
      if (term?.kind !== "contribution") throw new Error("Missing fixed-content term");
      const raw = term.raw_variants;
      expect(raw).toHaveLength(1);
      expect(raw[0]?.observations).toEqual([
        expect.objectContaining({ raw: expect.objectContaining({ fragment }) }),
      ]);
      expect(term.variants).toHaveLength(includeKnown ? 1 : 0);
    },
  );

  it("contributes fixed tokens to the model rate without copying prices or requiring a runtime locator", async () => {
    const value = manifest("openai");
    const source = value.sources.find(({ id }) => id === "openai-pricing");
    if (source === undefined) throw new Error("Missing OpenAI pricing source");
    const body = await fixture("openai/fixed-search.md");
    const parse = (text: string) =>
      parseSource({ provider: provider(value), source, body: text, observedAt, catalogModels: [] });
    const parsedSource = parse(body);
    const facts = parsedSource.commercial_facts ?? [];
    expect(
      facts
        .filter(({ resource_key }) => resource_key.startsWith("web-search-content:"))
        .map(({ model_refs }) => model_refs),
    ).toEqual([["openai/gpt-4.1-mini"], ["openai/gpt-4o-mini"]]);
    const assemble = (result: SourceParseResult) =>
      assembleParsedProviderPricing(
        "openai",
        observedAt,
        [{ source, ...result }],
        result.models,
        value.pricingCategoricalLabels,
      );
    const cost = (text: string, evidence?: string) => {
      const result = parse(text);
      if (evidence !== undefined) {
        const term = result.commercial_facts?.find(
          ({ resource_key }) => resource_key === "web-search-content:gpt-4o-mini",
        )?.terms?.[0];
        const observation = term?.variants[0]?.observations[0];
        if (observation === undefined) throw new Error("Missing fixed-content observation");
        observation.raw["fragment"] = evidence;
      }
      const partition = assemble(result);
      validateParsedPricing(value, source, result.models, partition);
      const term = partition?.books.find(
        ({ book_key }) => book_key === "service:web-search-content:gpt-4o-mini",
      )?.offers[0]?.terms[0];
      if (term?.kind !== "contribution" || term.variants[0] === undefined)
        throw new Error("Missing fixed search rate binding");
      const contribution = term.variants[0];
      const binding = contribution.charge_bindings[0];
      const target = partition?.books
        .flatMap(({ offers }) => offers.flatMap(({ terms }) => terms))
        .find(({ id }) => contribution.target_rate_refs.includes(id));
      if (binding === undefined || target?.kind !== "rate" || target.variants[0] === undefined)
        throw new Error("Missing referenced model input rate");
      return evaluateRateCost({ ...target.variants[0], charge_binding: binding }, [
        {
          signal: {
            namespace: "provider",
            provider_id: "openai",
            value: "fixed_search_content_calls",
          },
          value: { numerator: "2", denominator: "1" },
        },
      ]);
    };
    expect(cost(body)).toEqual({
      kind: "resolved",
      amount: { numerator: "3", denominator: "1250" },
      denomination: { kind: "fiat", currency: "USD" },
    });
    expect(cost(body.replace("$0.15", "$0.25"))).toMatchObject({
      amount: { numerator: "1", denominator: "250" },
    });
    expect(cost(body.replace("8,000", "9,000"))).toMatchObject({
      amount: { numerator: "27", denominator: "10000" },
    });
    expect(cost(body, "A 999,000-token fixed block.")).toEqual(cost(body));
  });

  it.each(["missing", "unreadable", "conflicting", "equal", "outside-tools"] as const)(
    "contains fixed-content dependency and source ownership failures: %s",
    async (scenario) => {
      const value = manifest("openai");
      const source = value.sources.find(({ id }) => id === "openai-pricing");
      if (source === undefined) throw new Error("Missing OpenAI pricing source");
      let body = await fixture("openai/fixed-search.md");
      const quote = body.match(/For gpt-4o-mini[^\n]+/)?.[0];
      if (quote === undefined) throw new Error("Missing fixed-content fixture quote");
      switch (scenario) {
        case "missing":
          body = body.replace("$0.15", "-");
          break;
        case "unreadable":
          body = body.replace("$0.15", "TBD");
          break;
        case "conflicting":
          body += `\n${quote.replace("8,000", "9,000")}`;
          break;
        case "equal":
          body += `\n${quote.replace("8,000", "8000")}`;
          break;
        case "outside-tools":
          body = body.replace(quote, `Finetuning\n${quote}`);
          break;
      }
      const items: PricingReconciliationItem[] = [];
      const result = parseSource({
        provider: provider(value),
        source,
        body,
        observedAt,
        catalogModels: [],
        onPricingReconciliation: (item) => items.push(item),
      });
      const partition = assembleParsedProviderPricing(
        "openai",
        observedAt,
        [{ source, ...result }],
        result.models,
        value.pricingCategoricalLabels,
      );
      validateParsedPricing(value, source, result.models, partition);
      const term = partition?.books.find(
        ({ book_key }) => book_key === "service:web-search-content:gpt-4o-mini",
      )?.offers[0]?.terms[0];
      if (scenario === "outside-tools") {
        expect(term).toBeUndefined();
        return;
      }
      if (term?.kind !== "contribution") throw new Error("Missing fixed-content contribution");
      expect(term.variants).toHaveLength(scenario === "equal" ? 1 : 0);
      expect(term.raw_variants.map(({ reason }) => reason)).toEqual(
        scenario === "equal"
          ? []
          : [scenario === "conflicting" ? "conflicting_values" : "target_rate_not_normalized"],
      );
      expect(
        items.filter(({ reason_code }) => reason_code === "fixed_search_content_rule"),
      ).toHaveLength(scenario === "equal" || scenario === "conflicting" ? 2 : 1);
    },
  );
});
