import type { LinkedBundle } from "./bundle.ts";
import { modelIdSchema } from "./identity.ts";
import { markdownProse, markdownSection, markdownTableRows } from "./markdown.ts";
import type { LimitStatement } from "./model-limit-details.ts";
import type { ParsedProviderModel } from "./pricing-source.ts";
import type { SourceParseInput } from "./source-parse.ts";
import {
  addLimitDetailGroup,
  limitDetailFinding,
  modelDocumentEvidence,
  limitTokenCount,
} from "./source-model-details.ts";

const guides = [
  {
    url: "https://aistudio.google.com/docs/long-decode",
    claim: "long_decode_interactions",
    api: "interactions",
  },
  {
    url: "https://aistudio.google.com/docs/long-decode?generate-content=true",
    claim: "long_decode_generate_content",
    api: "generate_content",
  },
] as const;

function one(body: string, pattern: RegExp): RegExpMatchArray {
  const matches = [...body.matchAll(pattern)];
  const match = matches[0];
  if (matches.length !== 1 || !match) throw new Error("Ambiguous long-decode declaration");
  return match;
}
function part(match: RegExpMatchArray, index: number): string {
  const value = match[index];
  if (value === undefined) throw new Error("Incomplete long-decode declaration");
  return value;
}
function count(value: string): number {
  const tokens = limitTokenCount(value);
  if (tokens === undefined) throw new Error("Invalid long-decode count");
  return tokens;
}
function ids(value: string): string[] {
  const values = [...value.matchAll(/`([^`]+)`/g)].map((m) => modelIdSchema.parse(m[1]));
  const rest = value.replaceAll(/`[^`]+`/g, "").replaceAll(/\b(?:and|or)\b|[,\s]/g, "");
  if (rest || !values.length || new Set(values).size !== values.length)
    throw new Error("Invalid long-decode model list");
  return values;
}
function checkBranches(all: string[], high: string[], low: string[]): void {
  const branches = [...high, ...low];
  if (
    new Set(branches).size !== branches.length ||
    branches.length !== all.length ||
    branches.some((id) => !all.includes(id))
  )
    throw new Error("Unexplained long-decode model branch");
}
function sameIds(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((id) => right.includes(id));
}
function captionTokens(value: string): number {
  const match = /^(\d+(?:\.\d+)?)([KM])$/.exec(value);
  if (!match?.[1]) throw new Error("Unknown Gemini token abbreviation");
  const tokens = Number(match[1]) * 2 ** (match[2] === "K" ? 10 : 20);
  if (!Number.isSafeInteger(tokens) || tokens <= 0)
    throw new Error("Invalid Gemini token abbreviation");
  return tokens;
}
function output(
  kind: "maximum" | "default",
  tokens: number,
  measurement: "per_response" | "per_hop" | "per_interaction",
  scope: string,
): LimitStatement {
  return { quantity: "output_tokens", kind, tokens, measurement, scope };
}
function shared(tokens: number, scope: string): LimitStatement {
  return {
    quantity: "context_tokens",
    kind: "maximum",
    tokens,
    measurement: "shared_context",
    scope,
  };
}

interface Claims {
  statements: Map<string, LimitStatement[]>;
  excerpt: string;
}

