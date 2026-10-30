import { z } from "zod";
import { conformanceSchema, type ConformanceSuite } from "./pricing-conformance.ts";
import { calculationEnvelopeSchema } from "../src/pricing/schema.ts";
import {
  calculationV2EnvelopeSchema,
  calculationV2RequestSchema,
  type CalculationV2Envelope,
} from "../src/pricing/v2/schema.ts";
import { emptyInvocationCatalog, type InvocationTarget } from "../src/catalog/invocation-schema.ts";
import {
  invocationCaseId,
  invocationEvidenceId,
  invocationTargetId,
} from "../src/catalog/invocation-identity.ts";
import { invocationSelectorSourceRef } from "../src/catalog/publication-v2.ts";
import { canonicalizeApplicability } from "../src/catalog/pricing-canonical.ts";

export const conformanceV2Schema = conformanceSchema.extend({
  schemaVersion: z.literal("2.0"),
  datasets: z.record(z.string(), calculationV2EnvelopeSchema),
  cases: z.array(
    conformanceSchema.shape.cases.element.extend({ request: calculationV2RequestSchema }),
  ),
});
export type ConformanceV2Suite = z.infer<typeof conformanceV2Schema>;

const shallowEnvelope = z.looseObject({
  snapshot: calculationEnvelopeSchema.shape.snapshot,
  providers: z.array(z.looseObject({ models: z.array(z.looseObject({ model_ref: z.string() })) })),
});

/** Preserve deliberately malformed commercial inputs in error vectors. */
function upgradeFixture(value: unknown): unknown {
  if (typeof value !== "object" || value === null || !("schemaVersion" in value))
    throw new Error("Invalid fixture envelope");
  if (value.schemaVersion !== "1.0") return { ...value, schemaVersion: "3.0" };
  const data = shallowEnvelope.parse(value);
  return {
    ...data,
    schemaVersion: "2.0",
    snapshot: {
      ...data.snapshot,
      coreDataSha256: data.snapshot.coreCatalogVersion,
      pricingAssetSha256: "d".repeat(64),
    },
    providers: data.providers.map((provider) => ({
      ...provider,
      invocation: {
        ...emptyInvocationCatalog(),
        target_coverage: provider.models.map(({ model_ref }) => ({
          model_ref,
          state: "not_collected",
          evidence_refs: [],
        })),
      },
      invocation_sources: [],
      invocation_bindings: [],
    })),
  };
}

export function v2Conformance(legacy: ConformanceSuite): ConformanceV2Suite {
  const suite = conformanceV2Schema.parse({
    ...legacy,
    schemaVersion: "2.0",
    datasets: Object.fromEntries(
      Object.entries(legacy.datasets).map(([key, value]) => [key, upgradeFixture(value)]),
    ),
    errors: legacy.errors.map((entry) =>
      entry.data === undefined ? entry : { ...entry, data: upgradeFixture(entry.data) },
    ),
  });
  const base = suite.datasets["base"];
  const baseCase = suite.cases[0];
  if (base === undefined || baseCase === undefined)
    throw new Error("Missing base conformance vector");
  for (const kind of ["fixed", "context", "observed"] as const) {
    const fixture = invocationFixture(base, kind);
    const dataset = `invocation-${kind}`;
    suite.datasets[dataset] = fixture.data;
    const request = {
      ...baseCase.request,
      components: baseCase.request.components.map((component) => ({
        ...component,
        invocation: fixture.selection,
      })),
    };
    suite.cases.push({
      name: `${kind} invocation selects the explicit tariff`,
      dataset,
      request,
      expected: baseCase.expected,
    });
    suite.errors.push({
      name: `${kind} invocation cannot be omitted`,
      dataset,
      request: baseCase.request,
      expectedCode: "INVALID_REQUEST",
    });
    suite.errors.push({
      name: `${kind} invocation rejects a foreign case`,
      dataset,
      request: {
        ...request,
        components: request.components.map((component) => ({
          ...component,
          invocation: { ...fixture.selection, caseRef: "case:missing" },
        })),
      },
      expectedCode: "INVALID_REQUEST",
    });
    suite.errors.push({
      name: `${kind} invocation rejects an overriding selector`,
      dataset,
      request: {
        ...request,
        components: request.components.map((component) => ({
          ...component,
          selectors: [
            {
              kind: "categorical",
              dimension: fixture.dimension,
              value: { ...fixture.value, value: "other-region" },
            },
          ],
        })),
      },
      expectedCode: "INVALID_REQUEST",
    });
    if (kind !== "fixed")
      suite.errors.push({
        name: `${kind} invocation requires its declared input`,
        dataset,
        request: {
          ...request,
          components: request.components.map((component) => ({
            ...component,
            invocation: {
              targetRef: fixture.selection.targetRef,
              caseRef: fixture.selection.caseRef,
            },
          })),
        },
        expectedCode: "INVALID_REQUEST",
      });
    if (kind === "observed") {
      const changed = structuredClone(fixture.data);
      const binding = changed.providers[0]?.invocation_bindings[0];
      const selector = binding?.selectors[0];
      if (selector === undefined) throw new Error("Missing observed fixture selector");
      selector.value = { kind: "observed", input_ref: "selector:missing" };
      suite.errors.push({
        name: "observed contract reference must resolve",
        data: changed,
        expectedCode: "INVALID_DATA",
      });
    }
  }
  suite.errors.push({
    name: "the v2 reader rejects legacy data",
    data: legacy.datasets["base"],
    expectedCode: "UNSUPPORTED_SCHEMA",
  });
  return conformanceV2Schema.parse(suite);
}

