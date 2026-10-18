import { load } from "cheerio";
import { htmlText } from "./html.ts";

export type DeepseekFieldPath = readonly (readonly [name: string, type: string])[];
type Owner = "request" | "response";
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
  const field = (owner: Owner, path: DeepseekFieldPath): Selection | undefined => {
    const root = roots(owner);
    const owners = root.toArray();
    let parent: Selection | undefined;
    for (const [name, type] of path) {
      const candidates = (parent ?? root)
        .find(itemSelector)
        .filter((_, node) => {
          if ($(node).parents("pre, code, blockquote").length > 0) return false;
          const ownerNode = $(node).closest(".mime, .response").get(0);
          if (ownerNode === undefined || !owners.some((owner) => owner === ownerNode)) return false;
          return parent === undefined
            ? $(node).parents(itemSelector).length === 0
            : $(node).parents(itemSelector).first().get(0) === parent.get(0);
        })
        .filter((_, node) => ownedMetadata($(node), "strong.openapi-schema__property") === name);
      if (candidates.length !== 1 || ownedMetadata(candidates, ".openapi-schema__name") !== type)
        return;
      parent = candidates;
    }
    return parent;
  };
  const text = (owner: Owner, path: DeepseekFieldPath): string | undefined => {
    const selected = field(owner, path);
    if (selected === undefined) return;
    const copy = selected.clone();
    copy.find(itemSelector + ", pre, blockquote").remove();
    return htmlText(copy.text());
  };
  const values = (owner: Owner, path: DeepseekFieldPath): string[] | undefined => {
    const selected = field(owner, path);
    if (selected === undefined) return;
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
    return result.length > 0 ? result : undefined;
  };
  return {
    has: (owner: Owner, path: DeepseekFieldPath) => field(owner, path) !== undefined,
    text,
    values,
    responseSamples: articles
      .find(".openapi-code__response-samples-container pre code")
      .filter((_, node) => $(node).parents(itemSelector + ", .mime, blockquote").length === 0)
      .map((_, code) => $(code).text())
      .get(),
  };
}