function interactionClaims(prose: string): Claims {
  const intro = one(
    prose,
    /^By default, [^()\n]+ models \((.+?)\) generate up to [\d.]+K tokens \(([\d,]+)\) of thinking and output per response\.[^\r\n]*/gm,
  );
  const modelIds = ids(part(intro, 1));
  const defaultTokens = count(part(intro, 2));
  const budget = count(
    part(one(prose, /([\d,]+) tokens shared across input, thinking, and output/g), 1),
  );
  if (captionTokens(part(one(prose, /unified ([\d.]+[KM])-token context window/g), 1)) !== budget)
    throw new Error("Conflicting interaction shared budget");
  const hops = one(
    prose,
    /^Generating hundreds of thousands of tokens[^\r\n]+up to [\d.]+K tokens \(([\d,]+)\) per hop on background calls, streaming calls, and non-streaming (?:(.+?) calls|calls on (.+?)), or up to [\d.]+K tokens \(([\d,]+)\) per non-streaming hop on (.+?)\.$/gm,
  );
  const highTokens = count(part(hops, 1));
  const highIds = ids(hops[2] ?? part(hops, 3));
  const lowTokens = count(part(hops, 4));
  const lowIds = ids(part(hops, 5));
  checkBranches(modelIds, highIds, lowIds);
  const section = markdownSection(prose, 2, "Output limits");
  if (!section) throw new Error("Missing interaction output limits");
  const rows = markdownTableRows(section, ["How you create the interaction", "Output limit"]);
  const defaults: { condition: string; tokens: number; value: string }[] = [];
  const branches = new Set<string>();
  for (const row of rows) {
    const condition = row.get("How you create the interaction") ?? "";
    const value = row.get("Output limit") ?? "";
    const unset = /^`background: (false|true)`, `max_output_tokens` not set$/.exec(condition);
    let branch: string;
    if (unset) {
      const tokens = count(value);
      if (tokens !== defaultTokens) throw new Error("Conflicting interaction default");
      defaults.push({ condition, tokens, value });
      branch = `default:${unset[1]}`;
    } else {
      const configured =
        /^`background: (false|true)`, `max_output_tokens` greater than ([\d,]*\d)(.*)$/.exec(
          condition,
        );
      if (!configured || count(configured[2] ?? "") !== defaultTokens)
        throw new Error("Unknown interaction branch");
      const tail = configured[3];
      if (configured[1] === "true" && tail === "") branch = "background";
      else if (
        configured[1] === "false" &&
        tail === ", `automatic_continuation: true` (SDK default)"
      )
        branch = "automatic";
      else if (configured[1] === "false" && tail === ", `automatic_continuation: false` or REST")
        branch = "manual";
      else throw new Error("Unknown interaction continuation");
      if (branch === "manual") {
        const manual =
          /^([\d,]+) tokens per streaming hop \(or non-streaming hop on (.+?)\), or ([\d,]+) per non-streaming hop on (.+?)\. Loop with `continuation_token` to generate up to your `max_output_tokens`\.$/.exec(
            value,
          );
        if (
          !manual ||
          count(manual[1] ?? "") !== highTokens ||
          count(manual[3] ?? "") !== lowTokens ||
          !sameIds(ids(manual[2] ?? ""), highIds) ||
          !sameIds(ids(manual[4] ?? ""), lowIds)
        )
          throw new Error("Conflicting interaction hop limit");
      } else {
        const total = /^Your `max_output_tokens`, up to ([\d,]+) minus your input$/.exec(value);
        if (!total || count(total[1] ?? "") !== budget)
          throw new Error("Unknown interaction total budget");
      }
    }
    if (branches.has(branch)) throw new Error("Duplicate interaction branch");
    branches.add(branch);
  }
  if (
    ["default:false", "default:true", "background", "automatic", "manual"].some(
      (branch) => !branches.has(branch),
    )
  )
    throw new Error("Missing interaction branch");
  if (
    !prose.includes("Background execution") ||
    !prose.includes("Requires `store: true`") ||
    !prose.includes(
      "`max_output_tokens` sets the combined limit for thinking and output across the interaction.",
    )
  )
    throw new Error("Incomplete interaction budget qualification");
  return {
    statements: new Map(
      modelIds.map((id) => [
        id,
        [
          shared(
            budget,
            `Interactions API: one combined input, thinking and output context. Output uses the remaining context, up to configured max_output_tokens. Above ${defaultTokens} generated tokens, background execution runs server continuations with store=true; foreground uses SDK automatic continuation (default) or an explicit REST/manual continuation loop.`,
          ),
          ...defaults.map(({ condition, tokens }) =>
            output(
              "default",
              tokens,
              "per_interaction",
              `Interactions API: ${condition}. Combined thinking and output budget across the interaction; not a visible-text guarantee.`,
            ),
          ),
          output(
            "maximum",
            highTokens,
            "per_hop",
            `Interactions API: background and foreground streaming hops${highIds.includes(id) ? ", including this model's non-streaming foreground hops" : ""}. Thinking and output share this hop budget; continuation can use the remaining configured interaction budget.`,
          ),
          ...(lowIds.includes(id)
            ? [
                output(
                  "maximum",
                  lowTokens,
                  "per_hop",
                  "Interactions API: this model's non-streaming foreground hop. Thinking and output share the hop budget; continuation can exceed it across the interaction.",
                ),
              ]
            : []),
        ] satisfies LimitStatement[],
      ]),
    ),
    excerpt: `${intro[0]}\n${hops[0]}\n${defaults.map(({ condition, value }) => `${condition} | ${value}`).join("\n")}`,
  };
}

