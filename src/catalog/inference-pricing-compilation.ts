import type { InferencePriceMapping, InferencePriceRule } from "../pricing/inference-schema.ts";
import { uniqueCanonicalValues } from "./canonical-value.ts";
import {
  inferencePriceSourceSchema,
  type InferencePriceSource,
} from "./inference-pricing-source.ts";
import { withInferencePriceMapping, type CatalogPairCandidate } from "./pricing-publication.ts";

type Source = InferencePriceSource["record"];

/** Rebuild only evidenced joins. Changed or missing identity evidence never revives an old alias. */
export function compileInferencePriceMapping(
  candidate: CatalogPairCandidate,
  inputs: readonly InferencePriceSource[],
  previous?: CatalogPairCandidate,
): CatalogPairCandidate {
  const prior = previous?.inference?.mapping;
  if (inputs.length === 0 && prior === undefined) return candidate;
  const currentSources = new Map(
    candidate.catalog.sources.map((source): [string, Source] => [
      source.id,
      {
        provider_id: source.provider_id,
        id: source.id,
        url: source.url,
        observed_at: source.observed_at,
        content_hash: source.content_hash,
        extractor_version: source.extractor_version,
      },
    ]),
  );
  const offers = candidate.pricing.data.books
    .filter((book) => book.scope.kind === "models")
    .flatMap((book) =>
      book.offers.map((offer) => ({
        provider_id: book.provider_id,
        offer,
        model_refs: offer.model_refs ?? book.scope.model_refs,
      })),
    );
  const models = new Map(
    candidate.catalog.models.map(({ uid, provider_id }) => [uid, provider_id]),
  );
  const replaced = new Set<string>();
  const sources = new Map<string, Source>();
  const rules: InferencePriceRule[] = [];
  for (const input of inputs) {
    const { record, rules: facts } = inferencePriceSourceSchema.parse(input);
    const current = currentSources.get(record.id);
    // Provider-atomic fallback may have kept the older core rather than these newly fetched facts.
    if (current === undefined || !sameRevision(record, current)) continue;
    if (replaced.has(record.id)) throw new Error(`Duplicate inference price source ${record.id}`);
    replaced.add(record.id);
    for (const fact of facts) {
      if (models.get(fact.model_ref) !== record.provider_id) continue;
      const offer_refs = offers
        .filter(
          ({ provider_id, offer, model_refs }) =>
            provider_id === record.provider_id &&
            offer.offer_key === fact.offer_key &&
            model_refs.includes(fact.model_ref),
        )
        .map(({ offer }) => offer.id);
      if (offer_refs.length === 0) continue;
      rules.push({
        provider_id: record.provider_id,
        model_id: fact.model_id,
        model_ref: fact.model_ref,
        offer_refs,
        fixed_selectors: fact.fixed_selectors,
        evidence: fact.evidence,
      });
      sources.set(current.id, current);
    }
  }
  for (const rule of prior?.rules ?? []) {
    if (
      models.get(rule.model_ref) !== rule.provider_id ||
      rule.evidence.some(({ source_ref }) => replaced.has(source_ref))
    )
      continue;
    if (
      rule.offer_refs.some(
        (ref) =>
          !offers.some(
            ({ provider_id, offer, model_refs }) =>
              offer.id === ref &&
              provider_id === rule.provider_id &&
              model_refs.includes(rule.model_ref),
          ),
      )
    )
      continue;
    const evidenceSources = rule.evidence.map(({ source_ref }) => {
      const captured =
        prior?.sources.find(({ id }) => id === source_ref) ??
        previous?.pricing.data.provider_snapshots
          .find(({ provider_id }) => provider_id === rule.provider_id)
          ?.source_records?.find(({ id }) => id === source_ref) ??
        previous?.catalog.sources.find(
          ({ id, provider_id }) => id === source_ref && provider_id === rule.provider_id,
        );
      const current = currentSources.get(source_ref);
      return captured !== undefined &&
        current !== undefined &&
        sameRevision({ ...captured, provider_id: rule.provider_id }, current)
        ? current
        : undefined;
    });
    if (evidenceSources.some((source) => source === undefined)) continue;
    rules.push(rule);
    for (const source of evidenceSources) if (source !== undefined) sources.set(source.id, source);
  }
  const mapping: InferencePriceMapping = {
    core_catalog_version: candidate.catalog.catalog_version,
    pricing_data_version: candidate.pricing.pricing_data_version,
    sources: [...sources.values()],
    rules: uniqueCanonicalValues(rules),
  };
  return withInferencePriceMapping(candidate, mapping);
}

function sameRevision(left: Source, right: Source): boolean {
  return (
    left.provider_id === right.provider_id &&
    left.url === right.url &&
    left.content_hash === right.content_hash &&
    left.extractor_version === right.extractor_version
  );
}
