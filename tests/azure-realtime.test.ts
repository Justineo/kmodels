import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vite-plus/test";
import { parseSource } from "../src/catalog/adapters.ts";
import { manifests } from "../src/catalog/manifests.ts";
import { load } from "cheerio";
import { parseIJson, canonicalJson } from "../src/catalog/canonical-json.ts";
import { baseModel } from "../src/catalog/model.ts";
import { publishedRate } from "../src/catalog/pricing.ts";
import { assembleParsedProviderPricing } from "../src/catalog/pricing-adapter.ts";
import { calculationExport } from "../src/catalog/pricing-calculator-export.ts";
import { createPricingCatalogEnvelope } from "../src/catalog/pricing-envelope.ts";
import { catalogSchema, type ModelTask } from "../src/catalog/schema.ts";
import { createCalculator, type Quantity } from "../src/pricing/index.ts";
import { catalogRepairCandidates } from "../src/catalog/catalog-repair.ts";
import type { SourcePriceFact } from "../src/catalog/pricing-source.ts";
import type { SourceContractEvidence } from "../src/catalog/source-contract.ts";
import {
  sourcePricingReconciliation,
  type PricingReconciliationItem,
} from "../src/catalog/pricing-reconciliation.ts";

const observedAt = "2026-10-19T08:43:01.898Z";
const url =
  "https://learn.microsoft.com/en-us/azure/foundry-classic/openai/realtime-audio-reference-ga";
function configuration() {
  const manifest = manifests.find(({ provider }) => provider.id === "azure");
  const source = manifest?.sources.find(({ id }) => id === "azure-accounting");
  if (manifest === undefined || source === undefined)
    throw new Error("Missing Azure accounting source");
  return {
    manifest,
    source,
    provider: { ...manifest.provider, source_ids: manifest.sources.map(({ id }) => id) },
  };
}
const { manifest, source, provider } = configuration();
const fixture = () =>
  readFile(new URL("./fixtures/azure/accounting-realtime.html", import.meta.url), "utf8");
async function parse(body?: string, documentUrl = url, duplicate = false) {
  const findings: SourceContractEvidence[] = [];
  const reconciliation: PricingReconciliationItem[] = [];
  const parsed = parseSource({
    provider,
    source,
    observedAt,
    body: JSON.stringify({
      index: {
        url: source.url,
        body: await readFile(
          new URL("./fixtures/azure/accounting-chat.html", import.meta.url),
          "utf8",
        ),
      },
      documents:
        body === undefined
          ? []
          : [
              { url: documentUrl, body },
              ...(duplicate ? [{ url: documentUrl.replace("/en-us/", "/"), body }] : []),
            ],
    }),
    onContractFinding: (finding) => findings.push(finding),
    onPricingReconciliation: (item) => reconciliation.push(item),
  });
  return {
    ...parsed,
    findings,
    reconciliation,
    realtime: parsed.pricing_inputs?.filter(({ key }) => key.startsWith("realtime.")) ?? [],
  };
}

