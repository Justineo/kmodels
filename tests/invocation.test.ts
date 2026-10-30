import { describe, expect, it } from "vite-plus/test";
import { reactive } from "vue";
import { canonicalJsonHash } from "../src/catalog/canonical-json.ts";
import {
  invocationCaseId,
  invocationEvidenceId,
  invocationTargetId,
} from "../src/catalog/invocation-identity.ts";
import { resolveInvocation, type InvocationQuery } from "../src/catalog/invocation-resolution.ts";
import {
  apiSurfaceSchema,
  emptyInvocationCatalog,
  invocationCatalogSchema,
  invocationEvidenceSchema,
  invocationFactSchema,
  invocationSupportSchema,
  invocationTargetSchema,
  type InvocationCase,
  type InvocationCatalog,
} from "../src/catalog/invocation-schema.ts";
import { validateInvocationCatalog } from "../src/catalog/invocation-validation.ts";
import { assessInvocations, type InvocationPolicy } from "../src/catalog/invocation-selection.ts";
import { selectWebsiteInvocation } from "../src/catalog/website-invocation-context.ts";
import type {
  WebsiteInvocationDetail,
  WebsiteModel,
  WebsitePricingOffer,
} from "../src/catalog/website-schema.ts";
import InvocationDetails from "../src/components/InvocationDetails.vue";
import PricingDetails from "../src/components/PricingDetails.vue";
import { renderComponent } from "./render-component.ts";

function supportCase(region: string, supported = true): InvocationCase {
  return {
    id: `case:${region}`,
    task: "text_generation",
    request_region: { kind: "exact", value: region },
    inference_mode: { kind: "not_applicable" },
    inference_geo: { kind: "not_applicable" },
    deployment_type: { kind: "not_applicable" },
    support: { state: supported ? "supported" : "unsupported", evidence_refs: ["evidence"] },
    requirements: [{ kind: "authentication", evidence_refs: ["evidence"] }],
    fact_refs: [],
  };
}

function fixture(): InvocationCatalog {
  return invocationCatalogSchema.parse({
    surfaces: [
      {
        id: "runtime-converse",
        provider_id: "provider",
        endpoint_family: "runtime",
        api: "Converse",
        transport: "http",
        method: "POST",
        origin_template: "https://runtime.{region}.example.com",
        path_template: "/model/{modelId}/converse",
        identifier_location: { kind: "path", parameter: "modelId" },
        inputs: [{ name: "region", role: "region" }],
        evidence_refs: ["evidence"],
      },
    ],
    invocation_targets: [
      {
        id: "target",
        model_ref: "opaque/model@version",
        surface_ref: "runtime-converse",
        address: { kind: "literal", value: "us.model" },
        address_role: "inference_profile",
        resolution: "unknown",
        selectors: [],
        lifecycle: "active",
        release_stage: "stable",
        evidence_refs: ["evidence"],
        cases: [
          supportCase("us-east-1"),
          supportCase("us-west-2"),
          supportCase("ca-central-1", false),
        ],
      },
    ],
    identifier_relations: [
      {
        provider_id: "provider",
        value: "model",
        role: "catalog_id",
        model_ref: "opaque/model@version",
        target_refs: [],
        evidence_refs: ["evidence"],
      },
      {
        provider_id: "provider",
        value: "us.model",
        role: "request_id",
        model_ref: "opaque/model@version",
        target_refs: ["target"],
        evidence_refs: ["evidence"],
      },
    ],
    scoped_facts: [],
    invocation_evidence: [
      {
        id: "evidence",
        source_ref: "source",
        document_url: "https://docs.example.com/model",
        locator: "#regional-support",
        content_hash: "a".repeat(64),
        observed_at: "2026-10-30T00:00:00Z",
        basis: "official_documentation",
      },
    ],
    target_coverage: [
      {
        model_ref: "opaque/model@version",
        surface_ref: "runtime-converse",
        state: "partial",
        evidence_refs: ["evidence"],
      },
    ],
  });
}

const owners = {
  providers: [{ id: "provider" }, { id: "other" }],
  models: [
    { uid: "opaque/model@version", provider_id: "provider" },
    { uid: "foreign", provider_id: "other" },
  ],
  sources: [{ id: "source", provider_id: "provider", scope: "global" }],
};
const query: InvocationQuery = {
  provider_id: "provider",
  identifier: "us.model",
  task: "text_generation",
};

