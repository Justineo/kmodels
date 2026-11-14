import { generateKeyPairSync } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  fetchSource,
  linkedDocumentUrls,
  type SagemakerDiscoveryCache,
} from "../src/catalog/fetch.ts";
import { sha256 } from "../src/catalog/io.ts";
import { manifests, type SourceManifest } from "../src/catalog/manifests.ts";
import { linkedPublicSource, reviewedPublicSource } from "../src/catalog/public-evidence.ts";
import { sourceFailure } from "../src/catalog/source-failure.ts";
import { fireworksBundle } from "./fireworks-fixture.ts";
import { nvidiaBuildUrl } from "../src/catalog/nvidia-build.ts";

const transport = vi.hoisted(() => {
  const failures = new Map<string, { code: number | string; stderr: string }>();
  const responses = new Map<string, string[]>();
  const calls: string[] = [];
  return { failures, responses, calls };
});

it.each(["native", "web fallback", "failed companion", "repeated page"])(
  "collects NVIDIA endpoint APIs with %s evidence",
  async (scenario) => {
    const source = reviewedPublicSource("nvidia-nim-cards");
    const body = JSON.stringify({
      object: "list",
      data: [{ object: "model", id: "nvidia/body-pose" }],
    });
    transport.responses.set("integrate.api.nvidia.com", [`HTTP/1.1 200 OK\r\n\r\n${body}`]);
    const labels = [
      { key: "publisher", values: ["nvidia"], unresolvedValues: ["nvidia"] },
      { key: "nimType", values: ["Free Endpoint"], unresolvedValues: ["nim_type_preview"] },
    ];
    const resource = (name: string) => ({
      resourceType: "ENDPOINT",
      resourceId: `qc69jvmznzxy/${name}`,
      name,
      labels: name === "body-pose" ? labels : [],
    });
    const first = [
      resource("body-pose"),
      ...Array.from({ length: 99 }, (_value, index) => resource(`download-${index}`)),
    ];
    const page = (index: number, resources: ReturnType<typeof resource>[]) =>
      JSON.stringify({
        params: { page: index, pageSize: 100 },
        resultPageTotal: 2,
        resultTotal: 101,
        results: [{ groupValue: "ENDPOINT", resources }],
      });
    const fixture = JSON.parse(
      await readFile(new URL("./fixtures/nvidia/build-endpoints.json", import.meta.url), "utf8"),
    );
    const endpoint = fixture[1];
    transport.responses.set(
      "api.ngc.nvidia.com",
      [
        page(0, first),
        page(scenario === "repeated page" ? 0 : 1, [resource("last-download")]),
        scenario === "native" ? JSON.stringify(endpoint.metadata) : undefined,
        JSON.stringify({ ...endpoint.spec, unconsumedPadding: "x".repeat(3 * 1024 * 1024) }),
      ].map((value) =>
        value === undefined
          ? "HTTP/1.1 404 Not Found\r\n\r\nmissing"
          : `HTTP/1.1 200 OK\r\n\r\n${value}`,
      ),
    );
    transport.responses.set("build.nvidia.com", [
      scenario === "failed companion"
        ? "HTTP/1.1 404 Not Found\r\n\r\nmissing"
        : "HTTP/1.1 200 OK\r\n\r\n<html>Reviewed card</html>",
    ]);
    const result = fetchSource(source);
    if (scenario === "repeated page") await expect(result).rejects.toThrow(/pagination/);
    else {
      const fetched = await result;
      expect(transport.calls.slice(1, 3)).toEqual([nvidiaBuildUrl().href, nvidiaBuildUrl(1).href]);
      if (scenario === "native") {
        expect(transport.calls.some((url) => new URL(url).hostname === "build.nvidia.com")).toBe(
          false,
        );
        expect(JSON.parse(fetched.body).documents).toContainEqual(
          expect.objectContaining({
            url: "https://api.ngc.nvidia.com/v2/endpoints/qc69jvmznzxy/body-pose/spec",
          }),
        );
      } else if (scenario === "web fallback")
        expect(JSON.parse(fetched.body).documents).toContainEqual({
          url: "https://build.nvidia.com/nvidia/body-pose",
          body: "<html>Reviewed card</html>",
        });
      else
        expect(fetched.dependencyFailures).toEqual([expect.objectContaining({ impact: "claim" })]);
    }
  },
);

