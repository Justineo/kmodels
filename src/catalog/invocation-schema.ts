import { z } from "zod";
import { modelLifecycles, modelReleaseStages, modelTasks } from "./catalog-vocabulary.ts";
import { isCredentialLikeIdentifier } from "./identity.ts";

const text = z
  .string()
  .min(1)
  .max(512)
  .refine((value) => value === value.trim(), "Unexpected surrounding whitespace");
const reference = text;
const references = z
  .array(reference)
  .max(256)
  .refine((values) => new Set(values).size === values.length, {
    message: "Duplicate references",
  });
const evidenceReferences = references.min(1);
const inputName = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);
const parameterName = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/);
const publicIdentifier = text.refine(
  (value) => !isCredentialLikeIdentifier(value) && !/^arn:/i.test(value),
  "Private resource or credential identifier",
);

export const invocationScopeSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("exact"), value: publicIdentifier }),
  z.strictObject({ kind: z.literal("any") }),
  z.strictObject({ kind: z.literal("not_applicable") }),
  z.strictObject({ kind: z.literal("unknown") }),
]);

const definiteClaim = z.strictObject({
  state: z.enum(["supported", "unsupported"]),
  evidence_refs: evidenceReferences,
});

export const invocationSupportSchema = z.union([
  definiteClaim,
  z.strictObject({
    state: z.literal("unknown"),
    evidence_refs: references,
    reason: z.enum(["not_collected", "not_published", "source_unavailable", "ambiguous"]),
  }),
  z
    .strictObject({
      state: z.literal("conflicting"),
      evidence_refs: evidenceReferences,
      claims: z.array(definiteClaim).min(2).max(32),
    })
    .superRefine((support, context) => {
      if (new Set(support.claims.map(({ state }) => state)).size !== 2)
        context.addIssue({
          code: "custom",
          message: "Conflicts require both support and non-support",
        });
      if (
        support.claims.some(({ evidence_refs }) =>
          evidence_refs.some((ref) => !support.evidence_refs.includes(ref)),
        )
      )
        context.addIssue({
          code: "custom",
          message: "Conflict evidence must retain every opposing claim",
        });
    }),
]);

export const invocationEvidenceSchema = z.strictObject({
  id: reference,
  source_ref: reference,
  document_url: z
    .url()
    .max(2048)
    .refine((value) => {
      const url = new URL(value);
      return (
        url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash
      );
    }, "Evidence must use a public HTTPS document URL without credentials or query parameters"),
  locator: text,
  content_hash: z.string().regex(/^[a-f0-9]{64}$/),
  observed_at: z.iso.datetime({ offset: true }),
  basis: z.enum(["official_catalog", "official_api_contract", "official_documentation"]),
});

const identifierLocation = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("body"),
    pointer: z
      .string()
      .min(1)
      .max(256)
      .regex(/^(?:\/(?:[^~/]|~[01])*)+$/),
  }),
  z.strictObject({ kind: z.literal("path"), parameter: parameterName }),
  z.strictObject({ kind: z.literal("query"), parameter: parameterName }),
  z.strictObject({ kind: z.literal("form"), parameter: parameterName }),
]);

