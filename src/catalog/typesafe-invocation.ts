import { canonicalJsonHash } from "./canonical-json.ts";
import {
  invocationCaseId,
  invocationEvidenceId,
  invocationTargetId,
} from "./invocation-identity.ts";
import {
  emptyInvocationCatalog,
  invocationCatalogSchema,
  type InvocationCase,
  type InvocationCatalog,
  type InvocationEvidence,
  type InvocationTarget,
} from "./invocation-schema.ts";
import { sha256 } from "./io.ts";
import type { ProviderModel } from "./schema.ts";

interface Input {
  models: readonly ProviderModel[];
  sourceId: string;
  observedAt: string;
  catalog: { url: string; body: string };
  api?: { url: string; body: string };
  wireVerified: boolean;
  rollingAliases: ReadonlySet<string>;
}

export function typesafeInvocation(input: Input): InvocationCatalog {
  const result = emptyInvocationCatalog();
  function evidence(
    document: { url: string; body: string },
    locator: string,
    basis: InvocationEvidence["basis"],
  ): string {
    const identity = {
      source_ref: input.sourceId,
      document_url: document.url,
      locator,
      content_hash: sha256(document.body),
      basis,
    };
    const id = invocationEvidenceId(identity);
    result.invocation_evidence.push({ id, ...identity, observed_at: input.observedAt });
    return id;
  }
  const catalogEvidence = evidence(input.catalog, "#current-models", "official_catalog");
  const aliasEvidence = evidence(input.catalog, "#aliases", "official_catalog");
  const apiEvidence =
    input.api === undefined || !input.wireVerified
      ? undefined
      : evidence(
          input.api,
          "OpenAPI: POST /v1/systemone; SystemOneRequest.model; HTTPBearer",
          "official_api_contract",
        );
  const surfaceId = "typesafe:systemone:v1";
  if (apiEvidence !== undefined)
    result.surfaces.push({
      id: surfaceId,
      provider_id: "typesafe",
      endpoint_family: "systemone",
      api: "System One",
      transport: "http",
      method: "POST",
      origin_template: "https://api.typesafe.ai",
      path_template: "/v1/systemone",
      identifier_location: { kind: "body", pointer: "/model" },
      inputs: [],
      evidence_refs: [apiEvidence],
    });
  for (const model of input.models) {
    result.identifier_relations.push({
      provider_id: model.provider_id,
      value: model.model_id,
      role: "catalog_id",
      model_ref: model.uid,
      target_refs: [],
      evidence_refs: [catalogEvidence],
    });
    for (const alias of model.aliases)
      result.identifier_relations.push({
        provider_id: model.provider_id,
        value: alias,
        role: "name_alias",
        model_ref: model.uid,
        target_refs: [],
        evidence_refs: [aliasEvidence],
      });
    if (apiEvidence === undefined || !model.tasks.includes("classification")) {
      result.target_coverage.push({
        model_ref: model.uid,
        state: "not_collected",
        reason: input.api === undefined ? "source_unavailable" : "source_schema_changed",
        evidence_refs: [catalogEvidence],
      });
      continue;
    }
    const structuredFact = {
      model_ref: model.uid,
      field: "capabilities.structured_output" as const,
      value: true,
      evidence_refs: [apiEvidence],
    };
    const structuredId = `fact:${canonicalJsonHash(structuredFact)}`;
    result.scoped_facts.push({
      ...structuredFact,
      id: structuredId,
    });
    const factRefs = [structuredId];
    if (model.limits.context_tokens !== undefined) {
      const contextFact = {
        model_ref: model.uid,
        field: "limits.context_tokens" as const,
        value: model.limits.context_tokens,
        evidence_refs: [catalogEvidence],
      };
      const id = `fact:${canonicalJsonHash(contextFact)}`;
      result.scoped_facts.push({
        ...contextFact,
        id,
      });
      factRefs.push(id);
    }
    for (const value of [model.model_id, ...model.aliases]) {
      const alias = value !== model.model_id;
      const target: InvocationTarget = {
        id: "pending",
        model_ref: model.uid,
        surface_ref: surfaceId,
        address: { kind: "literal", value },
        address_role: "model",
        resolution: alias && input.rollingAliases.has(value) ? "rolling" : "unknown",
        ...(alias ? { resolved_model_ref: model.uid } : {}),
        selectors: [],
        lifecycle: model.status,
        release_stage: model.release_stage,
        cases: [],
        evidence_refs: [catalogEvidence, apiEvidence, ...(alias ? [aliasEvidence] : [])],
      };
      target.id = invocationTargetId(target);
      const entry: InvocationCase = {
        id: "pending",
        task: "classification",
        request_region: { kind: "not_applicable" },
        inference_mode: { kind: "not_applicable" },
        inference_geo: { kind: "unknown" },
        deployment_type: { kind: "not_applicable" },
        support: { state: "supported", evidence_refs: target.evidence_refs },
        requirements: [{ kind: "authentication", evidence_refs: [apiEvidence] }],
        fact_refs: factRefs,
      };
      entry.id = invocationCaseId(target.id, entry);
      target.cases.push(entry);
      result.invocation_targets.push(target);
      result.identifier_relations.push({
        provider_id: model.provider_id,
        value,
        role: "request_id",
        model_ref: model.uid,
        target_refs: [target.id],
        evidence_refs: target.evidence_refs,
      });
    }
    result.target_coverage.push({
      model_ref: model.uid,
      surface_ref: surfaceId,
      state: "partial",
      evidence_refs: [catalogEvidence, apiEvidence],
    });
  }
  return invocationCatalogSchema.parse(result);
}
