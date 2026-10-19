import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vite-plus/test";
import { parseSource } from "../src/catalog/adapters.ts";
import { manifests } from "../src/catalog/manifests.ts";
import type { PricingReconciliationItem } from "../src/catalog/pricing-reconciliation.ts";
import { baseModel } from "../src/catalog/model.ts";
import { publishedRate } from "../src/catalog/pricing.ts";
import { assembleParsedProviderPricing } from "../src/catalog/pricing-adapter.ts";
import { calculationExport } from "../src/catalog/pricing-calculator-export.ts";
import { createPricingCatalogEnvelope } from "../src/catalog/pricing-envelope.ts";
import { catalogSchema } from "../src/catalog/schema.ts";
import { canonicalJson } from "../src/catalog/canonical-json.ts";
import { createCalculator, type Quantity } from "../src/pricing/index.ts";
import { sourcePricingReconciliation } from "../src/catalog/pricing-reconciliation.ts";
import { catalogRepairCandidates } from "../src/catalog/catalog-repair.ts";

function configuration() {
  const manifest = manifests.find(({ provider }) => provider.id === "openai");
  const source = manifest?.sources.find(({ id }) => id === "openai-accounting");
  const prices = manifest?.sources.find(({ id }) => id === "openai-pricing");
  if (manifest === undefined || source === undefined || prices === undefined)
    throw new Error("Missing OpenAI source");
  return {
    source,
    prices,
    provider: { ...manifest.provider, source_ids: manifest.sources.map(({ id }) => id) },
  };
}
const { source, prices, provider } = configuration();
const observedAt = "2026-10-19T11:50:48.428Z";
const native = () =>
  readFile(new URL("./fixtures/openai/accounting-realtime.yaml", import.meta.url), "utf8");
function accounting(body: string) {
  const diagnostics: PricingReconciliationItem[] = [];
  const parsed = parseSource({
    provider,
    source,
    observedAt,
    body,
    onPricingReconciliation: (item) => diagnostics.push(item),
  });
  return { inputs: parsed.pricing_inputs ?? [], diagnostics };
}

