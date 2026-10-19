import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vite-plus/test";
import { extractDatabricksPricingInputs } from "../src/catalog/databricks-accounting.ts";
import type { SourceContractEvidence } from "../src/catalog/source-contract.ts";

const native = await readFile(
  new URL("./fixtures/databricks/api-reference.html", import.meta.url),
  "utf8",
);
const prompt = native.match(/<tr>\s*<td>prompt_tokens<\/td>[\s\S]*?<\/tr>/)?.[0];
const intro = native.match(/<p>\s*Responses include[\s\S]*?<\/p>/)?.[0];
const table = native.match(/<table>[\s\S]*?<\/table>/)?.[0];
if (prompt === undefined || intro === undefined || table === undefined)
  throw new Error("Missing native Usage fixture");
const header = "<thead><tr><th>Field</th><th>Type</th><th>Description</th></tr></thead>";
const promptTable = `<table>${header}<tbody>${prompt}</tbody></table>`;

describe("Databricks Usage accounting ownership", () => {
  it.each([
    ["type", native.replace(prompt, prompt.replace("Integer", "String")), 4],
    ["conflict", native.replace(prompt, `${prompt}${prompt.replace("Integer", "String")}`), 4],
    [
      "nested",
      native.replace(prompt, `<tr><td>nested</td><td>Object</td><td>${promptTable}</td></tr>`),
      4,
    ],
    [
      "quoted",
      native.replace(
        prompt,
        `<tr><td>note</td><td>String</td><td><blockquote>${promptTable}</blockquote></td></tr>`,
      ),
      4,
    ],
    [
      "subsection",
      native
        .replace(prompt, "")
        .replace("</main>", `<div><h3>Request</h3>${promptTable}</div></main>`),
      4,
    ],
    ["heading", native.replace("<h2>Usage</h2>", "<h2>Request</h2>"), 0],
    ["intro", native.replace(intro, "").replace("<main>", `<main>${intro}`), 0],
    ["duplicate", native.replace("</main>", `<h2>Usage</h2>${intro}${table}</main>`), 0],
  ] as const)("withholds unproven counters locally: %s", (_shape, body, validCount) => {
    const findings: SourceContractEvidence[] = [];
    const inputs = extractDatabricksPricingInputs(body, "databricks-models", (finding) =>
      findings.push(finding),
    );
    expect(inputs.some(({ key }) => key === "response.usage.input_tokens")).toBe(false);
    expect(inputs).toHaveLength(validCount);
    expect(findings).toHaveLength(5 - validCount);
  });

  it("accepts native wrapped tables and consistent expanded-view copies", () => {
    const body = native
      .replace(
        "<h2>Usage</h2>",
        '<h2 id="usage"><a id="usage"></a>Usage<a href="#usage">\u200b</a></h2>',
      )
      .replace(
        table,
        `<div class="scrollable-table-wrapper"><div>${table}</div><dialog><div>${table}</div></dialog></div>`,
      );
    const findings: SourceContractEvidence[] = [];
    expect(
      extractDatabricksPricingInputs(body, "databricks-models", (finding) =>
        findings.push(finding),
      ),
    ).toEqual(extractDatabricksPricingInputs(native, "databricks-models"));
    expect(findings).toEqual([]);
  });
});
