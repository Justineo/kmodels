import { describe, expect, it } from "vite-plus/test";
import {
  capabilityDetailsSchema,
  capabilityStatementSchema,
  type CapabilityDetailGroup,
} from "../src/catalog/model-capability-details.ts";
import { baseModel } from "../src/catalog/model.ts";
import { providerModelSchema } from "../src/catalog/schema.ts";

const observedAt = "2026-11-17T18:22:22.975Z";
const scope = "Gemini Interactions API";
const group: CapabilityDetailGroup = {
  source_ref: "test-models",
  claim: "interactions",
  statements: [
    { kind: "prompt_cache", mode: "implicit", supported: true, scope },
    { kind: "prompt_cache", mode: "explicit", supported: false, scope },
    {
      kind: "reasoning_effort",
      scope,
      supported_values: ["low", "high"],
      unsupported_values: ["minimal"],
      default_value: "medium",
    },
  ],
  evidence: [
    {
      document_url: "https://example.com/capabilities",
      locator: "Interactions model table",
      observed_at: observedAt,
      content_hash: "a".repeat(64),
      excerpt: "Medium is the default.",
    },
  ],
};

describe("scoped model capability details", () => {
  it("preserves optional detail and native values independently of legacy capabilities", () => {
    const model = providerModelSchema.parse(
      baseModel({
        providerId: "test",
        id: "model",
        name: "Model",
        sourceId: "test-models",
        observedAt,
      }),
    );
    expect(model).not.toHaveProperty("capability_details");
    expect(providerModelSchema.parse({ ...model, capability_details: [group] })).toEqual({
      ...model,
      capability_details: [group],
    });
    expect(
      capabilityStatementSchema.parse({ kind: "reasoning_effort", scope, default_value: "XHigh" }),
    ).toEqual({ kind: "reasoning_effort", scope, default_value: "XHigh" });
  });

  it.each([
    {},
    { default_value: " " },
    { supported_values: ["medium", "medium"] },
    { supported_values: ["high"], unsupported_values: ["high"] },
    { default_value: "high", unsupported_values: ["high"] },
    { supported_values: [] },
    { supported_values: ["high"], parameter_path: "reasoning.effort" },
  ])("rejects malformed, empty or contradictory effort observations %j", (input) => {
    expect(
      capabilityStatementSchema.safeParse({ kind: "reasoning_effort", scope, ...input }).success,
    ).toBe(false);
  });

  it("distinguishes an evidenced withdrawal from contradictory duplicate groups", () => {
    expect(capabilityDetailsSchema.parse([{ ...group, statements: [] }])).toEqual([
      { ...group, statements: [] },
    ]);
    expect(() => capabilityDetailsSchema.parse([group, group])).toThrow("Duplicate");
    expect(() => capabilityDetailsSchema.parse([{ ...group, evidence: [] }])).toThrow();
    expect(() =>
      capabilityStatementSchema.parse({
        kind: "prompt_cache",
        mode: "explicit",
        supported: "unknown",
        scope,
      }),
    ).toThrow();
  });
});
