import { readFile } from "node:fs/promises";
import { load } from "cheerio";
import { htmlText } from "../src/catalog/html.ts";
import type { SourceManifest } from "../src/catalog/manifests.ts";

const fixture = (name: string) =>
  readFile(new URL(`./fixtures/deepseek/${name}.html`, import.meta.url), "utf8");

export async function deepseekBundle(source: SourceManifest, catalog?: string) {
  const bundle = {
    index: { url: source.url, body: catalog ?? (await fixture("catalog")) },
    documents: await Promise.all(
      [
        ["api/create-chat-completion", "chat"],
        ["api/create-response", "responses"],
        ["api/create-completion", "fim"],
        ["guides/anthropic_api", "anthropic"],
        ["guides/vision", "vision"],
        ["api/list-models", "list-models"],
        ["zh-cn/quick_start/pricing/", "catalog-cny"],
      ].map(async ([path, name]) => {
        if (path === undefined || name === undefined) throw new Error("Invalid fixture mapping");
        return { url: `https://api-docs.deepseek.com/${path}`, body: await fixture(name) };
      }),
    ),
  };
  for (const [body, name, heading] of [
    [bundle.index, "services-catalog", "Web Search & Fetch Pricing"],
    [
      bundle.documents.find((doc) => doc.url.includes("/zh-cn/")),
      "services-cny",
      "联网搜索与抓取价格",
    ],
  ] as const) {
    if (body === undefined) throw new Error("Missing service pricing owner");
    const $ = load(await fixture(name));
    const title = $("h2").filter((_, node) => htmlText($(node).text()) === heading);
    if (title.length !== 1) throw new Error("Missing native service heading");
    const target = load(body.body);
    target("article").append(title.toString() + title.nextUntil("h1,h2").toString());
    body.body = target.html();
  }
  bundle.documents.push({
    url: "https://api-docs.deepseek.com/guides/search/",
    body: await fixture("search-billing"),
  });
  return bundle;
}
