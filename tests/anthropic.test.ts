import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vite-plus/test";
import { parseSource } from "../src/catalog/adapters.ts";
import { catalogRepairCandidates } from "../src/catalog/catalog-repair.ts";
import { assembleParsedProviderPricing } from "../src/catalog/pricing-adapter.ts";
import { validatePricingCatalog } from "../src/catalog/pricing-validation.ts";
import { evaluateApplicability } from "../src/catalog/pricing-applicability.ts";
import { evaluateChargeQuantity } from "../src/catalog/pricing-calculation.ts";
import { linkedDocumentUrls } from "../src/catalog/fetch.ts";
import { applyGroups } from "../src/catalog/collector.ts";
import { manifests, type ProviderManifest } from "../src/catalog/manifests.ts";
import { baseModel } from "../src/catalog/model.ts";
import {
  sourcePricingReconciliation,
  type PricingReconciliationItem,
} from "../src/catalog/pricing-reconciliation.ts";
import type { ParsedProviderModel as ProviderModel } from "../src/catalog/pricing-source.ts";
import type { Provider } from "../src/catalog/schema.ts";
import type { SourceContractEvidence } from "../src/catalog/source-contract.ts";
import type { SourceParseResult } from "../src/catalog/source-parse.ts";

const observedAt = "2026-07-21T00:00:00.000Z";
function contractPaths(findings: readonly SourceContractEvidence[]): string[] {
  return findings.flatMap(({ diagnostics }) => diagnostics.map(({ path }) => path));
}
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

