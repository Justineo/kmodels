import { expect, it } from "vite-plus/test";
import { matchInferencePrices } from "../src/pricing/inference-matching.ts";
import {
  commercialBranchesCoverScopes,
  resolveCommercialChoices,
} from "../src/pricing/commercial-matching.ts";
import { unconditionalApplicability as all } from "../src/catalog/pricing-canonical.ts";
import type { CommercialChoice, PriceApplicability } from "../src/catalog/pricing-schema.ts";
import type {
  InferenceMatchData,
  InferenceMatchOffer,
} from "../src/pricing/inference-matching-schema.ts";

const at = "2026-01-01T00:00:00.000Z";
const choice = (dimension: CommercialChoice["dimension"], value: string): CommercialChoice => ({
  dimension,
  value: { namespace: "kmodels", value },
});
function native(
  dimension: "speed" | "served_service_tier" | "operation" | "region",
  value: string,
): PriceApplicability {
  return {
    any_of: [
      {
        all_of: [
          {
            kind: "categorical",
            dimension: { namespace: "kmodels", value: dimension },
            values: [{ namespace: "provider", provider_id: "fixture", value }],
          },
        ],
      },
    ],
  };
}
function claim(
  dimension: CommercialChoice["dimension"],
  value: string,
  applicability = all,
  binding = all,
) {
  return {
    dimension,
    coverage: "complete" as const,
    applicability,
    alternatives: [{ value: choice(dimension, value).value, applicability: binding }],
  };
}
function offer(id: string, selection: InferenceMatchOffer["selection"]): InferenceMatchOffer {
  return {
    id,
    selection,
    states: [{ state: "numeric", applicability: all, semantics: 0 }],
    relations: [],
    terms: [
      {
        id: `${id}-input`,
        kind: "rate",
        raw_variants: [],
        variants: [{ applicability: all, semantics: 0 }],
      },
    ],
  };
}
function data(offers: InferenceMatchOffer[]): InferenceMatchData {
  return {
    generated_at: at,
    observed_at: at,
    rules: [
      { model_ref: "fixture/model", offer_refs: offers.map(({ id }) => id), fixed_selectors: [] },
    ],
    offers,
    referenced_rates: [],
  };
}
function query(input: InferenceMatchData, ...choices: CommercialChoice[]) {
  return matchInferencePrices(input, [], at, undefined, undefined, choices);
}

it("does not infer a sole speed when it would discard another execution context", () => {
  const request = native("operation", "request");
  const batch = native("operation", "batch");
  const speed = native("speed", "default");
  const online = {
    any_of: request.any_of.map(({ all_of }) => ({
      all_of: [...all_of, ...speed.any_of.flatMap((c) => c.all_of)],
    })),
  };
  const subject = offer("public", [claim("speed", "standard", request, speed)]);
  const proposed = choice("speed", "standard");
  const current = resolveCommercialChoices(subject, [], [], at, at);
  const selected = resolveCommercialChoices(subject, [], [proposed], at, at);
  expect(commercialBranchesCoverScopes([online, batch], current.branches, selected.branches)).toBe(
    false,
  );
  expect(commercialBranchesCoverScopes([online], current.branches, selected.branches)).toBe(true);
  const supplied = [
    {
      kind: "categorical" as const,
      dimension: { namespace: "kmodels" as const, value: "operation" as const },
      value: { namespace: "provider" as const, provider_id: "fixture", value: "request" },
    },
  ];
  expect(
    commercialBranchesCoverScopes(
      [online, batch],
      resolveCommercialChoices(subject, supplied, [], at, at).branches,
      resolveCommercialChoices(subject, supplied, [proposed], at, at).branches,
    ),
  ).toBe(true);
});

it("keeps identity independent of semantics, including one contract with several execution mechanisms", () => {
  const dual = offer("dual", [
    {
      ...claim("execution", "request"),
      alternatives: ["request", "realtime"].map((value) => ({
        value: choice("execution", value).value,
        applicability: all,
      })),
    },
  ]);
  const input = data([dual, offer("another", [claim("execution", "request")])]);
  expect(
    query(input, choice("execution", "request")).candidates.map(({ offer_ref }) => offer_ref),
  ).toEqual(["dual", "another"]);
  expect(query(input, choice("execution", "realtime"))).toMatchObject({
    status: "matched",
    candidates: [{ offer_ref: "dual" }],
  });
  expect(query(input).missing_choices).toContain("execution");
});