it.each(["complete", "profile failure"])(
  "requires bounded Fireworks console evidence: %s",
  async (scenario) => {
    const source = reviewedPublicSource("fireworks-serverless");
    transport.responses.set(
      "fireworks.ai",
      [
        fireworksBundle.index,
        ...fireworksBundle.documents.filter(({ url }) => new URL(url).hostname === "fireworks.ai"),
      ].map(({ body }) => `HTTP/1.1 200 OK\r\n\r\n${body}`),
    );
    transport.responses.set(
      "app.fireworks.ai",
      fireworksBundle.documents
        .filter(({ url }) => new URL(url).hostname === "app.fireworks.ai")
        .map(({ body }) =>
          scenario === "complete"
            ? `HTTP/1.1 200 OK\r\n\r\n${body}`
            : "HTTP/1.1 404 Not Found\r\n\r\nmissing",
        ),
    );
    const result = fetchSource({
      ...source,
      linkedDocuments: {
        path: /^\/models\/[a-z0-9._-]+\/[a-z0-9._-]+\/$/u,
        minDocuments: 1,
        maxDocuments: 100,
        concurrency: 1,
      },
    });
    if (scenario === "profile failure") await expect(result).rejects.toThrow();
    else {
      const fetched = await result;
      const bundle = JSON.parse(fetched.body);
      expect(
        bundle.documents.filter(
          (document: { url: string }) => new URL(document.url).hostname === "app.fireworks.ai",
        ),
      ).toHaveLength(4);
      expect(fetched.dependencies.filter(({ key }) => key.includes("/console/"))).toHaveLength(4);
      expect(transport.calls.some((url) => url.includes("dedicated-only"))).toBe(false);
    }
  },
);

it.each(["complete", "card failure"])(
  "acquires missing Together cache price cards with %s evidence",
  async (scenario) => {
    const source = reviewedPublicSource("together-serverless");
    const library = await readFile(
      new URL("./fixtures/together/cache-library.html", import.meta.url),
      "utf8",
    );
    const card = await readFile(
      new URL("./fixtures/together/cache-card.html", import.meta.url),
      "utf8",
    );
    const body = [
      "## Chat models",
      "| Model name | API model string | Cached input pricing (per 1M tokens) |",
      "| - | - | - |",
      "| Ripple | ricursive-ai/Ripple-65B-Preview | - |",
      "## Vision models",
      "| Model name | API model string | Cached input pricing (per 1M tokens) |",
      "| - | - | - |",
      "| Other | Example/Other | $0.1 |",
    ].join("\n");
    transport.responses.set("docs.together.ai", [`HTTP/1.1 200 OK\r\n\r\n${body}`]);
    transport.responses.set("www.together.ai", [
      `HTTP/1.1 200 OK\r\n\r\n${library.replace("</main>", '<a class="w-pagination-next" href="?dac2a22c_page=2">Next</a></main>')}`,
      `HTTP/1.1 200 OK\r\n\r\n${library}`,
      scenario === "complete"
        ? `HTTP/1.1 200 OK\r\n\r\n${card}`
        : "HTTP/1.1 404 Not Found\r\n\r\nmissing",
    ]);
    const result = fetchSource({
      ...source,
      linkedDocuments: { path: /$a/, minDocuments: 0, maxDocuments: 0, concurrency: 1 },
    });
    if (scenario === "card failure") {
      await expect(result).rejects.toThrow("failed");
    } else {
      const fetched = await result;
      expect(JSON.parse(fetched.body)).toMatchObject({
        index: { body },
        documents: expect.arrayContaining([
          { url: "https://www.together.ai/models/ripple-65b-preview", body: card },
        ]),
      });
      expect(transport.calls).toEqual([
        source.url,
        "https://www.together.ai/models",
        "https://www.together.ai/models?dac2a22c_page=2",
        "https://www.together.ai/models/ripple-65b-preview",
      ]);
      expect(fetched.dependencies.some(({ key }) => key.includes("/price-cards"))).toBe(true);
    }
  },
);

it.each(["complete", "changed filter", "repeated cursor"])(
  "validates HF Inference pagination with a %s response",
  async (scenario) => {
    const source = reviewedPublicSource("huggingface-hf-inference");
    const next = new URL(source.url);
    next.searchParams.set("cursor", "next-page");
    if (scenario === "changed filter") next.searchParams.append("inference_provider", "all");
    const link = `link: <${next.href}>; rel="next"\r\n`;
    transport.responses.set("huggingface.co", [
      `HTTP/1.1 200 OK\r\n${link}\r\n[{"id":"org/first"}]`,
      `HTTP/1.1 200 OK\r\n${scenario === "repeated cursor" ? link : ""}\r\n[{"id":"org/second"}]`,
    ]);
    const result = fetchSource(source);
    if (scenario === "changed filter") {
      await expect(result).rejects.toThrow("left the reviewed query");
      expect(transport.calls).toEqual([source.url]);
    } else if (scenario === "repeated cursor") {
      await expect(result).rejects.toThrow("repeated a pagination cursor");
    } else {
      const fetched = await result;
      expect(JSON.parse(fetched.body)).toEqual({
        models: [{ id: "org/first" }, { id: "org/second" }],
      });
      expect(fetched.dependencies).toHaveLength(2);
    }
  },
);

