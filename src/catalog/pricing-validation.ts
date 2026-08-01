import {
  assertIJsonValue,
  canonicalJsonFromValidated as canonicalJson,
  canonicalJsonKey,
  canonicalValuesEqual,
  compareCanonicalValues,
  compareUtf8,
  compareUtf8Sequences,
} from "./canonical-value.ts";
import {
  applicabilitiesOverlap,
  applicabilityContainedIn,
  canonicalizeApplicability,
  normalizeUnitExpression,
  selectorWeight,
  unionApplicabilities,
} from "./pricing-canonical.ts";
import { pricingLimits } from "./pricing-constants.ts";
import { pricingBookId, pricingOfferId, pricingTermId } from "./pricing-identifiers.ts";
import {
  type ModelPricingDisposition,
  type NormalizedPriceObservation,
  type PriceAllowanceTerm,
  type PriceApplicability,
  type PriceCondition,
  type PriceDimension,
  type PriceRateTerm,
  type PricingBook,
  type PricingCatalog,
  type PricingOffer,
  type PricingTerm,
  type ProviderAtomRegistryEntry,
  type ProviderPricingVocabulary,
  type PublishedValidity,
  type RawPriceFact,
  type RawPricingVariant,
  type UnitExpression,
} from "./pricing-schema.ts";
import { publishedValiditiesOverlap, publishedValidityIsCoherent } from "./pricing-time.ts";
import type { Catalog } from "./schema.ts";

export type PricingValidationCore = Pick<Catalog, "models" | "providers" | "sources">;
type Core = PricingValidationCore;
type SortKey = readonly string[];

interface CoreIndex {
  providers: Map<string, Core["providers"][number]>;
  models: Map<string, Core["models"][number]>;
  sources: Map<string, Core["sources"][number]>;
}

interface ProviderValidation {
  providerId: string;
  core: CoreIndex;
  vocabulary: ProviderPricingVocabulary;
  atoms: Map<string, ProviderAtomRegistryEntry>;
  modelRefs: Set<string>;
  applicabilityBytes: number;
  applicabilityBytesBySource: Map<string, number>;
  relationPairs: Array<readonly [PriceApplicability, PriceApplicability]>;
  dimensions: Map<string, { kind: PriceCondition["kind"]; unit?: string }>;
  offers: Map<string, PricingOffer>;
  terms: Map<string, { term: PricingTerm; offer: PricingOffer }>;
  counts: { offers: number; terms: number; variants: number; observations: number };
}

export function validatePricingCatalog(data: PricingCatalog, core: Core): void {
  const header = validatePricingCatalogHeader(data, core);
  validatePricingCatalogProviders(data, header);
  validatePricingCatalogSize(data);
}

// Parallel workers receive partitions filtered from a graph validated by the parent thread.
export function validatePricingCatalogProvidersFromTopology(
  data: PricingCatalog,
  core: Core,
): void {
  validatePricingCatalogProviders(data, validatePricingCatalogOwnership(data, core));
}

function validatePricingCatalogProviders(
  data: PricingCatalog,
  { coreIndex, ownerIds, snapshots, vocabularies }: ReturnType<typeof validatePricingCatalogHeader>,
): void {
  const ids = new Set<string>();
  const applicabilityBytesBySource = new Map<string, number>();
  for (const providerId of ownerIds) {
    const vocabulary = vocabularies.get(providerId);
    const snapshot = snapshots.get(providerId);
    if (vocabulary === undefined || snapshot === undefined)
      fail(providerId, "provider metadata is missing");

    const context = createProviderValidation(
      providerId,
      vocabulary,
      coreIndex,
      applicabilityBytesBySource,
    );
    const books = data.books.filter((book) => book.provider_id === providerId);
    const dispositions = data.model_dispositions.filter(
      ({ model_ref }) => ownedModel(coreIndex, model_ref).provider_id === providerId,
    );
    if (books.length > pricingLimits.booksPerProvider)
      fail(providerId, "book count exceeds provider limit");
    books.forEach((book) => validateBook(book, context, ids));
    validateProviderLinks(context);
    dispositions.forEach((disposition) => validateDisposition(disposition, context));
    validateProviderTotals(books, dispositions, snapshot.observed_at, context);
  }
}

export function validatePricingCatalogTopology(data: PricingCatalog, core: Core): void {
  validatePricingCatalogHeader(data, core);
  const ids = new Set<string>();
  for (const book of data.books) {
    addUniqueId(ids, book.id, `book ${book.book_key}`);
    for (const offer of book.offers) {
      addUniqueId(ids, offer.id, `offer ${offer.offer_key}`);
      for (const term of offer.terms) addUniqueId(ids, term.id, `term ${term.term_key}`);
    }
  }
  validatePricingCatalogSize(data);
}

function validatePricingCatalogHeader(data: PricingCatalog, core: Core) {
  assertIJsonValue(data);
  assertSortedUnique(
    data.provider_vocabularies,
    ({ provider_id }) => [provider_id],
    "vocabularies",
  );
  assertSortedUnique(data.provider_snapshots, ({ provider_id }) => [provider_id], "snapshots");
  assertSortedUnique(data.model_dispositions, ({ model_ref }) => [model_ref], "dispositions");
  assertSortedUnique(data.books, ({ id }) => [id], "books");
  return validatePricingCatalogOwnership(data, core);
}

