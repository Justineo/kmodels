import { describe, expect, it } from "vite-plus/test";
import type { ProviderPricingPartition } from "../src/catalog/pricing-assembly.ts";
import { unconditionalApplicability } from "../src/catalog/pricing-canonical.ts";
import { providerPricingSnapshotSchema } from "../src/catalog/pricing-schema.ts";
import {
  capturePricingSourceRecords,
  snapshotSourceRecords,
  validatePricingSourceRecords,
} from "../src/catalog/pricing-source-records.ts";
import {
  failedPricingTransition,
  providerPartitionSourceRefs,
  transitionProviderPricing,
} from "../src/catalog/pricing-transition.ts";
import { sourceRecordSchema } from "../src/catalog/schema.ts";

const observedAt = "2026-07-28T00:00:00.000Z";
const later = "2026-07-29T00:00:00.000Z";

function source(id = "price") {
  return sourceRecordSchema.parse({
    id,
    provider_id: "test",
    url: `https://example.com/${id}`,
    source: ["website"],
    stability: "documented",
    field_paths: [],
    observed_at: observedAt,
    content_hash: "a".repeat(64),
    extractor_version: "v1",
  });
}

function partition(): ProviderPricingPartition {
  return {
    vocabulary: { provider_id: "test", atoms: [] },
    snapshot: { provider_id: "test", observed_at: observedAt, publication: "fresh" },
    model_dispositions: [
      {
        model_ref: "test/model",
        state: "not_applicable",
        observations: ["price", "accounting"].map((source_ref) => ({
          source_ref,
          locator: { kind: "table", value: "model" },
          establishes_model_ref: "test/model",
          raw: { label: "No public offer" },
        })),
      },
    ],
    books: [],
  };
}

describe("price snapshot source revisions", () => {
  it("captures only cited sources in stable order and preserves them through retention", () => {
    const sources = [source(), source("unused"), source("accounting")];
    const captured = capturePricingSourceRecords(partition(), sources);
    expect(captured.snapshot.source_records?.map(({ id }) => id)).toEqual(["accounting", "price"]);
    const retained = transitionProviderPricing(
      {
        provider_vocabularies: [captured.vocabulary],
        provider_snapshots: [captured.snapshot],
        model_dispositions: captured.model_dispositions,
        books: captured.books,
      },
      failedPricingTransition("test", later, "source_unavailable"),
      () => "test",
    ).provider_snapshots[0];
    if (retained === undefined) throw new Error("Missing retained snapshot");
    expect(retained.source_records).toEqual(captured.snapshot.source_records);
    const newer = sources.map((record) => ({
      ...record,
      observed_at: later,
      content_hash: "b".repeat(64),
      extractor_version: "v2",
    }));
    expect(snapshotSourceRecords({ ...captured, snapshot: retained }, newer)).toEqual(
      captured.snapshot.source_records,
    );
    expect(() =>
      validatePricingSourceRecords(
        { ...captured, snapshot: retained },
        new Map(newer.map((record) => [record.id, record])),
      ),
    ).not.toThrow();
    expect(() => capturePricingSourceRecords({ ...captured, snapshot: retained }, newer)).toThrow(
      "Only a fresh",
    );
  });

  it("rejects incomplete, foreign or differently observed source captures", () => {
    for (const invalid of [
      [],
      [{ ...source(), provider_id: "other" }, source("accounting")],
      [{ ...source(), observed_at: later }, source("accounting")],
    ])
      expect(() => capturePricingSourceRecords(partition(), invalid)).toThrow("Pricing source");
  });

  it("validates exact source coverage, observation clocks and same-observation metadata", () => {
    const sources = [source(), source("accounting")];
    const byId = new Map(sources.map((record) => [record.id, record]));
    const captured = capturePricingSourceRecords(partition(), sources);
    const records = captured.snapshot.source_records;
    if (records === undefined) throw new Error("Missing captured records");
    expect(() => validatePricingSourceRecords(captured, byId)).not.toThrow();
    for (const invalid of [
      [],
      records.slice(0, 1),
      records.toReversed(),
      [...records, ...records],
      records.map((record) => ({ ...record, observed_at: later })),
      records.map((record) => ({ ...record, content_hash: "b".repeat(64) })),
    ])
      expect(() =>
        validatePricingSourceRecords(
          { ...captured, snapshot: { ...captured.snapshot, source_records: invalid } },
          byId,
        ),
      ).toThrow("Pricing source");
    expect(() => validatePricingSourceRecords(captured, new Map())).toThrow("missing");
    expect(
      providerPricingSnapshotSchema.safeParse({
        ...captured.snapshot,
        source_records: records.map((record) => ({ ...record, content_hash: "unknown" })),
      }).success,
    ).toBe(false);
  });

  it("uses matching legacy observations and refuses to substitute unavailable revisions", () => {
    const value = partition();
    expect(snapshotSourceRecords(value, [source(), source("accounting")])).toMatchObject([
      { id: "accounting" },
      { id: "price" },
    ]);
    expect(() =>
      snapshotSourceRecords(value, [
        { ...source(), observed_at: later },
        { ...source(), provider_id: "other" },
      ]),
    ).toThrow("Missing historical price source revision");
    expect(() => validatePricingSourceRecords(partition(), new Map())).not.toThrow();
  });

  it("includes selector-only evidence sources in the price revision set", () => {
    const value = partition();
    value.books.push({
      id: "book",
      provider_id: "test",
      book_key: "public",
      scope: { kind: "models", model_refs: ["test/model"] },
      scope_observations: [],
      resource_edges: [],
      source_refs: ["price"],
      offers: [
        {
          id: "offer",
          offer_key: "usage",
          billing_mode: { namespace: "kmodels", value: "usage" },
          states: [],
          enrollment: [],
          settlement: [],
          relations: [],
          source_refs: ["price"],
          terms: [
            {
              id: "term",
              term_key: "input",
              kind: "rate",
              meter: { namespace: "kmodels", value: "input_text" },
              source_refs: ["price"],
              raw_variants: [],
              variants: [
                {
                  price: {
                    value: { numerator: "1", denominator: "1" },
                    denomination: { kind: "fiat", currency: "USD" },
                    per: {
                      factors: [{ unit: { namespace: "kmodels", value: "token" }, power: 1 }],
                    },
                  },
                  applicability: unconditionalApplicability,
                  observations: [],
                  selector_sources: [
                    {
                      dimension: { namespace: "kmodels", value: "region" },
                      channel: "request",
                      locator: { kind: "provider_field", value: "region" },
                      availability: "always",
                      observations: [
                        {
                          source_ref: "selector",
                          locator: { kind: "table", value: "region field" },
                          raw: { label: "Request region" },
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    expect(providerPartitionSourceRefs(value)).toEqual(["accounting", "price", "selector"]);
    expect(() => capturePricingSourceRecords(value, [source(), source("accounting")])).toThrow(
      "selector",
    );
  });
});