it("rejects same-host redirects before accepting an exhaustive HF Inference page", async () => {
  const source = reviewedPublicSource("huggingface-hf-inference");
  transport.responses.set("huggingface.co", [
    "HTTP/1.1 302 Found\r\nlocation: /api/models\r\n\r\n",
  ]);
  await expect(fetchSource(source)).rejects.toThrow("redirected the reviewed query");
  expect(transport.calls).toEqual([source.url]);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.useRealTimers();
  transport.failures.clear();
  transport.responses.clear();
  transport.calls.length = 0;
});

it("shares SageMaker discovery within one attempt and checks each source's host policy on cache hits", async () => {
  const source = reviewedPublicSource("sagemaker-models");
  const cache: SagemakerDiscoveryCache = new Map();
  transport.responses.set("docs.aws.amazon.com", [
    "HTTP/1.1 200 OK\r\n\r\nfirst",
    "HTTP/1.1 200 OK\r\n\r\nexceeds smaller limit",
    "HTTP/1.1 200 OK\r\n\r\nnext attempt",
  ]);
  const [first, shared] = await Promise.all([
    fetchSource(source, cache),
    fetchSource(source, cache),
  ]);
  expect(first.body).toBe("first");
  expect(shared.contentHash).toBe(first.contentHash);
  expect(transport.calls).toHaveLength(1);
  await expect(fetchSource({ ...source, allowedHosts: ["unrelated.test"] }, cache)).rejects.toThrow(
    "reviewed host allowlist",
  );
  await expect(fetchSource({ ...source, maxResponseBytes: 2 }, cache)).rejects.toThrow(
    "Response exceeded byte limit",
  );
  expect((await fetchSource(source, new Map())).body).toBe("next attempt");
});

it("applies a linked-document request suffix once and deduplicates both public spellings", () => {
  const source = manifests
    .find(({ provider }) => provider.id === "cerebras")
    ?.sources.find(({ id }) => id === "cerebras-catalog");
  if (source === undefined) throw new Error("Missing Cerebras source");
  expect(
    linkedDocumentUrls(
      [
        "[Native](/models/qwen-3.8-27b.md)",
        "[HTML](/models/qwen-3.8-27b)",
        "[Other](/models/gpt-oss-120b)",
        "[Untrusted](https://example.test/models/qwen-3.8-27b.md)",
      ].join("\n"),
      source,
    ).map(({ href }) => href),
  ).toEqual([
    "https://inference-docs.cerebras.ai/models/gpt-oss-120b.md",
    "https://inference-docs.cerebras.ai/models/qwen-3.8-27b.md",
  ]);
});

it("retains distinct Anthropic reference paths sharing the overview filename", async () => {
  const source = reviewedPublicSource("anthropic-model-cards");
  if (!source.linkedDocuments) throw new Error("Missing card discovery");
  const paths = ["/docs/en/models/mythos-5-2/overview", "/docs/en/models/opus-4-5/overview"];
  transport.responses.set(
    "platform.claude.com",
    [paths.map((path) => `[Model](${path})`).join("\n"), "First card", "Second card"].map(
      (body) => `HTTP/1.1 200 OK\r\n\r\n${body}`,
    ),
  );
  const result = await fetchSource({
    ...source,
    linkedDocuments: { ...source.linkedDocuments, documents: [] },
  });
  expect(new Set(result.dependencies.map(({ key }) => key)).size).toBe(3);
  expect(result.dependencies.map(({ key }) => key)).toEqual(
    expect.arrayContaining(paths.map((path) => `${source.id}${path}.md`)),
  );
  expect(transport.calls.filter((url) => url.endsWith("/overview.md"))).toHaveLength(3);
});

it("keeps the Anthropic root when an optional commercial companion fails", async () => {
  const source = reviewedPublicSource("anthropic-models");
  const crawl = source.linkedDocuments;
  const pricing = crawl?.documents?.find(({ id }) => id === "pricing");
  if (!crawl || !pricing) throw new Error("Missing pricing companion");
  transport.responses.set("platform.claude.com", [
    "HTTP/1.1 404 Not Found\r\n\r\nMissing pricing",
    "HTTP/1.1 200 OK\r\n\r\n# Models overview",
  ]);
  const result = await fetchSource({
    ...source,
    linkedDocuments: { ...crawl, documents: [pricing] },
  });
  expect(result.body).toContain("# Models overview");
  expect(result.dependencyFailures).toContainEqual(
    expect.objectContaining({ dependency_id: `${source.id}/pricing`, impact: "bundle" }),
  );
});

it("strips embedded Google Cloud browser keys before hashing reviewed evidence", async () => {
  const source = reviewedPublicSource("vertex-pricing", "--index");
  const key = "AIzaSy" + "A".repeat(33);
  const html = `<script>const key = "${key}";</script><p>Input: $1</p>`;
  transport.responses.set("cloud.google.com", [
    `HTTP/1.1 200 OK\r\ncontent-type: text/html\r\n\r\n${html}`,
  ]);
  const result = await fetchSource(source);
  expect(result.body).toBe(html.replace(key, "[redacted browser API key]"));
  expect(result.contentHash).toBe(sha256(result.body));
});