function validatePricingCatalogOwnership(data: PricingCatalog, core: Core) {
  const coreIndex = indexCore(core);
  const vocabularies = uniqueMap(
    data.provider_vocabularies,
    ({ provider_id }) => provider_id,
    "provider vocabulary",
  );
  const snapshots = uniqueMap(
    data.provider_snapshots,
    ({ provider_id }) => provider_id,
    "provider snapshot",
  );
  const ownerIds = new Set([
    ...data.books.map(({ provider_id }) => provider_id),
    ...data.model_dispositions.map(({ model_ref }) => ownedModel(coreIndex, model_ref).provider_id),
  ]);
  if (
    ownerIds.size !== vocabularies.size ||
    ownerIds.size !== snapshots.size ||
    [...ownerIds].some((providerId) => !vocabularies.has(providerId) || !snapshots.has(providerId))
  )
    fail("catalog", "each represented provider must own exactly one vocabulary and snapshot");
  for (const providerId of ownerIds) {
    if (!coreIndex.providers.has(providerId)) fail(providerId, "provider does not exist in core");
  }
  return { coreIndex, ownerIds, snapshots, vocabularies };
}

function validatePricingCatalogSize(data: PricingCatalog): void {
  const conservativeCatalog = {
    ...data,
    provider_snapshots: data.provider_snapshots.map(conservativeSnapshot),
  };
  if (jsonByteLength(conservativeCatalog) > pricingLimits.pricingCatalogBytes)
    fail("catalog", "pricing catalog byte limit exceeded");
}

function conservativeSnapshot(snapshot: PricingCatalog["provider_snapshots"][number]) {
  return {
    provider_id: snapshot.provider_id,
    observed_at: snapshot.observed_at,
    publication: "retained" as const,
    refresh_failure: {
      attempted_at:
        snapshot.publication === "retained"
          ? snapshot.refresh_failure.attempted_at
          : snapshot.observed_at,
      code: "pricing_validation_failed" as const,
    },
  };
}

function createProviderValidation(
  providerId: string,
  vocabulary: ProviderPricingVocabulary,
  core: CoreIndex,
  applicabilityBytesBySource: Map<string, number>,
): ProviderValidation {
  const atoms = validateVocabulary(vocabulary);
  return {
    providerId,
    core,
    vocabulary,
    atoms,
    modelRefs: new Set(),
    applicabilityBytes: 0,
    applicabilityBytesBySource,
    relationPairs: [],
    dimensions: new Map(),
    offers: new Map(),
    terms: new Map(),
    counts: { offers: 0, terms: 0, variants: 0, observations: 0 },
  };
}

function validateVocabulary(
  vocabulary: ProviderPricingVocabulary,
): Map<string, ProviderAtomRegistryEntry> {
  assertSemantic(vocabulary.provider_id, "vocabulary provider ID");
  assertSortedUnique(
    vocabulary.atoms,
    (atom) => [
      atom.kind,
      ...optionalComponent("dimension" in atom ? atom.dimension : undefined),
      atom.key,
    ],
    "vocabulary atoms",
  );
  const atoms = new Map<string, ProviderAtomRegistryEntry>();
  const definitions = new Set<string>();
  for (const atom of vocabulary.atoms) {
    assertNormalizedSemantic(atom.key, "provider atom key");
    assertReviewedText(atom.definition, "provider atom definition");
    if (
      atom.kind === "categorical_value" &&
      atom.dimension.namespace === "provider" &&
      atom.dimension.provider_id !== vocabulary.provider_id
    )
      fail("vocabulary", "categorical atom dimension belongs to another provider");
    const dimension = atom.kind === "categorical_value" ? atom.dimension : undefined;
    const key = atomIdentity(vocabulary.provider_id, atom.kind, dimension, atom.key);
    const definition = atomIdentity(vocabulary.provider_id, atom.kind, dimension, atom.definition);
    if (atoms.has(key)) fail("vocabulary", "duplicate provider atom key");
    if (definitions.has(definition)) fail("vocabulary", "duplicate provider atom definition");
    atoms.set(key, atom);
    definitions.add(definition);
  }
  return atoms;
}

function validateBook(book: PricingBook, context: ProviderValidation, ids: Set<string>): void {
  const path = `book ${book.book_key}`;
  assertSemantic(book.provider_id, `${path} provider ID`);
  assertNormalizedSemantic(book.book_key, `${path} key`);
  if (book.name !== undefined) assertReviewedText(book.name, `${path} name`);
  if (book.id !== pricingBookId(book.provider_id, book.book_key)) fail(path, "ID recipe mismatch");
  addUniqueId(ids, book.id, path);
  assertSourceRefs(book.source_refs, context, path);
  assertSortedUnique(book.offers, ({ id }) => [id], `${path} offers`);
  assertSortedUnique(book.scope.model_refs, (modelRef) => [modelRef], `${path} model refs`);
  for (const modelRef of book.scope.model_refs) {
    assertSemantic(modelRef, `${path} model ref`);
    const model = ownedModel(context.core, modelRef);
    if (model.provider_id !== context.providerId)
      fail(path, "book references a model owned by another provider");
    context.modelRefs.add(modelRef);
  }
  if (book.scope.kind === "provider_service")
    assertNormalizedSemantic(book.scope.service_key, `${path} service key`);

  assertSortedUniqueBy(
    book.scope_observations,
    (left, right) =>
      compareObservationBase(left, right) ||
      compareCanonicalValues(left.establishes, right.establishes) ||
      compareCanonicalValues(left.raw, right.raw),
    `${path} scope observations`,
  );
  context.counts.observations += book.scope_observations.length;
  const observedModels = new Set<string>();
  for (const observation of book.scope_observations) {
    validateObservationBase(observation, context, `${path} scope observation`);
    assertSortedUnique(
      observation.establishes.model_refs,
      (modelRef) => [modelRef],
      `${path} observed model refs`,
    );
    if (
      observation.establishes.kind !== book.scope.kind ||
      (book.scope.kind === "provider_service" &&
        (observation.establishes.kind !== "provider_service" ||
          observation.establishes.service_key !== book.scope.service_key))
    )
      fail(path, "scope observation changes the book scope identity");
    for (const modelRef of observation.establishes.model_refs) {
      if (!book.scope.model_refs.includes(modelRef))
        fail(path, "scope observation exceeds the book model scope");
      if (ownedModel(context.core, modelRef).provider_id !== context.providerId)
        fail(path, "scope observation references another provider's model");
      observedModels.add(modelRef);
    }
  }
  if (!setEquals(observedModels, new Set(book.scope.model_refs)))
    fail(path, "scope observations do not exactly cover the book model scope");

  context.counts.offers += book.offers.length;
  const offerKeys = new Set<string>();
  for (const offer of book.offers) {
    if (offerKeys.has(offer.offer_key)) fail(path, "duplicate offer key");
    offerKeys.add(offer.offer_key);
    validateOffer(offer, book, context, ids);
  }
}

