import { canonicalJson } from "./canonical-value.ts";
import {
  resolveInvocation,
  type InvocationQuery,
  type InvocationResolution,
} from "./invocation-resolution.ts";
import { invocationRequestTemplate, type InvocationRequestTemplate } from "./invocation-request.ts";
import type { InvocationCatalog, InvocationFact, InvocationTarget } from "./invocation-schema.ts";

type CapabilityField = Extract<InvocationFact, { value: boolean }>["field"];
type NumericLimitField = Extract<InvocationFact, { value: number }>["field"];
export interface InvocationPolicy {
  allowed_lifecycles?: Array<"active" | "legacy" | "deprecated">;
  allowed_release_stages?: Array<"stable" | "preview" | "experimental">;
  required_capabilities?: CapabilityField[];
  minimum_limits?: Partial<Record<NumericLimitField, number>>;
  embedding_dimensions?: number;
}
export interface InvocationFactAssessment {
  field: InvocationFact["field"];
  state: "known" | "conflicting";
  values: InvocationFact["value"][];
  fact_refs: string[];
  evidence_refs: string[];
}
export interface InvocationPolicyIssue {
  state: "ineligible" | "unknown";
  code:
    | "lifecycle"
    | "release_stage"
    | "missing_fact"
    | "conflicting_fact"
    | "requirement_not_met"
    | "alias_resolution"
    | "ambiguous_identity"
    | "request_configuration";
  field?: InvocationFact["field"];
}
export interface InvocationAssessment {
  resolution: InvocationResolution;
  eligibility: "eligible" | "ineligible" | "unknown";
  issues: InvocationPolicyIssue[];
  facts: InvocationFactAssessment[];
  selectable: boolean;
  request?: InvocationRequestTemplate;
}