vi.mock("node:timers/promises", () => ({
  setTimeout: (delay: number) => new Promise<void>((resolve) => setTimeout(resolve, delay)),
}));

vi.mock("node:child_process", () => ({
  execFile: (...arguments_: unknown[]) => {
    const requestArguments = arguments_[1];
    const callback = arguments_.at(-1);
    if (!Array.isArray(requestArguments) || typeof callback !== "function")
      throw new Error("Unexpected curl invocation");
    const url = requestArguments.at(-1);
    if (typeof url !== "string") throw new Error("Curl invocation omitted its URL");
    transport.calls.push(url);
    const response = transport.responses.get(new URL(url).hostname)?.shift();
    if (response !== undefined) {
      callback(null, { stdout: response, stderr: "" });
      return;
    }
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

function retailSource(): SourceManifest {
  const source = manifests
    .find(({ provider }) => provider.id === "azure")
    ?.sources.find(({ id }) => id === "azure-retail-prices");
  if (source === undefined) throw new Error("Missing Azure retail source");
  return source;
}

it.each(["not JSON", '{"Items":"wrong shape"}'])(
  "classifies a successful catalog response contract separately from network failure: %s",
  async (body) => {
    transport.responses.set("prices.azure.com", [`HTTP/1.1 200 OK\r\n\r\n${body}`]);
    try {
      await fetchSource(retailSource());
      expect.unreachable("Expected the catalog response to be rejected");
    } catch (error) {
      expect(sourceFailure(error)).toMatchObject({
        outcome: "parse_failed",
        contract_findings: [{ disposition: "reject" }],
      });
    }
  },
);

it("keeps endpoint response-contract failures visible beside a usable Vercel model index", async () => {
  const source: SourceManifest | undefined = manifests
    .find(({ provider }) => provider.id === "vercel")
    ?.sources.find((source: SourceManifest) => source.transport?.kind === "vercel-models");
  if (source === undefined || source.extractor.kind !== "vercel-catalog")
    throw new Error("Missing Vercel transport");
  const count = source.extractor.minModels;
  const data = Array.from({ length: count }, (_, index) => ({
    id: `test/model-${index}`,
    pricing: { input: "0.1" },
  }));
  transport.responses.set("ai-gateway.vercel.sh", [
    `HTTP/1.1 200 OK\r\n\r\n${JSON.stringify({ object: "list", data })}`,
    ...Array.from({ length: count }, () => 'HTTP/1.1 200 OK\r\n\r\n{"wrong":"endpoint envelope"}'),
  ]);
  const result = await fetchSource(source);
  expect(JSON.parse(result.body).index.body).toBe(JSON.stringify({ object: "list", data }));
  const failures = result.dependencyFailures?.filter(({ dependency_id }) =>
    dependency_id.startsWith(`${source.id}/endpoints/`),
  );
  expect(failures).toHaveLength(count);
  expect(
    failures?.every(({ outcome, impact }) => outcome === "parse_failed" && impact === "claim"),
  ).toBe(true);
});

function vercelModelsSource() {
  const source: SourceManifest | undefined = manifests
    .find(({ provider }) => provider.id === "vercel")
    ?.sources.find((source: SourceManifest) => source.transport?.kind === "vercel-models");
  if (source === undefined || source.extractor.kind !== "vercel-catalog")
    throw new Error("Missing Vercel transport");
  return { source, minModels: source.extractor.minModels };
}

const vercelBatchGuide = [
  "# AI Gateway Batch Processing",
  "",
  "Each batch-capable model has a `<model>-batch` entry in `GET /v1/models`.",
  "",
  "The IDs that end in `-batch` are the complete list of batch-capable models.",
  "",
  "Synchronous requests don't accept `-batch` IDs.",
  "",
].join("\n");

it("skips synchronous endpoint discovery for reviewed batch-only Vercel IDs", async () => {
  const { source, minModels: count } = vercelModelsSource();
  const batchCount = 3;
  const data = Array.from({ length: count }, (_, index) => ({
    id: index < batchCount ? `test/model-${index}-batch` : `test/model-${index}`,
    pricing: { input: "0.1" },
  }));
  transport.responses.set(
    "vercel.com",
    Array.from({ length: 11 }, () => `HTTP/1.1 200 OK\r\n\r\n${vercelBatchGuide}`),
  );
  transport.responses.set("ai-gateway.vercel.sh", [
    `HTTP/1.1 200 OK\r\n\r\n${JSON.stringify({ object: "list", data })}`,
    ...Array.from({ length: count }, () => 'HTTP/1.1 200 OK\r\n\r\n{"wrong":"endpoint envelope"}'),
  ]);
  const result = await fetchSource(source);
  const endpointCalls = transport.calls.filter((url) => url.endsWith("/endpoints"));
  expect(endpointCalls).toHaveLength(count - batchCount);
  const batchUrls = data.slice(0, batchCount).map(({ id }) => `/v1/models/${id}/endpoints`);
  expect(endpointCalls.filter((url) => batchUrls.some((path) => url.endsWith(path)))).toEqual([]);
  const failures = result.dependencyFailures?.filter(({ dependency_id }) =>
    dependency_id.startsWith(`${source.id}/endpoints/`),
  );
  expect(failures).toHaveLength(count - batchCount);
  expect(
    failures?.every(({ outcome, impact }) => outcome === "parse_failed" && impact === "claim"),
  ).toBe(true);
});

it("keeps endpoint discovery for batch IDs when the Vercel batch guide is unavailable", async () => {
  const { source, minModels: count } = vercelModelsSource();
  const batchId = "test/model-0-batch";
  const data = Array.from({ length: count }, (_, index) => ({
    id: index === 0 ? batchId : `test/model-${index}`,
    pricing: { input: "0.1" },
  }));
  transport.responses.set("ai-gateway.vercel.sh", [
    `HTTP/1.1 200 OK\r\n\r\n${JSON.stringify({ object: "list", data })}`,
    ...Array.from({ length: count }, () => 'HTTP/1.1 200 OK\r\n\r\n{"wrong":"endpoint envelope"}'),
  ]);
  const result = await fetchSource(source);
  expect(transport.calls.filter((url) => url.endsWith("/endpoints"))).toHaveLength(count);
  expect(
    result.dependencyFailures?.some(
      ({ dependency_id }) => dependency_id === `${source.id}/endpoints/${sha256(batchId)}`,
    ),
  ).toBe(true);
});

it("keeps a malformed Ollama list visible when the independent HTML inventory succeeds", async () => {
  const source: SourceManifest | undefined = manifests
    .find(({ provider }) => provider.id === "ollama")
    ?.sources.find((source: SourceManifest) => source.transport?.kind === "ollama-cloud");
  if (source === undefined || source.transport?.kind !== "ollama-cloud")
    throw new Error("Missing Ollama transport");
  const cards = Array.from(
    { length: source.transport.minModels },
    (_, index) =>
      `<a href="/library/model-${index}"><span class="bg-cyan-100">cloud</span>Model ${index}</a>`,
  ).join("");
  transport.responses.set("ollama.com", [
    'HTTP/1.1 200 OK\r\n\r\n{"unexpected":"model list"}',
    `HTTP/1.1 200 OK\r\n\r\n${cards}`,
  ]);
  const result = await fetchSource(source);
  expect(JSON.parse(result.body).catalog.body).toBe(cards);
  expect(result.dependencyFailures).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        dependency_id: `${source.id}/index`,
        impact: "claim",
        outcome: "parse_failed",
      }),
    ]),
  );
  const failedQueries = result.dependencyFailures?.filter(({ dependency_id }) =>
    dependency_id.startsWith(`${source.id}/show/`),
  );
  expect(failedQueries).toHaveLength(source.transport.minModels);
  expect(
    failedQueries?.every(
      ({ outcome, http_status }) => outcome === "fetch_failed" && http_status === 404,
    ),
  ).toBe(true);
});

