import { expect, it, vi } from "vite-plus/test";
import { collectProvider } from "../src/catalog/collector.ts";
import { fetchSource } from "../src/catalog/fetch.ts";
import { fireworksFlightRecords } from "../src/catalog/fireworks-flight.ts";
import { compileInferencePriceMapping } from "../src/catalog/inference-pricing-compilation.ts";
import { sha256 } from "../src/catalog/io.ts";
import { manifests } from "../src/catalog/manifests.ts";
import { emptyPricingCatalog } from "../src/catalog/pricing-schema.ts";
import { failedPricingTransition } from "../src/catalog/pricing-transition.ts";
import { composeCatalogPair, coreCatalogVersion } from "../src/catalog/pricing-pair-transition.ts";
import {
  prepareCatalogPair,
  type CatalogPairCandidate,
} from "../src/catalog/pricing-publication.ts";
import { priceDataExport } from "../src/catalog/pricing-lookup-export.ts";
import { createInferencePriceLookup } from "../src/pricing/inference.ts";
import type { Catalog } from "../src/catalog/schema.ts";
import {
  embeddingId,
  chatId,
  consoleFlightFrame,
  consoleLoginRecord,
  consoleMode,
  consoleProfile,
  flexRouterId,
  fireworksBundle,
  rerankerAlias,
  rerankerId,
  routerId,
} from "./fireworks-fixture.ts";

vi.mock("../src/catalog/fetch.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/catalog/fetch.ts")>()),
  fetchSource: vi.fn(),
}));
const at = "2026-11-12T00:00:00.000Z";

async function collect(previous?: CatalogPairCandidate, bundle = fireworksBundle) {
  const manifest = manifests.find(({ provider }) => provider.id === "fireworks");
  const source = manifest?.sources[0];
  if (!manifest || !source) throw new Error("Missing Fireworks source");
  const body = JSON.stringify(bundle);
  vi.mocked(fetchSource).mockResolvedValue({
    body,
    contentHash: sha256(body),
    etag: undefined,
    lastModified: undefined,
    dependencies: [],
  });
  const result = await collectProvider(
    { ...manifest, sources: [source] },
    previous?.catalog,
    { sources: {} },
    at,
  );
  if (!result.pricing && !previous) throw new Error(JSON.stringify(result.attempt));
  const core: Catalog = {
    catalog_version: coreCatalogVersion([result.provider]),
    generated_at: at,
    providers: [result.provider],
    models: result.models,
    sources: result.sources,
    coverage: [result.coverage],
    warnings: result.warnings,
  };
  const composed = composeCatalogPair(
    previous?.catalog,
    core,
    previous?.pricing.data ?? emptyPricingCatalog(),
    [
      result.pricing
        ? { kind: "fresh", partition: result.pricing }
        : failedPricingTransition("fireworks", at, result.pricingFailure ?? "pricing_not_observed"),
    ],
  );
  return compileInferencePriceMapping(
    prepareCatalogPair(composed.catalog, composed.pricing),
    result.inferencePriceSources ?? [],
    previous,
  );
}

function lookup(candidate: CatalogPairCandidate) {
  return createInferencePriceLookup(
    priceDataExport(candidate.catalog, candidate.pricing),
    candidate.inference?.mapping,
  );
}

function inputRate(candidate: CatalogPairCandidate, modelRef: string) {
  return candidate.pricing.data.books
    .filter(({ scope }) => scope.model_refs.includes(modelRef))
    .flatMap(({ offers }) => offers)
    .flatMap(({ terms }) => terms)
    .flatMap((term) =>
      term.kind === "rate" && term.meter.value === "input_text"
        ? term.variants.map(({ price }) => price.value)
        : [],
    );
}

