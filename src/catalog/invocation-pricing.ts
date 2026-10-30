import { canonicalJson } from "./canonical-value.ts";
import type { InvocationCatalog } from "./invocation-schema.ts";
import type { InvocationPricingBinding } from "./publication-v2-schema.ts";
import type { PricingCatalog } from "./pricing-schema.ts";
import type { SourceInvocationPriceLink } from "./invocation-pricing-schema.ts";
export type { SourceInvocationPriceLink } from "./invocation-pricing-schema.ts";

export function reconcileInvocationBindings(
  invocation: InvocationCatalog,
  pricing: PricingCatalog,
  links: readonly SourceInvocationPriceLink[],
  previous?: { invocation: InvocationCatalog; bindings: readonly InvocationPricingBinding[] },
): InvocationPricingBinding[] {
  const targets = new Map(invocation.invocation_targets.map((target) => [target.id, target]));
  const surfaces = new Map(invocation.surfaces.map((surface) => [surface.id, surface]));
  const fresh = new Set(
    pricing.provider_snapshots
      .filter(({ publication }) => publication === "fresh")
      .map(({ provider_id }) => provider_id),
  );
  const offers = pricing.books.flatMap((book) => book.offers.map((offer) => ({ book, offer })));
  const result = new Map<string, InvocationPricingBinding>();
  for (const link of links) {
    const target = targets.get(link.target_ref);
    const entry = target?.cases.find(({ id }) => id === link.case_ref);
    if (target === undefined || entry?.support.state !== "supported") continue;
    if ((target.resolved_model_ref ?? target.model_ref) !== link.model_ref)
      throw new Error("Invocation price link disagrees with the observed model resolution");
    const provider = surfaces.get(target.surface_ref)?.provider_id;
    if (provider === undefined || !fresh.has(provider)) continue;
    const offerRefs = offers
      .filter(
        ({ book, offer }) =>
          book.provider_id === provider &&
          offer.offer_key === link.offer_key &&
          (offer.model_refs ?? book.scope.model_refs).includes(link.model_ref) &&
          offer.source_refs.includes(link.source_ref),
      )
      .map(({ offer }) => offer.id)
      .sort();
    if (offerRefs.length === 0) continue;
    const key = canonicalJson([target.id, entry.id]);
    const binding = {
      target_ref: target.id,
      case_ref: entry.id,
      offer_refs: offerRefs,
      selectors: link.selectors,
      evidence_refs: link.evidence_refs,
    };
    const existing = result.get(key);
    if (existing !== undefined && canonicalJson(existing) !== canonicalJson(binding))
      throw new Error("Invocation has conflicting commercial joins");
    result.set(key, binding);
  }
  if (previous !== undefined) {
    const offerIds = new Set(offers.map(({ offer }) => offer.id));
    const evidence = new Set(invocation.invocation_evidence.map(({ id }) => id));
    for (const binding of previous.bindings) {
      const key = canonicalJson([binding.target_ref, binding.case_ref]);
      if (
        result.has(key) ||
        !targets.has(binding.target_ref) ||
        binding.offer_refs.some((ref) => !offerIds.has(ref))
      )
        continue;
      if (
        [
          ...binding.evidence_refs,
          ...binding.selectors.flatMap(({ evidence_refs }) => evidence_refs),
        ].some((ref) => !evidence.has(ref))
      )
        continue;
      if (
        invocationBindingSemantics(invocation, binding.target_ref) ===
        invocationBindingSemantics(previous.invocation, binding.target_ref)
      )
        result.set(key, binding);
    }
  }
  return [...result].sort(([left], [right]) => left.localeCompare(right)).map(([, value]) => value);
}

function invocationBindingSemantics(data: InvocationCatalog, targetRef: string): string {
  const target = data.invocation_targets.find(({ id }) => id === targetRef);
  if (target === undefined) return "missing";
  const surface = data.surfaces.find(({ id }) => id === target.surface_ref);
  const factRefs = new Set(target.cases.flatMap(({ fact_refs }) => fact_refs));
  const facts = data.scoped_facts.filter(({ id }) => factRefs.has(id));
  const evidenceRefs = new Set([
    ...target.evidence_refs,
    ...(surface?.evidence_refs ?? []),
    ...facts.flatMap(({ evidence_refs }) => evidence_refs),
    ...target.cases.flatMap((entry) => [
      ...entry.support.evidence_refs,
      ...entry.requirements.flatMap(({ evidence_refs }) => evidence_refs),
    ]),
  ]);
  return canonicalJson({
    target,
    surface: surface ?? null,
    facts,
    evidence: data.invocation_evidence
      .filter(({ id }) => evidenceRefs.has(id))
      .map(({ observed_at: _at, ...evidence }) => evidence),
  });
}
