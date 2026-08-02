import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";

const tokens = readFileSync(new URL("../src/tokens.css", import.meta.url), "utf8");
const components = readFileSync(new URL("../src/style.css", import.meta.url), "utf8");
const app = readFileSync(new URL("../src/App.vue", import.meta.url), "utf8");
const modelRow = readFileSync(new URL("../src/components/ModelRow.vue", import.meta.url), "utf8");
const modelGroupRow = readFileSync(
  new URL("../src/components/ModelGroupRow.vue", import.meta.url),
  "utf8",
);

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

  it("keeps native horizontal table overflow inside the viewport", () => {
    expect(components).toMatch(/\.catalog-section\s*\{[^}]*min-width:\s*0;/s);
    expect(components).toMatch(/\.table-scroll-host\s*\{[^}]*min-width:\s*0;/s);
    expect(components).toMatch(/\.table-shell\s*\{[^}]*width:\s*100%;[^}]*overflow:\s*auto;/s);
  });

  it("keeps virtual row striping independent of rendered child position", () => {
    expect(components).not.toMatch(/\.model-row:nth-child\((?:odd|even)\)/);
    expect(components).toMatch(/\.model-row\[data-alternate="true"\]\s*>\s*td/);
    expect(matches(/:alternate="\(virtualRange\.start \+ index\) % 2 === 1"/, app)).toHaveLength(2);
    expect(modelRow).toMatch(/:data-alternate="alternate \? 'true' : undefined"/);
    expect(modelGroupRow).toMatch(/:data-alternate="alternate \? 'true' : undefined"/);
  });

  it("explains lifecycle and maturity from the Status table heading", () => {
    expect(app).toMatch(/const STATUS_TOOLTIP\s*=\s*"Active means currently available\./);
    expect(app).toMatch(
      /<th class="status-col"[^>]*>[\s\S]*?<UiTooltip[\s\S]*?:content="STATUS_TOOLTIP"[\s\S]*?>[\s\S]*?Status[\s\S]*?<\/UiTooltip>/,
    );
    expect(matches(/class="table-header-tooltip-trigger"/, app)).toHaveLength(4);
  });

  it("keeps custom scrollbar tokens stronger than the asynchronously loaded base theme", () => {
    expect(components).toMatch(/\.os-scrollbar\.kmodels-scrollbar\s*\{/);
    expect(components).not.toMatch(/(?<!\.os-scrollbar)\.kmodels-scrollbar\s*\{/);
  });

  it("separates mobile table scrolling by axis", () => {
    expect(components).toMatch(
      /\.table-shell\s*\{[^}]*overflow-x:\s*auto;[^}]*overflow-y:\s*hidden;[^}]*overscroll-behavior:\s*none;/s,
    );
    expect(components).toMatch(
      /\.model-table tbody\s*\{[^}]*overflow-x:\s*hidden;[^}]*overflow-y:\s*auto;[^}]*overscroll-behavior-x:\s*auto;[^}]*overscroll-behavior-y:\s*none;/s,
    );
    expect(components).toMatch(/\.model-table tbody td\s*\{[^}]*touch-action:\s*pan-x pan-y;/s);
    expect(components).toMatch(
      /\.mobile-table-scrollbar-slot\s*\{[^}]*inset:\s*var\(--layout-table-header-height\)[^}]*display:\s*block;/s,
    );
    expect(components).toMatch(
      /\.mobile-table-scrollbar-slot\s*>\s*\.os-scrollbar-horizontal,[^{]*\.table-scroll-host\s*>\s*\.os-scrollbar-vertical\s*\{[^}]*display:\s*none;/s,
    );
  });
});
