import assert from "node:assert/strict";
import { constants, copyFile, mkdir, readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { canonicalJson, uniqueCanonicalValues } from "../src/catalog/canonical-value.ts";
import { sourceContextSelectors } from "../src/catalog/offer-boundary.ts";
import { canonicalizeOfferBoundaries } from "../src/catalog/account-offers.ts";
import { providerPartition } from "../src/catalog/pricing-transition.ts";
import { projectCommercialSelections } from "../src/catalog/commercial-selection-compilation.ts";
import { pricingCatalogEnvelopeSchema, type PricingTerm } from "../src/catalog/pricing-schema.ts";
import { catalogSchema } from "../src/catalog/schema.ts";
import { inferencePriceMappingSchema } from "../src/pricing/inference-schema.ts";
import { selectorSchema } from "../src/pricing/schema.ts";
import {
  commitCatalogPair,
  prepareCatalogPairInParallel,
  withInferencePriceMapping,
} from "../src/catalog/pricing-publication.ts";

const catalog = catalogSchema.parse(JSON.parse(await readFile("data/catalog.json", "utf8")));
const previous = pricingCatalogEnvelopeSchema.parse(
  JSON.parse(gunzipSync(await readFile("data/pricing.json.gz")).toString("utf8")),
);
const mapping = inferencePriceMappingSchema.parse(
  JSON.parse(await readFile("data/inference-pricing.json", "utf8")),
);
const owners = new Map(catalog.models.map((m) => [m.uid, m.provider_id]));
const partitions = previous.data.provider_snapshots.map((snapshot) => {
  const before = providerPartition(previous.data, snapshot.provider_id, (model) => {
    const owner = owners.get(model);
    if (owner === undefined) throw new Error(`Unknown model ${model}`);
    return owner;
  });
  if (before === undefined) throw new Error(`Missing provider ${snapshot.provider_id}`);
  const after = canonicalizeOfferBoundaries(before);
  assert.deepEqual(canonicalizeOfferBoundaries(after), after, "Offer migration is not idempotent");
  for (const book of before.books)
    for (const offer of book.offers)
      for (const term of offer.terms) {
        const nextBook = after.books.find((b) => b.id === book.id);
        const next = nextBook?.offers
          .flatMap((o) => o.terms)
          .filter(
            (t) =>
              t.term_key ===
              (offer.source_contexts === undefined &&
              book.offers.flatMap((o) => o.terms).filter((t) => t.term_key === term.term_key)
                .length > 1
                ? `${offer.offer_key}/${term.term_key}`
                : term.term_key),
          );
        assert.ok(next, `Lost term ${snapshot.provider_id}/${book.book_key}/${term.term_key}`);
        assert.deepEqual(
          monetary(next),
          monetary([term]),
          `Changed monetary/accounting facts ${snapshot.provider_id}/${book.book_key}/${term.term_key}`,
        );
      }
  console.log(
    snapshot.provider_id,
    before.books.reduce((n, b) => n + b.offers.length, 0),
    "->",
    after.books.reduce((n, b) => n + b.offers.length, 0),
  );
  return after;
});
const data = {
  ...previous.data,
  books: partitions.flatMap((p) => p.books).sort((a, b) => a.id.localeCompare(b.id)),
  provider_vocabularies: partitions.map((p) => p.vocabulary),
  model_dispositions: previous.data.model_dispositions,
};
const prepared = await prepareCatalogPairInParallel(catalog, data);
const oldOffers = new Map(
  previous.data.books.flatMap((b) => b.offers.map((o) => [o.id, { book: b, offer: o }] as const)),
);
const rules = mapping.rules.flatMap(({ execution_choices: _legacy, ...rule }) =>
  rule.offer_refs.flatMap((id) => {
    const old = oldOffers.get(id);
    if (old === undefined) throw new Error(`Unknown old offer ${id}`);
    const book = data.books.find((b) => b.id === old.book.id);
    if (book === undefined) throw new Error(`Lost price book ${old.book.id}`);
    return book.offers.flatMap((offer) =>
      old.offer.source_contexts === undefined
        ? sourceContextSelectors(offer, old.offer.offer_key, rule.fixed_selectors).map(
            (selectors) => ({
              ...rule,
              offer_refs: [offer.id],
              fixed_selectors: selectorSchema.array().parse(selectors),
            }),
          )
        : offer.id === id
          ? [{ ...rule, offer_refs: [id] }]
          : [],
    );
  }),
);
const next = withInferencePriceMapping(
  prepared,
  projectCommercialSelections(prepared.pricing, {
    ...mapping,
    pricing_data_version: prepared.pricing.pricing_data_version,
    rules: uniqueCanonicalValues(rules),
  }),
);
assert.deepEqual(next.catalog, catalog, "Core catalog changed");
assert.deepEqual(
  next.pricing.data.provider_snapshots,
  previous.data.provider_snapshots,
  "Source revisions/freshness changed",
);
assert.equal(
  new Set(rules.map((r) => canonicalJson([r.provider_id, r.model_id, r.model_ref]))).size,
  new Set(mapping.rules.map((r) => canonicalJson([r.provider_id, r.model_id, r.model_ref]))).size,
  "Lost inference identity",
);
console.log("Validated price identity", next.pricing.pricing_data_version, "rules", rules.length);
if (process.argv.includes("--write")) {
  const backup = "pricing-plan-report.local/offer-boundary-before";
  await mkdir(backup, { recursive: true });
  for (const name of [
    "catalog.json",
    "pricing.json.gz",
    "inference-pricing.json",
    "pricing-inputs.json.gz",
  ])
    await copyFile(`data/${name}`, `${backup}/${name}`, constants.COPYFILE_EXCL);
  await commitCatalogPair(next);
  console.log("Adopted relationship offers and rebuilt projections; no sources fetched.");
} else console.log("Dry run; pass --write to adopt.");

function monetary(terms: PricingTerm[]) {
  const normalized = terms.flatMap((term) =>
    term.kind === "raw"
      ? []
      : term.variants.map(({ applicability: _scope, observations: _observations, ...v }) => {
          if ("target_rate_refs" in v) return { ...v, target_rate_refs: v.target_rate_refs.length };
          if ("target" in v && v.target.kind === "rate_terms")
            return { ...v, target: { kind: v.target.kind, count: v.target.term_refs.length } };
          return v;
        }),
  );
  const raw = terms.flatMap((term) =>
    (term.kind === "raw" ? term.variants : term.raw_variants).flatMap(
      ({ possible_scope: _scope, observations, ...v }) =>
        observations.map((observation) => ({ ...v, observation })),
    ),
  );
  return {
    normalized: uniqueCanonicalValues(normalized),
    raw: uniqueCanonicalValues(raw),
  };
}
