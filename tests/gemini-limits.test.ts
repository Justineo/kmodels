import { readFile } from "node:fs/promises";
import { beforeAll, describe, expect, it } from "vite-plus/test";
import { parseSource } from "../src/catalog/adapters.ts";
import type { LinkedBundle } from "../src/catalog/bundle.ts";
import { applyGroups } from "../src/catalog/collector.ts";
import { manifests } from "../src/catalog/manifests.ts";
import type { ParsedProviderModel } from "../src/catalog/pricing-source.ts";
import { catalogModels } from "../src/catalog/publication.ts";
import { providerModelSchema, sourceRecordSchema } from "../src/catalog/schema.ts";
import { geminiInferenceFixtures } from "./gemini-inference-fixture.ts";

function configuration() {
  const manifest = manifests.find(({ provider }) => provider.id === "gemini");
  const source = manifest?.sources.find(({ id }) => id === "gemini-models");
  const api = manifest?.sources.find(({ id }) => id === "gemini-api");
  if (!manifest || !source || !api) throw new Error("Missing Gemini sources");
  return { manifest, source, api };
}
const { manifest, source, api } = configuration();
const provider = { ...manifest.provider, source_ids: manifest.sources.map(({ id }) => id) };
const at = "2026-11-17T15:12:19.051Z";
const modelId = "limit-probe";
let bundle: LinkedBundle;
let native: string;

beforeAll(async () => {
  bundle = (await geminiInferenceFixtures()).catalog;
  // Reduced from the retained Carbon page observed at the timestamp above:
  // https://aistudio.google.com/docs/models/gemini-4-carbon
  native = await readFile(
    new URL("./fixtures/gemini/unified-context.txt", import.meta.url),
    "utf8",
  );
});