it("preserves correlated scopes inside one offer and never invents Batch/Fast", () => {
  const request = native("operation", "interactive");
  const batch = native("operation", "deferred");
  const fast = native("speed", "expedited");
  const input = data([
    offer("shared", [
      claim("execution", "request", request, request),
      claim("execution", "batch", batch, batch),
      claim("speed", "fast", request, fast),
    ]),
  ]);
  expect(query(input, choice("execution", "batch"), choice("speed", "fast"))).toMatchObject({
    status: "unknown",
    reason: "no_applicable_price",
    candidates: [],
  });
  expect(
    query(input, choice("execution", "batch")).available_choices.some(
      ({ dimension }) => dimension === "speed",
    ),
  ).toBe(false);
  expect(
    query(input, choice("execution", "request"), choice("speed", "fast")).candidates[0]?.selectors,
  ).toContainEqual({
    kind: "categorical",
    dimension: { namespace: "kmodels", value: "speed" },
    value: { namespace: "provider", provider_id: "fixture", value: "expedited" },
  });
});

it("binds only the chosen value, preserving unresolved geography and all additive meters", () => {
  const us = native("region", "us");
  const eu = native("region", "eu");
  const tier = native("served_service_tier", "default");
  const input = data([
    offer("shared", [
      claim("served_service_tier", "standard", us, tier),
      claim("served_service_tier", "standard", eu, tier),
    ]),
  ]);
  const result = query(input, choice("served_service_tier", "standard"));
  expect(result.candidates).toHaveLength(1);
  expect(
    result.candidates[0]?.selectors.some(({ dimension }) => dimension.value === "region"),
  ).toBe(false);
  expect(result.missing_conditions).toContainEqual({ namespace: "kmodels", value: "region" });
  expect(result.candidates[0]?.terms).toHaveLength(1);
});

it("keeps unresolved coverage visible beside positive matches and distinguishes unsupported from unknown", () => {
  const partial = offer("partial", [
    { ...claim("execution", "request"), coverage: "partial", alternatives: [] },
  ]);
  const input = data([offer("known", [claim("execution", "request")]), partial]);
  const result = query(input, choice("execution", "request"));
  expect(result).toMatchObject({
    status: "candidates",
    unresolved_choices: [{ offer_ref: "partial", dimension: "execution", reason: "partial" }],
  });
  expect(query(input, choice("execution", "realtime")).reason).toBe("unreviewed_commercial_choice");
  expect(
    query(data([offer("known", [claim("execution", "request")])]), choice("execution", "realtime"))
      .reason,
  ).toBe("no_applicable_price");
});

it("does not convert requested service class into the observed billed class", () => {
  const input = data([
    offer("observed", [
      claim("served_service_tier", "priority", all, native("served_service_tier", "priority")),
    ]),
  ]);
  expect(query(input, choice("requested_service_tier", "priority"))).toMatchObject({
    status: "unknown",
    reason: "unreviewed_commercial_choice",
  });
  expect(query(input, choice("served_service_tier", "priority")).status).toBe("matched");
});

it("preserves known exclusions inside partial coverage without rejecting an unreviewed mechanism", () => {
  const input = data([
    offer("partial", [
      {
        ...claim("execution", "request"),
        coverage: "partial",
        alternatives: [],
        excluded_values: [choice("execution", "batch").value],
      },
    ]),
    offer("batch", [claim("execution", "batch")]),
  ]);
  expect(query(input, choice("execution", "batch"))).toMatchObject({
    status: "matched",
    unresolved_choices: [],
    candidates: [{ offer_ref: "batch" }],
  });
  expect(query(input, choice("execution", "request"))).toMatchObject({
    status: "unknown",
    reason: "unreviewed_commercial_choice",
  });
});

it("preserves provider residuals, validity and conflicting exact selectors", () => {
  const residual: CommercialChoice = {
    dimension: "served_service_tier",
    value: { namespace: "provider", provider_id: "fixture", value: "special" },
  };
  const input = data([
    offer("residual", [
      {
        ...claim("served_service_tier", "standard"),
        alternatives: [
          { value: residual.value, applicability: native("served_service_tier", "special") },
        ],
      },
    ]),
  ]);
  expect(query(input, residual).status).toBe("matched");
  expect(query(input, choice("served_service_tier", "standard")).candidates).toEqual([]);
  expect(
    matchInferencePrices(
      input,
      [
        {
          kind: "categorical",
          dimension: { namespace: "kmodels", value: "served_service_tier" },
          value: { namespace: "provider", provider_id: "fixture", value: "default" },
        },
      ],
      at,
      undefined,
      undefined,
      [residual],
    ).candidates,
  ).toEqual([]);
  const selectionClaim = input.offers[0]?.selection?.[0];
  if (!selectionClaim) throw new Error("Missing claim");
  selectionClaim.validity = { until: { precision: "datetime", value: "2025-12-31T00:00:00.000Z" } };
  expect(query(input, residual).candidates).toEqual([]);
});
