import type { LinkedBundle } from "./bundle.ts";
import { markdownProse, markdownSection, markdownTableRows } from "./markdown.ts";
import type { ParsedProviderModel } from "./pricing-source.ts";
import type { SourceParseInput } from "./source-parse.ts";
import {
  addLimitDetailGroup,
  limitDetailFinding,
  modelDocumentEvidence,
} from "./source-model-details.ts";

const routes = new Map([
  ["/developers/rest-api-reference/inference/responses", "/v1/responses"],
  ["/developers/rest-api-reference/inference/chat-completions", "/v1/chat/completions"],
]);

export function applyXaiLimitDetails(
  input: SourceParseInput,
  models: readonly ParsedProviderModel[],
  bundle: LinkedBundle,
): void {
  const documents = bundle.documents.filter(({ url }) => url === "https://docs.x.ai/llms-full.txt");
  const document = documents[0];
  if (documents.length !== 1 || !document) return;
  const prose = markdownProse(document.body);
  const markers = [...prose.matchAll(/^===([^=\r\n]+)===$/gm)];
  const candidates = new Map<
    ParsedProviderModel,
    { path: string; table: string; values: Map<string, string>[]; description?: string }[]
  >();
  for (const [index, marker] of markers.entries()) {
    const path = marker[1];
    if (!path) continue;
    const section = prose.slice(marker.index + marker[0].length, markers[index + 1]?.index);
    const table = markdownSection(section, 2, "At a glance");
    if (!table) continue;
    try {
      const values = markdownTableRows(table, ["Property", "Value"]);
      const names = values.filter((row) => row.get("Property") === "Model name");
      const id = /^`([^`]+)`$/.exec(names[0]?.get("Value") ?? "")?.[1];
      if (names.length !== 1 || !id) continue;
      const matches = models.filter((model) => model.model_id === id || model.aliases.includes(id));
      const model = matches[0];
      if (matches.length !== 1 || !model) {
        limitDetailFinding(input, "card_limits/identity");
        continue;
      }
      const headings = [...section.matchAll(/^# ([^\n]+)\n\s*\n([^\n]+)(?=\n|$)/gm)];
      const heading = headings[0];
      const summary = heading?.[2]?.trim();
      const description =
        id === model.model_id &&
        headings.length === 1 &&
        heading?.[1]?.trim() === model.name &&
        summary?.startsWith(model.name + " is ") &&
        summary.length <= 1024
          ? summary
          : undefined;
      candidates.set(model, [
        ...(candidates.get(model) ?? []),
        { path, table, values, ...(description ? { description } : {}) },
      ]);
    } catch {
      limitDetailFinding(input, "card_limits/table");
    }
  }
  for (const [model, entries] of candidates) {
    const entry = entries[0];
    if (entries.length !== 1 || !entry) {
      limitDetailFinding(input, "card_limits/duplicate");
      continue;
    }
    if (!model.description && entry.description) model.description = entry.description;
    const outputs = entry.values.filter((row) => row.get("Property") === "Output limit");
    const apis = entry.values.filter((row) => row.get("Property") === "APIs");
    if (outputs.length === 0) continue;
    if (
      outputs.length !== 1 ||
      outputs[0]?.get("Value") !== "No text output limit" ||
      apis.length !== 1
    ) {
      limitDetailFinding(input, "card_limits/scope");
      continue;
    }
    const links = [...(apis[0]?.get("Value") ?? "").matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)];
    const endpoints = links.flatMap((link) => {
      const href = link[2];
      if (!href || !URL.canParse(href, document.url)) return [];
      const url = new URL(href, document.url);
      const path = url.origin === "https://docs.x.ai" ? routes.get(url.pathname) : undefined;
      return path ? [{ name: link[1] ?? path, path }] : [];
    });
    if (links.length === 0 || endpoints.length !== links.length) {
      limitDetailFinding(input, "card_limits/api");
      continue;
    }
    addLimitDetailGroup(input, model, {
      claim: "card_limits",
      statements: endpoints.map(({ name, path }) => ({
        quantity: "text_output_tokens",
        kind: "no_separate_cap",
        measurement: "per_response",
        applicability: { endpoint: path },
        scope: `${name} (${path}): no separate provider text-output cap. Context remains independently bounded; this does not guarantee arbitrary output length or an unbounded reasoning/function-call budget.`,
      })),
      evidence: [
        modelDocumentEvidence(
          input,
          bundle.index,
          "Embedded public model name and aliases",
          model.model_id,
        ),
        modelDocumentEvidence(
          input,
          document,
          `${entry.path}; At a glance / Model name, Output limit, APIs`,
          entry.table
            .split(/\r?\n/)
            .filter((line) => /^\|\s*(?:Model name|Output limit|APIs)\s*\|/.test(line))
            .join("\n"),
        ),
      ],
    });
  }
  const notesIndex = markers.findIndex((m) => m[1] === "/developers/release-notes");
  const notes = markers[notesIndex];
  if (!notes) return;
  const releaseNotes = prose.slice(notes.index + notes[0].length, markers[notesIndex + 1]?.index);
  for (const model of models) {
    if (
      candidates.has(model) ||
      !/^grok-\d+\.\d+$/.test(model.model_id) ||
      model.limits.max_output_tokens !== undefined
    )
      continue;
    const title = "Grok " + model.model_id.slice("grok-".length);
    const announcement = markdownSection(releaseNotes, 3, title)?.trim();
    if (
      !announcement?.startsWith(title + ",") ||
      !announcement.includes("is now available on the xAI API.") ||
      !announcement.includes(
        "text and image inputs with text-only output, and no text output limit.",
      ) ||
      !announcement.includes(
        `[${title} overview](/developers/${model.model_id.replaceAll(".", "-")})`,
      )
    )
      continue;
    addLimitDetailGroup(input, model, {
      claim: "launch_output_limit",
      statements: [
        {
          quantity: "text_output_tokens",
          kind: "no_separate_cap",
          measurement: "per_response",
          scope: "xAI API text output at model launch; the context window remains bounded.",
        },
      ],
      evidence: [
        modelDocumentEvidence(input, document, "/developers/release-notes; " + title, announcement),
      ],
    });
  }
}