function chosen(
  data = fixture(),
  extra: Partial<InvocationQuery> = {},
  policy: InvocationPolicy = {},
) {
  return required(
    assessInvocations(
      data,
      { ...query, context: { request_region: "us-east-1" }, ...extra },
      policy,
    ).find(({ resolution }) => resolution.case_ref === "case:us-east-1"),
  );
}

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Missing invocation fixture value");
  return value;
}

const websiteModel: WebsiteModel = {
  uid: "opaque/model@version",
  provider_id: "provider",
  model_id: "model",
  name: "Model",
  aliases: [],
  tasks: ["text_generation"],
  status: "active",
  release_stage: "stable",
  detail_chunk: 0,
  pricing: { outcome: "offers" },
};

function websiteFixture(): WebsiteInvocationDetail {
  return {
    graph: fixture(),
    models: owners.models,
    sources: [{ id: "source", provider_id: "provider", scope: "global" }],
    bindings: [
      {
        target_ref: "target",
        case_ref: "case:us-east-1",
        offer_refs: ["offer"],
        selectors: [
          {
            dimension: { namespace: "kmodels", value: "region" },
            value: {
              kind: "fixed",
              value: { namespace: "provider", provider_id: "provider", value: "us-east-1" },
            },
            evidence_refs: ["evidence"],
          },
        ],
        evidence_refs: ["evidence"],
      },
    ],
  };
}

function regionalOffer(): WebsitePricingOffer {
  const dimension = { namespace: "kmodels", value: "region" } as const;
  function scope(region: string) {
    return {
      any_of: [
        {
          all_of: [
            {
              kind: "categorical" as const,
              dimension,
              values: [{ namespace: "provider" as const, provider_id: "provider", value: region }],
            },
          ],
        },
      ],
    };
  }
  return {
    id: "offer",
    title: "On-demand inference",
    group: "model_mechanism",
    billing_mode: { label: "Usage" },
    state_summary: "Metered pricing",
    selectors: [
      {
        key: "region",
        label: "Region",
        dimension,
        kind: "categorical",
        values: ["us-east-1", "us-west-2"].map((value) => ({
          key: value,
          label: value,
          value: { namespace: "provider", provider_id: "provider", value },
        })),
      },
    ],
    states: [
      {
        key: "numeric",
        state: "numeric",
        label: "Numeric",
        applicability: { any_of: [{ all_of: [] }] },
        applicability_label: "All regions",
      },
    ],
    rates: ["us-east-1", "us-west-2"].map((value, index) => ({
      key: value,
      term_ref: "a".repeat(64),
      label: "Input text",
      amount: index === 0 ? "$2" : "$3",
      unit: "per 1M tokens",
      accessible_text: `${index + 2} USD per 1M tokens`,
      applicability: scope(value),
      applicability_label: value,
    })),
    allowances: [],
    contributions: [],
    enrollment: [],
    settlement: [],
    unnormalized_count: 0,
    unnormalized: [],
  };
}

