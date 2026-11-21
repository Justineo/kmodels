import { readFile } from "node:fs/promises";
import { expect, it } from "vite-plus/test";
import { parseSource } from "../src/catalog/adapters.ts";
import type { LinkedBundle } from "../src/catalog/bundle.ts";
import { sha256 } from "../src/catalog/io.ts";
import { manifests } from "../src/catalog/manifests.ts";
import { geminiInferenceFixtures } from "./gemini-inference-fixture.ts";
import { xaiInferenceBundle } from "./xai-inference-fixture.ts";

const at = "2026-11-18T00:00:00.000Z";
const fixture = (path: string) => readFile(new URL(`./fixtures/${path}`, import.meta.url), "utf8");
const batchUrl = "https://platform.claude.com/docs/en/build-with-claude/batch-processing.md";
const interactionsUrl = "https://aistudio.google.com/docs/long-decode";
const generateUrl = `${interactionsUrl}?generate-content=true`;

function parse(providerId: string, sourceId: string, bundle: LinkedBundle) {
  const manifest = manifests.find((m) => m.provider.id === providerId);
  const source = manifest?.sources.find((s) => s.id === sourceId);
  if (!manifest || !source) throw new Error("Missing test source");
  const findings: unknown[] = [];
  const result = parseSource({
    provider: { ...manifest.provider, source_ids: [source.id] },
    source,
    observedAt: at,
    body: JSON.stringify(bundle),
    onContractFinding: (finding) => findings.push(finding),
  });
  return { ...result, findings };
}

async function anthropicBundle(): Promise<LinkedBundle> {
  return {
    index: { url: "https://platform.claude.com/docs/en/models/overview.md", body: "# Models" },
    documents: [
      {
        url: "https://platform.claude.com/docs/en/models/opus-4-6/overview.md",
        body: await fixture("anthropic/scoped-limit-card.md"),
      },
      { url: batchUrl, body: await fixture("anthropic/scoped-limit-batch.md") },
    ],
  };
}
async function geminiBundle(): Promise<LinkedBundle> {
  const { catalog } = await geminiInferenceFixtures();
  const page = await fixture("gemini/unified-context.txt");
  for (const id of ["gemini-4-carbon", "gemini-4-hydrogen"])
    catalog.documents.push({
      url: `https://aistudio.google.com/docs/models/${id}`,
      body: page.replaceAll("limit-probe", id),
    });
  catalog.documents.push(
    { url: interactionsUrl, body: await fixture("gemini/long-decode-interactions.txt") },
    { url: generateUrl, body: await fixture("gemini/long-decode-generate-content.txt") },
  );
  return catalog;
}
async function xaiBundle(): Promise<LinkedBundle> {
  const bundle = await xaiInferenceBundle();
  bundle.index.body += '<a href="/developers/models/grok-4.7"><span>Grok 4.7</span></a>';
  const llms = bundle.documents[0];
  if (!llms) throw new Error("Missing xAI document");
  const card = (await fixture("xai/scoped-output.txt")).split(
    "===/developers/rest-api-reference",
  )[0];
  llms.body = llms.body.replace(/===\/developers\/grok-4-7===[\s\S]*?(?=\n\n===|$)/, "");
  llms.body += `\n\n${card}`;
  return bundle;
}

it("preserves ordinary Anthropic output and the separately qualified Batch beta", async () => {
  const bundle = await anthropicBundle();
  const model = parse("anthropic", "anthropic-model-cards", bundle).models[0];
  expect(model?.limits.max_output_tokens).toBe(128000);
  expect(model?.limit_details?.map((g) => g.claim)).toEqual(["card_limits", "batch_output_beta"]);
  expect(
    model?.limit_details?.find((g) => g.claim === "batch_output_beta")?.statements,
  ).toContainEqual(
    expect.objectContaining({
      quantity: "output_tokens",
      kind: "maximum",
      tokens: 300000,
      measurement: "per_response",
      applicability: {
        endpoint: "v1/messages/batches",
        beta_header: { name: "anthropic-beta", value: "output-300k-2026-03-24", present: true },
      },
      scope: expect.stringContaining("output-300k-2026-03-24"),
    }),
  );
  const beta = model?.limit_details?.find((g) => g.claim === "batch_output_beta");
  expect(beta?.statements).toContainEqual(
    expect.objectContaining({
      tokens: 128000,
      applicability: {
        endpoint: "v1/messages/batches",
        beta_header: { name: "anthropic-beta", value: "output-300k-2026-03-24", present: false },
      },
    }),
  );
  expect(beta?.statements.every((s) => s.scope.includes("Message Batches"))).toBe(true);
  expect(beta?.evidence).toContainEqual(
    expect.objectContaining({
      document_url: batchUrl,
      observed_at: at,
      content_hash: sha256(bundle.documents[1]?.body ?? ""),
    }),
  );
});