it("retrieves a rejected discovery index for repair while collection still rejects it", async () => {
  const body = "# Models\n[Model](https://docs.cohere.com/v2/docs/model.md)";
  const source = reviewedPublicSource("cohere-models");
  expect(() => linkedDocumentUrls(body, source)).toThrow("count_outside_bounds");
  transport.responses.set("docs.cohere.com", [`HTTP/1.1 200 OK\r\n\r\n${body}`]);
  const result = await fetchSource(reviewedPublicSource(source.id, "--index"));
  expect(result.body).toBe(body);
  expect(result.dependencies).toEqual([]);
  expect(transport.calls).toEqual([source.url]);
  expect(() => linkedDocumentUrls(body, source)).toThrow("count_outside_bounds");
});

it("keeps raw repair indexes within the redirect and response byte limits", async () => {
  const source = reviewedPublicSource("cohere-models", "--index");
  transport.responses.set("docs.cohere.com", [
    "HTTP/1.1 302 Found\r\nlocation: https://unreviewed.test/index.md\r\n\r\n",
  ]);
  await expect(fetchSource(source)).rejects.toThrow("allowlist");
  transport.responses.set("docs.cohere.com", [
    `HTTP/1.1 200 OK\r\ncontent-length: ${source.maxResponseBytes + 1}\r\n\r\nx`,
  ]);
  await expect(fetchSource(source)).rejects.toThrow("byte limit");
  expect(transport.calls).toEqual([source.url, source.url]);
});

