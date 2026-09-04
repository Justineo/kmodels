import { load } from "cheerio";
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
  const $ = load(body);
  const fields = documentedFields($);
  const commonUsage = /responses include a usage sub-message.*same across all task types/is.test(
    text($("main").text()),
  );
  const facts = contracts.flatMap((contract) => {
    const descriptions = fields.get(contract.field) ?? [];
    const available =
      commonUsage && descriptions.some((description) => contract.description.test(description));
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

function documentedFields($: ReturnType<typeof load>): ReadonlyMap<string, string[]> {
  const result = new Map<string, string[]>();
  $("main table").each((_tableIndex, table) => {
    const headers = $(table)
      .find("thead th")
      .map((_index, cell) => text($(cell).text()))
      .get();
    if (headers.join("|") !== "Field|Type|Description") return;
    $(table)
      .find("tbody tr")
      .each((_rowIndex, row) => {
        const cells = $(row).children("td");
        const field = text(cells.eq(0).text());
        const description = text(cells.eq(2).text());
        if (field === "" || description === "") return;
        const current = result.get(field);
        if (current === undefined) result.set(field, [description]);
        else current.push(description);
      });
  });
  return result;
}

function text(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}
