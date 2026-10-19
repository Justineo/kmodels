import { load } from "cheerio";
import { htmlText as text } from "./html.ts";
import { finalizePricingInputs } from "./pricing-input.ts";
import type { PricingReconciliationItem } from "./pricing-reconciliation.ts";
import type { SourcePricingInputFact } from "./pricing-source.ts";
import { contractExtensionEvidence, type SourceContractEvidence } from "./source-contract.ts";

interface Contract {
  key: string;
  field: string;
  locator: string;
  availability: SourcePricingInputFact["availability"];
  description: RegExp;
  absentValue?: "zero";
}

const contracts: readonly Contract[] = [
  usage("prompt_tokens", "input_tokens", /tokens? (?:from|in) the input prompts?/i),
  usage("completion_tokens", "output_tokens", /generated tokens/i),
  usage("reasoning_tokens", "reasoning_tokens", /thinking tokens/i, {
    availability: "conditional",
  }),
  usage(
    "cache_read_input_tokens",
    "claude.cache_read_tokens",
    /input tokens read from the prompt cache.*Databricks-hosted Claude endpoints.*caching is active/i,
    {
      availability: "conditional",
      absentValue: "zero",
    },
  ),
  usage(
    "cache_creation_input_tokens",
    "claude.cache_write_tokens",
    /input tokens written to the prompt cache.*Databricks-hosted Claude endpoints.*caching is active/i,
    { availability: "conditional", absentValue: "zero" },
  ),
];

export function extractDatabricksPricingInputs(
  body: string,
  sourceRef: string,
  onFinding?: (evidence: SourceContractEvidence) => void,
  onReconciliation?: (item: PricingReconciliationItem) => void,
): SourcePricingInputFact[] {
  const fields = documentedUsage(body);
  const facts = contracts.flatMap((contract) => {
    const declarations = fields.get(contract.field) ?? [];
    const first = declarations[0];
    const available =
      first !== undefined &&
      first.type === "integer" &&
      contract.description.test(first.description) &&
      declarations.every(
        ({ type, description }) => type === first.type && description === first.description,
      );
    if (!available) {
      onFinding?.(contractExtensionEvidence([`/documents/api-reference/${contract.field}`]));
      return [];
    }
    return [
      {
        key: contract.key,
        channel: "response" as const,
        locator: { kind: "json_pointer" as const, value: contract.locator },
        ...(contract.absentValue === undefined ? {} : { absent_value: contract.absentValue }),
        availability: contract.availability,
        source_ref: sourceRef,
      },
    ];
  });
  return finalizePricingInputs(
    facts,
    contracts.length,
    "Databricks pricing inputs",
    onReconciliation,
  );
}

function usage(
  field: string,
  key: string,
  description: RegExp,
  options: Pick<Contract, "absentValue" | "availability"> = {
    availability: "terminal_only",
  },
): Contract {
  return {
    key: `response.usage.${key}`,
    field,
    locator: `/usage/${field}`,
    availability: options.availability,
    description,
    ...(options.absentValue === undefined ? {} : { absentValue: options.absentValue }),
  };
}

function documentedUsage(body: string) {
  const $ = load(body);
  const mains = $("main");
  const result = new Map<string, Array<{ type: string; description: string }>>();
  if (mains.length !== 1) return result;
  const main = mains.clone();
  main.find("pre, blockquote, script, style, template").remove();
  const headings = "h1, h2, h3, h4, h5, h6";
  const usage = main.find("h2").filter((_, heading) => text($(heading).text()) === "Usage");
  const owner = usage.get(0);
  if (usage.length !== 1 || owner === undefined) return result;
  const prose: string[] = [];
  const elements = main.find(`${headings}, p, table`).toArray();
  for (const element of elements.slice(elements.indexOf(owner) + 1)) {
    const selection = $(element);
    if (selection.is(headings)) break;
    if (selection.is("p") && selection.parents("table").length === 0)
      prose.push(text(selection.text()));
    if (!selection.is("table") || selection.parents("table").length > 0) continue;
    const headers = selection
      .children("thead")
      .children("tr")
      .first()
      .children("th")
      .map((_index, cell) => text($(cell).text()))
      .get();
    if (headers.join("|") !== "Field|Type|Description") continue;
    selection
      .children("tbody")
      .children("tr")
      .each((_rowIndex, row) => {
        const cells = $(row).children("td");
        const field = text(cells.eq(0).text());
        if (field === "") return;
        const declaration =
          cells.length === 3
            ? {
                type: text(cells.eq(1).text()).toLowerCase(),
                description: text(cells.eq(2).text()),
              }
            : { type: "", description: "" };
        const current = result.get(field) ?? [];
        current.push(declaration);
        result.set(field, current);
      });
  }
  if (!/responses include a usage sub-message.*same across all task types/is.test(prose.join(" ")))
    result.clear();
  return result;
}