it("keeps successor research within the existing transport and redirect budget", async () => {
  const parent = reviewedPublicSource("vertex-pricing", "--index");
  const target = "https://docs.cloud.google.com/linked-parameters";
  transport.responses.set("cloud.google.com", [
    `HTTP/1.1 200 OK\r\n\r\n<a href="${target}">Parameters</a>`,
  ]);
  const origin = await fetchSource(parent);
  const successor = linkedPublicSource(parent, origin.body, target);
  transport.responses.set("docs.cloud.google.com", [
    "HTTP/1.1 302 Found\r\nlocation: https://unreviewed.test/parameters\r\n\r\n",
  ]);
  await expect(fetchSource(successor)).rejects.toThrow("allowlist");
  expect(transport.calls).toEqual([parent.url, target]);
  transport.responses.set("docs.cloud.google.com", [
    `HTTP/1.1 200 OK\r\ncontent-length: ${successor.maxResponseBytes + 1}\r\n\r\nx`,
  ]);
  await expect(fetchSource(successor)).rejects.toThrow("byte limit");
});

function retailResponse(status: number, headers = ""): string {
  return `HTTP/1.1 ${status} Test\r\ncontent-type: application/json\r\n${headers}\r\n${
    status === 200 ? '{"Items":[{"meterId":"test-meter"}],"NextPageLink":null}' : "{}"
  }`;
}

