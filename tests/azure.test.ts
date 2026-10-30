import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";
import { parseSource } from "../src/catalog/adapters.ts";
import { applySupplementGroups } from "../src/catalog/collector.ts";
import { manifests, type ProviderManifest, type SourceManifest } from "../src/catalog/manifests.ts";
import { baseModel } from "../src/catalog/model.ts";
import { publishedRate } from "../src/catalog/pricing.ts";
import { evaluateRateCost } from "../src/catalog/pricing-calculation.ts";
import { assembleParsedProviderPricing } from "../src/catalog/pricing-adapter.ts";
import { capturePricingReplaySources } from "../src/catalog/pricing-compilation.ts";
import type { ProviderPricingPartition } from "../src/catalog/pricing-assembly.ts";
import { validatePricingCatalog } from "../src/catalog/pricing-validation.ts";
import type { PricingReconciliationItem } from "../src/catalog/pricing-reconciliation.ts";
import type {
  ParsedProviderModel as ProviderModel,
  SourcePricingInputFact,
} from "../src/catalog/pricing-source.ts";
import type { ModelTask, Provider } from "../src/catalog/schema.ts";
import type { SourceContractEvidence } from "../src/catalog/source-contract.ts";

const observedAt = "2026-07-21T00:00:00.000Z";

async function fixture(path: string): Promise<string> {
  return readFile(new URL(`./fixtures/${path}`, import.meta.url), "utf8");
}

function manifest(providerId: string): ProviderManifest {
  const value = manifests.find((item) => item.provider.id === providerId);
  if (value === undefined) throw new Error(`Missing manifest ${providerId}`);
  return value;
}