function generateContentClaims(prose: string): Claims {
  const intro = one(
    prose,
    /^Long decode lets [^()\n]+ models \((.+?)\)[^\r\n]+shared across input, thinking, and output\)\.$/gm,
  );
  const modelIds = ids(part(intro, 1));
  const budget = count(
    part(one(prose, /([\d,]+) tokens shared across input, thinking, and output/g), 1),
  );
  for (const pattern of [
    /unified ([\d.]+[KM])-token context window/g,
    /Input, thinking, function calls, and the final response share one ([\d.]+[KM])-token window\./g,
    /Both options support the full ([\d.]+[KM])-token context window\./g,
  ])
    if (captionTokens(part(one(prose, pattern), 1)) !== budget)
      throw new Error("Conflicting GenerateContent shared budget");
  if (
    count(part(one(prose, /Output can use up to ([\d,]+) minus your input tokens\./g), 1)) !==
    budget
  )
    throw new Error("Conflicting GenerateContent remaining budget");
  const section = markdownSection(prose, 2, "Default output limits");
  if (!section) throw new Error("Missing GenerateContent default limits");
  const high = one(
    section,
    /^\* \*\*Streaming requests, non-streaming requests through the Google GenAI SDK \(`generate_content`\), and all (.+?) calls:\*\* Default to [\d.]+K \(([\d,]+)\) output tokens\.$/gm,
  );
  const low = one(
    section,
    /^\* \*\*Direct non-streaming REST calls \(`generateContent`\) on (.+?):\*\* Default to [\d.]+K \(([\d,]+)\) output tokens\. Setting `max_output_tokens` greater than ([\d,]+) on a non-streaming REST call to .+? without a `continuation_token` returns a `400` error\.$/gm,
  );
  const highIds = ids(part(high, 1));
  const lowIds = ids(part(low, 1));
  checkBranches(modelIds, highIds, lowIds);
  const highTokens = count(part(high, 2));
  const lowTokens = count(part(low, 2));
  if (count(part(low, 3)) !== lowTokens) throw new Error("Conflicting initial REST bound");
  const hops = one(
    prose,
    /One hop returns up to ([\d,]+) output tokens \(or up to ([\d,]+) on direct non-streaming REST calls to (.+?)\)\./g,
  );
  if (
    count(part(hops, 1)) !== highTokens ||
    count(part(hops, 2)) !== lowTokens ||
    !sameIds(ids(part(hops, 3)), lowIds)
  )
    throw new Error("Conflicting GenerateContent hop limit");
  const modes = markdownTableRows(section, [
    "How you call the model",
    "Output limit without long decode",
    "Long decode at launch",
    "What to do",
  ]);
  const expectedModes = [
    "Google GenAI SDK, latest version",
    "Google GenAI SDK, older version, non-streaming",
    "REST `streamGenerateContent`",
    "REST `generateContent`",
  ];
  if (
    modes.length !== expectedModes.length ||
    expectedModes.some(
      (mode) => modes.filter((row) => row.get("How you call the model") === mode).length !== 1,
    )
  )
    throw new Error("Unknown GenerateContent mode");
  const highCaption = part(one(high[0], /Default to ([\d.]+K) /g), 1);
  const lowCaption = part(one(low[0], /Default to ([\d.]+K) /g), 1);
  if (captionTokens(highCaption) !== highTokens || captionTokens(lowCaption) !== lowTokens)
    throw new Error("Conflicting GenerateContent default abbreviation");
  for (const mode of modes) {
    const name = mode.get("How you call the model");
    const value = mode.get("Output limit without long decode") ?? "";
    const support = mode.get("Long decode at launch");
    const action = mode.get("What to do");
    if (name === "REST `generateContent`") {
      const branches = /^([\d.]+K) \((.+?)\) or ([\d.]+K) \((.+?)\)$/.exec(value);
      if (
        !branches ||
        branches[1] !== highCaption ||
        branches[3] !== lowCaption ||
        !sameIds(ids(branches[2] ?? ""), highIds) ||
        !sameIds(ids(branches[4] ?? ""), lowIds)
      )
        throw new Error("Conflicting REST model/default branch");
    } else if (value !== highCaption) throw new Error("Conflicting SDK/streaming default cell");
    if (name === "Google GenAI SDK, latest version") {
      if (support !== "Yes, the SDK continues for you" || action !== "Set `max_output_tokens`.")
        throw new Error("Unknown SDK continuation setup");
    } else if (name === "Google GenAI SDK, older version, non-streaming") {
      if (support !== "No" || action !== "Upgrade the SDK.")
        throw new Error("Unknown older SDK branch");
    } else if (
      support !== "Yes, with your own loop" ||
      action !==
        "Write a loop. See [Option 2](/docs/long-decode?generate-content=true#option-2-loop)."
    )
      throw new Error("Unknown REST continuation setup");
  }
  const sdk = one(
    prose,
    /Automatic continuation needs these Google GenAI SDK versions or higher:[^\r\n]+/g,
  );
  if (
    !prose.includes(
      "`max_output_tokens` sets the total thinking and output tokens for all hops together.",
    ) ||
    !/Input, thinking, function calls, and the final response share one [\d.]+[kKmM]-token window\./.test(
      prose,
    ) ||
    !/Both options support the full [\d.]+[kKmM]-token context window\./.test(prose)
  )
    throw new Error("Incomplete GenerateContent budget qualification");
  return {
    statements: new Map(
      modelIds.map((id) => [
        id,
        [
          shared(
            budget,
            `GenerateContent API: input, thinking, function calls and the final response share one context; output uses remaining context. Long decode needs a higher max_output_tokens and a supported SDK continuation or a manual REST loop. ${sdk[0]}`,
          ),
          output(
            "default",
            highTokens,
            "per_response",
            `GenerateContent without long-decode setup: streaming and non-streaming Google GenAI SDK requests${highIds.includes(id) ? ", and this model's non-streaming REST requests" : ""}. Generated-token budget includes thinking and output; this is not an aggregate long-decode maximum.`,
          ),
          ...(lowIds.includes(id)
            ? [
                output(
                  "default",
                  lowTokens,
                  "per_response",
                  "GenerateContent without long-decode setup: this model's direct non-streaming REST request. A larger initial max_output_tokens without continuation_token returns HTTP 400.",
                ),
              ]
            : []),
          output(
            "maximum",
            highTokens,
            "per_hop",
            `GenerateContent: streaming and SDK hops${highIds.includes(id) ? ", and this model's non-streaming REST hops" : ""}. A supported SDK automatically continues; older non-streaming SDKs stop at this budget. A manual streaming loop can continue beyond one hop.`,
          ),
          ...(lowIds.includes(id)
            ? [
                output(
                  "maximum",
                  lowTokens,
                  "per_hop",
                  "GenerateContent: this model's direct non-streaming REST hop. Use continuation_token with an explicit loop to continue within the total configured thinking/output budget.",
                ),
              ]
            : []),
        ] satisfies LimitStatement[],
      ]),
    ),
    excerpt: `${intro[0]}\n${high[0]}\n${low[0]}\n${hops[0]}`,
  };
}

export function applyGeminiLimitDetails(
  input: SourceParseInput,
  models: readonly ParsedProviderModel[],
  bundle: LinkedBundle,
  studioMarkdown: (body: string) => string | undefined,
): void {
  for (const guide of guides) {
    const documents = bundle.documents.filter(({ url }) => url === guide.url);
    if (documents.length === 0) continue;
    const document = documents[0];
    if (documents.length !== 1 || !document) {
      limitDetailFinding(input, guide.claim);
      continue;
    }
    try {
      const prose = markdownProse(studioMarkdown(document.body) ?? document.body).replace(
        /[ \t]+\{% id="[^"]+" %\}(?=\r?$)/gm,
        "",
      );
      const claims =
        guide.api === "interactions" ? interactionClaims(prose) : generateContentClaims(prose);
      for (const model of models) {
        const statements = claims.statements.get(model.model_id);
        if (!statements) continue;
        addLimitDetailGroup(input, model, {
          claim: guide.claim,
          statements,
          evidence: [
            modelDocumentEvidence(
              input,
              document,
              "Introduction; How long decode works; Output/default limits; continuation mode table",
              claims.excerpt,
            ),
          ],
        });
      }
    } catch {
      limitDetailFinding(input, guide.claim);
    }
  }
}
