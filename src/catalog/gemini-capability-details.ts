import type { LinkedBundle } from "./bundle.ts";
import { modelIdSchema } from "./identity.ts";
import { markdownProse, markdownSection, markdownTableRows } from "./markdown.ts";
import type { CapabilityStatement } from "./model-capability-details.ts";
import type { ParsedProviderModel } from "./pricing-source.ts";
import {
  addCapabilityDetailGroup,
  capabilityDetailFinding,
  modelDocumentEvidence,
} from "./source-model-details.ts";
import type { SourceParseInput } from "./source-parse.ts";

type Document = LinkedBundle["index"];
export interface GeminiCapabilityPage {
  model: ParsedProviderModel;
  document: Document;
}
type Markup = (body: string) => string | undefined;
const apis = [
  { scope: "Gemini Interactions API", key: "interactions", query: "" },
  {
    scope: "Gemini GenerateContent API",
    key: "generate_content",
    query: "?generate-content=true",
  },
] as const;

function scopedMarkdown(body: string): string {
  return body.replace(/[ \t]+\{% id="[^"]+" %\}(?=\r?$)/gm, "");
}

function requiredSection(body: string, depth: number, heading: string): string {
  const section = markdownSection(scopedMarkdown(body), depth, heading);
  if (section === undefined) throw new Error("Missing or repeated Gemini guide section");
  return section;
}

function declaration(body: string, pattern: RegExp): string {
  const matches = [...body.matchAll(pattern)];
  if (matches.length !== 1 || !matches[0]) throw new Error("Expected one Gemini declaration");
  return matches[0][0];
}

function pageProse(page: GeminiCapabilityPage, markdown: Markup): string {
  return markdownProse(markdown(page.document.body) ?? "");
}

function callable(page: GeminiCapabilityPage, markdown: Markup, indexProse: string): boolean {
  const { status, replacement_model_ids: replacements, tasks } = page.model;
  const redirects = [pageProse(page, markdown), indexProse].some((body) =>
    [
      ...body.matchAll(
        /\b(?:requests?|calls?)\s+to\s+\x60([a-z0-9._-]+)\x60\s+(?:are|will)\s+automatically rout(?:ed|e)\b/gi,
      ),
    ].some((match) => match[1] === page.model.model_id),
  );
  return (
    status !== "retired" &&
    status !== "legacy" &&
    !(status === "deprecated" && replacements.length > 0) &&
    !redirects &&
    tasks.some((task) => task === "text_generation" || task === "image_generation")
  );
}

function matchingPages<T>(
  pages: readonly GeminiCapabilityPage[],
  facts: ReadonlyMap<string, T>,
  key: (model: ParsedProviderModel) => string,
): [GeminiCapabilityPage, T][] {
  return pages.flatMap((page) => {
    const value = key(page.model);
    const fact = facts.get(value);
    return fact !== undefined && pages.filter(({ model }) => key(model) === value).length === 1
      ? [[page, fact]]
      : [];
  });
}

function tableMap<T>(rows: [string, T][]): Map<string, T> {
  const map = new Map(rows);
  if (map.size !== rows.length || !map.size || map.has(""))
    throw new Error("Duplicate or missing Gemini guide identity");
  return map;
}

function cacheModes(
  input: SourceParseInput,
  document: Document,
  body: string,
  pages: readonly GeminiCapabilityPage[],
  markdown: Markup,
  api: (typeof apis)[number],
  claim: string,
): void {
  const prose = markdownProse(body);
  const section = requiredSection(prose, 2, "Implicit caching");
  const enabled = declaration(
    section,
    /^Implicit caching is enabled by default for all Gemini \d+(?:\.\d+)? and newer models\./gm,
  );
  const rows = markdownTableRows(section, ["Model", "Min token limit"]);
  const namedModels = tableMap(
    rows.map((row) => [row.get("Model") ?? "", row.get("Min token limit") ?? ""]),
  );
  // The guide's table identifies the model; the token thresholds are not part of this contract.
  if (
    [...namedModels.values()].some((cell) => !/^[\d,]+$/.test(cell)) ||
    [...section.matchAll(/^\|\s*Model\s*\|\s*Min token limit\s*\|/gm)].length !== 1
  )
    throw new Error("Malformed Gemini cache model table");
  const intro = prose.slice(0, prose.indexOf("## Implicit caching"));
  const apiScope =
    api.key === "interactions"
      ? declaration(
          intro,
          /The \*\*Interactions API\*\* only supports implicit caching\. Explicit caching\s+\(manually creating and managing cache objects\) is not supported in the\s+Interactions API/g,
        )
      : declaration(
          requiredSection(prose, 2, "Explicit caching"),
          /Explicit context caching is currently in Beta\. Endpoints and SDK methods are\s+available under \x60v1beta\x60\./g,
        );
  const explicit = new Map<string, string>();
  if (api.key === "generate_content") {
    const example = requiredSection(body, 3, "Generate content using a cache");
    for (const block of example.matchAll(
      /^[ \t]*\x60{3}shell\r?\n([\s\S]*?)^[ \t]*\x60{3}[ \t]*$/gm,
    )) {
      const commands = block[1] ?? "";
      if (!commands.includes("https://generativelanguage.googleapis.com/v1beta/cachedContents?"))
        continue;
      const models = [...commands.matchAll(/"model": "models\/([^"]+)"/g)];
      const uses = [
        ...commands.matchAll(
          /https:\/\/generativelanguage.googleapis.com\/v1beta\/models\/([^:/?]+):generateContent/g,
        ),
      ];
      const id = models[0]?.[1];
      if (
        models.length !== 1 ||
        uses.length !== 1 ||
        !id ||
        id !== uses[0]?.[1] ||
        !commands.includes('"cachedContent":')
      )
        throw new Error("Unbound GenerateContent cache workflow");
      explicit.set(
        id,
        [models[0]?.[0], "/v1beta/cachedContents", uses[0]?.[0], '"cachedContent":'].join("\n"),
      );
    }
  }
  for (const [page, minimum] of matchingPages(pages, namedModels, (model) => model.name)) {
    const id = page.model.model_id;
    const statements: CapabilityStatement[] = [
      {
        kind: "prompt_cache",
        mode: "implicit",
        supported: true,
        scope: api.scope + ". Enabled by default.",
      },
    ];
    const excerpt = [apiScope, enabled, `| ${page.model.name} | ${minimum} |`];
    const pageBody = pageProse(page, markdown);
    const titles = [...pageBody.matchAll(/^# ([^\r\n]+)$/gm)];
    if (titles.length !== 1 || titles[0]?.[1] !== page.model.name) continue;
    const ownMode = pageBody.match(
      /\[\*\*Context caching\*\*\]\(\/docs\/caching\)\s+\{% badge label=Supported \(Implicit only\) type="supported" \/%\}\s+Note: Explicit caching is not supported\./g,
    );
    const positive = explicit.get(id);
    if ((ownMode?.length ?? 0) > 1 || (ownMode?.length === 1 && positive !== undefined)) {
      capabilityDetailFinding(input, claim);
      continue;
    }
    if (api.key === "interactions" || ownMode?.length === 1)
      statements.push({
        kind: "prompt_cache",
        mode: "explicit",
        supported: false,
        scope: api.scope + ". Creating and managing cache objects is unavailable.",
      });
    else if (positive !== undefined) {
      statements.push({
        kind: "prompt_cache",
        mode: "explicit",
        supported: true,
        scope: api.scope + ". Create and reference a cache object through the v1beta API.",
      });
      excerpt.push(positive);
    }
    addCapabilityDetailGroup(input, page.model, {
      claim,
      statements,
      evidence: [
        modelDocumentEvidence(
          input,
          document,
          "Implicit caching and API cache mode",
          excerpt.join("\n"),
        ),
        modelDocumentEvidence(
          input,
          page.document,
          "Model code; model title and Context caching",
          [id, page.model.name, ownMode?.[0]].filter(Boolean).join("\n"),
        ),
      ],
    });
  }
}

function generateThinkingRows(section: string): [string, string, string][] {
  const table = declaration(section, /^\{% table %\}\r?\n[\s\S]+?^\{% \/table %\}/gm);
  const parts = table
    .split(/^[ \t]+---[ \t]*\r?$/m)
    .map((row) => [...row.matchAll(/^[ \t]+\* (.+?)\s*$/gm)].map((match) => match[1]));
  const [headers, ...rows] = parts;
  if (headers?.join("|") !== "Model|Default thinking|Levels supported")
    throw new Error("GenerateContent thinking table headers changed");
  return rows.map((row) => {
    const [id, state, options] = row;
    if (row.length !== 3 || !id || !state || !options)
      throw new Error("Malformed GenerateContent thinking row");
    return [id, state, options];
  });
}

function thinkingLevels(
  input: SourceParseInput,
  document: Document,
  body: string,
  pages: readonly GeminiCapabilityPage[],
  markdown: Markup,
  api: (typeof apis)[number],
  claim: string,
): void {
  const prose = markdownProse(body);
  const interactions = api.key === "interactions";
  const section = interactions
    ? requiredSection(prose, 2, "Controlling thinking")
    : requiredSection(prose, 3, "Thinking levels (Gemini 4 and Gemini 3)");
  const table = interactions
    ? markdownTableRows(section, ["Model", "Default Thinking", "Levels Supported"]).map(
        (row): [string, string, string] => [
          row.get("Model") ?? "",
          row.get("Default Thinking") ?? "",
          row.get("Levels Supported") ?? "",
        ],
      )
    : generateThinkingRows(section);
  const parameter = interactions ? "thinking_level" : "thinkingLevel";
  if (
    !section.includes("\x60" + parameter + "\x60 parameter") ||
    (interactions && !/^Interactions API surfaces this reasoning\b/m.test(prose)) ||
    (!interactions && !/^## Generating content with thinking\b/m.test(prose)) ||
    (interactions &&
      [...section.matchAll(/^\|\s*Model\s*\|\s*Default Thinking\s*\|\s*Levels Supported\s*\|/gm)]
        .length !== 1)
  )
    throw new Error("Unproven Gemini thinking API branch");
  const facts = tableMap(
    table.map(([id, state, options]) => {
      const values = options.split(/,\s*/);
      const mode = /^(On|Off)(?: \(([a-z][a-z0-9_-]*)\))?$/.exec(state);
      if (
        !modelIdSchema.safeParse(id).success ||
        !mode ||
        values.some((value) => !/^[a-z][a-z0-9_-]*$/.test(value)) ||
        new Set(values).size !== values.length ||
        (mode[2] !== undefined && !values.includes(mode[2]))
      )
        throw new Error("Malformed Gemini thinking row");
      return [id, { state, options, values, enabled: mode[1] === "On", defaultValue: mode[2] }];
    }),
  );
  const exclusions = [
    ...section.matchAll(/Not supported on [^.\n]*?\x60([a-z][a-z0-9._-]+)\x60\./g),
  ];
  const minimalLine = section
    .split("\n")
    .find((line) => line.startsWith("| \x60minimal\x60 |") && line.includes("Not supported on"));
  for (const [page, row] of matchingPages(pages, facts, (model) => model.model_id)) {
    const id = page.model.model_id;
    const familyTitle = /^# Gemini 4 [^\r\n]+$/m.exec(pageProse(page, markdown))?.[0];
    const familyExcluded =
      familyTitle !== undefined &&
      minimalLine?.includes("Not supported on Gemini 4 models") === true;
    const minimalExcluded =
      familyExcluded || (minimalLine !== undefined && exclusions.some((match) => match[1] === id));
    addCapabilityDetailGroup(input, page.model, {
      claim,
      statements: [
        {
          kind: "reasoning_effort",
          scope:
            api.scope +
            `. ${parameter} controls dynamic thinking. Thinking is ${row.enabled ? "on" : "off"} when omitted.`,
          supported_values: row.values,
          ...(row.defaultValue === undefined ? {} : { default_value: row.defaultValue }),
          ...(minimalExcluded ? { unsupported_values: ["minimal"] } : {}),
        },
      ],
      evidence: [
        modelDocumentEvidence(
          input,
          document,
          "Controlling thinking; model options and default",
          [`${id} | ${row.state} | ${row.options}`, minimalExcluded ? minimalLine : undefined]
            .filter(Boolean)
            .join("\n"),
        ),
        ...(familyExcluded
          ? [
              modelDocumentEvidence(
                input,
                page.document,
                "Model title and Model code",
                `${familyTitle}\n${id}`,
              ),
            ]
          : []),
      ],
    });
  }
}

export function applyGeminiCapabilityDetails(
  input: SourceParseInput,
  pages: readonly GeminiCapabilityPage[],
  bundle: LinkedBundle,
  markdown: Markup,
): void {
  const indexProse = markdownProse(markdown(bundle.index.body) ?? "");
  const eligible = pages.filter((page) => callable(page, markdown, indexProse));
  for (const api of apis)
    for (const [topic, suffix] of [
      ["caching", "cache_modes"],
      ["thinking", "thinking_levels"],
    ] as const) {
      const claim = `${api.key}_${suffix}`;
      const documents = bundle.documents.filter(
        ({ url }) => url === `https://aistudio.google.com/docs/${topic}${api.query}`,
      );
      if (documents.length === 0) continue;
      try {
        const document = documents[0];
        if (documents.length !== 1 || !document) throw new Error("Duplicate Gemini guide");
        const body = markdown(document.body);
        if (body === undefined) throw new Error("Unrecognized Gemini guide format");
        if (topic === "caching") cacheModes(input, document, body, eligible, markdown, api, claim);
        else thinkingLevels(input, document, body, eligible, markdown, api, claim);
      } catch {
        capabilityDetailFinding(input, claim);
      }
    }
}