// Native API contract; prices and model metadata below are explicitly synthetic scope controls.
async function compiled(
  controls: {
    body?: string;
    apiPath?: string;
    apiName?: string;
    batch?: boolean;
    operation?: string;
    omitCache?: boolean;
    omitMediaCache?: boolean;
    cacheWrite?: "same" | "currency" | "validity" | "batch";
    foreign?: boolean;
  } = {},
) {
  const parsed = parseSource({
    provider,
    source,
    observedAt,
    body: controls.body ?? (await native()),
  });
  if (controls.foreign)
    parsed.pricing_inputs = [
      ...(parsed.pricing_inputs ?? []),
      {
        key: "responses.usage.cached_input_tokens",
        channel: "response",
        locator: { kind: "json_pointer", value: "/usage/input_tokens_details/cached_tokens" },
        availability: "terminal_only",
        source_ref: source.id,
      },
      {
        key: "responses.served_service_tier",
        channel: "response",
        locator: { kind: "json_pointer", value: "/service_tier" },
        availability: "terminal_only",
        source_ref: source.id,
      },
      {
        key: "organization.completions.service_tier",
        channel: "account_report",
        locator: {
          kind: "provider_field",
          value: "organization.usage.completions.results[*].service_tier",
        },
        availability: "reconciliation_only",
        source_ref: source.id,
      },
    ];
  const model = {
    ...baseModel({
      providerId: "openai",
      id: "realtime-control",
      name: "Synthetic Realtime control",
      sourceId: prices.id,
      observedAt,
    }),
    api_endpoints: [
      { name: controls.apiName ?? "Realtime", path: controls.apiPath ?? "v1/realtime" },
    ],
    price_facts: [
      publishedRate("input_text", "2", "million_tokens", prices.id, "Synthetic text input"),
      publishedRate("cache_read_text", "1", "million_tokens", prices.id, "Synthetic text cache"),
      publishedRate("output_text", "3", "million_tokens", prices.id, "Synthetic text output"),
      publishedRate("input_audio", "4", "million_tokens", prices.id, "Synthetic audio input"),
      publishedRate("cache_read_audio", "2", "million_tokens", prices.id, "Synthetic audio cache"),
      publishedRate("output_audio", "5", "million_tokens", prices.id, "Synthetic audio output"),
      publishedRate("input_image", "6", "million_tokens", prices.id, "Synthetic image input"),
      publishedRate("cache_read_image", "3", "million_tokens", prices.id, "Synthetic image cache"),
    ]
      .filter((fact) => !controls.omitCache || !fact.meter.startsWith("cache_read_"))
      .filter(
        (fact) =>
          !controls.omitMediaCache ||
          !["cache_read_audio", "cache_read_image"].includes(fact.meter),
      )
      .map((fact) => ({
        ...fact,
        conditions: {
          ...fact.conditions,
          ...(controls.batch ? { service_tier: "batch" } : {}),
          ...(controls.foreign ? { service_tier: "standard" } : {}),
          ...(controls.cacheWrite === "validity" ? { effective_from: observedAt } : {}),
          ...(controls.operation === undefined ? {} : { operation: controls.operation }),
        },
      })),
  };
  if (controls.cacheWrite !== undefined)
    model.price_facts.push({
      ...publishedRate(
        "cache_write_text",
        "1",
        "million_tokens",
        prices.id,
        "Synthetic cache-write scope",
        controls.cacheWrite === "batch"
          ? { service_tier: "batch" }
          : controls.cacheWrite === "validity"
            ? { effective_from: "2026-10-01T00:00:00Z", effective_until: "2026-10-18T00:00:00Z" }
            : {},
      ),
      currency: controls.cacheWrite === "currency" ? "EUR" : "USD",
    });
  const partition = assembleParsedProviderPricing(
    "openai",
    observedAt,
    [
      { source: prices, models: [model] },
      { source, ...parsed },
    ],
    [model],
  );
  if (partition === undefined) throw new Error("Missing OpenAI partition");
  const core = catalogSchema.parse(
    JSON.parse(
      JSON.stringify({
        catalog_version: "a".repeat(64),
        generated_at: observedAt,
        providers: [provider],
        models: [model],
        coverage: [],
        warnings: [],
        sources: [prices, source].map((source) => ({
          id: source.id,
          provider_id: "openai",
          url: source.url,
          source: [source.type],
          stability: source.stability,
          scope: "global",
          exhaustive: false,
          role: "overlay",
          field_paths: source.fields,
          observed_at: observedAt,
          content_hash: "1".repeat(64),
          extractor_version: source.extractorVersion,
        })),
      }),
    ),
  );
  const exported = calculationExport(
    core,
    createPricingCatalogEnvelope(
      {
        provider_vocabularies: [partition.vocabulary],
        provider_snapshots: [partition.snapshot],
        model_dispositions: partition.model_dispositions,
        books: partition.books,
      },
      core,
    ),
  );
  const offer = exported.providers[0]?.books[0]?.offers.find(
    (value) => value.offer_key === (controls.batch ? "batch" : "sync"),
  );
  if (offer === undefined) throw new Error("Missing native offer");
  const calculator = createCalculator(exported);
  const calculate = (event: unknown) => {
    const quantities = new Map<string, Quantity>();
    for (const term of offer.terms) {
      if (term.kind !== "rate") continue;
      for (const variant of term.variants)
        for (const method of variant.charge_binding?.quantity_methods ?? [])
          for (const input of method.input_sources ?? []) {
            if (input.locator.kind !== "json_pointer") continue;
            let value: unknown = event;
            for (const key of input.locator.value.split("/").slice(1))
              value =
                value !== null && typeof value === "object" && Object.hasOwn(value, key)
                  ? Reflect.get(value, key)
                  : undefined;
            if (typeof value !== "number") continue;
            quantities.set(canonicalJson(input.signal), {
              signal: input.signal,
              value: { numerator: String(value), denominator: "1" },
            });
          }
    }
    return calculator.calculate({
      evaluatedAt: observedAt,
      components: [
        {
          id: "response",
          offerRef: offer.id,
          quantities: [...quantities.values()],
          selectors:
            controls.operation === undefined
              ? []
              : [
                  {
                    kind: "categorical",
                    dimension: { namespace: "kmodels", value: "operation" },
                    value: {
                      namespace: "provider",
                      provider_id: "openai",
                      value: controls.operation,
                    },
                  },
                ],
        },
      ],
    });
  };
  return { offer, calculate };
}

