import { markdownProse, markdownSection, markdownTableRows } from "./markdown.ts";
import type { CapabilityStatement } from "./model-capability-details.ts";
import type { ParsedProviderModel } from "./pricing-source.ts";
import { contractExtensionEvidence } from "./source-contract.ts";
import { addCapabilityDetailGroup, modelDocumentEvidence } from "./source-model-details.ts";
import type { SourceParseInput } from "./source-parse.ts";
import { yamlBlock } from "./yaml.ts";

export const anthropicEffortUrl = "https://platform.claude.com/docs/en/build-with-claude/effort.md";

interface Document {
  url: string;
  body: string;
}

interface Card {
  model: ParsedProviderModel;
  document: Document;
  prose: string;
}

const claim = "messages_reasoning_effort";
const messagesUsage =
  "Set `output_config.effort` on the request. With no value, the model’s default level applies.";

function frontmatter(body: string): string {
  return /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(body)?.[1] ?? "";
}

function signal(input: SourceParseInput, reason: string): void {
  input.onContractFinding?.(contractExtensionEvidence([`/capability_details/${claim}/${reason}`]));
}

function uniqueMatch(body: string, pattern: RegExp): RegExpMatchArray {
  const matches = [...body.matchAll(pattern)];
  const match = matches[0];
  if (matches.length !== 1 || match === undefined) throw new Error("Ambiguous effort declaration");
  return match;
}

function nativeNames(value: string): string[] {
  const names = value.split(/,\s+(?:and\s+|or\s+)?|\s+(?:and|or)\s+/);
  if (names.some((name) => !/^Claude [\w. -]+$/.test(name)) || new Set(names).size !== names.length)
    throw new Error("Invalid effort support cohort");
  return names;
}

function cardPath(url: string): string | undefined {
  const parsed = new URL(url);
  const path = parsed.pathname.replace(/\.md$/, "");
  if (
    parsed.origin === "https://platform.claude.com" &&
    !parsed.username &&
    !parsed.password &&
    !parsed.search &&
    !parsed.hash &&
    /^\/docs\/en\/models\/[a-z0-9-]+\/overview$/.test(path)
  )
    return path;
}

function messagesModels(prose: string) {
  const availability = markdownSection(prose, 2, "Availability") ?? "";
  const section =
    markdownSection(
      availability,
      4,
      "[Messages API](https://platform.claude.com/docs/en/build-with-claude/working-with-messages)",
    ) ?? "";
  if (
    !prose
      .split(/\r?\n/)
      .some(
        (line) => line.slice(2) === `**Messages API**: ${messagesUsage}` && /^[*-] /.test(line),
      ) ||
    !section
      .split(/\r?\n/)
      .some((line) => line.slice(2) === `Usage: ${messagesUsage}` && /^[*-] /.test(line))
  )
    throw new Error("Missing direct Messages effort scope");
  const rows = markdownTableRows(section, ["Status", "Cloud platforms", "Models"]);
  const row = rows[0];
  if (
    rows.length !== 1 ||
    row?.get("Status") !== "Available" ||
    row.get("Cloud platforms") !== "All supported platforms"
  )
    throw new Error("Messages effort availability changed");
  const models = new Map<string, { path?: string; excerpt: string }>();
  for (const cell of (row.get("Models") ?? "").split(/,\s+/)) {
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(cell);
    const name = link?.[1] ?? cell;
    const path = link?.[2] === undefined ? undefined : cardPath(link[2]);
    if (
      !/^Claude [\w. -]+$/.test(name) ||
      (link !== null && path === undefined) ||
      models.has(name)
    )
      throw new Error("Unrecognized Messages effort model");
    models.set(name, { ...(path === undefined ? {} : { path }), excerpt: cell });
  }
  return models;
}