export const apiSurfaceSchema = z
  .strictObject({
    id: reference,
    provider_id: reference,
    endpoint_family: text,
    api: text,
    transport: z.enum(["http", "websocket"]),
    method: z.enum(["GET", "POST"]),
    origin_template: z.string().min(1).max(512),
    path_template: z.string().min(1).max(1024).startsWith("/"),
    identifier_location: identifierLocation,
    request_media_type: z.enum(["application/json", "multipart/form-data"]).optional(),
    inputs: z
      .array(
        z.strictObject({
          name: inputName,
          role: z.enum(["origin", "project", "region", "workspace", "api_version"]),
        }),
      )
      .max(16),
    evidence_refs: evidenceReferences,
  })
  .superRefine((surface, context) => {
    if (
      (surface.identifier_location.kind === "form" &&
        surface.request_media_type !== "multipart/form-data") ||
      (surface.identifier_location.kind === "body" &&
        surface.request_media_type === "multipart/form-data") ||
      (surface.request_media_type !== undefined &&
        (surface.transport !== "http" || surface.method !== "POST"))
    )
      context.addIssue({
        code: "custom",
        message: "Request media type contradicts its wire location or transport",
      });
    const names = new Set(surface.inputs.map(({ name }) => name));
    if (names.size !== surface.inputs.length)
      context.addIssue({ code: "custom", message: "Duplicate surface input" });
    if (surface.identifier_location.kind === "path") {
      if (names.has(surface.identifier_location.parameter))
        context.addIssue({
          code: "custom",
          message: "Identifier parameter collides with a surface input",
        });
      names.add(surface.identifier_location.parameter);
      if (!surface.path_template.includes(`{${surface.identifier_location.parameter}}`))
        context.addIssue({
          code: "custom",
          message: "Path does not contain the identifier parameter",
        });
    }
    for (const template of [surface.origin_template, surface.path_template]) {
      const parameters = [...template.matchAll(/\{([a-zA-Z][a-zA-Z0-9_]{0,63})\}/g)];
      if (
        parameters.some((match) => !names.has(match[1] ?? "")) ||
        /[{}]/.test(template.replace(/\{([a-zA-Z][a-zA-Z0-9_]{0,63})\}/g, ""))
      )
        context.addIssue({ code: "custom", message: "Undeclared or malformed template parameter" });
    }
    const originInput = surface.inputs.find(({ role }) => role === "origin");
    const callerOrigin =
      originInput !== undefined && surface.origin_template === `{${originInput.name}}`;
    if (!callerOrigin) {
      const expanded = surface.origin_template.replace(/\{[a-zA-Z][a-zA-Z0-9_]*\}/g, "placeholder");
      const url = URL.canParse(expanded) ? new URL(expanded) : undefined;
      if (
        url === undefined ||
        !["https:", "wss:"].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        url.pathname !== "/"
      )
        context.addIssue({ code: "custom", message: "Invalid public API origin template" });
      else if ((surface.transport === "websocket") !== (url.protocol === "wss:"))
        context.addIssue({ code: "custom", message: "Origin protocol does not match transport" });
    }
    if (/[?#\s]/.test(surface.path_template))
      context.addIssue({
        code: "custom",
        message: "Path templates cannot contain queries, fragments, or whitespace",
      });
  });

export const invocationAddressSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("literal"), value: publicIdentifier }),
  z.strictObject({ kind: z.literal("caller"), input: inputName }),
]);

export const invocationCaseSchema = z
  .strictObject({
    id: reference,
    task: z.enum(modelTasks),
    request_region: invocationScopeSchema,
    inference_mode: invocationScopeSchema,
    inference_geo: invocationScopeSchema,
    deployment_type: invocationScopeSchema,
    support: invocationSupportSchema,
    requirements: z
      .array(
        z.strictObject({
          kind: z.enum([
            "authentication",
            "customer_eligibility",
            "model_access",
            "deployment_binding",
            "installation",
            "runtime_compatibility",
          ]),
          evidence_refs: evidenceReferences,
        }),
      )
      .max(16),
    fact_refs: references,
  })
  .superRefine((entry, context) => {
    if (
      [entry.request_region, entry.inference_mode, entry.inference_geo, entry.deployment_type].some(
        ({ kind }) => kind === "any" || kind === "not_applicable",
      ) &&
      entry.support.evidence_refs.length === 0
    )
      context.addIssue({
        code: "custom",
        message: "Unrestricted or inapplicable scope requires evidence",
      });
  });

export const invocationTargetSchema = z
  .strictObject({
    id: reference,
    model_ref: reference,
    surface_ref: reference,
    address: invocationAddressSchema,
    address_role: z.enum(["model", "inference_profile", "deployment", "endpoint", "local_tag"]),
    resolution: z.enum(["pinned", "rolling", "redirect", "configured", "unknown"]),
    resolved_model_ref: reference.optional(),
    upstream: z.strictObject({ namespace: text, model_id: publicIdentifier }).optional(),
    routing: z
      .strictObject({
        kind: z.enum(["fixed", "automatic"]),
        provider: text.optional(),
        policy: text.optional(),
      })
      .optional(),
    selectors: z
      .array(
        z.strictObject({
          location: z.strictObject({
            kind: z.enum(["header", "body", "form", "path", "query"]),
            key: text,
          }),
          value: invocationAddressSchema,
        }),
      )
      .max(16),
    lifecycle: z.enum(modelLifecycles),
    release_stage: z.enum(modelReleaseStages),
    cases: z.array(invocationCaseSchema).min(1).max(4096),
    evidence_refs: evidenceReferences,
  })
  .superRefine((target, context) => {
    if (new Set(target.cases.map(({ id }) => id)).size !== target.cases.length)
      context.addIssue({ code: "custom", message: "Duplicate target case" });
    if (
      new Set(target.selectors.map(({ location }) => `${location.kind}:${location.key}`)).size !==
      target.selectors.length
    )
      context.addIssue({ code: "custom", message: "Duplicate wire selector" });
    if (
      ["deployment", "endpoint"].includes(target.address_role) &&
      target.address.kind !== "caller"
    )
      context.addIssue({
        code: "custom",
        message: "Account resources require caller-supplied addresses",
      });
  });