function validateOffer(
  offer: PricingOffer,
  book: PricingBook,
  context: ProviderValidation,
  ids: Set<string>,
): void {
  const path = `offer ${offer.offer_key}`;
  assertNormalizedSemantic(offer.offer_key, `${path} key`);
  if (offer.name !== undefined) assertReviewedText(offer.name, `${path} name`);
  if (offer.id !== pricingOfferId(book.id, offer.offer_key)) fail(path, "ID recipe mismatch");
  addUniqueId(ids, offer.id, path);
  if (context.offers.has(offer.id)) fail(path, "duplicate offer ID");
  context.offers.set(offer.id, offer);
  assertSourceRefs(offer.source_refs, context, path);
  validateOwnedAtom("billing_mode", offer.billing_mode, undefined, context, path);
  assertSortedUnique(
    offer.states,
    (state) => [
      state.state,
      ...optionalComponent(state.validity),
      canonicalJson(state.applicability),
    ],
    `${path} states`,
  );
  assertUniqueBy(
    offer.states,
    (state) => canonicalJson([state.state, ...optionalComponent(state.validity)]),
    `${path} state grouping key`,
  );
  assertSortedUnique(offer.terms, ({ id }) => [id], `${path} terms`);

  const termKeys = new Set<string>();
  context.counts.terms += offer.terms.length;
  for (const term of offer.terms) {
    if (termKeys.has(term.term_key)) fail(path, "duplicate term key");
    termKeys.add(term.term_key);
    validateTerm(term, offer, book, context, ids);
  }

  context.counts.variants += offer.states.length;
  for (const state of offer.states)
    validateNormalizedVariant(
      state,
      state.observations,
      book,
      context,
      `${path} ${state.state} state`,
      false,
    );
  for (let left = 0; left < offer.states.length; left += 1)
    for (let right = left + 1; right < offer.states.length; right += 1)
      context.relationPairs.push([
        offer.states[left]!.applicability,
        offer.states[right]!.applicability,
      ]);

  validateOfferSemantics(offer, context, path);
  if (offer.role === "add_on") validateCompatibility(offer, book, context, path);
}

function validateTerm(
  term: PricingTerm,
  offer: PricingOffer,
  book: PricingBook,
  context: ProviderValidation,
  ids: Set<string>,
): void {
  const path = `term ${term.term_key}`;
  assertNormalizedSemantic(term.term_key, `${path} key`);
  if (term.id !== pricingTermId(offer.id, term.term_key)) fail(path, "ID recipe mismatch");
  addUniqueId(ids, term.id, path);
  if (context.terms.has(term.id)) fail(path, "duplicate term ID");
  context.terms.set(term.id, { term, offer });
  assertSourceRefs(term.source_refs, context, path);

  if (term.kind === "rate") {
    validateOwnedAtom("meter", term.meter, undefined, context, path);
    assertSortedUnique(
      term.variants,
      (variant) => [
        canonicalJson(variant.price),
        ...optionalComponent(variant.validity),
        canonicalJson(variant.applicability),
      ],
      `${path} variants`,
    );
    assertUniqueBy(
      term.variants,
      (variant) => canonicalJson([variant.price, ...optionalComponent(variant.validity)]),
      `${path} variant grouping key`,
    );
    assertSortedUniqueBy(term.raw_variants, compareRawVariants, `${path} raw variants`);
    assertUniqueBy(term.raw_variants, rawVariantGroupKey, `${path} raw variant grouping key`);
    validateRateTerm(term, book, context, path);
  } else if (term.kind === "allowance") {
    assertSortedUnique(
      term.variants,
      (variant) => [
        canonicalJson([variant.benefit, variant.target, variant.reset]),
        ...optionalComponent(variant.validity),
        canonicalJson(variant.applicability),
      ],
      `${path} variants`,
    );
    assertUniqueBy(
      term.variants,
      (variant) =>
        canonicalJson([
          variant.benefit,
          variant.target,
          variant.reset,
          ...optionalComponent(variant.validity),
        ]),
      `${path} variant grouping key`,
    );
    assertSortedUniqueBy(term.raw_variants, compareRawVariants, `${path} raw variants`);
    assertUniqueBy(term.raw_variants, rawVariantGroupKey, `${path} raw variant grouping key`);
    validateAllowanceTerm(term, book, context, path);
  } else {
    assertSortedUniqueBy(term.variants, compareRawVariants, `${path} variants`);
    assertUniqueBy(term.variants, rawVariantGroupKey, `${path} raw variant grouping key`);
    term.variants.forEach((variant) => {
      if (variant.reason === "target_rate_not_normalized")
        fail(path, "target-rate fallback may appear only on an allowance");
      validateRawVariant(variant, book, context, path);
    });
    context.counts.variants += term.variants.length;
  }
}