it("selects Standard for the exact Flex router and rejects an explicit Priority request", async () => {
  const candidate = await collect();
  const query = lookup(candidate);
  const tier = (model_id: string, value: string) =>
    query({
      provider_id: "fireworks",
      model_id,
      selectors: [
        {
          dimension: { namespace: "kmodels", value: "service_tier" },
          kind: "categorical",
          value: { namespace: "provider", provider_id: "fireworks", value },
        },
      ],
    });
  expect(query({ provider_id: "fireworks", model_id: flexRouterId }).status).toBe("matched");
  expect(tier(flexRouterId, "standard").status).toBe("matched");
  expect(tier(flexRouterId, "priority").candidates).toEqual([]);
  expect(
    query({
      provider_id: "fireworks",
      model_id: flexRouterId,
      choices: [{ dimension: "service_tier", value: { namespace: "kmodels", value: "priority" } }],
    }).candidates,
  ).toEqual([]);
  expect(tier(chatId, "priority").status).toBe("matched");
});

it("binds per-model Ultra-fast preview and both documented Spot invocation forms", async () => {
  const ultra = "accounts/fireworks/routers/example-ultrafast";
  const preview = "accounts/fireworks/routers/example-preview-ultrafast";
  const spot = `${chatId}-spot`;
  const link = (label: string) => `[${label}](https://app.fireworks.ai/models/fireworks/example)`;
  const bundle = {
    ...fireworksBundle,
    documents: fireworksBundle.documents.map((document) => {
      let body = document.body;
      if (document.url.endsWith("/serverless-modes.md")) {
        body = body
          .replace("Ultra-fast (preview)", "Ultra-fast")
          .replace(
            "| Another Model | `accounts/fireworks/routers/another-ultrafast` |",
            `| Example | \`${ultra}\` |\n| Example Preview (Preview) | \`${preview}\` |`,
          );
      } else if (document.url.endsWith("/serverless/pricing.md")) {
        body = body.replace(
          "## Decision models",
          [
            `| ${link("Example Ultra-fast")} | $5 / $1 / $15 | — |`,
            `| ${link("Example Preview Ultra-fast (Preview)")} | $6 / $1.2 / $18 | — |`,
            `| ${link("Example Spot")} | $0.5 / $0.1 / $1.5 | — |`,
            "## Decision models",
          ].join("\n"),
        );
      } else if (document.url.endsWith("/spot-serverless.md")) {
        body = [
          "## Pricing",
          "| Model | Mode | Input | Cached input | Output |",
          "| - | - | - | - | - |",
          `| ${link("Example")} | Spot | $0.5 | $0.1 | $1.5 |`,
          '### Set `service_tier` to `"spot"`',
          `Use \`${chatId}\`.`,
          "### Use the Spot model ID",
          `Use \`${spot}\`.`,
        ].join("\n");
      }
      return { ...document, body };
    }),
  };
  const candidate = await collect(undefined, bundle);
  const request = lookup(candidate);
  for (const [id, numerator, denominator] of [
    [ultra, "1", "200000"],
    [preview, "3", "500000"],
    [spot, "1", "2000000"],
  ] as const) {
    expect(inputRate(candidate, `fireworks/${id}`)).toEqual([{ numerator, denominator }]);
    expect(request({ provider_id: "fireworks", model_id: id }).status).toBe("matched");
  }
  expect(candidate.catalog.models.find(({ model_id }) => model_id === preview)?.release_stage).toBe(
    "preview",
  );
  expect(candidate.catalog.models.find(({ model_id }) => model_id === ultra)?.release_stage).toBe(
    "unknown",
  );
  const tier = (value: string) =>
    request({
      provider_id: "fireworks",
      model_id: chatId,
      selectors: [
        {
          dimension: { namespace: "kmodels", value: "service_tier" },
          kind: "categorical",
          value: { namespace: "provider", provider_id: "fireworks", value },
        },
      ],
    });
  expect(tier("spot").status).toBe("matched");
  expect(tier("standard").status).toBe("matched");
});

it("skips length-framed Flight bytes even when they look like another record", () => {
  const bytes = Buffer.from("\n4:E{}\n");
  const binary = `<script>self.__next_f.push([3,"${bytes.toString("base64")}"])</script>`;
  const start = consoleFlightFrame(`3:o${bytes.length.toString(16)},`);
  const end = consoleFlightFrame('5:{"success":true}\n');
  expect(fireworksFlightRecords(start + binary + end)).toEqual({
    records: [{ success: true }],
    errors: [],
  });
  expect(() => fireworksFlightRecords(start + consoleFlightFrame("too"))).toThrow(
    /record was truncated/,
  );
});