describe("website invocation selection", () => {
  it("assesses reactive embedding facts without retaining mutable source values", () => {
    const detail = reactive(websiteFixture());
    detail.graph.scoped_facts.push({
      id: "dimensions",
      model_ref: websiteModel.uid,
      field: "limits.embedding_dimensions",
      value: [256, 512],
      evidence_refs: ["evidence"],
    });
    required(required(detail.graph.invocation_targets[0]).cases[0]).fact_refs.push("dimensions");
    const selected = required(
      selectWebsiteInvocation(detail, websiteModel, "target", "case:us-east-1"),
    );
    const values = required(selected.assessment?.facts[0]).values;
    expect(values).toEqual([[256, 512]]);
    const dimensions = required(values[0]);
    if (!Array.isArray(dimensions)) throw new Error("Expected embedding dimensions");
    dimensions.push(1024);
    expect(required(detail.graph.scoped_facts[0]).value).toEqual([256, 512]);
  });
  it("requires explicit target and case and keeps catalog and request identifiers separate", async () => {
    const detail = websiteFixture();
    expect(selectWebsiteInvocation(detail, websiteModel, "", "")).toBeUndefined();
    expect(selectWebsiteInvocation(detail, websiteModel, "target", "")).toBeUndefined();
    const selected = required(
      selectWebsiteInvocation(detail, websiteModel, "target", "case:us-east-1"),
    );
    expect(selected.query.identifier).toBe("model");
    expect(selected.target.address).toEqual({ kind: "literal", value: "us.model" });
    expect(selected.query.context?.request_region).toBe("us-east-1");
    expect(selected.assessment?.request?.url).toBe(
      "https://runtime.us-east-1.example.com/model/us.model/converse",
    );
    const html = await renderComponent(InvocationDetails, { model: websiteModel, detail });
    expect(html).toContain("Choose a target and API");
    expect(html).not.toContain("Copy request ID");
    expect(html).not.toContain("Copy template");
  });

  it("changes the pricing reset key for case and caller configuration without mutating source evidence", () => {
    const detail = websiteFixture();
    const before = structuredClone(detail);
    const east = required(
      selectWebsiteInvocation(detail, websiteModel, "target", "case:us-east-1"),
    );
    const west = required(
      selectWebsiteInvocation(detail, websiteModel, "target", "case:us-west-2"),
    );
    const conflicting = required(
      selectWebsiteInvocation(detail, websiteModel, "target", "case:us-east-1", {
        inputs: { region: "us-west-2" },
      }),
    );
    expect(west.key).not.toBe(east.key);
    expect(conflicting.key).not.toBe(east.key);
    expect(conflicting.assessment?.resolution.configuration).toBe("conflicting");
    expect(detail).toEqual(before);
  });

  it("withholds target rates until selection and filters fixed region prices", async () => {
    const detail = websiteFixture();
    const props = {
      model: websiteModel,
      detail: { offers: [regionalOffer()] },
      loading: false,
      error: undefined,
      invocationRequired: true,
    };
    const unselected = await renderComponent(PricingDetails, props);
    expect(unselected).toContain("Choose an invocation target");
    expect(unselected).not.toContain("$2");
    const invocation = reactive(
      required(selectWebsiteInvocation(detail, websiteModel, "target", "case:us-east-1")),
    );
    const html = await renderComponent(PricingDetails, { ...props, invocation });
    expect(html).toContain("fixed by target");
    expect(html).toContain("$2");
    expect(html).not.toContain("$3");
    const unsupported = required(
      selectWebsiteInvocation(detail, websiteModel, "target", "case:ca-central-1"),
    );
    const negative = await renderComponent(PricingDetails, { ...props, invocation: unsupported });
    expect(negative).toContain("No quote");
    expect(negative).not.toContain("$2");
  });

  it.each(["context", "observed"] as const)(
    "requires an explicit %s price input even when only one value is available",
    async (kind) => {
      const detail = websiteFixture();
      const selector = required(required(detail.bindings[0]).selectors[0]);
      selector.value =
        kind === "context" ? { kind, input: "region" } : { kind, input_ref: "served_region" };
      const pricedOffer = regionalOffer();
      const priceSelector = required(pricedOffer.selectors[0]);
      if (priceSelector.kind !== "categorical") throw new Error("Expected a categorical selector");
      priceSelector.values.splice(1);
      pricedOffer.rates.splice(1);
      const invocation = required(
        selectWebsiteInvocation(detail, websiteModel, "target", "case:us-east-1"),
      );
      const html = await renderComponent(PricingDetails, {
        model: websiteModel,
        detail: { offers: [pricedOffer] },
        loading: false,
        error: undefined,
        invocationRequired: true,
        invocation,
      });
      expect(html).toContain("Choose a verified value");
      expect(html).toContain("Choose all required price inputs");
      expect(html).not.toContain("$2");
      if (kind === "observed") expect(html).toContain("observed response value");
    },
  );
});

