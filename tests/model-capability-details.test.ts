import { describe, expect, it } from "vite-plus/test";
import {
  capabilityDetailsSchema,
  capabilityStatementSchema,
  capabilityStatementsConflict,
  type CapabilityDetailGroup,
} from "../src/catalog/model-capability-details.ts";
import { baseModel } from "../src/catalog/model.ts";
import { migrateCatalogStorage, providerModelSchema } from "../src/catalog/schema.ts";

const observedAt = "2026-11-17T18:22:22.975Z";
const scope = "Gemini Interactions API";
const group: CapabilityDetailGroup = {
  source_ref: "test-models",
  claim: "interactions",
  statements: [
    { kind: "prompt_cache", mode: "implicit", scope },
    { kind: "prompt_cache", mode: "explicit", scope },
    {
      kind: "reasoning_effort",
      scope,
      supported_values: ["low", "high"],
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
  it("migrates stored unsupported cache modes and effort exclusions away", () => {
    const cache = (claim: string, statements: object[]) => ({ ...group, claim, statements });
    const negative = { kind: "prompt_cache", mode: "explicit", supported: false, scope };
    const migrated = migrateCatalogStorage({
      sources: [],
      models: [
        {
          uid: "test/mixed",
          capability_details: [
            cache("mixed", [
              { kind: "prompt_cache", mode: "implicit", supported: true, scope },
              negative,
            ]),
            cache("excluded", [negative]),
            cache("withdrawn", []),
          ],
        },
        { uid: "test/excluded", capability_details: [cache("excluded", [negative])] },
        {
          uid: "test/effort",
          capability_details: [
            cache("levels", [
              {
                kind: "reasoning_effort",
                scope,
                supported_values: ["low"],
                unsupported_values: ["none"],
              },
            ]),
            cache("exclusions", [
              { kind: "reasoning_effort", scope, unsupported_values: ["none"] },
            ]),
          ],
        },
      ],
    });
    expect(migrated).toEqual({
      sources: [],
      models: [
        {
          uid: "test/mixed",
          capability_details: [
            cache("mixed", [{ kind: "prompt_cache", mode: "implicit", scope }]),
            cache("withdrawn", []),
          ],
        },
        { uid: "test/excluded" },
        {
          uid: "test/effort",
          capability_details: [
            cache("levels", [{ kind: "reasoning_effort", scope, supported_values: ["low"] }]),
          ],
        },
      ],
    });
  });
  it("detects exact-scope effort contradictions and records only documented cache modes", () => {
    const implicit = capabilityStatementSchema.parse({
      kind: "prompt_cache",
      mode: "implicit",
      scope,
    });
    // An unsupported mode is not stored, so a support flag is not part of the contract.
    expect(capabilityStatementSchema.safeParse({ ...implicit, supported: false }).success).toBe(
      false,
    );
    const effort = { kind: "reasoning_effort", scope, supported_values: ["low"] } as const;
    const compareEffort = (a: unknown, b: unknown) =>
      capabilityStatementsConflict(
        capabilityStatementSchema.parse(a),
        capabilityStatementSchema.parse(b),
      );
    expect(compareEffort(effort, { ...effort, supported_values: ["medium"] })).toBe(false);
    expect(
      compareEffort({ ...effort, default_value: "medium" }, { ...effort, default_value: "high" }),
    ).toBe(true);
    if (implicit.kind !== "prompt_cache") throw new Error("Expected a cache claim");
    expect(capabilityStatementsConflict(implicit, implicit)).toBe(false);
    expect(capabilityStatementsConflict(implicit, { ...implicit, mode: "explicit" })).toBe(false);
  });
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
    { supported_values: [] },
    { supported_values: ["high"], parameter_path: "reasoning.effort" },
    { default_value: "high", applicability: { interface: " ", parameter: "effort" } },
    { default_value: "high", applicability: { interface: "API", parameter: " effort " } },
    { default_value: "high", applicability: { interface: "API", condition: "x".repeat(769) } },
    { default_value: "high", applicability: { interface: "API", url: "https://example.com/" } },
  ])("rejects malformed or empty effort observations %j", (input) => {
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
