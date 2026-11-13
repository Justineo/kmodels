import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vite-plus/test";
import { parseSource } from "../src/catalog/adapters.ts";
import { manifests } from "../src/catalog/manifests.ts";
import { baseModel } from "../src/catalog/model.ts";
import { assembleParsedProviderPricing } from "../src/catalog/pricing-adapter.ts";
import type { PricingReconciliationItem } from "../src/catalog/pricing-reconciliation.ts";
import { type ModelTask } from "../src/catalog/schema.ts";
import { catalogRepairCandidates } from "../src/catalog/catalog-repair.ts";
import { sourcePricingReconciliation } from "../src/catalog/pricing-reconciliation.ts";
import { vertexClaudeSkuSource } from "../src/catalog/vertex-claude-skus.ts";
const observedAt = "2026-10-19T07:12:03.562Z";
function configuration() {
  const value = manifests.find(({ provider }) => provider.id === "vertex");
  const source = value?.sources.find(({ id }) => id === "vertex-pricing");
  if (value === undefined || source === undefined) throw new Error("Missing Vertex pricing source");
  return { value, source };
}
const { value, source } = configuration();
const provider = { ...value.provider, source_ids: value.sources.map(({ id }) => id) };
const catalogModels = [
  ["claude-haiku-5-5", "Claude Haiku 5.5"],
  ["claude-sonnet-5-5", "Sonnet 5.5"],
  ["gemini-4-argon", "Gemini 4 Argon"],
  ["gemini-4-argon-cyber-permissive", "Gemini 4 Argon Cyber Permissive"],
].map(([id, name]) => {
  if (id === undefined || name === undefined) throw new Error("Missing fixture identity");
  return {
    ...baseModel({ providerId: "vertex", id, name, sourceId: source.id, observedAt }),
    tasks: ["text_generation"] satisfies ModelTask[],
    service_families: [id.startsWith("claude-") ? "publishers/anthropic" : "publishers/google"],
  };
});
async function nativePricing() {
  return readFile(
    new URL("./fixtures/vertex/claude-context-pricing.html", import.meta.url),
    "utf8",
  );
}
function parse(
  body: string,
  documents: {
    url: string;
    body: string;
  }[] = [],
) {
  const findings: PricingReconciliationItem[] = [];
  const parsed = parseSource({
    provider,
    source,
    observedAt,
    body: JSON.stringify({ index: { url: source.url, body }, documents }),
    catalogModels,
    onPricingReconciliation: (finding) => findings.push(finding),
  });
  return { ...parsed, findings };
}
async function coherentPricing() {
  return (await nativePricing()).replaceAll("longer than or equal to", "longer than");
}
it.each([
  ["Claude Haiku 5.5(D364-3640-5C2F)", "Claude Haiku 5 5"],
  ["Claude Haiku 5.5(D364-3640-5C2F)", "Claude Haiku 5.5"],
  ["Vertex AI(C7E2-9256-1C43)", "Claude Haiku 5 5"],
])(
  "resolves a disputed boundary only for exact billing SKUs under %s with label %s",
  async (service, modelLabel) => {
    const row = (meter: string, min: number, max: number, sku: string) =>
      `<tr><td>${service}</td><td>${modelLabel} — ${meter} — global — Context Window Size from ${min} to ${max} Tokens</td><td>${sku}</td><td></td></tr>`;
    const skuTable = `<table><thead><tr><th>Service Name</th><th>SKU Name</th><th>SKU ID</th><th>Date Added</th></tr></thead><tbody>${row("Input Tokens", 0, 100000, "ABCD-0000-0001")}${row("Input Tokens", 100001, 1000000, "ABCD-0000-0002")}${row("Output Tokens", 0, 100000, "ABCD-0000-0003")}</tbody></table>`;
    const result = parse(await nativePricing(), [{ url: vertexClaudeSkuSource, body: skuTable }]);
    const haiku = result.models.find(({ model_id }) => model_id === "claude-haiku-5-5");
    expect(haiku?.price_facts).toContainEqual(
      expect.objectContaining({
        meter: "input_text",
        conditions: expect.objectContaining({ region: "global", context_max_tokens: 100000 }),
        source_locator: { kind: "provider_key", value: "ABCD-0000-0001 / ABCD-0000-0002" },
      }),
    );
    expect(haiku?.raw_price_facts).not.toContainEqual(
      expect.objectContaining({
        raw: expect.objectContaining({ meter: "input_text" }),
        conditions: expect.objectContaining({ region: "global", service_tier: "standard" }),
      }),
    );
    for (const [meter, region] of [
      ["output_text", "global"],
      ["input_text", "us"],
    ]) {
      expect(haiku?.raw_price_facts).toContainEqual(
        expect.objectContaining({
          raw: expect.objectContaining({ meter }),
          conditions: expect.objectContaining({ region, context_max_tokens: 100000 }),
        }),
      );
    }
  },
);
it("does not assign an unowned family price to the longest similar model ID", () => {
  const result = parse(
    "<main><table><tr><th>Model</th><th>Price (/1M tokens)</th></tr><tr><td>Gemini 4</td><td>Input: $2 Output: $10</td></tr></table></main>",
  );
  expect(result.models.flatMap((model) => model.price_facts)).toEqual([]);
});
it.each(["October 16, 2026", "February 28, 2028"])(
  "admits a listed post-preview tariff after the ambiguous cutover date (%s)",
  (date) => {
    const result = parse(
      `<main><table><tr><th>Model</th><th>Price (/1M tokens)</th></tr><tr><td>Gemini 4 Argon*</td><td>Input: $2 Output: $10</td></tr></table><p>* Available at no charge until ${date}.</p></main>`,
    );
    const model = result.models.find(({ model_id }) => model_id === "gemini-4-argon");
    if (model === undefined) throw new Error("Missing Argon model");
    expect(
      model.price_facts.map(({ price, conditions }) => [price, conditions.effective_from]),
    ).toEqual([
      ["2", date.startsWith("October") ? "2026-10-17" : "2028-02-29"],
      ["10", date.startsWith("October") ? "2026-10-17" : "2028-02-29"],
    ]);
    expect(model.raw_price_facts).toEqual([]);
  },
);
it("keeps an invalid free-preview boundary unresolved", () => {
  const result = parse(
    "<main><table><tr><th>Model</th><th>Price (/1M tokens)</th></tr><tr><td>Gemini 4 Argon*</td><td>Input: $2 Output: $10</td></tr></table><p>* Available at no charge until February 30, 2026.</p></main>",
  );
  const model = result.models.find(({ model_id }) => model_id === "gemini-4-argon");
  if (model === undefined) throw new Error("Missing Argon model");
  expect(model.price_facts).toEqual([]);
  expect(model.raw_price_facts.length).toBeGreaterThan(0);
});
it.each(["owned", "neighbor", "quoted", "multiple tables"])(
  "respects wrapped partner-table footnote ownership (%s)",
  (placement) => {
    const table =
      '<div><div role="region"><table><tr><th>Model</th><th>Type</th><th>Price (/1M tokens)</th></tr><tr><td>Gemini 4 Argon *</td><td>Input</td><td>$2</td></tr></table></div></div>';
    const note = "<div><p>* Available at no charge until Oct 16, 2026.</p></div>";
    const body = `<main><div class="cws-jump-section" data-cws-menu-text="Google's models"><h2>Google's models</h2>${table}${placement === "owned" ? note : placement === "quoted" ? `<blockquote>${note}</blockquote>` : placement === "multiple tables" ? `${table}${note}` : ""}</div>${placement === "neighbor" ? `<div class="cws-jump-section" data-cws-menu-text="Other models">${note}</div>` : ""}</main>`;
    const result = parse(body);
    const model = result.models.find(({ model_id }) => model_id === "gemini-4-argon");
    if (model === undefined) throw new Error("Missing Argon model");
    if (placement === "owned") {
      expect(model.price_facts).toEqual([
        expect.objectContaining({ price: "2", conditions: { effective_from: "2026-10-17" } }),
      ]);
      expect(model.raw_price_facts).toEqual([]);
    } else {
      expect(model.price_facts).toEqual([]);
      expect(model.raw_price_facts.length).toBeGreaterThan(0);
    }
  },
);
function haiku(parsed: ReturnType<typeof parse>) {
  const model = parsed.models.find(({ model_id }) => model_id === "claude-haiku-5-5");
  if (model === undefined) throw new Error("Missing Haiku fixture model");
  return model;
}
describe("Vertex native tariff scopes", () => {
  it.each([false, true])(
    "keeps independent 100K and 200K columns and endpoint locations (article=%s)",
    async (article) => {
      let body = await coherentPricing();
      if (article) body = `<div class="devsite-article-body">${body}</div>`;
      const parsed = parse(body);
      for (const [id, threshold, amount] of [
        ["claude-haiku-5-5", 100000, "0.10"],
        ["claude-sonnet-5-5", 200000, "2.00"],
      ] as const) {
        const model = parsed.models.find(({ model_id }) => model_id === id);
        expect(model?.raw_price_facts).toEqual([]);
        const rates = model?.price_facts.filter(({ meter }) => meter === "input_text");
        expect(rates?.length).toBeGreaterThan(0);
        expect(rates).toContainEqual(
          expect.objectContaining({
            price: amount,
            conditions: expect.objectContaining({
              region: "global",
              context_max_tokens: threshold,
            }),
          }),
        );
        expect(
          rates?.every(
            ({ conditions }) =>
              conditions.context_max_tokens === threshold ||
              conditions.context_min_tokens === threshold + 1,
          ),
        ).toBe(true);
        expect(
          rates?.every(
            ({ conditions }) =>
              ["global", "us"].includes(conditions.region ?? "") &&
              conditions.deployment_scope === undefined,
          ),
        ).toBe(true);
      }
      const partition = assembleParsedProviderPricing(
        "vertex",
        observedAt,
        [{ source, ...parsed }],
        catalogModels,
      );
      const terms =
        partition?.books.flatMap(({ offers }) => offers.flatMap(({ terms }) => terms)) ?? [];
      const rates = terms.filter((term) => term.kind === "rate");
      expect(rates.length).toBeGreaterThan(0);
      expect(
        rates.every(
          ({ variants, raw_variants }) => variants.length > 0 && raw_variants.length === 0,
        ),
      ).toBe(true);
    },
  );
  it("prices agreed context ranges and retains the disputed threshold as raw evidence", async () => {
    const parsed = parse(await nativePricing());
    const haiku = parsed.models.find(({ model_id }) => model_id === "claude-haiku-5-5");
    expect(haiku?.price_facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          conditions: expect.objectContaining({ context_max_tokens: 99999 }),
        }),
        expect.objectContaining({
          conditions: expect.objectContaining({ context_min_tokens: 100001 }),
        }),
      ]),
    );
    expect(haiku?.raw_price_facts.length).toBeGreaterThan(0);
    expect(haiku?.raw_price_facts.every(({ reason }) => reason === "unknown_applicability")).toBe(
      true,
    );
    expect(haiku?.raw_price_facts.some(({ raw }) => raw.fragment?.includes("$0.10"))).toBe(true);
    expect(
      haiku?.raw_price_facts.some(({ raw }) =>
        raw.fragment?.includes("longer than or equal to 100k tokens"),
      ),
    ).toBe(true);
    expect(haiku?.raw_price_facts).toContainEqual(
      expect.objectContaining({
        conditions: expect.objectContaining({
          context_min_tokens: 100000,
          context_max_tokens: 100000,
        }),
        raw: expect.objectContaining({
          amount: "0.10",
          denomination: "USD",
          meter: "input_text",
          unit: expect.stringContaining("1M tokens"),
        }),
      }),
    );
    expect(parsed.findings).toContainEqual(
      expect.objectContaining({
        disposition: "unresolved",
        reason_code: "pricing_context_scope_unresolved",
      }),
    );
  });
  it("does not borrow another endpoint's threshold declaration", async () => {
    const body = (await nativePricing())
      .replaceAll("longer than or equal to", "longer than")
      .replace("longer than 100k tokens", "longer than or equal to 100k tokens");
    const haiku = parse(body).models.find(({ model_id }) => model_id === "claude-haiku-5-5");
    expect(haiku?.price_facts.some(({ conditions }) => conditions.region === "us")).toBe(true);
    expect(
      haiku?.price_facts.some(
        ({ conditions }) =>
          conditions.region === "global" && conditions.context_max_tokens === 99999,
      ),
    ).toBe(true);
    expect(haiku?.raw_price_facts.length).toBeGreaterThan(0);
    expect(haiku?.raw_price_facts.every(({ conditions }) => conditions?.region === "global")).toBe(
      true,
    );
  });
  it("does not borrow a separately owned table's footnote in the same panel", async () => {
    const body = (await coherentPricing()).replace(
      '<div role="tabpanel" aria-labelledby="pricing-global">',
      '<div role="tabpanel" aria-labelledby="pricing-global"><div><table><tr><th>Unrelated table</th></tr><tr><td>Not a price</td></tr></table><p>** If a query input context is longer than 200K tokens, all tokens (input and output) are charged at long context rates.</p></div>',
    );
    const model = haiku(parse(body));
    expect(model.raw_price_facts).toEqual([]);
    expect(
      model.price_facts.some(
        ({ conditions }) =>
          conditions.region === "global" && conditions.context_max_tokens === 100000,
      ),
    ).toBe(true);
  });
  it.each(["0.5K", "10,00K", "9007199254740991K", "-100K"])(
    "keeps an unsafe native context count raw (%s)",
    async (count) => {
      const result = parse((await coherentPricing()).replaceAll("100K", count));
      expect(haiku(result).price_facts).toEqual([]);
      expect(haiku(result).raw_price_facts.some(({ raw }) => raw.fragment?.includes("$0.10"))).toBe(
        true,
      );
      expect(
        result.models.find(({ model_id }) => model_id === "claude-sonnet-5-5")?.price_facts.length,
      ).toBeGreaterThan(0);
    },
  );
  it.each(["short", "long"])("keeps a %s bound independent of the opposite quote", async (band) => {
    const body = (await coherentPricing()).replace(
      band === "short" ? "<td>$0.50</td>" : "<td>$0.10</td>",
      "<td></td>",
    );
    const prices = haiku(parse(body)).price_facts;
    expect(prices).toContainEqual(
      expect.objectContaining({
        price: band === "short" ? "0.10" : "0.50",
        conditions: expect.objectContaining(
          band === "short" ? { context_max_tokens: 100000 } : { context_min_tokens: 100001 },
        ),
      }),
    );
  });
  it.each(["missing", "malformed", "duplicate"])(
    "withholds only a broken owned footnote (%s)",
    async (change) => {
      const original = await coherentPricing();
      const note = original.match(/<p>\s*\*\* If a query input context[\s\S]*?<\/p>/)?.[0];
      if (note === undefined) throw new Error("Missing owned footnote");
      const body = original.replace(
        note,
        change === "missing"
          ? ""
          : change === "malformed"
            ? note.replace("longer than", "in a context class of")
            : note + note.replace("100k", "200K"),
      );
      const model = haiku(parse(body));
      expect(model.price_facts.some(({ conditions }) => conditions.region === "global")).toBe(
        false,
      );
      expect(model.price_facts.some(({ conditions }) => conditions.region === "us")).toBe(true);
      expect(model.raw_price_facts.length).toBeGreaterThan(0);
      expect(model.raw_price_facts.every(({ conditions }) => conditions?.region === "global")).toBe(
        true,
      );
    },
  );
  it("ignores a quoted tab label and quoted contradictory rule", async () => {
    const body = (await coherentPricing())
      .replace(
        "<main>",
        '<main><blockquote><div role="tab" id="pricing-global">Elsewhere</div><p>** If a query input context is longer than or equal to 100k tokens, all tokens (input and output) are charged at long context rates.</p></blockquote>',
      )
      .replace(
        '<div role="tabpanel" aria-labelledby="pricing-global">',
        '<div role="tabpanel" aria-labelledby="pricing-global"><blockquote><table><tr><th>Example</th></tr><tr><td>Not a tariff</td></tr></table></blockquote>',
      );
    const model = haiku(parse(body));
    expect(model.raw_price_facts).toEqual([]);
    expect(model.price_facts.some(({ conditions }) => conditions.region === "global")).toBe(true);
  });
  it.each(["duplicate", "unknown"])("withholds a broken owned location (%s)", async (change) => {
    const body = (await coherentPricing()).replace(
      '<div role="tab" id="pricing-global">Global</div>',
      change === "duplicate"
        ? '<div role="tab" id="pricing-global">Global</div><div role="tab" id="pricing-global">US</div>'
        : '<div role="tab" id="pricing-global">All locations</div>',
    );
    const result = parse(body);
    expect(haiku(result).price_facts.some(({ conditions }) => conditions.region === "us")).toBe(
      true,
    );
    expect(haiku(result).price_facts.some(({ conditions }) => conditions.region === "global")).toBe(
      false,
    );
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        reason_code: "pricing_location_scope_unresolved",
        disposition: "unresolved",
      }),
    );
  });
  it("keeps a Region-column wildcard separate from a named endpoint location", () => {
    const model = haiku(
      parse(
        "<main><table><tr><th>Model</th><th>Type</th><th>Region</th><th>Price (/1M tokens)</th></tr><tr><td>Claude Haiku 5.5</td><td>Input</td><td>Global</td><td>$0.10</td></tr><tr><td>Claude Haiku 5.5</td><td>Input</td><td>Non-global</td><td>$0.11</td></tr></table></main>",
      ),
    );
    expect(model.price_facts.map(({ conditions }) => conditions)).toEqual(
      expect.arrayContaining([
        { service_tier: undefined, deployment_scope: "global" },
        { service_tier: undefined, deployment_scope: "non-global" },
      ]),
    );
  });
  it("rejects a contradictory multi-region label", async () => {
    const result = parse(
      (await coherentPricing()).replace("US Multi-Region (US)", "US Multi-Region (EU)"),
    );
    expect(haiku(result).price_facts.some(({ conditions }) => conditions.region === "eu")).toBe(
      false,
    );
    expect(haiku(result).raw_price_facts.length).toBeGreaterThan(0);
  });
  it("does not accept a synthetic scope attribute as native evidence", () => {
    const model = haiku(
      parse(
        '<main><table data-kmodels-pricing-scope="Global"><tr><th>Model</th><th>Type</th><th>Price (/1M tokens)</th></tr><tr><td>Claude Haiku 5.5</td><td>Input</td><td>$0.10</td></tr></table></main>',
      ),
    );
    expect(model.price_facts).toHaveLength(1);
    expect(model.price_facts[0]?.conditions.region).toBeUndefined();
    expect(model.price_facts[0]?.conditions.deployment_scope).toBeUndefined();
  });
  it("binds labeled token cells to the same independently declared context bands", () => {
    const model = haiku(
      parse(
        "<main><h3>Global</h3><table><tr><th>Model</th><th>Price (/1M tokens) &lt;= 100K input tokens</th><th>Price (/1M tokens) &gt; 100K input tokens</th></tr><tr><td>Claude Haiku 5.5</td><td>Input: $0.10 Output: $0.50</td><td>Input: $0.50 Output: $2.50</td></tr></table></main>",
      ),
    );
    expect(model.price_facts).toHaveLength(4);
    expect(model.price_facts).toContainEqual(
      expect.objectContaining({
        price: "0.10",
        conditions: expect.objectContaining({ region: "global", context_max_tokens: 100000 }),
      }),
    );
    expect(model.price_facts).toContainEqual(
      expect.objectContaining({
        price: "0.50",
        meter: "input_text",
        conditions: expect.objectContaining({ region: "global", context_min_tokens: 100001 }),
      }),
    );
  });
  it("does not borrow a short-column label sequence to resolve an ambiguous long column", () => {
    const table = (operator: string, cell: string) =>
      `<table><tr><th>Model</th><th>Price (/1M tokens) ${operator} 100K input tokens **</th></tr><tr><td>Claude Haiku 5.5</td><td>${cell}</td></tr></table><p>** If a query input context is longer than 100K tokens, all tokens (input and output) are charged at long context rates.</p>`;
    const short = table("&lt;=", "Input: $0.10 Output: $0.50");
    const model = haiku(
      parse(
        `<div class="devsite-article-body"><h3>Global</h3>${short}${short}${table("&gt;", "Input: $0.50 Output: $2.50 Input: $0.60 Output: $3.00")}</div>`,
      ),
    );
    expect(model.price_facts).toHaveLength(2);
    expect(
      model.price_facts.every(({ conditions }) => conditions.context_max_tokens === 100000),
    ).toBe(true);
    expect(model.raw_price_facts).toContainEqual(
      expect.objectContaining({
        impact: "base_price",
        conditions: expect.objectContaining({ context_min_tokens: 100001 }),
        raw: expect.objectContaining({ fragment: expect.stringContaining("Input: $0.60") }),
      }),
    );
  });
  it.each(["context", "location"])(
    "admits owned %s failures to repair even when the source is unchanged",
    async (contract) => {
      const result = parse(
        contract === "context"
          ? await nativePricing()
          : (await coherentPricing()).replace(
              'id="pricing-global">Global',
              'id="pricing-global">All locations',
            ),
      );
      const reconciliation = sourcePricingReconciliation(result.models, result.findings, true);
      const candidates = catalogRepairCandidates({
        schema_version: 2,
        generated_at: observedAt,
        providers: [
          {
            provider_id: "vertex",
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
          message: expect.stringContaining(`pricing_${contract}_scope_unresolved`),
        }),
      );
    },
  );
  it.each([
    "Standard Model",
    "Standard",
    "Priority",
    "Flex/Batch",
    "Token-based pricing",
    "Modality-based pricing",
  ])("does not turn a native %s processing or unit tab into a region", (label) => {
    const model = haiku(
      parse(
        `<main><div role="tab" id="prices">${label}</div><div role="tabpanel" aria-labelledby="prices"><table><tr><th>Model</th><th>Type</th><th>Price (/1M tokens)</th></tr><tr><td>Claude Haiku 5.5</td><td>Input</td><td>$0.10</td></tr></table></div></main>`,
      ),
    );
    expect(model.raw_price_facts).toEqual([]);
    expect(model.price_facts.length).toBeGreaterThan(0);
    expect(
      model.price_facts.every(
        ({ conditions }) =>
          conditions.region === undefined && conditions.deployment_scope === undefined,
      ),
    ).toBe(true);
    if (label === "Standard" || label === "Standard Model")
      expect(model.price_facts[0]?.conditions.service_tier).toBe("standard");
  });
});
describe("Vertex account-credit price evidence", () => {
  const fixture = () =>
    readFile(new URL("./fixtures/vertex/credits-pricing.html", import.meta.url), "utf8");
  const withDiscovery = async () =>
    parse(await fixture(), [
      {
        url: "https://aiplatform.googleapis.com/$discovery/rest?version=v1beta1",
        body: await readFile(new URL("./fixtures/vertex/discovery.json", import.meta.url), "utf8"),
      },
    ]);
  const argon = (parsed: ReturnType<typeof parse>) => {
    const model = parsed.models.find(({ model_id }) => model_id === "gemini-4-argon");
    if (model === undefined) throw new Error("Missing Argon");
    return model;
  };
  it.each([false, true])(
    "does not turn credit-adjusted prices into request rates (article=%s)",
    async (article) => {
      const native = await fixture();
      const result = parse(article ? `<div class="devsite-article-body">${native}</div>` : native);
      const model = argon(result);
      expect(model.price_facts.length).toBeGreaterThan(0);
      expect(
        model.price_facts.every(({ conditions }) => conditions.effective_from === "2026-12-01"),
      ).toBe(true);
      expect(model.price_facts.some(({ price }) => price === "2" || price === "10")).toBe(false);
      expect(model.raw_price_facts).toContainEqual(
        expect.objectContaining({
          impact: "base_price",
          raw: expect.objectContaining({
            amount: "2",
            denomination: "USD",
            meter: "input_text",
            fragment: expect.stringContaining("50% credits back on net spend"),
          }),
          conditions: expect.objectContaining({
            effective_until: "2026-11-30",
            deployment_scope: "global",
          }),
        }),
      );
      expect(result.findings).toContainEqual(
        expect.objectContaining({
          disposition: "raw",
          reason_code: "account_credit_effective_price",
        }),
      );
      expect(model.raw_price_facts).toContainEqual(
        expect.objectContaining({
          raw: expect.objectContaining({
            amount: "10",
            meter: "output_text",
            fragment: expect.stringContaining("Gemini 4 Argon* through November 30, 2026"),
          }),
        }),
      );
      const cyber = result.models.find(
        ({ model_id }) => model_id === "gemini-4-argon-cyber-permissive",
      );
      expect(cyber?.raw_price_facts).toEqual([]);
      expect(cyber?.price_facts).toContainEqual(
        expect.objectContaining({ price: "4", meter: "input_text" }),
      );
      expect(
        cyber?.price_facts.every(
          ({ conditions }) =>
            conditions.effective_from === undefined && conditions.promotion === undefined,
        ),
      ).toBe(true);
    },
  );
  it.each(["missing", "unreadable", "duplicate", "quoted"])(
    "keeps an unresolved owned model footnote raw (%s)",
    async (change) => {
      const body = await fixture();
      const note = body.match(/<p>\s*\* Promotional pricing[^<]+<\/p>/)?.[0];
      if (note === undefined) throw new Error("Missing credit note");
      const result = parse(
        body.replace(
          note,
          change === "missing"
            ? ""
            : change === "unreadable"
              ? note.replace("50% credits back", "a changing benefit")
              : change === "quoted"
                ? `<blockquote>${note}</blockquote>`
                : note + note.replace("50%", "25%"),
        ),
      );
      expect(argon(result).price_facts.some(({ price }) => price === "2")).toBe(false);
      expect(result.findings).toContainEqual(
        expect.objectContaining({
          disposition: "unresolved",
          reason_code: "pricing_model_scope_unresolved",
        }),
      );
      expect(
        argon(result).price_facts.some(
          ({ price, conditions }) => price === "4" && conditions.effective_from === "2026-12-01",
        ),
      ).toBe(true);
    },
  );
  it("does not borrow an unrelated widget's credit note", async () => {
    const body = await fixture();
    const note = body.match(/<p>\s*\* Promotional pricing[^<]+<\/p>/)?.[0];
    if (note === undefined) throw new Error("Missing credit note");
    const result = parse(
      body
        .replace(note, "")
        .replace(
          "<span>",
          `<div><table><tr><th>Unrelated</th></tr><tr><td>Not a price</td></tr></table>${note}</div><span>`,
        ),
    );
    expect(result.findings).not.toContainEqual(
      expect.objectContaining({ reason_code: "account_credit_effective_price" }),
    );
    expect(result.findings).toContainEqual(
      expect.objectContaining({ reason_code: "pricing_model_scope_unresolved" }),
    );
  });
  it("keeps the same credit boundary in labeled cells", () => {
    const result = parse(
      "<main><table><tr><th>Model</th><th>Price (/1M tokens)</th></tr><tr><td>Gemini 4 Argon* through November 30, 2026</td><td>Input: $2 Output: $10</td></tr></table><p>* Promotional pricing provided through 50% credits back on net spend on select models within a given period.</p></main>",
    );
    expect(argon(result).price_facts).toEqual([]);
    expect(argon(result).raw_price_facts).toContainEqual(
      expect.objectContaining({
        raw: expect.objectContaining({ amount: "2", meter: "input_text" }),
      }),
    );
  });
  it("reports an unknown member of a mixed price label while retaining the known model's own quote", async () => {
    const result = parse(
      (await fixture()).replace(
        "<p>Gemini 4 Argon Cyber Permissive</p>",
        "<p>Gemini Future Unknown</p>",
      ),
    );
    expect(argon(result).price_facts).toContainEqual(
      expect.objectContaining({
        price: "4",
        conditions: expect.objectContaining({ effective_from: "2026-12-01" }),
      }),
    );
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        reason_code: "pricing_model_unbound",
        sample: "Gemini Future Unknown",
      }),
    );
  });
  it("reports contradictory model eligibility instead of treating it as an understood credit", async () => {
    const result = parse(
      (await fixture()).replace(
        "does not apply to Gemini 4 Argon Cyber\n          Permissive",
        "does not apply to Gemini 4 Argon",
      ),
    );
    expect(result.findings).toContainEqual(
      expect.objectContaining({ reason_code: "pricing_model_scope_unresolved" }),
    );
    expect(argon(result).price_facts.some(({ price }) => price === "2")).toBe(false);
  });
  it.each(["known-credit", "missing-contract"])(
    "separates intentional credit exclusion from repairable source drift (%s)",
    async (kind) => {
      const body = await fixture();
      const result = parse(
        kind === "known-credit" ? body : body.replace(/<p>\s*\* Promotional pricing[^<]+<\/p>/, ""),
      );
      const candidates = catalogRepairCandidates({
        schema_version: 2,
        generated_at: observedAt,
        providers: [
          {
            provider_id: "vertex",
            signals: [],
            attempt: {
              outcome: "accepted",
              sources: [
                {
                  source_id: source.id,
                  outcome: "unchanged",
                  content_changed: false,
                  pricing_reconciliation: sourcePricingReconciliation(
                    result.models,
                    result.findings,
                    true,
                  ),
                },
              ],
            },
          },
        ],
      });
      expect(
        candidates.some(({ message }) => message.includes("pricing_model_scope_unresolved")),
      ).toBe(kind === "missing-contract");
    },
  );
  it("calculates the independently unmarked Cyber tariff without charging output again as cache reads", async () => {
    const parsed = await withDiscovery();
    const cyber = parsed.models.find(
      ({ model_id }) => model_id === "gemini-4-argon-cyber-permissive",
    );
    expect(
      cyber?.price_facts
        .filter(({ meter }) => meter.startsWith("cache_read_"))
        .every(({ price }) => price === "0.2" || price === "0.22"),
    ).toBe(true);
  });
});