it("keeps ordinary Anthropic metadata when its optional Batch companion is absent", async () => {
  const bundle = await anthropicBundle();
  bundle.documents = bundle.documents.filter((d) => d.url !== batchUrl);
  const model = parse("anthropic", "anthropic-model-cards", bundle).models[0];
  expect(model?.limit_details?.map((g) => g.claim)).toEqual(["card_limits"]);
  expect(model?.limits.max_output_tokens).toBe(128000);
});

it("withholds a neighboring xAI heading's description without losing the owned limit", async () => {
  const bundle = await xaiBundle();
  for (const document of bundle.documents)
    document.body = document.body.replace(
      "# Grok 4.7\n\nGrok 4.7 is",
      "# Other model\n\nOther model is",
    );
  const model = parse("xai", "xai-models", bundle).models.find((m) => m.model_id === "grok-4.7");
  expect(model?.description).toBeUndefined();
  expect(model?.limit_details?.[0]?.claim).toBe("card_limits");
});

it("publishes the owned xAI no-cap state with exact document evidence and finite context", async () => {
  const bundle = await xaiBundle();
  const model = parse("xai", "xai-models", bundle).models.find((m) => m.model_id === "grok-4.7");
  expect(model?.limits.context_tokens).toBe(500000);
  expect(model?.description).toBe(
    "Grok 4.7 is SpaceXSI's frontier model built for coding, agentic tasks, and knowledge work.",
  );
  expect(model?.price_facts.length).toBeGreaterThan(0);
  expect(model?.limit_details?.[0]?.statements).toContainEqual(
    expect.objectContaining({
      kind: "no_separate_cap",
      quantity: "text_output_tokens",
      measurement: "per_response",
      applicability: { endpoint: "/v1/responses" },
      scope: expect.stringContaining("Responses"),
    }),
  );
  expect(model?.limit_details?.[0]?.statements.every((s) => s.kind !== "maximum")).toBe(true);
  expect(model?.limit_details?.[0]?.evidence).toContainEqual(
    expect.objectContaining({
      document_url: "https://docs.x.ai/llms-full.txt",
      observed_at: at,
      content_hash: sha256(bundle.documents[0]?.body ?? ""),
    }),
  );
});
it("binds a model-wide release-note output claim only to the named model and overview", async () => {
  const bundle = await xaiBundle();
  const doc = bundle.documents.find((d) => d.url === "https://docs.x.ai/llms-full.txt");
  if (!doc) throw new Error("Missing release notes");
  const get = () =>
    parse("xai", "xai-models", bundle).models.find((m) => m.model_id === "grok-4.6");
  expect(get()?.limit_details?.[0]?.statements).toEqual([
    expect.objectContaining({ kind: "no_separate_cap", quantity: "text_output_tokens" }),
  ]);
  expect(get()?.limits.max_output_tokens).toBeUndefined();
  doc.body = doc.body.replace(
    "[Grok 4.6 overview](/developers/grok-4-6)",
    "[Grok 4.7 overview](/developers/grok-4-7)",
  );
  expect(get()?.limit_details).toBeUndefined();
});

