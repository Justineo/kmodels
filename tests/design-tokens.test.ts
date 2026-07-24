import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";

const tokens = readFileSync(new URL("../src/tokens.css", import.meta.url), "utf8");
const components = readFileSync(new URL("../src/style.css", import.meta.url), "utf8");

function matches(pattern: RegExp, value: string): string[] {
  return [...value.matchAll(new RegExp(pattern.source, `${pattern.flags.replace("g", "")}g`))].map(
    ([match]) => match,
  );
}

describe("design token contract", () => {
  it.each([
    {
      name: "raw colors",
      pattern: /#[\da-f]{3,8}\b|(?:rgb|hsl|oklch|color-mix)\(|(?<!-)\btransparent\b/i,
      allowed: /^$/,
    },
    {
      name: "raw type sizes",
      pattern: /font-size:\s*[^;]+/,
      allowed: /^font-size:\s*(?:var\(|inherit$)/,
    },
    {
      name: "raw type weights",
      pattern: /font-weight:\s*[^;]+/,
      allowed: /^font-weight:\s*(?:var\(|inherit$)/,
    },
    {
      name: "raw line heights",
      pattern: /line-height:\s*[^;]+/,
      allowed: /^line-height:\s*(?:var\(|inherit$)/,
    },
    {
      name: "raw tracking",
      pattern: /letter-spacing:\s*[^;]+/,
      allowed: /^letter-spacing:\s*(?:var\(|inherit$)/,
    },
    {
      name: "raw radii",
      pattern: /border-radius:\s*[^;]+/,
      allowed: /^border-radius:\s*var\(/,
    },
    {
      name: "raw shadows",
      pattern: /box-shadow:\s*[^;]+/,
      allowed: /^box-shadow:\s*var\(/,
    },
    {
      name: "raw transition durations",
      pattern: /\b\d+(?:\.\d+)?m?s\b/,
      allowed: /^$/,
    },
    {
      name: "raw easing curves",
      pattern: /cubic-bezier\(|(?<!-)\b(?:ease|ease-in|ease-out|ease-in-out|linear)\b/,
      allowed: /^$/,
    },
  ])("keeps $name out of component CSS", ({ pattern, allowed }) => {
    expect(matches(pattern, components).filter((value) => !allowed.test(value))).toEqual([]);
  });

  it("declares every consumed custom property locally", () => {
    const declared = new Set(
      matches(/--[a-z0-9-]+\s*:/i, `${tokens}\n${components}`).map((value) =>
        value.slice(0, value.indexOf(":")).trim(),
      ),
    );
    const consumed = new Set(
      matches(/var\(--[a-z0-9-]+/i, `${tokens}\n${components}`).map((value) =>
        value.slice("var(".length),
      ),
    );

    expect([...consumed].filter((name) => !declared.has(name))).toEqual([]);
  });

  it("keeps shared token declarations out of component CSS", () => {
    const componentDeclarations = matches(/--[a-z0-9-]+\s*:/i, components).map((value) =>
      value.slice(0, value.indexOf(":")).trim(),
    );

    expect(
      componentDeclarations.filter(
        (name) => !name.startsWith("--os-") && name !== "--status-color",
      ),
    ).toEqual([]);
  });

  it("keeps the previous ad hoc semantic aliases retired", () => {
    expect(components).not.toMatch(
      /--(?:background|surface|text|border|accent|positive|warning|danger|header-height|toolbar-height)\b/,
    );
  });
});
