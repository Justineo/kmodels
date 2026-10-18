import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vite-plus/test";
import { extractMistralPricingInputs } from "../src/catalog/mistral-accounting.ts";
import { yamlBlock } from "../src/catalog/yaml.ts";

const root = "https://raw.githubusercontent.com/mistralai/platform-docs-public/main";
const fixtures = [
  ["openapi.yaml", `${root}/openapi.yaml`],
  [
    "prompt-caching.md",
    `${root}/src/content/en/docs/studio/conversations/advanced/prompt-caching/page.mdx`,
  ],
  [
    "code-interpreter.mdx",
    `${root}/src/content/en/docs/studio/agents/agent-tools/code_interpreter/page.mdx`,
  ],
  ["web-search.mdx", `${root}/src/content/en/docs/studio/agents/agent-tools/websearch/page.mdx`],
  [
    "image-generation.mdx",
    `${root}/src/content/en/docs/studio/agents/agent-tools/image_generation/page.mdx`,
  ],
  ["libraries.mdx", `${root}/src/content/en/docs/studio/search/libraries/page.mdx`],
] as const;
const fixture = (file: string) =>
  readFile(new URL(`./fixtures/mistral/${file}`, import.meta.url), "utf8");

function changeSchema(body: string, schema: string, edit: (block: string) => string): string {
  const block = yamlBlock(body, schema, 4);
  if (block === undefined) throw new Error(`Missing fixture schema ${schema}`);
  const changed = edit(block);
  if (changed === block) throw new Error(`Fixture mutation did not change ${schema}`);
  return body.replace(block, changed);
}

async function documents(edit: (body: string) => string = (body) => body) {
  return Promise.all(
    fixtures.map(async ([file, url]) => ({
      url,
      body: file === "openapi.yaml" ? edit(await fixture(file)) : await fixture(file),
    })),
  );
}

async function inputs(edit?: (body: string) => string) {
  return extractMistralPricingInputs(await documents(edit), "mistral-pricing");
}

