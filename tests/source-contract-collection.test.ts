import { describe, expect, it, vi } from "vite-plus/test";
import { readFile } from "node:fs/promises";
import { parseSource } from "../src/catalog/adapters.ts";
import { collectProvider } from "../src/catalog/collector.ts";
import { fetchSource } from "../src/catalog/fetch.ts";
import { manifests, type SourceManifest } from "../src/catalog/manifests.ts";
import { baseModel } from "../src/catalog/model.ts";
import { parseTypesafeCatalog } from "../src/catalog/typesafe.ts";
import type { FetchState } from "../src/catalog/fetch.ts";
import { contractExtensionEvidence, SourceContractError } from "../src/catalog/source-contract.ts";

vi.mock("../src/catalog/adapters.ts", () => ({ parseSource: vi.fn() }));
vi.mock("../src/catalog/fetch.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/catalog/fetch.ts")>()),
  fetchSource: vi.fn(),
}));

const observedAt = "2026-10-19T00:00:00.000Z";

describe("source contract collection", () => {
  it("does not turn a fetched but rejected dependency into a successful observation", async () => {
    const manifest = manifests.find(({ provider }) => provider.id === "typesafe");
    const source = manifest?.sources[0];
    if (manifest === undefined || source === undefined) throw new Error("Missing TypeSafe source");
    const key = `${source.id}/api`;
    const prior = "2026-10-18T00:00:00.000Z";
    const state: FetchState = {
      sources: { [key]: { checkedAt: prior, lastSuccessAt: prior, consecutiveFailures: 1 } },
    };
    vi.mocked(fetchSource).mockResolvedValue({
      body: "model evidence",
      contentHash: "1".repeat(64),
      etag: undefined,
      lastModified: undefined,
      dependencies: [
        { key, contentHash: "2".repeat(64), etag: undefined, lastModified: undefined },
      ],
      dependencyFailures: [
        {
          dependency_id: key,
          impact: "claim",
          outcome: "parse_failed",
          message: "Invalid response envelope",
        },
      ],
    });
    vi.mocked(parseSource).mockImplementation(() => ({
      models: [
        baseModel({
          providerId: manifest.provider.id,
          id: "test-model",
          name: "Test model",
          sourceId: source.id,
          observedAt,
        }),
      ],
    }));
    const result = await collectProvider(
      { ...manifest, sources: [source] },
      undefined,
      state,
      observedAt,
    );
    expect(result.attempt.outcome).toBe("accepted");
    expect(state.sources[key]).toMatchObject({ consecutiveFailures: 2, lastSuccessAt: prior });
    vi.mocked(fetchSource).mockResolvedValue({
      body: "model evidence",
      contentHash: "1".repeat(64),
      etag: undefined,
      lastModified: undefined,
      dependencies: [
        { key, contentHash: "2".repeat(64), etag: undefined, lastModified: undefined },
      ],
    });
    await collectProvider({ ...manifest, sources: [source] }, undefined, state, observedAt);
    expect(state.sources[key]).toMatchObject({ consecutiveFailures: 0, lastSuccessAt: observedAt });
    vi.mocked(fetchSource).mockResolvedValue({
      body: "model evidence",
      contentHash: "1".repeat(64),
      etag: undefined,
      lastModified: undefined,
      dependencies: [],
    });
    await collectProvider({ ...manifest, sources: [source] }, undefined, state, observedAt);
    expect(state.sources[key]).toBeUndefined();
  });
  it.each(["claim", "bundle"] as const)(
    "records persistent %s failures without discarding accepted catalog facts",
    async (impact) => {
      const manifest = manifests.find(({ provider }) => provider.id === "typesafe");
      const source: SourceManifest | undefined = manifest?.sources[0];
      if (manifest === undefined || source === undefined)
        throw new Error("Missing TypeSafe source");
      const body = JSON.stringify({
        index: {
          url: source.url,
          body: await readFile(new URL("./fixtures/typesafe/models.md", import.meta.url), "utf8"),
        },
        documents: [
          {
            url: "https://docs.typesafe.ai/llms.txt",
            body: await readFile(new URL("./fixtures/typesafe/llms.txt", import.meta.url), "utf8"),
          },
        ],
      });
      if (source.linkedDocuments === undefined || source.linkedDocuments.documents === undefined)
        throw new Error("Missing TypeSafe companions");
      const selectedSource = {
        ...source,
        linkedDocuments: {
          ...source.linkedDocuments,
          documents: source.linkedDocuments.documents.map((document) =>
            document.id === "api" ? { ...document, claimLocal: impact === "claim" } : document,
          ),
        },
      };
      const dependencyId = `${source.id}/api`;
      const lastSuccess = "2026-10-18T00:00:00.000Z";
      const state: FetchState = {
        sources: {
          [dependencyId]: {
            checkedAt: lastSuccess,
            lastSuccessAt: lastSuccess,
            consecutiveFailures: 0,
          },
        },
      };
      vi.mocked(parseSource).mockImplementation(parseTypesafeCatalog);
      vi.mocked(fetchSource).mockResolvedValue({
        body,
        contentHash: "1".repeat(64),
        etag: undefined,
        lastModified: undefined,
        dependencies: [],
        dependencyFailures: [
          {
            dependency_id: dependencyId,
            impact,
            outcome: "fetch_failed",
            message: "HTTP 404",
            http_status: 404,
          },
        ],
      });
      for (const failures of [1, 2]) {
        const result = await collectProvider(
          { ...manifest, sources: [selectedSource] },
          undefined,
          state,
          observedAt,
        );
        expect(result.attempt.outcome).toBe("accepted");
        expect(result.models.map(({ model_id }) => model_id)).toEqual(["jev-1.13.0"]);
        expect(result.attempt.sources[0]).toMatchObject({
          dependency_failures: [
            {
              dependency_id: dependencyId,
              impact,
              consecutive_failures: failures,
              last_success_at: lastSuccess,
              http_status: 404,
            },
          ],
        });
        expect(state.sources[dependencyId]?.consecutiveFailures).toBe(failures);
        if (impact === "claim") {
          expect(result.pricingFailure).toBeUndefined();
          expect(result.pricing).toBeDefined();
        } else {
          expect(result.pricingFailure).toBe("source_unavailable");
          expect(result.pricing).toBeUndefined();
          expect(result.pricingReplaySources).toBeUndefined();
        }
      }
    },
  );
  it.each([false, true])("preserves every callback when parsing rejects: %s", async (reject) => {
    const manifest = manifests.find(({ provider }) => provider.id === "typesafe");
    const source = manifest?.sources.find(({ role }) => role === undefined || role === "catalog");
    if (manifest === undefined || source === undefined) throw new Error("Missing TypeSafe source");
    const first = contractExtensionEvidence(["/first"]);
    const second = contractExtensionEvidence(["/second", "/third"]);
    if (first === undefined || second === undefined) throw new Error("Missing test evidence");
    const rejected = { ...second, disposition: "reject" as const };
    vi.mocked(fetchSource).mockResolvedValue({
      body: "test source",
      contentHash: "1".repeat(64),
      dependencies: [],
      etag: undefined,
      lastModified: undefined,
    });
    vi.mocked(parseSource).mockImplementation(({ onContractFinding }) => {
      onContractFinding?.(first);
      onContractFinding?.(second);
      if (reject) throw new SourceContractError("Rejected test source", rejected);
      return {
        models: [
          baseModel({
            providerId: manifest.provider.id,
            id: "test-model",
            name: "Test model",
            sourceId: source.id,
            observedAt,
          }),
        ],
      };
    });
    const result = await collectProvider(
      { ...manifest, sources: [source] },
      undefined,
      { sources: {} },
      observedAt,
    );
    const attempt = result.attempt.sources[0];
    expect(attempt).toMatchObject({ outcome: reject ? "parse_failed" : "changed" });
    expect(attempt).toHaveProperty(
      "contract_findings",
      expect.arrayContaining(reject ? [first, second, rejected] : [first, second]),
    );
    expect(attempt).not.toHaveProperty("contract_finding");
    if (!reject) expect(attempt).toHaveProperty("pricing_reconciliation.observed_items", 1);
  });
});
