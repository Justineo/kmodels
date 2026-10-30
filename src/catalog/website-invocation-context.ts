import { canonicalJson } from "./canonical-value.ts";
import { invocationScopeFields, type InvocationConfiguration } from "./invocation-configuration.ts";
import { assessInvocations, type InvocationPolicy } from "./invocation-selection.ts";
import type { InvocationQuery } from "./invocation-resolution.ts";
import type { WebsiteInvocationDetail, WebsiteModel } from "./website-schema.ts";

export function selectWebsiteInvocation(
  detail: WebsiteInvocationDetail,
  model: Pick<WebsiteModel, "model_id" | "provider_id">,
  targetRef: string,
  caseRef: string,
  configuration: InvocationConfiguration = {},
  policy: InvocationPolicy = {},
) {
  const target = detail.graph.invocation_targets.find(({ id }) => id === targetRef);
  const entry = target?.cases.find(({ id }) => id === caseRef);
  const surface = detail.graph.surfaces.find(({ id }) => id === target?.surface_ref);
  if (target === undefined || entry === undefined || surface === undefined) return;
  const context = { ...configuration.context };
  for (const field of invocationScopeFields) {
    const scope = entry[field];
    if (scope.kind === "exact") context[field] = scope.value;
  }
  const query: InvocationQuery = {
    ...configuration,
    context,
    provider_id: model.provider_id,
    identifier: model.model_id,
    target_ref: target.id,
    surface_ref: surface.id,
    task: entry.task,
  };
  const assessment = assessInvocations(detail.graph, query, policy).find(
    ({ resolution }) => resolution.target_ref === target.id && resolution.case_ref === entry.id,
  );
  const binding = detail.bindings.find(
    ({ target_ref, case_ref }) => target_ref === target.id && case_ref === entry.id,
  );
  return {
    key: canonicalJson([target.id, entry.id, query.inputs ?? {}, context]),
    target,
    entry,
    surface,
    query,
    assessment,
    ...(binding === undefined ? {} : { binding }),
  };
}

export type WebsiteInvocationSelection = NonNullable<ReturnType<typeof selectWebsiteInvocation>>;