describe("invocation contract", () => {
  it("validates provider-owned reference closure and rejects foreign targets, facts and evidence", () => {
    expect(() => validateInvocationCatalog(fixture(), owners)).not.toThrow();
    const mutations: Array<(data: InvocationCatalog) => void> = [
      (data) => {
        required(data.surfaces[0]).provider_id = "other";
      },
      (data) => {
        required(data.invocation_evidence[0]).source_ref = "missing";
      },
      (data) => {
        required(data.invocation_targets[0]).resolved_model_ref = "foreign";
      },
      (data) => {
        required(required(data.invocation_targets[0]).cases[0]).fact_refs = ["missing"];
      },
      (data) => {
        required(data.identifier_relations[1]).model_ref = "foreign";
      },
      (data) => {
        required(data.identifier_relations[1]).value = "wrong-address";
      },
      (data) => {
        data.surfaces.push(required(data.surfaces[0]));
      },
      (data) => {
        data.target_coverage.push(required(data.target_coverage[0]));
      },
    ];
    for (const mutate of mutations) {
      const data = fixture();
      mutate(data);
      expect(() => validateInvocationCatalog(data, owners)).toThrow();
    }
    expect(() =>
      validateInvocationCatalog(fixture(), {
        ...owners,
        sources: [{ id: "source", provider_id: "provider", scope: "account" }],
      }),
    ).toThrow(/Private/);
  });

  it("requires evidence and opposing claims rather than a context-free conflict flag", () => {
    expect(
      invocationSupportSchema.safeParse({ state: "supported", evidence_refs: [] }).success,
    ).toBe(false);
    expect(invocationSupportSchema.safeParse({ state: "unknown", evidence_refs: [] }).success).toBe(
      false,
    );
    const claims = [
      { state: "supported", evidence_refs: ["positive"] },
      { state: "unsupported", evidence_refs: ["negative"] },
    ];
    expect(
      invocationSupportSchema.safeParse({
        state: "conflicting",
        claims,
        evidence_refs: ["positive", "negative"],
      }).success,
    ).toBe(true);
    expect(
      invocationSupportSchema.safeParse({
        state: "conflicting",
        claims,
        evidence_refs: ["positive"],
      }).success,
    ).toBe(false);
    expect(
      invocationSupportSchema.safeParse({
        state: "conflicting",
        claims: [claims[0], claims[0]],
        evidence_refs: ["positive"],
      }).success,
    ).toBe(false);
  });

  it("rejects undeclared templates, private origins, literal account endpoints and malformed facts", () => {
    const surface = fixture().surfaces[0];
    for (const patch of [
      { path_template: "/model/{unbound}" },
      { path_template: "/model/{modelId}?token=secret" },
      { origin_template: "https://user:secret@api.example.com" },
      { origin_template: "javascript:alert(1)" },
      { transport: "websocket" },
    ])
      expect(apiSurfaceSchema.safeParse({ ...surface, ...patch }).success).toBe(false);
    expect(
      invocationTargetSchema.safeParse({
        ...fixture().invocation_targets[0],
        address_role: "endpoint",
      }).success,
    ).toBe(false);
    const fact = { id: "fact", model_ref: "opaque/model@version", evidence_refs: ["evidence"] };
    expect(
      invocationFactSchema.safeParse({ ...fact, field: "capabilities.streaming", value: 1 })
        .success,
    ).toBe(false);
    expect(
      invocationFactSchema.safeParse({ ...fact, field: "limits.context_tokens", value: true })
        .success,
    ).toBe(false);
    expect(
      invocationFactSchema.safeParse({
        ...fact,
        field: "limits.embedding_dimension_range",
        value: { min: 20, max: 10 },
      }).success,
    ).toBe(false);
    expect(invocationCatalogSchema.safeParse({ ...fixture(), credentials: "secret" }).success).toBe(
      false,
    );
    expect(
      invocationEvidenceSchema.safeParse({
        ...fixture().invocation_evidence[0],
        document_url: "https://docs.example.com?token=secret",
      }).success,
    ).toBe(false);
  });

  it("keeps target and case identity stable across observations and support changes", () => {
    const target = fixture().invocation_targets[0];
    if (target === undefined) throw new Error("Missing fixture target");
    const first = invocationTargetId(target);
    target.lifecycle = "deprecated";
    target.resolution = "rolling";
    target.cases = [supportCase("us-east-1", false)];
    expect(invocationTargetId(target)).toBe(first);
    const entry = supportCase("us-east-1");
    expect(invocationCaseId(first, entry)).toBe(
      invocationCaseId(first, supportCase("us-east-1", false)),
    );
    expect(invocationCaseId(first, supportCase("us-west-2"))).not.toBe(
      invocationCaseId(first, entry),
    );
    expect(
      invocationTargetId({ ...target, address: { kind: "literal", value: "global.model" } }),
    ).not.toBe(first);
    const evidence = fixture().invocation_evidence[0];
    if (evidence === undefined) throw new Error("Missing fixture evidence");
    const { id: _id, observed_at: _observedAt, ...identity } = evidence;
    expect(invocationEvidenceId(identity)).toBe(invocationEvidenceId({ ...identity }));
    expect(invocationEvidenceId({ ...identity, content_hash: "b".repeat(64) })).not.toBe(
      invocationEvidenceId(identity),
    );
  });

  it("uses canonical byte order rather than host collation for wire selector identity", () => {
    const target = required(fixture().invocation_targets[0]);
    const upper = {
      location: { kind: "body" as const, key: "/A" },
      value: { kind: "literal" as const, value: "one" },
    };
    const lower = {
      location: { kind: "body" as const, key: "/a" },
      value: { kind: "literal" as const, value: "two" },
    };
    target.selectors = [lower, upper];
    expect(invocationTargetId(target)).toBe(
      `target:${canonicalJsonHash({
        model_ref: target.model_ref,
        surface_ref: target.surface_ref,
        address: target.address,
        address_role: target.address_role,
        upstream: null,
        routing: null,
        selectors: [upper, lower],
      })}`,
    );
  });
});