async function compiled(
  body: string | undefined,
  endpoint = "openai/v1/realtime/sessions",
  batch = false,
  additionalRates: SourcePriceFact[] = [],
) {
  const prices = manifest.sources.find(({ id }) => id === "azure-public-pricing");
  if (prices === undefined) throw new Error("Missing Azure price source");
  const parsed = await parse(body);
  const price_facts = [
    publishedRate("input_text", "2", "million_tokens", prices.id, "Synthetic control"),
    publishedRate("input_audio", "10", "million_tokens", prices.id, "Synthetic control"),
    publishedRate("input_image", "3", "million_tokens", prices.id, "Synthetic control"),
    publishedRate("cache_read_text", "0.2", "million_tokens", prices.id, "Synthetic control"),
    publishedRate("cache_read_audio", "0.3", "million_tokens", prices.id, "Synthetic control"),
    publishedRate("cache_read_image", "0.4", "million_tokens", prices.id, "Synthetic control"),
    publishedRate("output_text", "8", "million_tokens", prices.id, "Synthetic control"),
    publishedRate("output_audio", "20", "million_tokens", prices.id, "Synthetic control"),
    ...additionalRates,
  ].map((rate) => ({ ...rate, conditions: batch ? { service_tier: "batch" } : rate.conditions }));
  const model = {
    ...baseModel({
      providerId: "azure",
      id: "realtime-control",
      name: "Realtime control",
      sourceId: prices.id,
      observedAt,
    }),
    tasks: ["speech_to_speech"] satisfies ModelTask[],
    api_endpoints: [{ name: "API", path: endpoint }],
    price_facts,
  };
  const partition = assembleParsedProviderPricing(
    "azure",
    observedAt,
    [
      { source: prices, models: [model] },
      { source, ...parsed },
    ],
    [model],
  );
  if (partition === undefined) throw new Error("Missing Realtime price book");
  const core = catalogSchema.parse(
    JSON.parse(
      JSON.stringify({
        catalog_version: "a".repeat(64),
        generated_at: observedAt,
        coverage: [],
        warnings: [],
        providers: [provider],
        models: [model],
        sources: [prices, source].map((source) => ({
          id: source.id,
          provider_id: "azure",
          url: source.url,
          source: ["website"],
          stability: source.stability,
          scope: source.scope ?? "global",
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
        books: partition.books,
        model_dispositions: partition.model_dispositions,
      },
      core,
    ),
  );
  const offer = exported.providers[0]?.books[0]?.offers.find(
    ({ offer_key }) => offer_key === (batch ? "batch" : "sync"),
  );
  if (offer === undefined) throw new Error("Missing execution offer");
  const calculator = createCalculator(exported);
  const calculate = (event: unknown) => {
    const quantities = new Map<string, Quantity>();
    for (const term of offer.terms) {
      if (term.kind !== "rate") continue;
      for (const { charge_binding } of term.variants) {
        for (const method of charge_binding?.quantity_methods ?? []) {
          for (const source of method.input_sources ?? []) {
            if (source.locator.kind !== "json_pointer") continue;
            let value: unknown = event;
            for (const key of source.locator.value.split("/").slice(1))
              value =
                value !== null && typeof value === "object" && Object.hasOwn(value, key)
                  ? Reflect.get(value, key)
                  : undefined;
            if (typeof value !== "number") continue;
            quantities.set(canonicalJson(source.signal), {
              signal: source.signal,
              value: { numerator: String(value), denominator: "1" },
            });
          }
        }
      }
    }
    return calculator.calculate({
      evaluatedAt: observedAt,
      components: [
        { id: "response", offerRef: offer.id, quantities: [...quantities.values()], selectors: [] },
      ],
    });
  };
  return { offer, calculate };
}

function event(values: Readonly<Record<string, number>>) {
  return {
    type: "response.done",
    response: {
      usage: {
        input_token_details: {
          text_tokens: values.input_text ?? 0,
          audio_tokens: values.input_audio ?? 0,
          image_tokens: values.input_image ?? 0,
          cached_tokens_details: {
            text_tokens: values.cached_text ?? 0,
            audio_tokens: values.cached_audio ?? 0,
            image_tokens: values.cached_image ?? 0,
          },
        },
        output_token_details: {
          text_tokens: values.output_text ?? 0,
          audio_tokens: values.output_audio ?? 0,
        },
      },
    },
  };
}

describe("Azure native Realtime accounting", () => {
  it("extracts independent terminal counters from the owned response.done event", async () => {
    const result = await parse(await fixture());
    expect(result.realtime).toHaveLength(8);
    expect(result.models).toEqual([]);
    expect(result.realtime).toContainEqual(
      expect.objectContaining({
        key: "realtime.cached_audio_tokens",
        channel: "stream_event",
        availability: "terminal_only",
        locator: {
          kind: "json_pointer",
          value: "/response/usage/input_token_details/cached_tokens_details/audio_tokens",
        },
      }),
    );
    expect(result.realtime.every(({ absent_value }) => absent_value === undefined)).toBe(true);
  });

  it.each(["failed", "cancelled", "incomplete"])(
    "preserves terminal usage after a %s response",
    async (status) => {
      expect(
        (await parse((await fixture()).replace('"completed"', JSON.stringify(status)))).realtime,
      ).toHaveLength(8);
    },
  );

  it.each(["missing", "retyped"])("withholds only a %s native counter", async (change) => {
    const body = (await fixture()).replace(
      '"text_tokens": 64, "audio_tokens": 0, "image_tokens": 0',
      change === "missing"
        ? '"text_tokens": 64, "image_tokens": 0'
        : '"text_tokens": 64, "audio_tokens": "0", "image_tokens": 0',
    );
    const result = await parse(body);
    expect(result.realtime).toHaveLength(7);
    expect(result.realtime.some(({ key }) => key === "realtime.cached_audio_tokens")).toBe(false);
    expect(result.reconciliation).toContainEqual(
      expect.objectContaining({ reason_code: "pricing_input_contract_partial" }),
    );
  });

  it.each([
    "duplicate-heading",
    "duplicate-example",
    "wrong-event",
    "duplicate-json-member",
    "quoted",
  ])("does not accept a broken or unowned event declaration (%s)", async (change) => {
    const body = await fixture();
    const pre = body.match(/<pre>[\s\S]*?<\/pre>/)?.[0];
    if (pre === undefined) throw new Error("Missing native event fixture");
    const changed =
      change === "duplicate-heading"
        ? body.replace("<main>", '<main><h3 id="example">response.done</h3>')
        : change === "duplicate-example"
          ? body.replace(pre, pre + pre)
          : change === "wrong-event"
            ? body.replace('"type": "response.done"', '"type": "response.created"')
            : change === "duplicate-json-member"
              ? body.replace('"audio_tokens": 13', '"audio_tokens": "13", "audio_tokens": 13')
              : body.replace(pre, `<blockquote>${pre}</blockquote>`);
    expect((await parse(changed)).realtime).toEqual([]);
  });

  it("does not borrow another event's numeric example", async () => {
    const body = await fixture();
    const pre = body.match(/<pre>[\s\S]*?<\/pre>/)?.[0];
    if (pre === undefined) throw new Error("Missing native event fixture");
    const changed = body
      .replace(pre, "")
      .replace("<h3>response.output_item.added</h3>", `<h3>response.output_item.added</h3>${pre}`);
    expect((await parse(changed)).realtime).toEqual([]);
  });

  it("does not borrow the matching fields of another Azure product", async () => {
    expect(
      (
        await parse(
          await fixture(),
          "https://learn.microsoft.com/en-us/azure/ai-services/speech-service/voice-live-api-reference-2026-04-10",
        )
      ).realtime,
    ).toEqual([]);
  });

  it("keeps Chat mappings when the optional Realtime document is absent", async () => {
    const result = await parse();
    expect(result.realtime).toEqual([]);
    expect(result.pricing_inputs).toContainEqual(
      expect.objectContaining({ key: "chat.input_tokens" }),
    );
  });

  it("does not choose a winning duplicate reference document", async () => {
    expect((await parse(await fixture(), url, true)).realtime).toEqual([]);
  });

  it.each(["quoted-prose", "wrong-type", "wrong-response", "unsafe-counter", "negative-counter"])(
    "withholds an unproved native declaration (%s)",
    async (change) => {
      const body = await fixture();
      const changed =
        change === "quoted-prose"
          ? body.replace(
              "this event regardless of final state.",
              "<code>this event regardless of final state.</code>",
            )
          : change === "wrong-type"
            ? body.replace("<td>string</td>", "<td>object</td>")
            : change === "wrong-response"
              ? body.replace("<td>object</td>", "<td>array</td>")
              : body.replace(
                  '"audio_tokens": 13',
                  `"audio_tokens": ${change === "unsafe-counter" ? "9007199254740992" : "-1"}`,
                );
      const parsed = await parse(changed);
      expect(parsed.realtime).toHaveLength(change.endsWith("counter") ? 7 : 0);
    },
  );

  it("admits partial accounting contracts for repair even when source bytes are unchanged", async () => {
    const parsed = await parse(
      (await fixture()).replace('"audio_tokens": 13', '"audio_tokens": "13"'),
    );
    const report = sourcePricingReconciliation(parsed.models, parsed.reconciliation, true);
    const candidates = catalogRepairCandidates({
      schema_version: 2,
      generated_at: observedAt,
      providers: [
        {
          provider_id: provider.id,
          signals: [],
          attempt: {
            outcome: "accepted",
            sources: [
              {
                source_id: source.id,
                outcome: "unchanged",
                content_changed: false,
                pricing_reconciliation: report,
              },
            ],
          },
        },
      ],
    });
    expect(candidates).toEqual([
      expect.objectContaining({
        source_id: source.id,
        trigger: "source_pricing_structure",
        message: expect.stringContaining("pricing_input_contract_partial"),
      }),
    ]);
    expect(parsed.pricing_inputs).toContainEqual(
      expect.objectContaining({ key: "chat.input_tokens" }),
    );
  });
});

describe("Azure Realtime charge quantities", () => {
  it("calculates the native terminal usage through the portable export", async () => {
    const body = await fixture();
    const native = parseIJson(new TextEncoder().encode(load(body)("pre code").text()), 64 * 1024);
    const { calculate } = await compiled(body);
    expect(calculate(native)).toMatchObject({
      status: "calculated",
      totals: [
        {
          denomination: { kind: "fiat", currency: "USD" },
          amount: { numerator: "2891", denominator: "1250000" },
        },
      ],
    });
  });

  it.each([
    [{ input_text: 1000000 }, { numerator: "2", denominator: "1" }],
    [{ input_audio: 1000000 }, { numerator: "10", denominator: "1" }],
    [{ input_image: 1000000 }, { numerator: "3", denominator: "1" }],
    [
      { input_text: 1000000, cached_text: 1000000 },
      { numerator: "1", denominator: "5" },
    ],
    [
      { input_audio: 1000000, cached_audio: 1000000 },
      { numerator: "3", denominator: "10" },
    ],
    [
      { input_image: 1000000, cached_image: 1000000 },
      { numerator: "2", denominator: "5" },
    ],
    [{ output_text: 1000000 }, { numerator: "8", denominator: "1" }],
    [{ output_audio: 1000000 }, { numerator: "20", denominator: "1" }],
  ] as const)("uses independent native partitions (%j)", async (values, amount) => {
    const { calculate } = await compiled(await fixture());
    const result = calculate(event(values));
    expect(result).toMatchObject({
      status: "calculated",
      totals: [{ denomination: { kind: "fiat", currency: "USD" }, amount }],
    });
    expect(result.charges.filter(({ amount }) => amount.numerator !== "0")).toHaveLength(1);
  });

  it.each(["openai/v1/chat/completions", "openai/v1/images/generations"])(
    "does not lend Realtime locators to %s",
    async (endpoint) => {
      const { offer } = await compiled(await fixture(), endpoint);
      const mappings = offer.terms.flatMap((term) =>
        term.kind === "rate"
          ? term.variants.flatMap(
              ({ charge_binding }) =>
                charge_binding?.quantity_methods?.flatMap(
                  ({ input_sources }) => input_sources ?? [],
                ) ?? [],
            )
          : [],
      );
      expect(mappings.some(({ locator }) => locator.value.startsWith("/response/usage/"))).toBe(
        false,
      );
    },
  );

  it("does not use response.done fields as Batch job counters", async () => {
    const { offer } = await compiled(await fixture(), undefined, true);
    for (const term of offer.terms) {
      if (term.kind !== "rate") continue;
      for (const { charge_binding } of term.variants) {
        expect(charge_binding?.aggregation).toBe("job");
        expect(charge_binding?.quantity_methods).toBeUndefined();
      }
    }
  });

  it("preserves unresolvable quantities after a missing native counter instead of filling zero", async () => {
    const body = (await fixture()).replace(
      '"text_tokens": 64, "audio_tokens": 0, "image_tokens": 0',
      '"text_tokens": 64, "image_tokens": 0',
    );
    const { calculate, offer } = await compiled(body);
    expect(offer.terms.filter(({ kind }) => kind === "rate")).toHaveLength(8);
    const result = calculate(
      event({ input_audio: 1000000, cached_audio: 500000, output_text: 10 }),
    );
    expect(result.status).not.toBe("calculated");
    expect(result.totals).toBeUndefined();
  });

  it.each(["cache_write_text", "cache_write_audio", "cache_write_image"] as const)(
    "does not silently omit a separately priced %s partition",
    async (meter) => {
      const priceSource = manifest.sources.find(({ id }) => id === "azure-public-pricing");
      if (priceSource === undefined) throw new Error("Missing Azure price source");
      const { offer, calculate } = await compiled(await fixture(), undefined, false, [
        publishedRate(meter, "1", "million_tokens", priceSource.id, "Synthetic write control"),
      ]);
      const input = meter.replace("cache_write_", "input_");
      const term = offer.terms.find((term) => term.kind === "rate" && term.meter.value === input);
      if (term?.kind !== "rate") throw new Error("Missing input charge");
      expect(term.variants[0]?.charge_binding?.quantity_methods).toBeUndefined();
      expect(calculate(event({ input_text: 1000000 })).totals).toBeUndefined();
    },
  );
});
