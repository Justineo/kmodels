import { expect, it } from "vite-plus/test";
import { anthropicCardsBundle } from "./anthropic-fixture.ts";
import { parseSource } from "../src/catalog/adapters.ts";
import { manifests } from "../src/catalog/manifests.ts";

type Bundle = Awaited<ReturnType<typeof anthropicCardsBundle>>;
function parse(bundle: Bundle) {
  const manifest = manifests.find(({ provider }) => provider.id === "anthropic");
  const source = manifest?.sources.find(({ id }) => id === "anthropic-model-cards");
  if (!manifest || !source) throw new Error("Missing model card source");
  return parseSource({
    provider: { ...manifest.provider, source_ids: [source.id] },
    source,
    body: JSON.stringify(bundle),
    observedAt: "2026-11-14T00:00:00Z",
  });
}

it("owns exact Claude IDs, aliases and specifications independently of comparison widgets", async () => {
  const result = parse(await anthropicCardsBundle());
  expect(
    result.models.find(({ model_id }) => model_id === "claude-opus-4-5-20251101"),
  ).toMatchObject({
    aliases: ["claude-opus-4-5"],
    limits: { context_tokens: 200000, max_output_tokens: 64000 },
    release_date: "2025-11-24",
    status: "active",
  });
  expect(result.models.find(({ model_id }) => model_id === "claude-mythos-5-2")).toMatchObject({
    aliases: [],
    limits: { context_tokens: 1000000, max_output_tokens: 128000 },
    status: "active",
  });
  const aliases = result.inference_prices?.filter(({ model_id }) => model_id === "claude-opus-4-5");
  expect(new Set(aliases?.map(({ offer_key }) => offer_key))).toEqual(new Set(["sync", "batch"]));
  expect(
    aliases
      ?.flatMap(({ evidence }) => evidence ?? [])
      .some(({ locator }) => locator?.value.includes("/models/opus-4-5/overview.md")),
  ).toBe(true);
  expect(result.inference_prices?.some(({ model_id }) => model_id.startsWith("anthropic."))).toBe(
    false,
  );
});

it.each(["identity", "duplicate", "fenced"])(
  "withholds an unowned card and preserves siblings (%s)",
  async (change) => {
    const bundle = await anthropicCardsBundle();
    const first = bundle.documents[0];
    if (!first) throw new Error("Missing card");
    if (change === "identity")
      first.body = first.body.replace(
        /\| Claude API\s*\| `claude-opus-4-5-20251101`\s*\|/,
        "| Claude API | `wrong-id` |",
      );
    else if (change === "duplicate")
      bundle.documents.push({ ...first, url: first.url.replace("opus-4-5", "other") });
    else first.body = "```\n" + first.body + "\n```";
    const result = parse(bundle);
    expect(result.models.map(({ model_id }) => model_id)).toEqual(["claude-mythos-5-2"]);
    expect(result.inference_prices?.some(({ model_id }) => model_id === "claude-opus-4-5")).toBe(
      false,
    );
  },
);

it("withholds only unreadable fields and withdrawn alias associations", async () => {
  const bundle = await anthropicCardsBundle();
  const first = bundle.documents[0];
  if (!first) throw new Error("Missing card");
  first.body = first.body
    .replace("200K tokens", "unknown")
    .replace("November 24, 2025", "November 31, 2025")
    .replace(/\| Claude API alias\s*\| `claude-opus-4-5`\s*\|/, "| Claude API alias | N/A |");
  const result = parse(bundle);
  expect(
    result.models.find(({ model_id }) => model_id === "claude-opus-4-5-20251101"),
  ).toMatchObject({ aliases: [], limits: { max_output_tokens: 64000 } });
  expect(
    result.models.find(({ model_id }) => model_id === "claude-opus-4-5-20251101")?.release_date,
  ).toBeUndefined();
  expect(result.inference_prices?.some(({ model_id }) => model_id === "claude-opus-4-5")).toBe(
    false,
  );
});

it("keeps card metadata when the independent ID contract is unavailable", async () => {
  const bundle = await anthropicCardsBundle();
  bundle.documents = bundle.documents.filter(
    ({ url }) => !url.endsWith("model-ids-and-versions.md"),
  );
  const result = parse(bundle);
  expect(result.models).toHaveLength(2);
  expect(result.inference_prices).toEqual([]);
});
