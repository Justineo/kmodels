import { load } from "cheerio";
import { z } from "zod";
import { linkedBundleSchema, linkedDocumentBody } from "./bundle.ts";
import type { LinkedBundle } from "./bundle.ts";
import {
  fireworksConsoleModes,
  fireworksConsoleUrl,
  fireworksPublicId,
} from "./fireworks-console.ts";
import { fireworksFlightRecords } from "./fireworks-flight.ts";
import { hostedInferencePrice, hostedUsageRate, usdAmount } from "./hosted-usage-rate.ts";
import { modelIdSchema } from "./identity.ts";
import { markdownSection, markdownTableRows } from "./markdown.ts";
import { baseModel } from "./model.ts";
import {
  decimalsEqual,
  publishedRate,
  rawPricingFact,
  scaleDecimal,
  wholeTokenCount,
} from "./pricing.ts";
import type { ParsedProviderModel, SourcePriceFact } from "./pricing-source.ts";
import { assertSourceConstraint, parseSourceJson } from "./source-contract.ts";
import type { SourceParseInput, SourceParseResult } from "./source-parse.ts";

const libraryEntry = z.object({ serverless: z.boolean(), serverlessApi: z.boolean() });
const hostedEntry = z.object({
  slug: z.string().regex(/^[a-z0-9._-]+\/[a-z0-9._-]+$/u),
  contextLength: z.string().nullable(),
  tags: z.array(z.string()),
  supportsImageInput: z.boolean(),
  provider: z.object({ company: z.object({ name: z.string().trim().min(1).max(2048) }) }).nullish(),
});
const libraryFrame = z.tuple([
  z.literal("$"),
  z.string(),
  z.null(),
  z.object({ models: z.array(z.unknown()).min(1).max(5_000) }),
]);
const publicId = fireworksPublicId;
const libraryOrigin = "https://fireworks.ai";
const chatPath = "/inference/v1/chat/completions";
const tokenUnit = "USD per 1M tokens";
const retrievalCardUnits = new Set(["Per 1M Tokens (input/cached input/output)", "Per 1M Tokens"]);
const usdTriplet = z.tuple([z.string(), z.string(), z.string()]);

