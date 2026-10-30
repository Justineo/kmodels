import type { ModelTask } from "./schema.ts";
import type {
  InvocationCase,
  InvocationCatalog,
  InvocationScope,
  InvocationSupport,
} from "./invocation-schema.ts";

import {
  configureInvocation,
  invocationContext,
  invocationScopeFields as scopeFields,
  type InvocationConfiguration,
  type InvocationContext,
} from "./invocation-configuration.ts";

export interface InvocationQuery extends InvocationConfiguration {
  provider_id: string;
  identifier: string;
  task: ModelTask;
  surface_ref?: string;
  target_ref?: string;
  observed_model_ref?: string;
}

export interface InvocationResolution {
  model_refs: string[];
  target_ref?: string;
  case_ref?: string;
  identity: "unique" | "ambiguous" | "not_found";
  context_match: "matched" | "incomplete" | "unknown" | "mismatched";
  documented_support: InvocationSupport["state"];
  configuration: "complete" | "needs_configuration" | "conflicting";
  account_access: "unknown";
  request_verification: "not_tested";
  missing_inputs: string[];
  evidence_refs: string[];
}

/** Exact provider-scoped lookup. This reports documented choices, never account authorization. */
export function resolveInvocation(
  data: InvocationCatalog,
  query: InvocationQuery,
): InvocationResolution[] {
  const relations = data.identifier_relations.filter(
    ({ provider_id, value }) => provider_id === query.provider_id && value === query.identifier,
  );
  const modelRefs = [...new Set(relations.map(({ model_ref }) => model_ref))].sort();
  const base = {
    model_refs: modelRefs,
    identity:
      modelRefs.length === 0 ? "not_found" : modelRefs.length === 1 ? "unique" : "ambiguous",
    account_access: "unknown",
    request_verification: "not_tested",
  } as const;
  const surfaces = new Map(data.surfaces.map((surface) => [surface.id, surface]));
  // A request-only alias cannot silently select a sibling address. Catalog/name edges still
  // expose the complete set of mechanisms for their exact model identities.
  const targetRefs = new Set(relations.flatMap(({ target_refs }) => target_refs));
  const discoveryModels = new Set(
    relations.filter(({ role }) => role !== "request_id").map(({ model_ref }) => model_ref),
  );
  const targets = data.invocation_targets.filter(
    (target) =>
      modelRefs.includes(target.model_ref) &&
      (discoveryModels.has(target.model_ref) || targetRefs.has(target.id)) &&
      (query.surface_ref === undefined || target.surface_ref === query.surface_ref) &&
      (query.target_ref === undefined || target.id === query.target_ref) &&
      surfaces.get(target.surface_ref)?.provider_id === query.provider_id,
  );
  const results: InvocationResolution[] = [];
  for (const target of targets) {
    const surface = surfaces.get(target.surface_ref);
    if (surface === undefined) continue;
    const context = invocationContext(surface, query);
    const cases = target.cases.filter(({ task }) => task === query.task);
    for (const entry of cases) {
      const scope = matchScope(entry, context);
      const configuration = configureInvocation(target, entry, surface, query);
      if (
        target.resolution === "pinned" &&
        query.observed_model_ref !== undefined &&
        query.observed_model_ref !== (target.resolved_model_ref ?? target.model_ref)
      )
        configuration.conflicting = true;
      const conflicts = cases.filter(
        (other) =>
          other.id !== entry.id &&
          oppositeSupport(entry.support, other.support) &&
          matchScope(other, context).match !== "mismatched" &&
          scopeFields.every((field) => overlaps(entry[field], other[field])),
      );
      results.push({
        ...base,
        target_ref: target.id,
        case_ref: entry.id,
        context_match: scope.match,
        documented_support:
          conflicts.length > 0 && scope.match !== "mismatched"
            ? "conflicting"
            : entry.support.state,
        configuration: configuration.conflicting
          ? "conflicting"
          : configuration.missing.length > 0
            ? "needs_configuration"
            : "complete",
        missing_inputs: [...new Set([...scope.missing, ...configuration.missing])].sort(),
        evidence_refs: [
          ...new Set([
            ...relations.flatMap(({ evidence_refs }) => evidence_refs),
            ...surface.evidence_refs,
            ...target.evidence_refs,
            ...entry.support.evidence_refs,
            ...entry.requirements.flatMap(({ evidence_refs }) => evidence_refs),
            ...conflicts.flatMap(({ support }) => support.evidence_refs),
          ]),
        ].sort(),
      });
    }
  }
  if (results.every(({ context_match }) => context_match === "mismatched"))
    results.push({
      ...base,
      context_match: "unknown",
      documented_support: "unknown",
      configuration: "needs_configuration",
      missing_inputs: [],
      evidence_refs: [...new Set(relations.flatMap(({ evidence_refs }) => evidence_refs))].sort(),
    });
  return results.sort((left, right) =>
    `${left.target_ref ?? ""}/${left.case_ref ?? ""}`.localeCompare(
      `${right.target_ref ?? ""}/${right.case_ref ?? ""}`,
    ),
  );
}

function matchScope(
  entry: InvocationCase,
  context: InvocationContext,
): { match: InvocationResolution["context_match"]; missing: string[] } {
  const missing: string[] = [];
  let unknown = false;
  let mismatched = false;
  for (const field of scopeFields) {
    const scope = entry[field];
    const value = context[field];
    switch (scope.kind) {
      case "exact":
        if (value === undefined) missing.push(field);
        else if (scope.value !== value) mismatched = true;
        break;
      case "unknown":
        unknown = true;
        break;
      case "not_applicable":
        if (value !== undefined) mismatched = true;
        break;
      case "any":
        break;
    }
  }
  return {
    match: mismatched
      ? "mismatched"
      : unknown
        ? "unknown"
        : missing.length > 0
          ? "incomplete"
          : "matched",
    missing,
  };
}

function oppositeSupport(left: InvocationSupport, right: InvocationSupport): boolean {
  return (
    (left.state === "supported" && right.state === "unsupported") ||
    (left.state === "unsupported" && right.state === "supported")
  );
}

function overlaps(left: InvocationScope, right: InvocationScope): boolean {
  if (left.kind === "unknown" || right.kind === "unknown") return false;
  if (left.kind === "not_applicable" || right.kind === "not_applicable")
    return left.kind === right.kind;
  return left.kind === "any" || right.kind === "any" || left.value === right.value;
}
