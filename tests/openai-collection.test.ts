import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vite-plus/test";
import { z } from "zod";
import { collectProvider } from "../src/catalog/collector.ts";
import { fetchSource } from "../src/catalog/fetch.ts";
import { sha256 } from "../src/catalog/io.ts";
import { manifests, type ProviderManifest } from "../src/catalog/manifests.ts";

vi.mock("../src/catalog/fetch.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/catalog/fetch.ts")>()),
  fetchSource: vi.fn(),
}));

const observedAt = "2026-07-21T00:00:00.000Z";
const fixture = (name: string) =>
  readFile(new URL("./fixtures/openai/" + name, import.meta.url), "utf8");
const accounting =
  "components:\n  schemas:\n    UsageWebSearchCallsResult:\n      properties:\n        num_requests:\n          type: integer";

describe("OpenAI optional accounting collection", () => {
  it.each(["unavailable", "unrecognized", "partial", "unused"])(
    "refreshes complete rates when accounting is %s",
    async (failure) => {
      const manifest: ProviderManifest | undefined = manifests.find(
        ({ provider }) => provider.id === "openai",
      );
      if (manifest === undefined || manifest.notConfiguredReason !== undefined)
        throw new Error("Missing OpenAI manifest");
      const bodies = new Map([
        ["openai-models", await fixture("catalog.json")],
        [
          "openai-pricing",
          (await fixture("pricing.md")) + "\n" + (await fixture("fixed-search.md")),
        ],
        ["openai-accounting", accounting],
      ]);
      const bundle = z
        .object({
          index: z.object({ url: z.string(), body: z.string() }),
          documents: z.array(z.object({ url: z.string(), body: z.string() })),
        })
        .parse(JSON.parse(bodies.get("openai-models") ?? ""));
      bundle.index.body += "\n- [GPT OSS](/api/docs/models/gpt-oss-20b.md)";
      bundle.documents.push({
        url: "https://developers.openai.com/api/docs/models/gpt-oss-20b.md",
        body: "# GPT OSS\nModel ID: `gpt-oss-20b`\nAn open-weight model.",
      });
      bodies.set("openai-models", JSON.stringify(bundle));
      bodies.set(
        "openai-overview",
        JSON.stringify({
          index: {
            url: "https://developers.openai.com/api/docs/models/all",
            body: '<a href="/api/docs/models/gpt-oss-20b">GPT OSS</a>',
          },
          documents: [
            {
              url: "https://developers.openai.com/api/docs/models/gpt-oss-20b",
              body: "<main>An open-weight model.</main>",
            },
          ],
        }),
      );
      const catalog = manifest.sources.find(({ id }) => id === "openai-models");
      const pricing = manifest.sources.find(({ id }) => id === "openai-pricing");
      const accountingSource = manifest.sources.find(({ id }) => id === "openai-accounting");
      const overview = manifest.sources.find(({ id }) => id === "openai-overview");
      if (
        catalog === undefined ||
        pricing === undefined ||
        accountingSource === undefined ||
        overview === undefined
      )
        throw new Error("Missing OpenAI sources");
      const selected: ProviderManifest = {
        ...manifest,
        sources: [catalog, overview, pricing, accountingSource],
      };
      let partial = false;
      const respond = () =>
        vi.mocked(fetchSource).mockImplementation(async (source) => {
          const body = bodies.get(source.id);
          if (body === undefined) throw new Error("Simulated unavailable optional source");
          return {
            body,
            contentHash: sha256(body),
            etag: undefined,
            lastModified: undefined,
            dependencies: [],
            ...(partial && source.id === "openai-accounting"
              ? {
                  dependencyFailures: [
                    {
                      dependency_id: "openai-accounting/usage",
                      impact: "bundle" as const,
                      outcome: "fetch_failed" as const,
                      message: "HTTP 404",
                      http_status: 404,
                    },
                  ],
                }
              : {}),
          };
        });
      respond();
      const prior = await collectProvider(selected, undefined, { sources: {} }, observedAt);
      if (prior.pricing === undefined) throw new Error(JSON.stringify(prior.attempt));
      partial = failure === "partial";
      if (failure === "unavailable") bodies.delete("openai-accounting");
      else if (failure === "unused")
        bodies.set(
          "openai-accounting",
          accounting
            .replace("UsageWebSearchCallsResult", "UsageCodeInterpreterSessionsResult")
            .replace("num_requests", "num_sessions"),
        );
      else bodies.set("openai-accounting", "components: {}");
      const next = await collectProvider(selected, undefined, { sources: {} }, observedAt);
      expect(next.attempt.outcome).toBe("accepted");
      expect(next.pricingFailure).toBeUndefined();
      expect(next.pricing).toBeDefined();
      const prices = (result: typeof next) =>
        result.pricing?.books.flatMap(({ offers }) =>
          offers.flatMap(({ terms }) =>
            terms.flatMap((term) =>
              term.kind === "rate" ? term.variants.map(({ price }) => price) : [],
            ),
          ),
        );
      expect(prices(next)).toEqual(prices(prior));
      if (failure === "unused") {
        expect(
          next.models.every(({ source_refs }) => !source_refs.includes(accountingSource.id)),
        ).toBe(true);
        expect(next.sources.some(({ id }) => id === accountingSource.id)).toBe(true);
        expect(
          next.pricingReplaySources?.find(({ source_id }) => source_id === accountingSource.id),
        ).toMatchObject({
          models: [],
          pricing_inputs: [
            expect.objectContaining({ key: "organization.code_interpreter_sessions.num_sessions" }),
          ],
        });
        return;
      }
      expect(next.pricingReplaySources?.map(({ source_id }) => source_id)).toEqual([
        "openai-overview",
        "openai-pricing",
      ]);
      const required: ProviderManifest = {
        ...selected,
        sources: [catalog, overview, pricing, { ...accountingSource, pricingRequired: true }],
      };
      const retained = await collectProvider(required, undefined, { sources: {} }, observedAt);
      expect(retained.pricingFailure).toBe("source_unavailable");
      expect(retained.pricing).toBeUndefined();
      expect(retained.pricingReplaySources).toBeUndefined();
      bodies.delete("openai-overview");
      const missingRates = await collectProvider(selected, undefined, { sources: {} }, observedAt);
      expect(missingRates.pricingFailure).toBe("source_unavailable");
      expect(missingRates.pricing).toBeUndefined();
      expect(missingRates.pricingReplaySources).toBeUndefined();
    },
  );
});
