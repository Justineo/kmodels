import { readFile } from "node:fs/promises";
import { beforeAll, describe, expect, it } from "vite-plus/test";
import { parseSource } from "../src/catalog/adapters.ts";
import type { LinkedBundle } from "../src/catalog/bundle.ts";
import { applyGroups } from "../src/catalog/collector.ts";
import { manifests } from "../src/catalog/manifests.ts";
import { catalogModels } from "../src/catalog/publication.ts";
import { providerModelSchema, sourceRecordSchema } from "../src/catalog/schema.ts";
import type { ParsedProviderModel } from "../src/catalog/pricing-source.ts";
import { geminiInferenceFixtures } from "./gemini-inference-fixture.ts";

function configuration() {
  const manifest = manifests.find(({ provider }) => provider.id === "gemini");
  const source = manifest?.sources.find(({ id }) => id === "gemini-models");
  if (!manifest || !source) throw new Error("Missing Gemini catalog source");
  return { manifest, source };
}
const { manifest, source } = configuration();
const provider = { ...manifest.provider, source_ids: manifest.sources.map(({ id }) => id) };
const at = "2026-11-17T15:12:19.051Z";
const modelId = "capability-marker-probe";
const thinkingBadge = '{% badge label=Supported (low, medium, high) type="supported" /%}';
const cachingBadge = '{% badge label=Supported (Implicit only) type="supported" /%}';
const supportedBadge = '{% badge type="supported" /%}';
const unsupportedBadge = '{% badge type="not-supported" /%}';
let bundle: LinkedBundle;
let markdown: string;

beforeAll(async () => {
  bundle = (await geminiInferenceFixtures()).catalog;
  // Reduced native markup from the retained Gemini 3.7 Flash and Carbon pages,
  // observed 2026-11-17; synthetic identity prevents companion-model enrichment.
  markdown = await readFile(
    new URL("./fixtures/gemini/capability-markers.txt", import.meta.url),
    "utf8",
  );
});

function parsePage(body: string): ParsedProviderModel {
  const result = parseSource({
    provider,
    source,
    observedAt: at,
    body: JSON.stringify({
      ...bundle,
      documents: [
        ...bundle.documents,
        { url: `https://aistudio.google.com/docs/models/${modelId}`, body },
      ],
    }),
  }).models.find(({ model_id }) => model_id === modelId);
  if (!result) throw new Error("Capability probe did not parse");
  return result;
}

function htmlPage(markers: string): string {
  return `<h1 class="devsite-page-title">Capability marker probe</h1>
    <div class="devsite-article-body"><table>
      <tr><td>Model code</td><td><code>${modelId}</code></td></tr>
      <tr><td>Capabilities</td><td><section>
        <p><b>Thinking</b></p>${markers}
        <p>Note: minimal is not supported and returns an error.</p>
      </section></td></tr>
    </table></div>`;
}

