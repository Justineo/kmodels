import { load } from "cheerio";
import { linkedBundleSchema } from "./bundle.ts";
import { modelIdSchema } from "./identity.ts";
import { markdownProse } from "./markdown.ts";
import { baseModel } from "./model.ts";
import type { ParsedProviderModel } from "./pricing-source.ts";
import { modalitySchema } from "./schema.ts";
import { assertSourceConstraint, parseSourceJson } from "./source-contract.ts";
import type { SourceParseInput } from "./source-parse.ts";

const libraryUrl = "https://www.together.ai/models";

export function togetherLibraryPage(body: string) {
  const $ = load(body);
  const cards = $("main .models_link")
    .toArray()
    .flatMap((element) => {
      const card = $(element);
      const id = modelIdSchema.safeParse(card.find('[fs-list-field="endpoint"]').text().trim());
      const path = card.children("a[href]").attr("href");
      if (
        !id.success ||
        path === undefined ||
        !/^\/models\/[a-z0-9-]+$/u.test(path) ||
        !card
          .find("[data-model-features]")
          .toArray()
          .some((tag) => $(tag).text().trim() === "Serverless")
      )
        return [];
      const modalities = (attribute: "input" | "output") => [
        ...new Set(
          card
            .find(`[data-${attribute}-modalities]`)
            .toArray()
            .flatMap((item) => {
              const value = modalitySchema.safeParse(
                $(item).find("span").first().text().trim().toLowerCase(),
              );
              return value.success ? [value.data] : [];
            }),
        ),
      ];
      return [
        {
          id: id.data,
          url: new URL(path, libraryUrl).href,
          reasoning: card
            .find('[fs-list-field="category"]')
            .toArray()
            .some((tag) => $(tag).text().trim() === "Reasoning"),
          input: modalities("input"),
          output: modalities("output"),
        },
      ];
    });
  const nextLinks = $("main a.w-pagination-next[href]");
  assertSourceConstraint(
    "Together Model Library repeated its next-page link",
    nextLinks.length <= 1,
    nextLinks.length,
  );
  assertSourceConstraint(
    "Together Model Library lost its model cards",
    $("main .models_link").length > 0,
    cards.length,
  );
  return { cards, next: nextLinks.attr("href") };
}

export function togetherNextLibraryPage(target: string, current: URL): URL {
  const next = new URL(target, current);
  const [query] = next.searchParams;
  const [key, page] = query ?? [];
  const currentKey = [...current.searchParams.keys()][0];
  assertSourceConstraint(
    "Together Model Library pagination left its reviewed sequence",
    next.origin + next.pathname === libraryUrl &&
      !next.hash &&
      !next.username &&
      !next.password &&
      next.searchParams.size === 1 &&
      key !== undefined &&
      /^[a-f0-9]{8}_page$/u.test(key) &&
      (currentKey === undefined || currentKey === key) &&
      page === String(Number(current.searchParams.get(key) ?? 1) + 1),
    next.search,
  );
  return next;
}

function metadataModel(input: SourceParseInput, id: string): ParsedProviderModel {
  return baseModel({
    providerId: input.provider.id,
    id,
    name: id,
    sourceId: input.source.id,
    observedAt: input.observedAt,
  });
}

export function parseTogetherCards(input: SourceParseInput): ParsedProviderModel[] {
  const bundle = linkedBundleSchema.parse(
    parseSourceJson(input.body, "Together Model Library bundle"),
  );
  const libraryPages = [
    bundle.index,
    ...bundle.documents.filter(({ url }) => url.startsWith(libraryUrl + "?")),
  ];
  const bodies = new Map(bundle.documents.map(({ url, body }) => [url, body]));
  const catalogIds = new Set(input.catalogModels?.map(({ model_id }) => model_id));
  const models = new Map<string, ParsedProviderModel>();
  for (const page of libraryPages) {
    for (const { id, url, reasoning, input: modalitiesIn, output } of togetherLibraryPage(page.body)
      .cards) {
      if (!catalogIds.has(id) || models.has(id)) continue;
      const body = bodies.get(url);
      if (body === undefined) continue;
      const $ = load(body);
      const exactId = $("main p[data-copy-target]")
        .toArray()
        .some((target) => $(target).text().trim() === id);
      if (!exactId) continue;
      const description = $('meta[name="description"]').attr("content")?.trim();
      const model = metadataModel(input, id);
      if (description) model.description = description;
      const boxes = $("main .models-d-content_box-item-inner");
      const box = (label: string) =>
        boxes.filter((_index, item) => $(item).children().first().text().trim() === label);
      const cardModalities = (label: string) =>
        box(label)
          .find('[role="listitem"]')
          .toArray()
          .flatMap((item) => {
            const value = modalitySchema.safeParse($(item).text().trim().toLowerCase());
            return value.success ? [value.data] : [];
          });
      model.modalities = {
        input: [...new Set([...modalitiesIn, ...cardModalities("Input modalities")])],
        output: [...new Set([...output, ...cardModalities("Output modalities")])],
      };
      if (reasoning) model.capabilities.reasoning = true;
      const context = box("Context length").children().last().text().trim();
      if (context && context.length <= 2048) model.model_card = { context_window: context };
      models.set(id, model);
    }
  }
  assertSourceConstraint(
    "Together Model Library cards did not match the Serverless catalog",
    models.size > 0,
    models.size,
  );
  return [...models.values()];
}

export function parseTogetherReleases(input: SourceParseInput): ParsedProviderModel[] {
  const releases = new Map<string, string>();
  let date: string | undefined;
  let serverlessRelease = false;
  for (const line of markdownProse(input.body).split("\n")) {
    const dateLabel = line.trim().match(/^\*\*([A-Z][a-z]+ \d{1,2}, \d{4})\*\*$/u)?.[1];
    if (dateLabel !== undefined) {
      const time = Date.parse(dateLabel + " UTC");
      date = Number.isFinite(time) ? new Date(time).toISOString().slice(0, 10) : undefined;
      serverlessRelease = false;
      continue;
    }
    if (/^#{1,6} /u.test(line)) serverlessRelease = /^## New serverless models?\s*$/iu.test(line);
    if (date === undefined || !serverlessRelease) continue;
    const id = modelIdSchema.safeParse(line.match(/^\* `([^`]+)`(?:[:.]|\s|$)/u)?.[1]);
    if (!id.success) continue;
    const previous = releases.get(id.data);
    if (previous === undefined || date < previous) releases.set(id.data, date);
  }
  assertSourceConstraint(
    "Together changelog omitted reviewed Serverless launch entries",
    releases.size > 0,
    releases.size,
  );
  const catalogIds = new Set(input.catalogModels?.map(({ model_id }) => model_id));
  return [...releases].flatMap(([id, release_date]) =>
    catalogIds.has(id) ? [{ ...metadataModel(input, id), release_date }] : [],
  );
}
