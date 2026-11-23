import type { CapabilityStatement } from "./model-capability-details.ts";
import type { LimitStatement } from "./model-limit-details.ts";

export function limitScopeKey({ applicability, scope, account_tier }: LimitStatement): string {
  if (account_tier) return JSON.stringify([account_tier, applicability ?? null]);
  if (applicability === undefined) return scope;
  const { endpoint, beta_header: beta } = applicability;
  return JSON.stringify([endpoint, beta?.name, beta?.value, beta?.present]);
}

export function limitStatementsConflict(left: LimitStatement, right: LimitStatement): boolean {
  if (
    left.quantity !== right.quantity ||
    left.measurement !== right.measurement ||
    limitScopeKey(left) !== limitScopeKey(right)
  )
    return false;
  if (left.kind === "default" || right.kind === "default")
    return left.kind === "default" && right.kind === "default" && left.tokens !== right.tokens;
  if (left.kind === "no_separate_cap" || right.kind === "no_separate_cap")
    return left.kind !== right.kind;
  if (left.kind === "published_maximum_label" || right.kind === "published_maximum_label")
    return (
      left.kind === "published_maximum_label" &&
      right.kind === "published_maximum_label" &&
      left.label !== right.label
    );
  return left.tokens !== right.tokens;
}

export function capabilityStatementsConflict(
  left: CapabilityStatement,
  right: CapabilityStatement,
): boolean {
  if (left.scope !== right.scope) return false;
  if (left.kind === "capability_support" && right.kind === "capability_support")
    return (
      left.capability === right.capability &&
      left.applicability.endpoint === right.applicability.endpoint &&
      left.applicability.interface === right.applicability.interface &&
      left.applicability.condition === right.applicability.condition &&
      left.applicability.parameter === right.applicability.parameter &&
      left.supported !== right.supported
    );
  if (left.kind !== "reasoning_effort" || right.kind !== "reasoning_effort") return false;
  return (
    left.default_value !== undefined &&
    right.default_value !== undefined &&
    left.default_value !== right.default_value
  );
}
