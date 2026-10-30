import { markdownProse, markdownSection } from "./markdown.ts";
import { yamlBlock } from "./yaml.ts";
import type { ProviderModel } from "./schema.ts";

function ownedProse(body: string): string {
  return markdownProse(body)
    .split(/\r?\n/)
    .filter((line) => !/^(?: {4}|\t| *>)/.test(line))
    .join("\n");
}

function uniqueRow(body: string, label: string): string {
  const rows = ownedProse(body)
    .split(/\r?\n/)
    .filter((line) => line.startsWith(`| ${label} `));
  return rows.length === 1 ? (rows[0] ?? "") : "";
}

/** A declaration belongs to one direct request field, never an example or returned object. */
function requestField(body: string, name: string, type: string): boolean {
  const sections = [
    markdownSection(body, 2, "Body parameters"),
    markdownSection(body, 3, "Body Parameters"),
  ].filter((value) => value !== undefined);
  const section = sections.length === 1 ? sections[0] : undefined;
  if (section === undefined) return false;
  const fields = markdownProse(section)
    .split(/\r?\n/)
    .filter((line) => line.startsWith(`- \`${name}:`));
  return fields.length === 1 && fields[0] === `- \`${name}: ${type}\``;
}

export function anthropicMessagesWire(messages: string, overview: string, versions: string) {
  const operations = [...markdownProse(messages).matchAll(/^\*\*POST\*\* `([^`]+)`$/gim)];
  const authentication = markdownSection(overview, 2, "Authentication");
  const history = markdownSection(versions, 2, "Version history");
  // This adapter reviews one explicit API version; a future version requires its own review.
  const version = "2026-10-21";
  if (
    operations.length !== 1 ||
    operations[0]?.[1] !== "/v1/messages" ||
    !requestField(messages, "model", "Model") ||
    !/^The Claude API is a RESTful API at `https:\/\/api\.anthropic\.com` /m.test(
      ownedProse(overview),
    ) ||
    authentication === undefined ||
    !/^\| `Authorization` +\| `Bearer <token>`[^\n]+\| Yes, unless `x-api-key` is set +\|$/m.test(
      uniqueRow(authentication, "`Authorization`"),
    ) ||
    !/^\| `anthropic-version` +\|[^\n]+\| Yes +\|$/m.test(
      uniqueRow(authentication, "`anthropic-version`"),
    ) ||
    !/^\| `content-type` +\| `application\/json` +\| Yes +\|$/m.test(
      uniqueRow(authentication, "`content-type`"),
    ) ||
    history === undefined ||
    !markdownProse(history)
      .split(/\r?\n/)
      .some((line) => line === `* \`${version}\`` || line === `- \`${version}\``)
  )
    return;
  return {
    version,
    geography: requestField(messages, "inference_geo", "optional string or null"),
    speed: requestField(messages, "speed", 'optional "standard" or "fast" or null'),
    streaming: requestField(messages, "stream", "optional boolean"),
  };
}

export function anthropicIdentityContract(body: string) {
  const prose = ownedProse(body);
  return {
    pinned:
      prose.includes("Each Claude model ID identifies a pinned version of the model.") &&
      prose.includes("This guarantee covers model IDs, not the convenience aliases"),
    rolling:
      ownedProse(markdownSection(body, 3, "Before the 4.6 generation") ?? "").includes(
        "On the Claude API, these models also have shorter aliases",
      ) && prose.includes("that point to the most recent dated snapshot for that minor version."),
  };
}

export function anthropicGeographyContract(body: string): boolean {
  const section = markdownSection(body, 2, "Inference geo");
  if (section === undefined) return false;
  const prose = ownedProse(section);
  const declarations = prose
    .split(/\r?\n/)
    .filter((line) => line.startsWith("The `inference_geo` parameter is supported on "));
  if (declarations.length !== 1) return false;
  return (
    prose.includes("Add it to any `POST /v1/messages` call.") &&
    /^\| `"global"` +\| Default\. Inference may run in any available geography for optimal performance and availability\. +\|$/m.test(
      uniqueRow(prose, '`"global"`'),
    ) &&
    /^\| `"us"` +\| Inference runs only in US-based infrastructure\. +\|$/m.test(
      uniqueRow(prose, '`"us"`'),
    ) &&
    prose.includes("The `inference_geo` parameter is supported on Claude 4.6 and later models.") &&
    prose.includes(
      "Requests with `inference_geo` on Claude Opus 4.5, Claude Sonnet 4.5 (deprecated), Claude Haiku 4.5, or earlier models return a 400 error.",
    ) &&
    prose.includes("**`allowed_inference_geos`:** Restricts which geos a workspace can use.") &&
    prose.includes(
      "**`default_inference_geo`:** Sets the fallback geo when `inference_geo` is omitted from a request.",
    )
  );
}