function validateRateTerm(
  term: PriceRateTerm,
  book: PricingBook,
  context: ProviderValidation,
  path: string,
): void {
  context.counts.variants += term.variants.length + term.raw_variants.length;
  for (const variant of term.variants) {
    validateUnitExpression(variant.price.per, context, path);
    if (variant.price.denomination.kind === "provider_credit")
      validateOwnedAtom(
        "credit_denomination",
        {
          namespace: "provider",
          provider_id: variant.price.denomination.provider_id,
          value: variant.price.denomination.code,
        },
        undefined,
        context,
        path,
      );
    validateNormalizedVariant(variant, variant.observations, book, context, path, true);
  }
  term.raw_variants.forEach((variant) => {
    if (variant.impact !== "base_price") fail(path, "rate raw variant must affect base price");
    if (variant.reason === "target_rate_not_normalized")
      fail(path, "target-rate fallback may appear only on an allowance");
    validateRawVariant(variant, book, context, path);
  });
  validateVariantConflicts(term.variants, (variant) => canonicalJson(variant.price), path);
  validateTermRelationPairs(term.variants, context);
  validateConflictFallback(term.variants, term.raw_variants, path);
}

function validateAllowanceTerm(
  term: PriceAllowanceTerm,
  book: PricingBook,
  context: ProviderValidation,
  path: string,
): void {
  context.counts.variants += term.variants.length + term.raw_variants.length;
  for (const variant of term.variants) {
    if ((variant.benefit.kind === "usage") !== (variant.target.kind === "usage_rate_terms"))
      fail(path, "allowance benefit and target kinds do not match");
    if (variant.benefit.kind === "usage")
      validateUnitExpression(variant.benefit.quantity.unit, context, path);
    else if (variant.benefit.denomination.kind === "provider_credit")
      validateOwnedAtom(
        "credit_denomination",
        {
          namespace: "provider",
          provider_id: variant.benefit.denomination.provider_id,
          value: variant.benefit.denomination.code,
        },
        undefined,
        context,
        path,
      );
    validateOwnedAtom("allowance_reset", variant.reset, undefined, context, path);
    validateNormalizedVariant(variant, variant.observations, book, context, path, false);
  }
  term.raw_variants.forEach((variant) => {
    if (variant.impact !== "allowance") fail(path, "allowance raw variant has wrong impact");
    validateRawVariant(variant, book, context, path);
  });
  validateVariantConflicts(
    term.variants,
    (variant) => canonicalJson([variant.benefit, variant.target, variant.reset]),
    path,
  );
  validateTermRelationPairs(term.variants, context);
  validateConflictFallback(term.variants, term.raw_variants, path);
  if (
    term.raw_variants.some(({ reason }) => reason === "target_rate_not_normalized") &&
    term.variants.length > 0
  )
    fail(path, "target-rate fallback must cover the whole allowance term");
}

function validateConflictFallback(
  normalized: Array<{
    applicability: PriceApplicability;
    validity?: PublishedValidity | undefined;
  }>,
  raw: RawPricingVariant[],
  path: string,
): void {
  if (normalized.length === 0) return;
  for (const variant of raw) {
    if (variant.reason !== "conflicting_values") continue;
    const scope = variant.possible_scope;
    if (scope === undefined)
      fail(path, "localized conflicting-values fallback requires a possible scope");
    if (
      normalized.some(
        ({ applicability, validity }) =>
          applicabilitiesOverlap(applicability, scope) &&
          publishedValiditiesOverlap(validity, variant.validity),
      )
    )
      fail(path, "localized conflicting-values fallback overlaps a normalized value");
  }
}

function validateNormalizedVariant(
  variant: { applicability: PriceApplicability; validity?: PublishedValidity | undefined },
  observations: NormalizedPriceObservation[],
  book: PricingBook,
  context: ProviderValidation,
  path: string,
  allowCalculationEvidence: boolean,
): void {
  validateApplicability(variant.applicability, book, context, path);
  validateValidity(variant.validity, path);
  assertSortedUniqueBy(
    observations,
    (left, right) =>
      compareObservationBase(left, right) ||
      compareCanonicalValues(left.establishes_applicability, right.establishes_applicability) ||
      compareCanonicalValues(left.raw, right.raw),
    `${path} observations`,
  );
  context.counts.observations += observations.length;
  for (const observation of observations) {
    validateObservationBase(observation, context, path);
    if (!allowCalculationEvidence && observation.raw.formula !== undefined)
      fail(path, "calculation evidence belongs only to a normalized rate");
    validateApplicability(observation.establishes_applicability, book, context, path);
  }
  if (
    !canonicalValuesEqual(
      unionApplicabilities(observations.map((item) => item.establishes_applicability)),
      variant.applicability,
    )
  )
    fail(path, "observations do not exactly establish variant applicability");
}

function validateRawVariant(
  variant: RawPricingVariant,
  book: PricingBook,
  context: ProviderValidation,
  path: string,
): void {
  validateValidity(variant.validity, path);
  if (variant.possible_scope !== undefined)
    validateApplicability(variant.possible_scope, book, context, path);
  assertSortedUniqueBy(variant.observations, compareRawObservations, `${path} raw observations`);
  context.counts.observations += variant.observations.length;
  variant.observations.forEach((observation) =>
    validateObservationBase(observation, context, path),
  );
}