it.each(["gemini-4-carbon", "gemini-4-argon", "gemini-4-hydrogen"])(
  "keeps Gemini API, default, hop and shared-budget statements distinct (%s)",
  async (id) => {
    const bundle = await geminiBundle();
    const model = parse("gemini", "gemini-models", bundle).models.find((m) => m.model_id === id);
    expect(model).toBeDefined();
    expect(model?.limit_details?.map((g) => g.claim)).toEqual([
      "long_decode_interactions",
      "long_decode_generate_content",
    ]);
    const statements = model?.limit_details?.flatMap((g) => g.statements);
    expect(statements).toContainEqual(
      expect.objectContaining({
        kind: "default",
        quantity: "output_tokens",
        tokens: 65536,
        measurement: "per_interaction",
      }),
    );
    expect(statements).toContainEqual(
      expect.objectContaining({
        kind: "maximum",
        quantity: "context_tokens",
        tokens: 1048576,
        measurement: "shared_context",
      }),
    );
    expect(
      statements?.some(
        (s) => s.quantity === "output_tokens" && s.kind === "maximum" && s.tokens === 1048576,
      ),
    ).toBe(false);
    if (id !== "gemini-4-hydrogen")
      expect(statements).toContainEqual(
        expect.objectContaining({
          kind: "maximum",
          quantity: "output_tokens",
          tokens: 32768,
          measurement: "per_hop",
        }),
      );
    expect(statements).toContainEqual(
      expect.objectContaining({
        kind: "maximum",
        quantity: "output_tokens",
        tokens: 65536,
        measurement: "per_hop",
      }),
    );
    for (const group of model?.limit_details ?? [])
      for (const evidence of group.evidence) {
        const document = bundle.documents.find((d) => d.url === evidence.document_url);
        expect(document).toBeDefined();
        expect(evidence.content_hash).toBe(sha256(document?.body ?? ""));
        expect(evidence.observed_at).toBe(at);
      }
  },
);

it("isolates a missing Gemini API companion from fresh sibling claims and ordinary models", async () => {
  const bundle = await geminiBundle();
  bundle.documents = bundle.documents.filter((d) => d.url !== generateUrl);
  const models = parse("gemini", "gemini-models", bundle).models;
  expect(models.find((m) => m.model_id === "gemini-4-carbon")).toBeDefined();
  expect(
    models.find((m) => m.model_id === "gemini-4-carbon")?.limit_details?.map((g) => g.claim),
  ).toEqual(["long_decode_interactions"]);
  const ordinary = models.find((m) => m.model_id === "gemini-3.7-flash");
  expect(ordinary).toBeDefined();
  expect(ordinary?.limit_details).toBeUndefined();
});

it.each([
  [
    "default cell",
    generateUrl,
    "| Google GenAI SDK, latest version | 64K |",
    "| Google GenAI SDK, latest version | 32K |",
    "long_decode_generate_content",
  ],
  [
    "continuation support",
    generateUrl,
    "| 64K | Yes, the SDK continues for you |",
    "| 64K | No |",
    "long_decode_generate_content",
  ],
  [
    "setup cell",
    generateUrl,
    "| Set `max_output_tokens`. |",
    "| No setup required. |",
    "long_decode_generate_content",
  ],
  [
    "REST model branch",
    generateUrl,
    "64K (`gemini-4-hydrogen`) or 32K",
    "64K (`gemini-4-argon`) or 32K",
    "long_decode_generate_content",
  ],
  [
    "manual model branch",
    interactionsUrl,
    "tokens per streaming hop (or non-streaming hop on `gemini-4-hydrogen`)",
    "tokens per streaming hop (or non-streaming hop on `gemini-4-carbon`)",
    "long_decode_interactions",
  ],
  [
    "manual streaming branch",
    interactionsUrl,
    "tokens per streaming hop (or non-streaming hop on",
    "tokens per non-streaming hop (or non-streaming hop on",
    "long_decode_interactions",
  ],
  [
    "shared budget conflict",
    generateUrl,
    "share one 1M-token window",
    "share one 2M-token window",
    "long_decode_generate_content",
  ],
])(
  "withholds the atomic Gemini claim for a contradictory %s",
  async (_name, url, before, after, claim) => {
    const bundle = await geminiBundle();
    const doc = bundle.documents.find((d) => d.url === url);
    if (!doc || !doc.body.includes(before)) throw new Error("Missing mutation target");
    doc.body = doc.body.replace(before, after);
    const result = parse("gemini", "gemini-models", bundle);
    const model = result.models.find((m) => m.model_id === "gemini-4-argon");
    expect(model).toBeDefined();
    expect(model?.limit_details?.some((g) => g.claim === claim)).toBe(false);
    expect(model?.limit_details).toHaveLength(1);
    expect(result.findings.length).toBeGreaterThan(0);
  },
);

