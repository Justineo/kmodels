import { canonicalJsonHash } from "./canonical-json.ts";
import { canonicalJson, compareUtf8 } from "./canonical-value.ts";
import type { InvocationCase, InvocationEvidence, InvocationTarget } from "./invocation-schema.ts";

export function invocationTargetId(
  target: Pick<
    InvocationTarget,
    "model_ref" | "surface_ref" | "address" | "address_role" | "upstream" | "routing" | "selectors"
  >,
): string {
  return `target:${canonicalJsonHash({
    model_ref: target.model_ref,
    surface_ref: target.surface_ref,
    address: target.address,
    address_role: target.address_role,
    upstream: target.upstream ?? null,
    routing: target.routing ?? null,
    selectors: [...target.selectors].sort((left, right) =>
      compareUtf8(canonicalJson(left), canonicalJson(right)),
    ),
  })}`;
}

export function invocationCaseId(
  targetRef: string,
  entry: Pick<
    InvocationCase,
    "task" | "request_region" | "inference_mode" | "inference_geo" | "deployment_type"
  >,
): string {
  return `case:${canonicalJsonHash({
    target_ref: targetRef,
    task: entry.task,
    request_region: entry.request_region,
    inference_mode: entry.inference_mode,
    inference_geo: entry.inference_geo,
    deployment_type: entry.deployment_type,
  })}`;
}

export function invocationEvidenceId(
  evidence: Omit<InvocationEvidence, "id" | "observed_at">,
): string {
  return `evidence:${canonicalJsonHash(evidence)}`;
}
