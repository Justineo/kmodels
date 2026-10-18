import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vite-plus/test";
import { parseSource } from "../src/catalog/adapters.ts";
import { manifests } from "../src/catalog/manifests.ts";
import { assembleParsedProviderPricing } from "../src/catalog/pricing-adapter.ts";
import { validateAdoptedTopology } from "../src/catalog/pricing-adopted-topology.ts";
import { evaluateRateCost } from "../src/catalog/pricing-calculation.ts";
import { projectPricingTableCell } from "../src/catalog/pricing-presentation.ts";
import type { PricingReconciliationItem } from "../src/catalog/pricing-reconciliation.ts";
import { sourcePriceFactSchema } from "../src/catalog/pricing-source.ts";
import { providerModelSchema } from "../src/catalog/schema.ts";
import type { SourceContractEvidence } from "../src/catalog/source-contract.ts";

const manifest = manifests.find(({ provider }) => provider.id === "typesafe");
if (manifest === undefined) throw new Error("Missing TypeSafe manifest");
const source = manifest.sources[0];
if (source === undefined) throw new Error("Missing TypeSafe source");
const provider = { ...manifest.provider, source_ids: [source.id] };
const observedAt = "2026-09-22T00:00:00.000Z";
const fixture = (name: string) =>
  readFile(new URL(`./fixtures/typesafe/${name}`, import.meta.url), "utf8");

async function parse(overrides: { models?: string; api?: string | null; index?: string } = {}) {
  const api = overrides.api === undefined ? await fixture("api.md") : overrides.api;
  const findings: SourceContractEvidence[] = [];
  const reconciliation: PricingReconciliationItem[] = [];
  const parsed = parseSource({
    provider,
    source,
    observedAt,
    body: JSON.stringify({
      index: { url: source.url, body: overrides.models ?? (await fixture("models.md")) },
      documents: [
        {
          url: "https://docs.typesafe.ai/llms.txt",
          body: overrides.index ?? (await fixture("llms.txt")),
        },
        ...(api === null ? [] : [{ url: "https://docs.typesafe.ai/api.md", body: api }]),
      ],
    }),
    onContractFinding: (finding) => findings.push(finding),
    onPricingReconciliation: (item) => reconciliation.push(item),
  });
  return { ...parsed, findings, reconciliation };
}

