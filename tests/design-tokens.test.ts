import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";

const tokenStyles = readFileSync(new URL("../src/tokens.css", import.meta.url), "utf8");
const globalStyles = readFileSync(new URL("../src/style.css", import.meta.url), "utf8");
const componentDirectory = new URL("../src/components/", import.meta.url);
const componentStyles = readdirSync(componentDirectory)
  .filter((name) => name.endsWith(".vue"))
  .map((name) => readFileSync(new URL(name, componentDirectory), "utf8"))
  .join("\n");
const allStyles = `${globalStyles}\n${componentStyles}`;
const app = readFileSync(new URL("../src/App.vue", import.meta.url), "utf8");
const tooltip = readFileSync(new URL("../src/components/UiTooltip.vue", import.meta.url), "utf8");
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
    expect(matches(pattern, allStyles).filter((value) => !allowed.test(value))).toEqual([]);
  });

  it("uses one readable semantic type scale", () => {
    expect(tokenStyles).toMatch(/--font-size-meta:\s*0\.6875rem;/);
    expect(tokenStyles).toMatch(/--font-size-body:\s*0\.75rem;/);
    expect(tokenStyles).toMatch(/--font-size-heading:\s*0\.9375rem;/);
    expect(tokenStyles).toMatch(/--font-size-title:\s*1\.25rem;/);
    expect(`${tokenStyles}\n${allStyles}`).not.toMatch(
      /--font-size-(?:micro|label|caption|chrome|brand|display)\b/,
    );
    expect(tokenStyles).not.toMatch(/font-size:\s*var\(--font-size-body\)/);
    expect(globalStyles).toMatch(/body\s*\{[^}]*font-size:\s*var\(--font-size-body\);/s);
    expect(globalStyles).toMatch(
      /\.table-status-trigger\s*\{[^}]*font-size:\s*var\(--font-size-body\);/s,
    );
    expect(globalStyles).toMatch(/text-size-adjust:\s*100%;/);
  });

  it("keeps every fact-grid item in one column with its own surface", () => {
    expect(`${globalStyles}\n${componentStyles}`).not.toMatch(
      /\.(?:fact-grid|rate-grid)\s*>[^{}]*\{[^}]*grid-column:/s,
    );
    expect(globalStyles).toMatch(
      /\.fact-grid\s*>\s*div\s*\{[^}]*border:\s*var\(--stroke-hairline\) solid var\(--color-border-subtle\);[^}]*background:\s*var\(--color-surface\);/s,
    );
    expect(globalStyles).toMatch(
      /\.fact-grid\s*>\s*div:nth-last-child\(2\):nth-child\(even\)\s*\{[^}]*border-end-end-radius:\s*var\(--list-surface-radius\);/s,
    );
  });

  it("declares every consumed custom property locally", () => {
    const declared = new Set(
      matches(/--[a-z0-9-]+\s*:/i, `${tokenStyles}\n${allStyles}`).map((value) =>
        value.slice(0, value.indexOf(":")).trim(),
      ),
    );
    const consumed = new Set(
      matches(/var\(--[a-z0-9-]+/i, `${tokenStyles}\n${allStyles}`).map((value) =>
        value.slice("var(".length),
      ),
    );

    expect([...consumed].filter((name) => !declared.has(name))).toEqual([]);
  });

  it("keeps shared token declarations out of component CSS", () => {
    const componentDeclarations = matches(/--[a-z0-9-]+\s*:/i, allStyles).map((value) =>
      value.slice(0, value.indexOf(":")).trim(),
    );

    expect(
      componentDeclarations.filter(
        (name) => !name.startsWith("--os-") && name !== "--status-color",
      ),
    ).toEqual([]);
  });

  it("keeps the previous ad hoc semantic aliases retired", () => {
    expect(allStyles).not.toMatch(
      /--(?:background|surface|text|border|accent|positive|warning|danger|header-height|toolbar-height)\b/,
    );
  });

  it("keeps native horizontal table overflow inside the viewport", () => {
    expect(globalStyles).toMatch(/\.catalog-section\s*\{[^}]*min-width:\s*0;/s);
    expect(globalStyles).toMatch(/\.table-scroll-host\s*\{[^}]*min-width:\s*0;/s);
    expect(globalStyles).toMatch(
      /\.table-shell\s*\{[^}]*width:\s*100%;[^}]*overflow-x:\s*auto;[^}]*overflow-y:\s*hidden;/s,
    );
  });

  it("keeps virtual row striping independent of rendered child position", () => {
    expect(globalStyles).not.toMatch(/\.model-row:nth-child\((?:odd|even)\)/);
    expect(globalStyles).toMatch(/\.model-row\[data-alternate="true"\]\s*>\s*td/);
    expect(matches(/:alternate="\(virtualRange\.start \+ index\) % 2 === 1"/, app)).toHaveLength(2);
    expect(modelRow).toMatch(/:data-alternate="alternate \? 'true' : undefined"/);
    expect(modelGroupRow).toMatch(/:data-alternate="alternate \? 'true' : undefined"/);
  });

  it("explains lifecycle and maturity from the Status table heading", () => {
    expect(app).toMatch(
      /<th class="status-col"[^>]*>[\s\S]*?<UiTooltip[\s\S]*?>[\s\S]*?Status[\s\S]*?<template #content>[\s\S]*?Lifecycle[\s\S]*?Maturity[\s\S]*?<\/template>[\s\S]*?<\/UiTooltip>/,
    );
    expect(matches(/class="status-badge" data-status="[^"]+"/, app)).toHaveLength(9);
    expect(matches(/class="table-header-tooltip-trigger"/, app)).toHaveLength(4);
  });

  it("keeps explanatory tooltip hit areas on their visible content", () => {
    expect(tooltip).toMatch(/class="ui-tooltip-trigger"/);
    expect(tooltip).toMatch(
      /span\.ui-tooltip-trigger\s*\{[^}]*display:\s*inline-block;[^}]*width:\s*fit-content;/s,
    );
  });

  it("prevents tooltip surfaces from passing clicks to obscured controls", () => {
    expect(tooltip).toMatch(/\.ui-tooltip\s*\{[^}]*pointer-events:\s*auto;/s);
  });

  it("keeps tooltip positioning CSS-owned", () => {
    expect(tooltip).not.toMatch(/getBoundingClientRect|ui-tooltip-anchor/);
    expect(tooltip).toMatch(/\.ui-tooltip\s*\{[^}]*position:\s*fixed;/s);
    expect(tooltip).toMatch(
      /position-try-fallbacks:\s*flip-block,\s*flip-inline,\s*flip-block flip-inline;/,
    );
  });

  it("dismisses tooltips when any scroll container moves", () => {
    expect(app).toMatch(/window\.addEventListener\("resize", dismissTooltips\)/);
    expect(app).toMatch(/window\.addEventListener\("scroll", dismissTooltips, true\)/);
    expect(app).toMatch(/window\.removeEventListener\("resize", dismissTooltips\)/);
    expect(app).toMatch(/window\.removeEventListener\("scroll", dismissTooltips, true\)/);
  });

  it("keeps custom scrollbar tokens stronger than the asynchronously loaded base theme", () => {
    expect(globalStyles).toMatch(/\.os-scrollbar\.kmodels-scrollbar\s*\{/);
    expect(globalStyles).not.toMatch(/(?<!\.os-scrollbar)\.kmodels-scrollbar\s*\{/);
  });

  it("keeps heading anchors outside the vertical table scroller", () => {
    expect(globalStyles).toMatch(
      /\.model-table\s*\{[^}]*display:\s*grid;[^}]*grid-template-rows:\s*var\(--layout-table-header-height\) minmax\(0, 1fr\);/s,
    );
    expect(globalStyles).toMatch(
      /\.model-table tbody\s*\{[^}]*min-height:\s*0;[^}]*overflow-x:\s*hidden;[^}]*overflow-y:\s*auto;/s,
    );
    expect(globalStyles).not.toMatch(/\.model-table th\s*\{[^}]*position:\s*sticky;/s);
    expect(app).toMatch(/<tbody ref="tableBody" @scroll\.passive="updateVirtualRange">/);
  });

  it("keeps coarse-pointer table scrolling touch-friendly", () => {
    expect(globalStyles).toMatch(/\.model-table tbody td\s*\{[^}]*touch-action:\s*pan-x pan-y;/s);
    expect(globalStyles).toMatch(
      /\.table-vertical-scrollbar-slot\s*\{[^}]*inset:\s*var\(--layout-table-header-height\)/s,
    );
    expect(globalStyles).toMatch(
      /\.table-vertical-scrollbar-slot\s*>\s*\.os-scrollbar-horizontal,[^{]*\.table-scroll-host\s*>\s*\.os-scrollbar-vertical\s*\{[^}]*display:\s*none;/s,
    );
  });
});