function validatedPricing(parsed: SourceParseResult) {
  const { models } = parsed;
  const value = manifest("anthropic");
  const source = value.sources[0];
  if (source === undefined) throw new Error("Missing Anthropic source");
  const partition = assembleParsedProviderPricing(
    "anthropic",
    observedAt,
    [{ source, ...parsed }],
    models,
    value.pricingCategoricalLabels,
  );
  if (partition === undefined) throw new Error("Missing Anthropic pricing");
  validatePricingCatalog(
    {
      provider_vocabularies: [partition.vocabulary],
      provider_snapshots: [partition.snapshot],
      model_dispositions: partition.model_dispositions,
      books: partition.books,
    },
    {
      models,
      providers: [provider(value)],
      sources: [
        {
          id: source.id,
          provider_id: "anthropic",
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
  return partition;
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

const anthropicDocuments = [
  ["/docs/en/about-claude/pricing.md", "pricing.md"],
  ["/docs/en/about-claude/model-deprecations.md", "lifecycle.md"],
  ["/docs/en/about-claude/models/model-ids-and-versions.md", "model-ids.md"],
  ["/docs/en/api/models/list.md", "models-list.md"],
  ["/docs/en/api/messages/create.md", "messages.md"],
  ["/docs/en/api/messages/batches/create.md", "batches.md"],
  ["/docs/en/build-with-claude/batch-processing.md", "batch-processing.md"],
  ["/docs/en/build-with-claude/citations.md", "citations.md"],
  ["/docs/en/build-with-claude/pdf-support.md", "pdf-support.md"],
  ["/docs/en/build-with-claude/context-editing.md", "context-editing.md"],
  ["/docs/en/build-with-claude/structured-outputs.md", "structured-outputs.md"],
  ["/docs/en/agents-and-tools/tool-use/code-execution-tool.md", "code-execution-tool.md"],
  ["/docs/en/agents-and-tools/tool-use/web-search-tool.md", "web-search-tool.md"],
  ["/docs/en/agents-and-tools/tool-use/advisor-tool.md", "advisor-tool.md"],
  ["/docs/en/agents-and-tools/tool-use/computer-use-tool.md", "computer-use-tool.md"],
  ["/docs/en/build-with-claude/effort.md", "effort.md"],
  ["/docs/en/build-with-claude/prompt-caching.md", "prompt-caching.md"],
  ["/docs/en/about-claude/glossary.md", "glossary.md"],
  ["/docs/en/build-with-claude/thinking.md", "thinking.md"],
  ["/docs/en/build-with-claude/thinking-troubleshooting.md", "thinking-troubleshooting.md"],
  ["/docs/en/build-with-claude/compaction.md", "compaction.md"],
  ["/docs/en/build-with-claude/compaction-threshold.md", "compaction-threshold.md"],
  ["/docs/en/agents-and-tools/tool-use/define-tools.md", "define-tools.md"],
  ["/docs/en/build-with-claude/fast-mode.md", "fast-mode.md"],
  ["/docs/en/manage-claude/data-residency.md", "data-residency.md"],
  ["/docs/en/build-with-claude/fallback-credit.md", "fallback-credit.md"],
  ["/docs/en/release-notes/overview.md", "release-notes.md"],
] as const;

async function anthropicSource(
  options: {
    overview?: string;
    overrides?: Readonly<Record<string, string>>;
    omit?: readonly string[];
    extraDocuments?: readonly { url: string; body: string }[];
    onPricingReconciliation?: (item: PricingReconciliationItem) => void;
    onPricingDependencyFailure?: (url: string) => void;
    onContractFinding?: (evidence: SourceContractEvidence) => void;
  } = {},
): Promise<SourceParseResult> {
  const value = manifest("anthropic");
  const source = value.sources[0];
  if (source === undefined) throw new Error("Missing Anthropic source");
  const {
    overview,
    overrides = {},
    omit = [],
    extraDocuments = [],
    onPricingReconciliation,
    onPricingDependencyFailure,
    onContractFinding,
  } = options;
  const body = JSON.stringify({
    index: {
      url: source.url,
      body: overview ?? (await fixture("anthropic/overview.md")),
    },
    documents: [
      ...(await Promise.all(
        anthropicDocuments
          .filter(([path]) => !omit.includes(path))
          .map(async ([path, fixtureName]) => ({
            url: `https://platform.claude.com${path}`,
            body: overrides[path] ?? (await fixture(`anthropic/${fixtureName}`)),
          })),
      )),
      ...extraDocuments,
    ],
  });
  return parseSource({
    provider: provider(value),
    source,
    body,
    observedAt,
    ...(onPricingReconciliation === undefined ? {} : { onPricingReconciliation }),
    ...(onPricingDependencyFailure === undefined ? {} : { onPricingDependencyFailure }),
    ...(onContractFinding === undefined ? {} : { onContractFinding }),
  });
}

async function anthropicCatalog(
  options: Parameters<typeof anthropicSource>[0] = {},
): Promise<ProviderModel[]> {
  return (await anthropicSource(options)).models;
}

async function anthropicContextPricing(transform?: (body: string) => string) {
  const native = await fixture("anthropic/prompt-length-pricing.md");
  return anthropicSource({
    overview:
      (await fixture("anthropic/overview.md")) +
      `
| Feature | Claude Haiku 5.5 |
| --- | --- |
| Claude API ID | claude-haiku-5-5 |
| Context window | 1M tokens |
| Max output | 128K tokens |
`,
    overrides: {
      "/docs/en/about-claude/pricing.md":
        (await fixture("anthropic/pricing.md")) + "\n" + (transform?.(native) ?? native),
    },
  });
}

describe("Anthropic adapters", () => {
  it("establishes global base pricing before assembly", async () => {
    const parsed = await anthropicSource();
    const fable = parsed.models.find(({ model_id }) => model_id === "claude-fable-5");
    const global = fable?.price_facts.filter((rate) => rate.conditions.inference_geo === "global");
    expect(global?.length).toBeGreaterThan(0);
    expect(global?.some((rate) => rate.meter === "input_text" && rate.price === "10")).toBe(true);
    expect(fable?.price_facts.every((rate) => rate.conditions.inference_geo !== undefined)).toBe(
      true,
    );
  });
  it.each(["quoted", "fenced", "outside", "duplicate"])(
    "does not borrow %s geography pricing declarations",
    async (change) => {
      const pricing = await fixture("anthropic/pricing.md");
      const line = pricing.split("\n").find((part) => part.startsWith("For Claude 4.6"));
      if (line === undefined) throw new Error("Missing native geography statement");
      const replacement =
        change === "quoted"
          ? "> " + line
          : change === "fenced"
            ? "```text\n" + line + "\n```"
            : change === "outside"
              ? ""
              : line + "\n\n### Data residency pricing\n" + line;
      const parsed = await anthropicSource({
        overrides: {
          "/docs/en/about-claude/pricing.md":
            pricing.replace(line, replacement) +
            (change === "outside" ? "\n## Examples\n" + line : ""),
        },
      });
      const fable = parsed.models.find(({ model_id }) => model_id === "claude-fable-5");
      expect(fable?.price_facts.some((rate) => rate.conditions.inference_geo === "us")).toBe(false);
      expect(fable?.raw_price_facts).toContainEqual(
        expect.objectContaining({
          term_key: "unparsed:inference-geography",
          reason: "unknown_applicability",
        }),
      );
    },
  );
  it.each(["missing", "conflicting"])(
    "requires a coherent global base declaration (%s)",
    async (change) => {
      const pricing = (await fixture("anthropic/pricing.md")).replace(
        "Global routing (the default) uses standard pricing.",
        (change === "conflicting" ? "Global routing (the default) uses standard pricing. " : "") +
          "Global routing pricing is unresolved.",
      );
      const parsed = await anthropicSource({
        overrides: { "/docs/en/about-claude/pricing.md": pricing },
      });
      const fable = parsed.models.find(({ model_id }) => model_id === "claude-fable-5");
      expect(fable?.price_facts.some((rate) => rate.conditions.inference_geo !== undefined)).toBe(
        false,
      );
      expect(fable?.raw_price_facts).toContainEqual(
        expect.objectContaining({ term_key: "unparsed:inference-geography", conditions: {} }),
      );
    },
  );
  it("does not execute an inline-code declaration of the global base scope", async () => {
    const pricing = (await fixture("anthropic/pricing.md")).replace(
      "Global routing (the default) uses standard pricing.",
      "`Global routing (the default) uses standard pricing.`",
    );
    const parsed = await anthropicSource({
      overrides: { "/docs/en/about-claude/pricing.md": pricing },
    });
    const fable = parsed.models.find(({ model_id }) => model_id === "claude-fable-5");
    expect(fable?.price_facts.some((rate) => rate.conditions.inference_geo !== undefined)).toBe(
      false,
    );
  });
  it.each(["quoted", "fenced", "outside", "duplicate", "inline"])(
    "does not borrow %s model eligibility from the data-residency document",
    async (change) => {
      const residency = await fixture("anthropic/data-residency.md");
      const line = residency.split("\n").find((part) => part.includes("supported on Claude"));
      if (line === undefined) throw new Error("Missing native generation contract");
      const replacement =
        change === "quoted"
          ? "> " + line
          : change === "fenced"
            ? "```text\n" + line + "\n```"
            : change === "outside"
              ? ""
              : change === "inline"
                ? "Example: `" + line + "`"
                : line + "\n\n## Inference geo\n" + line;
      const parsed = await anthropicSource({
        overrides: {
          "/docs/en/manage-claude/data-residency.md":
            residency.replace(line, replacement) +
            (change === "outside" ? "\n## Workspace geo\n" + line : ""),
        },
      });
      const fable = parsed.models.find(({ model_id }) => model_id === "claude-fable-5");
      expect(fable?.price_facts.some((rate) => rate.conditions.inference_geo === "us")).toBe(false);
      expect(fable?.price_facts.every((rate) => rate.conditions.inference_geo === "global")).toBe(
        true,
      );
    },
  );
  it("retains an unreadable multiplier peer without selecting a readable one", async () => {
    const pricing = await fixture("anthropic/pricing.md");
    const line = pricing.split("\n").find((part) => part.startsWith("For Claude 4.6"));
    if (line === undefined) throw new Error("Missing native geography statement");
    const parsed = await anthropicSource({
      overrides: {
        "/docs/en/about-claude/pricing.md": pricing.replace(
          line,
          line + "\n\n" + line.replace("1.1x multiplier", "unknownx multiplier"),
        ),
      },
    });
    const fable = parsed.models.find(({ model_id }) => model_id === "claude-fable-5");
    expect(fable?.price_facts.some((rate) => rate.conditions.inference_geo === "us")).toBe(false);
    expect(fable?.raw_price_facts.some((rate) => rate.raw.fragment?.includes("unknownx"))).toBe(
      true,
    );
  });
  it("keeps a missing geography dependency distinct from a malformed native contract", async () => {
    const findings: PricingReconciliationItem[] = [];
    const parsed = await anthropicSource({
      omit: ["/docs/en/manage-claude/data-residency.md"],
      onPricingReconciliation: (item) => findings.push(item),
    });
    const fable = parsed.models.find(({ model_id }) => model_id === "claude-fable-5");
    expect(fable?.price_facts.every((rate) => rate.conditions.inference_geo === "global")).toBe(
      true,
    );
    expect(fable?.raw_price_facts).toContainEqual(
      expect.objectContaining({
        term_key: "unparsed:inference-geography",
        conditions: { inference_geo: "us" },
      }),
    );
    expect(findings.filter((item) => item.reason_code.startsWith("inference_geo"))).toEqual([]);
  });
  it.each(["9007199254740992.6", "many"])("rejects an unsafe generation %s", async (generation) => {
    const parsed = await anthropicSource({
      overrides: {
        "/docs/en/about-claude/pricing.md": (await fixture("anthropic/pricing.md")).replace(
          "4.6",
          generation,
        ),
        "/docs/en/manage-claude/data-residency.md": (
          await fixture("anthropic/data-residency.md")
        ).replace("4.6", generation),
      },
    });
    const fable = parsed.models.find(({ model_id }) => model_id === "claude-fable-5");
    expect(fable?.price_facts.some((rate) => rate.conditions.inference_geo === "us")).toBe(false);
    expect(
      fable?.raw_price_facts.some((rate) => rate.term_key === "unparsed:inference-geography"),
    ).toBe(true);
  });
  it("retains explicit native prompt bands across ordinary, cache, Batch and geography prices", async () => {
    const parsed = await anthropicContextPricing();
    const haiku = parsed.models.find(({ model_id }) => model_id === "claude-haiku-5-5");
    expect(haiku?.raw_price_facts).toEqual([]);
    expect(haiku?.price_facts).toHaveLength(40);
    expect(
      haiku?.price_facts
        .filter(
          ({ meter, conditions }) =>
            meter === "input_text" && conditions.inference_geo === "global",
        )
        .map(({ price, conditions }) => ({ price, conditions })),
    ).toEqual([
      {
        price: "0.10",
        conditions: { speed: "standard", context_max_tokens: 100_000, inference_geo: "global" },
      },
      {
        price: "0.50",
        conditions: { speed: "standard", context_min_tokens: 100_001, inference_geo: "global" },
      },
      {
        price: "0.05",
        conditions: { service_tier: "batch", context_max_tokens: 100_000, inference_geo: "global" },
      },
      {
        price: "0.25",
        conditions: { service_tier: "batch", context_min_tokens: 100_001, inference_geo: "global" },
      },
    ]);
    const partition = validatedPricing(parsed);
    for (const offerKey of ["sync", "batch"]) {
      const input = partition.books
        .find(({ book_key }) => book_key === "model:anthropic/claude-haiku-5-5")
        ?.offers.find(({ offer_key }) => offer_key === offerKey)
        ?.terms.find(({ term_key }) => term_key === "input_text");
      if (input?.kind !== "rate") throw new Error("Missing context-priced input term");
      expect(input.raw_variants).toEqual([]);
      for (const [context, denominator] of [
        [100_000, 10_000_000],
        [100_001, 2_000_000],
      ] as const) {
        const selected = input.variants.filter(
          ({ applicability }) =>
            evaluateApplicability(applicability, [
              {
                dimension: { namespace: "kmodels", value: "context_tokens" },
                kind: "decimal",
                value: String(context),
                unit: { factors: [{ unit: { namespace: "kmodels", value: "token" }, power: 1 }] },
              },
              ...(["speed", "inference_geo", "service_tier"] as const).map((dimension) => ({
                dimension: { namespace: "kmodels" as const, value: dimension },
                kind: "categorical" as const,
                value: {
                  namespace: "provider" as const,
                  provider_id: "anthropic",
                  value: dimension === "inference_geo" ? "global" : "standard",
                },
              })),
            ]).state === "true",
        );
        expect(selected).toHaveLength(1);
        expect(selected[0]?.price.value).toEqual({
          numerator: "1",
          denominator: String(denominator * (offerKey === "batch" ? 2 : 1)),
        });
      }
    }
  });

  it.each(["up to", "over"])(
    "keeps a source prompt band explicit when its peer is absent (%s)",
    async (band) => {
      const parsed = await anthropicContextPricing((body) =>
        body
          .split("\n")
          .filter((line) => !line.includes(`(for prompts ${band} `))
          .join("\n"),
      );
      const haiku = parsed.models.find(({ model_id }) => model_id === "claude-haiku-5-5");
      expect(haiku?.raw_price_facts).toEqual([]);
      expect(haiku?.price_facts).toHaveLength(20);
      expect(
        haiku?.price_facts.every(({ conditions }) =>
          band === "up to"
            ? conditions.context_min_tokens === 100_001 &&
              conditions.context_max_tokens === undefined
            : conditions.context_max_tokens === 100_000 &&
              conditions.context_min_tokens === undefined,
        ),
      ).toBe(true);
      validatedPricing(parsed);
    },
  );

  it.each(["100,00", "1e5", "100000.5", "-100000", "9007199254740992"])(
    "retains an invalid native prompt count as raw (%s)",
    async (count) => {
      const parsed = await anthropicContextPricing((body) => body.replaceAll("100,000", count));
      const haiku = parsed.models.find(({ model_id }) => model_id === "claude-haiku-5-5");
      expect(haiku?.price_facts).toEqual([]);
      expect(haiku?.raw_price_facts).toHaveLength(14);
      expect(haiku?.raw_price_facts.every(({ reason }) => reason === "unknown_applicability")).toBe(
        true,
      );
      validatedPricing(parsed);
    },
  );

  it.each([
    "(for prompts up to 100,000 tokens) (for prompts over 200,000 tokens)",
    "(for prompts up to 100,000 tokens) (for prompts up to 100,000 tokens)",
    "(for prompts up to 100,000 tokens) (unknown condition)",
  ])("retains ambiguous native prompt qualifiers locally (%s)", async (qualifier) => {
    const parsed = await anthropicContextPricing((body) =>
      body.replaceAll("(for prompts up to 100,000 tokens)", qualifier),
    );
    const haiku = parsed.models.find(({ model_id }) => model_id === "claude-haiku-5-5");
    expect(haiku?.price_facts).toHaveLength(20);
    expect(
      haiku?.price_facts.every(({ conditions }) => conditions.context_min_tokens === 100_001),
    ).toBe(true);
    expect(haiku?.raw_price_facts).toHaveLength(7);
    expect(haiku?.raw_price_facts.every(({ reason }) => reason === "unknown_applicability")).toBe(
      true,
    );
    validatedPricing(parsed);
  });

  it("does not overflow an exclusive native prompt threshold", async () => {
    const parsed = await anthropicContextPricing((body) =>
      body.replaceAll(
        "for prompts over 100,000 tokens",
        "for prompts over 9,007,199,254,740,991 tokens",
      ),
    );
    const haiku = parsed.models.find(({ model_id }) => model_id === "claude-haiku-5-5");
    expect(haiku?.price_facts).toHaveLength(20);
    expect(
      haiku?.price_facts.every(({ conditions }) => conditions.context_max_tokens === 100_000),
    ).toBe(true);
    expect(haiku?.raw_price_facts).toHaveLength(7);
    validatedPricing(parsed);
  });

  it("retains dated validity together with an explicit native prompt band", async () => {
    const parsed = await anthropicContextPricing((body) =>
      body.replaceAll(
        "(for prompts over 100,000 tokens)",
        "(for prompts over 100,000 tokens) through August 31, 2026",
      ),
    );
    const haiku = parsed.models.find(({ model_id }) => model_id === "claude-haiku-5-5");
    expect(haiku?.raw_price_facts).toEqual([]);
    expect(haiku?.price_facts).toHaveLength(40);
    expect(
      haiku?.price_facts
        .filter(({ conditions }) => conditions.context_min_tokens === 100_001)
        .every(
          ({ conditions }) =>
            conditions.effective_until === "2026-08-31" && conditions.promotion === true,
        ),
    ).toBe(true);
    validatedPricing(parsed);
  });

  it.each([false, true])(
    "establishes ordinary speed from the native price matrix independently of Fast rows (%s)",
    async (omitFastRows) => {
      const pricing = await fixture("anthropic/pricing.md");
      const withoutFast = pricing.replace(
        /\| Model\s+\| Input\s+\| Output\s+\|\n\|[^\n]+\n\|[^\n]+\n/,
        "",
      );
      if (withoutFast === pricing) throw new Error("Missing Fast price fixture");
      const source = await anthropicSource({
        overrides: {
          "/docs/en/about-claude/pricing.md": omitFastRows ? withoutFast : pricing,
        },
      });
      const ordinary = source.models.find(
        ({ model_id }) => model_id === "claude-fable-5",
      )?.price_facts;
      expect(ordinary?.length).toBeGreaterThan(0);
      expect(
        ordinary?.every(({ conditions }) =>
          conditions.service_tier === "batch"
            ? conditions.speed === undefined
            : conditions.speed === "standard",
        ),
      ).toBe(true);
      const opus = source.models.find(({ model_id }) => model_id === "claude-opus-4-8");
      expect(opus?.price_facts.filter(({ conditions }) => conditions.speed === "fast").length).toBe(
        omitFastRows ? 0 : 10,
      );
      const rates = source.models.flatMap(({ price_facts }) => price_facts);
      expect(
        rates.every(
          ({ conditions }) => conditions.service_tier === "batch" || conditions.speed !== undefined,
        ),
      ).toBe(true);
      const partition = validatedPricing(source);
      const batchInput = partition.books
        .find(({ book_key }) => book_key === "model:anthropic/claude-fable-5")
        ?.offers.find(({ offer_key }) => offer_key === "batch")
        ?.terms.find(({ term_key }) => term_key === "input_text");
      if (batchInput?.kind !== "rate") throw new Error("Missing Batch input rate");
      expect(
        batchInput.variants.some(
          ({ applicability }) =>
            evaluateApplicability(applicability, [
              {
                dimension: { namespace: "kmodels", value: "inference_geo" },
                kind: "categorical",
                value: { namespace: "provider", provider_id: "anthropic", value: "global" },
              },
            ]).state === "true",
        ),
      ).toBe(true);
    },
  );

  it("extracts execution minimums and allowances as typed source facts", async () => {
    const parsed = await anthropicSource();
    const standalone = parsed.commercial_facts?.find(
      ({ resource_key, offer_key }) =>
        resource_key === "code-execution" && offer_key === "standalone",
    );
    expect(
      standalone?.price_facts[0]?.charge_binding?.quantity_methods?.[0]?.calculation,
    ).toMatchObject({
      nodes: [
        { op: "signal" },
        { op: "minimum", input: 0, value: { numerator: "300", denominator: "1" } },
      ],
      result: 1,
    });
    expect(
      standalone?.terms?.find((term) => term.kind === "allowance")?.variants[0]?.benefit,
    ).toMatchObject({
      kind: "quantity",
      quantity: { value: { numerator: "5580000", denominator: "1" } },
    });
    expect(standalone?.raw_price_facts).toEqual([]);
    if (standalone === undefined) throw new Error("Missing standalone execution fact");
    standalone.raw_price_facts.push({
      term_key: "minimum-runtime",
      impact: "informational",
      reason: "unsupported_structure",
      conditions: {},
      source_ref: standalone.source_ref,
      raw: { fragment: "999-minute minimum execution time" },
    });
    const partition = validatedPricing(parsed);
    const rate = partition.books
      .find(({ book_key }) => book_key === "service:code-execution")
      ?.offers.find(({ offer_key }) => offer_key === "standalone")
      ?.terms.find(({ kind }) => kind === "rate");
    const binding = rate?.kind === "rate" ? rate.variants[0]?.charge_binding : undefined;
    if (binding === undefined) throw new Error("Missing typed execution calculation");
    expect(
      evaluateChargeQuantity(binding, [
        {
          signal: {
            namespace: "provider",
            provider_id: "anthropic",
            value: "code_execution_active_seconds",
          },
          value: { numerator: "1", denominator: "1" },
        },
      ]),
    ).toEqual({ kind: "resolved", value: { numerator: "300", denominator: "1" } });
  });

  it("binds a named cache override to an exact ID without renaming the catalog model", async () => {
    const pricing =
      (await fixture("anthropic/pricing.md")).replace(
        /0\.1x base input price\s*\|/,
        "0.1x base input price (0.05x on Claude Opus 4.1) |",
      ) +
      "\n| Model | Batch Input | Batch Output |\n| --- | --- | --- |\n| claude-opus-4-1-20250805 | $2.50 / MTok | $12.50 / MTok |\n";
    const modelsSource = await anthropicSource({
      overrides: { "/docs/en/about-claude/pricing.md": pricing },
    });
    const models = modelsSource.models;
    validatedPricing(modelsSource);
    const opus = models.find(({ model_id }) => model_id === "claude-opus-4-1-20250805");
    expect(opus?.name).toBe("claude-opus-4-1-20250805");
    expect(opus?.price_facts).toContainEqual(
      expect.objectContaining({
        meter: "cache_read_text",
        price: "0.125",
        conditions: { service_tier: "batch" },
      }),
    );
  });

  it("does not discard an unbound cache exception and derive the default read rate", async () => {
    const pricing = (await fixture("anthropic/pricing.md")).replace(
      /0\.1x base input price\s*\|/,
      "0.1x base input price (0.05x on Claude Unknown 5) |",
    );
    const modelsSource = await anthropicSource({
      overrides: { "/docs/en/about-claude/pricing.md": pricing },
    });
    const models = modelsSource.models;
    validatedPricing(modelsSource);
    const fable = models.find(({ model_id }) => model_id === "claude-fable-5");
    expect(
      fable?.price_facts.some(
        ({ meter, conditions }) =>
          meter === "cache_read_text" && conditions.service_tier === "batch",
      ),
    ).toBe(false);
    expect(
      fable?.raw_price_facts.some(({ raw }) => raw.fragment?.includes("Claude Unknown 5")),
    ).toBe(true);
    expect(fable?.price_facts).toContainEqual(
      expect.objectContaining({
        meter: "cache_write_text",
        price: "10",
        conditions: { service_tier: "batch", cache_ttl_seconds: 3600, inference_geo: "global" },
      }),
    );
  });

  it.each([
    ["Claude Willow Latest", "claude-willow-latest", undefined],
    ["Claude Willow Plus 5", "claude-willow-plus-5", "11"],
  ])("keeps generation eligibility separate from family naming (%s)", async (name, id, usPrice) => {
    const overview =
      (await fixture("anthropic/overview.md")) +
      `\n| Feature | ${name} |\n| --- | --- |\n| Claude API ID | ${id} |\n`;
    const pricing =
      (await fixture("anthropic/pricing.md")) +
      `\n| Model | Base Input Tokens | 5m Cache Writes | 1h Cache Writes | Cache Hits & Refreshes | Output Tokens |\n| --- | --- | --- | --- | --- | --- |\n| ${name} | $10 / MTok | $12.5 / MTok | $20 / MTok | $1 / MTok | $50 / MTok |\n`;
    const modelsSource = await anthropicSource({
      overview,
      overrides: { "/docs/en/about-claude/pricing.md": pricing },
    });
    const models = modelsSource.models;
    validatedPricing(modelsSource);
    const item = models.find(({ model_id }) => model_id === id);
    expect(
      item?.price_facts.find(
        ({ meter, conditions }) => meter === "input_text" && conditions.inference_geo === "us",
      )?.price,
    ).toBe(usPrice);
    if (usPrice === undefined) {
      expect(
        item?.price_facts.every(({ conditions }) => conditions.inference_geo === "global"),
      ).toBe(true);
      expect(item?.raw_price_facts).toContainEqual(
        expect.objectContaining({
          impact: "base_price",
          reason: "unknown_applicability",
          conditions: { inference_geo: "us" },
        }),
      );
    }
  });

  it("keeps overview metadata conflicts distinct from later matching observations", async () => {
    const overview =
      (await fixture("anthropic/overview.md")) +
      [
        ["Claude Other 5 (deprecated)", "Different description", "No"],
        ["Claude Fable 5", "Long-running agents", "Yes"],
      ]
        .map(
          ([name, description, thinking]) =>
            `\n| Feature | ${name} |\n| --- | --- |\n| Claude API ID | claude-fable-5 |\n| Description | ${description} |\n| Thinking | ${thinking} |\n`,
        )
        .join("");
    const models = await anthropicCatalog({
      overview,
      omit: ["/docs/en/about-claude/model-deprecations.md"],
      overrides: {
        "/docs/en/build-with-claude/thinking.md": "# Unreviewed thinking contract",
        "/docs/en/build-with-claude/thinking-troubleshooting.md": "# Unreviewed thinking contract",
      },
    });
    const fable = models.find(({ model_id }) => model_id === "claude-fable-5");
    expect(fable?.name).toBe("claude-fable-5");
    expect(fable?.description).toBeUndefined();
    expect(fable?.status).toBe("unknown");
    expect(fable?.capabilities.reasoning).toBe("unknown");
  });

  it("preserves explicit lifecycle state conflicts across multiple current tables", async () => {
    const lifecycle =
      (await fixture("anthropic/lifecycle.md")) +
      "\n| API model name | Current state | Deprecated | Tentative retirement date |\n| --- | --- | --- | --- |\n" +
      "| claude-fable-5 | Deprecated | N/A | N/A |\n| claude-fable-5 | Active | N/A | N/A |\n";
    const models = await anthropicCatalog({
      overrides: { "/docs/en/about-claude/model-deprecations.md": lifecycle },
    });
    const fable = models.find(({ model_id }) => model_id === "claude-fable-5");
    expect(fable?.status).toBe("unknown");
    expect(fable?.api_endpoints).toBeUndefined();
  });

  it("does not carry a release date across a different section", async () => {
    const overview =
      (await fixture("anthropic/overview.md")) +
      "\n| Feature | Claude Willow 6 |\n| --- | --- |\n| Claude API ID | claude-willow-6 |\n";
    const releases =
      "### July 1, 2026\n\n## Unrelated section\n\n- We've launched **Claude Willow 6** (`claude-willow-6`), a new model.\n";
    const models = await anthropicCatalog({
      overview,
      overrides: { "/docs/en/release-notes/overview.md": releases },
    });
    expect(
      models.find(({ model_id }) => model_id === "claude-willow-6")?.release_date,
    ).toBeUndefined();
  });

  it("keeps known limits across a repeated partial overview", async () => {
    const overview =
      (await fixture("anthropic/overview.md")) +
      "\n| Feature | Claude Fable 5 |\n| --- | --- |\n| Claude API ID | claude-fable-5 |\n";
    const models = await anthropicCatalog({ overview });
    expect(models.find(({ model_id }) => model_id === "claude-fable-5")?.limits).toEqual({
      context_tokens: 1_000_000,
      max_output_tokens: 128_000,
    });
  });

  it.each([
    ["64k", "128k"],
    ["128k", "64k"],
  ])(
    "withholds contradictory overview limits across three peers (%s, %s)",
    async (first, second) => {
      const overview =
        (await fixture("anthropic/overview.md")) +
        [first, second]
          .map(
            (limit) =>
              `\n| Feature | Claude Fable 5 |\n| --- | --- |\n| Claude API ID | claude-fable-5 |\n| Max output | ${limit} tokens |\n`,
          )
          .join("");
      const models = await anthropicCatalog({ overview });
      const limits = models.find(({ model_id }) => model_id === "claude-fable-5")?.limits;
      expect(limits?.max_output_tokens).toBeUndefined();
      expect(limits?.context_tokens).toBe(1_000_000);
    },
  );

  it("prefers an exact API ID over a colliding normalized display name", async () => {
    const overview =
      (await fixture("anthropic/overview.md")) +
      "\n| Feature | Claude Fable 5 |\n| --- | --- |\n| Claude API ID | claude-fable-5-20260701 |\n";
    const pricing = (await fixture("anthropic/pricing.md")).replace(
      "Claude Fable 5",
      "claude-fable-5",
    );
    const models = await anthropicCatalog({
      overview,
      overrides: { "/docs/en/about-claude/pricing.md": pricing },
    });
    expect(
      models.find(({ model_id }) => model_id === "claude-fable-5")?.price_facts,
    ).toContainEqual(
      expect.objectContaining({
        meter: "input_text",
        price: "10",
        conditions: { speed: "standard", inference_geo: "global" },
      }),
    );
    expect(
      models.find(({ model_id }) => model_id === "claude-fable-5-20260701")?.price_facts,
    ).toEqual([]);
  });

  it.each(["Claude 5 Fable", "claude-fable-5-20260101"])(
    "does not infer a price binding from rearranged tokens or an unknown revision (%s)",
    async (name) => {
      const pricing = (await fixture("anthropic/pricing.md")).replace("Claude Fable 5", name);
      const failures: string[] = [];
      const models = await anthropicCatalog({
        overrides: { "/docs/en/about-claude/pricing.md": pricing },
        onPricingDependencyFailure: (url) => failures.push(url),
      });
      expect(
        models
          .find(({ model_id }) => model_id === "claude-fable-5")
          ?.price_facts.some(
            ({ meter, conditions }) =>
              meter === "input_text" && conditions.service_tier === undefined,
          ),
      ).toBe(false);
      expect(failures).toContain("https://platform.claude.com/docs/en/about-claude/pricing.md");
    },
  );

  it.each(["### 2026-02-30: invalid announcement", "## A different section"])(
    "does not acquire a historical deprecation date from an invalid or unowned heading (%s)",
    async (heading) => {
      const lifecycle = (await fixture("anthropic/lifecycle.md"))
        .replace("### 2026-06-05: Claude Opus 4.1 model", heading)
        .replace("June 5, 2026", "N/A");
      const models = await anthropicCatalog({
        overrides: { "/docs/en/about-claude/model-deprecations.md": lifecycle },
      });
      const opus = models.find(({ model_id }) => model_id === "claude-opus-4-1-20250805");
      expect(opus?.deprecated_at).toBeUndefined();
      expect(opus?.retired_at).toBe("2026-08-05");
      expect(opus?.replacement_model_ids).toEqual(["claude-opus-4-8"]);
    },
  );

  it("does not inherit a historical date across a later section heading", async () => {
    const lifecycle = (await fixture("anthropic/lifecycle.md"))
      .replace(
        "### 2026-06-05: Claude Opus 4.1 model",
        "### 2026-06-05: Earlier announcement\n\n## Unrelated section",
      )
      .replace("June 5, 2026", "N/A");
    const models = await anthropicCatalog({
      overrides: { "/docs/en/about-claude/model-deprecations.md": lifecycle },
    });
    expect(
      models.find(({ model_id }) => model_id === "claude-opus-4-1-20250805")?.deprecated_at,
    ).toBeUndefined();
  });

  it("retains conflicts across three lifecycle date observations", async () => {
    const lifecycle = (await fixture("anthropic/lifecycle.md"))
      .replace(
        "### 2026-06-05: Claude Opus 4.1 model",
        "| claude-opus-4-1-20250805 | Deprecated | June 6, 2026 | August 6, 2026 |\n" +
          "| claude-opus-4-1-20250805 | Deprecated | June 5, 2026 | August 5, 2026 |\n\n" +
          "### 2026-06-05: Claude Opus 4.1 model",
      )
      .replace(/\n\n\| claude-opus/, "\n| claude-opus");
    const models = await anthropicCatalog({
      overrides: { "/docs/en/about-claude/model-deprecations.md": lifecycle },
    });
    const opus = models.find(({ model_id }) => model_id === "claude-opus-4-1-20250805");
    expect(opus?.deprecated_at).toBeUndefined();
    expect(opus?.retired_at).toBeUndefined();
    expect(opus?.status).toBe("deprecated");
  });

  it("admits release evidence for a newly named official family", async () => {
    const overview =
      (await fixture("anthropic/overview.md")) +
      "\n| Feature | Claude Willow 6 |\n| --- | --- |\n| Claude API ID | claude-willow-6 |\n";
    const releases =
      "### July 1, 2026\n\n- We've launched **Claude Willow 6** (`claude-willow-6`), a new model.\n";
    const models = await anthropicCatalog({
      overview,
      overrides: { "/docs/en/release-notes/overview.md": releases },
    });
    expect(models.find(({ model_id }) => model_id === "claude-willow-6")?.release_date).toBe(
      "2026-07-01",
    );
  });

  it("does not apply a longer model name's context claim to a prefix model", async () => {
    const overview =
      (await fixture("anthropic/overview.md")).replace(
        /\| \*\*Context window\*\*[^\n]*\n/,
        "| **Context window** | 1M tokens | 1M tokens | 200k tokens |\n",
      ) +
      "\n| Feature | Claude Sonnet 5.1 |\n| --- | --- |\n| Claude API ID | claude-sonnet-5-1 |\n";
    const pricing = (await fixture("anthropic/pricing.md")).replace(
      "and Sonnet 5 include the full",
      "and Sonnet 5.1 include the full",
    );
    const models = await anthropicCatalog({
      overview,
      overrides: { "/docs/en/about-claude/pricing.md": pricing },
    });
    expect(
      models.find(({ model_id }) => model_id === "claude-sonnet-5")?.limits.context_tokens,
    ).toBe(200_000);
    expect(
      models.find(({ model_id }) => model_id === "claude-sonnet-5-1")?.limits.context_tokens,
    ).toBe(1_000_000);
  });

  it("keeps catalog and usage diagnostics outside pricing-row accounting", async () => {
    const normal: PricingReconciliationItem[] = [],
      partial: PricingReconciliationItem[] = [];
    const findings: SourceContractEvidence[] = [];
    await anthropicCatalog({ onPricingReconciliation: (item) => normal.push(item) });
    const body = (await fixture("anthropic/messages.md")).replace(
      "output_tokens: number",
      "output_tokens: string",
    );
    const lifecycle = (await fixture("anthropic/lifecycle.md")).replace(
      "August 5, 2026",
      "February 30, 2026",
    );
    await anthropicCatalog({
      overrides: {
        "/docs/en/api/messages/create.md": body,
        "/docs/en/about-claude/model-deprecations.md": lifecycle,
      },
      onPricingReconciliation: (item) => partial.push(item),
      onContractFinding: (finding) => findings.push(finding),
    });
    expect(partial).toEqual(normal);
    expect(findings.flatMap(({ diagnostics }) => diagnostics.map(({ path }) => path))).toEqual(
      expect.arrayContaining([
        expect.stringContaining("accounting_contract_drift"),
        expect.stringContaining("lifecycle_date_invalid"),
      ]),
    );
  });

  it("keeps the pricing-row denominator stable for an unreadable monetary cell", async () => {
    const normal: PricingReconciliationItem[] = [],
      partial: PricingReconciliationItem[] = [];
    const pricing = await fixture("anthropic/pricing.md");
    await anthropicCatalog({ onPricingReconciliation: (item) => normal.push(item) });
    await anthropicCatalog({
      overrides: {
        "/docs/en/about-claude/pricing.md": pricing.replace("$12.50 / MTok", "EUR 12.50 / MTok"),
      },
      onPricingReconciliation: (item) => partial.push(item),
    });
    expect(partial).toHaveLength(normal.length);
    expect(partial).toContainEqual(
      expect.objectContaining({ disposition: "raw", reason_code: "pricing_row_preserved_raw" }),
    );
  });

  it("withholds a conflicting cache rule while retaining independent factors", async () => {
    const pricing = await fixture("anthropic/pricing.md");
    const table = pricing.match(/\| Cache operation[^\n]*\n[\s\S]*?\| Cache read[^\n]*/)?.[0];
    if (table === undefined) throw new Error("Missing cache policy fixture");
    const modelsSource = await anthropicSource({
      overrides: {
        "/docs/en/about-claude/pricing.md": pricing + "\n" + table.replace("1.25x", "1.5x"),
      },
    });
    const models = modelsSource.models;
    validatedPricing(modelsSource);
    const fable = models.find(({ model_id }) => model_id === "claude-fable-5");
    expect(
      fable?.price_facts.some(
        ({ meter, conditions }) =>
          meter === "cache_write_text" &&
          conditions.service_tier === "batch" &&
          conditions.cache_ttl_seconds === 300,
      ),
    ).toBe(false);
    expect(fable?.price_facts).toContainEqual(
      expect.objectContaining({
        meter: "cache_write_text",
        price: "10",
        conditions: { service_tier: "batch", cache_ttl_seconds: 3600, inference_geo: "global" },
      }),
    );
    expect(fable?.raw_price_facts.some(({ raw }) => raw.fragment?.includes("1.5x"))).toBe(true);
  });

  it("preserves an unreviewed cache operation as a raw tariff", async () => {
    const pricing = (await fixture("anthropic/pricing.md")).replace(
      /(\| Cache read[^\n]*)(\n)/,
      "$1\n| 2-hour cache write | 3x base input price | Cache valid for 2 hours |$2",
    );
    const modelsSource = await anthropicSource({
      overrides: { "/docs/en/about-claude/pricing.md": pricing },
    });
    const models = modelsSource.models;
    validatedPricing(modelsSource);
    expect(
      models.find(({ model_id }) => model_id === "claude-fable-5")?.raw_price_facts,
    ).toContainEqual(
      expect.objectContaining({
        impact: "base_price",
        raw: expect.objectContaining({ fragment: expect.stringContaining("2-hour cache write") }),
      }),
    );
  });

  it("preserves malformed cache policy rows alongside independent factors", async () => {
    const pricing = (await fixture("anthropic/pricing.md")).replace(
      "1.25x base input price",
      "unreviewed factor | extra policy cell",
    );
    const modelsSource = await anthropicSource({
      overrides: { "/docs/en/about-claude/pricing.md": pricing },
    });
    const models = modelsSource.models;
    validatedPricing(modelsSource);
    const fable = models.find(({ model_id }) => model_id === "claude-fable-5");
    expect(fable?.raw_price_facts).toContainEqual(
      expect.objectContaining({
        conditions: { service_tier: "batch" },
        raw: expect.objectContaining({ fragment: expect.stringContaining("extra policy cell") }),
      }),
    );
    expect(fable?.price_facts).toContainEqual(
      expect.objectContaining({
        meter: "cache_read_text",
        price: "0.5",
        conditions: { service_tier: "batch", inference_geo: "global" },
      }),
    );
  });

  it("keeps known columns if the input column becomes unreviewed", async () => {
    const pricing = (await fixture("anthropic/pricing.md")).replace(
      "Base Input Tokens",
      "Unreviewed Input",
    );
    const modelsSource = await anthropicSource({
      overrides: { "/docs/en/about-claude/pricing.md": pricing },
    });
    const models = modelsSource.models;
    validatedPricing(modelsSource);
    expect(
      models.find(({ model_id }) => model_id === "claude-fable-5")?.price_facts,
    ).toContainEqual(
      expect.objectContaining({
        meter: "output_text",
        price: "50",
        conditions: { speed: "standard", inference_geo: "global" },
      }),
    );
  });

  it("signals an unbound price row without discarding independent catalog facts", async () => {
    const pricing = (await fixture("anthropic/pricing.md")).replace(
      "Claude Fable 5",
      "Unreviewed Fable Alias",
    );
    const failures: string[] = [];
    const models = await anthropicCatalog({
      overrides: { "/docs/en/about-claude/pricing.md": pricing },
      onPricingDependencyFailure: (url) => failures.push(url),
    });
    expect(failures).toContain("https://platform.claude.com/docs/en/about-claude/pricing.md");
    expect(
      models.find(({ model_id }) => model_id === "claude-fable-5")?.limits.context_tokens,
    ).toBe(1000000);
  });
  it.each(["$1*0 / MTok", "`$1**0** / MTok`"])(
    "does not turn a literal price expression into a scalar (%s)",
    async (quote) => {
      const pricing = (await fixture("anthropic/pricing.md")).replace("$10 / MTok", quote);
      const modelsSource = await anthropicSource({
        overrides: { "/docs/en/about-claude/pricing.md": pricing },
      });
      const models = modelsSource.models;
      validatedPricing(modelsSource);
      const fable = models.find(({ model_id }) => model_id === "claude-fable-5");
      expect(
        fable?.price_facts.some(
          ({ meter, conditions }) =>
            meter === "input_text" && conditions.service_tier === undefined,
        ),
      ).toBe(false);
      expect(fable?.raw_price_facts).toContainEqual(
        expect.objectContaining({
          raw: expect.objectContaining({ amount: quote.replaceAll("`", "") }),
        }),
      );
    },
  );
  it("binds Fast pricing to the returned speed outcome", async () => {
    const modelsSource = await anthropicSource();
    const partition = validatedPricing(modelsSource);
    const offer = partition.books
      .find(({ book_key }) => book_key === "model:anthropic/claude-opus-4-8")
      ?.offers.find(({ offer_key }) => offer_key === "sync");
    const input = offer?.terms.find(
      (term) => term.kind === "rate" && term.meter.value === "input_text",
    );
    if (input?.kind !== "rate") throw new Error("Missing input price");
    expect(input.variants.flatMap(({ selector_sources }) => selector_sources ?? [])).toContainEqual(
      expect.objectContaining({
        dimension: { namespace: "kmodels", value: "speed" },
        channel: "response",
        locator: { kind: "json_pointer", value: "/usage/speed" },
      }),
    );
  });

  it("keeps Fast prices when only the response speed mapping drifts", async () => {
    const body = (await fixture("anthropic/messages.md")).replace(
      'speed: "standard" or "fast" or null',
      "speed: number",
    );
    const modelsSource = await anthropicSource({
      overrides: { "/docs/en/api/messages/create.md": body },
    });
    validatedPricing(modelsSource);
    expect(
      (modelsSource.pricing_inputs ?? []).some(
        ({ key }) => key === "messages.usage.selector.speed",
      ),
    ).toBe(false);
    expect(
      modelsSource.models
        .find(({ model_id }) => model_id === "claude-opus-4-8")
        ?.price_facts.some(({ conditions }) => conditions.speed === "fast"),
    ).toBe(true);
  });
  it("does not price services from examples outside their pricing section", async () => {
    const web = (await fixture("anthropic/web-search-tool.md")).replace(
      "## Usage and pricing",
      "An example quote is $999 per 1,000 searches.\n\n## Usage and pricing",
    );
    const code = (await fixture("anthropic/code-execution-tool.md")).replace(
      "## Usage and pricing",
      "An example rate is $999 USD per hour, per container.\n\n## Usage and pricing",
    );
    const modelsSource = await anthropicSource({
      overrides: {
        "/docs/en/agents-and-tools/tool-use/web-search-tool.md": web,
        "/docs/en/agents-and-tools/tool-use/code-execution-tool.md": code,
      },
    });
    validatedPricing(modelsSource);
    const facts = modelsSource.commercial_facts ?? [];
    expect(
      facts.find(({ resource_key }) => resource_key === "web-search")?.price_facts[0]?.price,
    ).toBe("10");
    expect(
      facts.find(
        ({ resource_key, offer_key }) =>
          resource_key === "code-execution" && offer_key === "standalone",
      )?.price_facts[0]?.price,
    ).toBe("0.05");
  });

  it("preserves conflicting search rate declarations without choosing the first", async () => {
    const web =
      (await fixture("anthropic/web-search-tool.md")) + "\nThe price is $20 per 1,000 searches.\n";
    const modelsSource = await anthropicSource({
      overrides: { "/docs/en/agents-and-tools/tool-use/web-search-tool.md": web },
    });
    validatedPricing(modelsSource);
    const service = (modelsSource.commercial_facts ?? []).find(
      ({ resource_key }) => resource_key === "web-search",
    );
    expect(service?.price_facts).toEqual([]);
    expect(service?.raw_price_facts).toContainEqual(
      expect.objectContaining({
        raw: expect.objectContaining({
          fragment: expect.stringContaining("$20 per 1,000 searches"),
        }),
      }),
    );
  });
  it.each([
    [
      "/docs/en/agents-and-tools/tool-use/web-search-tool.md",
      "anthropic/web-search-tool.md",
      "$10 per 1,000 searches",
      "EUR 10 per 1,000 searches",
      "web-search",
    ],
    [
      "/docs/en/agents-and-tools/tool-use/code-execution-tool.md",
      "anthropic/code-execution-tool.md",
      "$0.05 USD per hour",
      "EUR 0.05 per hour",
      "code-execution",
    ],
  ])("preserves an unreadable service quote (%s)", async (path, file, before, after, resource) => {
    const body = (await fixture(file)).replace(before, after);
    const modelsSource = await anthropicSource({ overrides: { [path]: body } });
    const partition = validatedPricing(modelsSource);
    const book = partition.books.find(
      ({ scope }) => scope.kind === "provider_resource" && scope.resource_key === resource,
    );
    expect(book).toBeDefined();
    expect(
      (modelsSource.commercial_facts ?? [])
        .filter(({ resource_key }) => resource_key === resource)
        .flatMap(({ raw_price_facts }) => raw_price_facts),
    ).toContainEqual(
      expect.objectContaining({
        impact: "base_price",
        raw: expect.objectContaining({ fragment: expect.stringContaining(after) }),
      }),
    );
  });

  it("rejects malformed allowance grouping instead of turning it into a numeric benefit", async () => {
    const path = "/docs/en/agents-and-tools/tool-use/code-execution-tool.md";
    const body = (await fixture("anthropic/code-execution-tool.md")).replace(
      "1,550 free hours",
      "1,55,0 free hours",
    );
    const modelsSource = await anthropicSource({ overrides: { [path]: body } });
    const partition = validatedPricing(modelsSource);
    const book = partition.books.find(
      ({ scope }) => scope.kind === "provider_resource" && scope.resource_key === "code-execution",
    );
    expect(
      book?.offers.flatMap(({ terms }) => terms).some(({ kind }) => kind === "allowance"),
    ).toBe(false);
    expect(
      book?.offers
        .flatMap(({ terms }) => terms)
        .filter((term) => term.kind === "raw")
        .flatMap(({ variants }) => variants)
        .some(({ observations }) =>
          observations.some(({ raw }) => raw.fragment?.includes("1,55,0 free hours")),
        ),
    ).toBe(true);
  });

  it.each([
    ["Execution time has a minimum of 10 minutes", "unparsed:minimum-runtime"],
    [
      "Each organization receives 2,000 free hours of usage per month",
      "unparsed:monthly-container-allowance",
    ],
  ])("preserves conflicting Code Execution rules (%s)", async (claim, termKey) => {
    const body = (await fixture("anthropic/code-execution-tool.md")) + `\n${claim}\n`;
    const modelsSource = await anthropicSource({
      overrides: { "/docs/en/agents-and-tools/tool-use/code-execution-tool.md": body },
    });
    const partition = validatedPricing(modelsSource);
    const offer = partition.books
      .find(
        ({ scope }) =>
          scope.kind === "provider_resource" && scope.resource_key === "code-execution",
      )
      ?.offers.find(({ offer_key }) => offer_key === "standalone");
    expect(offer?.terms).toContainEqual(
      expect.objectContaining({ kind: "raw", term_key: termKey }),
    );
    const fact = (modelsSource.commercial_facts ?? []).find(
      ({ resource_key, offer_key }) =>
        resource_key === "code-execution" && offer_key === "standalone",
    );
    expect(fact?.raw_price_facts.some(({ raw }) => raw.fragment?.includes(claim))).toBe(true);
  });

  it("reports unrepresentable service scope as a commercial dependency failure while retaining the catalog", async () => {
    const path = "/docs/en/agents-and-tools/tool-use/code-execution-tool.md";
    const body = (await fixture("anthropic/code-execution-tool.md")).replace(
      /\| Claude[^\n]+/g,
      "",
    );
    const failures: string[] = [];
    const models = await anthropicCatalog({
      overrides: { [path]: body },
      onPricingDependencyFailure: (url) => failures.push(url),
    });
    expect(
      models.find(({ model_id }) => model_id === "claude-fable-5")?.limits.context_tokens,
    ).toBe(1000000);
    expect(failures).toContain("https://platform.claude.com" + path);
  });
  it("does not reuse the global price for US inference when the multiplier is unreadable", async () => {
    const pricing = (await fixture("anthropic/pricing.md")).replace(
      "1.1x multiplier",
      "an unreviewed multiplier",
    );
    const findings: PricingReconciliationItem[] = [];
    const modelsSource = await anthropicSource({
      overrides: { "/docs/en/about-claude/pricing.md": pricing },
      onPricingReconciliation: (item) => findings.push(item),
    });
    const models = modelsSource.models;
    validatedPricing(modelsSource);
    const fable = models.find(({ model_id }) => model_id === "claude-fable-5");
    expect(
      fable?.price_facts.every(({ conditions }) => conditions.inference_geo === "global"),
    ).toBe(true);
    expect(fable?.raw_price_facts).toContainEqual(
      expect.objectContaining({
        conditions: { inference_geo: "us" },
        impact: "base_price",
        raw: expect.objectContaining({
          fragment: expect.stringContaining("unreviewed multiplier"),
        }),
      }),
    );
    const source = manifest("anthropic").sources[0];
    if (source === undefined) throw new Error("Missing Anthropic source");
    expect(
      catalogRepairCandidates({
        schema_version: 2,
        generated_at: observedAt,
        providers: [
          {
            provider_id: "anthropic",
            signals: [],
            attempt: {
              outcome: "accepted",
              sources: [
                {
                  source_id: source.id,
                  outcome: "unchanged",
                  content_changed: false,
                  pricing_reconciliation: sourcePricingReconciliation(models, findings, true),
                },
              ],
            },
          },
        ],
      }),
    ).toContainEqual(
      expect.objectContaining({
        source_id: source.id,
        trigger: "source_pricing_structure",
        message: expect.stringContaining("inference_geo_multiplier_drift"),
      }),
    );
  });

  it("does not choose the first of conflicting geography multipliers", async () => {
    const pricing = await fixture("anthropic/pricing.md");
    const line = pricing.split("\n").find((line) => line.includes("1.1x multiplier"));
    if (line === undefined) throw new Error("Missing geo fixture");
    const modelsSource = await anthropicSource({
      overrides: {
        "/docs/en/about-claude/pricing.md": pricing.replace(
          line,
          line + "\n\n" + line.replace("1.1x", "1.2x"),
        ),
      },
    });
    const models = modelsSource.models;
    validatedPricing(modelsSource);
    expect(
      models
        .find(({ model_id }) => model_id === "claude-fable-5")
        ?.price_facts.some(({ conditions }) => conditions.inference_geo === "us"),
    ).toBe(false);
  });
  it("cannot dismiss an unreadable 5m price by selecting a different global cache TTL", async () => {
    const pricing = (await fixture("anthropic/pricing.md")).replace(
      "$12.50 / MTok",
      "EUR 12.50 / MTok",
    );
    const modelsSource = await anthropicSource({
      overrides: { "/docs/en/about-claude/pricing.md": pricing },
    });
    const partition = validatedPricing(modelsSource);
    const offer = partition.books
      .find(({ book_key }) => book_key === "model:anthropic/claude-fable-5")
      ?.offers.find(({ offer_key }) => offer_key === "sync");
    const term = offer?.terms.find(
      ({ kind, term_key }) => kind === "raw" && term_key === "unparsed:cache_write_text:300",
    );
    if (term?.kind !== "raw") throw new Error("Missing raw 5m cache price");
    const scope = term.variants[0]?.possible_scope;
    if (scope === undefined) throw new Error("Missing raw price scope");
    expect(
      evaluateApplicability(scope, [
        {
          dimension: { namespace: "kmodels", value: "speed" },
          kind: "categorical",
          value: { namespace: "provider", provider_id: "anthropic", value: "standard" },
        },
        {
          dimension: { namespace: "kmodels", value: "cache_ttl_seconds" },
          kind: "decimal",
          value: "3600",
          unit: { factors: [{ unit: { namespace: "kmodels", value: "second" }, power: 1 }] },
        },
      ]).state,
    ).toBe("true");
  });
  it("preserves readable siblings and raw evidence when one base price is unsupported", async () => {
    const pricing = (await fixture("anthropic/pricing.md")).replace(
      "$12.50 / MTok",
      "EUR 12.50 / MTok",
    );
    const modelsSource = await anthropicSource({
      overrides: { "/docs/en/about-claude/pricing.md": pricing },
    });
    const models = modelsSource.models;
    validatedPricing(modelsSource);
    const fable = models.find(({ model_id }) => model_id === "claude-fable-5");
    expect(
      fable?.price_facts.filter(
        ({ conditions }) =>
          conditions.speed === "standard" &&
          conditions.service_tier === undefined &&
          conditions.inference_geo === "global",
      ),
    ).toHaveLength(4);
    expect(fable?.raw_price_facts).toContainEqual(
      expect.objectContaining({
        impact: "base_price",
        conditions: { cache_ttl_seconds: 300, speed: "standard" },
        raw: expect.objectContaining({ amount: "EUR 12.50 / MTok" }),
      }),
    );
  });

  it.each([
    ["September 30, 2026", "2026-09-30"],
    ["February 29, 2028", "2028-02-29"],
  ])("reads a published promotion end date rather than a fixed date (%s)", async (native, iso) => {
    const pricing = (await fixture("anthropic/pricing.md")).replaceAll(
      "through August 31, 2026",
      `through ${native}`,
    );
    const modelsSource = await anthropicSource({
      overrides: { "/docs/en/about-claude/pricing.md": pricing },
    });
    const models = modelsSource.models;
    validatedPricing(modelsSource);
    const sonnet = models.find(({ model_id }) => model_id === "claude-sonnet-5");
    expect(
      sonnet?.price_facts.find(({ meter, price }) => meter === "input_text" && price === "2")
        ?.conditions,
    ).toMatchObject({ effective_until: iso, promotion: true });
  });

  it("keeps an invalid promotion date raw without publishing an undated discounted rate", async () => {
    const pricing = (await fixture("anthropic/pricing.md")).replaceAll(
      "through August 31, 2026",
      "through February 30, 2026",
    );
    const modelsSource = await anthropicSource({
      overrides: { "/docs/en/about-claude/pricing.md": pricing },
    });
    const models = modelsSource.models;
    validatedPricing(modelsSource);
    const sonnet = models.find(({ model_id }) => model_id === "claude-sonnet-5");
    expect(
      sonnet?.price_facts.some(({ meter, price }) => meter === "input_text" && price === "2"),
    ).toBe(false);
    expect(sonnet?.raw_price_facts).toContainEqual(
      expect.objectContaining({
        reason: "unknown_applicability",
        raw: expect.objectContaining({
          label: expect.stringContaining("February 30, 2026"),
          amount: "$2 / MTok",
        }),
      }),
    );
    expect(
      sonnet?.price_facts.some(({ conditions }) => conditions.effective_from === "2026-09-01"),
    ).toBe(true);
  });

  it("binds monetary columns by reviewed headers when columns move", async () => {
    const pricing = (await fixture("anthropic/pricing.md"))
      .split("\n")
      .map((line) => {
        if (!line.startsWith("| ") || line.split("|").length !== 8) return line;
        const fields = line.split("|");
        const original = fields[3];
        fields[3] = fields[4] ?? "";
        fields[4] = original ?? "";
        return fields.join("|");
      })
      .join("\n");
    const modelsSource = await anthropicSource({
      overrides: { "/docs/en/about-claude/pricing.md": pricing },
    });
    const models = modelsSource.models;
    validatedPricing(modelsSource);
    expect(
      models.find(({ model_id }) => model_id === "claude-fable-5")?.price_facts,
    ).toContainEqual(
      expect.objectContaining({
        meter: "cache_write_text",
        price: "12.50",
        conditions: { cache_ttl_seconds: 300, speed: "standard", inference_geo: "global" },
      }),
    );
  });

  it("does not discard a second reviewed base table", async () => {
    const pricing = (await fixture("anthropic/pricing.md")).replace(
      "| Claude Opus 4.8                            | $5 / MTok",
      "\n| Model | Base Input Tokens | 5m Cache Writes | 1h Cache Writes | Cache Hits & Refreshes | Output Tokens |\n| --- | --- | --- | --- | --- | --- |\n| Claude Opus 4.8                            | $5 / MTok",
    );
    const modelsSource = await anthropicSource({
      overrides: { "/docs/en/about-claude/pricing.md": pricing },
    });
    const models = modelsSource.models;
    validatedPricing(modelsSource);
    expect(
      models.find(({ model_id }) => model_id === "claude-opus-4-8")?.price_facts,
    ).toContainEqual(
      expect.objectContaining({
        meter: "input_text",
        price: "5",
        conditions: { speed: "standard", inference_geo: "global" },
      }),
    );
  });

  it("keeps a readable Batch input and raw output without deriving rates from an unreadable multiplier", async () => {
    const pricing = (await fixture("anthropic/pricing.md"))
      .split("\n")
      .map((line) =>
        line.startsWith("| Claude Fable 5") && line.includes("$5 / MTok")
          ? line.replace("$25 / MTok", "EUR 25 / MTok")
          : line,
      )
      .join("\n")
      .replace("1.25x base input price", "unreviewed base input policy");
    const modelsSource = await anthropicSource({
      overrides: { "/docs/en/about-claude/pricing.md": pricing },
    });
    const models = modelsSource.models;
    validatedPricing(modelsSource);
    const fable = models.find(({ model_id }) => model_id === "claude-fable-5");
    expect(fable?.price_facts).toContainEqual(
      expect.objectContaining({
        meter: "input_text",
        price: "5",
        conditions: { service_tier: "batch", inference_geo: "global" },
      }),
    );
    expect(fable?.raw_price_facts.some(({ raw }) => raw.amount === "EUR 25 / MTok")).toBe(true);
    expect(
      fable?.raw_price_facts.some(
        ({ conditions, impact }) => conditions.service_tier === "batch" && impact === "base_price",
      ),
    ).toBe(true);
  });

  it("keeps independent cache multipliers when one operation becomes unreadable", async () => {
    const pricing = (await fixture("anthropic/pricing.md")).replace(
      "1.25x base input price",
      "unreviewed write policy",
    );
    const modelsSource = await anthropicSource({
      overrides: { "/docs/en/about-claude/pricing.md": pricing },
    });
    const models = modelsSource.models;
    validatedPricing(modelsSource);
    const fable = models.find(({ model_id }) => model_id === "claude-fable-5");
    expect(fable?.price_facts).toContainEqual(
      expect.objectContaining({
        meter: "cache_write_text",
        price: "10",
        conditions: { service_tier: "batch", cache_ttl_seconds: 3600, inference_geo: "global" },
      }),
    );
    expect(fable?.price_facts).toContainEqual(
      expect.objectContaining({
        meter: "cache_read_text",
        price: "0.5",
        conditions: { service_tier: "batch", inference_geo: "global" },
      }),
    );
    expect(fable?.raw_price_facts).toContainEqual(
      expect.objectContaining({
        impact: "base_price",
        conditions: { service_tier: "batch" },
        raw: expect.objectContaining({
          fragment: expect.stringContaining("unreviewed write policy"),
        }),
      }),
    );
  });

  it("preserves an irregular row as raw rather than ignoring it", async () => {
    const pricing = (await fixture("anthropic/pricing.md")).replace(
      "$12.50 / MTok   |",
      "$12.50 / MTok | extra cell |",
    );
    const modelsSource = await anthropicSource({
      overrides: { "/docs/en/about-claude/pricing.md": pricing },
    });
    const models = modelsSource.models;
    validatedPricing(modelsSource);
    expect(
      models.find(({ model_id }) => model_id === "claude-fable-5")?.raw_price_facts,
    ).toContainEqual(
      expect.objectContaining({
        reason: "unsupported_structure",
        raw: expect.objectContaining({ fragment: expect.stringContaining("extra cell") }),
      }),
    );
  });

  it("accepts the first-party explicit USD token-price spelling", async () => {
    const pricing = (await fixture("anthropic/pricing.md")).replace("$10 / MTok", "$10 USD / MTok");
    const modelsSource = await anthropicSource({
      overrides: { "/docs/en/about-claude/pricing.md": pricing },
    });
    const models = modelsSource.models;
    validatedPricing(modelsSource);
    expect(
      models.find(({ model_id }) => model_id === "claude-fable-5")?.price_facts,
    ).toContainEqual(
      expect.objectContaining({
        meter: "input_text",
        price: "10",
        conditions: { speed: "standard", inference_geo: "global" },
      }),
    );
  });

  it("keeps an unreviewed context qualifier raw instead of turning it into an ordinary rate", async () => {
    const pricing = (await fixture("anthropic/pricing.md")).replace(
      "Claude Fable 5                             |",
      "Claude Fable 5 (>100k context) | ",
    );
    const modelsSource = await anthropicSource({
      overrides: { "/docs/en/about-claude/pricing.md": pricing },
    });
    const models = modelsSource.models;
    validatedPricing(modelsSource);
    const fable = models.find(({ model_id }) => model_id === "claude-fable-5");
    expect(
      fable?.price_facts.some(
        ({ meter, conditions }) => meter === "input_text" && conditions.service_tier === undefined,
      ),
    ).toBe(false);
    expect(fable?.raw_price_facts).toContainEqual(
      expect.objectContaining({
        reason: "unknown_applicability",
        raw: expect.objectContaining({ label: expect.stringContaining(">100k context") }),
      }),
    );
  });
  it.each(["number", "optional number or null"])(
    "keeps compatible conditional counter types (%s)",
    async (type) => {
      const body = (await fixture("anthropic/messages.md")).replace(
        "cache_read_input_tokens: number or null",
        `cache_read_input_tokens: ${type}`,
      );
      const modelsSource = await anthropicSource({
        overrides: { "/docs/en/api/messages/create.md": body },
      });
      expect(modelsSource.pricing_inputs ?? []).toContainEqual(
        expect.objectContaining({
          key: "messages.usage.cached_input_tokens",
          availability: "conditional",
          locator: { kind: "json_pointer", value: "/usage/cache_read_input_tokens" },
        }),
      );
    },
  );
  it.each([
    ["string", "  - `output_tokens: string`"],
    ["nested", "  - `details: object`\n    - `output_tokens: number`"],
    ["duplicate", "  - `output_tokens: string`\n  - `output_tokens: number`"],
  ])("rejects unowned or retyped Messages usage (%s)", async (_label, field) => {
    const body = (await fixture("anthropic/messages.md")).replace(
      "  - `output_tokens: number`",
      field,
    );
    const modelsSource = await anthropicSource({
      overrides: { "/docs/en/api/messages/create.md": body },
    });
    const models = modelsSource.models;
    const inputs = modelsSource.pricing_inputs ?? [];
    expect(
      inputs.some(
        ({ key, locator }) =>
          key === "messages.usage.output_tokens" && locator.kind === "json_pointer",
      ),
    ).toBe(false);
    expect(
      inputs.some(
        ({ key, locator }) =>
          key === "messages.usage.uncached_input_tokens" && locator.kind === "json_pointer",
      ),
    ).toBe(true);
    expect(
      models.find(({ model_id }) => model_id === "claude-fable-5")?.price_facts,
    ).not.toHaveLength(0);
  });

  it("cannot bind a request field as returned usage", async () => {
    const body = (await fixture("anthropic/messages.md"))
      .replace("  - `output_tokens: number`", "")
      .replace("### Body Parameters", "### Body Parameters\n\n- `output_tokens: number`");
    const modelsSource = await anthropicSource({
      overrides: { "/docs/en/api/messages/create.md": body },
    });
    expect(
      (modelsSource.pricing_inputs ?? []).some(
        ({ key, locator }) =>
          key === "messages.usage.output_tokens" && locator.kind === "json_pointer",
      ),
    ).toBe(false);
  });

  it("cannot bind usage attached to an unrelated returned object", async () => {
    const original = await fixture("anthropic/messages.md");
    const at = original.indexOf("### Returns");
    const body =
      original.slice(0, at) +
      "### Returns\n\n- `details: object`\n" +
      original
        .slice(at + "### Returns".length)
        .trim()
        .split("\n")
        .map((line) => "  " + line)
        .join("\n");
    const modelsSource = await anthropicSource({
      overrides: { "/docs/en/api/messages/create.md": body },
    });
    expect(
      (modelsSource.pricing_inputs ?? []).some(
        ({ locator }) => locator.kind === "json_pointer" && locator.value === "/usage/input_tokens",
      ),
    ).toBe(false);
  });

  it.each([
    '{ "usage": { "server_tool_use": { "web_search_requests": "one" } } }',
    '{ "details": { "usage": { "server_tool_use": { "web_search_requests": 1 } } } }',
  ])("does not infer a search counter from a lookalike JSON example (%s)", async (example) => {
    const original = await fixture("anthropic/web-search-tool.md");
    const modelsSource = await anthropicSource({
      overrides: {
        "/docs/en/agents-and-tools/tool-use/web-search-tool.md": original.replace(
          /\{ "usage"[^\n]+/,
          example,
        ),
      },
    });
    expect(
      (modelsSource.pricing_inputs ?? []).some(
        ({ key }) => key === "messages.usage.successful_web_searches",
      ),
    ).toBe(false);
    expect(
      (modelsSource.commercial_facts ?? []).find(
        ({ resource_key }) => resource_key === "web-search",
      )?.price_facts[0]?.price,
    ).toBe("10");
  });

  it("does not assign cache iteration quantities to an unreviewed iteration type", async () => {
    const body = (await fixture("anthropic/prompt-caching.md")).replace(
      '"type": "message"',
      '"type": "unreviewed"',
    );
    const modelsSource = await anthropicSource({
      overrides: { "/docs/en/build-with-claude/prompt-caching.md": body },
    });
    const buckets = (modelsSource.pricing_inputs ?? []).filter(
      ({ key }) => key === "messages.usage.cache_write_5m_input_tokens",
    );
    expect(buckets.some(({ locator }) => locator.kind === "json_pointer")).toBe(true);
    expect(buckets.some(({ locator }) => locator.kind === "provider_field")).toBe(false);
  });

  it("retains services and accounting when no model has a readable rate", async () => {
    const modelsSource = await anthropicSource({
      overrides: { "/docs/en/about-claude/pricing.md": "# Unreadable model rates" },
    });
    const models = modelsSource.models;
    expect(models.every(({ price_facts }) => price_facts.length === 0)).toBe(true);
    expect((modelsSource.commercial_facts ?? []).map(({ resource_key }) => resource_key)).toEqual([
      "code-execution",
      "code-execution",
      "web-search",
    ]);
    expect(
      (modelsSource.pricing_inputs ?? []).some(
        ({ key }) => key === "messages.usage.uncached_input_tokens",
      ),
    ).toBe(true);
    const partition = validatedPricing(modelsSource);
    expect(partition.books.map(({ scope }) => scope.kind)).toEqual([
      "provider_resource",
      "provider_resource",
    ]);
  });

  it("keeps an owned field when an unrelated nested lookalike changes type", async () => {
    const body = (await fixture("anthropic/messages.md")).replace(
      "  - `output_tokens: number`",
      "  - `output_tokens: number`\n  - `details: object`\n    - `output_tokens: string`",
    );
    const modelsSource = await anthropicSource({
      overrides: { "/docs/en/api/messages/create.md": body },
    });
    expect(modelsSource.pricing_inputs ?? []).toContainEqual(
      expect.objectContaining({
        key: "messages.usage.output_tokens",
        locator: { kind: "json_pointer", value: "/usage/output_tokens" },
      }),
    );
  });

  it("cannot bind a declaration quoted inside a returned code example", async () => {
    const body = (await fixture("anthropic/messages.md")).replace(
      "  - `output_tokens: number`",
      ["```markdown", "  - `output_tokens: number`", "```"].join("\n"),
    );
    const modelsSource = await anthropicSource({
      overrides: { "/docs/en/api/messages/create.md": body },
    });
    expect(
      (modelsSource.pricing_inputs ?? []).some(
        ({ key, locator }) =>
          key === "messages.usage.output_tokens" && locator.kind === "json_pointer",
      ),
    ).toBe(false);
  });

  it("keeps a valid cache iteration mapping when the top-level example drifts", async () => {
    const body = (await fixture("anthropic/prompt-caching.md")).replace(
      '"ephemeral_5m_input_tokens": 148',
      '"ephemeral_5m_input_tokens": "unreviewed"',
    );
    const modelsSource = await anthropicSource({
      overrides: { "/docs/en/build-with-claude/prompt-caching.md": body },
    });
    const buckets = (modelsSource.pricing_inputs ?? []).filter(
      ({ key }) => key === "messages.usage.cache_write_5m_input_tokens",
    );
    expect(buckets.some(({ locator }) => locator.kind === "json_pointer")).toBe(false);
    expect(buckets.some(({ locator }) => locator.kind === "provider_field")).toBe(true);
  });

  it("does not invent an iteration cache-read field from the general compaction rule", async () => {
    const modelsSource = await anthropicSource();
    const inputs = modelsSource.pricing_inputs ?? [];
    expect(inputs.filter(({ key }) => key === "messages.usage.cached_input_tokens")).toEqual([
      expect.objectContaining({
        locator: { kind: "json_pointer", value: "/usage/cache_read_input_tokens" },
      }),
    ]);
    expect(inputs.filter(({ key }) => key === "messages.usage.uncached_input_tokens")).toHaveLength(
      2,
    );
  });

  it("withholds only a retyped iteration counter and reports incomplete compaction accounting", async () => {
    const body = (await fixture("anthropic/compaction.md")).replace(
      '"input_tokens": 180000',
      '"input_tokens": "unreviewed"',
    );
    const findings: SourceContractEvidence[] = [];
    const modelsSource = await anthropicSource({
      overrides: { "/docs/en/build-with-claude/compaction.md": body },
      onContractFinding: (finding) => findings.push(finding),
    });
    const inputs = (modelsSource.pricing_inputs ?? []).filter(
      ({ locator }) => locator.kind === "provider_field",
    );
    expect(inputs.some(({ key }) => key === "messages.usage.uncached_input_tokens")).toBe(false);
    expect(inputs.some(({ key }) => key === "messages.usage.output_tokens")).toBe(true);
    expect(contractPaths(findings)).toContain(
      "/anthropic/accounting_contract_drift/Compaction iterations",
    );
  });
  it("keeps the Anthropic catalog on a fixed reviewed documentation bundle", async () => {
    const source = manifest("anthropic").sources[0];
    if (source?.linkedDocuments === undefined) throw new Error("Missing Anthropic link policy");
    const urls = linkedDocumentUrls(await fixture("anthropic/overview.md"), source);
    expect(urls).toEqual([]);
    expect({
      min: source.linkedDocuments.minDocuments,
      max: source.linkedDocuments.maxDocuments,
      optional: source.linkedDocuments.optionalDocuments,
      reviewed: source.linkedDocuments.documents?.map(({ url }) => new URL(url).pathname),
    }).toMatchObject({
      min: 0,
      max: 0,
      reviewed: expect.arrayContaining([
        "/docs/en/about-claude/pricing.md",
        "/docs/en/about-claude/models/model-ids-and-versions.md",
        "/docs/en/agents-and-tools/tool-use/web-search-tool.md",
        "/docs/en/agents-and-tools/tool-use/code-execution-tool.md",
      ]),
      optional: true,
    });
  });
  it("joins official model, lifecycle, and pricing tables by observed identity", async () => {
    const models = await anthropicCatalog();
    const fable = models.find((model) => model.model_id === "claude-fable-5");
    const mythos = models.find((model) => model.model_id === "claude-mythos-5");
    const opus = models.find((model) => model.model_id === "claude-opus-4-8");
    const sonnet = models.find((model) => model.model_id === "claude-sonnet-5");
    const preview = models.find((model) => model.model_id === "claude-mythos-preview");
    expect({
      count: models.length,
      name: fable?.name,
      release: fable?.release_date,
      description: fable?.description,
      mythosRelease: mythos?.release_date,
      mythosDescription: mythos?.description,
      stage: fable?.release_stage,
      limits: fable?.limits,
      input: fable?.price_facts.find(
        (rate) => rate.meter === "input_text" && rate.conditions.inference_geo === "global",
      )?.price,
      usInput: fable?.price_facts.find(
        (rate) => rate.meter === "input_text" && rate.conditions.inference_geo === "us",
      )?.price,
      batchCache: fable?.price_facts.find(
        (rate) =>
          rate.meter === "cache_read_text" &&
          rate.conditions.service_tier === "batch" &&
          rate.conditions.inference_geo === "global",
      )?.price,
      cacheWrites: fable?.price_facts
        .filter(
          (rate) =>
            rate.meter === "cache_write_text" &&
            rate.conditions.service_tier === undefined &&
            rate.conditions.inference_geo === "global",
        )
        .map(({ price, conditions }) => [conditions.cache_ttl_seconds, price]),
      opusRelease: opus?.release_date,
      fastInput: opus?.price_facts.find(
        (rate) =>
          rate.meter === "input_text" &&
          rate.conditions.speed === "fast" &&
          rate.conditions.inference_geo === "global",
      ),
      sonnetRates: sonnet?.price_facts.length,
      previewStatus: preview?.status,
      previewReplacement: preview?.replacement_model_ids,
    }).toEqual({
      count: 7,
      name: "Claude Fable 5",
      release: "2026-06-09",
      description: "Long-running agents",
      mythosRelease: "2026-06-09",
      mythosDescription: undefined,
      stage: "stable",
      limits: { context_tokens: 1_000_000, max_output_tokens: 128_000 },
      input: "10",
      usInput: "11",
      batchCache: "0.5",
      cacheWrites: [
        [300, "12.50"],
        [3600, "20"],
      ],
      opusRelease: "2026-05-28",
      fastInput: expect.objectContaining({
        price: "10",
        conditions: { speed: "fast", inference_geo: "global" },
      }),
      sonnetRates: 40,
      previewStatus: "retired",
      previewReplacement: ["claude-mythos-5"],
    });
  });

  it("keeps standard pricing when Anthropic changes header casing and publishes a cache override", async () => {
    const pricing = (await fixture("anthropic/pricing.md"))
      .replace("Base Input Tokens", "Base input tokens")
      .replace(
        "| Claude Fable 5                             | $10 / MTok        | $12.50 / MTok   | $20 / MTok      | $1 / MTok",
        "| Claude Fable 5                             | $10 / MTok        | $12.50 / MTok   | $20 / MTok      | $0.25 / MTok1",
      )
      .replace(
        /0\.1x base input price\s*\| Same duration as the preceding write/,
        "0.1x base input price (0.025x on Claude Fable 5) | Same duration as the preceding write",
      );
    const reconciliation: PricingReconciliationItem[] = [];
    const fable = (
      await anthropicCatalog({
        overrides: { "/docs/en/about-claude/pricing.md": pricing },
        onPricingReconciliation: (item) => reconciliation.push(item),
      })
    ).find(({ model_id }) => model_id === "claude-fable-5");

    const price = (meter: "input_text" | "cache_read_text", serviceTier?: string) =>
      fable?.price_facts.find(
        ({ meter: candidate, conditions }) =>
          candidate === meter &&
          conditions.service_tier === serviceTier &&
          conditions.inference_geo === "global",
      )?.price;

    expect(price("input_text")).toBe("10");
    expect(price("cache_read_text", "batch")).toBe("0.125");
    expect(reconciliation.map(({ reason_code }) => reason_code)).not.toEqual(
      expect.arrayContaining(["pricing_table_drift", "cache_multiplier_drift"]),
    );
  });

  it("reports an unreviewed Anthropic cache override shape", async () => {
    const pricing = (await fixture("anthropic/pricing.md")).replace(
      /0\.1x base input price\s*\| Same duration as the preceding write/,
      "0.1x base input price (special case) | Same duration as the preceding write",
    );
    const reconciliation: PricingReconciliationItem[] = [];

    await anthropicCatalog({
      overrides: { "/docs/en/about-claude/pricing.md": pricing },
      onPricingReconciliation: (item) => reconciliation.push(item),
    });

    expect(reconciliation).toContainEqual({
      disposition: "unresolved",
      reason_code: "cache_multiplier_drift",
      sample: "Prompt caching multipliers",
    });
  });

  it("keeps separate Anthropic cache exceptions and validates Fast support across all rows", async () => {
    const pricing = (await fixture("anthropic/pricing.md"))
      .replace(
        /0\.1x base input price\s*\| Same duration as the preceding write/,
        "0.1x base input price (0.025x on Claude Fable 5 and Claude Mythos 5; 0.05x on Claude Opus 4.8) | Same duration as the preceding write",
      )
      .replace(
        "Claude Opus 4.8 / Claude Opus 4.7 | $10 / MTok | $50 / MTok",
        "Claude Opus 4.8 | $10 / MTok | $50 / MTok |\n| Claude Opus 4.7 | $10 / MTok | $50 / MTok",
      );
    const items: PricingReconciliationItem[] = [];
    const models = await anthropicCatalog({
      overrides: { "/docs/en/about-claude/pricing.md": pricing },
      onPricingReconciliation: (item) => items.push(item),
    });
    for (const [id, price] of [
      ["claude-fable-5", "0.125"],
      ["claude-mythos-5", "0.125"],
      ["claude-opus-4-8", "0.125"],
    ]) {
      const model = models.find(({ model_id }) => model_id === id);
      expect(model).toBeDefined();
      expect(model?.price_facts).toContainEqual(
        expect.objectContaining({
          meter: "cache_read_text",
          price,
          conditions: { service_tier: "batch", inference_geo: "global" },
        }),
      );
    }
    expect(items.some(({ reason_code }) => reason_code === "fast_compatibility_conflict")).toBe(
      false,
    );
  });

  it("reads only the bounded feature metadata model list and preserves code execution pricing", async () => {
    const original = await fixture("anthropic/code-execution-tool.md");
    const body =
      "---\ntitle: Code execution tool\nfeatureMetadata:\n  status: ga\n  supportedModels:\n    - claude-fable-5\n    - claude-opus-4-8\n  supportedPlatforms:\n    Claude API: ga\n---\n" +
      original.slice(original.indexOf("## Usage and pricing"));
    const modelsSource = await anthropicSource({
      overrides: { "/docs/en/agents-and-tools/tool-use/code-execution-tool.md": body },
    });
    const service = (modelsSource.commercial_facts ?? []).find(
      ({ offer_key }) => offer_key === "standalone",
    );
    expect(service).toBeDefined();
    expect(service?.model_refs).toEqual(["anthropic/claude-fable-5", "anthropic/claude-opus-4-8"]);
    expect(service?.terms).toContainEqual(
      expect.objectContaining({ term_key: "monthly-container-allowance" }),
    );
    const malformedSource = await anthropicSource({
      overrides: {
        "/docs/en/agents-and-tools/tool-use/code-execution-tool.md": body.replace(
          "    - claude-opus-4-8",
          "    - [claude-opus-4-8]",
        ),
      },
    });
    expect(
      (malformedSource.commercial_facts ?? []).some(
        ({ resource_key }) => resource_key === "code-execution",
      ),
    ).toBe(false);
  });

  it("accounts for every reviewed Anthropic pricing row or explicit boundary", async () => {
    const items: PricingReconciliationItem[] = [];
    await anthropicCatalog({ onPricingReconciliation: (item) => items.push(item) });
    expect({
      observed: items.length,
      normalized: items.filter(({ disposition }) => disposition === "normalized").length,
      excluded: items.filter(({ disposition }) => disposition === "excluded").length,
      problems: items.filter(({ disposition }) =>
        ["unbound", "ambiguous", "unsupported", "unresolved"].includes(disposition),
      ),
      reasons: [...new Set(items.map(({ reason_code }) => reason_code))].sort(),
    }).toEqual({
      observed: 26,
      normalized: 23,
      excluded: 3,
      problems: [],
      reasons: [
        "base_model_price_row",
        "batch_model_price_row",
        "cache_multiplier_applied",
        "code_execution_allowance_bound",
        "code_execution_minimum_bound",
        "code_execution_rate_bound",
        "code_execution_scope_bound",
        "code_execution_web_assisted_bound",
        "fast_model_price_row",
        "inference_geo_multiplier_applied",
        "token_overhead_included_in_usage",
        "web_search_service_bound",
      ],
    });
  });

  it("publishes only direct request-priced Anthropic services", async () => {
    const modelsSource = await anthropicSource();
    const facts = modelsSource.commercial_facts ?? [];
    const byKey = (resourceKey: string) =>
      facts.filter(({ resource_key }) => resource_key === resourceKey);
    expect({
      resources: [...new Set(facts.map(({ resource_key }) => resource_key))].sort(),
      search: byKey("web-search").map(({ offer_key, price_facts }) => [
        offer_key,
        price_facts[0]?.meter,
        price_facts[0]?.price,
      ]),
      code: byKey("code-execution").map(({ offer_key, pricing_state }) => [
        offer_key,
        pricing_state,
      ]),
      codeRaw: byKey("code-execution").find(({ offer_key }) => offer_key === "standalone")
        ?.raw_price_facts,
    }).toEqual({
      resources: ["code-execution", "web-search"],
      search: [["usage", "web_search", "10"]],
      code: [
        ["standalone", "numeric"],
        ["web-assisted", "included"],
      ],
      codeRaw: [],
    });
    expect(
      facts.flatMap(({ price_facts }) => price_facts).some(({ meter }) => meter === "tool_call"),
    ).toBe(false);
  });

  it("keeps independent Anthropic commercial claims when usage companions drift", async () => {
    const search = (await fixture("anthropic/web-search-tool.md")).replaceAll(
      "web_search_requests",
      "search_requests",
    );
    const code = (await fixture("anthropic/code-execution-tool.md")).replace(
      "minimum of 5 minutes",
      "minimum duration is documented elsewhere",
    );
    const items: PricingReconciliationItem[] = [];
    const findings: SourceContractEvidence[] = [];
    const modelsSource = await anthropicSource({
      overrides: {
        "/docs/en/agents-and-tools/tool-use/web-search-tool.md": search,
        "/docs/en/agents-and-tools/tool-use/code-execution-tool.md": code,
      },
      onPricingReconciliation: (item) => items.push(item),
      onContractFinding: (finding) => findings.push(finding),
    });
    const facts = modelsSource.commercial_facts ?? [];
    const codeFacts = facts.filter(({ resource_key }) => resource_key === "code-execution");
    expect({
      searchRate: facts.find(({ resource_key }) => resource_key === "web-search")?.price_facts[0]
        ?.price,
      codeOffers: codeFacts.map(({ offer_key }) => offer_key),
      codeRate: codeFacts.find(({ offer_key }) => offer_key === "standalone")?.price_facts[0]
        ?.price,
    }).toEqual({
      searchRate: "10",
      codeOffers: ["standalone", "web-assisted"],
      codeRate: "0.05",
    });
    const partition = validatedPricing(modelsSource);
    const searchBook = partition?.books.find(({ book_key }) => book_key === "service:web-search");
    const searchRate = searchBook?.offers
      .flatMap(({ terms }) => terms)
      .find(({ kind }) => kind === "rate");
    expect(searchRate?.kind === "rate" ? searchRate.variants[0]?.charge_binding : undefined).toBe(
      undefined,
    );
    expect(
      partition?.vocabulary.atoms.some(
        (atom) => atom.kind === "usage_signal" && atom.key === "successful_web_searches",
      ),
    ).toBe(false);
    const standalone = partition?.books
      .find(({ book_key }) => book_key === "service:code-execution")
      ?.offers.find(({ offer_key }) => offer_key === "standalone");
    const codeRate = standalone?.terms.find(({ kind }) => kind === "rate");
    expect(codeRate?.kind === "rate" ? codeRate.variants[0]?.charge_binding : undefined).toBe(
      undefined,
    );
    expect(standalone?.terms).toContainEqual(
      expect.objectContaining({ kind: "raw", term_key: "runtime-observation" }),
    );
    expect(contractPaths(findings)).toContain(
      "/anthropic/accounting_contract_drift/Web Search usage signal",
    );
    expect(items).toContainEqual({
      disposition: "unresolved",
      reason_code: "code_execution_minimum_bound",
      sample: "Code Execution minimum",
    });
  });

  it("parses the authenticated capability inventory as structured facts", async () => {
    const model = (await parsed("anthropic", "anthropic/api.json", "anthropic-api"))[0];
    expect({
      id: model?.model_id,
      release: model?.release_date,
      modalities: model?.modalities,
      limits: model?.limits,
      citations: model?.capabilities.citations,
      structured: model?.capabilities.structured_output,
    }).toEqual({
      id: "claude-opus-4-8",
      release: "2026-05-28",
      modalities: { input: ["text", "image", "pdf"], output: ["text"] },
      limits: {
        context_tokens: 1_000_000,
        max_input_tokens: 1_000_000,
        max_output_tokens: 128_000,
      },
      citations: true,
      structured: true,
    });
  });

  it("isolates invalid inventory rows and reports additive fields", async () => {
    const value = manifest("anthropic");
    const source = value.sources.find(({ id }) => id === "anthropic-api");
    if (source === undefined) throw new Error("Missing Anthropic API source");
    const fixtureBody = JSON.parse(await fixture("anthropic/api.json")) as {
      data: unknown[];
      first_id: string;
      last_id: string;
      has_more: boolean;
    };
    const first = fixtureBody.data[0];
    if (first === null || typeof first !== "object") throw new Error("Invalid Anthropic fixture");
    const findings: SourceContractEvidence[] = [];
    const models = parseSource({
      provider: provider(value),
      source,
      body: JSON.stringify({
        ...fixtureBody,
        data: [
          { ...first, new_metadata: "accepted" },
          { ...first, id: "claude-invalid", max_tokens: "unknown" },
        ],
      }),
      observedAt,
      onContractFinding: (finding) => findings.push(finding),
    }).models;
    expect(models.map(({ model_id }) => model_id)).toEqual(["claude-opus-4-8"]);
    expect(
      findings.flatMap(({ diagnostics }) => diagnostics.map(({ kind, path }) => [kind, path])),
    ).toEqual(
      expect.arrayContaining([
        ["unknown_field", "/new_metadata"],
        ["type_mismatch", "/max_tokens"],
      ]),
    );
  });

  it("accepts frontmatter and equivalent API heading syntax", async () => {
    const frontmatter = "---\ntitle: Reference\n---\n\n";
    const endpoint = async (path: string, method: "get" | "post"): Promise<string> =>
      `${frontmatter}${(await fixture(path)).replace(/^## /, "# ").replace(`**${method}**`, `**${method.toUpperCase()}**`)}`;
    const models = await anthropicCatalog({
      overrides: {
        "/docs/en/api/models/list.md": await endpoint("anthropic/models-list.md", "get"),
        "/docs/en/api/messages/create.md": await endpoint("anthropic/messages.md", "post"),
        "/docs/en/api/messages/batches/create.md": await endpoint("anthropic/batches.md", "post"),
      },
    });
    expect(models.find(({ model_id }) => model_id === "claude-fable-5")).toMatchObject({
      api_endpoints: [
        { name: "Create a Message", path: "v1/messages" },
        { name: "Create a Message Batch", path: "v1/messages/batches" },
      ],
      capabilities: { streaming: true, tool_call: true, batch: true },
    });
  });

  it("publishes Messages for callable models and batches only for active models", async () => {
    const models = await anthropicCatalog();
    const endpoints = (id: string) => models.find((model) => model.model_id === id)?.api_endpoints;
    expect(endpoints("claude-fable-5")).toEqual([
      { name: "Create a Message", path: "v1/messages" },
      { name: "Create a Message Batch", path: "v1/messages/batches" },
    ]);
    expect(endpoints("claude-opus-4-7")).toEqual([
      { name: "Create a Message", path: "v1/messages" },
      { name: "Create a Message Batch", path: "v1/messages/batches" },
    ]);
    expect(endpoints("claude-mythos-preview")).toBeUndefined();
    expect(endpoints("claude-opus-4-1-20250805")).toEqual([
      { name: "Create a Message", path: "v1/messages" },
    ]);
  });

  it("derives current capabilities from public compatibility contracts", async () => {
    const models = await anthropicCatalog();
    const capabilities = (id: string) =>
      models.find((model) => model.model_id === id)?.capabilities;
    expect(capabilities("claude-fable-5")).toEqual({
      reasoning: true,
      tool_call: true,
      structured_output: true,
      streaming: true,
      batch: true,
      prompt_cache: true,
      fine_tuning: false,
      citations: true,
      code_execution: true,
      context_management: true,
      effort_control: true,
      computer_use: false,
    });
    expect(models.find(({ model_id }) => model_id === "claude-fable-5")?.modalities).toEqual({
      input: ["text", "image", "pdf"],
      output: ["text"],
    });
    expect(capabilities("claude-opus-4-1-20250805")).toMatchObject({
      structured_output: false,
      streaming: true,
      batch: false,
      fine_tuning: false,
      code_execution: true,
      context_management: true,
      effort_control: false,
      computer_use: true,
    });
  });

  it("accepts a single thinking matrix and supported-model code list", async () => {
    const overview = (await fixture("anthropic/overview.md"))
      .replace(" and joins the invitation-only Claude Mythos Preview (`claude-mythos-preview`)", "")
      .replace(
        /\| \*\*Extended thinking[^\n]+\n\| \*\*Adaptive thinking[^\n]+/,
        "| **Thinking**                                  | Adaptive (always on) | Adaptive        | Adaptive               |",
      )
      .replace(/\n\| Feature\s+\| Claude Opus 4\.7[\s\S]*?(?=\n\[Pricing])/m, "\n");
    const codeExecution = (await fixture("anthropic/code-execution-tool.md")).replace(
      /\| Model\s+\| Tool versions[\s\S]*?\| Claude Opus 4\.1[^\n]+/,
      "- Supported models: `claude-fable-5`, `claude-mythos-5`, `claude-opus-4-8`, `claude-opus-4-7`, `claude-sonnet-5`, `claude-opus-4-1-20250805`",
    );
    const reconciliation: PricingReconciliationItem[] = [];
    const models = await anthropicCatalog({
      overview,
      overrides: {
        "/docs/en/agents-and-tools/tool-use/code-execution-tool.md": codeExecution,
      },
      onPricingReconciliation: (item) => reconciliation.push(item),
    });
    expect(
      models.find(({ model_id }) => model_id === "claude-fable-5")?.capabilities,
    ).toMatchObject({
      reasoning: true,
      code_execution: true,
    });
    expect(reconciliation).toContainEqual(
      expect.objectContaining({
        disposition: "normalized",
        reason_code: "code_execution_scope_bound",
      }),
    );
    expect(reconciliation).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason_code: "model_overview_drift" }),
        expect.objectContaining({
          reason_code: "capability_contract_drift",
          sample: "code execution",
        }),
        expect.objectContaining({
          reason_code: "capability_contract_drift",
          sample: "code execution exception",
        }),
      ]),
    );
  });

  it("lets scoped inventory fill gaps without overriding global facts", () => {
    const value = manifest("anthropic");
    const catalogSource = value.sources[0];
    const inventorySource = value.sources.find(({ id }) => id === "anthropic-api");
    if (catalogSource === undefined || inventorySource === undefined)
      throw new Error("Missing Anthropic sources");
    const publicBase = baseModel({
      providerId: "anthropic",
      id: "claude-example",
      name: "Public name",
      sourceId: catalogSource.id,
      observedAt,
    });
    const publicModel = {
      ...publicBase,
      capabilities: {
        ...publicBase.capabilities,
        reasoning: true,
      },
      limits: { context_tokens: 1_000_000 },
      release_date: "2026-06-09",
    };
    const inventoryModel = {
      ...baseModel({
        providerId: "anthropic",
        id: "claude-example",
        name: "Inventory name",
        sourceId: inventorySource.id,
        observedAt,
      }),
      capabilities: {
        ...publicModel.capabilities,
        reasoning: false,
        tool_call: false,
      },
      limits: { context_tokens: 500_000, max_input_tokens: 500_000 },
      release_date: "2026-06-07",
    };
    const merged = applyGroups(
      applyGroups([], [{ source: catalogSource, models: [publicModel] }], true),
      [{ source: inventorySource, models: [inventoryModel] }],
      false,
    )[0];
    expect(merged).toMatchObject({
      name: "Public name",
      capabilities: { reasoning: true, tool_call: false },
      limits: { context_tokens: 1_000_000, max_input_tokens: 500_000 },
      release_date: "2026-06-09",
      source_refs: ["anthropic-models", "anthropic-api"],
    });
  });

  it("parses labeled lifecycle notes for models omitted from the status table", async () => {
    const lifecycle = (await fixture("anthropic/lifecycle.md")).replace(
      /\n\[Claude Mythos Preview].*\n/,
      "\n",
    );
    const preview = (
      await anthropicCatalog({
        overrides: { "/docs/en/about-claude/model-deprecations.md": lifecycle },
      })
    ).find(({ model_id }) => model_id === "claude-mythos-preview");
    expect(preview).toMatchObject({
      status: "deprecated",
      replacement_model_ids: ["claude-mythos-5"],
    });
    expect(preview?.retired_at).toBeUndefined();
  });

  it("isolates an impossible lifecycle date while retaining independent evidence", async () => {
    const lifecycle = (await fixture("anthropic/lifecycle.md")).replace(
      "August 5, 2026",
      "February 30, 2026",
    );
    const findings: SourceContractEvidence[] = [];
    const opus = (
      await anthropicCatalog({
        overrides: { "/docs/en/about-claude/model-deprecations.md": lifecycle },
        onContractFinding: (finding) => findings.push(finding),
      })
    ).find(({ model_id }) => model_id === "claude-opus-4-1-20250805");
    expect(opus).toMatchObject({ status: "deprecated", retired_at: "2026-08-05" });
    expect(contractPaths(findings)).toContain(
      "/anthropic/lifecycle_date_invalid/retirement date: February 30, 2026",
    );
  });

  it("withholds a drifted Messages operation without rejecting model identity", async () => {
    const body = (await fixture("anthropic/messages.md")).replace("/v1/messages", "/v2/messages");
    const findings: SourceContractEvidence[] = [];
    const fable = (
      await anthropicCatalog({
        overrides: { "/docs/en/api/messages/create.md": body },
        onContractFinding: (finding) => findings.push(finding),
      })
    ).find(({ model_id }) => model_id === "claude-fable-5");
    expect(fable).toMatchObject({
      capabilities: { streaming: "unknown", tool_call: "unknown" },
    });
    expect(fable?.api_endpoints).toEqual([
      { name: "Create a Message Batch", path: "v1/messages/batches" },
    ]);
    expect(contractPaths(findings)).toContain("/anthropic/operation_contract_drift/v1/messages");
  });

  it("retains Anthropic prices without inventing a mapping for a drifted usage field", async () => {
    const body = (await fixture("anthropic/messages.md")).replace(
      "- `output_tokens: number`",
      "- `generated_tokens: number`",
    );
    const findings: SourceContractEvidence[] = [];
    const modelsSource = await anthropicSource({
      overrides: { "/docs/en/api/messages/create.md": body },
      onContractFinding: (finding) => findings.push(finding),
    });
    const models = modelsSource.models;
    const fable = models.find(({ model_id }) => model_id === "claude-fable-5");
    expect(fable?.price_facts.some(({ meter }) => meter === "output_text")).toBe(true);
    expect(
      fable?.raw_price_facts.some(({ term_key }) =>
        term_key.startsWith("accounting_binding_unavailable:"),
      ),
    ).toBe(false);
    expect(
      modelsSource.pricing_inputs?.filter(({ key }) => key === "messages.usage.output_tokens"),
    ).toEqual([
      expect.objectContaining({
        locator: {
          kind: "provider_field",
          value:
            "usage.iterations[*].output_tokens attributed to advisor_message.model or response.model for message/compaction",
        },
      }),
    ]);

    const partition = validatedPricing(modelsSource);
    const sync = partition?.books
      .find(({ book_key }) => book_key === "model:anthropic/claude-fable-5")
      ?.offers.find(({ offer_key }) => offer_key === "sync");
    const rate = (meter: "input_text" | "output_text") =>
      sync?.terms.find((term) => term.kind === "rate" && term.meter.value === meter);
    const input = rate("input_text");
    const output = rate("output_text");
    expect(output?.kind === "rate" ? output.variants[0]?.charge_binding : undefined).toMatchObject({
      signal: { namespace: "provider", provider_id: "anthropic", value: "output_tokens" },
    });
    expect(
      output?.kind === "rate"
        ? output.variants[0]?.charge_binding?.quantity_methods?.[0]?.input_sources
        : undefined,
    ).toHaveLength(1);
    expect(
      input?.kind === "rate"
        ? input.variants[0]?.charge_binding?.quantity_methods?.[0]?.input_sources
        : undefined,
    ).toHaveLength(2);
    expect(
      sync?.terms.some(({ term_key }) => term_key.startsWith("accounting_binding_unavailable:")),
    ).toBe(false);
    expect(contractPaths(findings)).toContain(
      "/anthropic/accounting_contract_drift/Messages usage.output_tokens",
    );
  });

  it("binds independent Anthropic cache TTL buckets and isolates a missing counter", async () => {
    const parsed = await anthropicSource();
    const { models } = parsed;
    const value = manifest("anthropic");
    const source = value.sources[0];
    if (source === undefined) throw new Error("Missing Anthropic source");
    const partition = assembleParsedProviderPricing(
      value.provider.id,
      observedAt,
      [{ source, ...parsed }],
      models,
      value.pricingCategoricalLabels,
    );
    const sync = partition?.books
      .find(({ book_key }) => book_key === "model:anthropic/claude-fable-5")
      ?.offers.find(({ offer_key }) => offer_key === "sync");
    if (sync === undefined) throw new Error("Missing Messages offer");
    const writes = sync.terms.filter(
      (term) => term.kind === "rate" && term.meter.value === "cache_write_text",
    );
    expect(writes.map(({ term_key }) => term_key)).toEqual(
      expect.arrayContaining([expect.stringMatching(/:5m$/), expect.stringMatching(/:1h$/)]),
    );
    for (const term of writes) {
      if (term.kind !== "rate") throw new Error("Expected a rate");
      for (const variant of term.variants) {
        expect(
          variant.applicability.any_of
            .flatMap(({ all_of }) => all_of)
            .some(({ dimension }) => dimension.value === "cache_ttl_seconds"),
        ).toBe(false);
        expect(variant.charge_binding?.quantity_methods?.[0]?.input_sources).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              locator: {
                kind: "json_pointer",
                value: `/usage/cache_creation/ephemeral_${term.term_key.endsWith(":5m") ? "5m" : "1h"}_input_tokens`,
              },
            }),
            expect.objectContaining({
              locator: {
                kind: "provider_field",
                value: `usage.iterations[*].cache_creation.ephemeral_${term.term_key.endsWith(":5m") ? "5m" : "1h"}_input_tokens attributed to advisor_message.model or response.model for message/compaction`,
              },
            }),
          ]),
        );
      }
    }
    const driftedSource = await anthropicSource({
      overrides: {
        "/docs/en/build-with-claude/prompt-caching.md": (
          await fixture("anthropic/prompt-caching.md")
        ).replaceAll("ephemeral_1h_input_tokens", "unreviewed_input_tokens"),
      },
    });
    const drifted = driftedSource.models;
    const inputs = driftedSource.pricing_inputs ?? [];
    expect(inputs.some(({ key }) => key === "messages.usage.cache_write_5m_input_tokens")).toBe(
      true,
    );
    expect(inputs.some(({ key }) => key === "messages.usage.cache_write_1h_input_tokens")).toBe(
      false,
    );
    expect(
      drifted
        .find(({ model_id }) => model_id === "claude-fable-5")
        ?.price_facts.some(({ meter }) => meter === "cache_write_text"),
    ).toBe(true);
  });

  it("withholds drifted batch coverage without rejecting synchronous models", async () => {
    const fable = (
      await anthropicCatalog({
        overrides: { "/docs/en/build-with-claude/batch-processing.md": "# Message Batches API" },
      })
    ).find(({ model_id }) => model_id === "claude-fable-5");
    expect(fable).toMatchObject({
      api_endpoints: [{ name: "Create a Message", path: "v1/messages" }],
      capabilities: { batch: "unknown", streaming: true },
    });
  });

  it("isolates an unbound structured-output ID to that capability claim", async () => {
    const structured = (await fixture("anthropic/structured-outputs.md")).replace(
      "`claude-sonnet-5`",
      "`claude-unknown-5`",
    );
    const findings: SourceContractEvidence[] = [];
    const models = await anthropicCatalog({
      overrides: { "/docs/en/build-with-claude/structured-outputs.md": structured },
      onContractFinding: (finding) => findings.push(finding),
    });
    expect(
      models.find(({ model_id }) => model_id === "claude-sonnet-5")?.capabilities.structured_output,
    ).toBe(false);
    expect(contractPaths(findings)).toContain(
      "/anthropic/capability_model_unbound/structured-output: claude-unknown-5",
    );
  });

  it("derives geography eligibility from the documented generation for new model families", async () => {
    const overview = `${await fixture("anthropic/overview.md")}\n
| Feature                                        | Claude Haiku 4.6        |
| ---------------------------------------------- | ----------------------- |
| **Description**                                | Fast future model       |
| **Claude API ID**                              | claude-haiku-4-6        |
| **Claude API alias**                           | claude-haiku-4-6        |
| **Extended thinking (thinking.type enabled)**  | No                      |
| **Adaptive thinking (thinking.type adaptive)** | Yes                     |
| **Context window**                             | 200k tokens             |
| **Max output**                                 | 64k tokens              |
`;
    const lifecycle = (await fixture("anthropic/lifecycle.md")).replace(
      "| claude-fable-5           | Active",
      "| claude-haiku-4-6         | Active        | N/A          | Not sooner than July 1, 2027   |\n| claude-fable-5           | Active",
    );
    const releases = (await fixture("anthropic/release-notes.md")).replace(
      "### June 30, 2026",
      "### July 1, 2026\n\n- We've launched **Claude Haiku 4.6** (`claude-haiku-4-6`), a faster model.\n\n### June 30, 2026",
    );
    const structured = (await fixture("anthropic/structured-outputs.md")).replace(
      "`claude-fable-5`,",
      "`claude-haiku-4-6`, `claude-fable-5`,",
    );
    const pricing = (await fixture("anthropic/pricing.md"))
      .replace(
        "| Claude Fable 5                             | $10 / MTok",
        "| Claude Haiku 4.6                          | $1 / MTok         | $1.25 / MTok    | $2 / MTok       | $0.10 / MTok           | $5 / MTok     |\n| Claude Fable 5                             | $10 / MTok",
      )
      .replace(
        "| Claude Fable 5                             | $5 / MTok",
        "| Claude Haiku 4.6                          | $0.50 / MTok | $2.50 / MTok  |\n| Claude Fable 5                             | $5 / MTok",
      );
    const haiku = (
      await anthropicCatalog({
        overview,
        overrides: {
          "/docs/en/about-claude/model-deprecations.md": lifecycle,
          "/docs/en/about-claude/pricing.md": pricing,
          "/docs/en/build-with-claude/structured-outputs.md": structured,
          "/docs/en/release-notes/overview.md": releases,
        },
      })
    ).find(({ model_id }) => model_id === "claude-haiku-4-6");
    expect(haiku).toMatchObject({
      status: "active",
      release_date: "2026-07-01",
      limits: { context_tokens: 200_000, max_output_tokens: 64_000 },
      capabilities: { reasoning: true, tool_call: true, structured_output: true },
    });
    expect(
      haiku?.price_facts.find(
        ({ meter, conditions }) => meter === "input_text" && conditions.inference_geo === "us",
      )?.price,
    ).toBe("1.1");
  });

  it("keeps independent model facts when an optional companion is absent", async () => {
    const modelsSource = await anthropicSource({
      omit: [
        "/docs/en/about-claude/model-deprecations.md",
        "/docs/en/agents-and-tools/tool-use/web-search-tool.md",
      ],
    });
    const models = modelsSource.models;
    expect(models.find(({ model_id }) => model_id === "claude-fable-5")).toMatchObject({
      name: "Claude Fable 5",
      limits: { context_tokens: 1_000_000 },
      pricing_state: "numeric",
    });
    expect(modelsSource.commercial_facts ?? []).not.toContainEqual(
      expect.objectContaining({ resource_key: "web-search" }),
    );
  });

  it("withholds only geo variants when eligibility sources disagree", async () => {
    const residency = (await fixture("anthropic/data-residency.md")).replace("4.6", "4.7");
    const items: PricingReconciliationItem[] = [];
    const fable = (
      await anthropicCatalog({
        overrides: { "/docs/en/manage-claude/data-residency.md": residency },
        onPricingReconciliation: (item) => items.push(item),
      })
    ).find(({ model_id }) => model_id === "claude-fable-5");
    expect(fable?.price_facts.some(({ conditions }) => conditions.inference_geo === "us")).toBe(
      false,
    );
    expect(fable?.price_facts.some(({ meter }) => meter === "input_text")).toBe(true);
    expect(items).toContainEqual({
      disposition: "unresolved",
      reason_code: "inference_geo_eligibility_conflict",
      sample: "pricing and data-residency applicability, including global base pricing",
    });
  });

  it("rejects duplicate fixed documents instead of silently taking the first", async () => {
    await expect(
      anthropicCatalog({
        extraDocuments: [
          {
            url: "https://platform.claude.com/docs/en/api/messages/create.md",
            body: await fixture("anthropic/messages.md"),
          },
        ],
      }),
    ).rejects.toThrow(
      "Anthropic catalog expected at most one document: /docs/en/api/messages/create.md",
    );
  });

  it("parses escaped Markdown pipes without shifting model columns", async () => {
    const overview = (await fixture("anthropic/overview.md")).replace(
      "Speed and intelligence",
      "Speed \\| intelligence",
    );
    expect(
      (await anthropicCatalog({ overview })).find(({ model_id }) => model_id === "claude-sonnet-5")
        ?.description,
    ).toBe("Speed | intelligence");
  });
});