/** Preserve every diagnostic; expose templates only for supported, matched, eligible cases. */
export function assessInvocations(
  data: InvocationCatalog,
  query: InvocationQuery,
  policy: InvocationPolicy = {},
): InvocationAssessment[] {
  if (
    Object.values(policy.minimum_limits ?? {}).some(
      (value) => !Number.isSafeInteger(value) || value < 0,
    ) ||
    (policy.embedding_dimensions !== undefined &&
      (!Number.isSafeInteger(policy.embedding_dimensions) || policy.embedding_dimensions < 1))
  )
    throw new Error("Invalid requested capability limits");
  const targets = new Map(data.invocation_targets.map((target) => [target.id, target]));
  const surfaces = new Map(data.surfaces.map((surface) => [surface.id, surface]));
  const scopedFacts = new Map(data.scoped_facts.map((fact) => [fact.id, fact]));
  return resolveInvocation(data, query).map((resolution) => {
    const target =
      resolution.target_ref === undefined ? undefined : targets.get(resolution.target_ref);
    const entry = target?.cases.find(({ id }) => id === resolution.case_ref);
    const surface = target === undefined ? undefined : surfaces.get(target.surface_ref);
    const facts = assessFacts(
      (entry?.fact_refs ?? []).flatMap((ref) => {
        const fact = scopedFacts.get(ref);
        return fact === undefined ? [] : [fact];
      }),
    );
    const issues: InvocationPolicyIssue[] = [];
    if (target === undefined || entry === undefined || surface === undefined)
      return { resolution, eligibility: "unknown", issues, facts, selectable: false };
    lifecycleIssues(target, policy, issues);
    if (resolution.identity === "ambiguous" && query.target_ref !== target.id)
      issues.push({ state: "unknown", code: "ambiguous_identity" });
    if (
      query.observed_model_ref !== undefined &&
      query.observed_model_ref !== (target.resolved_model_ref ?? target.model_ref)
    )
      issues.push({
        state: target.resolution === "pinned" ? "ineligible" : "unknown",
        code: "alias_resolution",
      });
    function requireFact(
      field: InvocationFact["field"],
      accepts: (value: InvocationFact["value"]) => boolean,
    ) {
      const fact = facts.find((fact) => fact.field === field);
      if (fact === undefined) issues.push({ state: "unknown", code: "missing_fact", field });
      else if (fact.state === "conflicting")
        issues.push({ state: "unknown", code: "conflicting_fact", field });
      else if (!fact.values.every(accepts))
        issues.push({ state: "ineligible", code: "requirement_not_met", field });
    }
    for (const field of policy.required_capabilities ?? [])
      requireFact(field, (value) => value === true);
    for (const field of [
      "limits.context_tokens",
      "limits.max_input_tokens",
      "limits.max_output_tokens",
    ] as const) {
      const minimum = policy.minimum_limits?.[field];
      if (minimum !== undefined)
        requireFact(field, (value) => typeof value === "number" && value >= minimum);
    }
    const dimension = policy.embedding_dimensions;
    if (dimension !== undefined) {
      const fields = ["limits.embedding_dimensions", "limits.embedding_dimension_range"] as const;
      const available = fields.filter((field) => facts.some((fact) => fact.field === field));
      for (const field of available.length === 0 ? [fields[0]] : available)
        requireFact(field, (value) =>
          Array.isArray(value)
            ? value.includes(dimension)
            : typeof value === "object" && value.min <= dimension && dimension <= value.max,
        );
    }
    let eligibility: InvocationAssessment["eligibility"] = issues.some(
      ({ state }) => state === "ineligible",
    )
      ? "ineligible"
      : issues.length > 0
        ? "unknown"
        : "eligible";
    let request: InvocationRequestTemplate | undefined;
    if (
      eligibility === "eligible" &&
      resolution.documented_support === "supported" &&
      resolution.context_match === "matched" &&
      resolution.configuration === "complete"
    ) {
      try {
        request = invocationRequestTemplate(surface, target, entry, query);
      } catch {
        issues.push({ state: "ineligible", code: "request_configuration" });
        eligibility = "ineligible";
      }
    }
    return {
      resolution,
      eligibility,
      issues,
      facts,
      selectable:
        eligibility === "eligible" &&
        resolution.documented_support === "supported" &&
        ["matched", "incomplete"].includes(resolution.context_match) &&
        resolution.configuration !== "conflicting",
      ...(request === undefined ? {} : { request }),
    };
  });
}

function lifecycleIssues(
  target: InvocationTarget,
  policy: InvocationPolicy,
  issues: InvocationPolicyIssue[],
) {
  if (target.lifecycle === "unknown") issues.push({ state: "unknown", code: "lifecycle" });
  else if (
    target.lifecycle === "retired" ||
    !(policy.allowed_lifecycles ?? ["active"]).includes(target.lifecycle)
  )
    issues.push({ state: "ineligible", code: "lifecycle" });
  if (target.release_stage === "unknown") issues.push({ state: "unknown", code: "release_stage" });
  else if (!(policy.allowed_release_stages ?? ["stable"]).includes(target.release_stage))
    issues.push({ state: "ineligible", code: "release_stage" });
}

function assessFacts(facts: InvocationFact[]): InvocationFactAssessment[] {
  const groups = new Map<InvocationFact["field"], InvocationFact[]>();
  for (const fact of facts) {
    const group = groups.get(fact.field);
    if (group === undefined) groups.set(fact.field, [fact]);
    else group.push(fact);
  }
  return [...groups].map(([field, group]) => {
    const values = [...new Map(group.map(({ value }) => [canonicalJson(value), value])).values()];
    return {
      field,
      state: values.length === 1 ? "known" : "conflicting",
      values: values.map((value) =>
        Array.isArray(value) ? [...value] : typeof value === "object" ? { ...value } : value,
      ),
      fact_refs: group.map(({ id }) => id),
      evidence_refs: [...new Set(group.flatMap(({ evidence_refs }) => evidence_refs))],
    };
  });
}