it("reads changed Gemini quantities and exact IDs as source data", async () => {
  const bundle = await geminiBundle();
  for (const doc of [bundle.index, ...bundle.documents])
    doc.body = doc.body
      .replaceAll("gemini-4-argon", "renamed-limit-model")
      .replaceAll("1,048,576", "2,097,152")
      .replaceAll("1M", "2M");
  const result = parse("gemini", "gemini-models", bundle);
  const model = result.models.find((m) => m.model_id === "renamed-limit-model");
  expect(model).toBeDefined();
  expect(model?.limit_details).toHaveLength(2);
  expect(model?.limit_details?.flatMap((g) => g.statements)).toContainEqual(
    expect.objectContaining({ quantity: "context_tokens", tokens: 2097152 }),
  );
});

it("reads changed Gemini default and hop amounts across all native branches", async () => {
  const bundle = await geminiBundle();
  for (const doc of bundle.documents.filter(
    (d) => d.url === interactionsUrl || d.url === generateUrl,
  ))
    doc.body = doc.body
      .replaceAll("65,536", "98,304")
      .replaceAll("64K", "96K")
      .replaceAll("32,768", "49,152")
      .replaceAll("32K", "48K");
  const model = parse("gemini", "gemini-models", bundle).models.find(
    (m) => m.model_id === "gemini-4-argon",
  );
  expect(model).toBeDefined();
  expect(model?.limit_details).toHaveLength(2);
  const statements = model?.limit_details?.flatMap((g) => g.statements);
  expect(statements).toContainEqual(expect.objectContaining({ kind: "default", tokens: 98304 }));
  expect(statements).toContainEqual(
    expect.objectContaining({ kind: "maximum", tokens: 49152, measurement: "per_hop" }),
  );
});

it.each(["duplicate", "unknown", "fenced"])(
  "withholds only the affected Gemini guide on %s scope",
  async (change) => {
    const bundle = await geminiBundle();
    const doc = bundle.documents.find((d) => d.url === interactionsUrl);
    if (!doc) throw new Error("Missing guide");
    if (change === "duplicate") doc.body += "\n" + doc.body;
    else if (change === "unknown")
      doc.body = doc.body.replace("(SDK default)", "(account dependent)");
    else doc.body = "```\n" + doc.body + "\n```";
    const result = parse("gemini", "gemini-models", bundle);
    const model = result.models.find((m) => m.model_id === "gemini-4-argon");
    expect(model).toBeDefined();
    expect(model?.limit_details?.map((g) => g.claim)).toEqual(["long_decode_generate_content"]);
  },
);

it("reads the Anthropic header, bounds and exact support identity from the owned declarations", async () => {
  const bundle = await anthropicBundle();
  for (const doc of bundle.documents)
    doc.body = doc.body
      .replaceAll("Claude Opus 4.6", "Claude Native Probe")
      .replaceAll("claude-opus-4-6", "native-probe")
      .replaceAll("output-300k-2026-03-24", "extended-generation-2099-01-01")
      .replaceAll("300,000", "400,000")
      .replaceAll("300K", "400K")
      .replaceAll("300k", "400k")
      .replaceAll("128K", "160K")
      .replaceAll("128k", "160k");
  const model = parse("anthropic", "anthropic-model-cards", bundle).models[0];
  expect(model?.model_id).toBe("native-probe");
  expect(model?.limits.max_output_tokens).toBe(160000);
  expect(
    model?.limit_details?.find((g) => g.claim === "batch_output_beta")?.statements,
  ).toContainEqual(
    expect.objectContaining({
      tokens: 400000,
      applicability: {
        endpoint: "v1/messages/batches",
        beta_header: {
          name: "anthropic-beta",
          value: "extended-generation-2099-01-01",
          present: true,
        },
      },
      scope: expect.stringContaining("extended-generation-2099-01-01"),
    }),
  );
});