function event() {
  const input: { text_tokens: number; audio_tokens?: number; image_tokens: number } = {
    text_tokens: 1000,
    audio_tokens: 2000,
    image_tokens: 3000,
  };
  return {
    type: "response.done",
    response: {
      usage: {
        input_tokens: 6000,
        output_tokens: 900,
        input_token_details: {
          ...input,
          cached_tokens_details: { text_tokens: 100, audio_tokens: 200, image_tokens: 300 },
        },
        output_token_details: { text_tokens: 400, audio_tokens: 500 },
      },
    },
  };
}

describe("OpenAI Realtime quantities", () => {
  it("does not reinterpret an aggregate Responses cache count when media-cache quotes are missing", async () => {
    const { offer } = await compiled({
      apiName: "Responses",
      apiPath: "v1/responses",
      foreign: true,
      omitMediaCache: true,
    });
    const term = offer.terms.find(
      (term) => term.kind === "rate" && term.meter.value === "cache_read_text",
    );
    if (term?.kind !== "rate") throw new Error("Missing cache rate");
    expect(term.variants[0]?.charge_binding?.quantity_methods).toBeUndefined();
  });
  it("prices native uncached, cached and output modalities exactly once", async () => {
    const result = (await compiled()).calculate(event());
    expect(result).toMatchObject({
      status: "calculated",
      totals: [{ amount: { numerator: "303", denominator: "10000" } }],
    });
    expect(result.charges).toHaveLength(8);
  });
  it("keeps the native uncached equation when cache prices are omitted", async () => {
    const result = (await compiled({ omitCache: true })).calculate(event());
    expect(result).toMatchObject({
      status: "calculated",
      totals: [{ amount: { numerator: "289", denominator: "10000" } }],
    });
  });
  it.each(["source", "runtime"])("keeps a missing %s counter unknown", async (missing) => {
    const body = (await native()).replace(
      /^ {16}audio_tokens:\n {18}type: integer/m,
      "                renamed:\n                  type: integer",
    );
    const result = await compiled(missing === "source" ? { body } : {});
    const usage = event();
    if (missing === "runtime") delete usage.response.usage.input_token_details.audio_tokens;
    expect(result.offer.terms.filter((term) => term.kind === "rate")).toHaveLength(8);
    const calculated = result.calculate(usage);
    expect(calculated.status).not.toBe("calculated");
    expect(calculated.totals).toBeUndefined();
  });
  it.each(["chat", "transcription", "batch", "operation"])(
    "does not lend native fields to another %s scope",
    async (scope) => {
      const { offer } = await compiled(
        scope === "chat"
          ? { apiPath: "v1/chat/completions" }
          : scope === "transcription"
            ? { apiPath: "v1/realtime/transcription_sessions" }
            : scope === "batch"
              ? { batch: true }
              : { operation: "transcription" },
      );
      const inputs = offer.terms.flatMap((term) =>
        term.kind !== "rate"
          ? []
          : term.variants.flatMap(
              (variant) =>
                variant.charge_binding?.quantity_methods?.flatMap(
                  (method) => method.input_sources ?? [],
                ) ?? [],
            ),
      );
      expect(inputs).toEqual([]);
    },
  );
  it("does not borrow Responses served-tier or organization selectors", async () => {
    const { offer } = await compiled({ foreign: true });
    expect(
      offer.terms.flatMap((term) =>
        term.kind !== "rate"
          ? []
          : term.variants.flatMap((variant) => variant.selector_sources ?? []),
      ),
    ).toEqual([]);
  });
  it("withholds the unproved native cache-write partition", async () => {
    const result = (await compiled({ cacheWrite: "same" })).calculate(event());
    expect(result.status).not.toBe("calculated");
    expect(result.totals).toBeUndefined();
  });
  it.each(["currency", "validity", "batch"] as const)(
    "keeps independently scoped native input mappings under a different %s",
    async (scope) => {
      const { offer } = await compiled({ cacheWrite: scope });
      const input = offer.terms.find(
        (term) => term.kind === "rate" && term.meter.value === "input_text",
      );
      if (input?.kind !== "rate") throw new Error("Missing text rate");
      expect(input.variants[0]?.charge_binding?.quantity_methods?.[0]?.input_sources).toHaveLength(
        2,
      );
    },
  );
});

