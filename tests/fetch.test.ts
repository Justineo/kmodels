import { generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { fetchSource } from "../src/catalog/fetch.ts";
import { manifests, type SourceManifest } from "../src/catalog/manifests.ts";

const transport = vi.hoisted(() => {
  const failures = new Map<string, { code: number | string; stderr: string }>();
  const calls: string[] = [];
  return { failures, calls };
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  transport.failures.clear();
  transport.calls.length = 0;
});

vi.mock("node:child_process", () => ({
  execFile: (...arguments_: unknown[]) => {
    const requestArguments = arguments_[1];
    const callback = arguments_.at(-1);
    if (!Array.isArray(requestArguments) || typeof callback !== "function")
      throw new Error("Unexpected curl invocation");
    const url = requestArguments.at(-1);
    if (typeof url !== "string") throw new Error("Curl invocation omitted its URL");
    transport.calls.push(url);
    const failure = transport.failures.get(new URL(url).hostname);
    if (failure !== undefined) {
      callback(
        Object.assign(new Error("Command failed: Authorization: Bearer private-token"), failure),
      );
      return;
    }
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
  it("keeps pooled public SageMaker requests inside the reviewed host boundary", async () => {
    const configured = manifests
      .find((manifest) => manifest.provider.id === "amazon-sagemaker")
      ?.sources.find((source) => source.id === "sagemaker-sdk");
    if (configured === undefined) throw new Error("Missing SageMaker source");
    const host = "jumpstart-cache-prod-us-west-2.s3.us-west-2.amazonaws.com";
    const source = { ...configured, url: `https://${host}/catalog.html`, allowedHosts: [host] };
    const calls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = input instanceof Request ? input.url : input.toString();
      calls.push(url);
      expect(init?.redirect).toBe("manual");
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return url === source.url
        ? new Response(null, {
            status: 302,
            headers: { Location: "https://unreviewed.test/models" },
          })
        : new Response("[]");
    });
    await expect(fetchSource(source)).rejects.toThrow("reviewed host allowlist");
    expect(calls.every((url) => new URL(url).hostname === host)).toBe(true);
    expect(transport.calls).toEqual([]);
  });

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
  it.each([
    { code: 28, stderr: "curl: (28) SSL connection timeout", reason: "TLS handshake timed out" },
    { code: 28, stderr: "curl: (28) Operation timed out", reason: "request timed out" },
    { code: 6, stderr: "curl: (6) Could not resolve host", reason: "DNS resolution failed" },
    {
      code: 60,
      stderr: "curl: (60) SSL certificate problem",
      reason: "TLS certificate validation failed",
    },
  ])(
    "retains bounded cloud transport diagnostics for $reason across three attempts",
    async ({ code, stderr, reason }) => {
      vi.spyOn(Math, "random").mockReturnValue(0);
      transport.failures.set("prices.azure.com", {
        code,
        stderr: `${stderr}\nprivate-token https://private.example/account`,
      });
      const source = manifests
        .find(({ provider }) => provider.id === "azure")
        ?.sources.find(({ id }) => id === "azure-retail-prices");
      if (source === undefined) throw new Error("Missing Azure retail source");
      const failure: unknown = await fetchSource(source).catch((error: unknown) => error);
      expect(failure).toMatchObject({
        message: `Azure Retail Prices transport failure (curl ${code}: ${reason})`,
      });
      expect(transport.calls).toHaveLength(3);
    },
  );

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
