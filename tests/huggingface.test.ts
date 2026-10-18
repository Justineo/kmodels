import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vite-plus/test";
import { parseSource } from "../src/catalog/adapters.ts";
import { extractHuggingFacePricingInputs } from "../src/catalog/huggingface-accounting.ts";
import { manifests, type ProviderManifest } from "../src/catalog/manifests.ts";
import {
  assembleParsedProviderPricing,
  type ParsedPricingSource,
} from "../src/catalog/pricing-adapter.ts";
import { capturePricingReplaySources } from "../src/catalog/pricing-compilation.ts";
import {
  evaluateApplicability,
  type PricingSelection,
} from "../src/catalog/pricing-applicability.ts";
import { validatePricingCatalog } from "../src/catalog/pricing-validation.ts";
import type { ParsedProviderModel } from "../src/catalog/pricing-source.ts";

const observedAt = "2026-10-19T00:00:00.000Z";
function configuration() {
  const value: ProviderManifest | undefined = manifests.find(
    ({ provider }) => provider.id === "huggingface",
  );
  const source = value?.sources.find(({ id }) => id === "huggingface-router");
  if (value === undefined || source === undefined)
    throw new Error("Missing Hugging Face configuration");
  return { value, source };
}
const { value, source } = configuration();
const provider = { ...value.provider, source_ids: value.sources.map(({ id }) => id) };
const sourceRecord = {
  id: source.id,
  provider_id: provider.id,
  url: source.url,
  source: source.source ?? [source.type],
  stability: source.stability,
  scope: source.scope ?? "global",
  exhaustive: source.exhaustive ?? false,
  role: source.role ?? "catalog",
  field_paths: source.fields,
  ...(source.pricingEvidence === undefined ? {} : { pricing_evidence: source.pricingEvidence }),
  observed_at: observedAt,
  content_hash: "1".repeat(64),
  extractor_version: source.extractorVersion,
};
const fixture = (file: string) =>
  readFile(new URL(`./fixtures/huggingface/${file}`, import.meta.url), "utf8");

const documentFixtures = [
  ["overview.md", "https://huggingface.co/docs/inference-providers/en/index.md"],
  [
    "chat-completion.md",
    "https://huggingface.co/docs/inference-providers/en/tasks/chat-completion.md",
  ],
  [
    "responses-api.md",
    "https://huggingface.co/docs/inference-providers/en/guides/responses-api.md",
  ],
  [
    "responses-schema.yaml",
    "https://raw.githubusercontent.com/openai/openai-openapi/master/openapi.yaml",
  ],
] as const;

async function documents(edit: (file: string, body: string) => string = (_file, body) => body) {
  return Promise.all(
    documentFixtures.map(async ([file, url]) => ({ url, body: edit(file, await fixture(file)) })),
  );
}

async function parse(
  edit: (body: string) => string = (body) => body,
  editDocument: (file: string, body: string) => string = (_file, body) => body,
) {
  return parseSource({
    provider,
    source,
    observedAt,
    body: JSON.stringify({
      index: { url: source.url, body: edit(await fixture("pricing.json")) },
      documents: await documents(editDocument),
    }),
  });
}

function assemble(parsed: Omit<ParsedPricingSource, "source">, models: ParsedProviderModel[]) {
  const partition = assembleParsedProviderPricing(
    provider.id,
    observedAt,
    [{ source, ...parsed }],
    models,
    value.pricingCategoricalLabels,
  );
  if (partition === undefined) throw new Error("Missing routed pricing partition");
  validatePricingCatalog(
    {
      provider_vocabularies: [partition.vocabulary],
      provider_snapshots: [partition.snapshot],
      books: partition.books,
      model_dispositions: partition.model_dispositions,
    },
    { providers: [provider], models, sources: [sourceRecord] },
  );
  return partition;
}

const selection = (route: string, promotion: boolean): PricingSelection[] => [
  {
    kind: "categorical",
    dimension: { namespace: "kmodels", value: "route_provider" },
    value: { namespace: "provider", provider_id: provider.id, value: route },
  },
  { kind: "boolean", dimension: { namespace: "kmodels", value: "promotion" }, value: promotion },
];

