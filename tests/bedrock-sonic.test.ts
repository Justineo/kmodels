import { readFile } from "node:fs/promises";
import { load } from "cheerio";
import { describe, expect, it } from "vite-plus/test";
import { extractBedrockPricingInputs } from "../src/catalog/bedrock-accounting.ts";
import { linkedBundleSchema } from "../src/catalog/bundle.ts";
import { parseSource } from "../src/catalog/adapters.ts";
import { manifests } from "../src/catalog/manifests.ts";
import { indexPricingInputs, pricingInputFacts } from "../src/catalog/pricing-input.ts";
import type { PricingReconciliationItem } from "../src/catalog/pricing-reconciliation.ts";
import { sonicDocuments as documents, sonicBundle } from "./bedrock-sonic-fixtures.ts";
import { sourcePricingReconciliation } from "../src/catalog/pricing-reconciliation.ts";
import { catalogRepairCandidates } from "../src/catalog/catalog-repair.ts";

function configuration() {
  const manifest = manifests.find(({ provider }) => provider.id === "amazon-bedrock");
  const source = manifest?.sources.find(({ id }) => id === "bedrock-accounting");
  if (manifest === undefined || source === undefined)
    throw new Error("Missing Bedrock accounting source");
  return {
    source,
    provider: { ...manifest.provider, source_ids: manifest.sources.map(({ id }) => id) },
  };
}
const { source, provider } = configuration();
const sourceRef = source.id;
const model1 = "amazon-bedrock/amazon.nova-sonic-v1:0";
const model2 = "amazon-bedrock/amazon.nova-2-sonic-v1:0";
function extract(documents: Array<{ url: string; body: string }>) {
  const reconciliation: PricingReconciliationItem[] = [];
  const result = parseSource({
    provider,
    source,
    observedAt: "2026-10-19T09:26:17.129Z",
    body: sonicBundle(documents, source.url),
    onPricingReconciliation: (item) => reconciliation.push(item),
  });
  return { ...result, inputs: result.pricing_inputs ?? [], reconciliation };
}