function invocationFixture(base: CalculationV2Envelope, kind: "fixed" | "context" | "observed") {
  const data = structuredClone(base);
  const provider = data.providers[0];
  const offer = provider?.books[0]?.offers[0];
  const source = provider?.sources[0];
  if (provider === undefined || offer === undefined || source === undefined)
    throw new Error("Missing synthetic provider");
  const evidenceIdentity = {
    source_ref: source.id,
    document_url: "https://example.invalid/invocation",
    locator: "#region",
    content_hash: "e".repeat(64),
    basis: "official_documentation" as const,
  };
  const evidence = {
    ...evidenceIdentity,
    id: invocationEvidenceId(evidenceIdentity),
    observed_at: source.observed_at,
  };
  const target: InvocationTarget = {
    id: "pending",
    model_ref: "example/model",
    surface_ref: "example:inference",
    address: { kind: "literal", value: "regional-model" },
    address_role: "model",
    resolution: "pinned",
    selectors: [],
    lifecycle: "active",
    release_stage: "stable",
    evidence_refs: [evidence.id],
    cases: [
      {
        id: "pending",
        task: "text_generation",
        request_region: { kind: "any" },
        inference_mode: { kind: "not_applicable" },
        inference_geo: { kind: "unknown" },
        deployment_type: { kind: "not_applicable" },
        support: { state: "supported", evidence_refs: [evidence.id] },
        requirements: [],
        fact_refs: [],
      },
    ],
  };
  target.id = invocationTargetId(target);
  for (const entry of target.cases) entry.id = invocationCaseId(target.id, entry);
  const entry = target.cases[0];
  if (entry === undefined) throw new Error("Missing synthetic support case");
  provider.invocation_sources = [{ ...source, provider_id: "example", scope: "global" }];
  provider.invocation = {
    surfaces: [
      {
        id: target.surface_ref,
        provider_id: "example",
        endpoint_family: "inference",
        api: "Inference",
        transport: "http",
        method: "POST",
        origin_template: "https://example.invalid",
        path_template: "/inference",
        identifier_location: { kind: "body", pointer: "/model" },
        inputs: [],
        evidence_refs: [evidence.id],
      },
    ],
    invocation_targets: [target],
    invocation_evidence: [evidence],
    identifier_relations: [
      {
        provider_id: "example",
        model_ref: target.model_ref,
        value: "regional-model",
        role: "request_id",
        target_refs: [target.id],
        evidence_refs: [evidence.id],
      },
    ],
    scoped_facts: [],
    target_coverage: [
      {
        model_ref: target.model_ref,
        surface_ref: target.surface_ref,
        state: "partial",
        evidence_refs: [evidence.id],
      },
    ],
  };
  const dimension = { namespace: "provider" as const, provider_id: "example", value: "region" };
  const value = { namespace: "provider" as const, provider_id: "example", value: "test-region" };
  provider.vocabulary.atoms.push(
    {
      kind: "dimension",
      key: "region",
      definition: "Synthetic region",
      resolution_phase: kind === "observed" ? "outcome" : "request",
    },
    {
      kind: "categorical_value",
      key: value.value,
      dimension,
      definition: "Synthetic region value",
    },
  );
  let inputRef = "";
  for (const term of offer.terms) {
    if (term.kind !== "rate") continue;
    for (const variant of term.variants) {
      variant.applicability = canonicalizeApplicability({
        any_of: variant.applicability.any_of.map(({ all_of }) => ({
          all_of: [...all_of, { kind: "categorical", dimension, values: [value] }],
        })),
      });
      if (kind === "observed") {
        const acquisition = {
          dimension,
          channel: "response" as const,
          locator: { kind: "json_pointer" as const, value: "/served_region" },
          availability: "always" as const,
          evidence: variant.evidence,
        };
        variant.selector_sources = [acquisition];
        inputRef = invocationSelectorSourceRef(offer.id, acquisition);
      }
    }
  }
  provider.invocation_bindings = [
    {
      target_ref: target.id,
      case_ref: entry.id,
      offer_refs: [offer.id],
      evidence_refs: [evidence.id],
      selectors: [
        {
          dimension,
          evidence_refs: [evidence.id],
          value:
            kind === "fixed"
              ? { kind, value }
              : kind === "context"
                ? { kind, input: "request_region" }
                : { kind, input_ref: inputRef },
        },
      ],
    },
  ];
  return {
    data,
    dimension,
    value,
    selection: {
      targetRef: target.id,
      caseRef: entry.id,
      inputs: kind === "context" ? { request_region: value } : {},
      observed: kind === "observed" ? { [inputRef]: value } : {},
    },
  };
}
