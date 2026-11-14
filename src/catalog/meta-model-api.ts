import { load, type CheerioAPI } from "cheerio";
import { linkedBundleSchema, linkedDocumentBody } from "./bundle.ts";
import { baseModel } from "./model.ts";
import { scaleDecimal } from "./pricing.ts";
import type { ParsedProviderModel, SourcePriceFact } from "./pricing-source.ts";
import type { SourceParseInput, SourceParseResult } from "./source-parse.ts";
import type { UsageSignal } from "./pricing-schema.ts";
import { assertItemCount } from "./source-contract.ts";
import { applyMetaModelMetadata } from "./meta-model-metadata.ts";
import { bindMetaRates, extractMetaPricingInputs } from "./meta-accounting.ts";

const modelsUrl = "https://dev.meta.ai/docs/models";
const pricingUrl = "https://dev.meta.ai/docs/pricing-rate-limits";

function section($: CheerioAPI, id: string): CheerioAPI {
  const main = $("main,[role='main']");
  if (main.length !== 1) throw new Error("Meta page main region changed");
  const heading = main.find(`h2#${id},h3#${id}`);
  if (heading.length !== 1) throw new Error(`Missing Meta section ${id}`);
  return load(
    heading
      .nextUntil("h2,h3")
      .toArray()
      .map((node) => $.html(node))
      .join("\n"),
  );
}

function table($: CheerioAPI, headers: string[]): string[][] {
  const tables = $("table");
  const rows = tables
    .find("tr")
    .toArray()
    .map((row) =>
      $(row)
        .find("th,td")
        .toArray()
        .map((cell) => $(cell).text().trim()),
    );
  const [header, ...body] = rows;
  if (
    tables.length !== 1 ||
    header?.length !== headers.length ||
    headers.some((label, index) => header[index] !== label) ||
    body.some((row) => row.length !== headers.length)
  )
    throw new Error("Meta pricing or model table changed");
  return body;
}

function priceTable(
  $: CheerioAPI,
  headers: readonly string[],
): { label: string; price: (header: string) => string }[] {
  const tables = $("table");
  const rows = tables
    .find("tr")
    .toArray()
    .map((row) =>
      $(row)
        .find("th,td")
        .toArray()
        .map((cell) => $(cell).text().trim()),
    );
  const [header, ...body] = rows;
  const expected = ["Usage", ...headers];
  if (
    tables.length !== 1 ||
    header?.length !== expected.length ||
    new Set(header).size !== header.length ||
    expected.some((label) => !header.includes(label)) ||
    body.some((row) => row.length !== expected.length)
  )
    throw new Error("Meta token pricing table changed");
  const positions = new Map(header.map((label, position) => [label, position] as const));
  return body.map((row) => ({
    label: row[0] ?? "",
    price: (label) => {
      const position = positions.get(label);
      if (position === undefined) throw new Error("Meta token pricing column changed");
      return row[position] ?? "";
    },
  }));
}

function requireText($: CheerioAPI, text: string): void {
  if (!$.text().includes(text)) throw new Error(`Meta commercial rule changed: ${text}`);
}

function usd(value: string | undefined): string {
  const amount = value?.match(/^\$(\d+(?:\.\d+)?)$/)?.[1];
  if (amount === undefined) throw new Error("Meta USD price changed");
  return amount;
}

