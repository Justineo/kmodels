import { readFile } from "node:fs/promises";
import { load } from "cheerio";
import { describe, expect, it } from "vite-plus/test";
import { parseSource } from "../src/catalog/adapters.ts";
import { extractDeepseekPricingInputs } from "../src/catalog/deepseek-accounting.ts";
import { assembleParsedProviderPricing } from "../src/catalog/pricing-adapter.ts";
import { calculationExport } from "../src/catalog/pricing-calculator-export.ts";
import { createCalculator } from "../src/pricing/index.ts";
import type { ProviderPricingPartition } from "../src/catalog/pricing-assembly.ts";
import { validatePricingCatalog } from "../src/catalog/pricing-validation.ts";
import { applyGroups } from "../src/catalog/collector.ts";
import { manifests, type ProviderManifest, type SourceManifest } from "../src/catalog/manifests.ts";
import {
  sourcePricingReconciliation,
  type PricingReconciliationItem,
} from "../src/catalog/pricing-reconciliation.ts";
import type { ParsedProviderModel as ProviderModel } from "../src/catalog/pricing-source.ts";
import type { Catalog, Provider } from "../src/catalog/schema.ts";
import type { SourceContractEvidence } from "../src/catalog/source-contract.ts";
import type { SourceParseResult } from "../src/catalog/source-parse.ts";

const observedAt = "2026-07-21T00:00:00.000Z";
function contractPaths(findings: readonly SourceContractEvidence[]): string[] {
  return findings.flatMap(({ diagnostics }) => diagnostics.map(({ path }) => path));
}
function changedHtml(body: string, change: ($: ReturnType<typeof load>) => void): string {
  const $ = load(body);
  change($);
  return $.html();
}
async function accountingInputs(chat?: string, responses?: string) {
  return extractDeepseekPricingInputs(
    [
      {
        url: "https://api-docs.deepseek.com/api/create-chat-completion",
        body: chat ?? (await fixture("deepseek/chat.html")),
      },
      {
        url: "https://api-docs.deepseek.com/api/create-completion",
        body: await fixture("deepseek/fim.html"),
      },
      {
        url: "https://api-docs.deepseek.com/api/create-response",
        body: responses ?? (await fixture("deepseek/responses.html")),
      },
    ],
    "deepseek-catalog",
  );
}
async function fixture(path: string): Promise<string> {
  return readFile(new URL("./fixtures/" + path, import.meta.url), "utf8");
}
function manifest(providerId: string): ProviderManifest {
  const value = manifests.find((item) => item.provider.id === providerId);
  if (value === undefined) throw new Error("Missing manifest " + providerId);
  return value;
}
function provider(value: ProviderManifest): Provider {
  return { ...value.provider, source_ids: value.sources.map((source) => source.id) };
}
async function parsed(
  providerId: string,
  path: string,
  sourceId: string,
): Promise<ProviderModel[]> {
  const value = manifest(providerId);
  const source = value.sources.find((candidate) => candidate.id === sourceId);
  if (source === undefined) throw new Error("Missing source for " + providerId);
  return parseSource({ provider: provider(value), source, body: await fixture(path), observedAt })
    .models;
}

function validateParsedPricing(
  value: ProviderManifest,
  source: SourceManifest,
  models: ProviderModel[],
  partition: ProviderPricingPartition | undefined,
): Catalog {
  if (partition === undefined) throw new Error("Missing parsed pricing partition");
  const core: Catalog = {
    catalog_version: "a".repeat(64),
    generated_at: observedAt,
    coverage: [],
    warnings: [],
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
  };
  validatePricingCatalog(
    {
      provider_vocabularies: [partition.vocabulary],
      provider_snapshots: [partition.snapshot],
      model_dispositions: partition.model_dispositions,
      books: partition.books,
    },
    core,
  );
  return core;
}

async function deepseekSource(
  options: {
    chat?: string;
    catalog?: string;
    inventory?: string;
    observedAt?: string;
    responses?: string;
    vision?: string;
    onContractFinding?: (evidence: SourceContractEvidence) => void;
    onPricingReconciliation?: (item: PricingReconciliationItem) => void;
    onPricingDependencyFailure?: (url: string) => void;
    omit?: readonly string[];
    overrides?: Readonly<Record<string, string>>;
    withoutDocuments?: boolean;
  } = {},
): Promise<SourceParseResult> {
  const {
    chat,
    catalog,
    inventory,
    observedAt: deepseekObservedAt = observedAt,
    responses,
    vision,
    onContractFinding,
    onPricingReconciliation,
    onPricingDependencyFailure,
    omit = [],
    overrides = {},
    withoutDocuments = false,
  } = options;
  const value = manifest("deepseek");
  const source = value.sources.find(({ id }) => id === "deepseek-catalog");
  if (source === undefined) throw new Error("Missing DeepSeek catalog source");
  const body = JSON.stringify({
    index: { url: source.url, body: catalog ?? (await fixture("deepseek/catalog.html")) },
    documents: [
      {
        url: "https://api-docs.deepseek.com/api/create-chat-completion",
        body: chat ?? (await fixture("deepseek/chat.html")),
      },
      {
        url: "https://api-docs.deepseek.com/api/create-response",
        body: responses ?? (await fixture("deepseek/responses.html")),
      },
      {
        url: "https://api-docs.deepseek.com/api/create-completion",
        body: overrides["api/create-completion"] ?? (await fixture("deepseek/fim.html")),
      },
      {
        url: "https://api-docs.deepseek.com/guides/anthropic_api",
        body: overrides["guides/anthropic_api"] ?? (await fixture("deepseek/anthropic.html")),
      },
      {
        url: "https://api-docs.deepseek.com/guides/vision",
        body: vision ?? (await fixture("deepseek/vision.html")),
      },
      {
        url: "https://api-docs.deepseek.com/api/list-models",
        body: inventory ?? (await fixture("deepseek/list-models.html")),
      },
      {
        url: "https://api-docs.deepseek.com/zh-cn/quick_start/pricing/",
        body:
          overrides["zh-cn/quick_start/pricing/"] ?? (await fixture("deepseek/catalog-cny.html")),
      },
    ].filter(
      ({ url }) => !withoutDocuments && !omit.includes(new URL(url).pathname.replace(/^\//, "")),
    ),
  });
  return parseSource({
    provider: provider(value),
    source,
    body,
    observedAt: deepseekObservedAt,
    ...(onContractFinding === undefined ? {} : { onContractFinding }),
    ...(onPricingReconciliation === undefined ? {} : { onPricingReconciliation }),
    ...(onPricingDependencyFailure === undefined ? {} : { onPricingDependencyFailure }),
  });
}

async function deepseekCatalog(
  options: Parameters<typeof deepseekSource>[0] = {},
): Promise<ProviderModel[]> {
  return (await deepseekSource(options)).models;
}

it("reads DeepSeek terminal usage through inline HTML and preserves nested cache ownership", async () => {
  const chat = await fixture("deepseek/chat-accounting-inline.html");
  const responses = await fixture("deepseek/responses-accounting-nested.html");
  const parse = (body: string) =>
    extractDeepseekPricingInputs(
      [
        { url: "https://api-docs.deepseek.com/api/create-chat-completion", body: chat },
        {
          url: "https://api-docs.deepseek.com/api/create-completion",
          body: chat.replace("/chat/completions", "/completions"),
        },
        { url: "https://api-docs.deepseek.com/api/create-response", body },
      ],
      "deepseek-catalog",
    );
  const inputs = parse(responses);
  expect(inputs).toHaveLength(18);
  expect(inputs).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        key: "chat.stream.cached_input_tokens",
        locator: { kind: "json_pointer", value: "/usage/prompt_cache_hit_tokens" },
      }),
      expect.objectContaining({
        key: "responses.stream.cached_input_tokens",
        locator: {
          kind: "json_pointer",
          value: "/response/usage/input_tokens_details/cached_tokens",
        },
      }),
    ]),
  );
  for (const invalid of [
    responses.replaceAll("input_tokens_details", "output_tokens_details"),
    responses.replaceAll(">usage<", ">unbilled_usage<"),
    responses.replaceAll("cached_tokens", "other_tokens"),
  ])
    expect(
      parse(invalid).some(
        ({ key }) => key.startsWith("responses.") && key.endsWith("cached_input_tokens"),
      ),
    ).toBe(false);
  const incompleteStream = responses.replaceAll("response.failed", "response.other");
  expect(
    parse(incompleteStream).some(({ key }) => key === "responses.stream.cached_input_tokens"),
  ).toBe(false);
  expect(parse(incompleteStream).some(({ key }) => key === "responses.cached_input_tokens")).toBe(
    true,
  );
});