describe("Hugging Face source-owned route states", () => {
  it("publishes independent usage inputs and a typed route promotion beside list prices", async () => {
    const parsed = await parse((body) =>
      body.replace('"input": 0, "output": "0.0"', '"input": 2, "output": 4'),
    );
    expect(parsed.pricing_inputs).toHaveLength(9);
    expect(parsed.models.every(({ pricing_inputs }) => pricing_inputs === undefined)).toBe(true);
    const free = parsed.models.find(({ model_id }) => model_id === "org/free-model");
    expect(free?.raw_price_facts).toEqual([]);
    expect(free?.state_facts).toMatchObject([
      {
        state: "free",
        conditions: { route_provider: "publicai", promotion: true },
        source_ref: source.id,
      },
    ]);
    const partition = assemble(parsed, parsed.models);
    const offer = partition.books.find(
      ({ book_key }) => book_key === "model:huggingface/org/free-model",
    )?.offers[0];
    const state = offer?.states.find(({ state }) => state === "free");
    if (state === undefined) throw new Error("Missing exact route promotion");
    expect(evaluateApplicability(state.applicability, selection("publicai", true)).state).toBe(
      "true",
    );
    expect(evaluateApplicability(state.applicability, selection("publicai", false)).state).toBe(
      "false",
    );
    expect(evaluateApplicability(state.applicability, selection("deepinfra", true)).state).toBe(
      "false",
    );
    const rates = offer?.terms.flatMap((term) => (term.kind === "rate" ? term.variants : []));
    expect(rates).toHaveLength(2);
    for (const rate of rates ?? []) {
      expect(evaluateApplicability(rate.applicability, selection("publicai", true)).state).toBe(
        "false",
      );
      expect(evaluateApplicability(rate.applicability, selection("publicai", false)).state).toBe(
        "true",
      );
    }
  });

  it("preserves typed free state through raw evidence edits and compilation capture/replay", async () => {
    const parsed = await parse();
    for (const model of parsed.models)
      for (const state of model.state_facts ?? [])
        state.raw.label = "A conflicting passive description";
    const captured = capturePricingReplaySources([{ source, ...parsed }], [sourceRecord])?.[0];
    if (captured === undefined) throw new Error("Missing captured route source");
    expect(
      captured.models.flatMap(({ state_facts }) => state_facts ?? []).map(({ state }) => state),
    ).toEqual(["free"]);
    expect(assemble(captured, parsed.models)).toEqual(assemble(parsed, parsed.models));
  });

  it("keeps a free route without list prices scoped, with the missing base prices visible", async () => {
    const parsed = await parse((body) =>
      body.replace(',\n          "pricing": { "input": 0, "output": "0.0" }', ""),
    );
    const offer = assemble(parsed, parsed.models).books.find(
      ({ book_key }) => book_key === "model:huggingface/org/free-model",
    )?.offers[0];
    expect(offer?.states.filter(({ state }) => state === "free")).toHaveLength(1);
    expect(offer?.terms.some((term) => term.kind === "rate")).toBe(false);
    const raw = offer?.terms.flatMap((term) => (term.kind === "raw" ? term.variants : []));
    expect(raw).toHaveLength(1);
    for (const variant of raw ?? []) {
      if (variant.possible_scope === undefined) throw new Error("Missing base-price scope");
      expect(evaluateApplicability(variant.possible_scope, selection("publicai", true)).state).toBe(
        "false",
      );
      expect(
        evaluateApplicability(variant.possible_scope, selection("publicai", false)).state,
      ).toBe("true");
    }
  });

  it.each(["false", '"true"', "null"])(
    "does not invent a free state for is_free=%s",
    async (flag) => {
      const parsed = await parse((body) => body.replace('"is_free": true', `"is_free": ${flag}`));
      const offer = assemble(parsed, parsed.models).books.find(
        ({ book_key }) => book_key === "model:huggingface/org/free-model",
      )?.offers[0];
      expect(offer?.states.some(({ state }) => state === "free")).toBe(false);
    },
  );

  it("cannot make a paid route free by forging a raw marker", async () => {
    const parsed = await parse();
    const model = parsed.models.find(({ model_id }) => model_id === "org/model-1");
    if (model === undefined) throw new Error("Missing paid route fixture");
    for (const rate of model.price_facts) rate.conditions.promotion = false;
    model.raw_price_facts.push({
      term_key: "route_promotional_free",
      impact: "base_price",
      reason: "unknown_amount",
      conditions: { route_provider: "deepinfra", promotion: true },
      source_ref: source.id,
      raw: { label: "Unrecognized legacy evidence" },
    });
    const offer = assemble(parsed, parsed.models).books.find(
      ({ book_key }) => book_key === "model:huggingface/org/model-1",
    )?.offers[0];
    expect(offer?.states.some(({ state }) => state === "free")).toBe(false);
    expect(
      offer?.terms.flatMap((term) => (term.kind === "raw" ? term.variants : [])),
    ).toContainEqual(expect.objectContaining({ impact: "base_price" }));
  });
});

