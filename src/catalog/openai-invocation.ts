import { canonicalJsonHash } from "./canonical-json.ts";
import {
  invocationCaseId,
  invocationEvidenceId,
  invocationTargetId,
} from "./invocation-identity.ts";
import {
  emptyInvocationCatalog,
  invocationCatalogSchema,
  type InvocationEvidence,
  type InvocationTarget,
  type ApiSurface,
} from "./invocation-schema.ts";
import { sha256 } from "./io.ts";
import { openAiDirectWires } from "./openai-invocation-wire.ts";
import { openAiWebSocketContracts, openAiWebSocketWire } from "./openai-invocation-websocket.ts";
import { openAiRegionalInvocations } from "./openai-invocation-regions.ts";
import type { ProviderModel, ModelTask } from "./schema.ts";

export const openAiInvocationApiUrl =
  "https://raw.githubusercontent.com/openai/openai-openapi/master/openapi.yaml";
export const openAiInvocationRegionsUrl =
  "https://developers.openai.com/api/docs/guides/your-data.md";

interface Document {
  url: string;
  body: string;
}
interface InvocationWire {
  path: string;
  name: string;
  task: ModelTask;
  surface: Pick<ApiSurface, "transport" | "method" | "identifier_location" | "request_media_type">;
  document: Document;
  locator: string;
  selectors: InvocationTarget["selectors"];
  deprecated?: true;
}
export interface OpenAiInvocationCard {
  model: ProviderModel;
  document: Document;
  support: ReadonlyMap<string, boolean>;
  resolution?: InvocationTarget["resolution"];
  resolvedModelRef?: string;
  resolutionDocuments?: Document[];
}