function validateOfferSemantics(
  offer: PricingOffer,
  context: ProviderValidation,
  path: string,
): void {
  const rates = offer.terms.flatMap((term) => (term.kind === "rate" ? term.variants : []));
  const baseRaw = offer.terms.flatMap(rawVariants).filter(({ impact }) => impact === "base_price");
  if (offer.states.length === 0 && baseRaw.length === 0)
    fail(path, "offer has neither a state nor a base-price raw fact");

  for (let left = 0; left < offer.states.length; left += 1) {
    for (let right = left + 1; right < offer.states.length; right += 1) {
      const first = offer.states[left]!;
      const second = offer.states[right]!;
      if (
        first.state !== second.state &&
        applicabilitiesOverlap(first.applicability, second.applicability) &&
        publishedValiditiesOverlap(first.validity, second.validity)
      )
        fail(path, "different offer states overlap");
    }
  }
  for (const state of offer.states) {
    for (const rate of rates) {
      context.relationPairs.push([state.applicability, rate.applicability]);
      if (
        state.state === "free" &&
        applicabilitiesOverlap(state.applicability, rate.applicability) &&
        publishedValiditiesOverlap(state.validity, rate.validity)
      )
        fail(path, "a free state overlaps a normalized rate");
    }
    for (const raw of baseRaw) {
      if (raw.possible_scope !== undefined)
        context.relationPairs.push([state.applicability, raw.possible_scope]);
    }
  }
  const numeric = {
    any_of: offer.states
      .filter(({ state }) => state === "numeric")
      .flatMap(({ applicability }) => applicability.any_of),
  };
  for (const rate of rates) {
    if (numeric.any_of.length === 0 || !applicabilityContainedIn(rate.applicability, numeric))
      fail(path, "rate is not contained in a numeric state");
  }
  for (const state of offer.states.filter(({ state }) => state === "numeric")) {
    const covered =
      rates.some(
        (rate) =>
          applicabilitiesOverlap(state.applicability, rate.applicability) &&
          publishedValiditiesOverlap(state.validity, rate.validity),
      ) ||
      baseRaw.some(
        (raw) =>
          raw.possible_scope === undefined ||
          (applicabilitiesOverlap(state.applicability, raw.possible_scope) &&
            publishedValiditiesOverlap(state.validity, raw.validity)),
      );
    if (!covered) fail(path, "numeric state has no possible charge coverage");
  }
}

function validateCompatibility(
  offer: Extract<PricingOffer, { role: "add_on" }>,
  book: PricingBook,
  context: ProviderValidation,
  path: string,
): void {
  assertSortedUniqueBy(
    offer.compatibility_observations,
    (left, right) =>
      compareObservationBase(left, right) ||
      compareCanonicalValues(left.establishes_offer_refs, right.establishes_offer_refs) ||
      compareCanonicalValues(left.raw, right.raw),
    `${path} compatibility observations`,
  );
  context.counts.observations += offer.compatibility_observations.length;
  const target =
    offer.compatibility.kind === "base_offers"
      ? offer.compatibility.offer_refs
      : offer.compatibility.kind === "all_base_offers_in_book"
        ? book.offers.filter(({ role }) => role === "base").map(({ id }) => id)
        : [];
  if (offer.compatibility.kind !== "not_normalized" && target.length === 0)
    fail(path, "normalized add-on compatibility has an empty target");
  const established = new Set<string>();
  for (const observation of offer.compatibility_observations) {
    validateObservationBase(observation, context, path);
    assertSortedUnique(
      observation.establishes_offer_refs,
      (offerRef) => [offerRef],
      `${path} established offer refs`,
    );
    if (
      offer.compatibility.kind === "not_normalized" &&
      observation.establishes_offer_refs.length > 0
    )
      fail(path, "not-normalized compatibility establishes an offer ref");
    if (
      offer.compatibility.kind !== "not_normalized" &&
      observation.establishes_offer_refs.length === 0
    )
      fail(path, "normalized compatibility observation has an empty target");
    for (const offerRef of observation.establishes_offer_refs) {
      if (!target.includes(offerRef)) fail(path, "compatibility evidence exceeds its target");
      established.add(offerRef);
    }
  }
  if (!setEquals(established, new Set(target)))
    fail(path, "compatibility evidence does not exactly cover its target");
}

function validateProviderLinks(context: ProviderValidation): void {
  for (const offer of context.offers.values()) {
    if (offer.role === "add_on" && offer.compatibility.kind === "base_offers") {
      assertSortedUnique(
        offer.compatibility.offer_refs,
        (offerRef) => [offerRef],
        `offer ${offer.offer_key} compatibility refs`,
      );
      for (const offerRef of offer.compatibility.offer_refs) {
        const target = context.offers.get(offerRef);
        if (target === undefined || target.role !== "base" || target.id === offer.id)
          fail(`offer ${offer.offer_key}`, "compatibility target is not a provider base offer");
      }
    }

    for (const term of offer.terms) {
      if (term.kind === "allowance")
        term.variants.forEach((variant) =>
          validateAllowanceTarget(variant, offer, context, `term ${term.term_key}`),
        );
      if (term.term_key === "kmodels.offer-state")
        validateReservedStateTerm(term, offer, `term ${term.term_key}`);
    }
  }
}

