import { markdownProse } from "./markdown.ts";
import type { OpenAiModelCard } from "./openai-model-ids.ts";
import {
  addCapabilityDetailGroup,
  capabilityDetailFinding,
  modelDocumentEvidence,
} from "./source-model-details.ts";
import type { SourceParseInput } from "./source-parse.ts";

const responseEffort = { interface: "OpenAI Responses API", parameter: "reasoning.effort" };
const chatEffort = { interface: "OpenAI Chat Completions API", parameter: "reasoning_effort" };

function effortScope({ interface: api, parameter }: typeof responseEffort): string {
  return `${api} (${parameter})`;
}

/** The dotted Responses parameter and the underscored Chat parameter have separate API scopes. */
export function addOpenAiEffort(
  input: SourceParseInput,
  { model, document }: OpenAiModelCard,
): void {
  const intro = markdownProse(document.body).split(/^## /m, 1)[0] ?? "";
  const rejections = [
    ...intro.matchAll(
      /^The API rejects requests that set reasoning effort to `([a-z][a-z0-9_-]*)`\.$/gim,
    ),
  ];
  const unsupported = rejections.flatMap((match) => match[1] ?? []);
  if (unsupported.length) {
    const statements = (model.api_endpoints ?? []).flatMap(({ path }) => {
      const applicability =
        path === "v1/responses"
          ? responseEffort
          : path === "v1/chat/completions"
            ? chatEffort
            : undefined;
      return applicability
        ? [
            {
              kind: "reasoning_effort" as const,
              scope: effortScope(applicability),
              applicability,
              unsupported_values: unsupported,
            },
          ]
        : [];
    });
    if (statements.length)
      addCapabilityDetailGroup(input, model, {
        claim: "api_effort_exclusions",
        statements,
        evidence: [
          modelDocumentEvidence(
            input,
            document,
            "Model ID, unconditional API effort rejection and Endpoints table",
            rejections.map((match) => match[0]).join("\n"),
          ),
        ],
      });
  }
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
    !model.api_endpoints?.some(({ path }) => path === "v1/responses")
  ) {
    capabilityDetailFinding(input, "responses_effort");
    return;
  }
  addCapabilityDetailGroup(input, model, {
    claim: "responses_effort",
    statements: [
      {
        kind: "reasoning_effort",
        scope: effortScope(responseEffort),
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
