import type { LinkedBundle } from "./bundle.ts";
import { z } from "zod";
import { markdownSection, markdownTableRows } from "./markdown.ts";
import type { OpenAiModelCard } from "./openai-model-ids.ts";
import {
  addCapabilityDetailGroup,
  capabilityDetailFinding,
  modelDocumentEvidence,
} from "./source-model-details.ts";
import type { SourceParseInput } from "./source-parse.ts";

const openAiCacheGuide = "https://developers.openai.com/api/docs/guides/prompt-caching.md";
const exampleRequest = z.object({
  model: z.string().min(1),
  prompt_cache_options: z.object({ mode: z.literal("explicit") }),
});

export function addOpenAiCacheModes(
  input: SourceParseInput,
  cards: OpenAiModelCard[],
  bundle: LinkedBundle,
): void {
  const guides = bundle.documents.filter(({ url }) => url === openAiCacheGuide);
  const guide = guides[0];
  if (!guide) return;
  const claim = "responses_cache_breakpoints";
  const how = markdownSection(guide.body, 2, "How caching works") ?? "";
  const modes =
    "Both implicit and explicit caching are supported, where explicit caching gives you more control over which context is written to cache.";
  const cohorts = [...how.matchAll(/^### ([^\n]+)$/gm)].filter(
    (heading) => heading[1] && markdownSection(how, 3, heading[1])?.includes(modes),
  );
  const cohort = cohorts[0]?.[1];
  const section = cohort && markdownSection(how, 3, cohort);
  if (
    guides.length !== 1 ||
    !cohort ||
    cohorts.length !== 1 ||
    !section ||
    !section.includes("**Implicit mode:** OpenAI chooses breakpoint locations") ||
    !section.includes("**Explicit mode:** You choose where to place cache breakpoints")
  ) {
    capabilityDetailFinding(input, claim);
    return;
  }
  const summary = markdownSection(guide.body, 2, "Summary of model differences") ?? "";
  try {
    const rows = markdownTableRows(summary, ["Behavior", cohort]);
    const explicit = rows.filter((row) => row.get("Behavior") === "Explicit breakpoints");
    const implicit = rows.filter((row) => row.get("Behavior") === "Implicit breakpoints");
    if (
      explicit.length !== 1 ||
      explicit[0]?.get(cohort) !== "Supported" ||
      implicit.length !== 1 ||
      implicit[0]?.get(cohort) !== "At the end of the latest eligible message."
    ) {
      capabilityDetailFinding(input, claim);
      return;
    }
  } catch {
    capabilityDetailFinding(input, claim);
    return;
  }
  const lifetime = markdownSection(guide.body, 2, "Cache lifetime") ?? "";
  const examples = markdownSection(lifetime, 3, cohort) ?? "";
  const evidence = new Map<string, string>();
  for (const match of examples.matchAll(
    /^Responses API request with [^\n]+\n\s*\n```json\n([\s\S]*?)\n```$/gm,
  )) {
    try {
      const request = exampleRequest.parse(JSON.parse(match[1] ?? ""));
      evidence.set(request.model, match[0]);
    } catch {
      capabilityDetailFinding(input, claim);
    }
  }
  if (!evidence.size) {
    capabilityDetailFinding(input, claim);
    return;
  }
  for (const { model, document } of cards) {
    const example = evidence.get(model.model_id);
    if (!example || !model.api_endpoints?.some(({ path }) => path === "v1/responses")) continue;
    addCapabilityDetailGroup(input, model, {
      claim,
      statements: [
        {
          kind: "prompt_cache",
          mode: "implicit",
          supported: true,
          scope: "OpenAI Responses API • provider-selected eligible prefix breakpoints",
        },
        {
          kind: "prompt_cache",
          mode: "explicit",
          supported: true,
          scope: "OpenAI Responses API • caller-selected prefix breakpoints",
        },
      ],
      evidence: [
        modelDocumentEvidence(
          input,
          document,
          "Model ID and supported Responses route",
          model.model_id,
        ),
        modelDocumentEvidence(
          input,
          guide,
          `How caching works and Cache lifetime / ${cohort}; Summary of model differences`,
          modes + "\n" + example,
        ),
      ],
    });
  }
}