describe("source retry cooldown", () => {
  it("waits for the reported Retail Prices quota reset before requesting the next page", async () => {
    vi.useFakeTimers();
    const second = "https://prices.azure.com/api/retail/prices?$skip=1000";
    const third = "https://prices.azure.com/api/retail/prices?$skip=2000";
    transport.responses.set("prices.azure.com", [
      `HTTP/1.1 200 OK\r\nx-ms-ratelimit-remaining-retailprices-requests: 1\r\nx-ms-ratelimit-retailprices-retry-after: 60\r\n\r\n${JSON.stringify({ Items: [1], NextPageLink: second })}`,
      `HTTP/1.1 200 OK\r\nx-ms-ratelimit-remaining-retailprices-requests: 0\r\nx-ms-ratelimit-retailprices-retry-after: 60\r\nRetry-After: 90\r\n\r\n${JSON.stringify({ Items: [2], NextPageLink: third })}`,
      'HTTP/1.1 200 OK\r\nx-ms-ratelimit-remaining-retailprices-requests: 0\r\n\r\n{"Items":[3],"NextPageLink":null}',
    ]);
    const result = fetchSource(retailSource());
    await vi.advanceTimersByTimeAsync(89_999);
    expect(transport.calls.slice(1)).toEqual([second]);
    await vi.advanceTimersByTimeAsync(1);
    expect(JSON.parse((await result).body)).toEqual({ prices: [1, 2, 3] });
    expect(transport.calls.slice(1)).toEqual([second, third]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reports the throttled page without returning prices from an incomplete crawl", async () => {
    const next = "https://prices.azure.com/api/retail/prices?$skip=1000";
    transport.responses.set("prices.azure.com", [
      `HTTP/1.1 200 OK\r\n\r\n${JSON.stringify({ Items: [1], NextPageLink: next })}`,
      retailResponse(429, "Retry-After: 301\r\n"),
    ]);
    const error: unknown = await fetchSource(retailSource()).catch((failure: unknown) => failure);
    expect(sourceFailure(error)).toEqual({
      outcome: "fetch_failed",
      message: "Azure Retail Prices HTTP 429 on page 2",
      http_status: 429,
    });
    expect(transport.calls).toHaveLength(2);
  });

  it.each([
    { headers: "Retry-After: 60\r\n", delay: 60_000 },
    { headers: "Retry-After: Tue, 29 Sep 2026 00:01:30 GMT\r\n", delay: 90_000 },
    { headers: "x-ms-ratelimit-retailPrices-retry-after: 60\r\n", delay: 60_000 },
    {
      headers: "Retry-After: 30\r\nx-ms-ratelimit-retailPrices-retry-after: 90\r\n",
      delay: 90_000,
    },
    {
      headers: "Retry-After: 90\r\nx-ms-ratelimit-retailPrices-retry-after: 30\r\n",
      delay: 90_000,
    },
  ])("waits the full $delay ms before retrying a retail page", async ({ headers, delay }) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-29T00:00:00Z"));
    transport.responses.set("prices.azure.com", [
      retailResponse(429, headers),
      retailResponse(200),
    ]);
    const result = fetchSource(retailSource());

    await vi.advanceTimersByTimeAsync(delay - 1);
    expect(transport.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(JSON.parse((await result).body)).toEqual({ prices: [{ meterId: "test-meter" }] });
    expect(transport.calls).toEqual([transport.calls[0], transport.calls[0]]);
  });

  it("honors Retry-After for ordinary public sources as well as cloud transports", async () => {
    vi.useFakeTimers();
    const { transport: _transport, ...publicSource } = retailSource();
    const source: SourceManifest = {
      ...publicSource,
      url: "https://example.test/prices.json",
      allowedHosts: ["example.test"],
    };
    transport.responses.set("example.test", [
      retailResponse(503, "Retry-After: 60\r\n"),
      retailResponse(200),
    ]);
    const result = fetchSource(source);

    await vi.advanceTimersByTimeAsync(59_999);
    expect(transport.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await result;
    expect(transport.calls).toEqual([source.url, source.url]);
  });

  it("honors cooldowns on reviewed throttling bodies returned with HTTP 200", async () => {
    vi.useFakeTimers();
    transport.responses.set("prices.azure.com", [
      "HTTP/1.1 200 OK\r\nx-ms-ratelimit-retailPrices-retry-after: 60\r\n\r\nToo many requests",
      retailResponse(200),
    ]);
    const result = fetchSource(retailSource());
    await vi.advanceTimersByTimeAsync(59_999);
    expect(transport.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await result;
    expect(transport.calls).toHaveLength(2);
  });

  it.each(["301", "2147484", "9".repeat(400)])(
    "fails without an early retry when the cooldown exceeds the budget: %s",
    async (seconds) => {
      vi.useFakeTimers();
      transport.responses.set("prices.azure.com", [
        retailResponse(429, `Retry-After: ${seconds}\r\n`),
        retailResponse(200),
      ]);
      await expect(fetchSource(retailSource())).rejects.toThrow("Azure Retail Prices HTTP 429");
      expect(transport.calls).toHaveLength(1);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("does not shorten a later cooldown to fit the remaining retry budget", async () => {
    vi.useFakeTimers();
    transport.responses.set("prices.azure.com", [
      retailResponse(429, "Retry-After: 180\r\n"),
      retailResponse(429, "Retry-After: 180\r\n"),
      retailResponse(200),
    ]);
    const rejected = expect(fetchSource(retailSource())).rejects.toThrow(
      "Azure Retail Prices HTTP 429",
    );
    await vi.advanceTimersByTimeAsync(180_000);
    await rejected;
    expect(transport.calls).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["", "-60", "invalid", "Tue, 29 Sep 2026 00:00:00 GMT"])(
    "uses bounded backoff for an unusable or expired cooldown: %s",
    async (header) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-09-29T00:01:00Z"));
      vi.spyOn(Math, "random").mockReturnValue(0.5);
      transport.responses.set("prices.azure.com", [
        retailResponse(429, `Retry-After: ${header}\r\n`),
        retailResponse(200),
      ]);
      const result = fetchSource(retailSource());
      await vi.advanceTimersByTimeAsync(249);
      expect(transport.calls).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      await result;
      expect(transport.calls).toHaveLength(2);
    },
  );
});

it("fetches ARM model inventory without spending the public Retail Prices quota", async () => {
  const source = manifests
    .find(({ provider }) => provider.id === "azure")
    ?.sources.find(({ id }) => id === "azure-api");
  if (source === undefined) throw new Error("Missing Azure account inventory");
  const id = "00000000-0000-0000-0000-000000000001";
  for (const name of ["AZURE_TENANT_ID", "AZURE_CLIENT_ID", "AZURE_SUBSCRIPTION_ID"])
    vi.stubEnv(name, id);
  vi.stubEnv("AZURE_CLIENT_SECRET", "test-secret");
  const model = {
    model: { name: "test-model", skus: [{ name: "Standard", costs: [{ meterId: id }] }] },
  };
  const json = (body: unknown) => `HTTP/1.1 200 OK\r\n\r\n${JSON.stringify(body)}`;
  transport.responses.set("login.microsoftonline.com", [json({ access_token: "test-token" })]);
  transport.responses.set("management.azure.com", [
    json({ value: [{ name: "eastus2", displayName: "East US 2", type: "Region" }] }),
    json({ value: [{ resourceType: "accounts", locations: ["East US 2"] }] }),
    json({ value: [model] }),
  ]);
  const result = await fetchSource(source);
  expect(JSON.parse(result.body)).toEqual({ regions: [{ location: "eastus2", models: [model] }] });
  expect(transport.calls.map((url) => new URL(url).hostname)).toEqual([
    "login.microsoftonline.com",
    "management.azure.com",
    "management.azure.com",
    "management.azure.com",
  ]);
});

describe("linked source fetch", () => {
  it.each([true, false])(
    "captures page-owned Bedrock unit maps and their failures (available: %s)",
    async (available) => {
      const configured = reviewedPublicSource("bedrock-models");
      const pageUrl = "https://aws.amazon.com/bedrock/pricing/";
      const mapUrl =
        "https://b0.p.awsstatic.com/pricing/2.0/meteredUnitMaps/bedrockfoundationmodels/USD/current/reviewed-map.json";
      const body = `<li role="tabpanel"><h2 id="Anthropic">Anthropic</h2><div data-pricing-markup='<h2>Geo and In-region Cross-region Inference</h2>{priceOf!bedrockfoundationmodels/reviewed-map!token}{priceOf!bedrockfoundationmodels/reviewed-map!other}'></div></li>`;
      const source: SourceManifest = {
        ...configured,
        linkedDocuments: {
          path: /$^/,
          minDocuments: 0,
          maxDocuments: 0,
          concurrency: 2,
          documents: [
            { id: "pricing-page", url: pageUrl, format: "html", maxResponseBytes: 10000 },
          ],
        },
      };
      transport.responses.set("docs.aws.amazon.com", ["HTTP/1.1 200 OK\r\n\r\n# Models"]);
      transport.responses.set("aws.amazon.com", [`HTTP/1.1 200 OK\r\n\r\n${body}`]);
      transport.responses.set("b0.p.awsstatic.com", [
        available
          ? 'HTTP/1.1 200 OK\r\n\r\n{"regions":{}}'
          : "HTTP/1.1 404 Not Found\r\n\r\nmissing",
      ]);
      vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
        const url = input instanceof Request ? input.url : input.toString();
        if (url === mapUrl)
          return available
            ? Response.json({ regions: {} })
            : new Response("missing", { status: 404 });
        return new Response(url === pageUrl ? body : "# Models");
      });
      const result = await fetchSource(source);
      const documents = JSON.parse(result.body).documents;
      if (available) {
        expect(documents.filter((d: { url: string }) => d.url === mapUrl)).toHaveLength(1);
        expect(result.dependencies.some((d) => d.key.includes("geo-map/"))).toBe(true);
      } else {
        expect(result.dependencyFailures).toContainEqual(
          expect.objectContaining({
            dependency_id: expect.stringContaining("geo-map/"),
            impact: "bundle",
          }),
        );
      }
    },
  );
  it.each(["recover", "exhaust", "oversize"])(
    "handles SageMaker body-stream failures with bounded retries: %s",
    async (scenario) => {
      vi.spyOn(Math, "random").mockReturnValue(0);
      const source = manifests
        .find(({ provider }) => provider.id === "amazon-sagemaker")
        ?.sources.find(({ id }) => id === "sagemaker-sdk");
      if (source === undefined) throw new Error("Missing SageMaker source");
      transport.responses.set("docs.aws.amazon.com", [
        'HTTP/1.1 200 OK\r\n\r\n<dd tab-id="open-weight-models-(1)"><table><tr><th>Model ID</th><th>Model Name</th><th>Task</th><th>Fine-tunable</th></tr><tr><td>fixture-model</td><td>Model</td><td>Text Generation</td><td>No</td></tr></table></dd><dd tab-id="proprietary-models-(0)"><table><tr><th>Model ID</th><th>Model Name</th><th>Task</th><th>Fine-tunable</th></tr></table></dd>',
      ]);
      let specAttempts = 0;
      const responses: Response[] = [];
      vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
        const url = input instanceof Request ? input.url : input.toString();
        if (url.endsWith("/models_manifest.json"))
          return Response.json([
            {
              model_id: "fixture-model",
              version: "1.0",
              spec_key: "models/fixture-model/specs_v1.0.json",
            },
          ]);
        if (url.endsWith("/proprietary-sdk-manifest.json")) return Response.json([]);
        specAttempts += 1;
        const response =
          scenario === "recover" && specAttempts > 1
            ? Response.json({ model_id: "fixture-model", version: "1.0", provider: "Publisher" })
            : new Response(
                new ReadableStream<Uint8Array>({
                  start(controller) {
                    controller.enqueue(new TextEncoder().encode('{"partial":'));
                  },
                  pull(controller) {
                    if (scenario === "oversize")
                      controller.enqueue(new Uint8Array(4 * 1024 * 1024));
                    else controller.error(new DOMException("private source URL", "TimeoutError"));
                  },
                }),
              );
        responses.push(response);
        return response;
      });
      if (scenario === "recover") {
        const result = await fetchSource(source);
        expect(JSON.parse(result.body)).toMatchObject([
          { id: "fixture-model", model_card: { publisher: "Publisher" } },
        ]);
        expect(result.dependencies).toHaveLength(4);
        expect(specAttempts).toBe(2);
      } else {
        await expect(fetchSource(source)).rejects.toThrow(
          scenario === "oversize"
            ? "Response exceeded byte limit"
            : "Source response body transfer failed or timed out",
        );
        expect(specAttempts).toBe(scenario === "oversize" ? 1 : 3);
      }
      expect(responses.every(({ body }) => body?.locked === false)).toBe(true);
    },
  );

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

    expect(result).toHaveProperty("dependencyFailures", [
      {
        dependency_id: "test/missing",
        impact: "claim",
        outcome: "fetch_failed",
        http_status: 404,
        message: "HTTP 404",
      },
      {
        dependency_id: "test/fixed-missing",
        impact: "bundle",
        outcome: "fetch_failed",
        http_status: 404,
        message: "HTTP 404",
      },
      {
        dependency_id: "test/claim-local-missing",
        impact: "claim",
        outcome: "fetch_failed",
        http_status: 404,
        message: "HTTP 404",
      },
    ]);
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
