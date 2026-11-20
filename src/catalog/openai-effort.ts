import { markdownProse } from "./markdown.ts";
import type { OpenAiModelCard } from "./openai-model-ids.ts";
import {
  addCapabilityDetailGroup,
  capabilityDetailFinding,
  modelDocumentEvidence,
} from "./source-model-details.ts";
import type { SourceParseInput } from "./source-parse.ts";

const responsesPath = "v1/responses";
const responseEffort = {
  interface: "OpenAI Responses API",
  parameter: "reasoning.effort",
  endpoint: responsesPath,
};

export function addOpenAiEffort(
  input: SourceParseInput,
  { model, document }: OpenAiModelCard,
): void {
  const intro = markdownProse(document.body).split(/^## /m, 1)[0] ?? "";
  const declarations = [
    ...intro.matchAll(/(?:^|[.!?]\s+|\n)(reasoning\.effort supports: ([^\n]+))$/gim),
  ];
  if (declarations.length === 0) return;
  const declaration = declarations[0];
  const list = declaration?.[2]?.match(/^([\w ,()-]+)\.$/)?.[1];
  const values = list
    ?.split(/,\s*(?:and\s+)?|\s+and\s+/)
    .map((entry) => /^([a-z][a-z0-9_-]*)( \(default\))?$/i.exec(entry.trim()));
  const supported = values?.flatMap((entry) => entry?.[1] ?? []) ?? [];
  const defaults = values?.flatMap((entry) => (entry?.[2] && entry[1] ? [entry[1]] : [])) ?? [];
  if (
    declarations.length !== 1 ||
    !declaration?.[1] ||
    !values?.length ||
    supported.length !== values.length ||
    defaults.length > 1 ||
    !model.api_endpoints?.some(({ path }) => path === responsesPath)
  ) {
    capabilityDetailFinding(input, "responses_effort");
    return;
  }
  addCapabilityDetailGroup(input, model, {
    claim: "responses_effort",
    statements: [
      {
        kind: "reasoning_effort",
        scope: `${responseEffort.interface} (${responseEffort.parameter})`,
        applicability: responseEffort,
        supported_values: supported,
        ...(defaults[0] === undefined ? {} : { default_value: defaults[0] }),
      },
    ],
    evidence: [
      modelDocumentEvidence(
        input,
        document,
        "Model ID, introductory effort declaration and Endpoints table",
        declaration[1],
      ),
    ],
  });
}
