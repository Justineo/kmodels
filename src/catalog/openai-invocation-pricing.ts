import { canonicalJson } from "./canonical-value.ts";
import {
  invocationOfferSelectorContracts,
  invocationOfferSelectorSources,
} from "./invocation-price-inputs.ts";
import { invocationOfferConditions } from "./invocation-pricing-validation.ts";
import type { InvocationPricingBinding } from "./invocation-pricing-schema.ts";
import type { InvocationCatalog } from "./invocation-schema.ts";
import { openAiDirectOperations } from "./openai-invocation-wire.ts";
import { openAiWebSocketContracts } from "./openai-invocation-websocket.ts";
import { invocationSelectorSourceRef } from "./publication-v2.ts";
import type {
  PricingCatalog,
  PricingOffer,
  PriceDimension,
  PriceCategoricalValue,
} from "./pricing-schema.ts";

/** Bind admitted native operations to their canonical public tariff, after offer assembly. */
export function openAiInvocationPriceBindings(
  invocation: InvocationCatalog,
  pricing: PricingCatalog,
): InvocationPricingBinding[] {
  if (
    !pricing.provider_snapshots.some(
      ({ provider_id, publication }) => provider_id === "openai" && publication === "fresh",
    )
  )
    return [];
  const surfaces = new Map(
    invocation.surfaces
      .filter(({ provider_id }) => provider_id === "openai")
      .map((surface) => [surface.id, surface]),
  );
  const vocabulary = pricing.provider_vocabularies.find(
    ({ provider_id }) => provider_id === "openai",
  );
  const offersByModel = new Map<string, PricingOffer[]>();
  for (const book of pricing.books) {
    if (book.provider_id !== "openai" || book.scope.kind !== "models") continue;
    for (const offer of book.offers) {
      if (
        offer.offer_key !== "sync" ||
        !offer.source_refs.some((ref) => ref === "openai-pricing" || ref === "openai-overview")
      )
        continue;
      for (const ref of new Set(offer.model_refs ?? book.scope.model_refs)) {
        const offers = offersByModel.get(ref) ?? [];
        offers.push(offer);
        offersByModel.set(ref, offers);
      }
    }
  }
  const result: InvocationPricingBinding[] = [];
  for (const target of invocation.invocation_targets) {
    const surface = surfaces.get(target.surface_ref);
    if (
      surface === undefined ||
      target.address.kind !== "literal" ||
      (!(
        surface.transport === "http" &&
        surface.method === "POST" &&
        openAiDirectOperations.some(({ path }) => `/v1${path}` === surface.path_template)
      ) &&
        !(
          surface.transport === "websocket" &&
          surface.method === "GET" &&
          openAiWebSocketContracts.some(({ path }) => path === surface.path_template)
        ))
    )
      continue;
    const offers = offersByModel.get(target.model_ref) ?? [];
    // Competing public schedules need an explicit commercial choice rather than a first match.
    const offer = offers.length === 1 ? offers[0] : undefined;
    if (offer === undefined) continue;
    const conditions = invocationOfferConditions(offer);
    const dimensions = new Map(
      conditions.map(({ dimension }) => [canonicalJson(dimension), dimension]),
    );
    // Operation-specific tariffs require their own reviewed wire-to-commercial mapping.
    if (dimensions.has(canonicalJson({ namespace: "kmodels", value: "operation" }))) continue;
    for (const entry of target.cases) {
      if (entry.support.state !== "supported") continue;
      const refs = [...new Set([...target.evidence_refs, ...entry.support.evidence_refs])];
      const selectors: InvocationPricingBinding["selectors"] = [
        {
          dimension: { namespace: "kmodels", value: "model" },
          value: { kind: "fixed", value: { namespace: "kmodels", value: target.model_ref } },
          evidence_refs: refs,
        },
      ];
      let complete = true;
      function fixed(dimension: PriceDimension, value: string | boolean) {
        if (
          typeof value !== "boolean" &&
          !vocabulary?.atoms.some(
            (atom) =>
              atom.kind === "categorical_value" &&
              atom.key === value &&
              canonicalJson(atom.dimension) === canonicalJson(dimension),
          )
        ) {
          complete = false;
          return;
        }
        selectors.push({
          dimension,
          value: {
            kind: "fixed",
            value:
              typeof value === "boolean"
                ? value
                : { namespace: "provider", provider_id: "openai", value },
          },
          evidence_refs: refs,
        });
      }
      for (const dimension of dimensions.values()) {
        if (dimension.namespace === "provider") {
          if (dimension.value === "eu_data_residency" && entry.request_region.kind === "exact")
            fixed(dimension, entry.request_region.value === "Europe (EEA + Switzerland)");
          continue;
        }
        if (dimension.value === "deployment_scope" && entry.deployment_type.kind === "exact")
          fixed(dimension, entry.deployment_type.value);
        if (dimension.value === "region" && entry.request_region.kind === "exact")
          fixed(dimension, entry.request_region.value);
        if (dimension.value !== "served_service_tier") continue;
        const tierValues = new Map<string, PriceCategoricalValue>();
        for (const condition of conditions)
          if (
            condition.kind === "categorical" &&
            canonicalJson(condition.dimension) === canonicalJson(dimension)
          )
            for (const value of condition.values) tierValues.set(canonicalJson(value), value);
        if (!["/v1/responses", "/v1/chat/completions"].includes(surface.path_template)) {
          if (tierValues.size === 1 && [...tierValues.values()][0]?.value === "standard")
            fixed(dimension, "standard");
          else complete = false;
          continue;
        }
        // Response and Chat Completions contracts are independent, even when paths look alike.
        const inputKey =
          surface.path_template === "/v1/responses"
            ? "responses.served_service_tier"
            : "chat.served_service_tier";
        if (
          !invocationOfferSelectorSources(offer).some(
            (source) =>
              "observations" in source &&
              source.observations.some(
                (observation) =>
                  observation.source_ref === "openai-accounting" &&
                  observation.locator.kind === "provider_key" &&
                  observation.locator.value === inputKey,
              ),
          )
        ) {
          complete = false;
          continue;
        }
        const observed = new Set(
          invocationOfferSelectorContracts(offer)
            .filter(
              (source) =>
                source.channel === "response" &&
                source.locator.kind === "json_pointer" &&
                source.locator.value === "/service_tier" &&
                canonicalJson(source.dimension) === canonicalJson(dimension),
            )
            .map((source) => invocationSelectorSourceRef(offer.id, source)),
        );
        const inputRef = observed.size === 1 ? [...observed][0] : undefined;
        if (inputRef === undefined) complete = false;
        else
          selectors.push({
            dimension,
            value: { kind: "observed", input_ref: inputRef },
            evidence_refs: refs,
          });
      }
      if (complete)
        result.push({
          target_ref: target.id,
          case_ref: entry.id,
          offer_refs: [offer.id],
          selectors,
          evidence_refs: refs,
        });
    }
  }
  return result;
}
