import { canonicalJson, compareUtf8 } from "./canonical-value.ts";
import {
  emptyInvocationCatalog,
  invocationCatalogSchema,
  type InvocationCatalog,
} from "./invocation-schema.ts";
import type { ProviderModel } from "./schema.ts";

export function invocationProviderPartition(
  data: InvocationCatalog,
  modelRefs: ReadonlySet<string>,
  providerId: string,
): InvocationCatalog {
  const surfaces = data.surfaces.filter(({ provider_id }) => provider_id === providerId);
  const targets = data.invocation_targets.filter(
    ({ model_ref, resolved_model_ref }) =>
      modelRefs.has(model_ref) &&
      (resolved_model_ref === undefined || modelRefs.has(resolved_model_ref)),
  );
  const targetRefs = new Set(targets.map(({ id }) => id));
  const relations = data.identifier_relations
    .filter(({ model_ref }) => modelRefs.has(model_ref))
    .map((relation) => ({
      ...relation,
      target_refs: relation.target_refs.filter((ref) => targetRefs.has(ref)),
    }))
    .filter(({ role, target_refs }) => role !== "request_id" || target_refs.length > 0);
  const facts = data.scoped_facts.filter(({ model_ref }) => modelRefs.has(model_ref));
  const coverage = data.target_coverage.filter(({ model_ref }) => modelRefs.has(model_ref));
  const partition = {
    surfaces,
    invocation_targets: targets,
    identifier_relations: relations,
    scoped_facts: facts,
    target_coverage: coverage,
  };
  const refs = invocationEvidenceRefs(partition);
  return {
    ...partition,
    invocation_evidence: data.invocation_evidence.filter(({ id }) => refs.has(id)),
  };
}

export function invocationEvidenceRefs(
  data: Omit<InvocationCatalog, "invocation_evidence">,
): Set<string> {
  return new Set([
    ...data.surfaces.flatMap(({ evidence_refs }) => evidence_refs),
    ...data.invocation_targets.flatMap((target) => [
      ...target.evidence_refs,
      ...target.cases.flatMap((entry) => [
        ...entry.support.evidence_refs,
        ...entry.requirements.flatMap(({ evidence_refs }) => evidence_refs),
      ]),
    ]),
    ...data.identifier_relations.flatMap(({ evidence_refs }) => evidence_refs),
    ...data.scoped_facts.flatMap(({ evidence_refs }) => evidence_refs),
    ...data.target_coverage.flatMap(({ evidence_refs }) => evidence_refs),
  ]);
}

export function mergeInvocationCatalogs(parts: readonly InvocationCatalog[]): InvocationCatalog {
  function merge<T>(items: readonly T[], key: (item: T) => string): T[] {
    const values = new Map<string, T>();
    for (const item of items) {
      const id = key(item);
      const prior = values.get(id);
      if (prior !== undefined && canonicalJson(prior) !== canonicalJson(item))
        throw new Error(`Conflicting invocation entity: ${id}`);
      values.set(id, item);
    }
    return [...values].sort(([left], [right]) => compareUtf8(left, right)).map(([, item]) => item);
  }
  return invocationCatalogSchema.parse({
    surfaces: merge(
      parts.flatMap(({ surfaces }) => surfaces),
      ({ id }) => id,
    ),
    invocation_targets: merge(
      parts.flatMap(({ invocation_targets }) => invocation_targets),
      ({ id }) => id,
    ),
    identifier_relations: merge(
      parts.flatMap(({ identifier_relations }) => identifier_relations),
      ({ provider_id, model_ref, role, value }) =>
        canonicalJson([provider_id, model_ref, role, value]),
    ),
    scoped_facts: merge(
      parts.flatMap(({ scoped_facts }) => scoped_facts),
      ({ id }) => id,
    ),
    invocation_evidence: merge(
      parts.flatMap(({ invocation_evidence }) => invocation_evidence),
      ({ id }) => id,
    ),
    target_coverage: merge(
      parts.flatMap(({ target_coverage }) => target_coverage),
      ({ model_ref, surface_ref }) => canonicalJson([model_ref, surface_ref ?? null]),
    ),
  });
}

/** Legacy identities remain searchable without acquiring invocation or capability claims. */
export function completeInvocationInventory(
  data: InvocationCatalog,
  models: readonly ProviderModel[],
): InvocationCatalog {
  const result = structuredClone(data);
  const edges = new Set(
    result.identifier_relations.map(({ model_ref, value }) => canonicalJson([model_ref, value])),
  );
  const covered = new Set(result.target_coverage.map(({ model_ref }) => model_ref));
  for (const model of models) {
    for (const [value, role] of [
      [model.model_id, "catalog_id"],
      ...model.aliases.map((alias) => [alias, "unclassified"] as const),
    ] as const) {
      if (!edges.has(canonicalJson([model.uid, value])))
        result.identifier_relations.push({
          provider_id: model.provider_id,
          model_ref: model.uid,
          value,
          role,
          target_refs: [],
          evidence_refs: [],
        });
    }
    if (!covered.has(model.uid))
      result.target_coverage.push({
        model_ref: model.uid,
        state: "not_collected",
        evidence_refs: [],
      });
  }
  return mergeInvocationCatalogs([result]);
}