function validateAllowanceTarget(
  variant: PriceAllowanceTerm["variants"][number],
  offer: PricingOffer,
  context: ProviderValidation,
  path: string,
): void {
  if (variant.target.kind !== "usage_rate_terms" || variant.benefit.kind !== "usage") return;
  const allowanceUnit = canonicalJson(variant.benefit.quantity.unit);
  assertSortedUnique(
    variant.target.term_refs,
    (termRef) => [termRef],
    `${path} allowance target refs`,
  );
  for (const termRef of variant.target.term_refs) {
    const target = context.terms.get(termRef);
    if (
      target === undefined ||
      target.offer.id !== offer.id ||
      target.term.kind !== "rate" ||
      target.term.variants.length === 0 ||
      target.term.raw_variants.length > 0
    )
      fail(path, "usage allowance target is not an exact normalized rate term");
    if (target.term.variants.some(({ price }) => canonicalJson(price.per) !== allowanceUnit))
      fail(path, "usage allowance unit differs from its target rate");
  }
}

function validateReservedStateTerm(term: PricingTerm, offer: PricingOffer, path: string): void {
  if (
    term.kind !== "raw" ||
    offer.states.length > 0 ||
    offer.terms.some((candidate) => candidate.kind === "rate" && candidate.variants.length > 0) ||
    term.variants.some(
      ({ impact, reason }) =>
        impact !== "base_price" || !["conflicting_values", "selector_limit"].includes(reason),
    )
  )
    fail(path, "reserved offer-state fallback has an invalid shape");
  const observationRefs = [
    ...new Set(
      term.variants.flatMap(({ observations }) => observations.map(({ source_ref }) => source_ref)),
    ),
  ].sort(compareUtf8);
  if (canonicalJson(observationRefs) !== canonicalJson(term.source_refs))
    fail(path, "reserved offer-state source refs do not match its observations");
}

function validateDisposition(
  disposition: ModelPricingDisposition,
  context: ProviderValidation,
): void {
  const path = `disposition ${disposition.model_ref}`;
  assertSemantic(disposition.model_ref, `${path} model ref`);
  if (context.modelRefs.has(disposition.model_ref))
    fail(path, "not-applicable model occurs in a positive book scope");
  ownedModel(context.core, disposition.model_ref);
  assertSortedUniqueBy(
    disposition.observations,
    (left, right) =>
      compareObservationBase(left, right) ||
      compareUtf8(left.establishes_model_ref, right.establishes_model_ref) ||
      compareCanonicalValues(left.raw, right.raw),
    `${path} observations`,
  );
  context.counts.observations += disposition.observations.length;
  for (const observation of disposition.observations) {
    validateObservationBase(observation, context, path);
    if (observation.establishes_model_ref !== disposition.model_ref)
      fail(path, "disposition observation establishes another model");
  }
}

function validateApplicability(
  applicability: PriceApplicability,
  book: PricingBook | undefined,
  context: ProviderValidation,
  path: string,
): void {
  const source = jsonSource(applicability);
  const knownBytes = context.applicabilityBytesBySource.get(source);
  const bytes = knownBytes ?? Buffer.byteLength(source);
  if (bytes > pricingLimits.applicabilityBytes) fail(path, "applicability byte limit exceeded");
  context.applicabilityBytes += bytes;
  if (knownBytes === undefined) {
    if (!canonicalValuesEqual(canonicalizeApplicability(applicability), applicability))
      fail(path, "applicability is not canonical");
    context.applicabilityBytesBySource.set(source, bytes);
  }
  for (const clause of applicability.any_of)
    for (const condition of clause.all_of) validateCondition(condition, book, context, path);
}

function validateCondition(
  condition: PriceCondition,
  book: PricingBook | undefined,
  context: ProviderValidation,
  path: string,
): void {
  const dimension = condition.dimension;
  if (dimension.namespace === "provider")
    validateOwnedAtom("dimension", dimension, undefined, context, path);
  const unit = condition.kind === "decimal_range" ? canonicalJson(condition.unit) : undefined;
  const dimensionKey = canonicalJson(dimension);
  const previous = context.dimensions.get(dimensionKey);
  if (previous !== undefined && (previous.kind !== condition.kind || previous.unit !== unit))
    fail(path, "provider dimension changes predicate kind or unit");
  context.dimensions.set(dimensionKey, {
    kind: condition.kind,
    ...(unit === undefined ? {} : { unit }),
  });

  if (dimension.namespace === "kmodels") {
    const expected = standardDimensionKind(dimension.value);
    if (condition.kind !== expected) fail(path, "standard dimension uses the wrong predicate kind");
    if (condition.kind === "decimal_range") {
      const expectedUnit = dimension.value.endsWith("_tokens") ? "token" : "second";
      if (!isSingleStandardUnit(condition.unit, expectedUnit))
        fail(path, "standard decimal dimension uses the wrong unit");
    } else if (condition.kind === "categorical") {
      for (const value of condition.values) {
        if (dimension.value === "model") {
          if (
            value.namespace !== "kmodels" ||
            book === undefined ||
            !book.scope.model_refs.includes(value.value)
          )
            fail(path, "standard model condition is not an exact in-scope core ref");
        } else {
          if (value.namespace !== "provider")
            fail(path, "non-model standard categorical value must be provider-qualified");
          validateOwnedAtom("categorical_value", value, dimension, context, path);
        }
      }
    }
  } else if (condition.kind === "categorical") {
    condition.values.forEach((value) => {
      if (value.namespace !== "provider")
        fail(path, "provider categorical value must be provider-qualified");
      validateOwnedAtom("categorical_value", value, dimension, context, path);
    });
  } else if (condition.kind === "decimal_range") {
    validateUnitExpression(condition.unit, context, path);
  }
}

function validateUnitExpression(
  expression: UnitExpression,
  context: ProviderValidation,
  path: string,
): void {
  if (canonicalJson(normalizeUnitExpression(expression)) !== canonicalJson(expression))
    fail(path, "unit expression is not canonical");
  for (const factor of expression.factors)
    validateOwnedAtom("unit", factor.unit, undefined, context, path);
}

