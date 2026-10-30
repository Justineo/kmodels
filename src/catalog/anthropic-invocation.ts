import {
  anthropicFastModels,
  anthropicGeographyContract,
  anthropicIdentityContract,
  anthropicMessagesWire,
} from "./anthropic-invocation-contracts.ts";
import {
  anthropicAtLeastGeneration,
  anthropicModelGeneration,
} from "./anthropic-model-generation.ts";
import {
  invocationCaseId,
  invocationEvidenceId,
  invocationTargetId,
} from "./invocation-identity.ts";
import {
  emptyInvocationCatalog,
  invocationCatalogSchema,
  type InvocationCase,
  type InvocationEvidence,
  type InvocationTarget,
} from "./invocation-schema.ts";
import { sha256 } from "./io.ts";
import { canonicalJsonHash } from "./canonical-json.ts";
import type { ProviderModel } from "./schema.ts";

interface Document {
  url: string;
  body: string;
}
const root = "https://platform.claude.com/docs/en/";

export function anthropicInvocation(input: {
  models: readonly ProviderModel[];
  index: Document;
  documents: readonly Document[];
  sourceId: string;
  observedAt: string;
}) {
  const result = emptyInvocationCatalog();
  const documents = new Map(input.documents.map((document) => [document.url, document]));
  const hashes = new Map(
    [input.index, ...input.documents].map((document) => [document.url, sha256(document.body)]),
  );
  function evidence(
    document: Document,
    locator: string,
    basis: InvocationEvidence["basis"],
  ): string {
    const identity = {
      source_ref: input.sourceId,
      document_url: document.url,
      locator,
      content_hash: hashes.get(document.url) ?? sha256(document.body),
      basis,
    };
    const id = invocationEvidenceId(identity);
    if (!result.invocation_evidence.some((item) => item.id === id))
      result.invocation_evidence.push({ id, ...identity, observed_at: input.observedAt });
    return id;
  }
  const catalogEvidence = [
    evidence(input.index, "Claude API ID and Claude API alias rows", "official_catalog"),
    ...input.documents
      .filter(
        ({ url }) =>
          url === `${root}about-claude/model-deprecations.md` ||
          url === `${root}release-notes/overview.md`,
      )
      .map((document) =>
        evidence(document, "Model identity, lifecycle and release evidence", "official_catalog"),
      ),
  ];
  const messages = documents.get(`${root}api/messages/create.md`);
  const overview = documents.get(`${root}api/overview.md`);
  const versions = documents.get(`${root}api/versioning.md`);
  const identities = documents.get(`${root}about-claude/models/model-ids-and-versions.md`);
  const geography = documents.get(`${root}manage-claude/data-residency.md`);
  const fast = documents.get(`${root}build-with-claude/fast-mode.md`);
  const identity = anthropicIdentityContract(identities?.body ?? "");
  const identityEvidence =
    identities === undefined
      ? []
      : [evidence(identities, "Model IDs and versioning", "official_documentation")];
  const wire = anthropicMessagesWire(
    messages?.body ?? "",
    overview?.body ?? "",
    versions?.body ?? "",
  );
  const wireDocuments = [messages, overview, versions].filter((document) => document !== undefined);
  const wireEvidence =
    wire === undefined
      ? []
      : wireDocuments.map((document) =>
          evidence(document, "Messages API request contract", "official_api_contract"),
        );
  const geoVerified =
    wire?.geography === true &&
    identity.pinned &&
    anthropicGeographyContract(geography?.body ?? "");
  const geoEvidence =
    geoVerified && geography !== undefined
      ? [evidence(geography, "Inference geo", "official_documentation")]
      : [];
  const fastModels =
    wire?.speed === true ? anthropicFastModels(fast?.body ?? "", input.models) : [];
  const fastEvidence =
    fastModels.length > 0 && fast !== undefined
      ? [
          evidence(
            fast,
            "Messages API availability, required beta headers and speed outcomes",
            "official_documentation",
          ),
        ]
      : [];
  const surfaceId = "anthropic:messages:2026-10-21";
  if (wire !== undefined)
    result.surfaces.push({
      id: surfaceId,
      provider_id: "anthropic",
      endpoint_family: "messages",
      api: "Messages",
      transport: "http",
      method: "POST",
      origin_template: "https://api.anthropic.com",
      path_template: "/v1/messages",
      identifier_location: { kind: "body", pointer: "/model" },
      request_media_type: "application/json",
      inputs: [],
      evidence_refs: wireEvidence,
    });
  for (const model of input.models) {
    result.identifier_relations.push({
      provider_id: "anthropic",
      value: model.model_id,
      role: "catalog_id",
      model_ref: model.uid,
      target_refs: [],
      evidence_refs: catalogEvidence,
    });
    for (const alias of model.aliases)
      result.identifier_relations.push({
        provider_id: "anthropic",
        value: alias,
        role: "name_alias",
        model_ref: model.uid,
        target_refs: [],
        evidence_refs: catalogEvidence,
      });
    if (wire === undefined || !model.api_endpoints?.some(({ path }) => path === "v1/messages")) {
      result.target_coverage.push({
        model_ref: model.uid,
        state: "not_collected",
        reason:
          wire !== undefined
            ? "not_published"
            : wireDocuments.length !== 3
              ? "source_unavailable"
              : "source_schema_changed",
        evidence_refs: [...catalogEvidence, ...wireEvidence],
      });
      continue;
    }
    // Default workspace routing is unknown; it is never silently converted to global routing.
    const geos = [
      undefined,
      ...(geoVerified && anthropicModelGeneration(model.model_id) !== undefined
        ? ["global", "us"]
        : []),
    ];
    const fastModel = fastModels.find(({ modelRef }) => modelRef === model.uid);
    const factRefs: string[] = [];
    if (wire.streaming) {
      const fact = {
        model_ref: model.uid,
        field: "capabilities.streaming" as const,
        value: true,
        evidence_refs: wireEvidence,
      };
      const id = `fact:${canonicalJsonHash(fact)}`;
      result.scoped_facts.push({ id, ...fact });
      factRefs.push(id);
    }
    for (const value of [model.model_id, ...model.aliases]) {
      const alias = value !== model.model_id;
      const rolling =
        alias &&
        identity.rolling &&
        /-\d{8}$/.test(model.model_id) &&
        !anthropicAtLeastGeneration(model.model_id, { major: 4, minor: 6 });
      for (const speed of [undefined, ...(fastModel === undefined ? [] : [fastModel])]) {
        for (const geo of geos) {
          if (geo !== undefined && speed !== undefined && !speed.geography) continue;
          const refs = [
            ...new Set([
              ...catalogEvidence,
              ...wireEvidence,
              ...identityEvidence,
              ...(geo === undefined ? [] : geoEvidence),
              ...(speed === undefined ? [] : fastEvidence),
            ]),
          ];
          const target: InvocationTarget = {
            id: "pending",
            model_ref: model.uid,
            surface_ref: surfaceId,
            address: { kind: "literal", value },
            address_role: "model",
            resolution: alias
              ? rolling
                ? "rolling"
                : "unknown"
              : identity.pinned
                ? "pinned"
                : "unknown",
            ...(alias ? { resolved_model_ref: model.uid } : {}),
            selectors: [
              {
                location: { kind: "header", key: "anthropic-version" },
                value: { kind: "literal", value: wire.version },
              },
              ...(geo === undefined
                ? []
                : [
                    {
                      location: { kind: "body" as const, key: "/inference_geo" },
                      value: { kind: "literal" as const, value: geo },
                    },
                  ]),
              ...(speed === undefined
                ? []
                : [
                    {
                      location: { kind: "body" as const, key: "/speed" },
                      value: { kind: "literal" as const, value: "fast" },
                    },
                    ...(speed.beta
                      ? [
                          {
                            location: { kind: "header" as const, key: "anthropic-beta" },
                            value: { kind: "literal" as const, value: "fast-mode-2026-02-01" },
                          },
                        ]
                      : []),
                  ]),
            ],
            lifecycle: model.status,
            release_stage: speed?.preview === true ? "preview" : model.release_stage,
            cases: [],
            evidence_refs: refs,
          };
          target.id = invocationTargetId(target);
          const entry: InvocationCase = {
            id: "pending",
            task: "text_generation",
            request_region: { kind: "not_applicable" },
            inference_mode:
              speed === undefined ? { kind: "unknown" } : { kind: "exact", value: speed.mode },
            inference_geo: geo === undefined ? { kind: "unknown" } : { kind: "exact", value: geo },
            deployment_type: { kind: "not_applicable" },
            support: {
              state:
                geo !== undefined &&
                !anthropicAtLeastGeneration(model.model_id, { major: 4, minor: 6 })
                  ? "unsupported"
                  : "supported",
              evidence_refs: refs,
            },
            requirements: [
              { kind: "authentication", evidence_refs: wireEvidence },
              ...(geo === undefined && speed === undefined
                ? []
                : [
                    {
                      kind: "customer_eligibility" as const,
                      evidence_refs: [...geoEvidence, ...fastEvidence],
                    },
                  ]),
            ],
            fact_refs: factRefs,
          };
          entry.id = invocationCaseId(target.id, entry);
          target.cases.push(entry);
          result.invocation_targets.push(target);
          const relation = result.identifier_relations.find(
            (item) =>
              item.role === "request_id" && item.model_ref === model.uid && item.value === value,
          );
          if (relation === undefined)
            result.identifier_relations.push({
              provider_id: "anthropic",
              value,
              role: "request_id",
              model_ref: model.uid,
              target_refs: [target.id],
              evidence_refs: refs,
            });
          else {
            relation.target_refs.push(target.id);
            relation.evidence_refs = [...new Set([...relation.evidence_refs, ...refs])];
          }
        }
      }
    }
    result.target_coverage.push({
      model_ref: model.uid,
      surface_ref: surfaceId,
      state: "partial",
      evidence_refs: [...catalogEvidence, ...wireEvidence],
    });
  }
  return {
    invocation: invocationCatalogSchema.parse(result),
    invocationRetentionDocuments: [...hashes].map(([document_url, content_hash]) => ({
      document_url,
      content_hash,
    })),
  };
}
