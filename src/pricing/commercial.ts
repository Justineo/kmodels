import { z } from "zod";
import { commercialChoiceSchema, priceMeterSchema } from "../catalog/pricing-schema.ts";
import { createInferencePriceLookup, selectedTerm } from "./inference.ts";
import { inferencePriceMappingSchema } from "./inference-schema.ts";
import { inferenceMatchData } from "./inference-matching-data.ts";
import { matchInferencePrices } from "./inference-matching.ts";
import { createPricingSnapshot } from "./snapshot.ts";
import { evaluationTimeSchema, selectorSchema } from "./schema.ts";
import { parseEvaluationTime, parseRequest, validateSelectorVocabulary } from "./request.ts";
import { PricingError } from "./errors.ts";

export const commercialPriceQuerySchema = z.strictObject({
  subject: z.discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("model"),
      provider_id: z.string().min(1),
      model_id: z.string().min(1),
    }),
    z.strictObject({
      kind: z.literal("resource"),
      provider_id: z.string().min(1),
      book_ref: z.string().regex(/^[0-9a-f]{64}$/),
    }),
  ]),
  choices: z.array(commercialChoiceSchema).max(8).default([]),
  meter: priceMeterSchema.optional(),
  selectors: z.array(selectorSchema).max(128).default([]),
  offer_ref: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .optional(),
  evaluated_at: evaluationTimeSchema.optional(),
});
export type CommercialPriceQuery = z.input<typeof commercialPriceQuerySchema>;

/** Resolve unit prices for a model or resource; no usage quantities or cost aggregation. */
export function createCommercialPriceLookup(priceData: unknown, mappingData: unknown) {
  const inference = createInferencePriceLookup(priceData, mappingData);
  const snapshot = createPricingSnapshot(priceData);
  const mapping = inferencePriceMappingSchema.parse(mappingData);
  return (input: CommercialPriceQuery) => {
    const query = parseRequest(commercialPriceQuerySchema, input);
    const { subject, ...selection } = query;
    if (subject.kind === "model")
      return {
        subject,
        ...inference({
          ...selection,
          provider_id: subject.provider_id,
          model_id: subject.model_id,
        }),
      };
    const provider = snapshot.data.providers.find(
      ({ snapshot }) => snapshot.provider_id === subject.provider_id,
    );
    const book = provider?.books.find(
      ({ id, scope }) => id === subject.book_ref && scope.kind === "provider_resource",
    );
    if (book === undefined || provider === undefined)
      throw new PricingError("INVALID_REQUEST", "Unknown commercial resource subject");
    validateSelectorVocabulary(query.selectors, provider);
    const evaluatedAt =
      query.evaluated_at === undefined
        ? snapshot.data.snapshot.generatedAt
        : parseEvaluationTime(query.evaluated_at);
    const matching = inferenceMatchData(
      snapshot,
      [{ offer_refs: book.offers.map(({ id }) => id), fixed_selectors: [] }],
      mapping.offer_selections,
      query.meter,
    );
    const matched = matchInferencePrices(
      matching,
      query.selectors,
      evaluatedAt,
      query.offer_ref,
      undefined,
      query.choices,
    );
    return structuredClone({
      subject,
      query,
      snapshot: snapshot.data.snapshot,
      evaluated_at: evaluatedAt,
      freshness: provider.snapshot,
      ...matched,
      candidates: matched.candidates.map((candidate) => {
        const owner = snapshot.offers.get(candidate.offer_ref);
        if (!owner) throw new PricingError("INVALID_DATA", "Missing selected resource offer");
        return {
          book_ref: book.id,
          selectors: selectorSchema.array().parse(candidate.selectors),
          missing_conditions: candidate.missing_conditions,
          gaps: candidate.gaps,
          evidence:
            mapping.offer_selections
              ?.find(({ offer_ref }) => offer_ref === candidate.offer_ref)
              ?.selection.flatMap(({ evidence }) => evidence) ?? [],
          offer: {
            ...owner.offer,
            states: owner.offer.states.filter((_, index) => candidate.states.includes(index)),
            relations: owner.offer.relations.filter((_, index) =>
              candidate.relations.includes(index),
            ),
            terms: owner.offer.terms.flatMap((term) => {
              const selected = candidate.terms.find(({ id }) => id === term.id);
              return selected === undefined ? [] : [selectedTerm(term, selected)];
            }),
          },
          referenced_rates: candidate.referenced_rates.flatMap((selected) => {
            const rate = snapshot.rates.get(selected.id);
            return rate === undefined ? [] : [selectedTerm(rate, selected)];
          }),
        };
      }),
    });
  };
}