function validateOwnedAtom(
  kind: ProviderAtomRegistryEntry["kind"],
  atom: { namespace: string; provider_id?: string; value: string },
  dimension: PriceDimension | undefined,
  context: ProviderValidation,
  path: string,
): void {
  if (atom.namespace === "kmodels") return;
  if (atom.provider_id !== context.providerId) fail(path, `${kind} atom has the wrong provider`);
  assertNormalizedSemantic(atom.value, `${path} ${kind} atom`);
  if (!context.atoms.has(atomIdentity(context.providerId, kind, dimension, atom.value)))
    fail(path, `unknown provider ${kind} atom`);
}

function validateObservationBase(
  observation: { source_ref: string; locator: { value: string }; raw: RawPriceFact },
  context: ProviderValidation,
  path: string,
): void {
  if (ownedSource(context.core, observation.source_ref).provider_id !== context.providerId)
    fail(path, "observation source belongs to another provider");
  assertSemantic(observation.source_ref, `${path} source ref`);
  assertProvenance(observation.locator.value, `${path} locator`);
  if (jsonByteLength(observation.raw) > pricingLimits.rawFactBytes)
    fail(path, "raw price fact exceeds byte limit");
}

function validateValidity(validity: PublishedValidity | undefined, path: string): void {
  if (validity !== undefined && !publishedValidityIsCoherent(validity.from, validity.until))
    fail(path, "published validity is provably reversed or empty");
}

function validateVariantConflicts<
  T extends {
    applicability: PriceApplicability;
    validity?: PublishedValidity | undefined;
  },
>(variants: T[], payload: (variant: T) => string, path: string): void {
  const payloads = variants.map(payload);
  for (let left = 0; left < variants.length; left += 1)
    for (let right = left + 1; right < variants.length; right += 1)
      if (
        payloads[left] !== payloads[right] &&
        applicabilitiesOverlap(variants[left]!.applicability, variants[right]!.applicability) &&
        publishedValiditiesOverlap(variants[left]!.validity, variants[right]!.validity)
      )
        fail(path, "overlapping normalized variants have unequal values");
}

function validateTermRelationPairs<T extends { applicability: PriceApplicability }>(
  variants: T[],
  context: ProviderValidation,
): void {
  for (let left = 0; left < variants.length; left += 1)
    for (let right = left + 1; right < variants.length; right += 1)
      context.relationPairs.push([variants[left]!.applicability, variants[right]!.applicability]);
}

function validateProviderTotals(
  books: PricingBook[],
  dispositions: ModelPricingDisposition[],
  observedAt: string,
  context: ProviderValidation,
): void {
  if (context.counts.offers > pricingLimits.offersPerProvider)
    fail(context.providerId, "offer count exceeds provider limit");
  if (context.counts.terms > pricingLimits.termsPerProvider)
    fail(context.providerId, "term count exceeds provider limit");
  if (context.counts.variants > pricingLimits.variantsPerProvider)
    fail(context.providerId, "variant count exceeds provider limit");
  if (context.counts.observations > pricingLimits.observationsPerProvider)
    fail(context.providerId, "observation count exceeds provider limit");
  if (context.applicabilityBytes > pricingLimits.providerApplicabilityBytes)
    fail(context.providerId, "provider applicability byte limit exceeded");
  let relationWork = 0;
  for (const [left, right] of context.relationPairs) {
    relationWork += selectorWeight(left) * selectorWeight(right);
    if (relationWork > pricingLimits.providerSelectorWork)
      fail(context.providerId, "selector relation-work limit exceeded");
  }
  const partition = {
    provider_vocabulary: context.vocabulary,
    provider_snapshot: {
      provider_id: context.providerId,
      observed_at: observedAt,
      publication: "retained",
      refresh_failure: {
        attempted_at: observedAt,
        code: "pricing_validation_failed",
      },
    },
    model_dispositions: dispositions,
    books,
  };
  if (jsonByteLength(partition) > pricingLimits.providerPricingBytes)
    fail(context.providerId, "provider pricing byte limit exceeded");
}

function indexCore(core: Core): CoreIndex {
  return {
    providers: uniqueMap(core.providers, ({ id }) => id, "core provider ID"),
    models: uniqueMap(core.models, ({ uid }) => uid, "core model UID"),
    sources: uniqueMap(core.sources, ({ id }) => id, "core source ID"),
  };
}

function ownedModel(core: CoreIndex, modelRef: string): Core["models"][number] {
  const model = core.models.get(modelRef);
  if (model === undefined) fail(modelRef, "model ref does not resolve");
  return model;
}

function ownedSource(core: CoreIndex, sourceRef: string): Core["sources"][number] {
  const source = core.sources.get(sourceRef);
  if (source === undefined) fail(sourceRef, "source ref does not resolve");
  return source;
}

function assertSourceRefs(sourceRefs: string[], context: ProviderValidation, path: string): void {
  assertSortedUnique(sourceRefs, (sourceRef) => [sourceRef], `${path} source refs`);
  for (const sourceRef of sourceRefs) {
    assertSemantic(sourceRef, `${path} source ref`);
    if (ownedSource(context.core, sourceRef).provider_id !== context.providerId)
      fail(path, "resource source ref belongs to another provider");
  }
}

function rawVariants(term: PricingTerm): RawPricingVariant[] {
  return term.kind === "raw" ? term.variants : term.raw_variants;
}