function parsePage(body: string): ParsedProviderModel {
  const model = parseSource({
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
  if (!model) throw new Error("Missing limit probe");
  return model;
}

function htmlPage(limits: string): string {
  return `<h1 class="devsite-page-title">Limit probe</h1>
    <div class="devsite-article-body"><table>
      <tr><th>Model code</th><td><code>${modelId}</code></td></tr>
      <tr><th>Token limits</th><td>${limits}</td></tr>
    </table></div>`;
}

function inventory(limits: { inputTokenLimit?: number; outputTokenLimit?: number }) {
  return parseSource({
    provider,
    source: api,
    observedAt: at,
    body: JSON.stringify({
      models: [{ name: `models/${modelId}`, version: "001", ...limits }],
    }),
  }).models;
}

function publish(model: ParsedProviderModel, apiModels: ParsedProviderModel[]) {
  const models = applyGroups(
    applyGroups([], [{ source, models: [model] }], true),
    [{ source: api, models: apiModels }],
    false,
  ).map((item) => providerModelSchema.parse(item));
  const published = catalogModels({
    catalog_version: "1".repeat(64),
    generated_at: at,
    models,
    providers: [provider],
    sources: [source, api].map((item) =>
      sourceRecordSchema.parse({
        id: item.id,
        provider_id: provider.id,
        url: item.url,
        source: [item.type],
        stability: item.stability,
        scope: item.scope,
        exhaustive: item.exhaustive,
        role: item.role,
        field_paths: item.fields,
        observed_at: at,
        content_hash: "2".repeat(64),
        extractor_version: item.extractorVersion,
      }),
    ),
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
  const result = published.providers[provider.id]?.models.find(
    ({ model_id }) => model_id === modelId,
  )?.variants[0];
  if (!result) throw new Error("Missing published limit probe");
  return result;
}

describe("Gemini limit claim boundaries", () => {
  it.each(["native", "no-script", "html"])(
    "keeps unified context without manufacturing separate maxima (%s)",
    (format) => {
      const body =
        format === "native"
          ? native
          : format === "html"
            ? htmlPage(
                "<b>Context window (unified input and output token limit)</b> 1,048,576 <b>Max output</b> 65,536 (default synchronous) / up to 1,048,576 (with long decode)",
              )
            : `<body><noscript><pre>${native.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</pre></noscript></body>`;
      expect(parsePage(body).limits).toEqual({ context_tokens: 1_048_576 });
    },
  );

  it("reads source bounds rather than a known model or token amount", () => {
    expect(parsePage(native.replaceAll("1,048,576", "262,144")).limits).toEqual({
      context_tokens: 262_144,
    });
  });

  it.each(["Input token limit", "Input context window"])(
    "preserves an independently labeled %s and unqualified output ceiling",
    (label) => {
      expect(parsePage(htmlPage(`${label} 8,192 Output token limit 1,024`)).limits).toEqual({
        context_tokens: 8_192,
        max_input_tokens: 8_192,
        max_output_tokens: 1_024,
      });
    },
  );

  it.each([
    "Context window 16,384 Input token limit 8,192 Output token limit 1,024",
    "Output token limit 1,024 Input context window 8,192 Context window 16,384",
  ])("keeps separately declared context and input limits independent: %s", (value) => {
    expect(parsePage(htmlPage(value)).limits).toEqual({
      context_tokens: 16_384,
      max_input_tokens: 8_192,
      max_output_tokens: 1_024,
    });
  });

  it("does not infer a separate input grant from a bare context window", () => {
    expect(parsePage(htmlPage("Context window 16,384 Output token limit 1,024")).limits).toEqual({
      context_tokens: 16_384,
      max_output_tokens: 1_024,
    });
  });

  it.each([
    [
      "Input context window 1,048,576 (compacted at ~135k) Output token limit 65,536",
      { context_tokens: 1_048_576, max_input_tokens: 1_048_576, max_output_tokens: 65_536 },
    ],
    [
      "Input token limit 8,192 Output token limit 16,384 (Gemini API serving limit)",
      { context_tokens: 8_192, max_input_tokens: 8_192, max_output_tokens: 16_384 },
    ],
    [
      "Context window 1,048,576 tokens Output video 3s-10s (360p/720p/1080p/4K, 24 FPS)",
      { context_tokens: 1_048_576 },
    ],
  ])(
    "preserves owned scalar bounds with reviewed sibling fields or notes: %s",
    (value, expected) => {
      expect(parsePage(htmlPage(value)).limits).toEqual(expected);
    },
  );

  it.each([
    "Max output 1,024 (default) / up to 8,192 (with continuation)",
    "Output token limit 1,024 (default) / up to 8,192 (with continuation)",
    "Output token limit 8,192 with continuation / 1,024 otherwise",
    "Output token limit 1,024 Output token limit 2,048",
  ])("does not flatten conditional or conflicting output declarations: %s", (value) => {
    expect(parsePage(htmlPage(`Context window 16,384 ${value}`)).limits).toEqual({
      context_tokens: 16_384,
    });
  });

  it.each(["", "Context window (unreviewed scope) 16,384", "Input token limit 8,192.5"])(
    "keeps absent or unrecognized scalar limits unknown: %s",
    (value) => {
      expect(parsePage(htmlPage(value)).limits).toEqual({});
    },
  );

  it("withholds conflicting context without hiding an independent input fact", () => {
    expect(
      parsePage(htmlPage("Context window 8,192 Context window 16,384 Input token limit 4,096"))
        .limits,
    ).toEqual({ max_input_tokens: 4_096 });
  });

  it("preserves agreeing repeated output declarations", () => {
    expect(parsePage(htmlPage("Output token limit 1,024 Output token limit 1,024")).limits).toEqual(
      { max_output_tokens: 1_024 },
    );
  });

  it("preserves the reviewed embedding range and recommended dimensions", async () => {
    const body = (
      await readFile(new URL("./fixtures/gemini/embedding.html", import.meta.url), "utf8")
    ).replace("<code>embedding-test</code>", `<code>${modelId}</code>`);
    expect(parsePage(body).limits).toEqual({
      context_tokens: 8_192,
      max_input_tokens: 8_192,
      embedding_dimension_range: { min: 128, max: 3_072 },
      recommended_embedding_dimensions: [768, 1_536],
    });
  });

  it("preserves an exact embedding dimension independently of token limits", () => {
    expect(
      parsePage(htmlPage("Input token limit 8,192 Output dimension size 3,072")).limits,
    ).toEqual({ context_tokens: 8_192, max_input_tokens: 8_192, embedding_dimensions: [3_072] });
  });

  it("does not turn Gemma card context length into a separate input grant", () => {
    const models = parseSource({
      provider,
      source,
      observedAt: at,
      body: JSON.stringify(bundle),
    }).models;
    for (const id of ["gemma-4-31b-it", "gemma-4-26b-a4b-it"]) {
      const model = models.find(({ model_id }) => model_id === id);
      expect(model?.limits).toEqual({ context_tokens: 256_000 });
    }
  });

  it("does not manufacture maxima during normal assembly and public projection", () => {
    expect(publish(parsePage(native), inventory({})).limits).toEqual({
      context_tokens: 1_048_576,
    });
  });

  it("keeps page context authoritative while inventory fills independently published bounds", () => {
    expect(
      publish(parsePage(native), inventory({ inputTokenLimit: 4_096, outputTokenLimit: 2_048 }))
        .limits,
    ).toEqual({ context_tokens: 1_048_576, max_input_tokens: 4_096, max_output_tokens: 2_048 });
  });

  it("does not overwrite separately known public input/output bounds with inventory", () => {
    const model = parsePage(htmlPage("Input token limit 8,192 Output token limit 2,048"));
    expect(
      publish(model, inventory({ inputTokenLimit: 4_096, outputTokenLimit: 1_024 })).limits,
    ).toEqual({ context_tokens: 8_192, max_input_tokens: 8_192, max_output_tokens: 2_048 });
  });
});