function recommendationSections(prose: string): Map<string, string> {
  const section = markdownSection(prose, 2, "Recommended effort levels") ?? "";
  const headings = [
    ...section.matchAll(
      /^\*\*(\[[^\]\r\n]+\]\([^)\r\n]+\)(?: & \[[^\]\r\n]+\]\([^)\r\n]+\))*)\*\*(?: — [^\r\n]+)?\r?$/gm,
    ),
  ];
  const result = new Map<string, string>();
  for (const [index, heading] of headings.entries()) {
    for (const link of (heading[1] ?? "").matchAll(/\[([^\]]+)\]\([^)]+\)/g)) {
      const name = link[1];
      if (name === undefined || result.has(name))
        throw new Error("Duplicate effort recommendation");
      result.set(
        name,
        section.slice(heading.index + heading[0].length, headings[index + 1]?.index),
      );
    }
  }
  return result;
}

function effortContract(document: Document, ids: string[]) {
  const metadata = yamlBlock(frontmatter(document.body), "featureMetadata", 0);
  const platforms = metadata && yamlBlock(metadata, "supportedPlatforms", 2);
  if (uniqueMatch(platforms ?? "", /^    Claude API: (\S+)\r?$/gm)[1] !== "stable")
    throw new Error("Missing direct Claude API support");
  const prose = markdownProse(document.body);
  const messages = messagesModels(prose);
  const effort = markdownSection(prose, 2, "How effort works") ?? "";
  const section = markdownSection(effort, 3, "Effort levels") ?? "";
  const levels = new Map<string, { text: string; members?: string[] }>();
  for (const row of markdownTableRows(section, ["Level", "Description", "Typical use case"])) {
    const value = /^`([a-z][a-z0-9_-]*)`$/.exec(row.get("Level") ?? "")?.[1];
    const description = row.get("Description") ?? "";
    if (value === undefined || levels.has(value) || description === "")
      throw new Error("Invalid effort option row");
    const members = /\. Available on (.+)\.$/.exec(description)?.[1];
    levels.set(value, {
      text: description,
      ...(members === undefined ? {} : { members: nativeNames(members) }),
    });
  }
  const summarized = uniqueMatch(
    effort,
    /^Most Claude models default to ([a-z][a-z0-9_-]*) effort, [^;\n]+; (.+?) default to ([a-z][a-z0-9_-]*)\./gm,
  );
  const general = summarized[1] ?? "";
  const exception = summarized[3] ?? "";
  const exceptions = nativeNames(summarized[2] ?? "");
  const generalRow = levels.get(general)?.text ?? "";
  const exceptionRow = levels.get(exception)?.text ?? "";
  const excepted = /\. The default on every model that supports effort except (.+)\.$/.exec(
    generalRow,
  )?.[1];
  const named = /\. The default on (.+)\.$/.exec(exceptionRow)?.[1];
  const sameExceptions = (value: string | undefined) => {
    const names = value === undefined ? [] : nativeNames(value);
    return names.length === exceptions.length && names.every((name) => exceptions.includes(name));
  };
  const omission = uniqueMatch(
    effort,
    /Setting `effort` to the model’s default \(`"([^"]+)"` on (.+?), `"([^"]+)"` on other models\) produces exactly the same behavior as omitting the `effort` parameter entirely\./g,
  );
  if (
    general === exception ||
    !sameExceptions(excepted) ||
    !sameExceptions(named) ||
    omission[1] !== exception ||
    omission[3] !== general ||
    !sameExceptions(omission[2])
  )
    throw new Error("Contradictory effort default cohorts");
  // The general rows are low and the two explicit default rows. Other levels
  // require their own positive model list, never a family or version guess.
  if (
    !levels.has("low") ||
    [...levels].some(
      ([value, { members }]) =>
        members === undefined && !["low", general, exception].includes(value),
    )
  )
    throw new Error("Unowned effort option cohort");
  return {
    ids: new Set(ids),
    levels,
    messages,
    exceptions,
    general,
    exception,
    omission: omission[0],
    recommendations: recommendationSections(prose),
  };
}