describe("invocation resolution", () => {
  it("projects multipart identifiers as form fields and rejects incompatible assignments", () => {
    const data = fixture();
    const surface = required(data.surfaces[0]);
    const target = required(data.invocation_targets[0]);
    surface.path_template = "/transcriptions";
    surface.identifier_location = { kind: "form", parameter: "model" };
    surface.request_media_type = "multipart/form-data";
    target.selectors = [
      { location: { kind: "form", key: "language" }, value: { kind: "literal", value: "en" } },
    ];
    invocationCatalogSchema.parse(data);
    validateInvocationCatalog(data, owners);
    expect(chosen(data).request).toMatchObject({
      request_media_type: "multipart/form-data",
      form_fields: [
        { name: "model", value: "us.model" },
        { name: "language", value: "en" },
      ],
      body_fields: [],
      headers: {},
    });
    target.selectors.push({
      location: { kind: "form", key: "model" },
      value: { kind: "literal", value: "different" },
    });
    expect(chosen(data).request).toBeUndefined();
    target.selectors = [
      { location: { kind: "body", key: "/model" }, value: { kind: "literal", value: "us.model" } },
    ];
    expect(() => validateInvocationCatalog(data, owners)).toThrow(/media type/);
    expect(chosen(data).request).toBeUndefined();
    expect(
      apiSurfaceSchema.safeParse({ ...surface, request_media_type: "application/json" }).success,
    ).toBe(false);
    expect(apiSurfaceSchema.safeParse({ ...surface, request_media_type: undefined }).success).toBe(
      false,
    );
  });

  it("keeps supported regional options when the caller has not selected a region", () => {
    const results = resolveInvocation(fixture(), query);
    expect(
      results.filter(({ documented_support }) => documented_support === "supported"),
    ).toHaveLength(2);
    expect(
      results.every(
        ({ context_match, missing_inputs }) =>
          context_match === "incomplete" && missing_inputs.includes("request_region"),
      ),
    ).toBe(true);
    expect(
      results.find(({ documented_support }) => documented_support === "unsupported"),
    ).toMatchObject({ case_ref: "case:ca-central-1", context_match: "incomplete" });
  });

  it("distinguishes explicit negative evidence from an undocumented region", () => {
    const canada = resolveInvocation(fixture(), {
      ...query,
      context: { request_region: "ca-central-1" },
      inputs: { region: "ca-central-1" },
    });
    expect(canada.find(({ context_match }) => context_match === "matched")).toMatchObject({
      documented_support: "unsupported",
      configuration: "complete",
      account_access: "unknown",
      request_verification: "not_tested",
    });
    const europe = resolveInvocation(fixture(), {
      ...query,
      context: { request_region: "eu-west-1" },
    });
    expect(europe.find(({ target_ref }) => target_ref === undefined)).toMatchObject({
      identity: "unique",
      documented_support: "unknown",
    });
    expect(
      europe
        .filter(({ target_ref }) => target_ref !== undefined)
        .every(({ context_match }) => context_match === "mismatched"),
    ).toBe(true);
  });

  it("does not turn unknown catalog scope into support using supplied configuration", () => {
    const data = fixture();
    const target = data.invocation_targets[0];
    if (target === undefined) throw new Error("Missing target");
    target.cases = [{ ...supportCase("us-east-1"), inference_geo: { kind: "unknown" } }];
    expect(
      resolveInvocation(data, {
        ...query,
        context: { request_region: "us-east-1", inference_geo: "us" },
        inputs: { region: "us-east-1" },
      }),
    ).toMatchObject([{ context_match: "unknown", configuration: "complete" }]);
  });

  it("preserves exact spelling, provider scope, and ambiguous alias identities", () => {
    expect(resolveInvocation(fixture(), { ...query, identifier: "US.model" })[0]?.identity).toBe(
      "not_found",
    );
    expect(resolveInvocation(fixture(), { ...query, provider_id: "other" })[0]?.identity).toBe(
      "not_found",
    );
    const data = fixture();
    const relation = data.identifier_relations[1];
    if (relation === undefined) throw new Error("Missing relation");
    data.identifier_relations.push({ ...relation, model_ref: "second-version", target_refs: [] });
    expect(
      resolveInvocation(data, query).every(
        ({ identity, model_refs }) => identity === "ambiguous" && model_refs.length === 2,
      ),
    ).toBe(true);
    expect(resolveInvocation(emptyInvocationCatalog(), query)[0]?.identity).toBe("not_found");
  });

  it("does not let a request-only alias select a sibling address", () => {
    const data = fixture();
    const target = data.invocation_targets[0];
    if (target === undefined) throw new Error("Missing target");
    data.invocation_targets.push({
      ...target,
      id: "global-target",
      address: { kind: "literal", value: "global.model" },
    });
    expect(resolveInvocation(data, query).every(({ target_ref }) => target_ref === "target")).toBe(
      true,
    );
    expect(
      new Set(
        resolveInvocation(data, { ...query, identifier: "model" }).map(
          ({ target_ref }) => target_ref,
        ),
      ).size,
    ).toBe(2);
  });

  it("retains contradictory configuration for an explicitly selected target", () => {
    const result = resolveInvocation(fixture(), {
      ...query,
      target_ref: "target",
      context: { request_region: "us-east-1" },
      inputs: { region: "us-west-2" },
    });
    expect(result.find(({ case_ref }) => case_ref === "case:us-east-1")).toMatchObject({
      context_match: "matched",
      configuration: "conflicting",
    });
  });

  it("uses the same region for request configuration and support selection", () => {
    const byInput = resolveInvocation(fixture(), { ...query, inputs: { region: "us-east-1" } });
    const byContext = resolveInvocation(fixture(), {
      ...query,
      context: { request_region: "us-east-1" },
    });
    for (const result of [byInput, byContext])
      expect(result.find(({ case_ref }) => case_ref === "case:us-east-1")).toMatchObject({
        context_match: "matched",
        configuration: "complete",
        missing_inputs: [],
      });
  });

  it("does not select a positive claim around overlapping explicit negative evidence", () => {
    const data = fixture();
    const target = data.invocation_targets[0];
    if (target === undefined) throw new Error("Missing target");
    target.cases.push({ ...supportCase("all", false), request_region: { kind: "any" } });
    const results = resolveInvocation(data, { ...query, context: { request_region: "us-east-1" } });
    expect(results.find(({ case_ref }) => case_ref === "case:us-east-1")?.documented_support).toBe(
      "conflicting",
    );
    expect(results.find(({ case_ref }) => case_ref === "case:all")?.documented_support).toBe(
      "conflicting",
    );
    expect(
      results.find(({ case_ref }) => case_ref === "case:ca-central-1")?.documented_support,
    ).toBe("unsupported");
  });
});

