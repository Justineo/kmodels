/** Cohere's model overview uses page-relative links; legacy indexes used absolute .md links. */
export function cohereModelDocumentUrls(body: string, indexUrl: string): URL[] {
  const urls = new Map<string, URL>();
  const base = new URL(indexUrl);
  if (base.origin !== "https://docs.cohere.com")
    throw new Error("Cohere model index must use the official documentation origin");
  // A page-level llms.txt response can now contain the page itself, with its relative links.
  base.pathname = base.pathname.replace(/\/llms\.txt$/, "");
  for (const match of body.matchAll(/(?<!!)\[[^\]]+\]\(([^)\s]+)\)/g)) {
    const target = match[1];
    if (target === undefined) continue;
    let url: URL;
    try {
      url = new URL(target, base);
    } catch {
      continue;
    }
    if (
      url.origin !== base.origin ||
      url.username !== "" ||
      url.password !== "" ||
      url.search !== "" ||
      url.hash !== "" ||
      !/^\/(?:v2\/)?docs\/[a-z0-9.-]+$/.test(url.pathname)
    )
      continue;
    // Existing card parsers consume the HTML view of the exact linked document.
    url.pathname = url.pathname.replace(/\.md$/, "");
    urls.set(url.href, url);
  }
  return [...urls.values()].sort((left, right) => left.href.localeCompare(right.href));
}
