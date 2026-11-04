import { load } from "cheerio";
import { z } from "zod";
import { linkedBundleSchema, linkedDocumentBody } from "./bundle.ts";
import { hostedInferencePrice, hostedUsageRate, usdAmount } from "./hosted-usage-rate.ts";
import { modelIdSchema } from "./identity.ts";
import { markdownSection, markdownTableRows } from "./markdown.ts";
import { baseModel } from "./model.ts";
import { publishedRate, rawPricingFact, wholeTokenCount } from "./pricing.ts";
import type { ParsedProviderModel, SourcePriceFact } from "./pricing-source.ts";
import { assertSourceConstraint, parseSourceJson } from "./source-contract.ts";
import type { SourceParseInput, SourceParseResult } from "./source-parse.ts";

const libraryEntry = z.object({ serverless: z.boolean(), serverlessApi: z.boolean() });
const hostedEntry = z.object({
  slug: z.string().regex(/^[a-z0-9._-]+\/[a-z0-9._-]+$/u),
  contextLength: z.string().nullable(),
  tags: z.array(z.string()),
  supportsImageInput: z.boolean(),
});
const flightFrame = z.tuple([z.literal(1), z.string()]);
const libraryFrame = z.tuple([
  z.literal("$"),
  z.string(),
  z.null(),
  z.object({ models: z.array(z.unknown()).min(1).max(5_000) }),
]);
const publicId = modelIdSchema.refine((id) =>
  /^accounts\/[^/]+\/(?:models|routers)\/[^/]+$/u.test(id),
);
const libraryOrigin = "https://fireworks.ai";
const chatPath = "/inference/v1/chat/completions";
const tokenUnit = "USD per 1M tokens";
const usdTriplet = z.tuple([z.string(), z.string(), z.string()]);

function libraryEntries(body: string) {
  const $ = load(body);
  const lists: unknown[][] = [];
  for (const script of $("script").toArray()) {
    const frame = $(script)
      .text()
      .trim()
      .match(/^self\.__next_f\.push\((\[1,"(?:[^"\\]|\\.)*"\])\);?$/su)?.[1];
    if (frame === undefined) continue;
    const chunk = flightFrame.parse(parseSourceJson(frame, "Fireworks library frame"))[1];
    for (const line of chunk.split("\n")) {
      if (!/^[a-f0-9]+:\["\$","\$L[^"]+",null,\{"models":/u.test(line)) continue;
      lists.push(
        libraryFrame.parse(
          parseSourceJson(line.slice(line.indexOf(":") + 1), "Fireworks library inventory"),
        )[3].models,
      );
    }
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

function requiredSection(body: string, depth: number, name: string): string {
  const section = markdownSection(body, depth, name);
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
  return markdownTableRows(requiredSection(body, 2, section), ["Model", "`model` ID"]).map(
    (row) => {
      const label = row.get("Model");
      const raw = row.get("`model` ID")?.match(/^`([^`]+)`$/u)?.[1];
      assertSourceConstraint("Fireworks route table lost a model label", !!label, undefined);
      return { label: `${label}${suffix}`, id: publicId.parse(raw) };
    },
  );
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

export function parseFireworksServerless(input: SourceParseInput): SourceParseResult {
  const bundle = linkedBundleSchema.parse(
    parseSourceJson(input.body, "Fireworks model library bundle"),
  );
  const docs = (page: string) =>
    linkedDocumentBody(bundle, `/serverless/${page}.md`, `Fireworks bundle omitted ${page}`);
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
      model.tasks.includes("embeddings") &&
      cardUnit === "Per 1M Tokens (input/cached input/output)"
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
  const published = [...models.values()];
  return {
    models: published,
    inference_prices: published
      .filter((model) => model.price_facts.length > 0 || model.raw_price_facts.length > 0)
      .map((model) =>
        hostedInferencePrice(model, input.source.id, {
          kind: "provider_key",
          value: model.model_id,
        }),
      ),
  };
}