it.each(["unsupported", "unknown header", "missing exclusion", "ambiguous name"])(
  "keeps Anthropic ordinary facts on %s beta scope",
  async (change) => {
    const bundle = await anthropicBundle();
    const guide = bundle.documents.find((d) => d.url === batchUrl);
    const card = bundle.documents[0];
    if (!guide || !card) throw new Error("Missing Anthropic fixture");
    if (change === "unsupported")
      guide.body = guide.body.replace("Claude Opus 4.6", "Claude Other");
    else if (change === "unknown header")
      guide.body = guide.body.replace("beta header raises", "account setting raises");
    else if (change === "missing exclusion")
      guide.body = guide.body.replace(
        "only, not the synchronous Messages API",
        "and the synchronous Messages API",
      );
    else
      bundle.documents.push({
        url: card.url.replace("opus-4-6", "other-card"),
        body: card.body.replaceAll("claude-opus-4-6", "other-card"),
      });
    const result = parse("anthropic", "anthropic-model-cards", bundle);
    const model = result.models.find((m) => m.model_id === "claude-opus-4-6");
    expect(model).toBeDefined();
    expect(model?.limit_details?.map((g) => g.claim)).toEqual(["card_limits"]);
    expect(model?.limits.max_output_tokens).toBe(128000);
  },
);

it.each(["amount", "header", "membership"])(
  "withholds Anthropic beta on a conflicting card footnote %s",
  async (change) => {
    const bundle = await anthropicBundle();
    const card = bundle.documents[0];
    if (!card) throw new Error("Missing card");
    card.body =
      change === "amount"
        ? card.body.replace("support up to 300k output tokens", "support up to 400k output tokens")
        : change === "membership"
          ? card.body.replace("Claude Opus 4.6, ", "")
          : card.body.replace(
              "with the output-300k-2026-03-24 beta header",
              "with the another-output-beta beta header",
            );
    const result = parse("anthropic", "anthropic-model-cards", bundle);
    const model = result.models.find((m) => m.model_id === "claude-opus-4-6");
    expect(model).toBeDefined();
    expect(model?.limits.max_output_tokens).toBe(128000);
    expect(model?.limit_details?.map((g) => g.claim)).toEqual(["card_limits"]);
    expect(result.findings.length).toBeGreaterThan(0);
  },
);

it.each(["missing cap", "unknown cap", "foreign API", "wrong identity", "duplicate", "fenced"])(
  "keeps xAI prices and identity when no-cap evidence has %s",
  async (change) => {
    const bundle = await xaiBundle();
    const llms = bundle.documents[0];
    if (!llms) throw new Error("Missing xAI fixture");
    if (change === "missing cap")
      llms.body = llms.body.replace("| Output limit | No text output limit |", "");
    else if (change === "unknown cap")
      llms.body = llms.body.replace("No text output limit", "Depends on account");
    else if (change === "foreign API")
      llms.body = llms.body.replace(
        "| APIs | [Responses API](/developers/rest-api-reference/inference/responses#create-new-response) |",
        "| APIs | [Responses API](https://example.com/foreign) |",
      );
    else if (change === "wrong identity")
      llms.body = llms.body.replace(
        "| Model name | `grok-4.7` |",
        "| Model name | `not-the-model` |",
      );
    else if (change === "duplicate")
      llms.body +=
        "\n\n" +
        (await fixture("xai/scoped-output.txt")).split("===/developers/rest-api-reference")[0];
    else llms.body = llms.body.replace("## At a glance\n", "## At a glance\n```\n") + "\n```";
    const result = parse("xai", "xai-models", bundle);
    const model = result.models.find((m) => m.model_id === "grok-4.7");
    expect(model).toBeDefined();
    expect(model?.limit_details).toBeUndefined();
    expect(model?.price_facts.length).toBeGreaterThan(0);
  },
);
