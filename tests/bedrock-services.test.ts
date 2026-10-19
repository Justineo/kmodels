import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";
import { parseSource } from "../src/catalog/adapters.ts";
import { linkedBundleSchema } from "../src/catalog/bundle.ts";
import { manifests, type SourceManifest } from "../src/catalog/manifests.ts";
import { assembleParsedProviderPricing } from "../src/catalog/pricing-adapter.ts";
import { evaluateRateCost } from "../src/catalog/pricing-calculation.ts";
import { capturePricingReplaySources } from "../src/catalog/pricing-compilation.ts";
import { rateVariantIdentity } from "../src/catalog/pricing-canonical.ts";
import type { PricingReconciliationItem } from "../src/catalog/pricing-reconciliation.ts";
import type { SourceParseResult } from "../src/catalog/source-parse.ts";
import { validatePricingCatalog } from "../src/catalog/pricing-validation.ts";

const observedAt = "2026-07-21T00:00:00.000Z";
const manifest = manifests.find(({ provider }) => provider.id === "amazon-bedrock");
const source = manifest?.sources.find(({ id }) => id === "bedrock-models");
if (manifest === undefined || source === undefined) throw new Error("Missing Bedrock source");
const provider = { ...manifest.provider, source_ids: [source.id] };
const configured: SourceManifest = source;
const rows = [
  {
    id: "CONTENT",
    attributes: { operation: "ApplyGuardrail", policyType: "Content" },
    unit: "TextUnit",
    amount: "0.0001500000",
    description: "$0.15 per 1K text units for ContentPolicyUnitsConsumed",
  },
  {
    id: "IMAGE",
    attributes: { operation: "ApplyGuardrail", policyType: "ContentPolicyImage" },
    unit: "Images Processed",
    amount: "0.0008000000",
    description: "$0.8 per 1K images",
  },
  {
    id: "CHECK",
    attributes: { operation: "InvokeGuardrailChecks", policyType: "GuardrailContentChecks" },
    unit: "TextUnit",
    amount: "0.0000800000",
    description: "$0.00008 per TextUnit",
  },
  {
    id: "SEARCH",
    attributes: { usagetype: "USE1-Bedrock-Websearch-Queries" },
    unit: "Queries",
    amount: "0.01",
    description: "$0.01 per query",
  },
  {
    id: "ROUTING",
    attributes: { feature: "Prompt Router" },
    unit: "Requests",
    amount: "0.001",
    description: "$0.001 per request",
  },
  {
    id: "RERANK",
    attributes: { feature: "Reranker" },
    unit: "Search Units",
    amount: "0.001",
    description: "$0.001 per Search Unit",
  },
];

async function bundle() {
  const value = linkedBundleSchema.parse(
    JSON.parse(
      await readFile(new URL("./fixtures/document/bedrock.json", import.meta.url), "utf8"),
    ),
  );
  const list = value.documents.find(({ url }) => url.includes("/AmazonBedrock/current/"));
  if (list === undefined) throw new Error("Missing Price List fixture");
  const body = z
    .object({
      offerCode: z.string(),
      products: z.record(z.string(), z.unknown()),
      terms: z.object({ OnDemand: z.record(z.string(), z.unknown()) }),
    })
    .parse(JSON.parse(list.body));
  for (const row of rows) {
    body.products[row.id] = {
      sku: row.id,
      attributes: { regionCode: "us-east-1", ...row.attributes },
    };
    body.terms.OnDemand[row.id] = {
      term: {
        effectiveDate: "2026-07-01T00:00:00Z",
        priceDimensions: {
          rate: { unit: row.unit, description: row.description, pricePerUnit: { USD: row.amount } },
        },
      },
    };
  }
  list.body = JSON.stringify(body);
  return value;
}

function parse(
  body: Awaited<ReturnType<typeof bundle>>,
  findings?: PricingReconciliationItem[],
): SourceParseResult {
  return parseSource({
    provider,
    source: configured,
    body: JSON.stringify(body),
    observedAt,
    ...(findings === undefined ? {} : { onPricingReconciliation: (item) => findings.push(item) }),
  });
}