function cardDefault(card: Card): string {
  const capabilities = markdownSection(card.prose, 3, "Capabilities") ?? "";
  const defaults = markdownTableRows(capabilities, ["Feature", "Value"]).filter(
    (row) =>
      row.get("Feature") ===
      "[Default effort](https://platform.claude.com/docs/en/build-with-claude/effort)",
  );
  const value = /^`([a-z][a-z0-9_-]*)`$/.exec(defaults[0]?.get("Value") ?? "")?.[1];
  if (defaults.length !== 1 || value === undefined) throw new Error("Ambiguous card default");
  return value;
}

function verifyRecommendation(
  title: string,
  options: string[],
  defaultValue: string,
  section: string,
): string[] {
  const defaults = [
    ...section.matchAll(
      /(?:API default is `([^\x60]+)`|`([^\x60]+)` is the default|defaults to `([^\x60]+)` effort|Start with `([^\x60]+)`, the default)/g,
    ),
  ];
  const allFive = section
    .split(/\r?\n/)
    .find((line) => line.startsWith(`${title} supports all five effort levels`));
  if (
    defaults.some((match) => (match[1] ?? match[2] ?? match[3] ?? match[4]) !== defaultValue) ||
    (allFive !== undefined && options.length !== 5)
  )
    throw new Error("Conflicting model-specific effort recommendation");
  return defaults.map((match) => match[0]);
}

export function applyAnthropicEffortDetails(
  input: SourceParseInput,
  cards: readonly Card[],
  document: Document | undefined,
  ids: string[] | undefined,
): void {
  if (document === undefined || ids === undefined) {
    signal(input, "guide");
    return;
  }
  try {
    const contract = effortContract(document, ids);
    const titles = cards.map((card) => {
      const names = [...frontmatter(card.prose).matchAll(/^title: "?([^"\r\n]+)"?\r?$/gm)];
      return { card, title: names.length === 1 ? names[0]?.[1] : undefined };
    });
    for (const { card, title } of titles) {
      if (
        !contract.ids.has(card.model.model_id) ||
        card.model.status === "retired" ||
        input.catalogModels?.some(
          ({ uid, status }) => uid === card.model.uid && status === "retired",
        )
      )
        continue;
      const direct = title === undefined ? undefined : contract.messages.get(title);
      if (
        title === undefined ||
        direct?.path === undefined ||
        direct.path !== cardPath(card.document.url) ||
        titles.filter((other) => other.title === title).length !== 1
      ) {
        signal(input, "identity");
        continue;
      }
      try {
        const listed = [...contract.levels].filter(
          ([, { members }]) => members?.includes(title) ?? true,
        );
        const values = listed.map(([value]) => value);
        const defaultValue = contract.exceptions.includes(title)
          ? contract.exception
          : contract.general;
        if (!values.includes(defaultValue) || cardDefault(card) !== defaultValue) {
          signal(input, "default");
          continue;
        }
        const recommendation = verifyRecommendation(
          title,
          values,
          defaultValue,
          contract.recommendations.get(title) ?? "",
        );
        const statement = {
          kind: "reasoning_effort",
          scope:
            "Direct Claude API Messages. Top-level effort with the model’s default thinking configuration.",
          supported_values: values,
          default_value: defaultValue,
        } satisfies CapabilityStatement;
        const cardExcerpt = card.prose
          .split(/\r?\n/)
          .filter((line) =>
            /^title: |^Model ID: |^\| Claude API\s*\||^\| \[Default effort\]/.test(line),
          )
          .map((line) => line.replace(/ {2,}/g, " "))
          .join("\n");
        const guideExcerpt = [
          messagesUsage,
          direct.excerpt,
          contract.omission,
          ...listed.map(([value, { text }]) => `${value} | ${text}`),
          ...recommendation,
        ].join("\n");
        addCapabilityDetailGroup(input, card.model, {
          claim,
          statements: [statement],
          evidence: [
            modelDocumentEvidence(
              input,
              card.document,
              "Title; Model IDs / Claude API; Capabilities / Default effort",
              cardExcerpt,
            ),
            modelDocumentEvidence(
              input,
              document,
              "Availability / Messages API; How effort works / Effort levels",
              guideExcerpt,
            ),
          ],
        });
      } catch {
        signal(input, "card");
      }
    }
  } catch {
    signal(input, "guide");
  }
}
