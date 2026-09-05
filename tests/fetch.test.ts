import { generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { fetchSource } from "../src/catalog/fetch.ts";
import { manifests, type SourceManifest } from "../src/catalog/manifests.ts";

afterEach(() => vi.unstubAllEnvs());

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
    if (url === "https://oauth2.googleapis.com/token") {
      callback(null, {
        stdout:
          'HTTP/1.1 400 Bad Request\r\ncontent-type: application/json\r\n\r\n{"error":"invalid_grant","error_description":"Invalid JWT Signature."}',
        stderr: "",
      });
      return;
    }
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

describe("authenticated cloud fetch", () => {
  it("reports a bounded Google OAuth error code", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    vi.stubEnv(
      "GOOGLE_SERVICE_ACCOUNT_JSON",
      JSON.stringify({
        type: "service_account",
        project_id: "test-project",
        private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
        client_email: "collector@test-project.iam.gserviceaccount.com",
        token_uri: "https://oauth2.googleapis.com/token",
      }),
    );
    const source = manifests
      .find(({ provider }) => provider.id === "vertex")
      ?.sources.find(({ id }) => id === "vertex-model-garden-api");
    if (source === undefined) throw new Error("Missing Vertex Model Garden source");

    await expect(fetchSource(source)).rejects.toThrow("Google OAuth HTTP 400 (invalid_grant)");
  });
});