describe("invocation selection and request addressing", () => {
  it("generates only a matched supported addressing template and leaves account access unverified", () => {
    expect(chosen()).toMatchObject({
      eligibility: "eligible",
      selectable: true,
      request: {
        kind: "addressing_template",
        method: "POST",
        transport: "http",
        url: "https://runtime.us-east-1.example.com/model/us.model/converse",
        headers: {},
        body_fields: [],
        authentication: "required",
        account_access: "unknown",
        request_verification: "not_tested",
      },
    });
    const incomplete = assessInvocations(fixture(), query);
    expect(incomplete.filter(({ selectable }) => selectable)).toHaveLength(2);
    expect(incomplete.every(({ request }) => request === undefined)).toBe(true);
    const negative = assessInvocations(fixture(), {
      ...query,
      context: { request_region: "ca-central-1" },
    });
    expect(negative.every(({ request }) => request === undefined)).toBe(true);
    const unknown = fixture();
    required(required(unknown.invocation_targets[0]).cases[0]).inference_geo = { kind: "unknown" };
    expect(chosen(unknown).resolution.context_match).toBe("unknown");
    expect(chosen(unknown).request).toBeUndefined();
  });

  it("keeps support conflicts and ambiguous identity from becoming automatic candidates", () => {
    const data = fixture();
    const target = required(data.invocation_targets[0]);
    target.cases.push({ ...supportCase("all", false), request_region: { kind: "any" } });
    expect(chosen(data).resolution.documented_support).toBe("conflicting");
    expect(chosen(data).request).toBeUndefined();
    const ambiguous = fixture();
    ambiguous.identifier_relations.push({
      ...required(ambiguous.identifier_relations[1]),
      model_ref: "provider/second-version",
      target_refs: [],
    });
    expect(chosen(ambiguous)).toMatchObject({
      eligibility: "unknown",
      issues: [{ code: "ambiguous_identity" }],
    });
    expect(chosen(ambiguous, { target_ref: "target" }).request).toBeDefined();
  });

  it("uses target lifecycle and explicit caller policy without calling unknown release stage stable", () => {
    const data = fixture();
    const target = required(data.invocation_targets[0]);
    target.lifecycle = "deprecated";
    target.release_stage = "preview";
    expect(chosen(data).eligibility).toBe("ineligible");
    expect(
      chosen(data, {}, { allowed_lifecycles: ["deprecated"], allowed_release_stages: ["preview"] })
        .request,
    ).toBeDefined();
    target.release_stage = "unknown";
    expect(chosen(data, {}, { allowed_lifecycles: ["deprecated"] })).toMatchObject({
      eligibility: "unknown",
      issues: [{ code: "release_stage", state: "unknown" }],
    });
    target.lifecycle = "retired";
    expect(chosen(data).request).toBeUndefined();
    target.lifecycle = "active";
    target.release_stage = "stable";
    target.resolution = "redirect";
    target.resolved_model_ref = "provider/current";
    expect(chosen(data).request).toBeDefined();
  });

  it("evaluates only applicable case facts and preserves missing, false and conflicting capabilities", () => {
    const data = fixture();
    const entry = required(required(data.invocation_targets[0]).cases[0]);
    data.scoped_facts = [
      {
        id: "tools",
        model_ref: "opaque/model@version",
        field: "capabilities.tool_call",
        value: true,
        evidence_refs: ["evidence"],
      },
      {
        id: "context",
        model_ref: "opaque/model@version",
        field: "limits.context_tokens",
        value: 4096,
        evidence_refs: ["evidence"],
      },
    ];
    const policy: InvocationPolicy = {
      required_capabilities: ["capabilities.tool_call"],
      minimum_limits: { "limits.context_tokens": 4096 },
    };
    expect(chosen(data, {}, policy).issues.map(({ code }) => code)).toEqual([
      "missing_fact",
      "missing_fact",
    ]);
    entry.fact_refs = ["tools", "context"];
    expect(chosen(data, {}, policy).request).toBeDefined();
    expect(
      chosen(data, {}, { minimum_limits: { "limits.context_tokens": 4097 } }).eligibility,
    ).toBe("ineligible");
    data.scoped_facts.push({
      id: "no-tools",
      model_ref: "opaque/model@version",
      field: "capabilities.tool_call",
      value: false,
      evidence_refs: ["evidence"],
    });
    entry.fact_refs.push("no-tools");
    expect(chosen(data, {}, policy)).toMatchObject({
      eligibility: "unknown",
      issues: [{ code: "conflicting_fact" }],
    });
    entry.fact_refs = ["no-tools", "context"];
    expect(chosen(data, {}, policy).eligibility).toBe("ineligible");
    expect(() => chosen(data, {}, { minimum_limits: { "limits.context_tokens": -1 } })).toThrow(
      /Invalid requested/,
    );
  });

  it("checks embedding dimensions against explicit lists and ranges rather than recommendations", () => {
    const data = fixture();
    const entry = required(required(data.invocation_targets[0]).cases[0]);
    data.scoped_facts = [
      {
        id: "range",
        model_ref: "opaque/model@version",
        field: "limits.embedding_dimension_range",
        value: { min: 256, max: 1024 },
        evidence_refs: ["evidence"],
      },
      {
        id: "recommended",
        model_ref: "opaque/model@version",
        field: "limits.recommended_embedding_dimensions",
        value: [512],
        evidence_refs: ["evidence"],
      },
    ];
    entry.fact_refs = ["recommended"];
    expect(chosen(data, {}, { embedding_dimensions: 512 }).eligibility).toBe("unknown");
    entry.fact_refs.push("range");
    expect(chosen(data, {}, { embedding_dimensions: 768 }).request).toBeDefined();
    expect(chosen(data, {}, { embedding_dimensions: 2048 }).eligibility).toBe("ineligible");
  });

  it("requires a fresh exact resource binding after deployment, origin or model configuration changes", () => {
    const data = fixture();
    const target = required(data.invocation_targets[0]);
    const entry = required(target.cases[0]);
    const surface = required(data.surfaces[0]);
    target.address = { kind: "caller", input: "deployment" };
    target.address_role = "deployment";
    entry.requirements.push({ kind: "deployment_binding", evidence_refs: ["evidence"] });
    surface.origin_template = "{origin}";
    surface.inputs.push({ name: "origin", role: "origin" });
    data.identifier_relations = data.identifier_relations.filter(
      ({ role }) => role !== "request_id",
    );
    const inputs = {
      region: "us-east-1",
      origin: "https://tenant.example.com",
      deployment: "production/blue",
    };
    const selected: Partial<InvocationQuery> = { identifier: "model", inputs };
    expect(chosen(data, selected).resolution.missing_inputs).toContain("deployment_binding");
    const resource_binding = {
      target_ref: target.id,
      case_ref: entry.id,
      model_ref: target.model_ref,
      inputs,
      confirmed_requirements: ["deployment_binding" as const],
    };
    expect(chosen(data, { ...selected, resource_binding }).request?.url).toBe(
      "https://tenant.example.com/model/production%2Fblue/converse",
    );
    for (const patch of [
      { deployment: "production/green" },
      { origin: "https://different.example.com" },
    ]) {
      const result = chosen(data, {
        ...selected,
        inputs: { ...inputs, ...patch },
        resource_binding,
      });
      expect(result.resolution.configuration).toBe("conflicting");
      expect(result.request).toBeUndefined();
    }
    expect(
      chosen(data, {
        ...selected,
        resource_binding: { ...resource_binding, model_ref: "other/version" },
      }).resolution.configuration,
    ).toBe("conflicting");
    expect(
      chosen(data, {
        ...selected,
        inputs: { ...inputs, deployment: ".." },
        resource_binding: { ...resource_binding, inputs: { ...inputs, deployment: ".." } },
      }).request,
    ).toBeUndefined();
  });

  it("confirms installation/runtime requirements independently of account access and detects pinned resolution drift", () => {
    const data = fixture();
    const target = required(data.invocation_targets[0]);
    const entry = required(target.cases[0]);
    entry.requirements.push(
      { kind: "installation", evidence_refs: ["evidence"] },
      { kind: "runtime_compatibility", evidence_refs: ["evidence"] },
    );
    const resource_binding = {
      target_ref: target.id,
      case_ref: entry.id,
      model_ref: target.model_ref,
      inputs: { region: "us-east-1" },
      confirmed_requirements: ["installation" as const, "runtime_compatibility" as const],
    };
    expect(chosen(data, { resource_binding }).request?.account_access).toBe("unknown");
    target.resolution = "pinned";
    expect(
      chosen(data, { resource_binding, observed_model_ref: "opaque/other" }).resolution
        .configuration,
    ).toBe("conflicting");
    target.resolution = "rolling";
    expect(chosen(data, { resource_binding, observed_model_ref: "opaque/other" }).eligibility).toBe(
      "unknown",
    );
  });

  it("builds exact body/query/header assignments and rejects collisions or invalid origins", () => {
    const data = fixture();
    const target = required(data.invocation_targets[0]);
    const surface = required(data.surfaces[0]);
    surface.path_template = "/invoke";
    surface.identifier_location = { kind: "body", pointer: "/model" };
    target.selectors = [
      {
        location: { kind: "query", key: "api-version" },
        value: { kind: "literal", value: "2026-10-30" },
      },
      { location: { kind: "header", key: "X-Variant" }, value: { kind: "literal", value: "blue" } },
    ];
    expect(chosen(data).request).toMatchObject({
      url: "https://runtime.us-east-1.example.com/invoke?api-version=2026-10-30",
      headers: { "x-variant": "blue" },
      body_fields: [{ pointer: "/model", value: "us.model" }],
    });
    target.selectors.push({
      location: { kind: "body", key: "/model/name" },
      value: { kind: "literal", value: "collision" },
    });
    expect(chosen(data).issues).toContainEqual({
      state: "ineligible",
      code: "request_configuration",
    });
    target.selectors = [
      {
        location: { kind: "header", key: "Authorization" },
        value: { kind: "caller", input: "credential" },
      },
    ];
    expect(
      chosen(data, { inputs: { credential: "not-a-real-credential" } }).request,
    ).toBeUndefined();
    target.selectors = [];
    expect(chosen(data, { inputs: { region: "bad/path" } }).request).toBeUndefined();
    surface.origin_template = "{origin}";
    surface.inputs.push({ name: "origin", role: "origin" });
    for (const origin of [
      "https://user:secret@example.com",
      "https://example.com?key=value",
      "wss://example.com",
    ])
      expect(chosen(data, { inputs: { origin } }).resolution.configuration).toBe("conflicting");
  });
});
