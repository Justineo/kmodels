import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vite-plus/test";
import { parseSource } from "../src/catalog/adapters.ts";
import type { LinkedBundle } from "../src/catalog/bundle.ts";
import { sha256 } from "../src/catalog/io.ts";
import { manifests } from "../src/catalog/manifests.ts";
import type { SourceContractEvidence } from "../src/catalog/source-contract.ts";

const observedAt = "2026-11-18T00:00:00.000Z";
const effortUrl = "https://platform.claude.com/docs/en/build-with-claude/effort.md";
const overview = "https://platform.claude.com/docs/en/models/overview.md";
const fixture = (path: string) =>
  readFile(new URL(`./fixtures/anthropic/${path}`, import.meta.url), "utf8");

async function bundle() {
  const [card, effort] = await Promise.all([
    fixture("scoped-limit-card.md"),
    fixture("scoped-effort.md"),
  ]);
  const modelCard = (slug: string, name: string, defaultValue: string) => ({
    url: `https://platform.claude.com/docs/en/models/${slug}/overview.md`,
    body: card
      .replace("title: Claude Opus 4.6", `title: ${name}`)
      .replaceAll("opus-4-6", slug)
      .replace(
        /^\| Max output\s*\| 128K tokens \|$/m,
        `| Max output | 128K tokens |\n| [Default effort](https://platform.claude.com/docs/en/build-with-claude/effort) | \`${defaultValue}\` |`,
      ),
  });
  return {
    index: { url: overview, body: "# Models" },
    documents: [
      { url: effortUrl, body: effort },
      modelCard("opus-5-5", "Claude Opus 5.5", "medium"),
      modelCard("haiku-5-5", "Claude Haiku 5.5", "medium"),
      modelCard("opus-4-6", "Claude Opus 4.6", "high"),
      modelCard("other", "Claude Other", "high"),
    ],
  } satisfies LinkedBundle;
}

function parse(value: LinkedBundle) {
  const manifest = manifests.find(({ provider }) => provider.id === "anthropic");
  const source = manifest?.sources.find(({ id }) => id === "anthropic-model-cards");
  if (manifest === undefined || source === undefined) throw new Error("Missing Anthropic source");
  const findings: SourceContractEvidence[] = [];
  const result = parseSource({
    provider: { ...manifest.provider, source_ids: [source.id] },
    source,
    observedAt,
    body: JSON.stringify(value),
    onContractFinding: (finding) => findings.push(finding),
  });
  return { ...result, findings };
}

describe("Anthropic Messages effort details", () => {
  it("joins exact cards to direct API option cohorts and native default exceptions", async () => {
    const value = await bundle();
    const { models } = parse(value);
    for (const [id, defaultValue, extended] of [
      ["claude-opus-5-5", "medium", true],
      ["claude-haiku-5-5", "medium", true],
      ["claude-opus-4-6", "high", false],
    ] as const) {
      const model = models.find(({ model_id }) => model_id === id);
      expect(model?.limits.max_output_tokens).toBe(128000);
      const group = model?.capability_details?.[0];
      expect(group).toMatchObject({
        claim: "messages_reasoning_effort",
        source_ref: "anthropic-model-cards",
        statements: [
          {
            kind: "reasoning_effort",
            scope: expect.stringContaining("Direct Claude API Messages"),
            supported_values: extended
              ? ["max", "xhigh", "high", "medium", "low"]
              : ["max", "high", "medium", "low"],
            default_value: defaultValue,
          },
        ],
      });
      expect(group?.statements[0]).not.toHaveProperty("unsupported_values");
      expect(group?.evidence).toHaveLength(2);
      for (const evidence of group?.evidence ?? []) {
        const matched = value.documents.find(({ url }) => url === evidence.document_url);
        expect(evidence.observed_at).toBe(observedAt);
        expect(evidence.content_hash).toBe(sha256(matched?.body ?? ""));
      }
    }
    const other = models.find(({ model_id }) => model_id === "claude-other");
    expect(other?.limits.max_output_tokens).toBe(128000);
    expect(other?.capability_details).toBeUndefined();
  });

  it("reads changed native model names, IDs, values and default exceptions from evidence", async () => {
    const value = await bundle();
    for (const document of value.documents) {
      document.url = document.url.replace("opus-5-5", "native-effort-proof");
      document.body = document.body
        .replaceAll("opus-5-5", "native-effort-proof")
        .replaceAll("Claude Opus 5.5", "Claude Native Proof")
        .replaceAll("xhigh", "extended")
        .replaceAll("medium", "balanced");
    }
    const { models } = parse(value);
    const model = models.find(({ model_id }) => model_id === "claude-native-effort-proof");
    expect(model?.capability_details?.[0]?.statements[0]).toMatchObject({
      default_value: "balanced",
      supported_values: ["max", "extended", "high", "balanced", "low"],
    });
  });

  it.each([
    ["explicit card default", 1, "| `medium` |", "| `high` |"],
    ["recommendation default", 0, "and `medium` is the default.", "and `high` is the default."],
    [
      "native option cohort",
      0,
      "Available on Claude Opus 5.5 and Claude Haiku 5.5.",
      "Available on Claude Haiku 5.5.",
    ],
    [
      "direct scope",
      0,
      "[Claude Opus 5.5](https://platform.claude.com/docs/en/models/opus-5-5/overview), ",
      "",
    ],
    ["exact identity", 1, "Model ID: `claude-opus-5-5`", "Model ID: `claude-not-the-card`"],
  ] as const)(
    "withholds only the unproved model's effort on %s",
    async (reason, index, from, to) => {
      const value = await bundle();
      const target = value.documents[index];
      if (target === undefined || !target.body.includes(from))
        throw new Error("Missing mutation target");
      target.body = target.body.replace(from, to);
      const { models, findings } = parse(value);
      const opus = models.find(({ model_id }) => model_id === "claude-opus-5-5");
      if (reason === "exact identity") expect(opus).toBeUndefined();
      else {
        expect(opus?.limits.max_output_tokens).toBe(128000);
        expect(opus?.capability_details).toBeUndefined();
        expect(
          findings.some(({ diagnostics }) =>
            diagnostics.some(({ path }) => path.includes("/capability_details/")),
          ),
        ).toBe(true);
      }
      const haiku = models.find(({ model_id }) => model_id === "claude-haiku-5-5");
      expect(haiku?.capability_details?.[0]?.statements[0]).toMatchObject({
        default_value: "medium",
      });
    },
  );

  it("withholds effort when guide default exceptions disagree and preserves independent card facts", async () => {
    const value = await bundle();
    const guide = value.documents[0];
    if (guide === undefined) throw new Error("Missing guide");
    guide.body = guide.body.replace(
      "The default on Claude Opus 5.5 and Claude Haiku 5.5.",
      "The default on Claude Haiku 5.5.",
    );
    const { models } = parse(value);
    expect(models).toHaveLength(4);
    expect(models.every((model) => model.limits.max_output_tokens === 128000)).toBe(true);
    expect(models.every((model) => model.capability_details === undefined)).toBe(true);
  });

  it("keeps ordinary and scoped limit evidence when the effort companion is missing", async () => {
    const value = await bundle();
    value.documents = value.documents.filter(({ url }) => url !== effortUrl);
    const { models } = parse(value);
    expect(models).toHaveLength(4);
    expect(
      models.every((model) => model.limit_details?.some(({ claim }) => claim === "card_limits")),
    ).toBe(true);
    expect(models.every((model) => model.capability_details === undefined)).toBe(true);
  });
});
