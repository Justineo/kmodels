import { readFile } from "node:fs/promises";
export const anthropicDocuments = [
  ["/docs/en/about-claude/pricing.md", "pricing.md"],
  ["/docs/en/about-claude/model-deprecations.md", "lifecycle.md"],
  ["/docs/en/about-claude/models/model-ids-and-versions.md", "model-ids.md"],
  ["/docs/en/api/models/list.md", "models-list.md"],
  ["/docs/en/api/messages/create.md", "messages.md"],
  ["/docs/en/api/messages/batches/create.md", "batches.md"],
  ["/docs/en/build-with-claude/batch-processing.md", "batch-processing.md"],
  ["/docs/en/build-with-claude/citations.md", "citations.md"],
  ["/docs/en/build-with-claude/pdf-support.md", "pdf-support.md"],
  ["/docs/en/build-with-claude/context-editing.md", "context-editing.md"],
  ["/docs/en/build-with-claude/structured-outputs.md", "structured-outputs.md"],
  ["/docs/en/agents-and-tools/tool-use/code-execution-tool.md", "code-execution-tool.md"],
  ["/docs/en/agents-and-tools/tool-use/web-search-tool.md", "web-search-tool.md"],
  ["/docs/en/agents-and-tools/tool-use/advisor-tool.md", "advisor-tool.md"],
  ["/docs/en/agents-and-tools/tool-use/computer-use-tool.md", "computer-use-tool.md"],
  ["/docs/en/build-with-claude/effort.md", "effort.md"],
  ["/docs/en/build-with-claude/prompt-caching.md", "prompt-caching.md"],
  ["/docs/en/about-claude/glossary.md", "glossary.md"],
  ["/docs/en/build-with-claude/thinking.md", "thinking.md"],
  ["/docs/en/build-with-claude/thinking-troubleshooting.md", "thinking-troubleshooting.md"],
  ["/docs/en/build-with-claude/compaction.md", "compaction.md"],
  ["/docs/en/build-with-claude/compaction-threshold.md", "compaction-threshold.md"],
  ["/docs/en/agents-and-tools/tool-use/define-tools.md", "define-tools.md"],
  ["/docs/en/build-with-claude/fast-mode.md", "fast-mode.md"],
  ["/docs/en/manage-claude/data-residency.md", "data-residency.md"],
  ["/docs/en/build-with-claude/fallback-credit.md", "fallback-credit.md"],
  ["/docs/en/release-notes/overview.md", "release-notes.md"],
] as const;
export async function anthropicBundle() {
  const fixture = (name: string) =>
    readFile(new URL(`./fixtures/anthropic/${name}`, import.meta.url), "utf8");
  return {
    index: {
      url: "https://platform.claude.com/docs/en/about-claude/models/overview.md",
      body: await fixture("overview.md"),
    },
    documents: await Promise.all(
      anthropicDocuments.map(async ([path, name]) => ({
        url: `https://platform.claude.com${path}`,
        body: await fixture(name),
      })),
    ),
  };
}

export async function anthropicCardsBundle() {
  const fixture = (name: string) =>
    readFile(new URL(`./fixtures/anthropic/${name}`, import.meta.url), "utf8");
  const cards = ["opus-4-5", "mythos-5-2"];
  return {
    index: {
      url: "https://platform.claude.com/docs/en/models/overview.md",
      body: cards.map((slug) => `[${slug}](/docs/en/models/${slug}/overview)`).join("\n"),
    },
    documents: [
      ...(await Promise.all(
        cards.map(async (slug) => ({
          url: `https://platform.claude.com/docs/en/models/${slug}/overview.md`,
          body: await fixture(`model-card-${slug}.md`),
        })),
      )),
      {
        url: "https://platform.claude.com/docs/en/about-claude/models/model-ids-and-versions.md",
        body: await fixture("invocation-model-ids.md"),
      },
      {
        url: "https://platform.claude.com/docs/en/build-with-claude/batch-processing.md",
        body: await fixture("inference-batch-ids.md"),
      },
    ],
  };
}