describe("Gemini owning capability markers", () => {
  it.each([
    thinkingBadge,
    '{% badge type="supported" label="Supported (low, medium, high)" /%}',
    '{% badge label="Supported" extra="display-only" type="supported" /%}',
    '{% badge type="supported" extra="display-only" label="Supported" /%}',
    supportedBadge,
  ])("keeps an explicit supported badge despite parameter exclusions: %s", (badge) => {
    expect(parsePage(markdown.replace(thinkingBadge, badge)).capabilities.reasoning).toBe(true);
  });

  it("keeps an explicit unsupported badge separate from supported siblings", () => {
    expect(parsePage(markdown).capabilities.tool_call).toBe(false);
  });

  it.each([
    "",
    '{% badge type="unreviewed" label="Supported" /%}',
    '{% badge label="Supported" /%}',
    '{% badge type="supported" type="not-supported" /%}',
  ])("leaves missing or unrecognized markers unknown: %s", (badge) => {
    expect(parsePage(markdown.replace(thinkingBadge, badge)).capabilities.reasoning).toBe(
      "unknown",
    );
  });

  it.each([`${supportedBadge}\n${unsupportedBadge}`, `${unsupportedBadge}\n${supportedBadge}`])(
    "leaves contradictory owning badges unknown regardless of order: %s",
    (badges) => {
      expect(parsePage(markdown.replace(thinkingBadge, badges)).capabilities.reasoning).toBe(
        "unknown",
      );
    },
  );

  it("does not treat repeated agreeing markers as a conflict", () => {
    expect(
      parsePage(markdown.replace(thinkingBadge, `${supportedBadge}\n${supportedBadge}`))
        .capabilities.reasoning,
    ).toBe(true);
  });

  it.each(["supported-first", "unsupported-first"])(
    "keeps conflicting duplicate capability sections unknown (%s)",
    (order) => {
      const section = (badge: string) => `{% section %}**Thinking**${badge}{% /section %}`;
      const duplicate = section(unsupportedBadge);
      const owning = `{% section %}**Thinking**${supportedBadge}{% /section %}`;
      const sections = order === "supported-first" ? owning + duplicate : duplicate + owning;
      expect(
        parsePage(
          markdown.replace(
            '{% section class="three-column-grid" %}',
            `{% section class="three-column-grid" %}${sections}`,
          ),
        ).capabilities.reasoning,
      ).toBe("unknown");
    },
  );

  it.each(["Context caching", "Caching"])("recognizes the reviewed %s label", (label) => {
    expect(
      parsePage(markdown.replace("Context caching", label).replace(cachingBadge, supportedBadge))
        .capabilities.prompt_cache,
    ).toBe(true);
  });

  it("does not guess caching support from an unrelated label", () => {
    expect(
      parsePage(markdown.replace("Context caching", "Cache administration")).capabilities
        .prompt_cache,
    ).toBe("unknown");
  });

  it("reads Consumption options independently of unsupported capability siblings", () => {
    expect(parsePage(markdown).capabilities.batch).toBe(true);
  });

  it.each([
    [supportedBadge, true],
    [unsupportedBadge, false],
    [`${supportedBadge}\n${unsupportedBadge}`, false],
  ])("uses owning Image generation support for task evidence: %s", (badge, supported) => {
    const page = markdown
      .replace("[**Thinking**](/docs/thinking)", "[**Image generation**](/docs/image-generation)")
      .replace(thinkingBadge, badge);
    expect(parsePage(page).tasks.includes("image_generation")).toBe(supported);
  });

  it.each([
    [supportedBadge, true],
    [unsupportedBadge, false],
    [`${supportedBadge}\n${unsupportedBadge}`, false],
  ])("uses Live API markers without inventing negative streaming support: %s", (badge, live) => {
    const page = markdown
      .replace("[**Thinking**](/docs/thinking)", "[**Live API**](/docs/live-api)")
      .replace(thinkingBadge, badge)
      .replace("**Inputs** Text", "**Inputs** Audio")
      .replace("**Output** Text", "**Output** Audio");
    const model = parsePage(page);
    expect(model.tasks.includes("speech_to_speech")).toBe(live);
    expect(model.capabilities.streaming).toBe(live ? true : "unknown");
  });

  it.each([
    ['<span class="gemini-api-supported">Supported</span>', true],
    ['<span class="gemini-api-not-supported">Not supported</span>', false],
    ['<span class="gemini-api-experimental">Experimental</span>', true],
    ["", "unknown"],
    ['<span class="unreviewed-marker">Supported</span>', "unknown"],
    [
      '<span class="gemini-api-supported">Supported</span><span class="gemini-api-not-supported">Not supported</span>',
      "unknown",
    ],
  ])("uses native HTML markers independently of parameter prose: %s", (markers, expected) => {
    expect(parsePage(htmlPage(markers)).capabilities.reasoning).toBe(expected);
  });

  it.each([
    ["Supported", true],
    ["Not supported", false],
    ["Experimental", true],
    ["Supported options: minimal is not supported", "unknown"],
  ])("keeps exact bare legacy status distinct from prose: %s", (status, expected) => {
    const page = htmlPage("").replace("<p><b>Thinking</b></p>", `<b>Thinking</b> ${status}`);
    expect(parsePage(page).capabilities.reasoning).toBe(expected);
  });

  it.each([
    [thinkingBadge, true],
    [unsupportedBadge, false],
    ["", "unknown"],
    [`${supportedBadge}\n${unsupportedBadge}`, "unknown"],
  ])(
    "preserves marker state through assembly and the actual public projection: %s",
    (badge, reasoning) => {
      const models = applyGroups(
        [],
        [{ source, models: [parsePage(markdown.replace(thinkingBadge, badge))] }],
        true,
      ).map((model) => providerModelSchema.parse(model));
      const published = catalogModels({
        catalog_version: "1".repeat(64),
        generated_at: at,
        providers: [provider],
        models,
        sources: [
          sourceRecordSchema.parse({
            id: source.id,
            provider_id: provider.id,
            url: source.url,
            source: ["website"],
            stability: source.stability,
            scope: source.scope,
            exhaustive: source.exhaustive,
            role: source.role,
            field_paths: source.fields,
            observed_at: at,
            content_hash: "2".repeat(64),
            extractor_version: source.extractorVersion,
          }),
        ],
        coverage: [
          {
            provider_id: provider.id,
            status: "fresh",
            model_count: models.length,
            pricing_term_count: 0,
            checked_at: at,
          },
        ],
        warnings: [],
      });
      const variants = published.providers[provider.id]?.models.find(
        ({ model_id }) => model_id === modelId,
      )?.variants;
      expect(variants).toHaveLength(1);
      expect(variants?.[0]?.capabilities).toMatchObject({
        reasoning,
        tool_call: false,
        prompt_cache: true,
        batch: true,
        fine_tuning: "unknown",
      });
    },
  );
});
