import { invocationEvidenceRefs } from "./invocation-collection.ts";
import { invocationPricingModelRef } from "./invocation-pricing-model.ts";
import type { InvocationPricingBinding } from "./invocation-pricing-schema.ts";
import { validateInvocationCatalog } from "./invocation-validation.ts";
import type { Catalog, ProviderModel } from "./schema.ts";
import { websiteInvocationDetailSchema, type WebsiteInvocationDetail } from "./website-schema.ts";

/** Keep the selected model's graph and its reference closure in the deferred detail chunk. */
export function websiteInvocationDetail(
  catalog: Catalog,
  model: ProviderModel,
  bindings: readonly InvocationPricingBinding[],
): WebsiteInvocationDetail | undefined {
  const data = catalog.invocation;
  if (data === undefined) return;
  const targets = data.invocation_targets.filter(({ model_ref }) => model_ref === model.uid);
  const targetRefs = new Set(targets.map(({ id }) => id));
  const selectedBindings = bindings.filter(({ target_ref }) => targetRefs.has(target_ref));
  const coverage = data.target_coverage.filter(({ model_ref }) => model_ref === model.uid);
  const surfaceRefs = new Set([
    ...targets.map(({ surface_ref }) => surface_ref),
    ...coverage.flatMap(({ surface_ref }) => (surface_ref === undefined ? [] : [surface_ref])),
  ]);
  const graph = {
    surfaces: data.surfaces.filter(({ id }) => surfaceRefs.has(id)),
    invocation_targets: targets,
    identifier_relations: data.identifier_relations.filter(
      ({ model_ref }) => model_ref === model.uid,
    ),
    scoped_facts: data.scoped_facts.filter(({ model_ref }) => model_ref === model.uid),
    target_coverage: coverage,
  };
  const evidenceRefs = invocationEvidenceRefs(graph);
  for (const binding of selectedBindings)
    for (const ref of [
      ...binding.evidence_refs,
      ...binding.selectors.flatMap(({ evidence_refs }) => evidence_refs),
    ])
      evidenceRefs.add(ref);
  const evidence = data.invocation_evidence.filter(({ id }) => evidenceRefs.has(id));
  const sourceRefs = new Set(evidence.map(({ source_ref }) => source_ref));
  const modelRefs = new Set([
    model.uid,
    ...targets.flatMap(({ resolved_model_ref }) =>
      resolved_model_ref === undefined ? [] : [resolved_model_ref],
    ),
  ]);
  const detail = websiteInvocationDetailSchema.parse({
    graph: { ...graph, invocation_evidence: evidence },
    models: catalog.models
      .filter(({ uid }) => modelRefs.has(uid))
      .map(({ uid, provider_id }) => ({ uid, provider_id })),
    sources: catalog.sources
      .filter(({ id }) => sourceRefs.has(id))
      .map(({ id, provider_id, scope }) => ({ id, provider_id, scope })),
    bindings: selectedBindings,
  });
  validateWebsiteInvocationDetail(detail, model.uid, model.provider_id);
  return detail;
}

export function validateWebsiteInvocationDetail(
  detail: WebsiteInvocationDetail,
  modelRef: string,
  providerId: string,
): void {
  if (
    !detail.models.some(({ uid, provider_id }) => uid === modelRef && provider_id === providerId) ||
    detail.graph.invocation_targets.some(({ model_ref }) => model_ref !== modelRef)
  )
    throw new Error("Invocation detail does not match its model");
  validateInvocationCatalog(detail.graph, { ...detail, providers: [{ id: providerId }] });
  const targets = new Map(detail.graph.invocation_targets.map((target) => [target.id, target]));
  const evidence = new Set(detail.graph.invocation_evidence.map(({ id }) => id));
  const bindings = new Set<string>();
  for (const binding of detail.bindings) {
    const key = JSON.stringify([binding.target_ref, binding.case_ref]);
    if (bindings.has(key)) throw new Error("Duplicate invocation detail price binding");
    bindings.add(key);
    const target = targets.get(binding.target_ref);
    const entry = target?.cases.find(({ id }) => id === binding.case_ref);
    if (entry?.support.state !== "supported")
      throw new Error("Invocation detail price binding has no supported target case");
    if (target !== undefined) invocationPricingModelRef(target, binding);
    for (const ref of [
      ...binding.evidence_refs,
      ...binding.selectors.flatMap(({ evidence_refs }) => evidence_refs),
    ])
      if (!evidence.has(ref))
        throw new Error("Invocation detail price binding has missing evidence");
  }
}
