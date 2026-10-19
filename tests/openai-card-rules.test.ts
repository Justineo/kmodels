import { readFile } from "node:fs/promises";
import { load } from "cheerio";
import { z } from "zod";
import { describe, expect, it } from "vite-plus/test";
import { parseSource } from "../src/catalog/adapters.ts";
import { manifests } from "../src/catalog/manifests.ts";
import { baseModel } from "../src/catalog/model.ts";
import type { PricingReconciliationItem } from "../src/catalog/pricing-reconciliation.ts";

const manifest = manifests.find((m) => m.provider.id === "openai");
if (manifest === undefined) throw new Error("Missing OpenAI manifest");
const configured = manifest.sources.find((s) => s.id === "openai-overview");
if (configured === undefined) throw new Error("Missing OpenAI card source");
const source = configured;
const observedAt = "2026-10-19T05:21:04.602Z";
const provider = { ...manifest.provider, source_ids: manifest.sources.map((s) => s.id) };
const target = {
  ...baseModel({
    providerId: provider.id,
    id: "gpt-6-sol",
    name: "Sol",
    sourceId: "openai-models",
    observedAt,
  }),
  tasks: ["text_generation" as const],
};
const bundleSchema = z.object({
  index: z.object({ url: z.string(), body: z.string() }),
  documents: z.array(z.object({ url: z.string(), body: z.string() })),
});
async function bundle() {
  return bundleSchema.parse(
    JSON.parse(
      await readFile(
        new URL("./fixtures/openai/current-price-cards.json", import.meta.url),
        "utf8",
      ),
    ),
  );
}
function card(input: z.infer<typeof bundleSchema>) {
  const result = input.documents.find((d) => d.url.endsWith("/gpt-6-sol"));
  if (result === undefined) throw new Error("Missing native Sol card");
  return result;
}
function parse(input: z.infer<typeof bundleSchema>, findings: PricingReconciliationItem[] = []) {
  const result = parseSource({
    provider,
    source,
    body: JSON.stringify(input),
    observedAt,
    catalogModels: [target],
    onPricingReconciliation: (item) => findings.push(item),
  }).models.find((m) => m.model_id === target.model_id);
  if (result === undefined) throw new Error("Missing Sol prices");
  return result;
}