describe("Bedrock native Sonic usage", () => {
  it("admits a lone native field drift for repair on unchanged source bytes", async () => {
    const docs = await documents();
    const doc = docs[1];
    if (doc === undefined) throw new Error("Missing current native protocol");
    doc.body = doc.body.replace(
      '"speechTokens": number, // input speech tokens',
      '"renamed": number, // input speech tokens',
    );
    const { inputs, reconciliation: items } = extract(docs);
    expect(inputs).toHaveLength(7);
    expect(items).toEqual([
      {
        disposition: "unbound",
        reason_code: "pricing_input_contract_partial",
        sample: "7/8 Bedrock Sonic pricing inputs",
      },
    ]);
    const reconciliation = sourcePricingReconciliation([], items, true);
    expect(
      catalogRepairCandidates({
        schema_version: 2,
        generated_at: "2026-10-19T09:26:17.111Z",
        providers: [
          {
            provider_id: "amazon-bedrock",
            signals: [],
            attempt: {
              outcome: "accepted",
              sources: [
                {
                  source_id: sourceRef,
                  outcome: "unchanged",
                  content_changed: false,
                  pricing_reconciliation: reconciliation,
                },
              ],
            },
          },
        ],
      }),
    ).toEqual([
      expect.objectContaining({
        source_id: sourceRef,
        trigger: "source_pricing_structure",
        message: expect.stringContaining("pricing_input_contract_partial"),
      }),
    ]);
  });
  it("retains the complete accounting contract alongside independent model-specific events", async () => {
    const base = linkedBundleSchema.parse(
      JSON.parse(
        await readFile(new URL("./fixtures/document/bedrock.json", import.meta.url), "utf8"),
      ),
    );
    const reconciliation: PricingReconciliationItem[] = [];
    expect(
      extractBedrockPricingInputs(base.documents, "bedrock-models", (item) =>
        reconciliation.push(item),
      ),
    ).toHaveLength(32);
    expect(reconciliation).toEqual([
      {
        disposition: "normalized",
        reason_code: "pricing_input_contract_bound",
        sample: "32/32 Bedrock pricing inputs",
      },
    ]);
    const sonic = extract(await documents());
    expect(sonic.models).toEqual([]);
    expect(sonic.inputs).toHaveLength(8);
    expect(sonic.reconciliation).toEqual([
      {
        disposition: "normalized",
        reason_code: "pricing_input_contract_bound",
        sample: "8/8 Bedrock Sonic pricing inputs",
      },
    ]);
    expect(source).toMatchObject({
      optional: true,
      role: "supplement",
      fields: ["pricing_inputs"],
      extractorVersion: "bedrock-accounting-v1",
    });
  });
  it("owns four incremental counters independently for each declared model", async () => {
    const { inputs } = extract(await documents());
    expect(inputs).toHaveLength(8);
    const index = indexPricingInputs(inputs);
    expect(pricingInputFacts(index, ["runtime.sonic.input_audio_delta_tokens"])).toEqual([]);
    for (const model of [model1, model2]) {
      expect(pricingInputFacts(index, ["runtime.sonic.input_audio_delta_tokens"], model)).toEqual([
        {
          key: "runtime.sonic.input_audio_delta_tokens",
          model_refs: [model],
          channel: "stream_event",
          locator: {
            kind: "json_pointer",
            value: "/event/usageEvent/details/delta/input/speechTokens",
          },
          availability: "conditional",
          source_ref: sourceRef,
        },
      ]);
    }
    expect(inputs.every(({ absent_value }) => absent_value === undefined)).toBe(true);
    expect(inputs.every(({ locator }) => !locator.value.includes("total"))).toBe(true);
  });

  it.each(["missing", "retyped", "unsafe", "negative", "duplicate-counter"])(
    "withholds only the changed native counter (%s)",
    async (change) => {
      const docs = await documents();
      const doc = docs[1];
      if (doc === undefined) throw new Error("Missing Sonic2 fixture");
      doc.body = doc.body.replace(
        '"speechTokens": number, // input speech tokens',
        change === "missing"
          ? '"changed": number, // input speech tokens'
          : change === "retyped"
            ? '"speechTokens": "number", // input speech tokens'
            : change === "unsafe"
              ? '"speechTokens": 9007199254740992, // input speech tokens'
              : change === "negative"
                ? '"speechTokens": -1, // input speech tokens'
                : '"speechTokens": number, "speechTokens": number, // input speech tokens',
      );
      const result = extract(docs);
      expect(result.inputs).toHaveLength(7);
      const index = indexPricingInputs(result.inputs);
      expect(pricingInputFacts(index, ["runtime.sonic.input_audio_delta_tokens"], model2)).toEqual(
        [],
      );
      expect(
        pricingInputFacts(index, ["runtime.sonic.output_audio_delta_tokens"], model2),
      ).toHaveLength(1);
      expect(result.reconciliation).toContainEqual(
        expect.objectContaining({ reason_code: "pricing_input_contract_partial" }),
      );
    },
  );

  it.each(["missing", "duplicated", "unowned"])(
    "requires the current guide's Usage Tracking section (%s)",
    async (change) => {
      const docs = await documents();
      const doc = docs[1];
      if (doc === undefined) throw new Error("Missing current guide");
      const $ = load(doc.body);
      const tracking = $("h2#sonic-usage-tracking");
      if (change === "missing") tracking.remove();
      else if (change === "duplicated") $("main").append(tracking.toString());
      else $("h2#sonic-completion").after(tracking.nextUntil("h2").toString());
      if (change === "unowned") tracking.nextUntil("h2").remove();
      doc.body = $.html();
      expect(extract(docs).inputs.map(({ model_refs }) => model_refs)).toEqual([
        [model1],
        [model1],
        [model1],
        [model1],
      ]);
    },
  );

  it.each([
    "duplicate-example",
    "duplicate-heading",
    "quoted",
    "wrong-frame",
    "wrong-event",
    "malformed",
  ])("does not borrow an uncertain event shape (%s)", async (change) => {
    const docs = await documents();
    const doc = docs[1];
    if (doc === undefined) throw new Error("Missing Sonic2 fixture");
    const $ = load(doc.body);
    const example = $("pre").first().toString();
    doc.body =
      change === "duplicate-example"
        ? doc.body.replace("</main>", example + "</main>")
        : change === "duplicate-heading"
          ? doc.body.replace("</main>", "<h2>Output Event Flow</h2></main>")
          : change === "quoted"
            ? `<blockquote>${doc.body}</blockquote>`
            : change === "wrong-frame"
              ? doc.body.replace('"event":', '"payload":')
              : change === "wrong-event"
                ? doc.body.replace('"usageEvent":', '"completionEnd":')
                : doc.body.replace(/<\/code>(\s*<\/pre>)/u, ";</code>$1");
    const result = extract(docs);
    expect(result.inputs).toHaveLength(4);
    expect(result.inputs.every(({ model_refs }) => model_refs?.includes(model1))).toBe(true);
  });

  it.each([
    "missing-owner",
    "wrong-owner",
    "unsupported-owner",
    "duplicate-document",
    "quoted-prose",
  ])("requires native model and quantity ownership (%s)", async (change) => {
    const docs = await documents();
    const guide = docs[1];
    const models = docs[2];
    if (guide === undefined || models === undefined) throw new Error("Missing owner fixtures");
    if (change === "missing-owner") docs.splice(2, 1);
    else if (change === "wrong-owner")
      models.body = models.body.replace("Amazon Nova 2 Sonic", "Another speech model");
    else if (change === "unsupported-owner")
      models.body = models.body.replace(
        /uses\s+it\s+as\s+its\s+sole\s+invocation\s+path/u,
        "cannot use this invocation path",
      );
    else if (change === "duplicate-document") docs.push({ ...guide });
    else guide.body = guide.body.replace("incremental changes", "<code>incremental changes</code>");
    const result = extract(docs);
    expect(result.inputs).toHaveLength(4);
    expect(result.inputs.every(({ model_refs }) => model_refs?.includes(model1))).toBe(true);
  });

  it("rejects duplicate legacy model declarations without losing the independent current protocol", async () => {
    const docs = await documents();
    const doc = docs[3];
    if (doc === undefined) throw new Error("Missing legacy owner fixture");
    const $ = load(doc.body);
    const term = $("dt").first();
    $("dl").append(term.toString() + term.nextUntil("dt").filter("dd").toString());
    doc.body = $.html();
    expect(extract(docs).inputs.map(({ model_refs }) => model_refs)).toEqual([
      [model2],
      [model2],
      [model2],
      [model2],
    ]);
  });

  it("ignores quoted copies while retaining the owned event", async () => {
    const docs = await documents();
    const doc = docs[1];
    if (doc === undefined) throw new Error("Missing current guide");
    const $ = load(doc.body);
    $("main").append(
      `<blockquote><h2>Output Event Flow</h2>${$("pre").first().toString()}</blockquote>`,
    );
    doc.body = $.html();
    expect(extract(docs).inputs).toHaveLength(8);
  });
});