function documentedId(value: string | undefined): string {
  return modelIdSchema.parse(value?.match(/^`([^`]+)`$/u)?.[1]);
}

function libraryEntries(body: string) {
  const lists: unknown[][] = [];
  for (const record of fireworksFlightRecords(body)) {
    const frame = libraryFrame.safeParse(record);
    if (frame.success) lists.push(frame.data[3].models);
  }
  const rows = lists[0];
  assertSourceConstraint(
    "Fireworks library did not expose one model list",
    rows !== undefined && lists.length === 1,
    undefined,
  );
  const hosted = rows.flatMap((raw) => {
    const entry = libraryEntry.parse(raw);
    return entry.serverless && entry.serverlessApi ? [hostedEntry.parse(raw)] : [];
  });
  assertSourceConstraint(
    "Fireworks library repeated a serverless slug",
    new Set(hosted.map(({ slug }) => slug)).size === hosted.length,
    undefined,
  );
  return hosted;
}

export function fireworksModelPaths(body: string): string[] {
  return libraryEntries(body).map(({ slug }) => `/models/${slug}/`);
}

export function fireworksConsoleTargets(bundle: LinkedBundle): { id: string; url: string }[] {
  return fireworksModelPaths(bundle.index.body).map((path) => {
    const document = bundle.documents.find(({ url }) => url === libraryOrigin + path);
    assertSourceConstraint(
      "Fireworks bundle omitted a serverless model card",
      document !== undefined,
      path,
    );
    const $ = load(document.body);
    const id = publicId.parse($('button[aria-label="Copy model path"]').prev("span").text().trim());
    return { id, url: fireworksConsoleUrl(id) };
  });
}

function addConsolePrices(
  input: SourceParseInput,
  models: Map<string, ParsedProviderModel>,
  ids: readonly string[],
  documents: LinkedBundle["documents"],
): void {
  for (const id of ids) {
    const url = fireworksConsoleUrl(id);
    const base = models.get(id);
    const document = documents.find((item) => item.url === url);
    assertSourceConstraint(
      "Fireworks bundle omitted a required console profile",
      base !== undefined && document !== undefined,
      id,
    );
    const modes = fireworksConsoleModes(document.body, id);
    for (const mode of modes) {
      const target = mode.usageIdentifier || id;
      let model = models.get(target);
      if (model === undefined) {
        model = {
          ...base,
          ...baseModel({
            providerId: input.provider.id,
            id: target,
            name: `${base.name} (${mode.name.split("/").at(-1)})`,
            sourceId: input.source.id,
            observedAt: input.observedAt,
          }),
          status: "active",
          tasks: base.tasks,
          modalities: base.modalities,
          capabilities: base.capabilities,
          limits: base.limits,
          ...(base.service_families === undefined
            ? {}
            : { service_families: base.service_families }),
          ...(base.api_endpoints === undefined ? {} : { api_endpoints: base.api_endpoints }),
        };
        models.set(target, model);
      }
      const hasTiers =
        modes.some((item) => (item.usageIdentifier || id) === target && item.serviceTier !== "") ||
        model.price_facts.some((fact) => fact.conditions.service_tier !== undefined);
      if (hasTiers)
        for (const fact of model.price_facts) fact.conditions.service_tier ??= "standard";
      const conditions = hasTiers ? { service_tier: mode.serviceTier || "standard" } : {};
      const unknown = (
        fragment: string,
        reason:
          | "unknown_amount"
          | "unknown_meter"
          | "unknown_unit"
          | "unknown_denomination" = "unknown_meter",
      ) =>
        model.raw_price_facts.push(
          rawPricingFact(
            input.source.id,
            "serverless",
            "base_price",
            reason,
            { fragment },
            conditions,
          ),
        );
      if (
        mode.skuInfos.length === 0 &&
        !model.price_facts.some((fact) => fact.conditions.service_tier === conditions.service_tier)
      )
        unknown(JSON.stringify(mode), "unknown_amount");
      const skus = new Set<string>();
      for (const sku of mode.skuInfos) {
        assertSourceConstraint("Fireworks mode repeated a SKU", !skus.has(sku.sku), mode.name);
        skus.add(sku.sku);
        const amount = scaleDecimal(
          (
            BigInt(sku.amount.units.replace(/^\$n/u, "")) * 1_000_000_000n +
            BigInt(sku.amount.nanos)
          ).toString(),
          -9,
        );
        const meter =
          sku.sku === "LLM input tokens (uncached)"
            ? "input_text"
            : sku.sku === "LLM input tokens (cached)"
              ? "cache_read_text"
              : sku.sku === "LLM output tokens"
                ? "output_text"
                : sku.sku === "Embedding input tokens" &&
                    (model.tasks.includes("embeddings") || model.tasks.includes("reranking"))
                  ? "input_text"
                  : undefined;
        if (meter === undefined || sku.unit !== "1M tokens" || sku.amount.currencyCode !== "USD") {
          unknown(
            JSON.stringify({ mode: mode.name, ...sku }),
            meter === undefined
              ? "unknown_meter"
              : sku.unit !== "1M tokens"
                ? "unknown_unit"
                : "unknown_denomination",
          );
          continue;
        }
        if (meter === "output_text" && model.service_families?.includes("System One")) {
          assertSourceConstraint(
            "Fireworks decision model published a nonzero output charge",
            amount === "0",
            target,
          );
          continue;
        }
        const rate = hostedUsageRate(
          publishedRate(meter, amount, "million_tokens", input.source.id, tokenUnit, conditions),
          { kind: "provider_key", value: `${url}#${mode.name}/${sku.sku}` },
          meter === "output_text"
            ? "output_tokens"
            : meter === "cache_read_text"
              ? "cached_input_tokens"
              : sku.sku === "Embedding input tokens"
                ? "input_tokens"
                : "uncached_input_tokens",
        );
        if (
          !model.price_facts.some(
            (fact) =>
              fact.meter === meter &&
              fact.unit === rate.unit &&
              fact.currency === rate.currency &&
              decimalsEqual(fact.price, amount) &&
              fact.conditions.service_tier === conditions.service_tier,
          )
        )
          model.price_facts.push(rate);
      }
    }
  }
}

