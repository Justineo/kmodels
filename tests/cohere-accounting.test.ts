import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vite-plus/test";
import { extractCoherePricingInputs } from "../src/catalog/cohere-accounting.ts";

const references = [
  ["/reference/chat.md", "chat.md", 2],
  ["/reference/chat-stream.md", "chat-stream.md", 2],
  ["/reference/chat-v1.md", "chat-v1.md", 2],
  ["/reference/chat-stream-v1.md", "chat-stream-v1.md", 2],
  ["/reference/embed.md", "embed.md", 2],
  ["/reference/rerank.md", "rerank.md", 1],
  ["/v2/reference/parse.md", "parse-api.md", 1],
] as const;

async function reference(name: string) {
  return readFile(new URL(`./fixtures/cohere/${name}`, import.meta.url), "utf8");
}

function parse(body: string, path = "/reference/chat.md", origin = "https://docs.cohere.com") {
  return extractCoherePricingInputs([{ url: `${origin}${path}`, body }], "cohere-models");
}

describe("Cohere response accounting ownership", () => {
  it.each(references)("preserves exact response counters in %s", async (path, file, count) => {
    const inputs = parse(await reference(file), path);
    expect(inputs).toHaveLength(count);
    expect(inputs.every(({ source_ref }) => source_ref === "cohere-models")).toBe(true);
    expect(parse((await reference(file)).replaceAll("\n", "\r\n"), path)).toEqual(inputs);
  });

  it("does not accept counters from request sections, copied paths or another operation", async () => {
    const body = await reference("chat.md");
    for (const invalid of [
      body.replace("## Response", "## Request"),
      body.replace('"usage": {', '"debug": {'),
      body.replace("/v2/chat", "/v1/chat"),
      body.replace("POST https:", "GET https:"),
      body.replace("## Response", "## Errors"),
      `${body}\n\n## Response\n\nUnresolved duplicate response.`,
    ])
      expect(parse(invalid)).toEqual([]);
    expect(parse(body, "/reference/chat.md", "https://example.com")).toEqual([]);
  });

  it("rejects invalid numeric examples locally without losing a valid sibling counter", async () => {
    const body = await reference("chat.md");
    for (const value of ['"5"', "-1", "null", "true"]) {
      const inputs = parse(body.replace('"input_tokens": 5', `"input_tokens": ${value}`));
      expect(inputs.map(({ key }) => key)).toEqual(["chat.v2.output_tokens"]);
    }
  });

  it.each([
    [
      "/reference/chat-stream.md",
      "chat-stream.md",
      '"type": "message-end"',
      '"type": "content-delta"',
    ],
    [
      "/reference/chat-stream-v1.md",
      "chat-stream-v1.md",
      '"event_type": "stream-end"',
      '"event_type": "text-generation"',
    ],
  ])("requires counters on the actual terminal event in %s", async (path, file, before, after) => {
    const body = await reference(file);
    expect(parse(`${body.replace(before, after)}\nThe final event is ${before}.`, path)).toEqual(
      [],
    );
  });

  it("does not combine a terminal discriminator with counters from another event", async () => {
    const body = await reference("chat-stream.md");
    const separated =
      body.replace('"type": "message-end"', '"type": "content-delta"') +
      '\n\n```json\n{"type":"message-end"}\n```\n';
    expect(parse(separated, "/reference/chat-stream.md")).toEqual([]);
    expect(
      parse(
        body.replace("event: message-end", "event: content-delta"),
        "/reference/chat-stream.md",
      ),
    ).toEqual([]);
  });

  it("resolves counters from the owned terminal schema without relying on an example", async () => {
    const body = await reference("chat-stream-response-fields.md");
    const path = "/reference/chat-stream.md";
    expect(parse(body, path).map(({ key }) => key)).toEqual([
      "chat.v2.input_tokens",
      "chat.v2.output_tokens",
    ]);
    for (const invalid of [
      body.replace("## Types", "## Request"),
      body.replace("### 200", "### 400"),
      body.replace("`type`: `message-end`", "`type`: `content-end`"),
      body.replace("`usage` (Usage, optional)", "`debug` (Usage, optional)"),
      body.replace(
        "`billed_units` (UsageBilledUnits, optional)",
        "`billed_units` (Usage, optional)",
      ),
      `${body}\n\n### UsageBilledUnits\n\n- \`input_tokens\` (double, optional)`,
      `\`\`\`text\n${body}\n\`\`\``,
      body
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n"),
    ])
      expect(parse(invalid, path)).toEqual([]);
    const mistyped = body.replace(
      "`input_tokens` (double, optional)",
      "`input_tokens` (string, optional)",
    );
    expect(parse(mistyped, path).map(({ key }) => key)).toEqual(["chat.v2.output_tokens"]);
  });

  it("retains an explicit schema counter when an optional response example omits it", async () => {
    const body = (await reference("parse-api.md")).replace(/"pages":\s*1/, '"items":1');
    expect(parse(body, "/v2/reference/parse.md").map(({ key }) => key)).toEqual(["parse.v2.pages"]);
  });

  it("rejects unrelated owners and duplicate native response fields", async () => {
    const body = await reference("embed-response-fields.md");
    for (const invalid of [
      body.replace(
        "- `meta` (object, optional)",
        "- unrelated object\n  - `meta` (object, optional)",
      ),
      body.replace(
        "- `meta` (object, optional)",
        "- `meta` (object, optional)\n- `meta` (object, optional)",
      ),
      body.replace("    - `input_tokens`", "   - unreviewed owner\n    - `input_tokens`"),
    ])
      expect(parse(invalid, "/reference/embed.md")).toEqual([]);
  });
});
