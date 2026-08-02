import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";
import {
  assertItemCount,
  assertCoverage,
  invalidJsonContractEvidence,
  recognizeItems,
  contractEvidence,
  sourceContractEvidenceSchema,
  SourceContractError,
  zodContractEvidence,
  type SourceContractEvidence,
  type ZodContractObservation,
} from "../src/catalog/source-contract.ts";

const itemSchema = z.strictObject({
  id: z.string(),
  video: z.strictObject({
    generate_audio: z.boolean(),
    operation: z.enum(["generate", "extend"]),
  }),
});

function observation(value: unknown, itemIndex: number, modelId: string): ZodContractObservation {
  const result = itemSchema.safeParse(value);
  if (result.success) throw new Error("Expected contract fixture to be invalid");
  return { error: result.error, input: value, itemIndex, modelId };
}

describe("source contract diagnostics", () => {
  it("aggregates bounded, actionable evidence without copying response bodies", () => {
    const observations = [
      observation({ id: "acme/one", video: { operation: "generate" } }, 0, "acme/one"),
      observation({ id: "acme/two", video: { operation: "extend" } }, 1, "acme/two"),
      observation(
        {
          id: "acme/three",
          video: { generate_audio: true, operation: "replace", undocumented: true },
        },
        2,
        "acme/three",
      ),
      observation(
        {
          id: "acme/four",
          video: { generate_audio: true, operation: "remix" },
        },
        3,
        `acme/hf_${"a".repeat(32)}`,
      ),
    ];
    const evidence = zodContractEvidence(observations, observations.length);

    expect(evidence).toMatchObject({
      disposition: "reject",
      observed_items: 4,
      diagnostic_count: 3,
      diagnostics: [
        {
          kind: "missing_required_field",
          path: "/video/generate_audio",
          expected: "boolean",
          observed: "missing",
          affected_items: 2,
          sample_model_ids: ["acme/one", "acme/two"],
        },
        {
          kind: "unknown_value",
          path: "/video/operation",
          expected: "reviewed value",
          observed: "string",
          affected_items: 2,
          sample_model_ids: ["acme/three"],
        },
        {
          kind: "unknown_field",
          path: "/video/undocumented",
          observed: "boolean",
          observed_value: "true",
          affected_items: 1,
          sample_model_ids: ["acme/three"],
        },
      ],
    });
    for (const diagnostic of evidence.diagnostics)
      expect(diagnostic.fingerprint).toMatch(/^[0-9a-f]{16}$/u);
    expect(evidence.diagnostics[1]?.observed_value).toBeUndefined();
    expect(JSON.stringify(evidence)).not.toContain("Expected contract fixture");
    expect(JSON.stringify(evidence)).not.toContain("hf_");
    expect(zodContractEvidence(observations.toReversed(), observations.length)).toEqual(evidence);
    const diagnostic = evidence.diagnostics[0];
    if (diagnostic === undefined) throw new Error("Expected a schema drift diagnostic");
    expect(
      sourceContractEvidenceSchema.safeParse({
        ...evidence,
        diagnostics: [{ ...diagnostic, sample_model_ids: [`acme/hf_${"a".repeat(32)}`] }],
      }).success,
    ).toBe(false);
  });

  it("classifies malformed JSON without retaining its contents", () => {
    const evidence = invalidJsonContractEvidence();
    const error = new SourceContractError("Source response", evidence);
    expect(evidence.diagnostics[0]).toMatchObject({
      kind: "invalid_json",
      path: "/",
      expected: "valid JSON",
      observed: "string",
    });
    expect(error.message).toContain("invalid_json at /");
  });

  it("normalizes array positions into one stable diagnostic", () => {
    const schema = z.array(z.strictObject({ value: z.boolean() }));
    const inputs = [[{ value: "wrong" }], [{ value: true }, { value: "wrong" }]];
    const observations = inputs.map((input, itemIndex): ZodContractObservation => {
      const result = schema.safeParse(input);
      if (result.success) throw new Error("Expected indexed contract fixture to be invalid");
      return { error: result.error, input, itemIndex };
    });

    expect(zodContractEvidence(observations, 2)).toMatchObject({
      diagnostic_count: 1,
      diagnostics: [{ path: "/*/value", affected_items: 2 }],
    });
  });

  it("bounds diagnostics and public model samples", () => {
    const wideSchema = z.strictObject({ id: z.string() });
    const wideInput = Object.fromEntries([
      ["id", "acme/model"],
      ...Array.from({ length: 10 }, (_, index) => [`field_${index}`, true]),
    ]);
    const wideResult = wideSchema.safeParse(wideInput);
    if (wideResult.success) throw new Error("Expected wide contract fixture to be invalid");
    const wideEvidence = zodContractEvidence(
      [{ error: wideResult.error, input: wideInput, itemIndex: 0 }],
      1,
    );
    expect(wideEvidence.diagnostic_count).toBe(10);
    expect(wideEvidence.diagnostics).toHaveLength(8);

    const samples = ["acme/four", "acme/one", "acme/three", "acme/two"].map((modelId, itemIndex) =>
      observation({ id: modelId, video: { operation: "generate" } }, itemIndex, modelId),
    );
    expect(zodContractEvidence(samples, samples.length).diagnostics[0]?.sample_model_ids).toEqual([
      "acme/four",
      "acme/one",
      "acme/three",
    ]);
  });

  it("accepts root extensions with bounded evidence while preserving strict owned semantics", () => {
    const findings: SourceContractEvidence[] = [];
    const values = [
      { id: "acme/one", video: { generate_audio: true, operation: "generate" }, future: true },
      { id: "acme/two", video: { generate_audio: false, operation: "extend" }, future: false },
    ];
    const openRootSchema = itemSchema.strip();
    const parsed = recognizeItems({
      label: "Example item",
      items: values,
      schema: openRootSchema,
      modelId: "id",
      rootKeys: Object.keys(openRootSchema.shape),
      onFinding: (evidence) => findings.push(evidence),
    });

    expect(parsed).toHaveLength(2);
    expect(parsed[0]).not.toHaveProperty("future");
    expect(findings).toMatchObject([
      {
        disposition: "accept_with_signal",
        observed_items: 2,
        diagnostics: [
          {
            kind: "unknown_field",
            path: "/future",
            affected_items: 2,
            sample_model_ids: ["acme/one", "acme/two"],
          },
        ],
      },
    ]);
    expect(() =>
      recognizeItems({
        label: "Example item",
        items: [{ id: "acme/one", video: { generate_audio: "yes", operation: "generate" } }],
        schema: openRootSchema,
      }),
    ).toThrow("contract mismatch");
  });

  it("classifies empty and oversized collections as coverage findings", () => {
    for (const count of [0, 4]) {
      try {
        assertItemCount("Example catalog", count, 1, 3, ["data"]);
        expect.unreachable("Expected the item count to be rejected");
      } catch (error) {
        expect(contractEvidence(error)).toMatchObject({
          disposition: "reject",
          observed_items: count,
          diagnostics: [
            {
              kind: "count_outside_bounds",
              path: "/data",
              observed_value: String(count),
              affected_items: count,
            },
          ],
        });
      }
    }
    try {
      assertCoverage("Example pricing", 7, 10, 0.8, ["pricing"]);
      expect.unreachable("Expected pricing coverage to be rejected");
    } catch (error) {
      expect(contractEvidence(error)).toMatchObject({
        disposition: "reject",
        observed_items: 10,
        diagnostics: [
          {
            kind: "coverage_below_threshold",
            path: "/pricing",
            expected: "at least 80.00% coverage",
            observed_value: "7/10",
            affected_items: 3,
          },
        ],
      });
    }
  });
});
