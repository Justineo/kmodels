import { describe, expect, it, vi } from "vite-plus/test";
import { fetchSource } from "../src/catalog/fetch.ts";
import type { SourceManifest } from "../src/catalog/manifests.ts";

vi.mock("node:child_process", () => ({
  execFile: (...arguments_: unknown[]) => {
    const requestArguments = arguments_[1];
    const callback = arguments_.at(-1);
    if (!Array.isArray(requestArguments) || typeof callback !== "function")
      throw new Error("Unexpected curl invocation");
    const url = requestArguments.at(-1);
    if (typeof url !== "string") throw new Error("Curl invocation omitted its URL");
    const bodies = new Map([
      [
        "https://example.test/index.md",
        "[Available](https://example.test/available.md)\n[Missing](https://example.test/missing.md)",
      ],
      ["https://example.test/available.md", "# Available"],
    ]);
    const body = bodies.get(url) ?? "Not found";
    const status = bodies.has(url) ? "200 OK" : "404 Not Found";
    callback(null, {
      stdout: `HTTP/1.1 ${status}\r\ncontent-type: text/plain\r\n\r\n${body}`,
      stderr: "",
    });
  },
}));

describe("linked source fetch", () => {
  it("separates missing discovered documents from missing fixed dependencies", async () => {
    const source: SourceManifest = {
      id: "test",
      url: "https://example.test/index.md",
      type: "website",
      source: ["website"],
      access: "public",
      format: "markdown",
      stability: "documented",
      extractor: { kind: "openai-catalog" },
      extractorVersion: "test-v1",
      fields: ["model_id", "pricing"],
      allowedHosts: ["example.test"],
      maxResponseBytes: 64 * 1024,
      linkedDocuments: {
        path: /^\/(?:available|missing)$/,
        minDocuments: 2,
        maxDocuments: 2,
        concurrency: 2,
        discoverySuffix: ".md",
        requestSuffix: ".md",
        optionalDocuments: true,
        documents: [
          {
            id: "fixed-missing",
            url: "https://example.test/fixed-missing.md",
            maxResponseBytes: 1024,
            optional: true,
          },
          {
            id: "claim-local-missing",
            url: "https://example.test/claim-local-missing.md",
            maxResponseBytes: 1024,
            optional: true,
            claimLocal: true,
          },
        ],
      },
    };

    const result = await fetchSource(source);

    expect(result.omittedOptionalDocuments).toEqual(["test/missing", "test/claim-local-missing"]);
    expect(result.omittedOptionalDependencies).toEqual(["test/fixed-missing"]);
    expect(result.dependencies.map(({ key }) => key)).toEqual(["test/index", "test/available"]);
  });
});