describe("DeepSeek adapters", () => {
  it("accepts additive public inventory metadata without treating it as catalog authority", async () => {
    const inventory = (await fixture("deepseek/list-models.html")).replaceAll(
      '"owned_by":"deepseek"',
      '"owned_by":"deepseek","name":"untrusted example label","context_window":1048576,"max_output_tokens":393216',
    );
    const findings: SourceContractEvidence[] = [];
    const models = await deepseekCatalog({
      inventory,
      onContractFinding: (finding) => findings.push(finding),
    });
    expect(
      contractPaths(findings).some((path) => path.includes("model_inventory_contract_drift")),
    ).toBe(false);
    expect(contractPaths(findings)).toContain("/deepseek/model_inventory_disagreement");
    expect(models).toHaveLength(3);
    expect(models.find(({ model_id }) => model_id === "deepseek-v4-flash")?.name).not.toBe(
      "untrusted example label",
    );
  });

  it("reads Anthropic stream support from its owned table without inter-cell whitespace", async () => {
    const chat = changedHtml(await fixture("deepseek/chat.html"), ($) => {
      $(".mime strong.openapi-schema__property")
        .filter((_, node) => $(node).text() === "stream")
        .closest(".openapi-schema__list-item")
        .find(".openapi-schema__name")
        .text("string");
    });
    const guide = (await fixture("deepseek/anthropic.html")).replace(/>\s+</g, "><");
    const models = await deepseekCatalog({ chat, overrides: { "guides/anthropic_api": guide } });
    expect(models.every(({ capabilities }) => capabilities.streaming === true)).toBe(true);
    const wrong = await deepseekCatalog({
      chat,
      overrides: {
        "guides/anthropic_api": guide.replace("<td>stream</td>", "<td>other_field</td>"),
      },
    });
    expect(wrong.every(({ capabilities }) => capabilities.streaming === "unknown")).toBe(true);
  });

  it("does not borrow the inventory response schema from request data", async () => {
    const inventory = (await fixture("deepseek/list-models.html")).replace(
      "openapi-markdown__details response",
      "openapi-markdown__details mime",
    );
    const findings: SourceContractEvidence[] = [];
    const models = await deepseekCatalog({
      inventory,
      onContractFinding: (finding) => findings.push(finding),
    });
    expect(models).toHaveLength(3);
    expect(models.every(({ price_facts }) => price_facts.length === 12)).toBe(true);
    expect(contractPaths(findings)).toContain(
      "/deepseek/model_inventory_contract_drift/GET /models",
    );
  });
  it("does not borrow the request model enumeration from a response field", async () => {
    const chat = changedHtml(await fixture("deepseek/chat.html"), ($) => {
      const request = $(".mime strong.openapi-schema__property")
        .filter((_, node) => $(node).text() === "model")
        .closest(".openapi-schema__list-item")
        .remove();
      $(".response").append(request);
    });
    const models = await deepseekCatalog({ chat });
    expect(
      models.every(
        ({ api_endpoints }) => !api_endpoints?.some(({ path }) => path === "/chat/completions"),
      ),
    ).toBe(true);
    expect(models.every(({ price_facts }) => price_facts.length === 12)).toBe(true);
  });

  it("keeps the request model enumeration when a nested lookalike has other values", async () => {
    const chat = changedHtml(await fixture("deepseek/chat.html"), ($) => {
      $(".mime").append(
        '<div class="openapi-schema__list-item"><strong class="openapi-schema__property">metadata</strong><span class="openapi-schema__name">object</span><div class="openapi-schema__list-item"><strong class="openapi-schema__property">model</strong><span class="openapi-schema__name">string</span><p>Possible values: [<code>unrelated-model</code>]</p></div></div>',
      );
    });
    const models = await deepseekCatalog({ chat });
    expect(
      models.every(({ api_endpoints }) =>
        api_endpoints?.some(({ path }) => path === "/chat/completions"),
      ),
    ).toBe(true);
  });

  it("cannot acquire model compatibility from a quoted enumeration", async () => {
    const chat = changedHtml(await fixture("deepseek/chat.html"), ($) => {
      const model = $(".mime strong.openapi-schema__property")
        .filter((_, node) => $(node).text() === "model")
        .closest(".openapi-schema__list-item");
      const values = model.find("p").remove();
      model.append($("<blockquote></blockquote>").append(values));
    });
    const models = await deepseekCatalog({ chat });
    expect(
      models.every(
        ({ api_endpoints }) => !api_endpoints?.some(({ path }) => path === "/chat/completions"),
      ),
    ).toBe(true);
    expect(models.every(({ price_facts }) => price_facts.length === 12)).toBe(true);
  });

  it("keeps catalog diagnostics outside the native pricing denominator", async () => {
    const normal: PricingReconciliationItem[] = [],
      changed: PricingReconciliationItem[] = [];
    const findings: SourceContractEvidence[] = [];
    await deepseekCatalog({ onPricingReconciliation: (item) => normal.push(item) });
    const catalog = (await fixture("deepseek/catalog.html")).replace("384K", "unreadable");
    const models = await deepseekCatalog({
      catalog,
      onContractFinding: (finding) => findings.push(finding),
      onPricingReconciliation: (item) => changed.push(item),
    });
    expect(changed).toEqual(normal);
    expect(
      findings
        .flatMap(({ diagnostics }) => diagnostics)
        .filter(({ path }) => path.includes("output_limit_claim_drift")),
    ).toHaveLength(3);
    expect(models.every(({ price_facts }) => price_facts.length === 12)).toBe(true);
  });

  it.each(["request", "nested", "quoted", "blockquote"])(
    "cannot acquire a response usage path from %s data",
    async (owner) => {
      const body = changedHtml(await fixture("deepseek/chat.html"), ($) => {
        const usage = $(".response strong.openapi-schema__property")
          .filter((_, node) => $(node).text() === "usage")
          .closest(".openapi-schema__list-item")
          .remove();
        if (owner === "request") $(".mime").append(usage);
        else if (owner === "nested")
          $(".response").append(
            '<div class="openapi-schema__list-item"><strong class="openapi-schema__property">metadata</strong><span class="openapi-schema__name">object</span>' +
              usage.toString() +
              "</div>",
          );
        else if (owner === "blockquote")
          $("article").append(
            '<blockquote><div class="openapi-markdown__details response">' +
              usage.toString() +
              "</div></blockquote>",
          );
        else $("article").append("<pre><code>" + usage.toString() + "</code></pre>");
      });
      const inputs = await accountingInputs(body);
      expect(inputs.filter(({ key }) => key.startsWith("chat."))).toEqual([]);
      expect(inputs.filter(({ key }) => !key.startsWith("chat."))).toHaveLength(12);
    },
  );

  it.each(["string", "number", "object"])("withholds only a retyped counter (%s)", async (type) => {
    const body = changedHtml(await fixture("deepseek/chat.html"), ($) => {
      $(".response strong.openapi-schema__property")
        .filter((_, node) => $(node).text() === "completion_tokens")
        .closest(".openapi-schema__list-item")
        .find(".openapi-schema__name")
        .text(type);
      $("article").append("<p>completion_tokens is mentioned outside the schema.</p>");
    });
    const inputs = await accountingInputs(body);
    expect(
      inputs.some(({ key }) => key === "chat.output_tokens" || key === "chat.stream.output_tokens"),
    ).toBe(false);
    expect(inputs.filter(({ key }) => key.startsWith("chat."))).toHaveLength(4);
  });

  it.each(["integer", "string"])(
    "does not select one of duplicate counter declarations (%s)",
    async (type) => {
      const body = changedHtml(await fixture("deepseek/chat.html"), ($) => {
        const field = $(".response strong.openapi-schema__property")
          .filter((_, node) => $(node).text() === "completion_tokens")
          .closest(".openapi-schema__list-item");
        const duplicate = field.clone();
        duplicate.find(".openapi-schema__name").text(type);
        field.after(duplicate);
      });
      const inputs = await accountingInputs(body);
      expect(
        inputs.some(
          ({ key }) => key === "chat.output_tokens" || key === "chat.stream.output_tokens",
        ),
      ).toBe(false);
      expect(inputs.filter(({ key }) => key.startsWith("chat."))).toHaveLength(4);
    },
  );

  it("rejects duplicate response usage roots", async () => {
    const body = changedHtml(await fixture("deepseek/chat.html"), ($) => {
      const usage = $(".response strong.openapi-schema__property")
        .filter((_, node) => $(node).text() === "usage")
        .closest(".openapi-schema__list-item");
      usage.after(usage.clone());
    });
    expect((await accountingInputs(body)).filter(({ key }) => key.startsWith("chat."))).toEqual([]);
  });

  it("keeps a direct counter when an unrelated nested lookalike is retyped", async () => {
    const body = changedHtml(await fixture("deepseek/chat.html"), ($) => {
      const usage = $(".response strong.openapi-schema__property")
        .filter((_, node) => $(node).text() === "usage")
        .closest(".openapi-schema__list-item");
      usage.append(
        '<div class="openapi-schema__list-item"><strong class="openapi-schema__property">details</strong><span class="openapi-schema__name">object</span><div class="openapi-schema__list-item"><strong class="openapi-schema__property">completion_tokens</strong><span class="openapi-schema__name">string</span></div></div>',
      );
    });
    expect(await accountingInputs(body)).toHaveLength(18);
  });

  it("cannot replace a missing direct counter with a nested lookalike", async () => {
    const body = changedHtml(await fixture("deepseek/chat.html"), ($) => {
      const field = $(".response strong.openapi-schema__property")
        .filter((_, node) => $(node).text() === "completion_tokens")
        .closest(".openapi-schema__list-item")
        .remove();
      $(".response strong.openapi-schema__property")
        .filter((_, node) => $(node).text() === "usage")
        .closest(".openapi-schema__list-item")
        .append(
          '<div class="openapi-schema__list-item"><strong class="openapi-schema__property">details</strong><span class="openapi-schema__name">object</span>' +
            field.toString() +
            "</div>",
        );
    });
    expect(
      (await accountingInputs(body)).filter(
        ({ key }) => key === "chat.output_tokens" || key === "chat.stream.output_tokens",
      ),
    ).toEqual([]);
  });

  it("does not acquire fields through a different operation", async () => {
    const body = (await fixture("deepseek/chat.html")).replace(
      "/chat/completions",
      "/other/completions",
    );
    expect((await accountingInputs(body)).filter(({ key }) => key.startsWith("chat."))).toEqual([]);
  });

  it("does not recover a retyped Responses cache field from a dotted prose marker", async () => {
    const body = changedHtml(await fixture("deepseek/responses.html"), ($) => {
      $(".response strong.openapi-schema__property")
        .filter((_, node) => $(node).text() === "cached_tokens")
        .closest(".openapi-schema__list-item")
        .find(".openapi-schema__name")
        .text("string");
      $("article").append("<p>input_tokens_details.cached_tokens</p>");
    });
    const inputs = await accountingInputs(undefined, body);
    expect(
      inputs.filter(
        ({ key }) => key.startsWith("responses.") && key.endsWith("cached_input_tokens"),
      ),
    ).toEqual([]);
    expect(inputs.filter(({ key }) => key.startsWith("responses."))).toHaveLength(4);
  });

  it.each(["outside", "string"])(
    "does not acquire Chat streaming from %s usage prose",
    async (change) => {
      const body = changedHtml(await fixture("deepseek/chat.html"), ($) => {
        const field = $(".mime strong.openapi-schema__property")
          .filter((_, node) => $(node).text() === "include_usage")
          .closest(".openapi-schema__list-item");
        if (change === "outside") $("article").append(field.remove());
        else field.find(".openapi-schema__name").text("string");
      });
      const inputs = await accountingInputs(body);
      expect(inputs.filter(({ key }) => key.startsWith("chat.stream."))).toEqual([]);
      expect(
        inputs.filter(({ key }) => key.startsWith("chat.") && !key.startsWith("chat.stream.")),
      ).toHaveLength(3);
    },
  );

  it.each(["result", "metadata"])(
    "requires the actual Responses stream wrapper (%s)",
    async (wrapper) => {
      const body = (await fixture("deepseek/responses.html")).replace(
        '"response":{"object"',
        '"' + wrapper + '":{"object"',
      );
      const inputs = await accountingInputs(undefined, body);
      expect(inputs.filter(({ key }) => key.startsWith("responses.stream."))).toEqual([]);
      expect(
        inputs.filter(
          ({ key }) => key.startsWith("responses.") && !key.startsWith("responses.stream."),
        ),
      ).toHaveLength(3);
    },
  );

  it("accepts the reviewed partial stream example without rewriting quoted property names", async () => {
    const body = (await fixture("deepseek/responses.html")).replace(
      '"object":"response","usage":{}',
      '"id":"...","object":"response","usage":{...}, ...',
    );
    expect(await accountingInputs(undefined, body)).toHaveLength(18);
    const altered = body.replace('"usage":{...}', '"us...age":{...}');
    expect(
      (await accountingInputs(undefined, altered)).filter(({ key }) =>
        key.startsWith("responses.stream."),
      ),
    ).toEqual([]);
  });

  it("withholds duplicated companion paths in either order", async () => {
    const good = await fixture("deepseek/chat.html");
    const bad = good.replace("prompt_cache_hit_tokens", "unbilled_tokens");
    for (const bodies of [
      [good, bad],
      [bad, good],
    ]) {
      const inputs = extractDeepseekPricingInputs(
        bodies.map((body) => ({
          url: "https://api-docs.deepseek.com/api/create-chat-completion",
          body,
        })),
        "deepseek-catalog",
      );
      expect(inputs.filter(({ key }) => key.startsWith("chat."))).toEqual([]);
    }
  });

  it("keeps rates, quantity equations and pricing-row accounting when one usage field drifts", async () => {
    const normal: PricingReconciliationItem[] = [],
      changed: PricingReconciliationItem[] = [];
    const findings: SourceContractEvidence[] = [];
    const before = await deepseekCatalog({ onPricingReconciliation: (item) => normal.push(item) });
    const responses = (await fixture("deepseek/responses.html")).replace(
      "cached_tokens",
      "unbilled_tokens",
    );
    const modelsSource = await deepseekSource({
      responses,
      onContractFinding: (finding) => findings.push(finding),
      onPricingReconciliation: (item) => changed.push(item),
    });
    const models = modelsSource.models;
    expect(changed).toEqual(normal);
    expect(contractPaths(findings).filter((path) => path.startsWith("/documents/"))).toHaveLength(
      2,
    );
    expect(models.map(({ price_facts }) => price_facts)).toEqual(
      before.map(({ price_facts }) => price_facts),
    );
    const source = manifest("deepseek").sources[0];
    if (source === undefined) throw new Error("Missing DeepSeek source");
    const partition = assembleParsedProviderPricing(
      "deepseek",
      observedAt,
      [{ source, ...modelsSource }],
      models,
    );
    validateParsedPricing(manifest("deepseek"), source, models, partition);
    const offer = partition?.books
      .find(({ book_key }) => book_key === "model:deepseek/deepseek-v4-flash")
      ?.offers.find(({ offer_key }) => offer_key === "payg");
    const rate = offer?.terms.find(
      (term) => term.kind === "rate" && term.meter.value === "input_text",
    );
    if (rate?.kind !== "rate") throw new Error("Missing input rate");
    expect(
      rate.variants
        .flatMap(({ charge_binding }) => charge_binding?.quantity_methods ?? [])
        .some(({ calculation }) =>
          calculation?.nodes.some(({ op }) => op === "subtract_floor_zero"),
        ),
    ).toBe(true);
  });

  function source(id: string): SourceManifest {
    const configured = manifest("deepseek").sources.find((item) => item.id === id);
    if (configured === undefined) throw new Error(`Missing DeepSeek source ${id}`);
    return configured;
  }

  it("keeps explicitly accepted legacy request IDs with the current redirect target's rates", async () => {
    const catalog = await fixture("deepseek/redirects.html");
    const vision = (await fixture("deepseek/vision.html"))
      .replace("deepseek-v4-flash-vision-exp", "deepseek-flash")
      .replace(
        "analyze charts, and more.",
        "analyze charts, and more. The legacy model name <code>deepseek-v4-flash-vision-exp</code> is still accepted, but its requests are served by the latest Flash model.",
      );
    const models = await deepseekCatalog({
      catalog,
      vision,
      observedAt: "2026-09-11T00:00:00.000Z",
    });
    const target = models.find(({ model_id }) => model_id === "deepseek-flash");
    if (target === undefined) throw new Error("Missing redirected Flash target");
    expect(target.modalities.input).toEqual(["text", "image"]);
    for (const id of ["deepseek-v4-flash", "deepseek-v4-flash-vision-exp"]) {
      const legacy = models.find(({ model_id }) => model_id === id);
      if (legacy === undefined) throw new Error(`Missing accepted legacy ID ${id}`);
      expect(legacy).toMatchObject({ status: "legacy", replacement_model_ids: [target.model_id] });
      expect(
        legacy.price_facts.map(({ meter, price, currency, conditions }) => ({
          meter,
          price,
          currency,
          conditions,
        })),
      ).toEqual(
        target.price_facts.map(({ meter, price, currency, conditions }) => ({
          meter,
          price,
          currency,
          conditions,
        })),
      );
      expect(legacy.price_facts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ meter: "input_text", price: "0.15", derived: true }),
          expect.objectContaining({ meter: "output_text", price: "0.6", derived: true }),
        ]),
      );
    }
    expect(models.find(({ model_id }) => model_id === "deepseek-v4-pro")?.status).toBe("active");
    const unknownBilling = await deepseekCatalog({
      catalog: catalog.replace("and billed at the Flash price", "with unpublished billing"),
      observedAt: "2026-09-11T00:00:00.000Z",
    });
    expect(unknownBilling.map(({ model_id }) => model_id)).toEqual([
      "deepseek-flash",
      "deepseek-v4-pro",
    ]);
  });

  it("retains explicit legacy redirects when the served model version has a dated suffix", async () => {
    const catalog = (await fixture("deepseek/redirects.html")).replaceAll(
      "DeepSeek-V4.1-Flash",
      "DeepSeek-V4.1-Flash-1017",
    );
    const models = await deepseekCatalog({ catalog, observedAt: "2026-10-19T00:00:00.000Z" });
    const target = models.find(({ model_id }) => model_id === "deepseek-flash");
    expect(target?.name).toBe("DeepSeek-V4.1-Flash-1017");
    for (const id of ["deepseek-v4-flash", "deepseek-v4-flash-vision-exp"]) {
      const legacy = models.find(({ model_id }) => model_id === id);
      expect(legacy).toMatchObject({ status: "legacy", replacement_model_ids: ["deepseek-flash"] });
      expect(
        legacy?.price_facts.map(({ meter, price, currency, conditions }) => ({
          meter,
          price,
          currency,
          conditions,
        })),
      ).toEqual(
        target?.price_facts.map(({ meter, price, currency, conditions }) => ({
          meter,
          price,
          currency,
          conditions,
        })),
      );
      expect(
        legacy?.price_facts.every(
          ({ derived, derivation }) => derived && derivation?.includes("deepseek-flash"),
        ),
      ).toBe(true);
    }
    for (const changed of [
      catalog.replace("billed at the Flash price", "billed at the Pro price"),
      catalog.replace(
        "DeepSeek-V4.1-Flash-1017 model and billed",
        "DeepSeek-V4.1-Flash-1018 model and billed",
      ),
    ]) {
      expect((await deepseekCatalog({ catalog: changed })).map(({ model_id }) => model_id)).toEqual(
        ["deepseek-flash", "deepseek-v4-pro"],
      );
    }
  });

  it("reads the current callable catalog without a product-name allowlist", async () => {
    expect(manifest("deepseek")).not.toHaveProperty("supersededModelIds");
    const catalogSource = source("deepseek-catalog");
    expect(catalogSource).toMatchObject({
      extractorVersion: "deepseek-catalog-v22",
      fields: expect.arrayContaining(["api_endpoints", "pricing_inputs"]),
      linkedDocuments: {
        minDocuments: 0,
        maxDocuments: 0,
      },
    });
    expect(catalogSource.linkedDocuments?.documents?.map(({ id, url }) => ({ id, url }))).toEqual([
      {
        id: "chat-completions",
        url: "https://api-docs.deepseek.com/api/create-chat-completion",
      },
      { id: "responses", url: "https://api-docs.deepseek.com/api/create-response" },
      { id: "fim-completion", url: "https://api-docs.deepseek.com/api/create-completion" },
      { id: "anthropic-api", url: "https://api-docs.deepseek.com/guides/anthropic_api" },
      { id: "vision", url: "https://api-docs.deepseek.com/guides/vision" },
      {
        id: "model-inventory",
        url: "https://api-docs.deepseek.com/api/list-models",
      },
      {
        id: "cny-pricing",
        url: "https://api-docs.deepseek.com/zh-cn/quick_start/pricing/",
      },
    ]);
    expect(catalogSource.linkedDocuments?.documents?.every(({ optional }) => optional)).toBe(true);
    const findings: SourceContractEvidence[] = [];
    const modelsSource = await deepseekSource({
      onContractFinding: (finding) => findings.push(finding),
    });
    const models = modelsSource.models;
    expect(contractPaths(findings)).toEqual([
      "/deepseek/fim_inventory_disagreement",
      "/deepseek/model_inventory_disagreement",
    ]);
    const inputs = modelsSource.pricing_inputs ?? [];
    expect(inputs).toHaveLength(18);
    expect(inputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "chat.cached_input_tokens",
          channel: "response",
          locator: { kind: "json_pointer", value: "/usage/prompt_cache_hit_tokens" },
          availability: "success_only",
        }),
        expect.objectContaining({
          key: "chat.stream.uncached_input_tokens",
          channel: "stream_event",
          locator: { kind: "json_pointer", value: "/usage/prompt_cache_miss_tokens" },
          availability: "terminal_only",
        }),
        expect.objectContaining({
          key: "responses.stream.cached_input_tokens",
          channel: "stream_event",
          locator: {
            kind: "json_pointer",
            value: "/response/usage/input_tokens_details/cached_tokens",
          },
          availability: "terminal_only",
        }),
        expect.objectContaining({
          key: "fim.stream.output_tokens",
          channel: "stream_event",
          locator: { kind: "json_pointer", value: "/usage/completion_tokens" },
          availability: "terminal_only",
        }),
      ]),
    );
    expect(inputs.every(({ key }) => !key.startsWith("anthropic."))).toBe(true);
    expect(models.map(({ model_id }) => model_id)).toEqual([
      "deepseek-v4-flash",
      "deepseek-v4-flash-vision-exp",
      "deepseek-v4-pro",
    ]);
    expect(models.find(({ model_id }) => model_id === "deepseek-v4-pro")).toMatchObject({
      name: "DeepSeek-V4-Pro-0813",
      tasks: ["text_generation"],
      api_endpoints: [
        { name: "Chat Completions", path: "/chat/completions" },
        { name: "Responses", path: "/responses" },
        { name: "FIM Completion (Beta)", path: "/beta/completions" },
        { name: "Anthropic Messages", path: "/anthropic/v1/messages" },
      ],
      modalities: { input: ["text"], output: ["text"] },
      capabilities: {
        reasoning: true,
        effort_control: true,
        tool_call: true,
        structured_output: true,
        streaming: true,
        prompt_cache: true,
      },
      limits: { context_tokens: 1_000_000, max_output_tokens: 384_000 },
      pricing_state: "numeric",
      price_facts: expect.arrayContaining([
        expect.objectContaining({
          meter: "cache_read_text",
          price: "0.022",
          currency: "USD",
          conditions: { billing_currency: "USD", billing_period: "off_peak" },
        }),
        expect.objectContaining({
          meter: "input_text",
          price: "1.32",
          currency: "USD",
          conditions: { billing_currency: "USD", billing_period: "peak" },
        }),
        expect.objectContaining({
          meter: "output_text",
          price: "13.5",
          currency: "CNY",
          conditions: expect.objectContaining({ billing_period: "off_peak" }),
        }),
      ]),
    });
    expect(models.find(({ model_id }) => model_id === "deepseek-v4-flash")?.api_endpoints).toEqual([
      { name: "Chat Completions", path: "/chat/completions" },
      { name: "Responses", path: "/responses" },
      { name: "Anthropic Messages", path: "/anthropic/v1/messages" },
    ]);
    expect(
      models.find(({ model_id }) => model_id === "deepseek-v4-flash-vision-exp"),
    ).toMatchObject({
      name: "DeepSeek-V4-Flash-Vision-Exp",
      tasks: ["text_generation"],
      modalities: { input: ["text", "image"], output: ["text"] },
      api_endpoints: [
        { name: "Chat Completions", path: "/chat/completions" },
        { name: "Responses", path: "/responses" },
        { name: "Anthropic Messages", path: "/anthropic/v1/messages" },
      ],
      pricing_state: "numeric",
    });
  });

  it("keeps price-table rows when interface claims drift", async () => {
    const chat = await fixture("deepseek/chat.html");
    const operationFindings: SourceContractEvidence[] = [];
    const changedOperation = await deepseekCatalog({
      chat: chat.replace("/chat/completions", "/v2/chat/completions"),
      onContractFinding: (finding) => operationFindings.push(finding),
    });
    expect(changedOperation).toHaveLength(3);
    expect(changedOperation.every(({ price_facts }) => price_facts.length === 12)).toBe(true);
    expect(
      changedOperation.every(
        ({ api_endpoints }) =>
          api_endpoints?.some(({ path }) => path === "/chat/completions") !== true,
      ),
    ).toBe(true);
    expect(contractPaths(operationFindings)).toContain(
      "/deepseek/chat_operation_contract_drift/Chat Completions",
    );

    const findings: SourceContractEvidence[] = [];
    const changedUsageSource = await deepseekSource({
      chat: chat.replace("prompt_cache_hit_tokens", "cached_tokens"),
      onContractFinding: (finding) => findings.push(finding),
    });
    const changedUsage = changedUsageSource.models;
    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          diagnostics: [
            expect.objectContaining({
              path: "/documents/api/create-chat-completion/chat.cached_input_tokens",
            }),
          ],
        }),
        expect.objectContaining({
          diagnostics: [
            expect.objectContaining({
              path: "/documents/api/create-chat-completion/chat.stream.cached_input_tokens",
            }),
          ],
        }),
      ]),
    );
    expect(contractPaths(findings).filter((path) => path.startsWith("/documents/"))).toHaveLength(
      2,
    );
    expect(changedUsageSource.pricing_inputs ?? []).toHaveLength(16);
    expect(
      changedUsage.find(({ model_id }) => model_id === "deepseek-v4-pro")?.api_endpoints,
    ).toContainEqual({ name: "Chat Completions", path: "/chat/completions" });
    const changedPricing = assembleParsedProviderPricing(
      "deepseek",
      observedAt,
      [{ source: source("deepseek-catalog"), ...changedUsageSource }],
      changedUsage,
    );
    const flash = changedPricing?.books
      .find(({ book_key }) => book_key === "model:deepseek/deepseek-v4-flash")
      ?.offers.find(({ offer_key }) => offer_key === "payg");
    expect(
      flash?.terms.some(({ term_key }) => term_key.startsWith("accounting_binding_unavailable:")),
    ).toBe(false);
    const cache = flash?.terms.find(
      (term) => term.kind === "rate" && term.meter.value === "cache_read_text",
    );
    expect(
      cache?.kind === "rate"
        ? cache.variants[0]?.charge_binding?.quantity_methods?.flatMap(
            ({ input_sources }) => input_sources ?? [],
          )
        : [],
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          channel: "response",
          locator: {
            kind: "json_pointer",
            value: "/usage/input_tokens_details/cached_tokens",
          },
        }),
        expect.objectContaining({
          channel: "stream_event",
          locator: {
            kind: "json_pointer",
            value: "/response/usage/input_tokens_details/cached_tokens",
          },
        }),
      ]),
    );
    const output = flash?.terms.find(
      (term) => term.kind === "rate" && term.meter.value === "output_text",
    );
    expect(
      output?.kind === "rate"
        ? output.variants[0]?.charge_binding?.quantity_methods?.flatMap(
            ({ input_sources }) => input_sources ?? [],
          )
        : [],
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          channel: "response",
          locator: { kind: "json_pointer", value: "/usage/completion_tokens" },
        }),
        expect.objectContaining({
          channel: "stream_event",
          locator: { kind: "json_pointer", value: "/response/usage/output_tokens" },
        }),
      ]),
    );

    const changedAnthropic = await deepseekCatalog({
      overrides: {
        "guides/anthropic_api": (await fixture("deepseek/anthropic.html")).replace(
          "https://api.deepseek.com/anthropic",
          "https://api.deepseek.com/future-anthropic",
        ),
      },
    });
    expect(changedAnthropic).toHaveLength(3);
    expect(changedAnthropic.every(({ price_facts }) => price_facts.length === 12)).toBe(true);
    expect(
      changedAnthropic.every(
        ({ api_endpoints }) =>
          api_endpoints?.some(({ path }) => path === "/anthropic/v1/messages") !== true,
      ),
    ).toBe(true);

    const responses = await fixture("deepseek/responses.html");
    const responseFindings: SourceContractEvidence[] = [];
    await expect(
      deepseekCatalog({
        responses: responses.replace("deepseek-v4-flash-vision-exp", "deepseek-v4-unknown"),
        onContractFinding: (finding) => responseFindings.push(finding),
      }),
    ).resolves.toHaveLength(3);
    expect(contractPaths(responseFindings)).toContain("/deepseek/responses_inventory_disagreement");
  });

  it("parses model columns and price records independently", async () => {
    const catalog = await fixture("deepseek/catalog.html");
    const reconciliation: PricingReconciliationItem[] = [];
    const findings: SourceContractEvidence[] = [];
    const models = await deepseekCatalog({
      catalog: catalog
        .replace("$0.022", "TBD")
        .replace("</table>", '<tr><td colspan="2">NEW FACT</td><td>x</td><td>y</td></tr></table>'),
      onPricingReconciliation: (item) => reconciliation.push(item),
      onContractFinding: (finding) => findings.push(finding),
    });
    expect(models).toHaveLength(3);
    expect(
      models
        .find(({ model_id }) => model_id === "deepseek-v4-pro")
        ?.price_facts.filter(({ currency }) => currency === "USD"),
    ).toHaveLength(5);
    expect(reconciliation).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason_code: "price_cell_preserved", disposition: "raw" }),
      ]),
    );

    expect(contractPaths(findings)).toContain("/deepseek/catalog_row_unhandled/NEW FACT");
    const cny = await fixture("deepseek/catalog-cny.html");
    const cnyModels = await deepseekCatalog({
      overrides: { "zh-cn/quick_start/pricing/": cny.replace("0.15元", "待定") },
    });
    expect(
      cnyModels
        .find(({ model_id }) => model_id === "deepseek-v4-pro")
        ?.price_facts.filter(({ currency }) => currency === "CNY"),
    ).toHaveLength(5);

    const scheduledReconciliation: PricingReconciliationItem[] = [];
    const scheduledDrift = await deepseekCatalog({
      catalog: catalog.replace("$1.98", "TBD"),
      onPricingReconciliation: (item) => scheduledReconciliation.push(item),
    });
    expect(
      scheduledDrift
        .find(({ model_id }) => model_id === "deepseek-v4-pro")
        ?.price_facts.filter(({ currency }) => currency === "USD"),
    ).toHaveLength(5);
    expect(scheduledReconciliation).toContainEqual(
      expect.objectContaining({ reason_code: "price_cell_preserved", disposition: "raw" }),
    );

    const oneColumn = await deepseekCatalog({
      catalog: catalog.replace("deepseek-v4-pro</td>", "invalid model id</td>"),
    });
    expect(oneColumn.map(({ model_id }) => model_id)).toEqual([
      "deepseek-v4-flash",
      "deepseek-v4-flash-vision-exp",
    ]);
  });

  it("preserves an unreadable quote with its exact known scope and usable siblings", async () => {
    const reconciliation: PricingReconciliationItem[] = [];
    const failures: string[] = [];
    const modelsSource = await deepseekSource({
      catalog: (await fixture("deepseek/catalog.html")).replace("$0.022", "EUR 0.022"),
      onPricingReconciliation: (item) => reconciliation.push(item),
      onPricingDependencyFailure: (url) => failures.push(url),
    });
    const models = modelsSource.models;
    expect(failures).toEqual([]);
    const pro = models.find(({ model_id }) => model_id === "deepseek-v4-pro");
    expect(pro?.price_facts).toHaveLength(11);
    expect(pro?.raw_price_facts.filter(({ impact }) => impact === "base_price")).toEqual([
      expect.objectContaining({
        term_key: "unparsed:cache_read_text",
        reason: "unknown_amount",
        conditions: { billing_currency: "USD", billing_period: "off_peak" },
        raw: expect.objectContaining({
          amount: "EUR 0.022",
          meter: "cache_read_text",
          unit: "million tokens",
        }),
      }),
    ]);
    expect(sourcePricingReconciliation(models, reconciliation, true)).toMatchObject({
      disposition_counts: { normalized: 37, raw: 1 },
      diagnostic_count: 0,
    });
    const configured = source("deepseek-catalog");
    const partition = assembleParsedProviderPricing(
      "deepseek",
      observedAt,
      [{ source: configured, ...modelsSource }],
      models,
    );
    const core = validateParsedPricing(manifest("deepseek"), configured, models, partition);
    const raw = partition?.books
      .flatMap(({ offers }) => offers)
      .flatMap(({ terms }) => terms)
      .flatMap((term) =>
        term.kind === "raw" && term.term_key === "unparsed:cache_read_text"
          ? term.variants.flatMap(({ observations }) => observations.map(({ raw }) => raw))
          : [],
      );
    expect(raw).toEqual([
      expect.objectContaining({ amount: "EUR 0.022", meter: "cache_read_text" }),
    ]);
    if (partition === undefined || pro === undefined) throw new Error("Missing parsed prices");
    const offer = partition.books.find(({ scope }) => scope.model_refs.includes(pro.uid))
      ?.offers[0];
    if (offer === undefined) throw new Error("Missing Pro offer");
    const calculator = createCalculator(
      calculationExport(core, {
        core_catalog_version: core.catalog_version,
        core_data_sha256: "c".repeat(64),
        pricing_data_version: "b".repeat(64),
        generated_at: observedAt,
        data: {
          books: partition.books,
          provider_snapshots: [partition.snapshot],
          provider_vocabularies: [partition.vocabulary],
          model_dispositions: partition.model_dispositions,
        },
      }),
    );
    const calculate = (currency: string, period: string) =>
      calculator.calculate({
        evaluatedAt: observedAt,
        components: [
          {
            id: "request",
            offerRef: offer.id,
            selectors: [
              {
                kind: "categorical",
                dimension: { namespace: "kmodels", value: "billing_currency" },
                value: { namespace: "provider", provider_id: "deepseek", value: currency },
              },
              {
                kind: "categorical",
                dimension: { namespace: "kmodels", value: "billing_period" },
                value: { namespace: "provider", provider_id: "deepseek", value: period },
              },
            ],
            quantities: [
              {
                signal: { namespace: "kmodels", value: "uncached_input_tokens" },
                value: { numerator: "1000000", denominator: "1" },
              },
              {
                signal: { namespace: "kmodels", value: "cached_input_tokens" },
                value: { numerator: "1000000", denominator: "1" },
              },
              {
                signal: { namespace: "kmodels", value: "output_tokens" },
                value: { numerator: "0", denominator: "1" },
              },
            ],
          },
        ],
      });
    const partial = calculate("USD", "off_peak");
    expect(partial.status).toBe("partial");
    expect(partial.unresolved).toContainEqual(
      expect.objectContaining({ code: "unsupported_structure", reason: "unknown_amount" }),
    );
    expect(calculate("USD", "peak")).toMatchObject({
      status: "calculated",
      totals: [
        {
          denomination: { kind: "fiat", currency: "USD" },
          amount: { numerator: "341", denominator: "250" },
        },
      ],
    });
    expect(calculate("CNY", "off_peak")).toMatchObject({
      status: "calculated",
      totals: [
        {
          denomination: { kind: "fiat", currency: "CNY" },
          amount: { numerator: "93", denominator: "20" },
        },
      ],
    });
  });

  it("withholds every conflicting inline quote independently of source order", async () => {
    const original = await fixture("deepseek/catalog.html");
    const duplicate =
      "<tr><td>PRICING</td><td>1M INPUT TOKENS (CACHE HIT)</td><td>OFF-PEAK</td><td>$9</td><td>$8</td><td>$7</td></tr>";
    const variants = [
      changedHtml(original, ($) => {
        $("table tr").eq(2).after(duplicate);
      }),
      changedHtml(original, ($) => {
        $("table").append(duplicate);
      }),
    ];
    const books = [];
    for (const catalog of variants) {
      const items: PricingReconciliationItem[] = [];
      const modelsSource = await deepseekSource({
        catalog,
        onPricingReconciliation: (item) => items.push(item),
      });
      const models = modelsSource.models;
      for (const model of models) {
        expect(model.price_facts.filter(({ currency }) => currency === "USD")).toHaveLength(5);
        expect(
          model.price_facts.some(
            ({ meter, currency, conditions }) =>
              meter === "cache_read_text" &&
              currency === "USD" &&
              conditions.billing_period === "off_peak",
          ),
        ).toBe(false);
        expect(
          model.raw_price_facts.filter(
            ({ impact, reason }) => impact === "base_price" && reason === "unsupported_structure",
          ),
        ).toHaveLength(2);
      }
      expect(sourcePricingReconciliation(models, items, true)).toMatchObject({
        disposition_counts: { normalized: 35, raw: 6 },
        diagnostic_count: 0,
      });
      const configured = source("deepseek-catalog");
      const partition = assembleParsedProviderPricing(
        "deepseek",
        observedAt,
        [{ source: configured, ...modelsSource }],
        models,
      );
      validateParsedPricing(manifest("deepseek"), configured, models, partition);
      books.push(partition?.books);
    }
    expect(books[0]).toEqual(books[1]);
  });

  it("withholds conflicting separate-table quotes instead of selecting the first row", async () => {
    const catalog = changedHtml(await fixture("deepseek/catalog-transition.html"), ($) => {
      $("table")
        .last()
        .append(
          "<tr><td>deepseek-v4-flash</td><td>OFF-PEAK</td><td>$9</td><td>$8</td><td>$7</td></tr>",
        );
    });
    const models = await deepseekCatalog({
      catalog,
      overrides: {
        "zh-cn/quick_start/pricing/": await fixture("deepseek/catalog-transition-cny.html"),
      },
    });
    const flash = models[0];
    expect(flash?.price_facts.filter(({ currency }) => currency === "USD")).toHaveLength(6);
    const raw = flash?.raw_price_facts.filter(({ impact }) => impact === "base_price") ?? [];
    expect(raw).toHaveLength(6);
    expect(
      raw.every(
        ({ reason, conditions }) =>
          reason === "unsupported_structure" &&
          conditions.effective_from === "2026-08-16T16:00:00.000Z" &&
          conditions.billing_period === "off_peak",
      ),
    ).toBe(true);
  });

  it("preserves the exact validity of a damaged pre-transition quote", async () => {
    const items: PricingReconciliationItem[] = [];
    const models = await deepseekCatalog({
      catalog: (await fixture("deepseek/catalog-transition.html")).replace("$0.0028", "TBD"),
      overrides: {
        "zh-cn/quick_start/pricing/": await fixture("deepseek/catalog-transition-cny.html"),
      },
      onPricingReconciliation: (item) => items.push(item),
    });
    expect(models[0]?.price_facts).toHaveLength(17);
    expect(models[0]?.raw_price_facts.filter(({ impact }) => impact === "base_price")).toEqual([
      expect.objectContaining({
        reason: "unknown_amount",
        conditions: { billing_currency: "USD", effective_until: "2026-08-16T16:00:00.000Z" },
        raw: expect.objectContaining({ amount: "TBD" }),
      }),
    ]);
    expect(sourcePricingReconciliation(models, items, true)).toMatchObject({
      observed_items: 20,
      disposition_counts: { normalized: 19, raw: 1 },
      diagnostic_count: 0,
    });
  });

  it("localizes malformed inline billing-period labels", async () => {
    const catalog = await fixture("deepseek/catalog.html");
    const reconciliation: PricingReconciliationItem[] = [];
    const models = await deepseekCatalog({
      catalog: catalog
        .replaceAll("<td>OFF-PEAK</td>", "<td>INVALID</td>")
        .replaceAll("<td>PEAK</td>", "<td>INVALID</td>"),
      onPricingReconciliation: (item) => reconciliation.push(item),
    });

    expect(
      models.flatMap(({ price_facts }) => price_facts).filter(({ currency }) => currency === "USD"),
    ).toEqual([]);
    expect(reconciliation).toContainEqual(
      expect.objectContaining({ reason_code: "scheduled_billing_period_claim_drift" }),
    );
    for (const model of models) {
      const raw = model.raw_price_facts.filter(({ impact }) => impact === "base_price");
      expect(raw).toHaveLength(6);
      expect(
        raw.every(
          ({ reason, conditions, raw }) =>
            reason === "unknown_applicability" &&
            conditions.billing_currency === "USD" &&
            conditions.billing_period === undefined &&
            raw.conditions?.some(({ value }) => value === "INVALID"),
        ),
      ).toBe(true);
      expect(model.price_facts.filter(({ currency }) => currency === "CNY")).toHaveLength(6);
    }
  });

  it.each([
    "CNY time",
    "currency policy",
    "effective instant",
    "missing period",
    "unbound column",
    "duplicate CNY table",
  ])("isolates %s failure from valid catalog metadata", async (failure) => {
    let catalog = await fixture("deepseek/catalog.html");
    let cny = await fixture("deepseek/catalog-cny.html");
    if (failure === "CNY time") cny = cny.replaceAll("12:00", "13:00");
    if (failure === "currency policy")
      cny = cny.replace(
        /空闲时段价格为高峰时段价格的一半。[\s\S]*?统一按照低谷时段价格收取调用费用。/,
        "高峰时段为北京时间周一至周五 9:00 - 12:00、14:00 - 18:00（其余为空闲时段）。",
      );
    if (failure === "effective instant") {
      catalog = await fixture("deepseek/catalog-transition.html");
      cny = (await fixture("deepseek/catalog-transition-cny.html")).replace(
        "17 日 00:00",
        "17 日 01:00",
      );
    }
    if (failure === "missing period")
      catalog = changedHtml(catalog, ($) => {
        $("td")
          .filter((_index, element) => $(element).text() === "$0.022")
          .parent()
          .remove();
      });
    if (failure === "unbound column")
      catalog = catalog.replace("deepseek-v4-pro</td>", "unbound model id</td>");
    if (failure === "duplicate CNY table")
      cny = changedHtml(cny, ($) => {
        $("article").append($("table").clone());
      });
    const failures: string[] = [];
    const items: PricingReconciliationItem[] = [];
    const models = await deepseekCatalog({
      catalog: catalog.replace("DeepSeek-V4-Flash", "Updated-Flash"),
      overrides: { "zh-cn/quick_start/pricing/": cny },
      onPricingDependencyFailure: (url) => failures.push(url),
      onPricingReconciliation: (item) => items.push(item),
    });
    expect(models.find(({ model_id }) => model_id === "deepseek-v4-flash")?.name).toContain(
      "Updated-Flash",
    );
    expect(failures.length).toBeGreaterThan(0);
    expect(
      items.some(({ disposition }) => disposition === "unresolved" || disposition === "unbound"),
    ).toBe(true);
  });

  it("derives historical schedules from the proven rule rather than the compilation date", async () => {
    const dailySource = await deepseekSource({
      catalog: await fixture("deepseek/catalog-transition.html"),
      overrides: {
        "zh-cn/quick_start/pricing/": await fixture("deepseek/catalog-transition-cny.html"),
      },
    });
    const daily = dailySource.models;
    const configured = source("deepseek-catalog");
    const later = assembleParsedProviderPricing(
      "deepseek",
      "2026-09-01T00:00:00.000Z",
      [{ source: configured, ...dailySource }],
      daily,
    );
    const peak = later?.vocabulary.atoms.find(
      (atom) => atom.kind === "categorical_value" && atom.key === "peak",
    );
    expect(peak).toMatchObject({ schedule: { kind: "daily_time_windows" } });
  });

  it("requires the current weekend rule after its published effective instant", async () => {
    await expect(deepseekCatalog({ observedAt: "2026-08-23T00:00:00.000Z" })).resolves.toHaveLength(
      3,
    );
    const catalog = await fixture("deepseek/catalog.html");
    const failures: string[] = [];
    const changed = await deepseekCatalog({
      catalog: catalog.replace(
        "on weekends (Saturdays and Sundays, Beijing Time)",
        "on weekdays (Mondays through Fridays, Beijing Time)",
      ),
      observedAt: "2026-08-23T00:00:00.000Z",
      onPricingDependencyFailure: (url) => failures.push(url),
    });
    expect(changed).toHaveLength(3);
    expect(failures).toContain(source("deepseek-catalog").url);
    expect(
      changed.every(({ price_facts }) => price_facts.every(({ currency }) => currency !== "USD")),
    ).toBe(true);
  });

  it("accepts the recurring weekday form after the weekend transition", async () => {
    const catalog = (await fixture("deepseek/catalog.html")).replace(
      /Off-peak rates are half of the peak rates\.[\s\S]*?on weekends \(Saturdays and Sundays, Beijing Time\)\./,
      "Off-peak rates are half of the peak rates. Peak hours are 01:00 - 04:00 and 06:00 - 10:00 UTC, Monday through Friday (all other hours are off-peak).",
    );
    const cny = (await fixture("deepseek/catalog-cny.html")).replace(
      /空闲时段价格为高峰时段价格的一半。[\s\S]*?统一按照低谷时段价格收取调用费用。/,
      "空闲时段价格为高峰时段价格的一半。高峰时段为北京时间周一至周五 9:00 - 12:00、14:00 - 18:00（其余为空闲时段）。",
    );
    await expect(
      deepseekCatalog({
        catalog,
        observedAt: "2026-09-01T00:00:00.000Z",
        overrides: { "zh-cn/quick_start/pricing/": cny },
      }),
    ).resolves.toHaveLength(3);
  });

  it("preserves holiday peak applicability as a caller-selected category without a calendar", async () => {
    const rule =
      "Peak hours are 01:00 - 04:00 and 06:00 - 10:00 UTC, Monday through Friday, excluding Chinese public holidays. All other hours are off-peak, including weekends and Chinese public holidays in full.";
    const catalog = (await fixture("deepseek/catalog.html")).replace(
      /Off-peak rates are half of the peak rates\.[\s\S]*?on weekends \(Saturdays and Sundays, Beijing Time\)\./,
      `Off-peak rates are half of the peak rates. ${rule}`,
    );
    const cny = (await fixture("deepseek/catalog-cny.html")).replace(
      /空闲时段价格为高峰时段价格的一半。[\s\S]*?统一按照低谷时段价格收取调用费用。/,
      "空闲时段价格为高峰时段价格的一半。北京时间周一至周五（不含中国法定节假日）9:00 - 12:00、14:00 - 18:00 为高峰时段；其余时段，包括周末及中国法定节假日全天均为空闲时段。",
    );
    const date = "2026-09-20T00:00:00.000Z";
    const modelsSource = await deepseekSource({
      catalog,
      observedAt: date,
      overrides: { "zh-cn/quick_start/pricing/": cny },
    });
    const models = modelsSource.models;
    expect(models).toHaveLength(3);
    for (const model of models) {
      expect(model.price_facts.filter(({ currency }) => currency === "USD")).toHaveLength(6);
      expect(model.price_facts.filter(({ currency }) => currency === "CNY")).toHaveLength(6);
    }
    const configured = source("deepseek-catalog");
    const partition = assembleParsedProviderPricing(
      "deepseek",
      date,
      [{ source: configured, ...modelsSource }],
      models,
    );
    validateParsedPricing(manifest("deepseek"), configured, models, partition);
    const periods =
      partition?.vocabulary.atoms.filter(
        (atom) => atom.kind === "categorical_value" && atom.dimension.value === "billing_period",
      ) ?? [];
    expect(periods.map(({ key }) => key).sort()).toEqual(["off_peak", "peak"]);
    for (const atom of periods) {
      expect(atom).not.toHaveProperty("schedule");
      expect(atom.definition).toContain(rule);
      expect(atom.definition).toContain("caller supplies");
    }
    const failures: string[] = [];
    const changed = await deepseekCatalog({
      catalog: catalog.replace("01:00 - 04:00", "02:00 - 04:00"),
      observedAt: date,
      overrides: { "zh-cn/quick_start/pricing/": cny },
      onPricingDependencyFailure: (url) => failures.push(url),
    });
    expect(changed).toHaveLength(3);
    expect(failures).toContain(configured.url);
  });

  it("preserves exact validity across a separately published price transition", async () => {
    const models = await deepseekCatalog({
      catalog: await fixture("deepseek/catalog-transition.html"),
      overrides: {
        "zh-cn/quick_start/pricing/": await fixture("deepseek/catalog-transition-cny.html"),
      },
    });
    const rates = models[0]?.price_facts ?? [];

    expect(rates.filter(({ currency }) => currency === "USD")).toHaveLength(9);
    expect(rates.filter(({ currency }) => currency === "CNY")).toHaveLength(9);
    expect(rates.map(({ conditions }) => conditions)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ effective_until: "2026-08-16T16:00:00.000Z" }),
        expect.objectContaining({
          billing_period: "peak",
          effective_from: "2026-08-16T16:00:00.000Z",
        }),
      ]),
    );
  });

  it("uses public inventory as a non-destructive witness", async () => {
    const inventory = await fixture("deepseek/list-models.html");
    const findings: SourceContractEvidence[] = [];
    await expect(
      deepseekCatalog({
        inventory: inventory.replaceAll("deepseek-v4-pro", "deepseek-v4-unknown"),
        onContractFinding: (finding) => findings.push(finding),
      }),
    ).resolves.toHaveLength(3);
    expect(contractPaths(findings)).toContain("/deepseek/model_inventory_disagreement");

    const withoutCompanions = await deepseekCatalog({ withoutDocuments: true });
    expect(withoutCompanions.map(({ model_id }) => model_id)).toEqual([
      "deepseek-v4-flash",
      "deepseek-v4-flash-vision-exp",
      "deepseek-v4-pro",
    ]);
    expect(withoutCompanions.every(({ price_facts }) => price_facts.length === 6)).toBe(true);
  });

  it("keeps the rate book limited to current request-attributable inference", async () => {
    const reconciliation: PricingReconciliationItem[] = [];
    const findings: SourceContractEvidence[] = [];
    const models = await deepseekCatalog({
      onPricingReconciliation: (item) => reconciliation.push(item),
      onContractFinding: (finding) => findings.push(finding),
    });
    const counts = sourcePricingReconciliation(models, reconciliation, true).disposition_counts;
    expect(counts).toEqual(expect.objectContaining({ raw: 0, excluded: 0 }));
    expect(counts.normalized).toBe(38);
    expect(
      models.every(
        ({ raw_price_facts }) =>
          raw_price_facts.length === 2 &&
          raw_price_facts.every(({ impact }) => impact === "informational"),
      ),
    ).toBe(true);
    expect(models.every(({ commercial_facts }) => commercial_facts === undefined)).toBe(true);
    expect(contractPaths(findings)).toContain("/deepseek/fim_inventory_disagreement");
  });

  it("assembles only PAYG inference rates and observable token accounting", async () => {
    const modelsSource = await deepseekSource();
    const models = modelsSource.models;
    const catalogSource = source("deepseek-catalog");
    const pricing = assembleParsedProviderPricing(
      "deepseek",
      observedAt,
      [{ source: catalogSource, ...modelsSource }],
      models,
    );
    const flashBook = pricing?.books.find(
      ({ book_key }) => book_key === "model:deepseek/deepseek-v4-flash",
    );
    const flash = flashBook?.offers.find(({ offer_key }) => offer_key === "payg");
    expect(flash?.settlement).toEqual([]);
    expect(
      flash?.terms.find((term) => term.kind === "rate" && term.meter.value === "cache_read_text"),
    ).toMatchObject({
      kind: "rate",
      variants: expect.arrayContaining([
        expect.objectContaining({
          charge_binding: expect.objectContaining({
            signal: { namespace: "kmodels", value: "cached_input_tokens" },
            aggregation: "request",
          }),
        }),
      ]),
    });
    const input = flash?.terms.find(
      (term) => term.kind === "rate" && term.meter.value === "input_text",
    );
    expect(
      input?.kind === "rate" ? input.variants[0]?.charge_binding?.quantity_methods : [],
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          input_sources: expect.arrayContaining([
            expect.objectContaining({
              channel: "response",
              locator: { kind: "json_pointer", value: "/usage/prompt_cache_miss_tokens" },
            }),
            expect.objectContaining({
              channel: "stream_event",
              locator: { kind: "json_pointer", value: "/usage/prompt_cache_miss_tokens" },
            }),
          ]),
        }),
        expect.objectContaining({
          calculation: {
            nodes: [
              { op: "signal", signal: { namespace: "kmodels", value: "input_tokens" } },
              {
                op: "signal",
                signal: { namespace: "kmodels", value: "cached_input_tokens" },
              },
              { op: "subtract_floor_zero", minuend: 0, subtrahend: 1 },
            ],
            result: 2,
          },
          input_sources: expect.arrayContaining([
            expect.objectContaining({
              channel: "response",
              signal: { namespace: "kmodels", value: "input_tokens" },
              locator: { kind: "json_pointer", value: "/usage/input_tokens" },
            }),
            expect.objectContaining({
              channel: "stream_event",
              signal: { namespace: "kmodels", value: "cached_input_tokens" },
              locator: {
                kind: "json_pointer",
                value: "/response/usage/input_tokens_details/cached_tokens",
              },
            }),
          ]),
        }),
      ]),
    );
    expect(flash?.terms.some(({ term_key }) => term_key === "cache_write_text")).toBe(false);
    const transitionAtoms =
      pricing?.vocabulary.atoms.filter(
        (atom) => atom.kind === "categorical_value" && atom.dimension.value === "billing_period",
      ) ?? [];
    expect(transitionAtoms).toHaveLength(2);
    for (const atom of transitionAtoms) {
      expect(atom).not.toHaveProperty("schedule");
      expect(atom.definition).toContain("August 23, 2026 at 00:00 Beijing Time");
      expect(atom.definition).toContain("caller supplies");
    }
    const weekendModelsSource = await deepseekSource({ observedAt: "2026-08-23T00:00:00.000Z" });
    const weekendModels = weekendModelsSource.models;
    const weekendPricing = assembleParsedProviderPricing(
      "deepseek",
      "2026-08-23T00:00:00.000Z",
      [{ source: catalogSource, ...weekendModelsSource }],
      weekendModels,
    );
    expect(weekendPricing?.vocabulary.atoms).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "categorical_value",
          key: "peak",
          label: "Peak",
          schedule: {
            kind: "weekly_time_windows",
            time_zone: "UTC",
            days: ["monday", "tuesday", "wednesday", "thursday", "friday"],
            windows: [
              { from: "01:00", until: "04:00" },
              { from: "06:00", until: "10:00" },
            ],
          },
        }),
        expect.objectContaining({
          kind: "categorical_value",
          key: "off_peak",
          label: "Off-peak",
          schedule: { kind: "weekly_time_remainder", time_zone: "UTC" },
        }),
      ]),
    );
    expect(
      input?.kind === "rate" ? input.variants.map(({ validity }) => validity).filter(Boolean) : [],
    ).toEqual([]);
    expect(pricing?.books).toHaveLength(3);
    expect(pricing?.books.every(({ scope }) => scope.kind === "models")).toBe(true);
    expect(
      pricing?.books
        .flatMap(({ offers }) => offers)
        .every(({ relations }) => relations.length === 0),
    ).toBe(true);
  });

  it("treats the documented inventory owner as opaque metadata", async () => {
    const value = manifest("deepseek");
    const configured = source("deepseek-api");
    const fixtureBody = await fixture("deepseek/api.json");
    const body = fixtureBody.replace('"owned_by": "deepseek"', '"owned_by": "deepseek-platform"');
    expect(
      parseSource({
        provider: provider(value),
        source: configured,
        body,
        observedAt,
      }).models,
    ).toHaveLength(2);
    expect(
      parseSource({
        provider: provider(value),
        source: configured,
        body: fixtureBody.replace('"object": "list",', '"object": "list", "extra": true,'),
        observedAt,
      }).models,
    ).toHaveLength(2);
    expect(
      parseSource({
        provider: provider(value),
        source: configured,
        body: fixtureBody.replace(
          '"owned_by": "deepseek"',
          '"owned_by": "deepseek", "extra": true',
        ),
        observedAt,
      }).models,
    ).toHaveLength(2);
    const findings: SourceContractEvidence[] = [];
    expect(
      parseSource({
        provider: provider(value),
        source: configured,
        body: fixtureBody.replace('"object": "model"', '"object": "deployment"'),
        observedAt,
        onContractFinding: (finding) => findings.push(finding),
      }).models,
    ).toHaveLength(1);
    expect(
      contractPaths(findings).some((path) =>
        path.startsWith("/deepseek/api_model_record_invalid/"),
      ),
    ).toBe(true);
  });

  it("uses exact change-log evidence for release and update dates", async () => {
    const models = await parsed("deepseek", "deepseek/updates.html", "deepseek-updates");
    const flash = models.find(({ model_id }) => model_id === "deepseek-v4-flash");
    expect(flash).toMatchObject({
      release_date: "2026-04-24",
      updated_date: "2026-07-31",
      release_stage: "preview",
    });
    expect(
      models.find(({ model_id }) => model_id === "deepseek-v4-flash-vision-exp"),
    ).toMatchObject({
      release_date: "2026-08-21",
      release_stage: "experimental",
    });
    expect(models.find(({ model_id }) => model_id === "deepseek-reasoner")).toMatchObject({
      release_date: "2025-01-20",
      updated_date: "2026-04-24",
    });
    expect(models.find(({ model_id }) => model_id === "deepseek-chat")).toMatchObject({
      updated_date: "2026-04-24",
    });
    expect(models.find(({ model_id }) => model_id === "deepseek-chat")).not.toHaveProperty(
      "release_date",
    );
    expect(models.find(({ model_id }) => model_id === "deepseek-coder")).toMatchObject({
      updated_date: "2024-09-05",
    });
    expect(models.find(({ model_id }) => model_id === "deepseek-coder")).not.toHaveProperty(
      "release_date",
    );
    const body = await fixture("deepseek/updates.html");
    const findings: SourceContractEvidence[] = [];
    expect(
      parseSource({
        provider: provider(manifest("deepseek")),
        source: source("deepseek-updates"),
        body: body.replace("2024-09-05", "2024-02-30"),
        observedAt,
        onContractFinding: (finding) => findings.push(finding),
      }).models,
    ).not.toHaveLength(0);
    expect(
      contractPaths(findings).some((path) => path.startsWith("/deepseek/update_date_invalid/")),
    ).toBe(true);
  });

  it("retains catalog, change-log, and authenticated API observations", async () => {
    const catalogSource = source("deepseek-catalog");
    const updateSource = source("deepseek-updates");
    const apiSource = source("deepseek-api");
    const catalog = await deepseekCatalog();
    const updates = await parsed("deepseek", "deepseek/updates.html", updateSource.id);
    const inventory = await parsed("deepseek", "deepseek/api.json", apiSource.id);
    const models = applyGroups(
      applyGroups(
        applyGroups([], [{ source: catalogSource, models: catalog }], true),
        [{ source: updateSource, models: updates }],
        false,
      ),
      [{ source: apiSource, models: inventory }],
      false,
    );
    expect(models.find(({ model_id }) => model_id === "deepseek-v4-flash")?.source_refs).toEqual([
      "deepseek-catalog",
      "deepseek-updates",
      "deepseek-api",
    ]);
    expect(models.find(({ model_id }) => model_id === "deepseek-v4-flash")).toMatchObject({
      release_date: "2026-04-24",
      updated_date: "2026-07-31",
      release_stage: "preview",
    });
    expect(models.some(({ model_id }) => model_id === "deepseek-chat")).toBe(false);
  });
});