export interface AnthropicFastModel {
  modelRef: string;
  beta: boolean;
  preview: boolean;
  mode: "fast" | "standard";
  geography: boolean;
}

export function anthropicFastModels(
  body: string,
  models: readonly ProviderModel[],
): AnthropicFastModel[] {
  const metadata = body.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
  const supported = metadata === undefined ? undefined : yamlBlock(metadata, "supportedModels", 2);
  const listed = supported
    ?.split(/\r?\n/)
    .slice(1)
    .map((line) => line.match(/^    - (claude-[a-z0-9-]+)$/)?.[1]);
  const availability = markdownSection(body, 2, "Availability");
  if (
    listed === undefined ||
    listed.length === 0 ||
    listed.some((id) => id === undefined) ||
    new Set(listed).size !== listed.length ||
    availability === undefined
  )
    return [];
  const messages = markdownSection(
    availability,
    4,
    "[Messages API](https://platform.claude.com/docs/en/build-with-claude/working-with-messages)",
  );
  const headers = markdownSection(availability, 3, "Required beta headers");
  if (
    messages === undefined ||
    headers === undefined ||
    !/^[*-] Usage: Set `speed: "fast"` on the request\.$/m.test(markdownProse(messages))
  )
    return [];
  const betaRows = markdownProse(headers)
    .split(/\r?\n/)
    .filter((line) => line.startsWith("| `"));
  if (betaRows.length !== 1 || !betaRows[0]?.startsWith("| `fast-mode-2026-02-01` |")) return [];
  function linkedModels(line: string): ProviderModel[] | undefined {
    const labels = [
      ...line.matchAll(/\[([^\]]+)\]\(https:\/\/platform\.claude\.com\/docs\/en\/models\/[^)]+\)/g),
    ].map((match) => match[1]);
    const found = labels.map((name) => models.filter((model) => model.name === name));
    if (found.some((matches) => matches.length > 1)) return;
    return found.flat();
  }
  const betaModels = linkedModels(betaRows[0]);
  if (betaModels === undefined) return [];
  const pricing = ownedProse(markdownSection(body, 2, "Pricing") ?? "");
  const geography =
    pricing.includes("Fast mode pricing stacks with other pricing modifiers:") &&
    /^[*-] \[Data residency\]\(https:\/\/platform\.claude\.com\/docs\/en\/manage-claude\/data-residency\) multipliers apply on top of fast mode pricing\.$/m.test(
      pricing,
    );
  const result: AnthropicFastModel[] = [];
  for (const line of markdownProse(messages).split(/\r?\n/)) {
    if (line.startsWith("|") && !/^\| (?:Status|[- :]+|Available|Research preview) +\|/.test(line))
      return [];
    if (!/^\| (?:Available|Research preview) +\|/.test(line)) continue;
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (cells.length !== 3 || !cells[1]?.startsWith("Claude API")) return [];
    const selected = linkedModels(cells[2] ?? "");
    if (selected === undefined) return [];
    for (const model of selected)
      result.push({
        modelRef: model.uid,
        beta: betaModels.some(({ uid }) => uid === model.uid),
        preview: cells[0] === "Research preview",
        mode: "fast",
        geography,
      });
  }
  const ids = result.map(({ modelRef }) => models.find(({ uid }) => uid === modelRef)?.model_id);
  const known = listed.filter((id) => models.some(({ model_id }) => model_id === id));
  if (
    new Set(ids).size !== ids.length ||
    ids.length !== known.length ||
    known.some((id) => !ids.includes(id))
  )
    return [];
  const outcomes = markdownSection(body, 2, "Checking which speed was used");
  if (outcomes === undefined) return [];
  const prose = ownedProse(outcomes);
  if (!prose.includes('When a request with `speed: "fast"` succeeds, `usage.speed` is `"fast"`.'))
    return [];
  if (
    prose.includes(
      'Claude Opus 4.6 is an exception: instead of returning an error, a request with `speed: "fast"` and the `fast-mode-2026-02-01` beta header succeeds, but runs at standard speed.',
    )
  ) {
    const fallback = models.filter(({ model_id }) => model_id === "claude-opus-4-6");
    if (fallback.length === 1 && fallback[0] !== undefined)
      result.push({
        modelRef: fallback[0].uid,
        beta: true,
        preview: true,
        mode: "standard",
        geography,
      });
  } else return [];
  return result;
}