export function parseMetaModelApi(input: SourceParseInput): SourceParseResult {
  const bundle = linkedBundleSchema.parse(JSON.parse(input.body));
  if (bundle.index.url !== modelsUrl) throw new Error("Unexpected Meta model source");
  const catalog = load(bundle.index.body);
  const pricing = load(
    linkedDocumentBody(bundle, "/docs/pricing-rate-limits", "Missing Meta prices"),
  );
  const models: ParsedProviderModel[] = [];
  const availabilityLocators = new Map<string, string>();
  const tokenNotes = section(pricing, "token-pricing-notes");
  requireText(tokenNotes, "you pay the cached-input rate for those tokens");
  requireText(
    tokenNotes,
    "you pay the same rate whether your context window is mostly empty or almost full",
  );
  requireText(section(pricing, "standard-mode"), "your content is not used to train Meta models");
  requireText(
    section(pricing, "contributor-mode"),
    "in exchange for permission to use your content to train future Meta models",
  );

  function model(id: string, name: string): ParsedProviderModel {
    if (!/^[a-z][a-z0-9.-]*$/.test(id) || models.some(({ model_id }) => model_id === id))
      throw new Error("Meta model identity changed");
    const result = baseModel({
      providerId: input.provider.id,
      id,
      name,
      sourceId: input.source.id,
      observedAt: input.observedAt,
    });
    result.status = "active";
    models.push(result);
    return result;
  }

  function rate(
    meter: SourcePriceFact["meter"],
    price: string,
    unit: SourcePriceFact["unit"],
    sectionId: string,
    signal: UsageSignal,
    rawUnit: string,
    conditions: SourcePriceFact["conditions"] = {},
  ): SourcePriceFact {
    const locator = { kind: "fragment" as const, value: `${pricingUrl}#${sectionId}` };
    return {
      meter,
      price,
      unit,
      currency: "USD",
      conditions,
      source_ref: input.source.id,
      source_locator: locator,
      derived: false,
      raw_unit: rawUnit,
      charge_binding: {
        signal,
        aggregation: "request",
        observations: [
          {
            source_ref: input.source.id,
            locator,
            raw: { label: rawUnit },
          },
        ],
      },
    };
  }

  for (const family of ["muse-wonder", "muse-spark"] as const) {
    const path = `/docs/${family}`;
    const modelPage = load(linkedDocumentBody(bundle, path, `Missing Meta model page ${path}`));
    const listing = section(modelPage, "availability");
    const prices = section(pricing, `${family}-pricing`);
    const rows = table(listing, [
      family === "muse-wonder" ? "Variant" : "Version",
      "Model API (pay-as-you-go)",
      "Muse Code",
    ]);
    const tariffs = priceTable(prices, [
      "Standard mode (per 1M tokens)",
      "Contributor mode (per 1M tokens)",
    ]);
    if (tariffs.length !== 3 || new Set(tariffs.map(({ label }) => label)).size !== 3)
      throw new Error("Meta token meters changed");
    const declaration = prices("p").first();
    const clauses = declaration.text().split(";");
    const priceIds = new Set(
      declaration
        .find("code")
        .toArray()
        .map((node) => prices(node).text()),
    );
    for (const row of rows) {
      const [identity, mode] = row;
      if (mode === "Not available") continue;
      const match = identity?.match(/^(.+) \(([^()]+)\)$/);
      if (!match?.[1] || !match[2]) throw new Error("Meta hosted model identity changed");
      const item = model(match[2], match[1]);
      availabilityLocators.set(item.model_id, `https://dev.meta.ai${path}#availability`);
      const modeColumn =
        mode === "Contributor mode"
          ? "Contributor"
          : mode === "Standard mode" || mode === "Available (Standard mode only)"
            ? "Standard"
            : undefined;
      if (modeColumn === undefined) throw new Error("Meta pricing mode changed");
      if (!priceIds.has(item.model_id)) continue;
      // Mode comes from the exact availability row, never from an ID suffix heuristic.
      if (family === "muse-spark") {
        const clause = clauses.find((part) => part.includes(`in ${modeColumn} mode`));
        if (!clause?.match(/[a-z][a-z0-9.-]+/g)?.includes(item.model_id))
          throw new Error("Meta model-to-price mode association changed");
      }
      item.description =
        modeColumn === "Contributor"
          ? "Contributor mode allows Meta to use submitted content and responses to train future models."
          : "Standard mode does not use submitted content to train Meta models.";
      const column = `${modeColumn} mode (per 1M tokens)`;
      item.price_facts = tariffs.map(({ label, price: cell }) => {
        const price = usd(cell(column));
        switch (label) {
          case "Input":
            return rate(
              "input_text",
              price,
              "million_tokens",
              `${family}-pricing`,
              { namespace: "kmodels", value: "uncached_input_tokens" },
              "Uncached input tokens; per 1M tokens",
            );
          case "Cached input":
            return rate(
              "cache_read_text",
              price,
              "million_tokens",
              `${family}-pricing`,
              { namespace: "kmodels", value: "cached_input_tokens" },
              "Cached input tokens; per 1M tokens",
            );
          case "Output":
            return rate(
              "output_text",
              price,
              "million_tokens",
              `${family}-pricing`,
              { namespace: "kmodels", value: "output_tokens" },
              "Output tokens; per 1M tokens",
            );
          default:
            throw new Error("Unreviewed Meta token meter");
        }
      });
    }
  }

  const ember = section(catalog, "muse-ember");
  requireText(ember, "On Model API, Muse Ember runs in Standard mode only");
  const emberIdentities = table(ember, ["Model ID", "Input", "Output"]);
  const emberId = emberIdentities[0]?.[0];
  if (emberIdentities.length !== 1 || emberId === undefined)
    throw new Error("Meta Muse Ember identity changed");
  const emberPricing = section(pricing, "muse-ember-pricing");
  requireText(emberPricing, `Model: ${emberId}, in Standard mode only`);
  requireText(
    emberPricing,
    "Muse Ember has two price tiers, and the input tokens in your API request set the tier, cached tokens included",
  );
  requireText(
    emberPricing,
    "A request with up to 200K input tokens is billed at the rates in the first column",
  );
  requireText(
    emberPricing,
    "A request with more is billed at the long-context rates in full, not only for the tokens past 200K",
  );
  const emberTiers = [
    {
      header: "Up to 200K input tokens (per 1M tokens)",
      conditions: { context_max_tokens: 200_000 },
    },
    {
      header: "Over 200K input tokens (per 1M tokens)",
      conditions: { context_min_tokens: 200_001 },
    },
  ] as const;
  const emberTariffs = priceTable(
    emberPricing,
    emberTiers.map(({ header }) => header),
  );
  if (emberTariffs.length !== 3 || new Set(emberTariffs.map(({ label }) => label)).size !== 3)
    throw new Error("Meta Muse Ember token meters changed");
  const emberModel = model(emberId, "Muse Ember");
  availabilityLocators.set(emberId, `${modelsUrl}#muse-ember`);
  emberModel.description =
    "Efficient execution model for high-volume, repeated work. Standard mode only.";
  emberModel.price_facts = emberTariffs.flatMap(({ label, price: cell }) =>
    emberTiers.map(({ header, conditions }) => {
      const price = usd(cell(header));
      const rawUnit = `${label} tokens; ${header}`;
      switch (label) {
        case "Input":
          return rate(
            "input_text",
            price,
            "million_tokens",
            "muse-ember-pricing",
            { namespace: "kmodels", value: "uncached_input_tokens" },
            rawUnit,
            conditions,
          );
        case "Cached input":
          return rate(
            "cache_read_text",
            price,
            "million_tokens",
            "muse-ember-pricing",
            { namespace: "kmodels", value: "cached_input_tokens" },
            rawUnit,
            conditions,
          );
        case "Output":
          return rate(
            "output_text",
            price,
            "million_tokens",
            "muse-ember-pricing",
            { namespace: "kmodels", value: "output_tokens" },
            rawUnit,
            conditions,
          );
        default:
          throw new Error("Unreviewed Meta Muse Ember token meter");
      }
    }),
  );

  const image = section(pricing, "image-generation");
  requireText(image, "only for images the model successfully generates and returns");
  requireText(
    image,
    "The price is the same regardless of prompt length, reasoning_strength, or the tools the model uses during generation",
  );
  requireText(image, "isn't charged separately");
  const voice = section(pricing, "muse-voice-transcribe-pricing");
  requireText(voice, "rounded down to whole seconds");
  requireText(voice, "Streaming and non-streaming transcription are priced the same");
  requireText(voice, "Zero data retention (ZDR) is priced at parity with Standard mode");
  const segmentation = section(pricing, "sam-pricing");
  requireText(segmentation, "at least 50 frames");
  requireText(
    segmentation,
    "usage.video_frames_processed reports the frames billed for that request",
  );

  for (const [sectionId, name, priceSection, page] of [
    ["muse-image", "Muse Image", "image-generation", image],
    ["muse-voice-transcribe", "Muse Voice Transcribe", "muse-voice-transcribe-pricing", voice],
    ["sam-3", "Segment Anything Model 3.1", "sam-pricing", segmentation],
  ] as const) {
    const identities = table(section(catalog, sectionId), ["Model ID", "Input", "Output"]);
    const id = identities[0]?.[0];
    if (identities.length !== 1 || id === undefined)
      throw new Error("Meta single-model tariff scope changed");
    if (
      sectionId === "sam-3" &&
      (id !== "sam-3.1" || pricing(`#${priceSection}`).text() !== "Segment Anything Model 3.1")
    )
      throw new Error("Meta segmentation tariff version changed");
    const item = model(id, name);
    item.description =
      sectionId === "sam-3"
        ? "Image and video segmentation. Each video request is billed for at least 50 frames."
        : sectionId === "muse-voice-transcribe"
          ? "Transcription is billed by audio processed, rounded down to whole seconds."
          : "Only successfully generated and returned images are billed. Built-in search is included.";
    const rows = table(page, ["Usage", "Price"]);
    if (
      rows.length !== (sectionId === "sam-3" ? 2 : 1) ||
      new Set(rows.map(([label]) => label)).size !== rows.length
    )
      throw new Error("Meta media meters changed");
    item.price_facts = rows.map(([label, value]) => {
      const parts = value?.match(/^(\$\d+(?:\.\d+)?) per (image|hour|1,000 images|1,000 frames)$/);
      if (!parts) throw new Error("Meta media price unit changed");
      const amount = usd(parts[1]);
      if (sectionId === "muse-image" && label === "Generated image" && parts[2] === "image")
        return rate(
          "image_generation",
          amount,
          "image",
          priceSection,
          { namespace: "kmodels", value: "generated_images" },
          "Successfully generated and returned images; per image",
        );
      if (
        sectionId === "muse-voice-transcribe" &&
        label === "Audio processed" &&
        parts[2] === "hour"
      )
        return rate(
          "input_audio",
          amount,
          "hour",
          priceSection,
          { namespace: "kmodels", value: "processed_audio_seconds" },
          "Audio processed, rounded down to whole seconds; per hour",
        );
      if (sectionId === "sam-3" && label === "Image segmentation" && parts[2] === "1,000 images")
        return rate(
          "input_image",
          scaleDecimal(amount, -3),
          "image",
          priceSection,
          { namespace: "kmodels", value: "processed_images" },
          value ?? "",
        );
      if (sectionId === "sam-3" && label === "Video segmentation" && parts[2] === "1,000 frames")
        return rate(
          "input_video",
          scaleDecimal(amount, -3),
          "frame",
          priceSection,
          { namespace: "provider", provider_id: input.provider.id, value: "billed_video_frames" },
          "Billed video frames (minimum 50 per request); per 1,000 frames",
        );
      throw new Error("Unreviewed Meta media meter");
    });
  }
  const search = tokenNotes
    .text()
    .match(
      /Web search grounding: (\$\d+(?:\.\d+)?) per 1,000 search queries, in addition to the request's token cost/,
    );
  if (!search) throw new Error("Meta search tariff changed");
  const listedIds = table(section(pricing, "rate-limits"), [
    "Model",
    "Requests per minute (RPM)",
    "Tokens per minute (TPM)",
    "Other limits",
  ]).map(([id]) => id);
  if (listedIds.some((id) => !models.some(({ model_id }) => model_id === id)))
    throw new Error("Unreviewed Meta hosted model");
  if (input.source.extractor.kind !== "meta-model-api")
    throw new Error("Unexpected Meta extractor");
  assertItemCount(
    "Meta Model API",
    models.length,
    input.source.extractor.minModels,
    input.source.extractor.maxModels,
  );
  for (const item of models) if (item.price_facts.length > 0) item.pricing_state = "numeric";
  applyMetaModelMetadata(bundle, models);
  const pricingInputs = extractMetaPricingInputs(
    bundle,
    input.source.id,
    input.onPricingReconciliation,
  );
  bindMetaRates(bundle, models, pricingInputs);
  return {
    models,
    pricing_inputs: pricingInputs,
    vocabulary: [
      {
        kind: "usage_signal",
        key: "billed_video_frames",
        resolution_phase: "outcome",
        definition:
          "Meta billed video frames reported as usage.video_frames_processed, including the minimum of 50 per video request",
        unit: { factors: [{ unit: { namespace: "kmodels", value: "frame" }, power: 1 }] },
      },
      {
        kind: "usage_signal",
        key: "search_queries",
        resolution_phase: "outcome",
        definition:
          "Billable Meta text-model web-search queries, excluding Muse Image's included search",
        unit: { factors: [{ unit: { namespace: "kmodels", value: "request" }, power: 1 }] },
      },
    ],
    commercial_facts: [
      {
        source_ref: input.source.id,
        book_key: "web-search",
        book_name: "Meta web search",
        resource_kind: "service",
        resource_key: "web-search",
        model_refs: [],
        offer_key: "usage",
        offer_name: "Text-model web search",
        billing_mode: "usage",
        pricing_state: "numeric",
        price_facts: [
          rate(
            "web_search",
            usd(search[1]),
            "thousand_requests",
            "token-pricing-notes",
            { namespace: "provider", provider_id: input.provider.id, value: "search_queries" },
            "Text-model web search; per 1,000 search queries",
          ),
        ],
        raw_price_facts: [],
      },
    ],
    inference_prices: models
      .filter(({ price_facts }) => price_facts.length > 0)
      .map((item) => ({
        model_id: item.model_id,
        model_ref: item.uid,
        offer_key: "usage",
        source_ref: input.source.id,
        fixed_selectors: [],
        evidence: [
          {
            source_ref: input.source.id,
            locator: {
              kind: "fragment",
              value: availabilityLocators.get(item.model_id) ?? `${modelsUrl}#models`,
            },
          },
          {
            source_ref: input.source.id,
            locator: { kind: "fragment", value: `${pricingUrl}#pricing` },
          },
        ],
      })),
  };
}

// Commercial selection describes owned tariffs, independently of model capabilities.
export const meta_model_apiSelectionPolicy = {
  offers: {
    usage: ["request"],
  },
  values: {},
} satisfies import("./commercial-selection.ts").CommercialSelectionPolicy;