describe("TypeSafe AI", () => {
  it("accepts compact and aligned Markdown delimiters but rejects missing hyphens", async () => {
    const models = await fixture("models.md");
    const expected = await parse({ models });
    for (const delimiter of ["-", "--", ":-", "-:", ":-:"])
      expect(await parse({ models: models.replace(/:?-{3,}:?/g, delimiter) }), delimiter).toEqual(
        expected,
      );
    await expect(parse({ models: models.replace(/:?-{3,}:?/g, ":") })).rejects.toThrow(
      "table header",
    );
  });

  it("publishes the exact current model, aliases and typed evaluation facts", async () => {
    const { models, pricing_inputs, findings, reconciliation } = await parse();
    expect(models).toHaveLength(1);
    const model = models[0];
    if (model === undefined) throw new Error("Missing TypeSafe model");
    providerModelSchema.parse(model);
    for (const rate of model.price_facts) sourcePriceFactSchema.parse(rate);
    expect(model).toMatchObject({
      provider_id: "typesafe",
      model_id: "jev-1.13.0",
      name: "Jev 1.13",
      aliases: ["jev-latest", "jev-preview"],
      status: "active",
      release_stage: "stable",
      tasks: ["classification"],
      modalities: { input: ["text"], output: [] },
      capabilities: { structured_output: true, tool_call: "unknown" },
      limits: { context_tokens: 64000 },
      model_card: {
        context_window: "64k tokens per request; 32k tokens for state plus the longest question",
      },
      api_endpoints: [{ name: "System One", path: "/v1/systemone" }],
    });
    expect(model.version).toBeUndefined();
    expect(model.release_date).toBeUndefined();
    expect(model.limits.max_input_tokens).toBeUndefined();
    expect(model.price_facts).toMatchObject([
      { meter: "input_text", price: "0.042", unit: "million_tokens" },
      { meter: "output_data", price: "0", unit: "million_tokens" },
    ]);
    expect(pricing_inputs?.map(({ locator }) => locator.value)).toEqual([
      "/usage/input_tokens",
      "/usage/output_tokens",
    ]);
    expect(findings).toEqual([]);
    expect(reconciliation.map(({ disposition }) => disposition)).toEqual([
      "normalized",
      "normalized",
      "excluded",
    ]);
  });

  it("accepts the current horizontal model table and compact labels", async () => {
    const { models, findings, reconciliation } = await parse({
      models: await fixture("models-horizontal.md"),
    });
    expect(
      models.map(({ model_id, name, aliases, limits, modalities }) => ({
        model_id,
        name,
        aliases,
        context_tokens: limits.context_tokens,
        input: modalities.input,
      })),
    ).toEqual([
      {
        model_id: "jev-1.13.0",
        name: "Jev 1.13",
        aliases: ["jev-latest"],
        context_tokens: 64000,
        input: ["text"],
      },
      {
        model_id: "jev-1.14.0",
        name: "Jev 1.14",
        aliases: ["jev-preview"],
        context_tokens: 64000,
        input: ["text"],
      },
    ]);
    expect(findings).toEqual([]);
    expect(reconciliation).toHaveLength(6);
  });

  it("compiles request charges with response usage mappings", async () => {
    const parsed = await parse();
    const { models } = parsed;
    const pricing = assembleParsedProviderPricing(
      "typesafe",
      observedAt,
      [{ source, ...parsed }],
      models,
    );
    expect(pricing).toBeDefined();
    if (pricing === undefined) throw new Error("Missing TypeSafe pricing");
    expect(() => validateAdoptedTopology(pricing)).not.toThrow();
    const model = models[0];
    if (model === undefined) throw new Error("Missing TypeSafe model");
    expect(
      projectPricingTableCell(
        {
          provider_vocabularies: [pricing.vocabulary],
          provider_snapshots: [pricing.snapshot],
          model_dispositions: pricing.model_dispositions,
          books: pricing.books,
        },
        model,
        "output",
      ),
    ).toMatchObject({ amount: "$0", displayUnit: "1M tokens" });
    const offers = pricing.books.flatMap(({ offers }) => offers);
    expect(offers).toHaveLength(1);
    const rates = offers.flatMap(({ terms }) => terms.filter((term) => term.kind === "rate"));
    expect(rates).toHaveLength(2);
    expect(
      rates.flatMap(({ variants }) => variants.map(({ charge_binding }) => charge_binding)),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          signal: { namespace: "kmodels", value: "input_tokens" },
          aggregation: "request",
          quantity_methods: expect.any(Array),
        }),
        expect.objectContaining({
          signal: { namespace: "kmodels", value: "output_tokens" },
          aggregation: "request",
          quantity_methods: expect.any(Array),
        }),
      ]),
    );
  });

  it.each([
    ["inconsistent units", "\\$42 / \\$0.042", "\\$42 / \\$0.42"],
    ["missing output price", "Output tokens are free.", "Output pricing varies."],
    ["unbound alias", /\| `jev-latest`\s*\| `jev-1\.13\.0`/, "| `jev-latest` | `missing-model`"],
    ["ambiguous alias", "| `jev-preview`", "| `jev-latest`"],
    ["unlabeled identity", /\| Jev 1\.13\s*\| `jev-1\.13\.0`\s*\|/, "| Jev 1.13 | Jev 1.13 |"],
  ])("rejects %s without guessing", async (_label, before, after) => {
    await expect(
      parse({ models: (await fixture("models.md")).replace(before, after) }),
    ).rejects.toThrow();
  });

  it("does not restrict future model IDs to the Jev name", async () => {
    const { models } = await parse({
      models: (await fixture("models.md")).replaceAll("jev-1.13.0", "decision-model-2"),
    });
    expect(models[0]?.model_id).toBe("decision-model-2");
  });

  it("rejects duplicate model tables before alias binding", async () => {
    const models = await fixture("models.md");
    const table = models.match(/^\| Jev 1\.13[^\n]*\n(?:\|[^\n]*\n)+/m)?.[0];
    if (table === undefined) throw new Error("Missing fixture model table");
    await expect(parse({ models: models.replace(table, `${table}\n${table}`) })).rejects.toThrow(
      "Duplicate TypeSafe model ID",
    );
  });

  it("rejects aliases that collide with a current model ID", async () => {
    const models = (await fixture("models.md")).replace("`jev-latest`", "`jev-1.13.0`");
    await expect(parse({ models })).rejects.toThrow("TypeSafe alias is ambiguous or unbound");
  });

  it("keeps model and price evidence if the optional API document is unavailable", async () => {
    const parsed = await parse({ api: null });
    const { models } = parsed;
    expect(models[0]).toMatchObject({
      model_id: "jev-1.13.0",
      pricing_state: "numeric",
      tasks: [],
    });
    expect(parsed.pricing_inputs).toEqual([]);
    expect(models[0]?.price_facts).toHaveLength(2);
    const pricing = assembleParsedProviderPricing(
      "typesafe",
      observedAt,
      [{ source, ...parsed }],
      models,
    );
    if (pricing === undefined) throw new Error("Missing TypeSafe pricing");
    const rate = pricing.books
      .flatMap(({ offers }) => offers)
      .flatMap(({ terms }) => terms)
      .find((term) => term.kind === "rate" && term.meter.value === "input_text");
    if (rate?.kind !== "rate" || rate.variants[0] === undefined)
      throw new Error("Missing TypeSafe input rate");
    const variant = rate.variants[0];
    expect(variant.charge_binding).toMatchObject({
      signal: { namespace: "kmodels", value: "input_tokens" },
      aggregation: "request",
    });
    expect(variant.charge_binding?.quantity_methods).toBeUndefined();
    expect(evaluateRateCost(variant, [])).toMatchObject({ kind: "missing_input" });
    expect(
      evaluateRateCost(variant, [
        {
          signal: { namespace: "kmodels", value: "input_tokens" },
          value: { numerator: "1000000", denominator: "1" },
        },
      ]),
    ).toMatchObject({
      kind: "resolved",
      amount: { numerator: "21", denominator: "500" },
      denomination: { kind: "fiat", currency: "USD" },
    });
  });

  it.each([
    ["renamed", '<ResponseField name="changed_tokens" type="integer" />'],
    ["retyped", '<ResponseField name="input_tokens" type="string" />'],
    [
      "contradictory",
      '<ResponseField name="input_tokens" type="integer" /><ResponseField name="input_tokens" type="string" />',
    ],
  ])("isolates %s usage fields from prices and sibling usage fields", async (_label, field) => {
    const { models, pricing_inputs, findings } = await parse({
      api: (await fixture("api.md")).replace(
        '<ResponseField name="input_tokens" type="integer" />',
        field,
      ),
    });
    expect(models[0]?.price_facts).toHaveLength(2);
    expect(pricing_inputs?.map(({ key }) => key)).toEqual(["systemone.output_tokens"]);
    expect(findings).toHaveLength(1);
  });

  it("does not map a counter nested under another usage property", async () => {
    const api = (await fixture("api.md")).replace(
      '<ResponseField name="input_tokens" type="integer" />',
      '<ResponseField name="details" type="object"><ResponseField name="input_tokens" type="integer" /></ResponseField>',
    );
    const { models, pricing_inputs, findings } = await parse({ api });
    const model = models[0];
    if (model === undefined) throw new Error("Missing TypeSafe model");
    expect(model.price_facts).toHaveLength(2);
    expect(pricing_inputs?.map(({ locator }) => locator.value)).toEqual(["/usage/output_tokens"]);
    expect(findings).toHaveLength(1);
  });

  it("ignores nested lookalikes beside the directly owned usage counters", async () => {
    const api = (await fixture("api.md")).replace(
      '<ResponseField name="input_tokens" type="integer" />',
      '<ResponseField name="input_tokens" type="integer" /><ResponseField name="details" type="object"><ResponseField name="input_tokens" type="integer" /></ResponseField>',
    );
    const { models, pricing_inputs, findings } = await parse({ api });
    const model = models[0];
    if (model === undefined) throw new Error("Missing TypeSafe model");
    expect(pricing_inputs?.map(({ locator }) => locator.value)).toEqual([
      "/usage/input_tokens",
      "/usage/output_tokens",
    ]);
    expect(findings).toEqual([]);
  });

  it("does not map a usage object nested under a different response property", async () => {
    const api = (await fixture("api.md"))
      .replace(
        '<ResponseField name="usage" type="object" required>',
        '<ResponseField name="details" type="object"><ResponseField name="usage" type="object" required>',
      )
      .replace("\n## Answer types", "</ResponseField>\n\n## Answer types");
    const { models, pricing_inputs, findings } = await parse({ api });
    const model = models[0];
    if (model === undefined) throw new Error("Missing TypeSafe model");
    expect(pricing_inputs).toEqual([]);
    expect(model.price_facts).toHaveLength(2);
    expect(findings).toHaveLength(2);
  });

  it("fails closed when the index adds an unreviewed commercial surface", async () => {
    await expect(
      parse({
        index: `${await fixture("llms.txt")}\n- [Caching](https://docs.typesafe.ai/pricing/caching.md)`,
      }),
    ).rejects.toThrow("unreviewed commercial document");
  });
});