describe("Mistral accounting ownership and types", () => {
  it("retains all reviewed quantity contracts", async () => {
    const facts = await inputs();
    expect(facts).toHaveLength(20);
    expect(facts).toContainEqual(
      expect.objectContaining({
        key: "completion.stream.cached_tokens",
        absent_value: "zero",
        availability: "terminal_only",
      }),
    );
    expect(facts).toContainEqual(
      expect.objectContaining({
        key: "service.code_interpreter.completed_calls",
        locator: { kind: "json_pointer", value: "/usage/connectors/code_interpreter" },
      }),
    );
  });

  it.each([
    [
      "wrong token type",
      "UsageInfo",
      (block: string) =>
        block.replace(
          "prompt_tokens:\n          type: integer",
          "prompt_tokens:\n          type: string",
        ),
      "completion.response.prompt_tokens",
      "conversation.response.prompt_tokens",
    ],
    [
      "nested counter lookalike",
      "UsageInfo",
      (block: string) =>
        block.replace(
          "        prompt_tokens:\n          type: integer",
          "        details:\n          properties:\n            prompt_tokens:\n              type: integer",
        ),
      "completion.response.prompt_tokens",
      "completion.response.completion_tokens",
    ],
    [
      "duplicate counter",
      "UsageInfo",
      (block: string) =>
        block.replace(
          "        prompt_tokens:\n          type: integer",
          "        prompt_tokens:\n          type: integer\n        prompt_tokens:\n          type: string",
        ),
      "completion.stream.prompt_tokens",
      "conversation.response.prompt_tokens",
    ],
    [
      "detached Chat response",
      "ChatCompletionResponse",
      (block: string) =>
        block.replace(
          "#/components/schemas/ChatCompletionResponseBase",
          "#/components/schemas/MissingResponseBase",
        ),
      "completion.response.prompt_tokens",
      "embedding.response.prompt_tokens",
    ],
    [
      "detached FIM response",
      "FIMCompletionResponse",
      (block: string) =>
        block.replace(
          "#/components/schemas/ChatCompletionResponse",
          "#/components/schemas/MissingResponse",
        ),
      "completion.response.prompt_tokens",
      "completion.stream.prompt_tokens",
    ],
    [
      "nested usage lookalike",
      "ResponseBase",
      (block: string) =>
        block.replace(
          "        usage:",
          "        details:\n          properties:\n            usage:",
        ),
      "completion.response.prompt_tokens",
      "completion.stream.prompt_tokens",
    ],
    [
      "invalid usage container",
      "ResponseBase",
      (block: string) => block.replace("        usage:", "        usage:\n          type: string"),
      "embedding.response.prompt_tokens",
      "conversation.response.prompt_tokens",
    ],
    [
      "wrong OCR page type",
      "OCRUsageInfo",
      (block: string) => block.replace("type: integer", "type: array"),
      "ocr.response.pages_processed",
      "completion.stream.prompt_tokens",
    ],
    [
      "wrong request input type",
      "SpeechRequest",
      (block: string) => block.replace("type: string", "type: number"),
      "speech.request.input_characters",
      "ocr.response.pages_processed",
    ],
    [
      "wrong audio quantity type",
      "UsageInfo",
      (block: string) =>
        block.replace(
          "prompt_audio_seconds:\n          type: integer",
          "prompt_audio_seconds:\n          type: string",
        ),
      "transcription.response.prompt_audio_seconds",
      "completion.response.prompt_tokens",
    ],
    [
      "wrong connector map values",
      "ConversationUsageInfo",
      (block: string) =>
        block.replace(/(additionalProperties:\n +)type: integer/, "$1type: string"),
      "service.code_interpreter.completed_calls",
      "conversation.response.prompt_tokens",
    ],
    [
      "untyped connector map",
      "ConversationUsageInfo",
      (block: string) =>
        block.replace(/additionalProperties:\n +type: integer/, "additionalProperties: true"),
      "service.web_search.completed_calls",
      "conversation.response.prompt_tokens",
    ],
    [
      "invalid image output container",
      "ConversationResponse",
      (block: string) =>
        block.replace("outputs:\n          type: array", "outputs:\n          type: string"),
      "service.image_generation.generated_images",
      "conversation.response.prompt_tokens",
    ],
    [
      "conflicting counter union",
      "UsageInfo",
      (block: string) =>
        block.replace(
          "prompt_tokens:\n          type: integer",
          "prompt_tokens:\n          anyOf:\n          - type: integer\n          - type: string",
        ),
      "completion.response.prompt_tokens",
      "completion.response.completion_tokens",
    ],
    [
      "untyped counter union alternative",
      "UsageInfo",
      (block: string) =>
        block.replace(
          "prompt_tokens:\n          type: integer",
          "prompt_tokens:\n          anyOf:\n          - type: integer\n          - type:",
        ),
      "completion.response.prompt_tokens",
      "completion.response.completion_tokens",
    ],
  ] as const)(
    "withholds %s without losing independent quantities",
    async (_name, schema, edit, removed, preserved) => {
      const keys = (await inputs((body) => changeSchema(body, schema, edit))).map(({ key }) => key);
      expect(keys).not.toContain(removed);
      expect(keys).toContain(preserved);
    },
  );

  it("rejects duplicate schema definitions instead of selecting the first", async () => {
    const facts = await inputs((body) => {
      const block = yamlBlock(body, "UsageInfo", 4);
      if (block === undefined) throw new Error("Missing usage fixture");
      return body + "\n" + block;
    });
    expect(facts.some(({ key }) => key === "completion.response.prompt_tokens")).toBe(false);
    expect(facts.some(({ key }) => key === "conversation.response.prompt_tokens")).toBe(true);
  });

  it("accepts an owned inline cache object instead of requiring a particular referenced schema name", async () => {
    const facts = await inputs((body) =>
      changeSchema(body, "UsageInfo", (block) =>
        block.replace(
          '          $ref: "#/components/schemas/PromptTokensDetails"',
          "          type: object\n          properties:\n            cached_tokens:\n              type: integer",
        ),
      ),
    );
    expect(facts).toHaveLength(20);
  });

  it("keeps nullable counters and numeric audio seconds", async () => {
    const facts = await inputs((body) =>
      changeSchema(body, "UsageInfo", (block) =>
        block
          .replace(
            "prompt_tokens:\n          type: integer",
            "prompt_tokens:\n          anyOf:\n          - type: integer\n          - type: 'null'",
          )
          .replace(
            "prompt_audio_seconds:\n          type: integer",
            "prompt_audio_seconds:\n          type: number",
          ),
      ),
    );
    expect(facts).toHaveLength(20);
  });

  it("does not require usage counters to count independently documented image outputs", async () => {
    const facts = await inputs((body) =>
      changeSchema(body, "ConversationResponse", (block) =>
        block.replace(
          "#/components/schemas/ConversationUsageInfo",
          "#/components/schemas/MissingUsage",
        ),
      ),
    );
    expect(facts.some(({ key }) => key === "conversation.response.prompt_tokens")).toBe(false);
    expect(facts.some(({ key }) => key === "service.image_generation.generated_images")).toBe(true);
  });

  it("accepts the native indentless compositions and nullable connector map", async () => {
    const facts = await inputs((body) => {
      const response = changeSchema(body, "ChatCompletionResponse", (block) =>
        block.replace(/\n {8}- /g, "\n      - "),
      );
      return changeSchema(response, "ConversationUsageInfo", (block) =>
        block.replace(
          /        connectors:[\s\S]*$/,
          "        connectors:\n          anyOf:\n          - type: object\n            additionalProperties:\n              type: integer\n          - type: 'null'",
        ),
      );
    });
    expect(facts).toHaveLength(20);
  });

  it.each(["openapi.yaml", "code-interpreter.mdx"] as const)(
    "withholds ambiguous duplicate companions: %s",
    async (file) => {
      const items = await documents();
      const url = fixtures.find(([name]) => name === file)?.[1];
      const duplicate = items.find((item) => item.url === url);
      if (duplicate === undefined) throw new Error("Missing companion fixture");
      const facts = extractMistralPricingInputs([...items, duplicate], "mistral-pricing");
      expect(facts).toHaveLength(file === "openapi.yaml" ? 0 : 19);
    },
  );
});
