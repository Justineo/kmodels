import { describe, expect, it } from "vite-plus/test";
import { baseModel } from "../src/catalog/model.ts";
import { validateModelDetailSources as validateLimitDetailSources } from "../src/catalog/model-claim-details.ts";
import { limitStatementsConflict } from "../src/catalog/model-claim-helpers.ts";
import {
  limitDetailGroupSchema,
  limitDetailsSchema,
  limitStatementSchema,
} from "../src/catalog/model-limit-details.ts";
import { providerModelSchema } from "../src/catalog/schema.ts";
import { validateProvider } from "../src/catalog/validation.ts";

const evidence = {
  document_url: "https://example.com/docs/batch",
  locator: "Output budget",
  observed_at: "2026-11-17T12:00:00.000Z",
  content_hash: "a".repeat(64),
  excerpt: "The batch output maximum is 300,000 tokens.",
};
const maximum = {
  quantity: "output_tokens",
  kind: "maximum",
  tokens: 300000,
  measurement: "per_response",
  scope: "Batch API with the documented beta header.",
};
const group = {
  source_ref: "example-models",
  claim: "batch_output_beta",
  statements: [maximum],
  evidence: [evidence],
};

describe("source-owned limit detail schema", () => {
  it("detects same-scope finite maximum versus no cap while keeping defaults and different measurements independent", () => {
    const finite = limitStatementSchema.parse(maximum);
    if (finite.kind !== "maximum") throw new Error("Expected a finite maximum");
    const { tokens: _tokens, ...withoutTokens } = maximum;
    const noCap = limitStatementSchema.parse({ ...withoutTokens, kind: "no_separate_cap" });
    expect(limitStatementsConflict(finite, noCap)).toBe(true);
    expect(limitStatementsConflict(noCap, finite)).toBe(true);
    expect(limitStatementsConflict(finite, { ...finite, tokens: 200 })).toBe(true);
    expect(limitStatementsConflict(finite, { ...finite, kind: "default" })).toBe(false);
    expect(limitStatementsConflict(noCap, { ...finite, kind: "default" })).toBe(false);
    expect(limitStatementsConflict(finite, { ...finite, tokens: 200, scope: "Other API" })).toBe(
      false,
    );
    expect(
      limitStatementsConflict(finite, { ...finite, tokens: 200, measurement: "per_hop" }),
    ).toBe(false);
    expect(limitStatementsConflict(finite, finite)).toBe(false);
    expect(limitStatementsConflict(noCap, noCap)).toBe(false);
    expect(
      limitStatementsConflict(
        { ...finite, kind: "default" },
        { ...finite, kind: "default", tokens: 200 },
      ),
    ).toBe(true);
  });

  it("requires model-cited same-provider source ownership at the canonical graph boundary", () => {
    const model = providerModelSchema.parse({
      ...baseModel({
        providerId: "example",
        id: "model",
        name: "Model",
        sourceId: group.source_ref,
        observedAt: evidence.observed_at,
      }),
      limit_details: [group],
    });
    const source = {
      id: group.source_ref,
      provider_id: "example",
      url: evidence.document_url,
      source: ["website" as const],
      stability: "documented" as const,
      scope: "global" as const,
      exhaustive: false,
      role: "catalog" as const,
      field_paths: ["limit_details"],
      observed_at: evidence.observed_at,
      content_hash: evidence.content_hash,
      extractor_version: "1",
    };
    expect(validateProvider([{ ...model, source_refs: ["other"] }])).toMatchObject({
      ok: false,
      issue: { code: "missing_limit_detail_source" },
    });
    expect(() => validateLimitDetailSources({ models: [model], sources: [source] })).not.toThrow();
    expect(() => validateLimitDetailSources({ models: [model], sources: [] })).toThrow("Unowned");
    expect(() =>
      validateLimitDetailSources({
        models: [model],
        sources: [{ ...source, provider_id: "other" }],
      }),
    ).toThrow("Unowned");
    expect(() =>
      validateLimitDetailSources({ models: [model], sources: [{ ...source, field_paths: [] }] }),
    ).toThrow("Unowned");
    expect(() =>
      validateLimitDetailSources({ models: [model], sources: [{ ...source, role: "inventory" }] }),
    ).toThrow("Unowned");
    expect(() =>
      validateLimitDetailSources({
        models: [{ ...model, source_refs: ["other"] }],
        sources: [source],
      }),
    ).toThrow("Unowned");
  });
  it("preserves absent legacy fields and round-trips qualified facts without scalar changes", () => {
    const model = providerModelSchema.parse(
      baseModel({
        providerId: "example",
        id: "example-model",
        name: "Example",
        sourceId: group.source_ref,
        observedAt: evidence.observed_at,
      }),
    );
    expect(model).not.toHaveProperty("limit_details");
    const detailed = providerModelSchema.parse({ ...model, limit_details: [group] });
    expect(detailed).toEqual({ ...model, limit_details: [group] });
    expect(detailed.limits).toEqual({});
  });

  it("distinguishes finite maxima, defaults, no separate cap and evidenced withdrawal", () => {
    expect(limitDetailsSchema.parse([group])).toEqual([group]);
    expect(limitStatementSchema.parse({ ...maximum, kind: "default" }).kind).toBe("default");
    const { tokens: _tokens, ...withoutTokens } = maximum;
    const noCap = { ...withoutTokens, kind: "no_separate_cap" };
    expect(limitStatementSchema.parse(noCap)).toEqual(noCap);
    expect(() => limitStatementSchema.parse({ ...noCap, tokens: 300000 })).toThrow();
    expect(() => limitStatementSchema.parse(withoutTokens)).toThrow();
    expect(limitDetailGroupSchema.parse({ ...group, statements: [] }).statements).toEqual([]);
    expect(() => limitDetailGroupSchema.parse({ ...group, evidence: [] })).toThrow();
  });

  it.each([0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid finite token quantities: %s",
    (tokens) => {
      expect(() => limitStatementSchema.parse({ ...maximum, tokens })).toThrow();
    },
  );

  it("closes objects and rejects duplicate source/claim observations", () => {
    expect(() => limitStatementSchema.parse({ ...maximum, applies_when: {} })).toThrow();
    expect(() => limitDetailGroupSchema.parse({ ...group, extra: true })).toThrow();
    expect(() => limitDetailsSchema.parse([group, group])).toThrow("Duplicate");
    expect(limitDetailsSchema.parse([group, { ...group, claim: "ordinary_output" }])).toHaveLength(
      2,
    );
    expect(
      limitDetailsSchema.parse([group, { ...group, source_ref: "other-models" }]),
    ).toHaveLength(2);
  });

  it.each([
    { document_url: "https://user:secret@example.com/docs" },
    { document_url: "javascript:alert(1)" },
    { document_url: "invalid URL" },
    { content_hash: "not-a-revision" },
    { locator: "" },
    { observed_at: "yesterday" },
    { extra: true },
  ])("rejects malformed or unsafe evidence: %j", (invalid) => {
    expect(() =>
      limitDetailGroupSchema.parse({ ...group, evidence: [{ ...evidence, ...invalid }] }),
    ).toThrow();
  });

  it("bounds counts and UTF-8 size without silently truncating evidence", () => {
    expect(() =>
      limitDetailGroupSchema.parse({ ...group, statements: Array(17).fill(maximum) }),
    ).toThrow();
    expect(() =>
      limitDetailGroupSchema.parse({ ...group, evidence: Array(4).fill(evidence) }),
    ).toThrow();
    expect(() =>
      limitDetailsSchema.parse(
        Array.from({ length: 9 }, (_, index) => ({ ...group, claim: `${index}` })),
      ),
    ).toThrow();
    const largeGroup = { ...group, evidence: [{ ...evidence, excerpt: "界".repeat(2048) }] };
    expect(() =>
      limitDetailsSchema.parse(
        Array.from({ length: 3 }, (_, index) => ({ ...largeGroup, claim: `${index}` })),
      ),
    ).toThrow("16 KiB");
  });
});