function requiredSection(body: string, depth: number, name: string, ignoreCase = false): string {
  const section = markdownSection(body, depth, name, { ignoreCase });
  assertSourceConstraint(
    `Fireworks documentation omitted ${name}`,
    section !== undefined,
    undefined,
  );
  return section;
}

function pricesFromTable(body: string, section: string) {
  return markdownTableRows(requiredSection(body, 2, section), [
    "Model",
    "Standard",
    "Priority",
  ]).map((row) => {
    const match = row
      .get("Model")
      ?.match(
        /^\[([^\]]+)\]\(https:\/\/app\.fireworks\.ai\/models\/([a-z0-9._-]+\/[a-z0-9._-]+)\)$/u,
      );
    const label = match?.[1],
      appPath = match?.[2],
      standard = row.get("Standard"),
      priority = row.get("Priority");
    assertSourceConstraint(
      "Fireworks pricing row lost its exact model link or amount",
      label !== undefined && appPath !== undefined && !!standard && !!priority,
      undefined,
    );
    return {
      label,
      id: publicId.parse(`accounts/${appPath.replace("/", "/models/")}`),
      standard,
      priority,
    };
  });
}

function routerTable(body: string, section: string, suffix = "") {
  const content = requiredSection(body, 2, section, true);
  return markdownTableRows(content, ["Model", "`model` ID"]).map((row) => {
    const label = row.get("Model");
    const raw = row.get("`model` ID")?.match(/^`([^`]+)`$/u)?.[1];
    assertSourceConstraint("Fireworks route table lost a model label", !!label, undefined);
    return { label: `${label}${suffix}`, id: publicId.parse(raw) };
  });
}

function tokenRates(
  input: SourceParseInput,
  id: string,
  raw: string,
  surface: string,
  conditions: SourcePriceFact["conditions"] = {},
  inputOnly = false,
): SourcePriceFact[] {
  const cells = usdTriplet.parse(raw.split(" / "));
  const meters = [
    ["input_text", "uncached_input_tokens", "Input"],
    ["cache_read_text", "cached_input_tokens", "Cached input"],
    ["output_text", "output_tokens", "Output"],
  ] as const;
  return meters.flatMap(([meter, signal, label], index) => {
    const amount = usdAmount(cells[index] ?? "");
    assertSourceConstraint("Fireworks token price changed format", amount !== undefined, undefined);
    if (inputOnly && meter === "output_text") {
      assertSourceConstraint(
        "Fireworks input-only model published a nonzero output charge",
        Number(amount) === 0,
        undefined,
      );
      return [];
    }
    return [
      hostedUsageRate(
        publishedRate(meter, amount, "million_tokens", input.source.id, tokenUnit, conditions),
        { kind: "table", value: `${surface}/${id}/${label}` },
        signal,
      ),
    ];
  });
}

function readCard(
  input: SourceParseInput,
  entry: z.infer<typeof hostedEntry>,
  document: { url: string; body: string },
  decisionIds: ReadonlySet<string>,
): { model: ParsedProviderModel; cardAmount: string; cardUnit: string } {
  const $ = load(document.body);
  const cardUrl = $('link[rel="canonical"]').attr("href");
  assertSourceConstraint(
    "Fireworks model card canonical URL does not match its library slug",
    cardUrl === `${libraryOrigin}/models/${entry.slug}`,
    undefined,
  );
  const id = publicId.parse($('button[aria-label="Copy model path"]').prev("span").text().trim());
  const name = $("h1").text().trim();
  assertSourceConstraint(
    "Fireworks model card omitted its heading",
    $("h1").length === 1 && name !== "",
    undefined,
  );
  const priceHeading = $("h2").filter(
    (_index, element) => $(element).text().trim() === "Available Serverless",
  );
  assertSourceConstraint(
    "Fireworks model card lacks a unique Serverless offering",
    priceHeading.length === 1,
    undefined,
  );
  const cardAmount = priceHeading.next("p").text().trim();
  const cardUnit = priceHeading.parent().children("div").children("p").last().text().trim();
  const model = baseModel({
    providerId: input.provider.id,
    id,
    name,
    sourceId: input.source.id,
    observedAt: input.observedAt,
  });
  model.status = "active";
  const description = $('meta[name="description"]').attr("content")?.trim();
  if (description) model.description = description;
  if (entry.provider) model.model_card = { publisher: entry.provider.company.name };
  if (entry.contextLength !== null) {
    const count = wholeTokenCount(entry.contextLength);
    assertSourceConstraint(
      "Fireworks context length changed format",
      count !== undefined,
      undefined,
    );
    model.limits.context_tokens = count;
  }
  if (entry.tags.includes("Function Calling")) model.capabilities.tool_call = true;
  if (decisionIds.has(id)) {
    model.modalities.input = ["text"];
    model.service_families = ["System One"];
    model.api_endpoints = [{ name: "System One decisions", path: "/inference/v1/systemone" }];
  } else if (entry.tags.includes("Reranker")) {
    model.tasks = ["reranking"];
    model.modalities.input = ["text"];
    model.api_endpoints = [{ name: "Rerank", path: "/inference/v1/rerank" }];
  } else if (entry.tags.includes("Embedding")) {
    model.tasks = ["embeddings"];
    model.modalities = { input: ["text"], output: ["embedding"] };
    model.api_endpoints = [{ name: "Embeddings", path: "/inference/v1/embeddings" }];
  } else if (entry.tags.includes("Chat")) {
    model.tasks = ["text_generation"];
    model.modalities = {
      input: entry.supportsImageInput ? ["text", "image"] : ["text"],
      output: ["text"],
    };
    model.api_endpoints = [{ name: "Chat completions", path: chatPath }];
  }
  return { model, cardAmount, cardUnit };
}

function addSpotModels(
  input: SourceParseInput,
  models: Map<string, ParsedProviderModel>,
  body: string,
): void {
  const priceColumns = ["Uncached input", "Cached input", "Output"] as const;
  const prices = markdownTableRows(requiredSection(body, 2, "Pricing"), [
    "Model",
    "Tier",
    ...priceColumns,
  ]);
  const identities = markdownTableRows(requiredSection(body, 2, "Models"), [
    "Model",
    "Spot model identifier",
    "Standard model identifier",
  ]);
  for (const row of identities) {
    const id = publicId.parse(documentedId(row.get("Spot model identifier")));
    const standardId = publicId.parse(documentedId(row.get("Standard model identifier")));
    const label = row.get("Model");
    const matched = prices.filter(
      (price) => price.get("Model") === label && price.get("Tier") === "Spot",
    );
    const rate = matched[0];
    assertSourceConstraint(
      "Fireworks Spot model lacks a unique rate or ID",
      !!label && id !== standardId && !models.has(id) && matched.length === 1 && rate !== undefined,
      id,
    );
    const model = baseModel({
      providerId: input.provider.id,
      id,
      name: `${label} (Spot)`,
      sourceId: input.source.id,
      observedAt: input.observedAt,
    });
    const standard = models.get(standardId);
    model.status = "active";
    model.tasks = ["text_generation"];
    model.modalities = standard?.modalities ?? { input: ["text"], output: ["text"] };
    model.api_endpoints = [{ name: "Chat completions", path: chatPath }];
    model.price_facts = tokenRates(
      input,
      id,
      priceColumns.map((column) => rate.get(column)).join(" / "),
      "Spot Serverless/Pricing",
    );
    models.set(id, model);
  }
}

function addLegacyEmbeddings(
  input: SourceParseInput,
  models: Map<string, ParsedProviderModel>,
  body: string,
  pricing: string,
): void {
  const legacy = body.match(
    /^> \[accordion\] BERT-based models \(legacy\)\r?\n((?:^>[^\n]*\n?)*)/mu,
  )?.[1];
  assertSourceConstraint(
    "Fireworks omitted the legacy embedding model table",
    legacy !== undefined,
    undefined,
  );
  const parameters = "Base model parameter count";
  const usd = "\\$ / 1M input tokens";
  const rates = new Map(
    markdownTableRows(requiredSection(pricing, 2, "Embeddings"), [parameters, usd]).map((row) => [
      row.get(parameters),
      row.get(usd),
    ]),
  );
  for (const row of markdownTableRows(legacy.replace(/^> ?/gmu, ""), [
    "Model id",
    "Dimensions",
    "Parameters",
  ])) {
    const id = documentedId(row.get("Model id"));
    if (models.has(id)) continue;
    const dimensions = wholeTokenCount(row.get("Dimensions") ?? "");
    const size = Number(row.get("Parameters")?.match(/^([1-9]\d*)M$/u)?.[1]);
    const band = size <= 150 ? "up to 150M" : "150M – 350M";
    const amount = usdAmount(rates.get(band) ?? "");
    assertSourceConstraint(
      "Fireworks legacy embedding model lacks a reviewed size, dimensions, or rate",
      size > 0 && size <= 350 && dimensions !== undefined && dimensions > 0 && amount !== undefined,
      id,
    );
    const model = baseModel({
      providerId: input.provider.id,
      id,
      name: id,
      sourceId: input.source.id,
      observedAt: input.observedAt,
    });
    model.status = "legacy";
    model.tasks = ["embeddings"];
    model.modalities = { input: ["text"], output: ["embedding"] };
    model.api_endpoints = [{ name: "Embeddings", path: "/inference/v1/embeddings" }];
    model.limits.embedding_dimensions = [dimensions];
    model.price_facts = [
      hostedUsageRate(
        publishedRate(
          "input_text",
          amount,
          "million_tokens",
          input.source.id,
          "USD per 1M input tokens",
        ),
        { kind: "table", value: `Serverless Pricing/Embeddings/${band}` },
        "input_tokens",
      ),
    ];
    models.set(id, model);
  }
}

function bindRetrievalAliases(models: Map<string, ParsedProviderModel>, body: string): void {
  for (const [heading, task] of [
    ["Generating embeddings", "embeddings"],
    ["Reranking documents", "reranking"],
  ] as const) {
    const section = markdownSection(body, 2, heading);
    const qwen = section?.match(/^> \[tab\] Qwen3\r?\n((?:^>(?! \[tab\])[^\n]*\n?)*)/mu)?.[1];
    if (qwen === undefined) continue;
    for (const row of markdownTableRows(qwen.replace(/^> ?/gmu, ""), [
      "Model",
      "Model ID",
      "Availability",
    ])) {
      if (row.get("Availability") !== "Serverless and dedicated") continue;
      const path = row
        .get("Model")
        ?.match(
          /^\[[^\]]+\]\(https:\/\/app\.fireworks\.ai\/models\/(fireworks\/[a-z0-9._-]+)\)$/u,
        )?.[1];
      const linked = row
        .get("Model ID")
        ?.match(/^\[`([^`]+)`\]\(https:\/\/app\.fireworks\.ai\/models\/([^/)]+\/[^/)]+)\)$/u);
      if (path === undefined || linked?.[1] !== path || linked[2] !== path || models.has(path))
        continue;
      const model = models.get(`accounts/${path.replace("/", "/models/")}`);
      if (model?.tasks.includes(task)) model.aliases.push(modelIdSchema.parse(path));
    }
  }
}

