const presentationAttributes = [
  "fill",
  "fill-rule",
  "stroke",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "clip-rule",
] as const;

function attribute(source: string, name: string): string | undefined {
  return new RegExp(`\\b${name}="([^"]+)"`).exec(source)?.[1];
}

function scopeReferences(source: string, scope: string): string {
  return source
    .replace(/id="([^"]+)"/g, `id="${scope}-$1"`)
    .replace(/url\(#([^)]+)\)/g, `url(#${scope}-$1)`)
    .replace(/href="#([^"]+)"/g, `href="#${scope}-$1"`);
}

export function svgSymbol(id: string, source: string): string {
  const svg = /<svg\b([^>]*)>([\s\S]*?)<\/svg>/i.exec(source);
  if (svg === null) throw new Error(`Invalid SVG source for ${id}`);

  const attributes = svg[1] ?? "";
  const body = svg[2] ?? "";
  const viewBox = attribute(attributes, "viewBox");
  if (viewBox === undefined) throw new Error(`Missing SVG viewBox for ${id}`);

  const presentation = presentationAttributes
    .map((name) => {
      const value = attribute(attributes, name);
      return value === undefined ? "" : ` ${name}="${value}"`;
    })
    .join("");

  return `<symbol id="${id}" viewBox="${viewBox}"${presentation}>${scopeReferences(body, id)}</symbol>`;
}