describe("owned OpenAI card price rules", () => {
  it("establishes both bands from the native conditional rule before assembly", async () => {
    const model = parse(await bundle());
    expect(model.price_facts).toHaveLength(8);
    expect(
      model.price_facts.filter((r) => r.conditions.context_max_tokens === 272000),
    ).toHaveLength(4);
    expect(
      model.price_facts.filter((r) => r.conditions.context_min_tokens === 272001),
    ).toHaveLength(4);
    expect(model.raw_price_facts).toEqual([]);
  });
  it.each(["blockquote", "pre"])("does not execute %s price examples", async (tag) => {
    const input = await bundle();
    const doc = card(input);
    const $ = load(doc.body);
    const content = $("section").first().children().eq(1);
    content.append(`<${tag}>${content.html()?.replace("$2.00", "$999.00")}</${tag}>`);
    doc.body = $.html();
    const model = parse(input);
    expect(model.price_facts).toHaveLength(8);
    expect(model.price_facts.some((r) => r.price === "999.00")).toBe(false);
  });
  it.each(["outside", "quoted", "code"])("does not execute %s pricing prose", async (change) => {
    const input = await bundle();
    const doc = card(input);
    const $ = load(doc.body);
    const notes = $("p");
    const html = notes.toString();
    notes.remove();
    if (change === "outside")
      $("main").append("<section><div>Examples</div>" + html + "</section>");
    else
      $("section")
        .first()
        .children()
        .eq(1)
        .append(
          change === "quoted" ? "<blockquote>" + html + "</blockquote>" : "<pre>" + html + "</pre>",
        );
    doc.body = $.html();
    const model = parse(input);
    expect(model.price_facts).toHaveLength(4);
    expect(
      model.price_facts.every(
        (r) =>
          !r.derived &&
          r.conditions.context_min_tokens === undefined &&
          r.conditions.context_max_tokens === undefined,
      ),
    ).toBe(true);
  });
  it.each(["272,00", "0272K", "9007199254740991", "9007199254740992", "many"])(
    "preserves an unsafe/unknown prompt bound (%s) as raw",
    async (value) => {
      const input = await bundle();
      const doc = card(input);
      doc.body = doc.body.replace("more than 272K", `more than ${value}`);
      const findings: PricingReconciliationItem[] = [];
      const model = parse(input, findings);
      expect(model.price_facts).toHaveLength(4);
      expect(
        model.price_facts.every(
          (r) =>
            r.conditions.context_min_tokens === undefined &&
            r.conditions.context_max_tokens === undefined,
        ),
      ).toBe(true);
      expect(model.raw_price_facts).toContainEqual(
        expect.objectContaining({
          reason: "unknown_applicability",
          raw: expect.objectContaining({ fragment: expect.stringContaining(value) }),
        }),
      );
      expect(findings).toContainEqual(
        expect.objectContaining({
          disposition: "unresolved",
          reason_code: "model_card_price_scope_unresolved",
        }),
      );
    },
  );
  it("retains a known short band when the long amount rule is unreadable", async () => {
    const input = await bundle();
    const doc = card(input);
    doc.body = doc.body.replace("2x input and cache rates", "unknownx input and cache rates");
    const model = parse(input);
    expect(model.price_facts).toHaveLength(4);
    expect(model.price_facts.every((r) => r.conditions.context_max_tokens === 272000)).toBe(true);
    expect(model.raw_price_facts).toContainEqual(
      expect.objectContaining({
        conditions: expect.objectContaining({ context_min_tokens: 272001 }),
      }),
    );
  });
  it("does not choose between contradictory conditional rules", async () => {
    const input = await bundle();
    const doc = card(input);
    const $ = load(doc.body);
    const note = $("p")
      .filter((_, p) => $(p).text().startsWith("Prompts with"))
      .first();
    note.after(note.toString().replace("272K", "300K"));
    doc.body = $.html();
    const model = parse(input);
    expect(model.price_facts).toHaveLength(4);
    expect(model.price_facts.every((r) => r.conditions.context_max_tokens === undefined)).toBe(
      true,
    );
    expect(
      model.raw_price_facts.filter((r) => r.term_key === "long-context-multiplier"),
    ).toHaveLength(2);
  });
  it("keeps an explicit flat cache quote when the long rule does not qualify cache writes", async () => {
    const input = await bundle();
    const doc = card(input);
    doc.body = doc.body.replace("input and cache rates", "input");
    const model = parse(input);
    const writes = model.price_facts.filter((r) => r.meter === "cache_write_text");
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      price: "2.50",
      derived: false,
      conditions: { service_tier: "standard" },
    });
    expect(writes[0]?.conditions.context_min_tokens).toBeUndefined();
    expect(writes[0]?.conditions.context_max_tokens).toBeUndefined();
  });
  it("composes missing cache-write prices with both source-owned input bands", async () => {
    const input = await bundle();
    const doc = card(input);
    const $ = load(doc.body);
    $("div")
      .filter((_, e) => $(e).children().first().text() === "Cache writes")
      .remove();
    doc.body = $.html();
    const writes = parse(input).price_facts.filter((r) => r.meter === "cache_write_text");
    expect(writes).toMatchObject([
      { price: "2.5", conditions: { context_max_tokens: 272000 } },
      { price: "5", conditions: { context_min_tokens: 272001 } },
    ]);
  });
  it("rejects competing Pricing owners rather than borrowing the first one", async () => {
    const input = await bundle();
    const doc = card(input);
    const $ = load(doc.body);
    $("main").append($("section").first().clone());
    doc.body = $.html();
    const model = parse(input);
    expect(model.price_facts).toEqual([]);
    expect(model.raw_price_facts.length).toBeGreaterThan(0);
  });
  it("does not discard an empty competing Pricing owner", async () => {
    const input = await bundle();
    const doc = card(input);
    doc.body = doc.body.replace("</main>", "<section><div>Pricing</div></section></main>");
    const model = parse(input);
    expect(model.price_facts).toEqual([]);
    expect(model.raw_price_facts.length).toBeGreaterThan(0);
  });
  it("keeps a short-context column bounded when every long quote is absent", () => {
    const pricing = manifest.sources.find((s) => s.id === "openai-pricing");
    if (pricing === undefined) throw new Error("Missing pricing source");
    const models = parseSource({
      provider,
      source: pricing,
      observedAt,
      catalogModels: [],
      body: "Cyber models\n\nStandard\n\n| Model | Short context input | Short context cached input | Short context cache writes | Short context output | Long context input | Long context cached input | Long context cache writes | Long context output |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- |\n| gpt-5.6-cyber | $12.50 | $1.25 | $15.625 | $75.00 | - | - | - | - |",
    }).models;
    const model = models.find((m) => m.model_id === "gpt-5.6-cyber");
    expect(model).toBeDefined();
    expect(model?.price_facts).toHaveLength(4);
    expect(model?.price_facts.every((r) => r.conditions.context_max_tokens === 272000)).toBe(true);
  });
});