function assemble(parsed: SourceParseResult) {
  const result = assembleParsedProviderPricing(
    provider.id,
    observedAt,
    [{ source: configured, ...parsed }],
    parsed.models,
  );
  if (result === undefined) throw new Error("Missing Bedrock partition");
  return result;
}

function rate(parsed: SourceParseResult, resource: string, key: string) {
  const term = assemble(parsed)
    .books.find(
      ({ scope }) => scope.kind === "provider_resource" && scope.resource_key === resource,
    )
    ?.offers.flatMap(({ terms }) => terms)
    .find(({ term_key }) => term_key === key);
  if (term?.kind !== "rate") throw new Error(`Missing ${resource}/${key} rate`);
  return term;
}

describe("Bedrock native request services", () => {
  it("uses machine unit amounts once and returns independent typed service facts", async () => {
    const parsed = parse(await bundle());
    expect(
      parsed.models.every(
        (model) =>
          !Object.hasOwn(model, "commercial_facts") && !Object.hasOwn(model, "pricing_inputs"),
      ),
    ).toBe(true);
    expect(parsed.pricing_inputs).toHaveLength(32);
    const content = rate(parsed, "guardrails", "content").variants[0];
    expect(content?.price).toMatchObject({
      value: { numerator: "3", denominator: "20000" },
      per: {
        factors: [
          {
            unit: { namespace: "provider", provider_id: provider.id, value: "guardrail_text_unit" },
            power: 1,
          },
        ],
      },
    });
    expect(content?.charge_binding).toMatchObject({
      signal: { value: "guardrail_content_policy_units" },
      aggregation: "request",
      quantity_methods: [
        {
          input_sources: [
            expect.objectContaining({
              locator: { kind: "json_pointer", value: "/usage/contentPolicyUnits" },
            }),
          ],
        },
      ],
    });
    if (content === undefined || content.charge_binding === undefined)
      throw new Error("Missing content binding");
    expect(
      evaluateRateCost(content, [
        { signal: content.charge_binding.signal, value: { numerator: "1000", denominator: "1" } },
      ]),
    ).toMatchObject({ kind: "resolved", amount: { numerator: "3", denominator: "20" } });
    expect(rate(parsed, "guardrails", "contentpolicyimage").variants[0]?.price.value).toEqual({
      numerator: "1",
      denominator: "1250",
    });
    expect(
      rate(parsed, "guardrails", "guardrailcontentchecks").variants[0]?.charge_binding
        ?.quantity_methods,
    ).toMatchObject([
      {
        input_sources: [
          expect.objectContaining({
            locator: { kind: "json_pointer", value: "/usage/contentFilter/textUnits" },
          }),
        ],
      },
    ]);
    for (const [resource, key] of [
      ["web-search", "queries"],
      ["prompt-routing", "prompt-router"],
      ["reranking", "reranker"],
    ]) {
      if (resource === undefined || key === undefined) throw new Error("Missing test service");
      expect(rate(parsed, resource, key).variants[0]?.charge_binding).toMatchObject({
        aggregation: "request",
      });
    }
  });

  it("does not rescale prices when descriptive prose changes", async () => {
    const input = await bundle();
    const parsed = parse(input);
    const list = input.documents.find(({ url }) => url.includes("/AmazonBedrock/current/"));
    if (list === undefined) throw new Error("Missing Price List");
    list.body = list.body
      .replace("$0.15 per 1K text units", "$0.00015 per TextUnit")
      .replace("$0.8 per 1K images", "$0.0008 per image");
    const changed = parse(input);
    expect(rate(changed, "guardrails", "content").variants.map(rateVariantIdentity)).toEqual(
      rate(parsed, "guardrails", "content").variants.map(rateVariantIdentity),
    );
    expect(
      rate(changed, "guardrails", "contentpolicyimage").variants.map(rateVariantIdentity),
    ).toEqual(rate(parsed, "guardrails", "contentpolicyimage").variants.map(rateVariantIdentity));
  });

  it("withholds a missing acquisition contract without changing service rates or quantities", async () => {
    const input = await bundle();
    input.documents = input.documents.filter(({ url }) => !url.endsWith("GuardrailUsage.html"));
    const variant = rate(parse(input), "guardrails", "content").variants[0];
    expect(variant?.price.value).toEqual({ numerator: "3", denominator: "20000" });
    expect(variant?.charge_binding).toMatchObject({
      signal: { value: "guardrail_content_policy_units" },
      aggregation: "request",
    });
    expect(variant?.charge_binding?.quantity_methods).toBeUndefined();
  });

  it("reports and preserves an unknown native unit beside valid sibling services", async () => {
    const input = await bundle();
    const list = input.documents.find(({ url }) => url.includes("/AmazonBedrock/current/"));
    if (list === undefined) throw new Error("Missing Price List");
    list.body = list.body.replace('"unit":"TextUnit"', '"unit":"Unreviewed TextUnit"');
    const findings: PricingReconciliationItem[] = [];
    const parsed = parse(input, findings);
    const raw = assemble(parsed)
      .books.find(
        ({ scope }) => scope.kind === "provider_resource" && scope.resource_key === "guardrails",
      )
      ?.offers.flatMap(({ terms }) => terms)
      .find(({ term_key }) => term_key === "content");
    expect(raw?.kind).toBe("raw");
    expect(findings).toContainEqual(
      expect.objectContaining({
        disposition: "unsupported",
        reason_code: "commercial_unit_unsupported",
      }),
    );
    expect(rate(parsed, "web-search", "queries").variants).toHaveLength(1);
  });

  it("captures and replays service terms and vocabulary without a model carrier", async () => {
    const parsed = { ...parse(await bundle()), models: [] };
    const record = {
      id: configured.id,
      provider_id: provider.id,
      url: configured.url,
      source: configured.source ?? [configured.type],
      stability: configured.stability,
      scope: configured.scope ?? "global",
      exhaustive: configured.exhaustive ?? false,
      role: configured.role ?? "catalog",
      field_paths: configured.fields,
      pricing_evidence: configured.pricingEvidence,
      content_hash: "1".repeat(64),
      extractor_version: configured.extractorVersion,
      observed_at: observedAt,
    };
    const captured = capturePricingReplaySources(
      [{ source: configured, ...parsed }],
      [record],
    )?.[0];
    if (captured === undefined) throw new Error("Missing service replay input");
    expect(captured.models).toEqual([]);
    expect(assemble({ ...captured, models: [] })).toEqual(assemble(parsed));
    const partition = assemble(parsed);
    validatePricingCatalog(
      {
        provider_vocabularies: [partition.vocabulary],
        provider_snapshots: [partition.snapshot],
        model_dispositions: partition.model_dispositions,
        books: partition.books,
      },
      { providers: [provider], models: [], sources: [record] },
    );
  });

  it("checks canonical source rate identity and nested binding provenance", async () => {
    const parsed = parse(await bundle());
    const fact = parsed.commercial_facts?.find(({ resource_key }) => resource_key === "guardrails");
    const term = fact?.terms?.[0];
    if (term?.kind !== "rate") throw new Error("Missing typed service term");
    const id = term.id;
    term.id = "0".repeat(64);
    expect(() => assemble(parsed)).toThrow("mismatched source identity");
    term.id = id;
    const binding = term.variants[0]?.charge_binding;
    if (binding === undefined) throw new Error("Missing source binding");
    binding.observations.push({
      source_ref: "unrelated-source",
      locator: { kind: "fragment", value: "unrelated" },
      raw: { fragment: "Unrelated counter" },
    });
    expect(() => assemble(parsed)).toThrow("mixed sources");
    binding.observations.pop();
    const variant = term.variants[0];
    if (variant === undefined) throw new Error("Missing rate variant");
    variant.selector_sources = [
      {
        dimension: { namespace: "kmodels", value: "region" },
        channel: "request",
        locator: { kind: "provider_field", value: "HttpRequest.region" },
        availability: "always",
        observations: [
          {
            source_ref: "unrelated-source",
            locator: { kind: "fragment", value: "unrelated" },
            raw: { fragment: "Unrelated region contract" },
          },
        ],
      },
    ];
    expect(() => assemble(parsed)).toThrow("mixed sources");
  });

  it("preserves explicit numeric zero without inventing a free offer", async () => {
    const input = await bundle();
    const list = input.documents.find(({ url }) => url.includes("/AmazonBedrock/current/"));
    if (list === undefined) throw new Error("Missing Price List");
    list.body = list.body.replace('"USD":"0.0001500000"', '"USD":"0"');
    const parsed = parse(input);
    expect(rate(parsed, "guardrails", "content").variants[0]?.price.value).toEqual({
      numerator: "0",
      denominator: "1",
    });
    const states = assemble(parsed)
      .books.find(
        ({ scope }) => scope.kind === "provider_resource" && scope.resource_key === "guardrails",
      )
      ?.offers.flatMap(({ states }) => states);
    expect(states?.every(({ state }) => state === "numeric")).toBe(true);
  });

  it("scales a denominator explicitly encoded in the machine unit", async () => {
    const input = await bundle();
    const list = input.documents.find(({ url }) => url.includes("/AmazonBedrock/current/"));
    if (list === undefined) throw new Error("Missing Price List");
    list.body = list.body.replace('"unit":"Requests"', '"unit":"Per 1000 requests"');
    const variant = rate(parse(input), "prompt-routing", "prompt-router").variants[0];
    expect(variant?.price.value).toEqual({ numerator: "1", denominator: "1000000" });
    expect(variant?.charge_binding?.signal.value).toBe("prompt_routing_requests");
  });

  it("keeps unequal native observations as a localized rate conflict", async () => {
    const input = await bundle();
    const list = input.documents.find(({ url }) => url.includes("/AmazonBedrock/current/"));
    if (list === undefined) throw new Error("Missing Price List");
    const body = z
      .object({
        offerCode: z.string(),
        products: z.record(z.string(), z.unknown()),
        terms: z.object({ OnDemand: z.record(z.string(), z.unknown()) }),
      })
      .parse(JSON.parse(list.body));
    body.products.OTHER = {
      sku: "OTHER",
      attributes: { operation: "ApplyGuardrail", policyType: "Content", regionCode: "us-east-1" },
    };
    body.terms.OnDemand.OTHER = {
      term: {
        priceDimensions: {
          rate: {
            unit: "TextUnit",
            description: "$0.0002 per TextUnit",
            pricePerUnit: { USD: "0.0002" },
          },
        },
      },
    };
    list.body = JSON.stringify(body);
    const parsed = parse(input);
    const content = rate(parsed, "guardrails", "content");
    expect(content.variants).toEqual([]);
    expect(content.raw_variants).toContainEqual(
      expect.objectContaining({ reason: "conflicting_values", impact: "base_price" }),
    );
    expect(rate(parsed, "web-search", "queries").variants).toHaveLength(1);
  });

  it("does not reinterpret changed raw audit payloads inside typed rate terms", async () => {
    const parsed = parse(await bundle());
    const before = rate(parsed, "guardrails", "content").variants.map(rateVariantIdentity);
    for (const fact of parsed.commercial_facts ?? [])
      for (const term of fact.terms ?? [])
        for (const variant of term.variants) {
          for (const observation of variant.observations)
            observation.raw = {
              amount: "999",
              unit: "TextUnit",
              fragment: "per 1K; deliberately unrelated audit annotation",
            };
        }
    expect(rate(parsed, "guardrails", "content").variants.map(rateVariantIdentity)).toEqual(before);
  });

  it("cannot create a grounding service from a model-local raw marker", async () => {
    const parsed = parse(await bundle());
    const model = parsed.models[0];
    if (model === undefined) throw new Error("Missing model fixture");
    model.raw_price_facts.push({
      term_key: "tool_call:grounding",
      impact: "base_price",
      reason: "unknown_meter",
      source_ref: configured.id,
      conditions: { region: "us-east-1" },
      raw: { amount: "0.03", denomination: "USD", unit: "Requests" },
    });
    const partition = assemble(parsed);
    expect(
      partition.books.some(
        ({ scope }) =>
          scope.kind === "provider_resource" &&
          scope.resource_key.startsWith("nova-web-grounding:"),
      ),
    ).toBe(false);
    expect(
      partition.books
        .find(({ scope }) => scope.kind === "models" && scope.model_refs.includes(model.uid))
        ?.offers.flatMap(({ terms }) => terms),
    ).toContainEqual(expect.objectContaining({ kind: "raw", term_key: "tool_call:grounding" }));
  });
});