function provider(value: ProviderManifest): Provider {
  return { ...value.provider, source_ids: value.sources.map((source) => source.id) };
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

const azureApiFixtureSchema = z
  .object({
    regions: z.array(z.object({ location: z.string(), models: z.array(z.unknown()) })),
  })
  .passthrough();
async function azureApiFixture(): Promise<z.infer<typeof azureApiFixtureSchema>> {
  return azureApiFixtureSchema.parse(JSON.parse(await fixture("azure/api.json")));
}

function azurePricingModel(id: string, version?: string): ProviderModel {
  return {
    ...baseModel({
      providerId: "azure",
      id,
      ...(version === undefined ? {} : { version }),
      name: id,
      sourceId: "azure-models",
      observedAt,
    }),
    service_families: ["Azure OpenAI"],
  };
}

function azureRetailSource(
  minModels: number,
  maxModels: number,
  minHandledRatio: number,
): SourceManifest {
  const configured = manifest("azure").sources.find(({ id }) => id === "azure-retail-prices");
  if (configured === undefined || configured.extractor.kind !== "azure-retail-prices")
    throw new Error("Missing Azure retail-price source");
  return {
    ...configured,
    extractor: { kind: "azure-retail-prices", minModels, maxModels, minHandledRatio },
  };
}

function azurePublicPricingSource(minModels: number, maxModels: number): SourceManifest {
  const configured = manifest("azure").sources.find(({ id }) => id === "azure-public-pricing");
  if (configured === undefined || configured.extractor.kind !== "azure-public-pricing")
    throw new Error("Missing Azure public-pricing source");
  return {
    ...configured,
    extractor: { kind: "azure-public-pricing", minModels, maxModels },
  };
}

function azureAccountingSource(): SourceManifest {
  const configured = manifest("azure").sources.find(({ id }) => id === "azure-accounting");
  if (configured === undefined || configured.extractor.kind !== "azure-accounting")
    throw new Error("Missing Azure accounting source");
  return configured;
}

function azurePortalSource(minModels: number, maxModels: number): SourceManifest {
  const configured = manifest("azure").sources.find(({ id }) => id === "azure-portal-models");
  if (configured === undefined || configured.extractor.kind !== "azure-portal-catalog")
    throw new Error("Missing Azure portal source");
  return {
    ...configured,
    extractor: { kind: "azure-portal-catalog", minModels, maxModels },
  };
}

function azureApiModels(
  body: string,
  reconciliation?: PricingReconciliationItem[],
): ProviderModel[] {
  const value = manifest("azure");
  const source = value.sources.find(({ id }) => id === "azure-api");
  if (source === undefined) throw new Error("Missing Azure API source");
  return parseSource({
    provider: provider(value),
    source,
    body,
    observedAt,
    ...(reconciliation === undefined
      ? {}
      : { onPricingReconciliation: (item) => reconciliation.push(item) }),
  }).models;
}

async function azureCatalog(
  lifecycleBody?: string,
  omitted: ReadonlySet<string> = new Set(),
  openAiBody?: string,
): Promise<ProviderModel[]> {
  const value = manifest("azure");
  const configured = value.sources[0];
  if (configured === undefined || configured.extractor.kind !== "azure-catalog")
    throw new Error("Missing Azure source");
  const source: SourceManifest = {
    ...configured,
    extractor: { kind: "azure-catalog", minModels: 1, maxModels: 20 },
  };
  const documents = [
    ["models-azure-direct-others.md", "others.md"],
    ["models-partners.md", "partners.md"],
    ["concepts-model-retirement-schedule-content.md", "lifecycle.md"],
    ["concepts-retired-models-content.md", "retired.md"],
    ["deployments-standard.md", "standard.md"],
    ["deployments-provisioned.md", "provisioned.md"],
    ["deployments-batch.md", "batch.md"],
  ] as const;
  const body = JSON.stringify({
    index: {
      url: "https://raw.githubusercontent.com/MicrosoftDocs/azure-ai-docs/main/articles/foundry/openai/includes/models-azure-direct-openai.md",
      body: openAiBody ?? (await fixture("azure/openai.md")),
    },
    documents: await Promise.all(
      documents
        .filter(([name]) => !omitted.has(name))
        .map(async ([name, path]) => ({
          url: `https://raw.githubusercontent.com/MicrosoftDocs/azure-ai-docs/main/${name}`,
          body:
            name === "concepts-model-retirement-schedule-content.md" && lifecycleBody !== undefined
              ? lifecycleBody
              : await fixture(`azure/${path}`),
        })),
    ),
  });
  return parseSource({ provider: provider(value), source, body, observedAt }).models;
}

describe("Azure adapters", () => {
  it("retains an unclassified built-in quote without claiming prices are unpublished", async () => {
    const value = manifest("azure");
    const source = azurePublicPricingSource(0, 2);
    const page = (await fixture("azure/commercial-openai-pricing.html"))
      .replace(/<table aria-label="GPT-4o">[\s\S]*?<\/table>/, "")
      .replace("File Search Tool Call (Responses API only)", "Unreviewed tool usage");
    const parsed = parseSource({
      provider: provider(value),
      source,
      observedAt,
      catalogModels: [azurePricingModel("gpt-4o", "2024-08-06")],
      body: JSON.stringify({
        index: {
          url: "https://azure.microsoft.com/en-us/pricing/details/azure-openai/",
          body: page,
        },
        documents: [],
      }),
    });
    const fact = parsed.commercial_facts?.find(({ resource_key }) =>
      resource_key.startsWith("unclassified-built-in:"),
    );
    expect(fact).toMatchObject({
      pricing_state: "unknown",
      price_facts: [],
      raw_price_facts: [expect.objectContaining({ reason: "unknown_meter" })],
    });
    const pricing = assembleParsedProviderPricing("azure", observedAt, [{ source, ...parsed }], []);
    expect(
      pricing?.books.flatMap(({ offers }) => offers.flatMap(({ states }) => states)),
    ).not.toContainEqual(expect.objectContaining({ state: "not_published" }));
  });

  it.each([false, true])(
    "does not subtract another region's cache charge (broad input scope=%s)",
    (broad) => {
      const configured = azurePublicPricingSource(1, 1);
      const source: SourceManifest = {
        ...configured,
        fields: [...configured.fields, "pricing_inputs"],
      };
      const priced: ProviderModel = {
        ...azurePricingModel("gpt-regional"),
        api_endpoints: [{ name: "Chat", path: "openai/v1/chat/completions" }],
        pricing_state: "numeric",
        price_facts: [
          publishedRate(
            "input_text",
            "2",
            "million_tokens",
            source.id,
            "per M tokens",
            broad ? {} : { region: "westus" },
          ),
          ...(!broad
            ? [
                publishedRate("input_text", "1", "million_tokens", source.id, "per M tokens", {
                  region: "eastus",
                }),
              ]
            : []),
          publishedRate("cache_read_text", "0.5", "million_tokens", source.id, "per M tokens", {
            region: "eastus",
          }),
        ],
      };
      const pricedInputs: SourcePricingInputFact[] = [
        {
          key: "chat.input_tokens",
          channel: "response",
          locator: { kind: "json_pointer", value: "/usage/prompt_tokens" },
          availability: "terminal_only",
          source_ref: source.id,
        },
        {
          key: "chat.cached_input_tokens",
          channel: "response",
          locator: { kind: "json_pointer", value: "/usage/prompt_tokens_details/cached_tokens" },
          availability: "terminal_only",
          source_ref: source.id,
        },
      ];
      const partition = assembleParsedProviderPricing(
        "azure",
        observedAt,
        [{ source, models: [priced], pricing_inputs: pricedInputs }],
        [priced],
      );
      const term = partition?.books[0]?.offers[0]?.terms.find(
        (term) => term.kind === "rate" && term.meter.value === "input_text",
      );
      if (term?.kind !== "rate") throw new Error("Missing regional input rate");
      const input = term.variants.find(
        ({ price }) => price.value.numerator === "1" && price.value.denominator === "500000",
      );
      if (input === undefined) throw new Error("Missing input rate at USD 2 per million tokens");
      if (broad) expect(input.charge_binding?.quantity_methods).toBeUndefined();
      else {
        expect(input.charge_binding?.quantity_methods?.[0]?.calculation).toBeUndefined();
        expect(input.charge_binding?.quantity_methods?.[0]?.input_sources).toContainEqual(
          expect.objectContaining({
            locator: { kind: "json_pointer", value: "/usage/prompt_tokens" },
          }),
        );
        expect(
          evaluateRateCost(input, [
            {
              signal: { namespace: "kmodels", value: "uncached_input_tokens" },
              value: { numerator: "1000", denominator: "1" },
            },
          ]),
        ).toMatchObject({ kind: "resolved", amount: { numerator: "1", denominator: "500" } });
      }
      validateParsedPricing(manifest("azure"), source, [priced], partition);
    },
  );

  it("preserves known model limits when another capability row omits them", async () => {
    const body = `${await fixture("azure/openai.md")}\n## Additional operations\n\n| Model ID | Description |\n| --- | --- |\n| \`gpt-multi\` (2026-01-01) | Chat Completions API. Streaming. |\n`;
    const model = (await azureCatalog(undefined, new Set(), body)).find(
      ({ uid }) => uid === "azure/gpt-multi@2026-01-01",
    );
    expect(model?.limits).toMatchObject({ context_tokens: 128_000, max_output_tokens: 16_384 });
  });

  it.each([false, true])(
    "keeps ARM scalar conflicts unknown after a third location (reverse=%s)",
    async (reverse) => {
      const bundle = await azureApiFixture();
      const original = z
        .object({
          description: z.string(),
          model: z
            .object({
              lifecycleStatus: z.string(),
              capabilities: z.record(z.string(), z.string()),
            })
            .passthrough(),
        })
        .passthrough()
        .parse(bundle.regions[0]?.models[0]);
      const changed = structuredClone(original);
      changed.description = "A different regional description.";
      changed.model.lifecycleStatus = "Preview";
      changed.model.capabilities.streaming = "false";
      changed.model.capabilities.maxContextToken = "256000";
      const items = reverse ? [changed, original, original] : [original, changed, original];
      bundle.regions = items.map((item, index) => ({ location: `region${index}`, models: [item] }));
      const model = azureApiModels(JSON.stringify(bundle))[0];
      expect(model?.description).toBeUndefined();
      expect(model?.limits.context_tokens).toBeUndefined();
      expect(model?.capabilities.streaming).toBe("unknown");
      expect(model?.release_stage).toBe("unknown");
      expect(model?.limits.max_output_tokens).toBe(16_384);
    },
  );

  it("retains conflicting direct ARM amounts instead of selecting the last observation", async () => {
    const bundle = z
      .object({
        regions: z.array(z.unknown()),
        prices: z.array(z.object({ retailPrice: z.number() }).passthrough()),
      })
      .parse(JSON.parse(await fixture("azure/api.json")));
    const price = bundle.prices[0];
    if (price === undefined) throw new Error("Missing ARM fixture price");
    bundle.prices.push({ ...price, retailPrice: 2.5 });
    expect(
      azureApiModels(JSON.stringify(bundle))[0]?.price_facts.map(({ price }) => price),
    ).toEqual(["1.25", "2.5"]);
  });

  it("preserves same-page public price conflicts through canonical assembly", async () => {
    const source = azurePublicPricingSource(1, 1);
    const body = await fixture("azure/public-openai-pricing.html");
    const row = body.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1];
    if (row === undefined) throw new Error("Missing public fixture row");
    const models = parseSource({
      provider: provider(manifest("azure")),
      source,
      observedAt,
      body: JSON.stringify({
        index: {
          url: "https://azure.microsoft.com/en-us/pricing/details/azure-openai/",
          body: body.replace(
            "</tbody>",
            `${row.replace('"us-east":2.5', '"us-east":3.5')}</tbody>`,
          ),
        },
        documents: [],
      }),
      catalogModels: [azurePricingModel("gpt-4o", "2024-08-06")],
    }).models;
    const partition = assembleParsedProviderPricing(
      "azure",
      observedAt,
      [{ source, models }],
      models,
    );
    const term = partition?.books[0]?.offers[0]?.terms.find(
      (term) => term.kind === "rate" && term.meter.value === "input_text",
    );
    if (term?.kind !== "rate") throw new Error("Missing input rate");
    const conflicts = term.raw_variants.filter(({ reason }) => reason === "conflicting_values");
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.observations.map(({ raw }) => raw.amount)).toEqual(
      expect.arrayContaining(["2.5", "3.5"]),
    );
    expect(term.variants).toHaveLength(1);
    validateParsedPricing(manifest("azure"), source, models, partition);
  });

  it("isolates an invalid published amount without discarding readable sibling cells", async () => {
    const source = azurePublicPricingSource(1, 1);
    const items: PricingReconciliationItem[] = [];
    const models = parseSource({
      provider: provider(manifest("azure")),
      source,
      observedAt,
      catalogModels: [azurePricingModel("gpt-4o", "2024-08-06")],
      onPricingReconciliation: (item) => items.push(item),
      body: JSON.stringify({
        index: {
          url: "https://azure.microsoft.com/en-us/pricing/details/azure-openai/",
          body: (await fixture("azure/public-openai-pricing.html")).replace(
            '"us-east":2.5',
            '"us-east":"Pending"',
          ),
        },
        documents: [],
      }),
    }).models;
    expect(
      models[0]?.price_facts.every(({ price }) => /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(price)),
    ).toBe(true);
    expect(models[0]?.price_facts).toContainEqual(
      expect.objectContaining({ meter: "output_text", price: "10" }),
    );
    expect(items).toContainEqual(
      expect.objectContaining({ reason_code: "public_price_amount_unreadable" }),
    );
  });

  it.each([
    [
      "retyped",
      (body: string) =>
        body.replace(
          /<td>prompt_tokens<\/td>\s*<td>integer<\/td>/,
          "<td>prompt_tokens</td><td>string</td>",
        ),
    ],
    [
      "nested",
      (body: string) => body.replace("<td>prompt_tokens</td>", "<td>└─ prompt_tokens</td>"),
    ],
    [
      "contradictory",
      (body: string) =>
        body.replace("</tbody>", "<tr><td>prompt_tokens</td><td>string</td></tr></tbody>"),
    ],
    [
      "duplicated schema",
      (body: string) =>
        body.replace(
          "</main>",
          '<h3 id="openaicompletionusage">Duplicate</h3><table><tbody><tr><td>prompt_tokens</td><td>string</td></tr></tbody></table></main>',
        ),
    ],
  ])("withholds a %s usage counter without losing independent mappings", async (_label, change) => {
    const source = azureAccountingSource();
    const parsed = parseSource({
      provider: provider(manifest("azure")),
      source,
      observedAt,
      body: JSON.stringify({
        index: { url: source.url, body: change(await fixture("azure/accounting-chat.html")) },
        documents: [],
      }),
      catalogModels: [azurePricingModel("gpt-test")],
    });
    const inputs = parsed.pricing_inputs ?? [];
    expect(inputs.some(({ key }) => key === "chat.input_tokens")).toBe(false);
    expect(inputs.some(({ key }) => key === "chat.cached_input_tokens")).toBe(true);
  });

  it("reads published Learn pivots and expanded lifecycle and region companions", async () => {
    const value = manifest("azure");
    const configured = value.sources[0];
    if (configured === undefined) throw new Error("Missing Azure source");
    const source: SourceManifest = {
      ...configured,
      extractor: { kind: "azure-catalog", minModels: 1, maxModels: 20 },
    };
    expect(new URL(source.url).searchParams.get("accept")).toBe("text/markdown");
    expect(source.allowedHosts).toEqual(["learn.microsoft.com", "raw.githubusercontent.com"]);
    const body = await fixture("azure/learn-models.md");
    const documents = [
      {
        url: "https://learn.microsoft.com/en-us/azure/foundry/openai/concepts/model-retirement-schedule?accept=text/markdown",
        body: await fixture("azure/lifecycle.md"),
      },
      {
        url: "https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/models-sold-directly-by-azure-region-availability?accept=text/markdown",
        body: await fixture("azure/standard.md"),
      },
      {
        url: "https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/models-from-partners?accept=text/markdown",
        body: await fixture("azure/partners.md"),
      },
    ];
    const parse = (markdown: string) =>
      parseSource({
        provider: provider(value),
        source,
        observedAt,
        body: JSON.stringify({ index: { url: source.url, body: markdown }, documents }),
      }).models;
    const models = parse(body);
    expect(models.find(({ model_id }) => model_id === "gpt-6.1-sol")).toMatchObject({
      version: "2026-09-29",
      service_families: ["Azure OpenAI"],
      api_endpoints: expect.arrayContaining([expect.objectContaining({ name: "createResponse" })]),
      limits: { context_tokens: 1_050_000, max_output_tokens: 128_000 },
    });
    expect(models.find(({ model_id }) => model_id === "Cohere-parse-v5")).toMatchObject({
      service_families: ["Foundry Models sold by Azure"],
      tasks: ["ocr"],
    });
    expect(models.find(({ model_id }) => model_id === "gpt-old")).toMatchObject({
      status: "retired",
      replacement_model_ids: ["gpt-multi"],
    });
    expect(
      models.find(({ model_id, version }) => model_id === "gpt-multi" && version === "2026-01-01"),
    ).toMatchObject({
      availability: expect.arrayContaining([
        { region: "eastus", deployment_type: "Global Standard" },
      ]),
    });
    expect(() => parse(body.replace('pivot="azure-direct-others"', 'pivot="unexpected"'))).toThrow(
      "azure-direct-others pivot",
    );
    expect(() => parse(body + body)).toThrow("duplicated");
    expect(() => parse(body.replaceAll("::: zone-end", ""))).toThrow("pivot");
  });

  it("extracts fact-local accounting inputs from the reviewed Azure API contracts", async () => {
    const value = manifest("azure");
    const source = azureAccountingSource();
    const [chat, responses, batch, embeddings, media, cache, realtime] = await Promise.all([
      fixture("azure/accounting-chat.html"),
      fixture("azure/accounting-responses.html"),
      fixture("azure/accounting-batch.html"),
      fixture("azure/accounting-embeddings.html"),
      fixture("azure/accounting-media.html"),
      fixture("azure/accounting-cache.html"),
      fixture("azure/accounting-realtime.html"),
    ]);
    const bundle = (responseBody = responses): string =>
      JSON.stringify({
        index: { url: source.url, body: chat },
        documents: [
          {
            url: "https://learn.microsoft.com/en-us/rest/api/aifoundry/azureopenai/responses",
            body: responseBody,
          },
          {
            url: "https://learn.microsoft.com/en-us/rest/api/aifoundry/azureopenai/batch",
            body: batch,
          },
          {
            url: "https://learn.microsoft.com/en-us/rest/api/aifoundry/azureopenai/embeddings",
            body: embeddings,
          },
          {
            url: "https://learn.microsoft.com/en-us/azure/foundry/openai/reference-preview-latest",
            body: media,
          },
          {
            url: "https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/prompt-caching",
            body: cache,
          },
          {
            url: "https://learn.microsoft.com/en-us/azure/foundry-classic/openai/realtime-audio-reference-ga",
            body: realtime,
          },
        ],
      });
    const reconciliation: PricingReconciliationItem[] = [];
    const parsed = parseSource({
      provider: provider(value),
      source,
      body: bundle(),
      observedAt,
      onPricingReconciliation: (item) => reconciliation.push(item),
    });
    expect(parsed.models).toEqual([]);
    const inputs = parsed.pricing_inputs ?? [];
    expect(inputs).toHaveLength(38);
    expect(inputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "chat.input_tokens",
          channel: "stream_event",
          locator: { kind: "json_pointer", value: "/usage/prompt_tokens" },
        }),
        expect.objectContaining({
          key: "chat.cache_write_tokens",
          absent_value: "zero",
        }),
        expect.objectContaining({
          key: "batch.input_tokens",
          channel: "result",
          locator: { kind: "json_pointer", value: "/usage/input_tokens" },
        }),
        expect.objectContaining({
          key: "images.generated_images",
          reduction: { kind: "array_length" },
        }),
        expect.objectContaining({
          key: "audio.transcription_seconds",
          availability: "conditional",
        }),
        expect.objectContaining({
          key: "video.generated_seconds",
          channel: "result",
        }),
      ]),
    );
    expect(reconciliation).toEqual([
      {
        disposition: "normalized",
        reason_code: "pricing_input_contract_bound",
        sample: "38/38 Azure pricing inputs",
      },
    ]);

    const findings: SourceContractEvidence[] = [];
    const drifted = parseSource({
      provider: provider(value),
      source,
      body: bundle(responses.replace("<td>cached_tokens</td>", "<td>renamed_tokens</td>")),
      observedAt,
      catalogModels: [azurePricingModel("gpt-test")],
      onContractFinding: (finding) => findings.push(finding),
    });
    expect(drifted.pricing_inputs).toHaveLength(37);
    expect(drifted.pricing_inputs?.some(({ key }) => key === "responses.cached_input_tokens")).toBe(
      false,
    );
    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          diagnostics: [
            expect.objectContaining({
              path: "/documents/azureopenai/responses/openairesponseusageinputtokensdetails/properties/cached_tokens",
            }),
          ],
        }),
      ]),
    );
  });

  it("keeps exact model/version tuples and unions every observed operation", async () => {
    const models = await azureCatalog();
    const model = models.find((candidate) => candidate.uid === "azure/gpt-multi@2026-01-01");
    const whisper = models.find((candidate) => candidate.uid === "azure/whisper@001");
    const realtime = models.find((candidate) => candidate.uid === "azure/gpt-realtime@2025-08-28");
    const rerank = models.find((candidate) => candidate.uid === "azure/cohere-rerank-v4.0-fast@1");
    const embedding = models.find(
      (candidate) => candidate.uid === "azure/Cohere-embed-v3-english@1",
    );
    const claude = models.find((candidate) => candidate.uid === "azure/claude-opus-4-8");
    const retired = models.find((candidate) => candidate.uid === "azure/gpt-old@1");
    const archived = models.find((candidate) => candidate.uid === "azure/gpt-archive@0613");
    const assistant = models.find((candidate) => candidate.uid === "azure/gpt-assistant@1");
    const newer = models.find((candidate) => candidate.uid === "azure/gpt-multi@2026-02-01");
    const family = models.find((candidate) => candidate.uid === "azure/gpt-family");
    expect({
      tasks: model?.tasks,
      serviceFamilies: model?.service_families,
      endpoints: model?.api_endpoints,
      modalities: model?.modalities,
      context: model?.limits.context_tokens,
      output: model?.limits.max_output_tokens,
      lifecycle: [model?.status, model?.release_stage],
      availability: model?.availability?.length,
      whisper: whisper?.tasks,
      whisperEndpoints: whisper?.api_endpoints,
      realtimeEndpoints: realtime?.api_endpoints,
      rerank: rerank?.tasks,
      embedding: [
        embedding?.tasks,
        embedding?.modalities.output,
        embedding?.service_families,
        embedding?.status,
        embedding?.release_stage,
      ],
      claude: [claude?.tasks, claude?.modalities, claude?.availability],
      retired: [retired?.status, retired?.replacement_model_ids],
      archived: [archived?.status, archived?.retired_at, archived?.replacement_model_ids],
      assistant: [assistant?.status, assistant?.availability],
      newer: [newer?.limits, newer?.api_endpoints],
      versionless: [family?.version, family?.service_families, family?.api_endpoints],
    }).toEqual({
      tasks: ["text_generation"],
      serviceFamilies: ["Azure OpenAI"],
      endpoints: expect.arrayContaining([
        { name: "createBatch", path: "openai/v1/batches" },
        { name: "createChatCompletion", path: "openai/v1/chat/completions" },
        { name: "createResponse", path: "openai/v1/responses" },
      ]),
      modalities: { input: ["text", "image"], output: ["text"] },
      context: 128_000,
      output: 16_384,
      lifecycle: ["active", "stable"],
      availability: 5,
      whisper: ["transcription", "translation"],
      whisperEndpoints: expect.arrayContaining([
        { name: "createTranscription", path: "openai/v1/audio/transcriptions" },
        { name: "createTranslation", path: "openai/v1/audio/translations" },
      ]),
      realtimeEndpoints: [{ name: "createRealtimeSession", path: "openai/v1/realtime/sessions" }],
      rerank: ["reranking", "classification"],
      embedding: [
        ["embeddings"],
        ["embedding"],
        ["Foundry Models from partners and community"],
        "active",
        "preview",
      ],
      claude: [
        ["text_generation"],
        { input: ["text", "image"], output: ["text"] },
        [{ region: "US", deployment_type: "DataZoneStandard" }],
      ],
      retired: ["retired", ["gpt-multi"]],
      archived: ["retired", "April 30, 2025", ["gpt-multi"]],
      assistant: ["active", [{ region: "eastus", deployment_type: "Standard/Regional" }]],
      newer: [{}, undefined],
      versionless: [
        undefined,
        ["Azure OpenAI"],
        [{ name: "createChatCompletion", path: "openai/v1/chat/completions" }],
      ],
    });
    expect(model?.api_endpoints).toHaveLength(3);
    expect(whisper?.api_endpoints).toHaveLength(2);
    expect(models.find((candidate) => candidate.uid === "azure/gpt-family@1")?.api_endpoints).toBe(
      undefined,
    );
    expect(models.find((candidate) => candidate.uid === "azure/gpt-family@2")?.api_endpoints).toBe(
      undefined,
    );
    expect(
      models.some((candidate) => candidate.model_id === "Old Model Not In The Current Catalog"),
    ).toBe(false);
  });

  it("keeps usable catalog facts when an optional companion is unavailable", async () => {
    const models = await azureCatalog(
      undefined,
      new Set(["models-partners.md", "deployments-provisioned.md"]),
    );
    expect(models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ uid: "azure/gpt-multi@2026-01-01" }),
        expect.objectContaining({ uid: "azure/cohere-rerank-v4.0-fast@1" }),
      ]),
    );
    expect(models.some(({ uid }) => uid === "azure/claude-opus-4-8")).toBe(false);
  });

  it("supplements documented identities from the public Foundry portal without widening scope", async () => {
    const value = manifest("azure");
    const source = azurePortalSource(2, 2);
    const documented = {
      ...azurePricingModel("gpt-multi", "2026-01-01"),
      limits: { max_output_tokens: 128_000 },
      status: "deprecated",
      release_stage: "stable",
      deprecated_at: "2026-06-01",
    } satisfies ProviderModel;
    const catalogModels = [documented, azurePricingModel("gpt-multi", "2026-02-01")];
    const models = parseSource({
      provider: provider(value),
      source,
      body: await fixture("azure/portal-models.json"),
      observedAt,
      catalogModels,
    }).models;
    const exact = models.find(({ version }) => version === "2026-01-01");
    const newVersion = models.find(({ version }) => version === "2026-03-01");
    expect(models.map(({ uid }) => uid)).toEqual([
      "azure/gpt-multi@2026-01-01",
      "azure/gpt-multi@2026-03-01",
    ]);
    expect(exact).toMatchObject({
      name: "GPT Multi",
      description: "A portal-enriched multimodal model.",
      service_families: ["Azure OpenAI"],
      tasks: ["text_generation"],
      modalities: { input: ["text", "image"], output: ["text"] },
      capabilities: {
        reasoning: true,
        tool_call: true,
        streaming: true,
        batch: true,
      },
      limits: {
        context_tokens: 256_000,
        max_input_tokens: 240_000,
        max_output_tokens: 16_000,
      },
      status: "unknown",
      release_stage: "unknown",
      availability: [
        { region: "eastus", deployment_type: "DataZoneStandard" },
        { region: "eastus", deployment_type: "GlobalStandard" },
        { region: "westus3", deployment_type: "GlobalStandard" },
      ],
    });
    expect(newVersion).toMatchObject({
      name: "GPT Multi Preview",
      service_families: ["Azure OpenAI"],
      status: "active",
      release_stage: "preview",
      capabilities: { tool_call: false, batch: false },
    });
    expect(models.some(({ model_id }) => model_id === "portal-only")).toBe(false);
    const merged = applySupplementGroups(catalogModels, [{ source, models }]);
    expect(merged.map(({ uid }) => uid)).toEqual([
      "azure/gpt-multi@2026-01-01",
      "azure/gpt-multi@2026-02-01",
      "azure/gpt-multi@2026-03-01",
    ]);
    expect(merged.find(({ version }) => version === "2026-01-01")).toMatchObject({
      limits: {
        context_tokens: 256_000,
        max_input_tokens: 240_000,
        max_output_tokens: 128_000,
      },
      status: "deprecated",
      release_stage: "stable",
      deprecated_at: "2026-06-01",
    });
  });

  it("keeps a portal row when one inference task is new", async () => {
    const value = manifest("azure");
    const body = (await fixture("azure/portal-models.json")).replace(
      '"chat-completion", "responses"',
      '"future-inference-task", "responses"',
    );
    let finding: SourceContractEvidence | undefined;
    const models = parseSource({
      provider: provider(value),
      source: azurePortalSource(2, 2),
      body,
      observedAt,
      catalogModels: [azurePricingModel("gpt-multi", "2026-01-01")],
      onContractFinding: (value) => {
        finding = value;
      },
    }).models;
    expect(models).toHaveLength(2);
    expect(models[0]?.tasks).toEqual(["text_generation"]);
    expect(finding).toMatchObject({ disposition: "accept_with_signal" });
  });

  it("maps the reviewed zero-shot classification task", async () => {
    const value = manifest("azure");
    const models = parseSource({
      provider: provider(value),
      source: azurePortalSource(1, 1),
      body: await fixture("azure/portal-zero-shot.json"),
      observedAt,
      catalogModels: [azurePricingModel("Microsoft-Decision-1", "1")],
    }).models;
    expect(models[0]?.tasks).toEqual(["classification"]);
    expect(models[0]?.modalities).toEqual({ input: ["text"], output: [] });
    expect(models[0]?.capabilities.structured_output).toBe(true);
  });

  it("bounds the anonymous portal request as a non-exhaustive supplement", () => {
    const source = azurePortalSource(50, 150);
    expect(source).toMatchObject({
      type: "api",
      source: ["api", "website"],
      access: "public",
      stability: "undocumented",
      scope: "global",
      exhaustive: false,
      role: "supplement",
      fillOnly: true,
      headers: [
        { name: "X-Ms-User-Agent", value: "AzureMachineLearningWorkspacePortal/3.0" },
        { name: "x-ms-useragent", value: "AzureMachineLearningWorkspacePortal/3.0" },
      ],
      transport: {
        kind: "azure-portal-models",
        pageSize: 50,
        maxPages: 5,
        maxModels: 250,
        registries: expect.arrayContaining(["azure-openai", "azureml", "azureml-cohere"]),
      },
    });
    expect(source).toMatchObject({ optional: true, retainOmittedFacts: true });
  });

  it("parses the scoped ARM inventory and exact billing-meter price join", async () => {
    const reconciliation: PricingReconciliationItem[] = [];
    const model = azureApiModels(await fixture("azure/api.json"), reconciliation)[0];
    expect({
      uid: model?.uid,
      description: model?.description,
      tasks: model?.tasks,
      capabilities: model?.capabilities,
      context: model?.limits.context_tokens,
      status: model?.status,
      retiredAt: model?.retired_at,
      availability: model?.availability,
      price: model?.price_facts[0],
      imagePrice: model?.price_facts.find((rate) => rate.meter === "input_image")?.price,
      scope: model?.scope,
    }).toEqual({
      uid: "azure/gpt-multi@2026-01-01",
      description: "A structured regional model.",
      tasks: ["text_generation"],
      capabilities: {
        reasoning: "unknown",
        tool_call: "unknown",
        structured_output: true,
        streaming: true,
        batch: "unknown",
        prompt_cache: "unknown",
        fine_tuning: false,
        citations: "unknown",
        code_execution: "unknown",
        context_management: "unknown",
        effort_control: "unknown",
        computer_use: "unknown",
      },
      context: 128_000,
      status: "active",
      retiredAt: "2027-01-01",
      availability: [{ region: "eastus", deployment_type: "GlobalStandard" }],
      price: {
        meter: "input_text",
        price: "1.25",
        currency: "USD",
        unit: "million_tokens",
        conditions: {
          region: "eastus",
          deployment_scope: "GlobalStandard",
        },
        source_ref: "azure-api",
        source_locator: {
          kind: "meter",
          value: "11111111-1111-1111-1111-111111111111",
        },
        derived: false,
        raw_price: "1.25",
        raw_unit: "1M Tokens",
        raw_validity: "2026-01-01T00:00:00Z",
      },
      imagePrice: undefined,
      scope: "runtime_observation",
    });
    expect(reconciliation).toEqual([
      { disposition: "normalized", reason_code: "arm_direct_meter_bound" },
      {
        disposition: "unbound",
        reason_code: "arm_meter_missing",
        sample: "gpt-multi@2026-01-01 / GlobalStandard / Image Input Tokens",
      },
    ]);
    const value = manifest("azure");
    const source = value.sources.find(({ id }) => id === "azure-api");
    if (source === undefined) throw new Error("Missing Azure API source");
    let finding: SourceContractEvidence | undefined;
    expect(
      parseSource({
        provider: provider(value),
        source,
        body: await fixture("azure/broken-api.json"),
        observedAt,
        onContractFinding: (value) => {
          finding = value;
        },
      }).models,
    ).toEqual([]);
    expect(finding).toMatchObject({ disposition: "accept_with_signal" });
  });

  it("merges exact ARM model identities across discovered locations", async () => {
    const bundle = await azureApiFixture();
    const eastus = bundle.regions[0];
    if (eastus === undefined) throw new Error("Missing fixture region");
    const westus = z
      .object({
        kind: z.string().optional(),
        model: z
          .object({
            lifecycleStatus: z.string().optional(),
            capabilities: z.record(z.string(), z.string()),
          })
          .passthrough(),
      })
      .passthrough()
      .parse(structuredClone(eastus.models[0]));
    westus.kind = "Embedding";
    westus.model.lifecycleStatus = "Preview";
    westus.model.capabilities.streaming = "false";
    bundle.regions.push({ location: "westus3", models: [westus] });
    const models = azureApiModels(JSON.stringify(bundle));
    expect(models).toHaveLength(1);
    expect(models[0]?.availability).toEqual([
      { region: "eastus", deployment_type: "GlobalStandard" },
      { region: "westus3", deployment_type: "GlobalStandard" },
    ]);
    expect(models[0]?.price_facts).toHaveLength(1);
    expect(models[0]).toMatchObject({
      tasks: ["text_generation", "embeddings"],
      status: "active",
      release_stage: "unknown",
      capabilities: { streaming: "unknown" },
    });
  });

  it("treats null ARM capabilities as unknown without dropping the model", async () => {
    const body = (await fixture("azure/api.json")).replace(
      '"streaming": "true"',
      '"streaming": null',
    );
    const model = azureApiModels(body)[0];
    expect(model).toMatchObject({
      uid: "azure/gpt-multi@2026-01-01",
      capabilities: { streaming: "unknown", structured_output: true },
    });
  });

  it("normalizes the live ARM embedding TotalToken meter shape", () => {
    const model = azureApiModels(
      JSON.stringify({
        regions: [
          {
            location: "eastus",
            models: [
              {
                kind: "OpenAI",
                model: {
                  name: "text-embedding-3-small",
                  version: "1",
                  skus: [
                    {
                      name: "Standard",
                      costs: [
                        {
                          name: "TotalToken",
                          meterId: "embedding-meter",
                          unit: "1K Tokens",
                        },
                      ],
                    },
                  ],
                },
              },
            ],
          },
        ],
        prices: [
          {
            currencyCode: "USD",
            retailPrice: 0.02,
            armRegionName: "eastus",
            meterId: "embedding-meter",
            meterName: "Tokens",
            productName: "Foundry Models text-embedding-3-small",
            skuName: "Standard",
            serviceName: "Foundry Models",
            unitOfMeasure: "1K Tokens",
          },
        ],
      }),
    )[0];
    expect(model).toMatchObject({
      uid: "azure/text-embedding-3-small@1",
      tasks: ["embeddings"],
      price_facts: [
        expect.objectContaining({ meter: "embedding", unit: "thousand_tokens", price: "0.02" }),
      ],
    });
  });

  it.each([false, true])(
    "does not invent a context class for an unqualified native SKU (long peer=%s)",
    (withLong) => {
      const value = manifest("azure");
      const source = azureRetailSource(1, 1, 1);
      const price = {
        currencyCode: "USD",
        retailPrice: 2.5,
        armRegionName: "eastus2",
        meterId: "ordinary-input",
        meterName: "5.6 terra Inp Std Gl 1M Tokens",
        productName: "Azure OpenAI GPT5",
        skuName: "5.6 terra Inp Std Gl",
        serviceName: "Foundry Models",
        unitOfMeasure: "1M",
        type: "Consumption",
      };
      const models = parseSource({
        provider: provider(value),
        source,
        observedAt,
        body: JSON.stringify({
          prices: [
            price,
            ...(withLong
              ? [
                  {
                    ...price,
                    meterId: "long-input",
                    skuName: "5.6 terra LongCo Inp Std Gl",
                    meterName: "5.6 terra LongCo Inp Std Gl 1M Tokens",
                  },
                ]
              : []),
          ],
        }),
        catalogModels: [azurePricingModel("gpt-5.6-terra", "2026-07-09")],
      }).models;
      expect(models[0]?.price_facts).toHaveLength(withLong ? 2 : 1);
      expect(
        models[0]?.price_facts.map(({ price, conditions }) => ({
          price,
          context: conditions.context_tier,
        })),
      ).toEqual([
        { price: "2.5", context: undefined },
        ...(withLong ? [{ price: "2.5", context: "long_context" }] : []),
      ]);
      const partition = assembleParsedProviderPricing(
        "azure",
        observedAt,
        [{ source, models }],
        models,
      );
      expect(partition?.books.length).toBeGreaterThan(0);
      expect(partition?.vocabulary.atoms).not.toContainEqual(
        expect.objectContaining({
          key: "standard",
          dimension: { namespace: "kmodels", value: "context_tier" },
        }),
      );
    },
  );

  it("extracts current public retail rates without Azure credentials", async () => {
    const value = manifest("azure");
    const source = azureRetailSource(3, 5, 0.8);
    const models = parseSource({
      provider: provider(value),
      source,
      body: await fixture("azure/retail-prices.json"),
      observedAt,
      catalogModels: [
        azurePricingModel("gpt-4.1", "2025-04-14"),
        azurePricingModel("gpt-5.6-terra", "2026-07-09"),
        azurePricingModel("gpt-audio-1.5", "2026-02-23"),
        azurePricingModel("gpt-4o-mini-realtime-preview", "2024-12-17"),
        azurePricingModel("gpt-4o-mini-audio-preview", "2024-12-17"),
      ],
    }).models;
    const gpt = models.find(({ model_id }) => model_id === "gpt-4.1");
    const terra = models.find(({ model_id }) => model_id === "gpt-5.6-terra");
    const audio = models.find(({ model_id }) => model_id === "gpt-audio-1.5");
    const realtime = models.find(({ model_id }) => model_id === "gpt-4o-mini-realtime-preview");
    const audioPreview = models.find(({ model_id }) => model_id === "gpt-4o-mini-audio-preview");
    expect(models).toHaveLength(5);
    expect(gpt?.price_facts).toEqual([
      expect.objectContaining({
        meter: "input_text",
        price: "0.0022",
        unit: "thousand_tokens",
        conditions: { region: "eastus", deployment_scope: "Standard", service_tier: "standard" },
        raw_validity: "2025-11-01T00:00:00Z",
      }),
      expect.objectContaining({ meter: "output_text", price: "0.0088" }),
      expect.objectContaining({ meter: "cache_read_text", price: "0.00055" }),
    ]);
    expect(terra?.price_facts).toEqual([
      expect.objectContaining({
        meter: "input_text",
        conditions: {
          region: "eastus2",
          deployment_scope: "GlobalStandard",
          service_tier: "standard",
          context_tier: "short_context",
        },
        raw_validity: "2026-07-01T00:00:00Z – 2026-08-31T23:59:00Z",
      }),
      expect.objectContaining({
        meter: "cache_read_text",
        conditions: {
          region: "eastus2",
          deployment_scope: "GlobalStandard",
          service_tier: "priority",
          context_tier: "short_context",
        },
      }),
      expect.objectContaining({ meter: "cache_write_text" }),
    ]);
    expect(audio?.price_facts.map(({ meter }) => meter)).toEqual(["input_text", "input_audio"]);
    expect(realtime).toMatchObject({
      uid: "azure/gpt-4o-mini-realtime-preview@2024-12-17",
      price_facts: [
        expect.objectContaining({ meter: "input_text", price: "0.0006" }),
        expect.objectContaining({ meter: "input_audio", price: "0.01" }),
      ],
    });
    expect(audioPreview).toMatchObject({
      uid: "azure/gpt-4o-mini-audio-preview@2024-12-17",
      price_facts: [
        expect.objectContaining({ meter: "input_text", price: "0.00015" }),
        expect.objectContaining({ meter: "input_audio", price: "0.01" }),
      ],
    });
    expect(models.some(({ model_id }) => model_id === "gpt-5")).toBe(false);
  });

  it("binds compact GPT identities and keeps Standard, Flex and Priority tariffs disjoint", () => {
    const source = azureRetailSource(1, 1, 1);
    const catalog = azurePricingModel("gpt-6.1-terra", "2026-10-26");
    const prices = [
      { skuName: "61 terra ShortCo Inp std Gl", retailPrice: 2 },
      { skuName: "61 terra ShCo Inp Fl Gl", retailPrice: 1 },
      { skuName: "61 terra ShortCo Inp PP Gl", retailPrice: 3 },
    ].map((row, index) => ({
      ...row,
      currencyCode: "USD",
      armRegionName: "eastus2",
      meterId: `tier-${index}`,
      meterName: `${row.skuName} 1M Tokens`,
      productName: "Azure OpenAI GPT6",
      serviceName: "Foundry Models",
      unitOfMeasure: "1M",
      type: "Consumption",
    }));
    const result = parseSource({
      provider: provider(manifest("azure")),
      source,
      observedAt,
      body: JSON.stringify({ prices }),
      catalogModels: [catalog],
    });
    expect(result.models[0]?.price_facts.map(({ conditions }) => conditions.service_tier)).toEqual([
      "standard",
      "flex",
      "priority",
    ]);
    const partition = assembleParsedProviderPricing(
      "azure",
      observedAt,
      [{ source, models: result.models }],
      [catalog],
    );
    validateParsedPricing(manifest("azure"), source, [catalog], partition);
    const terms =
      partition?.books.flatMap(({ offers }) => offers.flatMap(({ terms }) => terms)) ?? [];
    expect(terms).toHaveLength(1);
    const term = terms[0];
    if (term?.kind !== "rate") throw new Error("Missing input rate");
    expect(term.raw_variants).toEqual([]);
    expect(term.variants).toHaveLength(3);
    expect(partition?.vocabulary.atoms).toContainEqual(
      expect.objectContaining({
        key: "flex",
        label: "Flex",
        dimension: { namespace: "kmodels", value: "served_service_tier" },
      }),
    );
    for (const variant of term.variants) {
      expect(variant.applicability.any_of[0]?.all_of).toContainEqual(
        expect.objectContaining({
          kind: "categorical",
          dimension: { namespace: "kmodels", value: "served_service_tier" },
        }),
      );
      expect(
        evaluateRateCost(variant, [
          {
            signal: { namespace: "kmodels", value: "uncached_input_tokens" },
            value: { numerator: "1000", denominator: "1" },
          },
        ]).kind,
      ).toBe("resolved");
    }
    const unknown = parseSource({
      provider: provider(manifest("azure")),
      source: azureRetailSource(0, 1, 0),
      observedAt,
      body: JSON.stringify({
        prices: prices.map((price) => ({ ...price, productName: "Azure BFL Flux Models" })),
      }),
      catalogModels: [catalog],
    });
    expect(unknown.models).toEqual([]);
  });

  it("uses public Microsoft price pages at their published version scope", async () => {
    const value = manifest("azure");
    const source = azurePublicPricingSource(2, 2);
    const llama = (version?: string): ProviderModel => ({
      ...azurePricingModel("Llama-3.3-70B-Instruct", version),
      service_families: ["Foundry Models sold by Azure"],
    });
    const catalogModels = [
      azurePricingModel("gpt-4o", "2024-05-13"),
      azurePricingModel("gpt-4o", "2024-08-06"),
      llama(),
      llama("1"),
      llama("2"),
    ];
    const reconciliation: PricingReconciliationItem[] = [];
    const models = parseSource({
      provider: provider(value),
      source,
      body: JSON.stringify({
        index: {
          url: "https://azure.microsoft.com/en-us/pricing/details/azure-openai/",
          body: await fixture("azure/public-openai-pricing.html"),
        },
        documents: [
          {
            url: "https://azure.microsoft.com/en-us/pricing/details/ai-foundry-models/llama/",
            body: await fixture("azure/public-llama-pricing.html"),
          },
        ],
      }),
      observedAt,
      catalogModels,
      onPricingReconciliation: (item) => reconciliation.push(item),
    }).models;
    const gpt = models.find(({ model_id }) => model_id === "gpt-4o");
    const llamaPrice = models.find(({ model_id }) => model_id === "Llama-3.3-70B-Instruct");
    expect(models.map(({ uid }) => uid)).toEqual([
      "azure/gpt-4o@2024-08-06",
      "azure/Llama-3.3-70B-Instruct",
    ]);
    expect(gpt?.price_facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          meter: "input_text",
          price: "2.5",
          unit: "million_tokens",
          conditions: {
            region: "eastus",
            deployment_scope: "GlobalStandard",
          },
        }),
        expect.objectContaining({ meter: "cache_read_text", price: "1.25" }),
        expect.objectContaining({ meter: "output_text", price: "10" }),
      ]),
    );
    expect(gpt?.price_facts).toHaveLength(6);
    expect(llamaPrice?.price_facts).toHaveLength(4);
    expect(reconciliation).toEqual(
      Array.from({ length: 5 }, () => ({
        disposition: "normalized",
        reason_code: "public_price_bound",
      })),
    );
  });

  it("accepts a newly linked Foundry pricing family without widening identity matching", async () => {
    const value = manifest("azure");
    const source = azurePublicPricingSource(1, 1);
    const llama: ProviderModel = {
      ...azurePricingModel("Llama-3.3-70B-Instruct"),
      service_families: ["Foundry Models sold by Azure"],
    };
    const models = parseSource({
      provider: provider(value),
      source,
      body: JSON.stringify({
        index: {
          url: "https://azure.microsoft.com/en-us/pricing/details/azure-openai/",
          body: await fixture("azure/public-openai-pricing.html"),
        },
        documents: [
          {
            url: "https://azure.microsoft.com/en-us/pricing/details/ai-foundry-models/new-publisher/",
            body: await fixture("azure/public-llama-pricing.html"),
          },
        ],
      }),
      observedAt,
      catalogModels: [llama, azurePricingModel("Llama-3.3-70B-Instruct")],
    }).models;
    expect(models).toEqual([
      expect.objectContaining({
        uid: "azure/Llama-3.3-70B-Instruct",
        price_facts: expect.arrayContaining([
          expect.objectContaining({ meter: "input_text", unit: "million_tokens" }),
          expect.objectContaining({ meter: "output_text", unit: "million_tokens" }),
        ]),
      }),
    ]);
  });

  it.each([false, true])(
    "keeps built-in tool rates without a model carrier (service only: %s)",
    async (serviceOnly) => {
      const value = manifest("azure");
      const source = azurePublicPricingSource(serviceOnly ? 0 : 2, 2);
      const llama: ProviderModel = {
        ...azurePricingModel("Llama-3.3-70B-Instruct"),
        service_families: ["Foundry Models sold by Azure"],
      };
      const published = [azurePricingModel("gpt-4o", "2024-08-06"), llama];
      const page = await fixture("azure/commercial-openai-pricing.html");
      const parsed = parseSource({
        provider: provider(value),
        source,
        body: JSON.stringify({
          index: {
            url: "https://azure.microsoft.com/en-us/pricing/details/azure-openai/",
            body: serviceOnly
              ? page.replace(/<table aria-label="GPT-4o">[\s\S]*?<\/table>/, "")
              : page,
          },
          documents: serviceOnly
            ? []
            : [
                {
                  url: "https://azure.microsoft.com/en-us/pricing/details/ai-foundry-models/llama/",
                  body: await fixture("azure/public-llama-pricing.html"),
                },
              ],
        }),
        observedAt,
        catalogModels: published,
      });
      const { models } = parsed;
      expect(models).toHaveLength(serviceOnly ? 0 : 2);
      const commercial = parsed.commercial_facts ?? [];
      expect(commercial.map(({ resource_key }) => resource_key).sort()).toEqual([
        "computer-use",
        "responses-code-interpreter",
        "responses-file-search",
      ]);
      expect(commercial).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            resource_key: "responses-file-search",
            price_facts: [
              expect.objectContaining({ meter: "file_search", unit: "thousand_requests" }),
            ],
          }),
          expect.objectContaining({
            resource_key: "responses-code-interpreter",
            price_facts: [expect.objectContaining({ meter: "code_execution", unit: "session" })],
          }),
          expect.objectContaining({
            resource_key: "computer-use",
            price_facts: expect.arrayContaining([
              expect.objectContaining({ meter: "input_text", price: "3" }),
              expect.objectContaining({ meter: "output_text", price: "12" }),
            ]),
          }),
        ]),
      );
      const pricing = assembleParsedProviderPricing(
        "azure",
        observedAt,
        [{ source, ...parsed }],
        published,
      );
      const fileSearch = pricing?.books.find(
        ({ scope }) =>
          scope.kind === "provider_resource" && scope.resource_key === "responses-file-search",
      );
      expect(fileSearch?.offers[0]).toMatchObject({
        enrollment: [],
        settlement: [],
        relations: [],
        terms: [
          expect.objectContaining({
            variants: [
              expect.objectContaining({
                charge_binding: expect.objectContaining({ aggregation: "result_item" }),
              }),
            ],
          }),
        ],
      });
      const computerUse = pricing?.books.find(
        ({ scope }) => scope.kind === "provider_resource" && scope.resource_key === "computer-use",
      );
      expect(
        computerUse?.offers[0]?.terms
          .filter((term) => term.kind === "rate")
          .map(({ meter }) => meter.value)
          .sort(),
      ).toEqual(["input_text", "output_text"]);
      expect(
        computerUse?.offers[0]?.terms.flatMap((term) =>
          term.kind === "raw" ? term.variants : term.raw_variants,
        ),
      ).toEqual([]);
      expect(
        pricing?.books.some(
          ({ scope }) =>
            scope.kind === "provider_resource" &&
            ["responses-file-search-storage", "managed-compute"].includes(scope.resource_key),
        ),
      ).toBe(false);
      expect(models.every((model) => !Object.hasOwn(model, "commercial_facts"))).toBe(true);
      const captured = capturePricingReplaySources(
        [{ source, ...parsed }],
        [
          {
            id: source.id,
            provider_id: "azure",
            url: source.url,
            source: [source.type],
            stability: source.stability,
            scope: source.scope ?? "global",
            exhaustive: false,
            role: source.role ?? "catalog",
            field_paths: source.fields,
            pricing_evidence: source.pricingEvidence,
            observed_at: observedAt,
            content_hash: "1".repeat(64),
            extractor_version: source.extractorVersion,
          },
        ],
      )?.[0];
      expect(captured?.commercial_facts).toEqual(commercial);
      if (captured === undefined) throw new Error("Missing Azure source compilation input");
      expect(
        assembleParsedProviderPricing("azure", observedAt, [{ source, ...captured }], published),
      ).toEqual(pricing);
    },
  );

  it("normalizes official partner meters with provider-native billing units", () => {
    const value = manifest("azure");
    const partner = (id: string, tasks: ModelTask[], version?: string): ProviderModel => ({
      ...azurePricingModel(id, version),
      service_families: ["Foundry Models from partners and community"],
      tasks,
    });
    const row = (
      productName: string,
      skuName: string,
      meterName: string,
      unitOfMeasure: string,
      index: number,
    ) => ({
      currencyCode: "USD",
      retailPrice: index,
      armRegionName: "",
      effectiveStartDate: "2026-01-01T00:00:00Z",
      meterId: `20000000-0000-0000-0000-${String(index).padStart(12, "0")}`,
      meterName,
      productName,
      skuName,
      serviceName: "Foundry Models",
      unitOfMeasure,
      type: "Consumption",
    });
    const models = parseSource({
      provider: provider(value),
      source: azureRetailSource(5, 5, 1),
      body: JSON.stringify({
        prices: [
          row("Cohere Models", "Rerank v4 Pro Glbl", "Rerank v4 Pro Glbl Search", "1", 1),
          row("Cohere Models", "Embed v4 Txt Glbl", "Embed v4 Txt Glbl Tokens", "1M", 2),
          row("Azure Mistral Models", "OCR 4 glbl", "OCR 4 glbl Pages", "1", 3),
          row("Azure Deepseek Models", "V3.2 SP Inp DZ", "V3.2 SP Inp DZ Tokens", "1M", 4),
          row("Azure BFL Flux Models", "Flux 2 Pro Dzone", "Flux 2 Pro Dzone Megapixel", "1", 5),
        ],
      }),
      observedAt,
      catalogModels: [
        partner("Cohere-rerank-v4.0-pro", ["reranking"], "1"),
        partner("embed-v-4-0", ["embeddings"], "1"),
        partner("mistral-ocr-4-0", ["ocr"]),
        partner("DeepSeek-V3.2-Speciale", ["text_generation"], "1"),
        partner("FLUX.2-pro", ["image_generation"], "1"),
      ],
    }).models;
    expect(
      models.map(({ uid, price_facts }) => [
        uid,
        price_facts.map(({ meter, unit }) => [meter, unit]),
      ]),
    ).toEqual([
      ["azure/Cohere-rerank-v4.0-pro@1", [["rerank_request", "search_unit"]]],
      ["azure/DeepSeek-V3.2-Speciale@1", [["input_text", "million_tokens"]]],
      ["azure/embed-v-4-0@1", [["embedding", "million_tokens"]]],
      ["azure/FLUX.2-pro@1", [["image_generation", "million_pixels"]]],
      ["azure/mistral-ocr-4-0", [["input_image", "page"]]],
    ]);
  });

  it("imports Claude's delegated token rates without Marketplace settlement facts", async () => {
    const value = manifest("azure");
    const configured = value.sources.find(({ id }) => id === "azure-claude-pricing");
    if (configured === undefined || configured.extractor.kind !== "azure-claude-pricing")
      throw new Error("Missing Azure Claude pricing source");
    const source: SourceManifest = {
      ...configured,
      extractor: { kind: "azure-claude-pricing", minModels: 4, maxModels: 4 },
    };
    const claude = (id: string, dataZone = false): ProviderModel => ({
      ...azurePricingModel(id),
      service_families: ["Foundry Models from partners and community"],
      status: "active",
      ...(dataZone
        ? { availability: [{ region: "eastus2", deployment_type: "DataZoneStandard" }] }
        : {}),
    });
    const reconciliation: PricingReconciliationItem[] = [];
    const models = parseSource({
      provider: provider(value),
      source,
      body: await fixture("azure/claude-pricing.md"),
      observedAt,
      catalogModels: [
        claude("claude-opus-4-8", true),
        claude("claude-sonnet-5", true),
        claude("claude-sonnet-5-5", true),
        claude("claude-sonnet-5.5", true),
        claude("claude-opus-5-5", true),
      ],
      onPricingReconciliation: (item) => reconciliation.push(item),
    }).models;
    const opus = models.find(({ model_id }) => model_id === "claude-opus-4-8");
    const sonnet = models.find(({ model_id }) => model_id === "claude-sonnet-5");
    const sonnet55 = models.find(({ model_id }) => model_id === "claude-sonnet-5-5");
    const opus55 = models.find(({ model_id }) => model_id === "claude-opus-5-5");
    expect(models.map(({ model_id }) => model_id)).toEqual([
      "claude-opus-4-8",
      "claude-opus-5-5",
      "claude-sonnet-5",
      "claude-sonnet-5-5",
    ]);
    expect(opus?.price_facts).toHaveLength(10);
    expect(
      opus?.price_facts.find(
        ({ meter, conditions }) =>
          meter === "input_text" && conditions.deployment_scope === "DataZoneStandard",
      ),
    ).toMatchObject({
      price: "5.5",
      derived: true,
      conditions: { inference_geo: "us" },
    });
    expect(sonnet?.price_facts).toHaveLength(10);
    expect(sonnet55?.price_facts).toHaveLength(10);
    expect(
      sonnet55?.price_facts
        .filter(({ conditions }) => conditions.deployment_scope === "GlobalStandard")
        .map(({ meter, price }) => [meter, price]),
    ).toEqual([
      ["input_text", "2"],
      ["cache_write_text", "2.50"],
      ["cache_write_text", "4"],
      ["cache_read_text", "0.20"],
      ["output_text", "10"],
    ]);
    expect(sonnet55?.price_facts).toContainEqual(
      expect.objectContaining({
        meter: "input_text",
        price: "2.2",
        derived: true,
        conditions: expect.objectContaining({
          deployment_scope: "DataZoneStandard",
          inference_geo: "us",
        }),
      }),
    );
    expect(opus55?.price_facts).toHaveLength(10);
    expect(
      opus55?.price_facts.find(
        ({ meter, conditions }) =>
          meter === "cache_read_text" && conditions.deployment_scope === "GlobalStandard",
      )?.price,
    ).toBe("0.20");
    expect(
      sonnet?.price_facts
        .filter(({ meter }) => meter === "input_text")
        .map(({ price, conditions }) => [price, conditions.deployment_scope]),
    ).toEqual([
      ["2", "GlobalStandard"],
      ["2.2", "DataZoneStandard"],
    ]);
    expect(opus?.raw_price_facts).toEqual([]);
    expect(reconciliation).toEqual([
      expect.objectContaining({
        disposition: "normalized",
        reason_code: "claude_public_rate_row",
        sample: "claude-opus-4-8",
      }),
      expect.objectContaining({ sample: "claude-sonnet-5" }),
      expect.objectContaining({ sample: "claude-sonnet-5-5" }),
      expect.objectContaining({ sample: "claude-opus-5-5" }),
      {
        disposition: "excluded",
        reason_code: "claude_price_model_not_offered",
        sample: "claude-opus-4",
      },
    ]);
  });

  it("shares delegated Claude base-model prices across offered versions and retains readable cells", async () => {
    const value = manifest("azure");
    const source = value.sources.find(({ id }) => id === "azure-claude-pricing");
    if (source === undefined) throw new Error("Missing Azure Claude source");
    const catalogModels = ["1", "2"].map((version): ProviderModel => ({
      ...azurePricingModel("claude-sonnet-5", version),
      service_families: ["Foundry Models from partners and community"],
      status: "active",
    }));
    const body = (await fixture("azure/claude-pricing.md")).replaceAll("$2.50 / MTok", "Pending");
    const models = parseSource({
      provider: provider(value),
      source,
      observedAt,
      body,
      catalogModels,
    }).models;
    expect(models).toHaveLength(1);
    expect(models[0]?.version).toBeUndefined();
    expect(models[0]?.price_facts).toHaveLength(4);
    expect(models[0]?.price_facts).toContainEqual(
      expect.objectContaining({ meter: "output_text", price: "10" }),
    );
    const partition = assembleParsedProviderPricing(
      "azure",
      observedAt,
      [{ source, models }],
      catalogModels,
      value.pricingCategoricalLabels,
    );
    expect(partition?.books).toHaveLength(1);
    expect(partition?.books[0]?.scope).toEqual({
      kind: "models",
      model_refs: catalogModels.map(({ uid }) => uid),
    });
    validateParsedPricing(value, source, catalogModels, partition);
  });

  it("matches retail SKUs against the public model/version catalog", async () => {
    const value = manifest("azure");
    const catalogModels: ProviderModel[] = [
      azurePricingModel("codex-mini", "2025-05-16"),
      azurePricingModel("gpt-realtime-mini", "2025-12-15"),
      azurePricingModel("gpt-audio-mini", "2025-12-15"),
      azurePricingModel("gpt-35-turbo-16k", "0613"),
      azurePricingModel("gpt-35-turbo", "0125"),
      azurePricingModel("gpt-35-turbo", "1106"),
      azurePricingModel("o3-deep-research", "2025-06-26"),
      azurePricingModel("computer-use-preview", "2025-03-11"),
      { ...azurePricingModel("sora-2", "2025-10-06"), tasks: ["video_generation"] },
      azurePricingModel("gpt-chat-latest", "2026-05-05"),
      azurePricingModel("gpt-chat-latest", "2026-05-28"),
      azurePricingModel("gpt-image-1-mini", "2025-10-06"),
    ];
    const models = parseSource({
      provider: provider(value),
      source: azureRetailSource(9, 9, 1),
      body: await fixture("azure/retail-catalog-matching.json"),
      observedAt,
      catalogModels,
    }).models;
    expect(
      models.map(({ uid, price_facts }) => ({
        uid,
        meters: price_facts.map(({ meter }) => meter),
      })),
    ).toEqual([
      { uid: "azure/codex-mini@2025-05-16", meters: ["input_text"] },
      { uid: "azure/computer-use-preview@2025-03-11", meters: ["input_text"] },
      { uid: "azure/gpt-35-turbo-16k@0613", meters: ["input_text"] },
      { uid: "azure/gpt-35-turbo@0125", meters: ["input_text"] },
      { uid: "azure/gpt-chat-latest@2026-05-05", meters: ["input_text"] },
      { uid: "azure/gpt-image-1-mini@2025-10-06", meters: ["input_image"] },
      { uid: "azure/gpt-realtime-mini@2025-12-15", meters: ["input_audio"] },
      { uid: "azure/o3-deep-research@2025-06-26", meters: ["input_text"] },
      { uid: "azure/sora-2@2025-10-06", meters: ["video_generation"] },
    ]);
  });

  it("does not guess which version owns a versionless retail SKU", async () => {
    const value = manifest("azure");
    const bundle = z
      .object({ prices: z.array(z.object({ skuName: z.string() }).passthrough()) })
      .parse(JSON.parse(await fixture("azure/retail-catalog-matching.json")));
    const body = JSON.stringify({
      prices: bundle.prices.filter(({ skuName }) => skuName === "Sora 2 glbl"),
    });
    const reconciliation: { disposition: string; reason_code: string }[] = [];
    expect(
      parseSource({
        provider: provider(value),
        source: azureRetailSource(0, 0, 0),
        body,
        observedAt,
        catalogModels: [
          { ...azurePricingModel("sora-2", "2025-10-06"), tasks: ["video_generation"] },
          { ...azurePricingModel("sora-2", "2025-12-08"), tasks: ["video_generation"] },
        ],
        onPricingReconciliation: (item) => reconciliation.push(item),
      }).models,
    ).toEqual([]);
    expect(reconciliation).toEqual([
      {
        disposition: "ambiguous",
        reason_code: "retail_version_not_unique",
        sample: "Azure OpenAI Media / Sora 2 glbl / Sora 2 glbl Second",
      },
    ]);
  });

  it("recognizes scoped Mistral and Llama SKU spellings without resolving competing base identities", () => {
    const source = azureRetailSource(0, 2, 0);
    const llama = {
      ...azurePricingModel("Llama-3.3-70B-Instruct"),
      service_families: ["Foundry Models sold by Azure"],
    };
    const medium = {
      ...azurePricingModel("mistral-medium-3-5", "1"),
      service_families: ["Foundry Models sold by Azure"],
    };
    const prices = [
      { productName: "Azure Llama Models", skuName: "Llama 3.3 70B Inp glbl" },
      { productName: "Azure Mistral Models", skuName: "MM3.5 Inp glbl" },
    ].map((row, index) => ({
      ...row,
      meterName: `${row.skuName} Tokens`,
      currencyCode: "USD",
      retailPrice: 1,
      armRegionName: "eastus2",
      meterId: `native-${index}`,
      serviceName: "Foundry Models",
      unitOfMeasure: "1M",
      type: "Consumption",
    }));
    const parse = (catalogModels: ProviderModel[]) =>
      parseSource({
        provider: provider(manifest("azure")),
        source,
        observedAt,
        body: JSON.stringify({ prices }),
        catalogModels,
      }).models;
    expect(parse([llama, medium]).map(({ uid }) => uid)).toEqual([llama.uid, medium.uid]);
    const base = {
      ...azurePricingModel("Llama-3.3-70B"),
      service_families: ["Foundry Models sold by Azure"],
    };
    expect(parse([llama, medium, base]).map(({ uid }) => uid)).toEqual([medium.uid]);
  });

  it("classifies unmatched public retail rows without guessing a catalog binding", async () => {
    const value = manifest("azure");
    const body = await fixture("azure/retail-prices.json");
    const reconciliation: { disposition: string; reason_code: string }[] = [];
    const models = parseSource({
      provider: provider(value),
      source: azureRetailSource(3, 5, 0.8),
      body,
      observedAt,
      catalogModels: [
        azurePricingModel("gpt-4.1", "2025-04-14"),
        azurePricingModel("gpt-5.6-terra", "2026-07-09"),
        azurePricingModel("gpt-audio-1.5", "2026-02-23"),
        azurePricingModel("gpt-4o-mini-realtime-preview", "2024-12-17"),
        azurePricingModel("gpt-4o-mini-audio-preview", "2024-12-17"),
      ],
      onPricingReconciliation: (item) => reconciliation.push(item),
    }).models;
    expect(models).toHaveLength(5);
    expect(reconciliation).toContainEqual({
      disposition: "excluded",
      reason_code: "non_base_consumption_row",
      sample: "Azure OpenAI / gpt-4.1-ft input global / gpt-4.1-ft input global Tokens",
    });
    expect(reconciliation).toContainEqual({
      disposition: "unbound",
      reason_code: "retail_identity_not_unique",
      sample: "Azure OpenAI GPT5 / GPT 5.2 pro inp Gl / GPT 5.2 pro inp Gl 1M Tokens",
    });
    expect(reconciliation).toContainEqual({
      disposition: "unbound",
      reason_code: "retail_identity_not_unique",
      sample: "Azure OpenAI / Unknown Inp glbl / Unknown Inp glbl Tokens",
    });
  });

  it("preserves ARM Legacy as a callable lifecycle state", async () => {
    const value = manifest("azure");
    const source = value.sources.find((candidate) => candidate.id === "azure-api");
    if (source === undefined) throw new Error("Missing Azure API source");
    const body = (await fixture("azure/api.json")).replace(
      '"lifecycleStatus": "GenerallyAvailable"',
      '"lifecycleStatus": "Legacy"',
    );
    const model = parseSource({ provider: provider(value), source, body, observedAt }).models[0];
    expect(model).toMatchObject({
      status: "legacy",
      release_stage: "unknown",
    });
  });

  it("treats an effective inference retirement date as retired despite stale lifecycle labels", async () => {
    const value = manifest("azure");
    const source = value.sources.find((candidate) => candidate.id === "azure-api");
    if (source === undefined) throw new Error("Missing Azure API source");
    const body = (await fixture("azure/api.json")).replace(
      "2027-01-01T00:00:00Z",
      "2026-07-01T00:00:00Z",
    );
    const apiModel = parseSource({ provider: provider(value), source, body, observedAt }).models[0];
    expect(apiModel).toMatchObject({ status: "retired", retired_at: "2026-07-01" });

    const lifecycle = (await fixture("azure/lifecycle.md")).replace(
      "| gpt-multi    | 2026-01-01 | GA        | 2027-01-01",
      "| gpt-multi    | 2026-01-01 | GA        | 2026-07-01",
    );
    expect(
      (await azureCatalog(lifecycle)).find(
        (candidate) => candidate.uid === "azure/gpt-multi@2026-01-01",
      ),
    ).toMatchObject({ status: "retired", retired_at: "2026-07-01" });
  });
});
