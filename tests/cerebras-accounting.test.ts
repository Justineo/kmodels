import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vite-plus/test";
import { extractCerebrasPricingInputs } from "../src/catalog/cerebras-accounting.ts";

const references = [
  ["chat-completions", "https://inference-docs.cerebras.ai/api-reference/chat-completions.md"],
  ["completions", "https://inference-docs.cerebras.ai/api-reference/completions.md"],
  ["batch", "https://inference-docs.cerebras.ai/capabilities/batch.md"],
  ["cache", "https://inference-docs.cerebras.ai/capabilities/prompt-caching.md"],
  [
    "sdk-readme",
    "https://raw.githubusercontent.com/Cerebras/cerebras-cloud-sdk-python/main/README.md",
  ],
] as const;

async function documents(overrides: Record<string, string> = {}) {
  return Promise.all(
    references.map(async ([name, url]) => ({
      url,
      body:
        overrides[name] ??
        (await readFile(new URL(`./fixtures/cerebras/${name}.md`, import.meta.url), "utf8")),
    })),
  );
}

async function inputs(overrides: Record<string, string> = {}) {
  return extractCerebrasPricingInputs({
    documents: await documents(overrides),
    sourceRef: "cerebras-catalog",
  });
}

describe("Cerebras accounting ownership", () => {
  it("preserves typed response, final-stream and successful-result contracts", async () => {
    const facts = await inputs();
    expect(facts).toHaveLength(14);
    expect(facts.every(({ source_ref }) => source_ref === "cerebras-catalog")).toBe(true);
    expect(facts.filter(({ channel }) => channel === "stream_event")).toHaveLength(6);
    expect(facts.filter(({ channel }) => channel === "result")).toHaveLength(2);
  });

  it("binds Chat fields to the actual operation response and its declared integer schema", async () => {
    const body = (await documents())[0]?.body;
    if (body === undefined) throw new Error("Missing Chat fixture");
    for (const invalid of [
      body.replace("post:", "get:"),
      body.replaceAll("/v1/chat/completions", "/v1/another-operation"),
      body.replace("#/components/schemas/ChatCompletionResponse", "#/components/schemas/Request"),
      body.replace(/^ {8}usage:/m, "        request_usage:"),
    ]) {
      expect(invalid).not.toBe(body);
      expect(
        (await inputs({ "chat-completions": invalid })).filter(({ key }) =>
          key.startsWith("chat."),
        ),
      ).toEqual([]);
    }
    expect(
      await inputs({
        "chat-completions": body.replace(
          "operationId: createChatCompletion",
          "operationId: anotherOperation",
        ),
      }),
    ).toEqual(await inputs());
    const changed = body.replace(
      "prompt_tokens:\n              type: integer",
      "prompt_tokens:\n              type: string",
    );
    const remaining = await inputs({ "chat-completions": changed });
    expect(remaining).toHaveLength(12);
    expect(remaining.some(({ key }) => key === "chat.output_tokens")).toBe(true);
  });

  it("requires Completions response fields to keep their typed parents", async () => {
    const body = (await documents())[1]?.body;
    if (body === undefined) throw new Error("Missing Completions fixture");
    for (const invalid of [
      body.replace("## Completion Response", "## Request Example"),
      body.replace('name="usage"', 'name="debug"'),
      body.replace("curl -X POST", "curl -X GET"),
    ])
      expect(
        (await inputs({ completions: invalid })).filter(({ key }) =>
          key.startsWith("completions."),
        ),
      ).toEqual([]);
    expect(
      (
        await inputs({
          completions: body.replace(
            'name="cached_tokens" type="integer"',
            'name="cached_tokens" type="string"',
          ),
        })
      ).some(({ key }) => key === "completions.cached_input_tokens"),
    ).toBe(false);
  });

  it("does not borrow an official path from a foreign or duplicate document", async () => {
    const original = await documents();
    const chat = original[0];
    if (chat === undefined) throw new Error("Missing Chat fixture");
    for (const changed of [
      [
        { ...chat, url: chat.url.replace("inference-docs.cerebras.ai", "example.com") },
        ...original.slice(1),
      ],
      [...original, chat],
    ])
      expect(
        extractCerebrasPricingInputs({ documents: changed, sourceRef: "cerebras-catalog" }).filter(
          ({ key }) => key.startsWith("chat."),
        ),
      ).toEqual([]);
  });

  it("does not promote a copied terminal policy from another Markdown section or a code fence", async () => {
    const body = (await documents())[4]?.body;
    if (body === undefined) throw new Error("Missing SDK fixture");
    for (const changed of [
      body.replace("## Streaming responses", "## Request Examples"),
      body.replace("Note that", "```text\nNote that") + "\n```\n",
    ]) {
      const facts = await inputs({ "sdk-readme": changed });
      expect(facts).toHaveLength(8);
      expect(facts.filter(({ channel }) => channel === "stream_event")).toEqual([]);
    }
  });

  it("keeps successful Batch status and counters on the same result record", async () => {
    const body = (await documents())[2]?.body;
    if (body === undefined) throw new Error("Missing Batch fixture");
    const split = body.replace(
      /```json[^]*?```/u,
      '```jsonl\n{"status":"succeeded"}\n{"status":"failed","response":{"usage":{"prompt_tokens":15,"completion_tokens":85}}}\n```',
    );
    expect((await inputs({ batch: split })).filter(({ channel }) => channel === "result")).toEqual(
      [],
    );
    expect(
      (await inputs({ batch: body.replace('"prompt_tokens": 15', '"prompt_tokens": "15"') })).map(
        ({ key }) => key,
      ),
    ).not.toContain("batch.result.input_tokens");
  });

  it("does not make API field availability depend on an unrelated pricing-policy statement", async () => {
    const original = await documents();
    const batch = original[2]?.body;
    if (batch === undefined) throw new Error("Missing Batch fixture");
    expect(
      await inputs({
        cache: "# Caching\nPricing is unspecified.",
        batch: batch.replace(
          "You're only charged for\nrequests that completed.",
          "Billing is unspecified.",
        ),
      }),
    ).toEqual(await inputs());
  });
});
