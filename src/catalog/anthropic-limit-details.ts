import type { LinkedBundle } from "./bundle.ts";
import { markdownProse, markdownSection, markdownTableRows } from "./markdown.ts";
import type { ParsedProviderModel } from "./pricing-source.ts";
import type { SourceParseInput } from "./source-parse.ts";
import {
  addLimitDetailGroup,
  limitDetailFinding,
  modelDocumentEvidence,
  limitTokenCount,
} from "./source-model-details.ts";

interface Card {
  model: ParsedProviderModel;
  document: { url: string; body: string };
  prose: string;
}

function title(body: string): string | undefined {
  const values = [...body.matchAll(/^title: ([^\r\n]+)$/gm)].map((m) =>
    m[1]?.replace(/^"(.*)"$/, "$1"),
  );
  return values.length === 1 ? values[0] : undefined;
}

function outputRows(body: string, label: string): string[] {
  const section = markdownSection(markdownProse(body), 3, "Capabilities");
  if (!section) return [];
  return markdownTableRows(section, ["Feature", "Value"])
    .filter((row) => row.get("Feature") === label)
    .flatMap((row) => row.get("Value") ?? []);
}
function identityExcerpt(card: Card): string {
  return card.prose
    .split(/\r?\n/)
    .filter((line) => /^title: |^Model ID: |^\| Claude API\s*\|/.test(line))
    .join("\n");
}

export function applyAnthropicLimitDetails(
  input: SourceParseInput,
  cards: readonly Card[],
  bundle: LinkedBundle,
  batchEndpoint: string,
): void {
  for (const card of cards) {
    const { model, document, prose: body } = card;
    try {
      const rows = outputRows(body, "Max output");
      const tokens = rows.length === 1 ? limitTokenCount(rows[0] ?? "") : undefined;
      const caption = body.match(/^[*-] \*\*Max output:\*\* Synchronous Messages API limit\./gm);
      if (tokens === undefined || caption?.length !== 1) {
        limitDetailFinding(input, "card_limits");
        continue;
      }
      addLimitDetailGroup(input, model, {
        claim: "card_limits",
        statements: [
          {
            quantity: "output_tokens",
            kind: "maximum",
            tokens,
            measurement: "per_response",
            scope:
              "Claude API synchronous Messages API max_tokens ceiling per generated response; the separately qualified Message Batches beta does not replace it.",
          },
        ],
        evidence: [
          modelDocumentEvidence(
            input,
            document,
            "Model ID; Specifications / Model IDs / Claude API; Capabilities / Max output; Max output caption",
            `${identityExcerpt(card)}\n${body.split(/\r?\n/).find((line) => /^\| Max output\s*\|/.test(line)) ?? ""}\n${caption[0]}`,
          ),
        ],
      });
    } catch {
      limitDetailFinding(input, "card_limits");
    }
  }

  const guides = bundle.documents.filter(
    ({ url }) =>
      url === "https://platform.claude.com/docs/en/build-with-claude/batch-processing.md",
  );
  if (guides.length === 0) return;
  const document = guides[0];
  if (guides.length !== 1 || !document) {
    limitDetailFinding(input, "batch_output_beta");
    return;
  }
  const section = markdownSection(markdownProse(document.body), 3, "Extended output (beta)");
  const declarations = [
    ...(section ?? "").matchAll(
      /^The `([^`]+)` beta header raises the `max_tokens` cap to ([\d,]+) for batch requests using (.+?)\. Include the header to generate outputs far longer than the standard ([\d.]+[kKmM]?) `max_tokens` limit in a single turn\.$/gm,
    ),
  ];
  const declaration = declarations[0];
  const header = declaration?.[1];
  const tokens = limitTokenCount(declaration?.[2] ?? "");
  const standard = limitTokenCount(declaration?.[4] ?? "");
  const names = declaration?.[3]?.split(/,\s+(?:or\s+)?|\s+or\s+/);
  const scope = section?.match(
    /^ {0,3}Extended output is available on the Message Batches API only, not the synchronous Messages API\.(?: It is available on the Claude API and Claude Platform on AWS\.)?$/gm,
  );
  if (
    declarations.length !== 1 ||
    !header ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(header) ||
    tokens === undefined ||
    standard === undefined ||
    !names?.length ||
    names.some((n) => !n.trim()) ||
    new Set(names).size !== names.length ||
    scope?.length !== 1
  ) {
    limitDetailFinding(input, "batch_output_beta");
    return;
  }
  for (const name of names) {
    const matches = cards.filter((card) => title(card.prose) === name);
    const card = matches[0];
    if (matches.length !== 1 || !card) {
      limitDetailFinding(input, "batch_output_beta/identity");
      continue;
    }
    try {
      const captions = card.prose.match(/^[*-] \*\*Max output:\*\*[^\r\n]+/gm) ?? [];
      const footnotes = captions.filter((caption) =>
        caption.includes("On the Message Batches API,"),
      );
      if (footnotes.length > 0) {
        const footnote = footnotes[0];
        const beta =
          footnote === undefined
            ? undefined
            : /On the Message Batches API, (.+?) support up to ([\d.]+[kKmM]?) output tokens with the ([A-Za-z0-9][A-Za-z0-9._-]*) beta header\.$/.exec(
                footnote,
              );
        const footnoteNames = beta?.[1]?.split(/,\s+(?:(?:or|and)\s+)?|\s+(?:or|and)\s+/);
        if (
          footnotes.length !== 1 ||
          !beta ||
          !footnoteNames ||
          new Set(footnoteNames).size !== footnoteNames.length ||
          footnoteNames.filter((candidate) => candidate === name).length !== 1 ||
          footnoteNames.some((candidate) => !names.includes(candidate)) ||
          limitTokenCount(beta[2] ?? "") !== tokens ||
          beta[3] !== header
        ) {
          limitDetailFinding(input, "batch_output_beta/footnote");
          continue;
        }
      }
      const betaRows = outputRows(
        card.prose,
        "[Max output (Batch API, beta)](https://platform.claude.com/docs/en/build-with-claude/batch-processing#extended-output-beta)",
      );
      if (betaRows.length > 1 || betaRows.some((row) => limitTokenCount(row) !== tokens)) {
        limitDetailFinding(input, "batch_output_beta/conflict");
        continue;
      }
      const betaHeader = { name: "anthropic-beta", value: header };
      addLimitDetailGroup(input, card.model, {
        claim: "batch_output_beta",
        statements: [
          {
            quantity: "output_tokens",
            kind: "maximum",
            tokens,
            measurement: "per_response",
            applicability: {
              endpoint: batchEndpoint,
              beta_header: { ...betaHeader, present: true },
            },
            scope: `Claude API Message Batches only; requires anthropic-beta: ${header}. max_tokens ceiling per generated turn; excludes synchronous Messages.`,
          },
          {
            quantity: "output_tokens",
            kind: "maximum",
            tokens: standard,
            measurement: "per_response",
            applicability: {
              endpoint: batchEndpoint,
              beta_header: { ...betaHeader, present: false },
            },
            scope: `Claude API standard Message Batches max_tokens ceiling per generated turn without the ${header} extended-output beta.`,
          },
        ],
        evidence: [
          modelDocumentEvidence(
            input,
            card.document,
            "Native title; Model ID; Specifications / Model IDs / Claude API",
            identityExcerpt(card),
          ),
          modelDocumentEvidence(
            input,
            document,
            "Extended output (beta)",
            `${declaration[0]}\n${scope[0]}`,
          ),
        ],
      });
    } catch {
      limitDetailFinding(input, "batch_output_beta");
    }
  }
}
