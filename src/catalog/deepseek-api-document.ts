import { load } from "cheerio";
import { htmlText } from "./html.ts";

export type DeepseekFieldPath = readonly (readonly [name: string, type: string])[];
type Owner = "request" | "response";
type ResponseMedia = "application/json" | "text/event-stream";
type Document = ReturnType<typeof load>;
type Selection = ReturnType<Document>;
const itemSelector = ".openapi-schema__list-item";

export function deepseekApiDocument(body: string, path: string, method: "GET" | "POST" = "POST") {
  const $ = load(body);
  $("script, style, template").remove();
  const articles = $("article");
  const operations = articles.find("pre.openapi__method-endpoint");
  if (
    articles.length !== 1 ||
    operations.length !== 1 ||
    htmlText(operations.find(".badge").text()) !== method ||
    htmlText(operations.find("h2.openapi__method-endpoint-path").text()) !== path
  )
    throw new Error("DeepSeek reference changed operation: " + path);

  const ownedMetadata = (item: Selection, selector: string): string | undefined => {
    const nodes = item
      .find(selector)
      .filter(
        (_, node) =>
          $(node).closest(itemSelector).get(0) === item.get(0) &&
          $(node).parents("pre, code, blockquote").length === 0,
      );
    return nodes.length === 1 ? htmlText(nodes.text()) : undefined;
  };
  const roots = (owner: Owner) =>
    articles
      .find(
        owner === "request"
          ? ".openapi-markdown__details.mime"
          : ".openapi-markdown__details.response",
      )
      .filter((_, node) => $(node).parents(".mime, .response, pre, code, blockquote").length === 0);
  const requestRoots = roots("request");
  const responseRoots = roots("response");
  const responseMedia = new Map(
    responseRoots.toArray().map((node) => {
      const tabs = $(node)
        .closest(".tabs-container")
        .children(".tabs__container")
        .find(".openapi-tabs__mime > .openapi-tabs__mime-item[role=tab]");
      return [node, tabs.length === 0 ? undefined : tabs.length === 1 ? htmlText(tabs.text()) : ""];
    }),
  );
  const hasMediaLabels = [...responseMedia.values()].some((media) => media !== undefined);
  const fieldCandidates = (
    owner: Owner,
    path: DeepseekFieldPath,
    media: ResponseMedia = "application/json",
  ): { fields: Selection[]; unique: boolean } => {
    const root =
      owner === "request"
        ? requestRoots
        : hasMediaLabels
          ? responseRoots.filter((_, node) => responseMedia.get(node) === media)
          : responseRoots;
    const owners = new Set<Selection[number]>(root.toArray());
    let parent: Selection | undefined;
    for (const [index, [name, type]] of path.entries()) {
      const last = index === path.length - 1;
      const candidates = (parent ?? root)
        .find(itemSelector)
        .filter((_, node) => {
          if ($(node).parents("pre, code, blockquote").length > 0) return false;
          const ownerNode = $(node).closest(".mime, .response").get(0);
          if (ownerNode === undefined || !owners.has(ownerNode)) return false;
          return parent === undefined
            ? $(node).parents(itemSelector).length === 0
            : $(node).parents(itemSelector).first().get(0) === parent.get(0);
        })
        .filter((_, node) => ownedMetadata($(node), "strong.openapi-schema__property") === name);
      const typed = candidates.filter(
        (_, node) => ownedMetadata($(node), ".openapi-schema__name") === type,
      );
      if (last) {
        const fields: Selection[] = [];
        typed.each((position) => {
          fields.push(typed.eq(position));
        });
        return { fields, unique: candidates.length === 1 && typed.length === 1 };
      }
      if (candidates.length !== 1 || typed.length !== 1) return { fields: [], unique: false };
      parent = candidates;
    }
    return { fields: [], unique: false };
  };
  const field = (
    owner: Owner,
    path: DeepseekFieldPath,
    media: ResponseMedia = "application/json",
  ): Selection | undefined => {
    const { fields, unique } = fieldCandidates(owner, path, media);
    return unique ? fields[0] : undefined;
  };
  const text = (owner: Owner, path: DeepseekFieldPath): string | undefined => {
    const selected = field(owner, path);
    if (selected === undefined) return;
    const copy = selected.clone();
    copy.find(itemSelector + ", pre, blockquote").remove();
    return htmlText(copy.text());
  };
  const possibleValues = (selected: Selection): string[] | undefined => {
    const statements = selected
      .find("p")
      .filter(
        (_, paragraph) =>
          $(paragraph).closest(itemSelector).get(0) === selected.get(0) &&
          $(paragraph).parents("pre, code, blockquote").length === 0 &&
          /^Possible values:/i.test(htmlText($(paragraph).text())),
      );
    if (statements.length !== 1) return;
    const result = statements
      .find("code")
      .map((_, code) => htmlText($(code).text()))
      .get();
    if (result.length > 0) return result;
    const plain = htmlText(statements.text()).match(
      /^Possible values:\s*\[([a-z0-9._-]+)\]$/i,
    )?.[1];
    return plain === undefined ? undefined : [plain];
  };
  const values = (owner: Owner, path: DeepseekFieldPath): string[] | undefined => {
    const selected = field(owner, path);
    if (selected === undefined) return;
    return possibleValues(selected);
  };
  const allValues = (owner: Owner, path: DeepseekFieldPath): string[] | undefined => {
    const collected = fieldCandidates(owner, path).fields.flatMap(
      (selected) => possibleValues(selected) ?? [],
    );
    return collected.length === 0 ? undefined : [...new Set(collected)];
  };
  return {
    has: (owner: Owner, path: DeepseekFieldPath, media?: ResponseMedia) =>
      field(owner, path, media) !== undefined,
    text,
    values,
    allValues,
    responseSamples: articles
      .find(".openapi-code__response-samples-container pre code")
      .filter((_, node) => $(node).parents(itemSelector + ", .mime, blockquote").length === 0)
      .map((_, code) => $(code).text())
      .get(),
  };
}