export function openAiInvocation(input: {
  models: readonly ProviderModel[];
  cards: readonly OpenAiInvocationCard[];
  index: Document;
  documents: readonly Document[];
  sourceId: string;
  observedAt: string;
}) {
  const result = emptyInvocationCatalog();
  const documentHashes = new Map<Document, string>();
  function evidence(
    document: Document,
    locator: string,
    basis: InvocationEvidence["basis"],
  ): string {
    let contentHash = documentHashes.get(document);
    if (contentHash === undefined) {
      contentHash = sha256(document.body);
      documentHashes.set(document, contentHash);
    }
    const identity = {
      source_ref: input.sourceId,
      document_url: document.url,
      locator,
      content_hash: contentHash,
      basis,
    };
    const id = invocationEvidenceId(identity);
    if (!result.invocation_evidence.some((item) => item.id === id))
      result.invocation_evidence.push({ id, ...identity, observed_at: input.observedAt });
    return id;
  }
  function companion(url: string): Document | undefined {
    const matches = input.documents.filter((document) => document.url === url);
    return matches.length === 1 ? matches[0] : undefined;
  }
  const api = companion(openAiInvocationApiUrl);
  const regions = companion(openAiInvocationRegionsUrl);
  const wires: InvocationWire[] =
    api === undefined
      ? []
      : openAiDirectWires(api.body).map((wire) => ({
          path: wire.path,
          name: wire.name,
          task: wire.task,
          surface: {
            transport: "http",
            method: "POST",
            identifier_location:
              wire.media === "multipart/form-data"
                ? { kind: "form", parameter: "model" }
                : { kind: "body", pointer: "/model" },
            request_media_type: wire.media,
          },
          document: api,
          locator: `POST ${wire.path}; ${wire.media}; ${wire.requestSchema}.model; ApiKeyAuth`,
          selectors: [],
          ...(wire.deprecated ? { deprecated: true } : {}),
        }));
  const socketDocuments = openAiWebSocketContracts.flatMap(({ url }) => {
    const document = companion(url);
    return document === undefined ? [] : [document];
  });
  for (const document of socketDocuments) {
    const wire = openAiWebSocketWire(document.url, document.body);
    if (wire === undefined) continue;
    wires.push({
      ...wire,
      document,
      surface: {
        transport: "websocket",
        method: "GET",
        identifier_location: { kind: "query", parameter: "model" },
      },
      locator: "Connect; Authentication; Connection parameters; model-based opening handshake",
    });
  }
  const regional = regions === undefined ? [] : openAiRegionalInvocations(regions.body);
  const indexEvidence = evidence(input.index, "#models", "official_catalog");
  for (const model of input.models) {
    const card = input.cards.find((card) => card.model.uid === model.uid);
    const modelEvidence =
      card === undefined
        ? indexEvidence
        : evidence(card.document, "Model ID; Model details; Endpoints", "official_catalog");
    result.identifier_relations.push({
      provider_id: "openai",
      model_ref: model.uid,
      value: model.model_id,
      role: "catalog_id",
      target_refs: [],
      evidence_refs: [modelEvidence],
    });
    // A Snapshots section can mix snapshots and aliases. Preserve discovery without guessing
    // request support, pinning, or tariffs from date-shaped strings.
    for (const alias of model.aliases.filter(
      (alias) => !input.models.some((peer) => peer.model_id === alias),
    ))
      result.identifier_relations.push({
        provider_id: "openai",
        model_ref: model.uid,
        value: alias,
        role: "unclassified",
        target_refs: [],
        evidence_refs: [modelEvidence],
      });
    if (card === undefined || wires.length === 0) {
      result.target_coverage.push({
        model_ref: model.uid,
        state: "not_collected",
        reason:
          api === undefined && socketDocuments.length === 0
            ? "source_unavailable"
            : "source_schema_changed",
        evidence_refs: [modelEvidence],
      });
      continue;
    }
    const factRefs: string[] = [];
    for (const field of ["context_tokens", "max_output_tokens"] as const) {
      const value = model.limits[field];
      if (value === undefined) continue;
      const fact = {
        model_ref: model.uid,
        field: `limits.${field}` as const,
        value,
        evidence_refs: [modelEvidence],
      };
      const id = `fact:${canonicalJsonHash(fact)}`;
      result.scoped_facts.push({ id, ...fact });
      factRefs.push(id);
    }
    const targetRefs: string[] = [];
    for (const wire of wires) {
      const support = card.support.get(wire.path.slice(1));
      const protocol = wire.surface.transport === "websocket" ? "wss:" : "https:";
      const locations: Array<{ origin: string; region?: string }> = [
        { origin: `${protocol}//api.openai.com` },
        ...regional
          .filter((item) => item.modelId === model.model_id && item.path === wire.path)
          .map((item) => ({ ...item, origin: item.origin.replace(/^https:/, protocol) })),
      ];
      for (const location of locations) {
        // Regional evidence owns its exact tuple. A card's negative claim is retained as a
        // conflict, never overwritten by a positive guide row.
        if (support === undefined && location.region === undefined) continue;
        const apiEvidence = evidence(wire.document, wire.locator, "official_api_contract");
        const regionalEvidence =
          location.region === undefined || regions === undefined
            ? undefined
            : evidence(
                regions,
                `API Endpoint, tool and model support: ${model.model_id}; ${wire.path}; ${location.region}`,
                "official_documentation",
              );
        const originEvidence =
          location.region === undefined || regions === undefined
            ? undefined
            : evidence(
                regions,
                `Support by region: ${location.region}; Domain prefix; Regional processing`,
                "official_documentation",
              );
        const refs = [
          indexEvidence,
          modelEvidence,
          apiEvidence,
          ...(card.resolutionDocuments ?? []).map((document) =>
            evidence(
              document,
              "Model details: Default snapshot; Snapshots: pinning guarantee",
              "official_catalog",
            ),
          ),
          ...(regionalEvidence === undefined ? [] : [regionalEvidence]),
        ];
        const surfaceId = `openai:${new URL(location.origin).hostname}:${wire.path}${wire.surface.transport === "websocket" ? ":websocket" : wire.surface.request_media_type === "multipart/form-data" ? ":multipart" : ""}`;
        if (!result.surfaces.some(({ id }) => id === surfaceId))
          result.surfaces.push({
            id: surfaceId,
            provider_id: "openai",
            endpoint_family: wire.path,
            api: wire.name,
            ...wire.surface,
            origin_template: location.origin,
            path_template: wire.path,
            inputs: [],
            evidence_refs: [apiEvidence, ...(originEvidence === undefined ? [] : [originEvidence])],
          });
        const target: InvocationTarget = {
          id: "pending",
          model_ref: model.uid,
          surface_ref: surfaceId,
          address: { kind: "literal", value: model.model_id },
          address_role: "model",
          resolution: card.resolution ?? "unknown",
          ...(card.resolvedModelRef === undefined
            ? {}
            : { resolved_model_ref: card.resolvedModelRef }),
          selectors: wire.selectors,
          lifecycle:
            model.status === "retired" ? "retired" : wire.deprecated ? "deprecated" : model.status,
          release_stage: model.release_stage,
          cases: [],
          evidence_refs: refs,
        };
        target.id = invocationTargetId(target);
        const entry: InvocationTarget["cases"][number] = {
          id: "pending",
          task: wire.task,
          request_region:
            location.region === undefined
              ? { kind: "not_applicable" }
              : { kind: "exact", value: location.region },
          inference_mode:
            wire.surface.transport === "websocket"
              ? { kind: "exact", value: "realtime" }
              : { kind: "unknown" },
          inference_geo:
            location.region === undefined
              ? { kind: "unknown" }
              : { kind: "exact", value: location.region },
          deployment_type:
            location.region === undefined
              ? { kind: "unknown" }
              : { kind: "exact", value: "regional_processing" },
          support:
            support === false && regionalEvidence !== undefined
              ? {
                  state: "conflicting",
                  evidence_refs: refs,
                  claims: [
                    { state: "unsupported", evidence_refs: [modelEvidence] },
                    { state: "supported", evidence_refs: [regionalEvidence] },
                  ],
                }
              : { state: support === false ? "unsupported" : "supported", evidence_refs: refs },
          requirements: [
            { kind: "authentication", evidence_refs: [apiEvidence] },
            ...(regionalEvidence === undefined
              ? []
              : [{ kind: "customer_eligibility" as const, evidence_refs: [regionalEvidence] }]),
          ],
          fact_refs: support === false ? [] : factRefs,
        };
        entry.id = invocationCaseId(target.id, entry);
        target.cases.push(entry);
        result.invocation_targets.push(target);
        targetRefs.push(target.id);
      }
    }
    if (targetRefs.length > 0)
      result.identifier_relations.push({
        provider_id: "openai",
        model_ref: model.uid,
        value: model.model_id,
        role: "request_id",
        target_refs: targetRefs,
        evidence_refs: [modelEvidence],
      });
    result.target_coverage.push({
      model_ref: model.uid,
      state: targetRefs.length === 0 ? "not_collected" : "partial",
      evidence_refs: [modelEvidence],
    });
  }
  return {
    invocation: invocationCatalogSchema.parse(result),
    invocationRetentionDocuments: [input.index, ...input.documents].map((document) => ({
      document_url: document.url,
      content_hash: documentHashes.get(document) ?? sha256(document.body),
    })),
  };
}
