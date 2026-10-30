import { canonicalJson } from "./canonical-value.ts";
import type { InvocationCatalog } from "./invocation-schema.ts";

export interface InvocationOwners {
  providers: readonly { id: string }[];
  models: readonly { uid: string; provider_id: string }[];
  sources: readonly { id: string; provider_id: string; scope: string }[];
}

/** Validate references against the same accepted catalog, including evidence ownership. */
export function validateInvocationCatalog(data: InvocationCatalog, owners: InvocationOwners): void {
  const providers = new Set(owners.providers.map(({ id }) => id));
  const models = new Map(owners.models.map((model) => [model.uid, model]));
  const sources = new Map(owners.sources.map((source) => [source.id, source]));
  const surfaces = index(data.surfaces, "surface");
  const targets = index(data.invocation_targets, "target");
  const facts = index(data.scoped_facts, "fact");
  const evidence = index(data.invocation_evidence, "evidence");

  function modelOwner(ref: string): string {
    const model = models.get(ref);
    if (model === undefined || !providers.has(model.provider_id))
      throw new Error(`Unknown invocation model: ${ref}`);
    return model.provider_id;
  }

  function evidenceOwner(refs: readonly string[], provider: string): void {
    for (const ref of refs) {
      const item = evidence.get(ref);
      const source = item === undefined ? undefined : sources.get(item.source_ref);
      if (source === undefined || source.provider_id !== provider)
        throw new Error(`Invocation evidence has missing or foreign source: ${ref}`);
    }
  }

  for (const item of evidence.values()) {
    const source = sources.get(item.source_ref);
    if (source === undefined || !providers.has(source.provider_id))
      throw new Error(`Unknown invocation evidence source: ${item.source_ref}`);
    if (["account", "workspace", "runtime"].includes(source.scope))
      throw new Error(
        `Private observations cannot establish public invocation evidence: ${item.id}`,
      );
  }
  for (const surface of surfaces.values()) {
    if (!providers.has(surface.provider_id))
      throw new Error(`Unknown surface provider: ${surface.id}`);
    evidenceOwner(surface.evidence_refs, surface.provider_id);
  }
  for (const fact of facts.values()) evidenceOwner(fact.evidence_refs, modelOwner(fact.model_ref));
  for (const target of targets.values()) {
    const provider = modelOwner(target.model_ref);
    const surface = surfaces.get(target.surface_ref);
    if (surface === undefined || surface.provider_id !== provider)
      throw new Error(`Invocation target has missing or foreign surface: ${target.id}`);
    if (
      target.resolved_model_ref !== undefined &&
      modelOwner(target.resolved_model_ref) !== provider
    )
      throw new Error(`Invocation resolution crosses provider identity: ${target.id}`);
    evidenceOwner(target.evidence_refs, provider);
    for (const entry of target.cases) {
      evidenceOwner(entry.support.evidence_refs, provider);
      for (const requirement of entry.requirements)
        evidenceOwner(requirement.evidence_refs, provider);
      for (const ref of entry.fact_refs) {
        const fact = facts.get(ref);
        if (fact === undefined || fact.model_ref !== target.model_ref)
          throw new Error(`Invocation case has missing or foreign fact: ${entry.id}`);
      }
    }
  }
  const relations = new Set<string>();
  for (const relation of data.identifier_relations) {
    const key = canonicalJson([
      relation.provider_id,
      relation.value,
      relation.role,
      relation.model_ref,
    ]);
    if (relations.has(key)) throw new Error(`Duplicate identifier relation: ${relation.value}`);
    relations.add(key);
    if (modelOwner(relation.model_ref) !== relation.provider_id)
      throw new Error(`Identifier relation crosses provider identity: ${relation.value}`);
    evidenceOwner(relation.evidence_refs, relation.provider_id);
    for (const ref of relation.target_refs) {
      const target = targets.get(ref);
      if (target === undefined || target.model_ref !== relation.model_ref)
        throw new Error(`Identifier relation has missing or foreign target: ${relation.value}`);
      if (
        relation.role === "request_id" &&
        (target.address.kind !== "literal" || target.address.value !== relation.value)
      )
        throw new Error(`Request identifier does not match its target address: ${relation.value}`);
    }
  }
  const coverageKeys = new Set<string>();
  for (const coverage of data.target_coverage) {
    const provider = modelOwner(coverage.model_ref);
    const key = canonicalJson([coverage.model_ref, coverage.surface_ref ?? null]);
    if (coverageKeys.has(key))
      throw new Error(`Duplicate invocation coverage: ${coverage.model_ref}`);
    coverageKeys.add(key);
    if (
      coverage.surface_ref !== undefined &&
      surfaces.get(coverage.surface_ref)?.provider_id !== provider
    )
      throw new Error(`Invocation coverage has missing or foreign surface: ${coverage.model_ref}`);
    evidenceOwner(coverage.evidence_refs, provider);
  }
}

function index<T extends { id: string }>(items: readonly T[], kind: string): Map<string, T> {
  const result = new Map(items.map((item) => [item.id, item]));
  if (result.size !== items.length) throw new Error(`Duplicate invocation ${kind} ID`);
  return result;
}
