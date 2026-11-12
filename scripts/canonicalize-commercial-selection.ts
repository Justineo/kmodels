import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { z } from "zod";
import { commercialSelection } from "../src/catalog/commercial-selection.ts";
import { commercialSelectionPolicies } from "../src/catalog/commercial-selection-policies.ts";
import { projectCommercialSelections } from "../src/catalog/commercial-selection-compilation.ts";
import { canonicalJson } from "../src/catalog/canonical-value.ts";
import { catalogSchema, migrateCatalogStorage } from "../src/catalog/schema.ts";
import {
  pricingBookSchema,
  pricingOfferSchema,
  pricingCatalogEnvelopeSchema,
} from "../src/catalog/pricing-schema.ts";
import { inferencePriceMappingSchema } from "../src/pricing/inference-schema.ts";
import { executionModeSchema } from "../src/pricing/execution-mode.ts";
import {
  commitCatalogPair,
  prepareCatalogPairInParallel,
  withInferencePriceMapping,
} from "../src/catalog/pricing-publication.ts";

// Explicitly admit the previous storage field at this migration boundary only.
const legacyBook = pricingBookSchema.extend({
  offers: z.array(pricingOfferSchema.extend({ execution_mode: executionModeSchema.optional() })),
});
const header = pricingCatalogEnvelopeSchema.extend({
  data: pricingCatalogEnvelopeSchema.shape.data.extend({ books: z.array(z.unknown()) }),
});
const catalog = catalogSchema.parse(
  migrateCatalogStorage(JSON.parse(await readFile("data/catalog.json", "utf8"))),
);
const previous = header.parse(
  JSON.parse(gunzipSync(await readFile("data/pricing.json.gz")).toString("utf8")),
);
const data = {
  ...previous.data,
  books: previous.data.books.map((input) => {
    const book = legacyBook.parse(input);
    const offers = book.offers.map(
      ({ execution_mode: _legacy, selection: _previous, ...offer }) => {
        const next = {
          ...offer,
          selection: commercialSelection(
            offer,
            book.scope,
            commercialSelectionPolicies[book.provider_id],
          ),
        };
        const { selection: _selection, ...monetary } = next;
        assert.deepEqual(
          monetary,
          offer,
          "Migration changed a price, ID, condition, accounting contract or relationship",
        );
        return next;
      },
    );
    return { ...book, offers };
  }),
};
const prepared = await prepareCatalogPairInParallel(catalog, data);
const oldMapping = inferencePriceMappingSchema.parse(
  JSON.parse(await readFile("data/inference-pricing.json", "utf8")),
);
const mapping = projectCommercialSelections(prepared.pricing, {
  ...oldMapping,
  pricing_data_version: prepared.pricing.pricing_data_version,
});
console.log("Prepared selection bytes:", Buffer.byteLength(canonicalJson(mapping)));
const next = withInferencePriceMapping(prepared, mapping);
assert.deepEqual(next.catalog, catalog, "Migration changed the core catalog");
assert.deepEqual(
  next.pricing.data.provider_snapshots,
  previous.data.provider_snapshots,
  "Migration changed source revisions",
);
const counts = new Map<string, number>();
for (const book of data.books)
  for (const offer of book.offers)
    for (const claim of offer.selection) {
      const key = [book.provider_id, claim.dimension, claim.coverage].join("/");
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
console.log(
  JSON.stringify(
    {
      before: previous.pricing_data_version,
      after: next.pricing.pricing_data_version,
      books: data.books.length,
      offers: data.books.reduce((n, b) => n + b.offers.length, 0),
      claims: Object.fromEntries(counts),
      mapping_bytes: canonicalJson(mapping).length,
      preserved:
        "All IDs, monetary facts, applicability, validity, accounting, relationships and source revisions",
    },
    null,
    2,
  ),
);
if (process.argv.includes("--write")) {
  await commitCatalogPair(next);
  console.log(
    "Adopted commercial selection and rebuilt projections from accepted evidence; no sources were fetched.",
  );
} else console.log("Dry run; pass --write to adopt.");