function compareRawVariants(left: RawPricingVariant, right: RawPricingVariant): number {
  return (
    compareUtf8(left.impact, right.impact) ||
    compareUtf8(left.reason, right.reason) ||
    compareOptionalCanonical(left.possible_scope, right.possible_scope) ||
    compareOptionalCanonical(left.validity, right.validity) ||
    compareCanonicalValues(left.observations, right.observations)
  );
}

function rawVariantGroupKey(variant: RawPricingVariant): string {
  return canonicalJson([
    variant.impact,
    variant.reason,
    ...optionalComponent(variant.possible_scope),
    ...optionalComponent(variant.validity),
  ]);
}

function standardDimensionKind(
  dimension: Extract<PriceDimension, { namespace: "kmodels" }>["value"],
): PriceCondition["kind"] {
  if (["request_audio", "voice_control", "video_input", "promotion"].includes(dimension))
    return "boolean";
  if (
    [
      "cache_ttl_seconds",
      "duration_seconds",
      "context_tokens",
      "input_tokens",
      "output_tokens",
    ].includes(dimension)
  )
    return "decimal_range";
  return "categorical";
}

function isSingleStandardUnit(expression: UnitExpression, value: "token" | "second"): boolean {
  return (
    expression.factors.length === 1 &&
    expression.factors[0]?.power === 1 &&
    expression.factors[0].unit.namespace === "kmodels" &&
    expression.factors[0].unit.value === value
  );
}

function atomIdentity(
  providerId: string,
  kind: ProviderAtomRegistryEntry["kind"],
  dimension: PriceDimension | undefined,
  value: string,
): string {
  return JSON.stringify([
    providerId,
    kind,
    dimension === undefined ? null : canonicalJsonKey(dimension),
    value,
  ]);
}

function optionalComponent(value: unknown): string[] {
  return value === undefined ? ["0"] : ["1", canonicalJson(value)];
}

function compareOptionalCanonical(left: unknown, right: unknown): number {
  if (left === undefined || right === undefined) {
    if (left === right) return 0;
    return left === undefined ? -1 : 1;
  }
  return compareCanonicalValues(left, right);
}

function compareObservationBase(
  left: { source_ref: string; locator: { kind: string; value: string } },
  right: { source_ref: string; locator: { kind: string; value: string } },
): number {
  return (
    compareUtf8(left.source_ref, right.source_ref) ||
    compareCanonicalValues(left.locator, right.locator)
  );
}

function compareRawObservations(
  left: NormalizedPriceObservation,
  right: NormalizedPriceObservation,
): number;
function compareRawObservations(
  left: RawPricingVariant["observations"][number],
  right: RawPricingVariant["observations"][number],
): number;
function compareRawObservations(
  left: RawPricingVariant["observations"][number],
  right: RawPricingVariant["observations"][number],
): number {
  return compareObservationBase(left, right) || compareCanonicalValues(left.raw, right.raw);
}

function jsonByteLength(value: unknown): number {
  // Canonical key ordering changes byte order, not the encoded byte count.
  return Buffer.byteLength(jsonSource(value));
}

function jsonSource(value: unknown): string {
  const source = JSON.stringify(value);
  if (source === undefined) throw new Error("Value is not valid JSON");
  return source;
}

function assertSortedUnique<T>(values: T[], key: (value: T) => SortKey, path: string): void {
  if (values.length < 2) return;
  let previous = key(values[0]!);
  for (let index = 1; index < values.length; index += 1) {
    const current = key(values[index]!);
    const comparison = compareUtf8Sequences(previous, current);
    if (comparison >= 0) fail(path, comparison === 0 ? "contains a duplicate" : "is not sorted");
    previous = current;
  }
}

function assertSortedUniqueBy<T>(
  values: T[],
  compare: (left: T, right: T) => number,
  path: string,
): void {
  for (let index = 1; index < values.length; index += 1) {
    const comparison = compare(values[index - 1]!, values[index]!);
    if (comparison >= 0) fail(path, comparison === 0 ? "contains a duplicate" : "is not sorted");
  }
}

function assertUniqueBy<T>(values: T[], key: (value: T) => string, path: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    const identity = key(value);
    if (seen.has(identity)) fail(path, "contains a duplicate");
    seen.add(identity);
  }
}

function uniqueMap<T>(values: T[], key: (value: T) => string, path: string): Map<string, T> {
  const result = new Map<string, T>();
  for (const value of values) {
    const identity = key(value);
    if (result.has(identity)) fail(path, `duplicate identity ${identity}`);
    result.set(identity, value);
  }
  return result;
}

function addUniqueId(ids: Set<string>, id: string, path: string): void {
  if (ids.has(id)) fail(path, "resource ID is not globally unique");
  ids.add(id);
}

function assertSemantic(value: string, path: string): void {
  if (value.length === 0 || Buffer.byteLength(value) > pricingLimits.semanticStringBytes)
    fail(path, "semantic string is empty or exceeds its byte limit");
}

function assertNormalizedSemantic(value: string, path: string): void {
  assertSemantic(value, path);
  if (value.normalize("NFC") !== value) fail(path, "semantic string is not NFC");
}

function assertProvenance(value: string, path: string): void {
  if (Buffer.byteLength(value) > pricingLimits.provenanceStringBytes)
    fail(path, "provenance string exceeds its byte limit");
}

function assertReviewedText(value: string, path: string): void {
  assertNormalizedSemantic(value, path);
  if (/^\p{White_Space}*$/u.test(value)) fail(path, "reviewed text is blank");
}

function setEquals<T>(left: Set<T>, right: Set<T>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function fail(path: string, message: string): never {
  throw new Error(`${path}: ${message}`);
}
