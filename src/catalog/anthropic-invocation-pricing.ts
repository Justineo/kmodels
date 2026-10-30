import { canonicalJson } from "./canonical-value.ts";
import { invocationOfferSelectorContracts } from "./invocation-price-inputs.ts";
import { invocationOfferConditions } from "./invocation-pricing-validation.ts";
import { invocationSelectorSourceRef } from "./publication-v2.ts";
import type { InvocationCatalog } from "./invocation-schema.ts";
import type { InvocationPricingBinding } from "./invocation-pricing-schema.ts";
import type { PricingCatalog, PricingOffer } from "./pricing-schema.ts";

export function anthropicInvocationPriceBindings(
  invocation: InvocationCatalog,
  pricing: PricingCatalog,
): InvocationPricingBinding[] {
  if (
    !pricing.provider_snapshots.some(
      ({ provider_id, publication }) => provider_id === "anthropic" && publication === "fresh",
    )
  )
    return [];
  const surfaces = new Set(
    invocation.surfaces
      .filter(
        (surface) =>
          surface.provider_id === "anthropic" &&
          surface.method === "POST" &&
          surface.path_template === "/v1/messages",
      )
      .map(({ id }) => id),
  );
  const offersByModel = new Map<string, PricingOffer[]>();
  for (const book of pricing.books) {
    if (book.provider_id !== "anthropic" || book.scope.kind !== "models") continue;
    for (const offer of book.offers) {
      if (offer.offer_key !== "sync" || !offer.source_refs.includes("anthropic-models")) continue;
      for (const modelRef of offer.model_refs ?? book.scope.model_refs)
        offersByModel.set(modelRef, [...(offersByModel.get(modelRef) ?? []), offer]);
    }
  }
  const result: InvocationPricingBinding[] = [];
  for (const target of invocation.invocation_targets) {
    if (!surfaces.has(target.surface_ref) || target.address.kind !== "literal") continue;
    const modelRef = target.resolved_model_ref ?? target.model_ref;
    const offers = offersByModel.get(modelRef) ?? [];
    const offer = offers.length === 1 ? offers[0] : undefined;
    if (offer === undefined) continue;
    const conditions = invocationOfferConditions(offer);
    if (
      conditions.some(
        ({ dimension }) => dimension.namespace === "kmodels" && dimension.value === "operation",
      )
    )
      continue;
    const dimensions = new Map(
      conditions.map(({ dimension }) => [canonicalJson(dimension), dimension]),
    );
    for (const entry of target.cases) {
      if (entry.support.state !== "supported") continue;
      const refs = [...new Set([...target.evidence_refs, ...entry.support.evidence_refs])];
      const selectors: InvocationPricingBinding["selectors"] = [
        {
          dimension: { namespace: "kmodels", value: "model" },
          value: { kind: "fixed", value: { namespace: "kmodels", value: modelRef } },
          evidence_refs: refs,
        },
      ];
      let complete = true;
      for (const key of ["speed", "inference_geo"] as const) {
        const dimension = dimensions.get(canonicalJson({ namespace: "kmodels", value: key }));
        if (dimension === undefined) continue;
        const contracts = invocationOfferSelectorContracts(offer).filter(
          (source) =>
            source.channel === "response" &&
            source.locator.kind === "json_pointer" &&
            source.locator.value === `/usage/${key}` &&
            canonicalJson(source.dimension) === canonicalJson(dimension),
        );
        if (contracts.length !== 1 || contracts[0] === undefined) {
          complete = false;
          break;
        }
        const scope = key === "speed" ? entry.inference_mode : entry.inference_geo;
        if (scope.kind === "exact") {
          const atom = pricing.provider_vocabularies
            .find(({ provider_id }) => provider_id === "anthropic")
            ?.atoms.find(
              (atom) =>
                atom.kind === "categorical_value" &&
                atom.key === scope.value &&
                canonicalJson(atom.dimension) === canonicalJson(dimension),
            );
          if (atom === undefined) {
            complete = false;
            break;
          }
          selectors.push({
            dimension,
            value: {
              kind: "fixed",
              value: { namespace: "provider", provider_id: "anthropic", value: scope.value },
            },
            evidence_refs: refs,
          });
        } else {
          selectors.push({
            dimension,
            value: {
              kind: "observed",
              input_ref: invocationSelectorSourceRef(offer.id, contracts[0]),
            },
            evidence_refs: refs,
          });
        }
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