describe("Hugging Face Responses accounting ownership", () => {
  const input = "input_tokens:\n          type: integer";
  const inputLine = "        input_tokens:\n          type: integer";
  const inputKeys = ["responses.response.input_tokens", "responses.stream.input_tokens"];
  const outputKeys = ["responses.response.output_tokens", "responses.stream.output_tokens"];

  it.each([
    [
      "wrong scalar",
      (body: string) => body.replace(input, "input_tokens:\n          type: string"),
      outputKeys,
    ],
    [
      "fractional counter",
      (body: string) => body.replace(input, "input_tokens:\n          type: number"),
      outputKeys,
    ],
    [
      "nested lookalike",
      (body: string) =>
        body.replace(
          inputLine,
          "        details:\n          properties:\n            input_tokens:\n              type: integer",
        ),
      outputKeys,
    ],
    [
      "duplicate counter",
      (body: string) =>
        body.replace(inputLine, inputLine + "\n        input_tokens:\n          type: string"),
      outputKeys,
    ],
    [
      "duplicate usage schema",
      (body: string) =>
        body +
        "\n    ResponseUsage:\n      properties:\n        input_tokens:\n          type: integer\n",
      [],
    ],
    [
      "detached usage",
      (body: string) =>
        body.replace("#/components/schemas/ResponseUsage", "#/components/schemas/MissingUsage"),
      [],
    ],
    [
      "wrong usage container",
      (body: string) =>
        body.replace(
          "            usage:\n              anyOf:",
          "            usage:\n              type: string\n              anyOf:",
        ),
      [],
    ],
    [
      "conflicting union",
      (body: string) =>
        body.replace(
          input,
          "input_tokens:\n          anyOf:\n            - type: integer\n            - type: string",
        ),
      outputKeys,
    ],
    [
      "cyclic usage",
      (body: string) =>
        body.replace("#/components/schemas/ResponseUsage", "#/components/schemas/Response"),
      [],
    ],
    [
      "detached completed event",
      (body: string) =>
        body.replace(
          '$ref: "#/components/schemas/Response"',
          '$ref: "#/components/schemas/MissingResponse"',
        ),
      ["responses.response.input_tokens", "responses.response.output_tokens"],
    ],
  ] as const)(
    "withholds affected locators for %s while preserving chat and rates",
    async (_name, edit, expected) => {
      const parsed = await parse(
        (body) => body,
        (file, body) => (file === "responses-schema.yaml" ? edit(body) : body),
      );
      expect(
        (parsed.pricing_inputs ?? [])
          .map(({ key }) => key)
          .filter((key) => key.startsWith("responses."))
          .sort(),
      ).toEqual([...expected].sort());
      expect(
        (parsed.pricing_inputs ?? []).filter(({ key }) => !key.startsWith("responses.")),
      ).toHaveLength(5);
      expect(
        assemble(parsed, parsed.models).books.flatMap(({ offers }) =>
          offers.flatMap(({ terms }) => terms.filter((term) => term.kind === "rate")),
        ),
      ).toHaveLength(4);
    },
  );

  it.each([
    [
      "nullable integer",
      (body: string) => body.replace(input, "input_tokens:\n          type: [integer, 'null']"),
    ],
    [
      "additive sibling",
      (body: string) =>
        body.replace(inputLine, "        future_counter:\n          type: string\n" + inputLine),
    ],
  ] as const)("retains established locators for %s", async (_name, edit) => {
    const parsed = await parse(
      (body) => body,
      (file, body) => (file === "responses-schema.yaml" ? edit(body) : body),
    );
    expect(
      (parsed.pricing_inputs ?? [])
        .map(({ key }) => key)
        .filter((key) => key.startsWith("responses."))
        .sort(),
    ).toEqual([...inputKeys, ...outputKeys].sort());
  });

  it.each(["responses-schema.yaml", "chat-completion.md"] as const)(
    "withholds ambiguous duplicate companions: %s",
    async (file) => {
      const items = await documents();
      const url = documentFixtures.find(([name]) => name === file)?.[1];
      const duplicate = items.find((item) => item.url === url);
      if (duplicate === undefined) throw new Error("Missing companion fixture");
      let findings = 0;
      const inputs = extractHuggingFacePricingInputs(
        [...items, duplicate],
        source.id,
        () => findings++,
      );
      expect(inputs).toHaveLength(5);
      expect(findings).toBe(4);
      expect(inputs.filter(({ key }) => key.startsWith("responses."))).toHaveLength(
        file === "responses-schema.yaml" ? 0 : 4,
      );
    },
  );

  it("needs the Hugging Face compatibility claim as well as the protocol schema", async () => {
    const parsed = await parse(
      (body) => body,
      (file, body) =>
        file === "responses-api.md"
          ? body.replace("Responses API (from OpenAI)", "An unrelated API")
          : body,
    );
    expect(parsed.pricing_inputs).toHaveLength(5);
    expect(parsed.pricing_inputs?.some(({ key }) => key.startsWith("responses."))).toBe(false);
    expect(assemble(parsed, parsed.models).books).toHaveLength(2);
  });
});
