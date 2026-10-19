import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vite-plus/test";
import { extractXaiPricingInputs } from "../src/catalog/xai-accounting.ts";

const fixture = () =>
  readFile(new URL("./fixtures/xai/accounting-rest.txt", import.meta.url), "utf8");
const keys = (body: string) =>
  extractXaiPricingInputs(body, "xai-models")
    .map(({ key }) => key)
    .sort();
const tiers = [
  "chat.served_service_tier.fast_priority_alias",
  "responses.served_service_tier.fast_priority_alias",
];

describe("xAI returned accounting fields", () => {
  it("reads the owned native SDK, image, video, and REST STT contracts", async () => {
    const body = await readFile(
      new URL("./fixtures/xai/accounting-services.txt", import.meta.url),
      "utf8",
    );
    expect(keys(body)).toEqual([
      "image.generated_images",
      "sdk.agent.cached_prompt_text_tokens",
      "sdk.agent.completion_tokens",
      "sdk.agent.prompt_image_tokens",
      "sdk.agent.prompt_tokens",
      "sdk.agent.reasoning_tokens",
      "sdk.server_side_tool_usage.code_execution",
      "sdk.server_side_tool_usage.collections_search",
      "sdk.server_side_tool_usage.web_search",
      "sdk.server_side_tool_usage.x_search",
      "stt.rest.audio_seconds",
      "video.generated_seconds",
    ]);
    expect(
      keys(body.replace("## POST /v1/images/generations", "## POST /v1/images/edits")),
    ).not.toContain("image.generated_images");
    expect(
      keys(body.replace("* `duration` (integer, required)", "* `duration` (string, required)")),
    ).not.toContain("video.generated_seconds");
  });
  it("reads owned native POST response fields and literal string tier enums", async () => {
    expect(keys(await fixture())).toEqual([
      "chat.served_service_tier.fast_priority_alias",
      "chat.usage.cached_prompt_text_tokens",
      "chat.usage.completion_tokens",
      "chat.usage.prompt_image_tokens",
      "chat.usage.prompt_text_tokens",
      "chat.usage.prompt_tokens",
      "chat.usage.reasoning_tokens",
      "responses.served_service_tier.fast_priority_alias",
      "responses.usage.cached_input_tokens",
      "responses.usage.input_tokens",
      "responses.usage.output_tokens",
      "responses.usage.x_posts_fetched",
      "responses.usage.x_users_fetched",
    ]);
  });

  it.each(["method", "request", "fence", "quote"])("rejects %s lookalikes", async (kind) => {
    let body = await fixture();
    if (kind === "method") body = body.replaceAll("## POST ", "## GET ");
    if (kind === "request") body = body.replaceAll("### Response Body", "### Request Body");
    if (kind === "fence") body = `\`\`\`markdown\n${body}\n\`\`\``;
    if (kind === "quote")
      body = body
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
    expect(keys(body)).toEqual([]);
  });

  it("keeps real responses separate from similarly named request parents", async () => {
    const body = (await fixture()).replaceAll(
      "* `usage` (object)",
      "* `request_metadata` (object)",
    );
    expect(keys(body)).toEqual(tiers);
  });

  it("drops only the mistyped counter", async () => {
    const body = await fixture();
    expect(
      keys(
        body.replace(
          "* `prompt_tokens` (integer, required)",
          "* `prompt_tokens` (string, required)",
        ),
      ),
    ).toEqual(keys(body).filter((key) => key !== "chat.usage.prompt_tokens"));
  });

  it("rejects duplicate response owners and keeps the independent protocol", async () => {
    const body = await fixture();
    const end = body.indexOf("===/developers/rest-api-reference/inference/responses===");
    expect(end).toBeGreaterThan(0);
    expect(keys(`${body}\n${body.slice(0, end)}`)).toEqual(
      keys(body)
        .filter((key) => key.startsWith("responses."))
        .map((key) => key.replace(".fast_priority_alias", "")),
    );
  });

  it("cannot promote invalid indentation into an owned counter", async () => {
    const body = await fixture();
    expect(keys(body.replace("    * `text_tokens`", "   * `text_tokens`"))).toEqual(
      keys(body).filter((key) => key !== "chat.usage.prompt_text_tokens"),
    );
  });

  it("does not invent request counters from billing prose", () => {
    const body = `===/developers/rest-api-reference/inference/voice===
Text to speech uses text string input and bills per character.
Streaming text.delta and text.done bill per character.
===/developers/rest-api-reference/inference/images===
Image edit accepts images and resolution and quality.
===/developers/rest-api-reference/inference/videos===
Request body accepts image, video input and resolution.
===/developers/model-capabilities/audio/speech-to-speech===
conversation.item.create function_call_output input_audio
`;
    expect(keys(body)).toEqual([]);
  });

  it("keeps ordinary tier fields when the alias relationship is no longer proved", async () => {
    const inputs = extractXaiPricingInputs(
      (await fixture()).replace("are interchangeable", "are separate"),
      "xai-models",
    );
    expect(
      inputs.filter(({ key }) => key.includes("served_service_tier")).map(({ key }) => key),
    ).toEqual(["chat.served_service_tier", "responses.served_service_tier"]);
  });

  it("does not borrow a tier alias from an unrelated response field", async () => {
    const body = (await fixture()).replace("* `service_tier`", "* `description`");
    expect(keys(body)).toContain("responses.served_service_tier");
    expect(keys(body).some((key) => key.endsWith(".fast_priority_alias"))).toBe(false);
  });

  it("requires an owned numeric REST duration rather than streaming mentions", () => {
    const prefix = "===/developers/rest-api-reference/inference/speech-to-text===\n";
    expect(keys(`${prefix}Speech to text duration audio duration transcript.done`)).toEqual([]);
    expect(
      keys(
        `${prefix}## POST /v1/stt\n### Response Body\n* \`duration\` (number, required) — Audio duration in seconds.`,
      ),
    ).toEqual(["stt.rest.audio_seconds"]);
  });
});
