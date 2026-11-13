import { readFile } from "node:fs/promises";
import { expect, it } from "vite-plus/test";
import { z } from "zod";
import { parseSource } from "../src/catalog/adapters.ts";
import { manifests } from "../src/catalog/manifests.ts";

const bundleSchema = z.object({
  index: z.object({ url: z.string(), body: z.string() }),
  documents: z.array(z.object({ url: z.string(), body: z.string() })),
});
const fixture = bundleSchema.parse(
  JSON.parse(
    await readFile(
      new URL("./fixtures/bedrock/residual-route-pricing.json", import.meta.url),
      "utf8",
    ),
  ),
);
function parse(modelId: string, change?: (bundle: z.infer<typeof bundleSchema>) => void) {
  const bundle = structuredClone(fixture);
  change?.(bundle);
  const manifest = manifests.find((m) => m.provider.id === "amazon-bedrock");
  const source = manifest?.sources.find((s) => s.id === "bedrock-models");
  if (!source || !manifest) throw new Error("Missing Bedrock manifest");
  const parsed = parseSource({
    provider: { ...manifest.provider, source_ids: [source.id] },
    source,
    body: JSON.stringify(bundle),
    observedAt: "2026-11-13T00:00:00Z",
  });
  const model = parsed.models.find((m) => m.model_id === modelId);
  if (!model) throw new Error(`Missing ${modelId}`);
  return model;
}
const gov = (model: ReturnType<typeof parse>) =>
  model.price_facts.filter((f) => f.conditions.inference_geo === "us-gov");

it("reads both nested GovCloud context bands and cache TTL without leaking commercial prices", () => {
  const model = parse("openai.gpt-5.6-luna");
  const writes = gov(model).filter(
    (f) => f.meter === "cache_write_text" && f.conditions.region === "us-gov-east-1",
  );
  expect(
    writes.map((f) => [
      f.price,
      f.conditions.context_min_tokens,
      f.conditions.context_max_tokens,
      f.conditions.cache_ttl_seconds,
    ]),
  ).toEqual([
    ["0.3375", undefined, 272000, 1800],
    ["0.675", 272001, undefined, 1800],
  ]);
  expect(
    gov(model).every(
      (f) =>
        f.conditions.endpoint === "bedrock-runtime" && f.conditions.region?.startsWith("us-gov-"),
    ),
  ).toBe(true);
});

it("preserves prices as raw evidence when a GovCloud parent heading is duplicated", () => {
  const model = parse("openai.gpt-5.6-luna", (b) => {
    const card = b.documents.find((d) => d.url.endsWith("model-card-openai-gpt-56-luna.md"));
    if (!card) throw new Error("Missing card");
    card.body = card.body.replace(
      "## Programmatic Access",
      "### AWS GovCloud (US-East and US-West)\n\n## Programmatic Access",
    );
  });
  expect(gov(model)).toEqual([]);
  expect(
    model.raw_price_facts.some(
      (f) => f.raw.amount === "0.27" && f.reason === "unknown_applicability",
    ),
  ).toBe(true);
  expect(model.price_facts.some((f) => f.conditions.region === "us-east-1")).toBe(true);
});

it("does not let a dedicated GovCloud profile table revive an expired source Region", () => {
  const model = parse("nvidia.nemotron-nano-3-30b", (b) => {
    const card = b.documents.find((d) =>
      d.url.endsWith("model-card-nvidia-nemotron-nano-3-30b.md"),
    );
    if (!card) throw new Error("Missing card");
    card.body = card.body
      .split("\n")
      .map((line) => {
        if (!line.startsWith("| us-gov-west-1 (GovCloud) |")) return line;
        const cells = line.split("|");
        cells[3] = " EOL: 2026-09-10 ";
        return cells.join("|");
      })
      .join("\n");
  });
  expect(gov(model).some((f) => f.conditions.region === "us-gov-west-1")).toBe(false);
  expect(gov(model).some((f) => f.conditions.region === "us-gov-east-1")).toBe(true);
});

it("requires the Standard tariff policy for non-token and GovCloud SKU extensions", () => {
  const withoutGuide = (b: z.infer<typeof bundleSchema>) => {
    b.documents = b.documents.filter((d) => !d.url.endsWith("/cross-region-inference.md"));
  };
  expect(gov(parse("nvidia.nemotron-nano-9b-v2", withoutGuide))).toEqual([]);
  const marengo = parse("twelvelabs.marengo-embed-3-0-v1:0", withoutGuide);
  expect(
    marengo.price_facts.some((f) => f.conditions.deployment_scope === "geo_cross_region"),
  ).toBe(false);
  expect(marengo.price_facts.some((f) => f.conditions.deployment_scope === "in_region")).toBe(true);
  expect(gov(parse("openai.gpt-5.6-luna", withoutGuide)).length).toBeGreaterThan(0);
});

it.each(["eu", "undocumented"])(
  "does not assign the overview when another %s profile lacks scope evidence",
  (prefix) => {
    const model = parse("openai.gpt-5.5", (b) => {
      const card = b.documents.find((d) => d.url.endsWith("model-card-openai-gpt-55.md"));
      if (!card) throw new Error("Missing card");
      card.body = card.body.replace(
        "| us.openai.gpt-5.5 |",
        `| us.openai.gpt-5.5 ${prefix}.openai.gpt-5.5 |`,
      );
    });
    expect(
      model.price_facts.some((f) => f.conditions.deployment_scope === "geo_cross_region"),
    ).toBe(false);
    expect(model.price_facts.some((f) => f.conditions.endpoint === "bedrock-mantle")).toBe(true);
  },
);

it("matches the complete native model name rather than dropping the precision or variant suffix", () => {
  const model = parse("nvidia.nemotron-nano-12b-v2", (b) => {
    for (const d of b.documents.filter((d) => d.url.includes("pricing.us-east-1")))
      d.body = d.body.replaceAll("Nemotron-Nano-12B-V2-VL-BF16-", "Nemotron-Nano-12B-V2-VL-FP8-");
  });
  expect(gov(model)).toEqual([]);
  expect(model.price_facts.some((f) => f.conditions.endpoint === "bedrock-mantle")).toBe(true);
});

it("does not treat Pegasus destination prose as source-region evidence without its owning statement", () => {
  const model = parse("twelvelabs.pegasus-1-5-v1:0", (b) => {
    const card = b.documents.find((d) => d.url.endsWith("model-card-twelvelabs-pegasus-v1-5.md"));
    if (!card) throw new Error("Missing card");
    card.body = card.body.replace(
      "The Region you call is the source Region.",
      "The table describes destination Regions.",
    );
    // Two named profiles prevent the independent single-profile overview rule.
    card.body = card.body.replace(
      "| us.twelvelabs.pegasus-1-5-v1:0 |",
      "| us.twelvelabs.pegasus-1-5-v1:0 eu.twelvelabs.pegasus-1-5-v1:0 |",
    );
  });
  expect(model.price_facts.some((f) => f.conditions.deployment_scope === "geo_cross_region")).toBe(
    false,
  );
  expect(
    model.price_facts.some((f) => f.conditions.deployment_scope === "global_cross_region"),
  ).toBe(true);
});
