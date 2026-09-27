import { readFile } from "node:fs/promises";
import { expect, it } from "vite-plus/test";
import { parseSource } from "../src/catalog/adapters.ts";
import { extractCoherePricingInputs } from "../src/catalog/cohere-accounting.ts";
import { extractDeepseekPricingInputs } from "../src/catalog/deepseek-accounting.ts";
import { manifests } from "../src/catalog/manifests.ts";

const fixture = (name: string) => readFile(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

it("accepts reviewed path-based DashScope recommendations without relaxing the live count guard", async () => {
  const manifest = manifests.find(({ provider }) => provider.id === "dashscope");
  const source = manifest?.sources.find(({ id }) => id === "dashscope-recommended");
  if (!manifest || !source) throw new Error("Missing DashScope manifest");
  const body = await fixture("dashscope/recommended-path-links.md");
  const parse = (body: string) =>
    parseSource({
      provider: { ...manifest.provider, source_ids: [source.id] },
      source,
      body,
      observedAt: "2026-09-20T02:06:07.280Z",
    });
  const models = parse(body);
  expect(models).toHaveLength(28);
  expect(models.find(({ model_id }) => model_id === "ZHIPU/GLM-5.3")).toMatchObject({
    availability: [{ region: "Singapore", deployment_type: "model_api" }],
  });
  expect(models.find(({ model_id }) => model_id === "MiniMax-M2.5")).toMatchObject({
    availability: [{ region: "China (Beijing)", deployment_type: "model_api" }],
  });
  expect(models.every(({ api_endpoints }) => api_endpoints === undefined)).toBe(true);
  for (const invalid of [
    body.replaceAll("/model/market/detail/", "/model/unknown/detail/"),
    body.replaceAll("modelstudio.console.alibabacloud.com", "example.com"),
    body.replaceAll("/ap-southeast-1/model/", "/unknown-region/model/"),
  ])
    expect(() => parse(invalid)).toThrow();
});

it("reads DeepSeek terminal usage through inline HTML and preserves nested cache ownership", async () => {
  const chat = await fixture("deepseek/chat-accounting-inline.html");
  const responses = await fixture("deepseek/responses-accounting-nested.html");
  const parse = (body: string) =>
    extractDeepseekPricingInputs(
      [
        { url: "https://api-docs.deepseek.com/api/create-chat-completion", body: chat },
        { url: "https://api-docs.deepseek.com/api/create-completion", body: chat },
        { url: "https://api-docs.deepseek.com/api/create-response", body },
      ],
      "deepseek-catalog",
    );
  const inputs = parse(responses);
  expect(inputs).toHaveLength(18);
  expect(inputs).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        key: "chat.stream.cached_input_tokens",
        locator: { kind: "json_pointer", value: "/usage/prompt_cache_hit_tokens" },
      }),
      expect.objectContaining({
        key: "responses.stream.cached_input_tokens",
        locator: {
          kind: "json_pointer",
          value: "/response/usage/input_tokens_details/cached_tokens",
        },
      }),
    ]),
  );
  for (const invalid of [
    responses.replaceAll("input_tokens_details", "output_tokens_details"),
    responses.replaceAll(">usage<", ">unbilled_usage<"),
    responses.replaceAll("cached_tokens", "other_tokens"),
  ])
    expect(
      parse(invalid).some(
        ({ key }) => key.startsWith("responses.") && key.endsWith("cached_input_tokens"),
      ),
    ).toBe(false);
  const incompleteStream = responses.replaceAll("response.failed", "response.other");
  expect(
    parse(incompleteStream).some(({ key }) => key === "responses.stream.cached_input_tokens"),
  ).toBe(false);
  expect(parse(incompleteStream).some(({ key }) => key === "responses.cached_input_tokens")).toBe(
    true,
  );
});

it("recognizes Cohere billed image tokens only under the documented response path", async () => {
  const body = await fixture("cohere/embed-response-fields.md");
  const parse = (body: string) =>
    extractCoherePricingInputs(
      [{ url: "https://docs.cohere.com/reference/embed.md", body }],
      "cohere-models",
    ).filter(({ key }) => key.startsWith("embed.v2."));
  expect(parse(body)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        key: "embed.v2.input_tokens",
        locator: { kind: "json_pointer", value: "/meta/billed_units/input_tokens" },
      }),
      expect.objectContaining({
        key: "embed.v2.image_tokens",
        locator: { kind: "json_pointer", value: "/meta/billed_units/image_tokens" },
      }),
    ]),
  );
  for (const invalid of [
    body.replace("## Response", "## Request"),
    body.replace("`billed_units`", "`unbilled_units`"),
    body.replace("`meta`", "`other`"),
    body.replace("/v2/embed", "/v1/embed"),
    body.replace("`image_tokens` (double, optional)", "`other_tokens` (double, optional)"),
    body.replace("`image_tokens` (double, optional)", "`image_tokens` (string, optional)"),
  ])
    expect(parse(invalid).some(({ key }) => key === "embed.v2.image_tokens")).toBe(false);
  const sibling = body.replace("    - `image_tokens`", "  - `image_tokens`");
  expect(parse(sibling).some(({ key }) => key === "embed.v2.image_tokens")).toBe(false);
});