it("recovers documented rates when the console requires login and retains quotes on invalid widgets", async () => {
  const consoleRouter = "accounts/fireworks/routers/example-console-spot";
  const mode = consoleMode(chatId, "spot", consoleRouter, "", [700000000, 140000000, 210000000]);
  const fake = `中文\n${consoleLoginRecord(chatId)}`;
  const text = consoleFlightFrame(`a:T${Buffer.byteLength(fake).toString(16)},${fake}`);
  const profile = consoleProfile(chatId, [mode]);
  const withProfile = (body: string) => ({
    ...fireworksBundle,
    documents: fireworksBundle.documents.map((doc) =>
      doc.url === profile.url ? { ...profile, body } : doc,
    ),
  });
  const valid = await collect(undefined, withProfile(profile.body + text));
  const consoleQuery = { provider_id: "fireworks", model_id: consoleRouter };
  expect(lookup(valid)(consoleQuery).status).toBe("matched");
  expect(inputRate(valid, `fireworks/${consoleRouter}`)).toEqual([
    { numerator: "7", denominator: "10000000" },
  ]);

  const duplicate = consoleProfile(chatId, [mode, mode]);
  const retained = await collect(valid, withProfile(duplicate.body + text));
  expect(retained.pricing.data.provider_snapshots[0]?.publication).toBe("retained");
  const retainedQuote = lookup(retained)(consoleQuery);
  expect(retainedQuote.status).toBe("matched");
  expect(retainedQuote.candidates).toEqual(lookup(valid)(consoleQuery).candidates);

  const gated = await collect(
    retained,
    withProfile(consoleFlightFrame(consoleLoginRecord(chatId))),
  );
  expect(gated.pricing.data.provider_snapshots[0]?.publication).toBe("fresh");
  expect(lookup(gated)(consoleQuery).status).toBe("unknown");
  expect(lookup(gated)({ provider_id: "fireworks", model_id: `${chatId}-spot` }).status).toBe(
    "matched",
  );
  expect(inputRate(gated, `fireworks/${chatId}-spot`)).toEqual([
    { numerator: "7", denominator: "10000000" },
  ]);
});

it("bills a retrieval card with a single per-token unit as its input rate", async () => {
  const candidate = await collect();
  const query = lookup(candidate);
  for (const model_id of [rerankerId, rerankerAlias]) {
    const result = query({ provider_id: "fireworks", model_id });
    expect(result.status).toBe("matched");
    expect(result.missing_conditions).toEqual([]);
    expect(result.candidates).toHaveLength(1);
    expect(
      result.candidates.flatMap(({ offer }) =>
        offer.terms.flatMap((term) =>
          term.kind === "rate" && term.meter.value === "input_text"
            ? term.variants.map(({ price }) => price.value)
            : [],
        ),
      ),
    ).toEqual([{ numerator: "1", denominator: "5000000" }]);
  }
  expect(query({ provider_id: "fireworks", model_id: embeddingId }).status).toBe("matched");
  expect(
    query({ provider_id: "fireworks", model_id: "fireworks/unreviewed-reranker" }),
  ).toMatchObject({ status: "unknown", reason: "unreviewed_id" });
});

it("publishes the accepted retrieval rate without inventing one for an unreviewed ref", async () => {
  const candidate = await collect();
  expect(inputRate(candidate, `fireworks/${rerankerId}`)).toEqual([
    { numerator: "1", denominator: "5000000" },
  ]);
  expect(candidate.inference?.mapping.rules.map(({ model_id }) => model_id)).toEqual(
    expect.arrayContaining([rerankerAlias]),
  );
  expect(inputRate(candidate, "fireworks/unreviewed-reranker")).toEqual([]);
  expect(lookup(candidate)({ provider_id: "fireworks", model_id: routerId }).status).toBe(
    "matched",
  );
  expect(candidate.catalog.models.map(({ model_id }) => model_id)).toEqual(
    expect.arrayContaining([rerankerId, routerId]),
  );
});