export function replaceInvocationProvider(
  current: InvocationCatalog | undefined,
  previous: InvocationCatalog | undefined,
  models: readonly ProviderModel[],
  providerId: string,
): InvocationCatalog | undefined {
  if (current === undefined && previous === undefined) return;
  const retained = invocationProviderPartition(
    previous ?? emptyInvocationCatalog(),
    new Set(models.filter(({ provider_id }) => provider_id === providerId).map(({ uid }) => uid)),
    providerId,
  );
  const others = [
    ...new Set(
      models
        .filter(({ provider_id }) => provider_id !== providerId)
        .map(({ provider_id }) => provider_id),
    ),
  ].map((id) =>
    invocationProviderPartition(
      current ?? emptyInvocationCatalog(),
      new Set(models.filter(({ provider_id }) => provider_id === id).map(({ uid }) => uid)),
      id,
    ),
  );
  return completeInvocationInventory(mergeInvocationCatalogs([...others, retained]), models);
}

/** Retain failed companion facts only while the fresh identity evidence still names the address. */
export function retainUnavailableInvocation(
  fresh: InvocationCatalog,
  previous: InvocationCatalog | undefined,
  currentDocuments: readonly {
    source_ref: string;
    document_url: string;
    content_hash: string;
  }[] = [],
): InvocationCatalog {
  if (previous === undefined) return fresh;
  const missing = new Set(
    fresh.target_coverage
      .filter(({ reason }) => reason === "source_unavailable")
      .map(({ model_ref }) => model_ref),
  );
  if (missing.size === 0) return fresh;
  const addresses = new Set(
    fresh.identifier_relations.map(({ model_ref, value }) => canonicalJson([model_ref, value])),
  );
  const retained = emptyInvocationCatalog();
  const changedEvidence = new Set(
    previous.invocation_evidence
      .filter((evidence) =>
        currentDocuments.some(
          (document) =>
            document.source_ref === evidence.source_ref &&
            document.document_url === evidence.document_url &&
            document.content_hash !== evidence.content_hash,
        ),
      )
      .map(({ id }) => id),
  );
  retained.invocation_targets = previous.invocation_targets.filter(
    (target) =>
      missing.has(target.model_ref) &&
      (changedEvidence.size === 0 ||
        ![
          ...invocationEvidenceRefs({
            surfaces: previous.surfaces.filter(({ id }) => id === target.surface_ref),
            invocation_targets: [target],
            scoped_facts: previous.scoped_facts.filter(({ id }) =>
              target.cases.some(({ fact_refs }) => fact_refs.includes(id)),
            ),
            identifier_relations: [],
            target_coverage: [],
          }),
        ].some((ref) => changedEvidence.has(ref))) &&
      (target.address.kind === "caller" ||
        addresses.has(canonicalJson([target.model_ref, target.address.value]))),
  );
  const targetRefs = new Set(retained.invocation_targets.map(({ id }) => id));
  const modelRefs = new Set(retained.invocation_targets.map(({ model_ref }) => model_ref));
  const surfaceRefs = new Set(retained.invocation_targets.map(({ surface_ref }) => surface_ref));
  const factRefs = new Set(
    retained.invocation_targets.flatMap(({ cases }) => cases.flatMap(({ fact_refs }) => fact_refs)),
  );
  retained.surfaces = previous.surfaces.filter(({ id }) => surfaceRefs.has(id));
  retained.scoped_facts = previous.scoped_facts.filter(({ id }) => factRefs.has(id));
  retained.identifier_relations = previous.identifier_relations
    .filter(({ role }) => role === "request_id")
    .map((relation) => ({
      ...relation,
      target_refs: relation.target_refs.filter((ref) => targetRefs.has(ref)),
    }))
    .filter(({ target_refs }) => target_refs.length > 0);
  retained.target_coverage = previous.target_coverage
    .filter(({ model_ref }) => modelRefs.has(model_ref))
    .map((coverage) => ({ ...coverage, state: "partial", reason: "source_unavailable" }));
  const retainedEvidence = invocationEvidenceRefs(retained);
  const currentEvidence = new Set(fresh.invocation_evidence.map(({ id }) => id));
  retained.invocation_evidence = previous.invocation_evidence.filter(
    ({ id }) => retainedEvidence.has(id) && !currentEvidence.has(id),
  );
  return mergeInvocationCatalogs([
    {
      ...fresh,
      target_coverage: fresh.target_coverage.filter(({ model_ref }) => !modelRefs.has(model_ref)),
    },
    retained,
  ]);
}
