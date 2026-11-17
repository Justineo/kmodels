import { markdownProse } from "./markdown.ts";
import type { OpenAiModelCard } from "./openai-model-ids.ts";
import {
  addCapabilityDetailGroup,
  capabilityDetailFinding,
  capabilityDocumentEvidence,
} from "./source-capability-details.ts";
import type { SourceParseInput } from "./source-parse.ts";

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
  const rejected = rejections[0];
  if (rejections.length && rejected?.[1]) {
    const statements = (model.api_endpoints ?? []).flatMap(({ path }) => {
      const scope =
        path === "v1/responses"
          ? "OpenAI Responses API (reasoning.effort)"
          : path === "v1/chat/completions"
            ? "OpenAI Chat Completions API (reasoning_effort)"
            : undefined;
      return scope
        ? [
            {
              kind: "reasoning_effort" as const,
              scope,
              unsupported_values: rejections.flatMap((match) => match[1] ?? []),
            },
          ]
        : [];
    });
    if (statements.length)
      addCapabilityDetailGroup(input, model, {
        claim: "api_effort_exclusions",
        statements,
        evidence: [
          capabilityDocumentEvidence(
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
        scope: "OpenAI Responses API (reasoning.effort)",
        supported_values: supported,
        ...(defaults[0] === undefined ? {} : { default_value: defaults[0] }),
      },
    ],
    evidence: [
      capabilityDocumentEvidence(
        input,
        document,
        "Model ID, introductory effort declaration and Endpoints table",
        declaration[1],
      ),
    ],
  });
}