export const identifierRelationSchema = z
  .strictObject({
    provider_id: reference,
    value: publicIdentifier,
    role: z.enum(["catalog_id", "name_alias", "request_id", "unclassified"]),
    model_ref: reference,
    target_refs: references,
    evidence_refs: references,
  })
  .superRefine((relation, context) => {
    if (
      relation.role === "request_id" &&
      (relation.target_refs.length === 0 || relation.evidence_refs.length === 0)
    )
      context.addIssue({
        code: "custom",
        message: "Request identifiers require targets and evidence",
      });
  });

const factBase = { id: reference, model_ref: reference, evidence_refs: evidenceReferences };
export const invocationFactSchema = z.discriminatedUnion("field", [
  z.strictObject({
    ...factBase,
    field: z.enum([
      "capabilities.reasoning",
      "capabilities.tool_call",
      "capabilities.structured_output",
      "capabilities.streaming",
      "capabilities.batch",
      "capabilities.prompt_cache",
      "capabilities.fine_tuning",
      "capabilities.citations",
      "capabilities.code_execution",
      "capabilities.context_management",
      "capabilities.effort_control",
      "capabilities.computer_use",
    ]),
    value: z.boolean(),
  }),
  z.strictObject({
    ...factBase,
    field: z.enum(["limits.context_tokens", "limits.max_input_tokens", "limits.max_output_tokens"]),
    value: z.number().int().nonnegative(),
  }),
  z.strictObject({
    ...factBase,
    field: z.enum(["limits.embedding_dimensions", "limits.recommended_embedding_dimensions"]),
    value: z.array(z.number().int().positive()).min(1).max(256),
  }),
  z.strictObject({
    ...factBase,
    field: z.literal("limits.embedding_dimension_range"),
    value: z
      .strictObject({ min: z.number().int().positive(), max: z.number().int().positive() })
      .refine(({ min, max }) => min <= max, "Invalid dimension range"),
  }),
]);

export const invocationCoverageSchema = z
  .strictObject({
    model_ref: reference,
    surface_ref: reference.optional(),
    state: z.enum(["not_collected", "partial", "complete"]),
    reason: z
      .enum(["source_unavailable", "source_schema_changed", "not_collected", "not_published"])
      .optional(),
    evidence_refs: references,
  })
  .superRefine((coverage, context) => {
    if (
      coverage.state === "complete" &&
      (coverage.surface_ref === undefined || coverage.evidence_refs.length === 0)
    )
      context.addIssue({
        code: "custom",
        message: "Complete coverage requires a defined surface and evidence",
      });
  });

export const invocationCatalogSchema = z.strictObject({
  surfaces: z.array(apiSurfaceSchema).max(4096),
  invocation_targets: z.array(invocationTargetSchema).max(200_000),
  identifier_relations: z.array(identifierRelationSchema).max(500_000),
  scoped_facts: z.array(invocationFactSchema).max(500_000),
  invocation_evidence: z.array(invocationEvidenceSchema).max(100_000),
  target_coverage: z.array(invocationCoverageSchema).max(200_000),
});

export type InvocationScope = z.infer<typeof invocationScopeSchema>;
export type InvocationSupport = z.infer<typeof invocationSupportSchema>;
export type InvocationEvidence = z.infer<typeof invocationEvidenceSchema>;
export type ApiSurface = z.infer<typeof apiSurfaceSchema>;
export type InvocationAddress = z.infer<typeof invocationAddressSchema>;
export type InvocationCase = z.infer<typeof invocationCaseSchema>;
export type InvocationTarget = z.infer<typeof invocationTargetSchema>;
export type IdentifierRelation = z.infer<typeof identifierRelationSchema>;
export type InvocationFact = z.infer<typeof invocationFactSchema>;
export type InvocationCatalog = z.infer<typeof invocationCatalogSchema>;

export function emptyInvocationCatalog(): InvocationCatalog {
  return {
    surfaces: [],
    invocation_targets: [],
    identifier_relations: [],
    scoped_facts: [],
    invocation_evidence: [],
    target_coverage: [],
  };
}