describe("OpenAI native Realtime accounting", () => {
  it("admits field drift for repair even on unchanged source bytes", async () => {
    const body = (await native()).replace(
      /^ {16}audio_tokens:\n {18}type: integer/m,
      "                renamed:\n                  type: integer",
    );
    const { inputs, diagnostics } = accounting(body);
    expect(inputs).toHaveLength(7);
    const reconciliation = sourcePricingReconciliation([], diagnostics, true);
    const candidates = catalogRepairCandidates({
      schema_version: 2,
      generated_at: observedAt,
      providers: [
        {
          provider_id: "openai",
          signals: [],
          attempt: {
            outcome: "accepted",
            sources: [
              {
                source_id: source.id,
                outcome: "unchanged",
                content_changed: false,
                pricing_reconciliation: reconciliation,
              },
            ],
          },
        },
      ],
    });
    expect(candidates).toContainEqual(
      expect.objectContaining({
        source_id: source.id,
        trigger: "source_pricing_structure",
        message: expect.stringContaining("pricing_input_contract_partial"),
      }),
    );
  });
  it("owns the eight terminal modality counters through response.done", async () => {
    const { inputs } = accounting(await native());
    expect(inputs).toHaveLength(8);
    expect(
      inputs.every(
        ({ key, channel, availability, absent_value }) =>
          key.startsWith("realtime.") &&
          channel === "stream_event" &&
          availability === "terminal_only" &&
          absent_value === undefined,
      ),
    ).toBe(true);
    expect(inputs).toContainEqual({
      key: "realtime.cached_image_tokens",
      channel: "stream_event",
      availability: "terminal_only",
      locator: {
        kind: "json_pointer",
        value: "/response/usage/input_token_details/cached_tokens_details/image_tokens",
      },
      source_ref: source.id,
    });
    expect(inputs).toContainEqual({
      key: "realtime.output_audio_tokens",
      channel: "stream_event",
      availability: "terminal_only",
      locator: { kind: "json_pointer", value: "/response/usage/output_token_details/audio_tokens" },
      source_ref: source.id,
    });
  });

  it.each(["missing", "retyped", "duplicate"])(
    "withholds only a drifted native field (%s)",
    async (change) => {
      const replacement =
        change === "missing"
          ? "                renamed:\n                  type: integer"
          : change === "retyped"
            ? "                audio_tokens:\n                  type: string"
            : "                audio_tokens:\n                  type: integer\n                audio_tokens:\n                  type: integer";
      const body = (await native()).replace(
        /^ {16}audio_tokens:\n {18}type: integer/m,
        replacement,
      );
      const { inputs, diagnostics } = accounting(body);
      expect(inputs).toHaveLength(7);
      expect(inputs.some(({ key }) => key === "realtime.input_audio_tokens")).toBe(false);
      expect(inputs.some(({ key }) => key === "realtime.cached_audio_tokens")).toBe(true);
      expect(diagnostics).toContainEqual(
        expect.objectContaining({ reason_code: "pricing_input_contract_partial" }),
      );
    },
  );

  it.each([
    "event-type",
    "event-value-type",
    "reference",
    "duplicate-event",
    "duplicate-response",
    "quoted",
  ])("does not borrow an unowned event (%s)", async (change) => {
    let body = await native();
    if (change === "event-type") body = body.replace("- response.done", "- response.created");
    else if (change === "event-value-type")
      body = body.replace(
        /type: string\n {10}enum:\n {12}- response.done/,
        "type: integer\n          enum:\n            - response.done",
      );
    else if (change === "reference")
      body = body.replace(
        '"#/components/schemas/RealtimeResponse"',
        '"#/components/schemas/ImagesResponse"',
      );
    else if (change === "duplicate-event")
      body += body.slice(body.indexOf("    RealtimeServerEventResponseDone:"));
    else if (change === "duplicate-response")
      body += body.slice(
        body.indexOf("    RealtimeResponse:"),
        body.indexOf("    RealtimeServerEventResponseDone:"),
      );
    else
      body =
        "example: |\n" +
        body
          .split("\n")
          .map((line) => "  " + line)
          .join("\n");
    expect(() => accounting(body)).toThrow("no recognized pricing inputs");
  });

  it("does not expose organization bucket totals as request acquisition contracts", async () => {
    const { inputs } = accounting(
      (await native()) +
        "\n    UsageCompletionsResult:\n      type: object\n      properties:\n        input_audio_tokens:\n          type: integer\n",
    );
    expect(inputs).toHaveLength(8);
    expect(inputs.every(({ channel }) => channel !== "account_report")).toBe(true);
  });
});
