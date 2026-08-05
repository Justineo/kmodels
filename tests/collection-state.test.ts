import { describe, expect, it } from "vite-plus/test";
import { fetchStateSchema } from "../src/catalog/fetch.ts";
import { baseModel } from "../src/catalog/model.ts";
import { emptyPricingCatalog, type PricingCatalog } from "../src/catalog/pricing-schema.ts";
import { catalogSchema, type Catalog, type ProviderModel } from "../src/catalog/schema.ts";
import type { SourceContractEvidence } from "../src/catalog/source-contract.ts";
import { summarizeRefresh } from "../src/catalog/summary.ts";

const previousAt = "2026-07-23T00:00:00.000Z";
const currentAt = "2026-07-24T00:00:00.000Z";
const noPricing = emptyPricingCatalog();

function contractFinding(
  disposition: SourceContractEvidence["disposition"],
  path: string,
): SourceContractEvidence {
  return {
    disposition,
    observed_items: 1,
    diagnostic_count: 1,
    diagnostics: [
      {
        fingerprint: "0123456789abcdef",
        kind: "unknown_field",
        path,
        observed: "boolean",
        observed_value: "true",
        affected_items: 1,
        sample_model_ids: ["test/model"],
      },
    ],
  };
}

function catalog(
  version: string,
  generatedAt: string,
  models: ProviderModel[],
  sourceHash: string,
  status: "fresh" | "stale" = "fresh",
): Catalog {
  return catalogSchema.parse({
    catalog_version: version.repeat(64),
    generated_at: generatedAt,
    providers: [
      {
        id: "test",
        name: "Test",
        kind: "hosted",
        homepage: "https://example.com",
        catalog_scope: "global",
        source_ids: ["test-catalog"],
        last_successful_sync_at: generatedAt,
        catalog_version: version.repeat(64),
      },
    ],
    models,
    sources: [
      {
        id: "test-catalog",
        provider_id: "test",
        url: "https://example.com/models",
        source: ["api"],
        stability: "documented",
        scope: "global",
        exhaustive: true,
        role: "catalog",
        field_paths: ["model_id", "name"],
        observed_at: generatedAt,
        content_hash: sourceHash.repeat(64),
        extractor_version: "test-v1",
      },
    ],
    coverage: [
      {
        provider_id: "test",
        status,
        model_count: models.length,
        pricing_term_count: 0,
        checked_at: generatedAt,
        last_successful_sync_at: generatedAt,
      },
    ],
    warnings: [],
  });
}

function pricing(rawLabel: string, publication: "fresh" | "retained"): PricingCatalog {
  return {
    provider_vocabularies: [{ provider_id: "test", atoms: [] }],
    provider_snapshots: [
      publication === "fresh"
        ? {
            provider_id: "test",
            observed_at: currentAt,
            publication,
          }
        : {
            provider_id: "test",
            observed_at: currentAt,
            publication,
            refresh_failure: {
              attempted_at: currentAt,
              code: "provider_refresh_failed",
            },
          },
    ],
    model_dispositions: [
      {
        model_ref: "test/model",
        state: "not_applicable",
        observations: [
          {
            source_ref: "test-catalog",
            locator: { kind: "table", value: "pricing" },
            establishes_model_ref: "test/model",
            raw: { label: rawLabel },
          },
        ],
      },
    ],
    books: [],
  };
}