export function parseFireworksServerless(input: SourceParseInput): SourceParseResult {
  const bundle = linkedBundleSchema.parse(
    parseSourceJson(input.body, "Fireworks model library bundle"),
  );
  const docs = (page: string, area = "serverless") =>
    linkedDocumentBody(bundle, `/${area}/${page}.md`, `Fireworks bundle omitted ${page}`);
  const pricing = docs("pricing");
  const decisionRows = pricesFromTable(pricing, "Decision models");
  const decisionIds = new Set(decisionRows.map(({ id }) => id));
  const modes = docs("serverless-modes");
  const routerRows = [
    ...routerTable(modes, "Fast"),
    ...routerTable(modes, "Ultra-fast (Preview)", " Ultra-fast (Preview)"),
    ...routerTable(docs("us-only-serverless"), "Available models", " (US)"),
  ];
  const routers = new Map(routerRows.map(({ label, id }) => [label.toLowerCase(), id]));
  assertSourceConstraint(
    "Fireworks router documentation repeated a price label",
    routers.size === routerRows.length,
    routerRows.length,
  );
  const entries = libraryEntries(bundle.index.body);
  assertSourceConstraint("Fireworks bundle has no serverless cards", entries.length > 0, undefined);
  const documents = new Map(bundle.documents.map((document) => [document.url, document]));
  const cards = entries.map((entry) => {
    const url = `${libraryOrigin}/models/${entry.slug}/`;
    const document = documents.get(url);
    assertSourceConstraint(
      "Fireworks bundle omitted a serverless model card",
      document !== undefined,
      undefined,
    );
    return readCard(input, entry, document, decisionIds);
  });
  const models = new Map(cards.map(({ model }) => [model.model_id, model]));
  assertSourceConstraint(
    "Fireworks library cards repeated a public model ID",
    models.size === cards.length,
    models.size,
  );
  for (const { label, id } of routerRows) {
    if (!id.includes("/routers/")) continue;
    assertSourceConstraint("Fireworks router ID was repeated", !models.has(id), id);
    models.set(id, {
      ...baseModel({
        providerId: input.provider.id,
        id,
        name: label,
        sourceId: input.source.id,
        observedAt: input.observedAt,
      }),
      status: "active",
      release_stage: label.endsWith("Ultra-fast (Preview)") ? "preview" : "unknown",
      tasks: ["text_generation"],
      modalities: { input: ["text"], output: ["text"] },
      api_endpoints: [{ name: "Chat completions", path: chatPath }],
    });
  }

  for (const { label, id, standard, priority } of [
    ...pricesFromTable(pricing, "Text and vision models"),
    ...decisionRows,
  ]) {
    const routedId = routers.get(label.toLowerCase());
    const model = models.get(routedId ?? id);
    if (model === undefined) {
      input.onPricingReconciliation?.({
        disposition: "unbound",
        reason_code: "fireworks_price_without_serverless_card",
        sample: id,
      });
      continue;
    }
    const variant = / (?:Fast|Ultra-fast \(Preview\)|\(US\))$/u.test(label);
    if (
      variant &&
      routedId === undefined &&
      label.toLowerCase() !== model.name.toLowerCase() &&
      label.toLowerCase() !== `${model.name} (US)`.toLowerCase()
    ) {
      input.onPricingReconciliation?.({
        disposition: "unbound",
        reason_code: "fireworks_price_without_exact_router",
        sample: id,
      });
      continue;
    }
    assertSourceConstraint(
      "Fireworks pricing rows repeated a standard rate",
      model.price_facts.length === 0,
      undefined,
    );
    const hasPriority = priority !== "—";
    model.price_facts = tokenRates(
      input,
      model.model_id,
      standard,
      "Serverless Pricing/Standard",
      hasPriority ? { service_tier: "standard" } : {},
      decisionIds.has(id),
    );
    if (hasPriority)
      model.price_facts.push(
        ...tokenRates(
          input,
          model.model_id,
          priority,
          "Serverless Pricing/Priority",
          { service_tier: "priority" },
          decisionIds.has(id),
        ),
      );
  }

  for (const { model, cardAmount, cardUnit } of cards) {
    if (model.price_facts.length > 0 || cardAmount === "") continue;
    if (
      model.tasks.includes("text_generation") &&
      cardUnit === "Per 1M Tokens (input/cached input/output)"
    ) {
      model.price_facts = tokenRates(
        input,
        model.model_id,
        cardAmount,
        "Model card/Available Serverless",
      );
    } else if (
      (model.tasks.includes("embeddings") || model.tasks.includes("reranking")) &&
      retrievalCardUnits.has(cardUnit)
    ) {
      const amount = usdAmount(cardAmount);
      if (amount !== undefined)
        model.price_facts.push(
          hostedUsageRate(
            publishedRate("input_text", amount, "million_tokens", input.source.id, tokenUnit),
            { kind: "table", value: `Model card/${model.model_id}/Available Serverless` },
            "input_tokens",
          ),
        );
    }
    if (model.price_facts.length === 0)
      model.raw_price_facts.push(
        rawPricingFact(input.source.id, "serverless", "base_price", "unknown_meter", {
          amount: cardAmount,
          ...(cardUnit === "" ? {} : { unit: cardUnit }),
        }),
      );
  }
  const media = docs("video-audio-inputs", "guides");
  const mediaRows = markdownTableRows(requiredSection(media, 2, "Available models"), [
    "Model",
    "Input support",
    "Notes",
  ]);
  const serverless = requiredSection(
    requiredSection(media, 2, "Choose an inference option"),
    3,
    "Serverless",
  );
  for (const row of mediaRows) {
    if (
      row.get("Notes") !== "Serverless" ||
      !row.get("Input support")?.split(", ").includes("video")
    )
      continue;
    const label = row.get("Model");
    for (const id of serverless.matchAll(/^accounts\/fireworks\/models\/[a-z0-9._-]+$/gmu)) {
      const model = models.get(id[0]);
      if (model !== undefined && model.name === label && !model.modalities.input.includes("video"))
        model.modalities.input.push("video");
    }
  }
  addSpotModels(input, models, docs("spot-serverless", "guides"));
  const retrieval = docs("querying-embeddings-models", "guides");
  addLegacyEmbeddings(input, models, retrieval, pricing);
  bindRetrievalAliases(models, retrieval);
  addConsolePrices(
    input,
    models,
    cards.map(({ model }) => model.model_id),
    bundle.documents,
  );
  for (const model of models.values())
    if (model.price_facts.length > 0) model.pricing_state = "numeric";
  const published = [...models.values()];
  return {
    models: published,
    inference_prices: published
      .filter((model) => model.price_facts.length > 0 || model.raw_price_facts.length > 0)
      .flatMap((model) => [
        hostedInferencePrice(model, input.source.id, {
          kind: "provider_key",
          value: model.model_id,
        }),
        ...model.aliases.map((alias) => ({
          ...hostedInferencePrice(model, input.source.id, {
            kind: "table",
            value: `Embeddings and Reranking/Qwen3/${alias}`,
          }),
          model_id: alias,
        })),
      ]),
  };
}

// Commercial selection describes owned tariffs, independently of model capabilities.
export const fireworksSelectionPolicy = {
  offers: {
    usage: ["request"],
  },
  values: {
    service_tier: ["standard", "priority"],
  },
} satisfies import("./commercial-selection.ts").CommercialSelectionPolicy;
