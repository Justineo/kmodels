import { readFile } from "node:fs/promises";
import { expect, it, vi } from "vite-plus/test";
import { linkedBundleSchema, type LinkedBundle } from "../src/catalog/bundle.ts";
import { collectProvider } from "../src/catalog/collector.ts";
import { fetchSource } from "../src/catalog/fetch.ts";
import { manifests } from "../src/catalog/manifests.ts";
import { sha256 } from "../src/catalog/io.ts";
import { vercelInferenceBundle } from "./vercel-inference-fixture.ts";

vi.mock("../src/catalog/fetch.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/catalog/fetch.ts")>()),
  fetchSource: vi.fn(),
}));

const at = "2026-10-30T18:30:00.000Z";

// The catalog publishes `pricing.request` on one model and omits it on every other model and
// endpoint. Both shapes must reach the catalog, and the undocumented amount must stay raw.
it("retains endpoint routes when the per-request amount is absent or nonzero", async () => {
  const manifest = manifests.find(({ provider }) => provider.id === "vercel");
  const catalog = manifest?.sources.find(({ id }) => id === "vercel-models");
  if (!manifest || !catalog) throw new Error("Missing Vercel source");
  const reviewed = linkedBundleSchema.parse(
    JSON.parse(
      await readFile(
        new URL("./fixtures/vercel/request-denominator.json", import.meta.url),
        "utf8",
      ),
    ),
  );
  const bundle: LinkedBundle = await vercelInferenceBundle();
  bundle.documents.push(...reviewed.documents);
  bundle.index.body = JSON.stringify({
    object: "list",
    data: [
      ...(JSON.parse(bundle.index.body) as { data: unknown[] }).data,
      ...(JSON.parse(reviewed.index.body) as { data: unknown[] }).data,
    ],
  });

  const bodies = new Map([[catalog.id, JSON.stringify(bundle)]]);
  vi.mocked(fetchSource).mockImplementation(async (source) => {
    const body = bodies.get(source.id);
    if (!body) throw new Error("Missing fixture");
    return {
      body,
      contentHash: sha256(body),
      etag: undefined,
      lastModified: undefined,
      dependencies: [],
    };
  });

  const result = await collectProvider(
    { ...manifest, sources: [catalog] },
    undefined,
    {
      sources: {},
    },
    at,
  );
  if (!result.pricing) throw new Error(JSON.stringify(result.attempt));

  const byId = new Map(result.models.map((model) => [model.model_id, model]));
  const perRequest = byId.get("parallel/parallel-decisions-fast");
  const omitted = byId.get("acme/omitted-request");
  if (!perRequest || !omitted) throw new Error(JSON.stringify(result.attempt));

  expect(perRequest.routes).toEqual([
    {
      source_ref: catalog.id,
      provider: "parallel",
      provider_model_id: "parallel/parallel-decisions-fast",
      task: "evaluation",
      status: "live",
    },
  ]);
  expect(omitted.routes?.map(({ provider }) => provider)).toEqual(["acme"]);

  const book = (modelId: string) =>
    result.pricing?.books.find(({ book_key: key }) => key === `model:vercel/${modelId}`);
  const perRequestBook = book("parallel/parallel-decisions-fast");
  if (!perRequestBook) throw new Error("Missing per-request pricing book");
  expect(perRequestBook.offers.flatMap(({ states }) => states)).toEqual([]);
  expect(
    perRequestBook.offers.flatMap(({ terms }) =>
      terms.map((term) =>
        term.kind === "raw"
          ? [
              term.term_key,
              term.variants.map(({ reason }) => reason),
              term.variants.flatMap(({ observations }) =>
                observations.map(({ raw }) => [raw.amount, raw.meter, raw.unit]),
              ),
            ]
          : [term.term_key],
      ),
    ),
  ).toEqual([
    ["catalog_request", ["unknown_unit"], [["0.001", "request", "pricing.request"]]],
    ["endpoint_request", ["unknown_unit"], [["0.001", "request", "endpoint.pricing.request"]]],
  ]);

  const omittedBook = book("acme/omitted-request");
  if (!omittedBook) throw new Error("Missing omitted-request pricing book");
  expect(
    omittedBook.offers.flatMap(({ terms }) =>
      terms.flatMap((term) =>
        term.kind === "rate"
          ? term.variants.map(({ price }) => [term.meter.value, price.value])
          : [],
      ),
    ),
  ).toEqual([
    ["input_text", { numerator: "1", denominator: "2500000" }],
    ["output_text", { numerator: "3", denominator: "2500000" }],
  ]);
});