describe("collection state", () => {
  it("can persist a source failure before its first successful observation", () => {
    const state = {
      sources: {
        "test-catalog": {
          checkedAt: currentAt,
          consecutiveFailures: 1,
        },
      },
    };
    expect(fetchStateSchema.parse(state)).toEqual(state);
  });

  it("summarizes semantic changes without counting observation timestamps", () => {
    const previousModel = baseModel({
      providerId: "test",
      id: "model",
      name: "Model",
      sourceId: "test-catalog",
      observedAt: previousAt,
    });
    const unchangedModel = {
      ...previousModel,
      last_seen_at: currentAt,
      observed_at: currentAt,
    };
    const previous = catalog("a", previousAt, [previousModel], "b");
    const unchanged = summarizeRefresh(
      previous,
      catalog("c", currentAt, [unchangedModel], "b"),
      noPricing,
      noPricing,
    );
    expect(unchanged.providers[0]?.models).toMatchObject({
      added: 0,
      removed: 0,
      changed: 0,
      unchanged: 1,
      changed_fields: {},
    });
    expect(unchanged.providers[0]?.pricing_publication).toBe("not_observed");
    expect(unchanged.providers[0]?.pricing_coverage).toEqual({
      current_models: 1,
      offer_models: 0,
      not_applicable_models: 0,
      unknown_models: 1,
      normalized_rate_models: 0,
      raw_fact_models: 0,
      unknown_model_refs: ["test/model"],
      unknown_model_refs_omitted: 0,
      delta: { resolved_models: 0, unknown_models: 0 },
    });

    const changedModel = { ...unchangedModel, name: "Renamed model" };
    const addedModel = baseModel({
      providerId: "test",
      id: "new-model",
      name: "New model",
      sourceId: "test-catalog",
      observedAt: currentAt,
    });
    const changed = summarizeRefresh(
      previous,
      catalog("d", currentAt, [changedModel, addedModel], "e"),
      noPricing,
      noPricing,
    );
    expect(changed.providers[0]).toMatchObject({
      models: {
        previous: 1,
        current: 2,
        added: 1,
        removed: 0,
        changed: 1,
        unchanged: 0,
        changed_fields: { name: 1 },
        added_model_refs: ["test/new-model"],
        removed_model_refs: [],
        changed_models: [
          {
            model_ref: "test/model",
            fields: ["name"],
            field_changes: [{ path: "name", previous: "Model", current: "Renamed model" }],
          },
        ],
      },
      sources: {
        previous: 1,
        current: 1,
        added: 0,
        removed: 0,
        changed: 1,
        unchanged: 0,
      },
      pricing_coverage: {
        delta: { resolved_models: 0, unknown_models: 1 },
      },
    });
    expect(changed).toMatchObject({
      schema_version: 2,
      outcome: "changed",
      totals: { added_models: 1, changed_models: 1, retained: 0 },
    });
  });

  it("records exact leaf-level model field changes", () => {
    const previousModel = {
      ...baseModel({
        providerId: "test",
        id: "model",
        name: "Model",
        sourceId: "test-catalog",
        observedAt: previousAt,
      }),
      limits: {
        context_tokens: 128_000,
        max_output_tokens: 4_096,
        embedding_dimensions: [512, 1_024],
      },
    };
    const currentModel = {
      ...previousModel,
      limits: {
        context_tokens: 131_072,
        embedding_dimensions: [256, 512, 1_024],
      },
      last_seen_at: currentAt,
      observed_at: currentAt,
    };
    const summary = summarizeRefresh(
      catalog("a", previousAt, [previousModel], "b"),
      catalog("c", currentAt, [currentModel], "b"),
      noPricing,
      noPricing,
    );

    expect(summary.providers[0]?.models.changed_models).toEqual([
      {
        model_ref: "test/model",
        fields: ["limits"],
        field_changes: [
          { path: "limits.context_tokens", previous: 128_000, current: 131_072 },
          {
            path: "limits.embedding_dimensions",
            previous: [512, 1_024],
            current: [256, 512, 1_024],
          },
          { path: "limits.max_output_tokens", previous: 4_096 },
        ],
      },
    ]);
  });

  it("does not count omitted and explicitly undefined optional fields as different", () => {
    const previousModel = {
      ...baseModel({
        providerId: "test",
        id: "model",
        name: "Model",
        sourceId: "test-catalog",
        observedAt: previousAt,
      }),
      limits: { context_tokens: 128_000 },
    };
    const currentModel = {
      ...previousModel,
      limits: {
        context_tokens: 128_000,
        max_input_tokens: undefined,
        max_output_tokens: undefined,
      },
      last_seen_at: currentAt,
      observed_at: currentAt,
    };
    const summary = summarizeRefresh(
      catalog("a", previousAt, [previousModel], "b"),
      catalog("c", currentAt, [currentModel], "b"),
      noPricing,
      noPricing,
    );

    expect(summary.providers[0]?.models).toMatchObject({ changed: 0, unchanged: 1 });
  });

  it("separates rejected observations from retained publication", () => {
    const previousModel = baseModel({
      providerId: "test",
      id: "model",
      name: "Model",
      sourceId: "test-catalog",
      observedAt: previousAt,
    });
    const previous = catalog("a", previousAt, [previousModel], "b");
    const current = catalog("c", currentAt, [previousModel], "b", "stale");
    const summary = summarizeRefresh(previous, current, noPricing, noPricing, [
      {
        provider_id: "test",
        outcome: "rejected",
        sources: [
          {
            source_id: "test-catalog",
            outcome: "parse_failed",
            message: "schema changed",
            consecutive_failures: 2,
            last_success_at: previousAt,
            contract_finding: contractFinding("reject", "/new_field"),
          },
        ],
        candidate_models: [],
        validation_issue: {
          code: "model_count_drop",
          message: "model count dropped by more than 10%",
          previous: 1,
          current: 0,
          minimum_ratio: 0.9,
        },
        failure: { code: "source_schema_changed", message: "schema changed" },
      },
    ]);

    expect(summary).toMatchObject({
      outcome: "unchanged",
      publication: "partial",
      totals: { accepted: 0, retained: 1, withheld: 0 },
      providers: [
        {
          provider_id: "test",
          status: "stale",
          publication: "retained",
          pricing_publication: "not_observed",
          models: { removed: 0 },
          signals: [
            "drift_guard_triggered",
            "breaking_contract_mismatch",
            "coverage_regression",
            "persistent_source_failure",
          ],
          attempt: {
            outcome: "rejected",
            models: { removed: 1, removed_model_refs: ["test/model"] },
            sources: [
              {
                source_id: "test-catalog",
                consecutive_failures: 2,
                contract_finding: {
                  disposition: "reject",
                  observed_items: 1,
                  diagnostic_count: 1,
                },
              },
            ],
            validation_issue: { code: "model_count_drop" },
            failure: { code: "source_schema_changed" },
          },
        },
      ],
    });
  });

  it("accepts fresh publication while surfacing an unowned source extension", () => {
    const model = baseModel({
      providerId: "test",
      id: "model",
      name: "Model",
      sourceId: "test-catalog",
      observedAt: currentAt,
    });
    const previous = catalog("a", previousAt, [model], "b");
    const current = catalog("c", currentAt, [model], "d");
    const summary = summarizeRefresh(previous, current, noPricing, noPricing, [
      {
        provider_id: "test",
        outcome: "accepted",
        sources: [
          {
            source_id: "test-catalog",
            outcome: "changed",
            parsed_models: 1,
            content_changed: true,
            extractor_changed: false,
            contract_finding: contractFinding("accept_with_signal", "/future_field"),
          },
        ],
        candidate_models: [model],
      },
    ]);

    expect(summary).toMatchObject({
      outcome: "evidence_only",
      publication: "complete",
      providers: [
        {
          provider_id: "test",
          publication: "accepted",
          signals: ["unreviewed_extension"],
          attempt: {
            outcome: "accepted",
            sources: [
              {
                source_id: "test-catalog",
                outcome: "changed",
                contract_finding: { disposition: "accept_with_signal" },
              },
            ],
          },
        },
      ],
    });
  });

  it("separates canonical pricing commercial and provenance outcomes", () => {
    const previousModel = baseModel({
      providerId: "test",
      id: "model",
      name: "Model",
      sourceId: "test-catalog",
      observedAt: previousAt,
    });
    const previous = catalog("a", previousAt, [previousModel], "b");
    const current = catalog("c", currentAt, [previousModel], "b");
    const provenance = summarizeRefresh(
      previous,
      current,
      pricing("Not offered before", "fresh"),
      pricing("Not offered now", "retained"),
    );
    expect(provenance.providers[0]?.pricing).toMatchObject({
      outcome: "provenance_only",
    });
    expect(provenance).toMatchObject({
      publication: "partial",
      totals: { pricing_retained: 1 },
      providers: [{ publication: "accepted", pricing_publication: "retained" }],
    });
    expect(provenance.providers[0]?.pricing_coverage).toMatchObject({
      current_models: 1,
      offer_models: 0,
      not_applicable_models: 1,
      unknown_models: 0,
      unknown_model_refs: [],
      delta: { resolved_models: 0, unknown_models: 0 },
    });

    const removed = summarizeRefresh(previous, current, pricing("Not offered", "fresh"), noPricing);
    expect(removed.providers[0]).toMatchObject({
      pricing: { outcome: "removed" },
      pricing_publication: "removed",
    });
  });
});
