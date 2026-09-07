import { standardDimensionKind } from "./pricing-dimension-kind.ts";
import { standardUsageSignalUnit } from "./pricing-signal-unit.ts";
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
import {
  requiredUsageSignals,
  requiredUsageSignalsForMethod,
  validateUsageQuantityCalculation,
} from "./pricing-calculation.ts";
import { pricingBookId, pricingOfferId, pricingTermId } from "./pricing-identifiers.ts";
import {
  type ModelPricingDisposition,
  type NormalizedPriceObservation,
  type PriceAllowanceTerm,
  type PriceApplicability,
  type PriceCondition,
  type PriceContributionTerm,
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
  type UsageQuantityCalculation,
  type UsageSignal,
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
  books: Map<string, PricingBook>;
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
    books: new Map(),
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
  for (const atom of vocabulary.atoms) {
    assertNormalizedSemantic(atom.key, "provider atom key");
    assertReviewedText(atom.definition, "provider atom definition");
    if (atom.kind === "categorical_value" && atom.label !== undefined)
      assertReviewedText(atom.label, "provider atom label");
    if (
      atom.kind === "categorical_value" &&
      atom.dimension.namespace === "provider" &&
      atom.dimension.provider_id !== vocabulary.provider_id
    )
      fail("vocabulary", "categorical atom dimension belongs to another provider");
    const dimension = atom.kind === "categorical_value" ? atom.dimension : undefined;
    const key = atomIdentity(vocabulary.provider_id, atom.kind, dimension, atom.key);
    if (atoms.has(key)) fail("vocabulary", "duplicate provider atom key");
    atoms.set(key, atom);
  }
  validateRecurringTimeSchedules(vocabulary);
  return atoms;
}

function validateRecurringTimeSchedules(vocabulary: ProviderPricingVocabulary): void {
  const groups = new Map<
    string,
    Array<Extract<ProviderAtomRegistryEntry, { kind: "categorical_value" }>>
  >();
  for (const atom of vocabulary.atoms) {
    if (atom.kind !== "categorical_value" || atom.schedule === undefined) continue;
    const key = canonicalJsonKey(atom.dimension);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [atom]);
    else group.push(atom);
  }
  for (const scheduled of groups.values()) {
    const recurrences = new Set(
      scheduled.map(({ schedule }) =>
        schedule?.kind.startsWith("weekly_") === true ? "weekly" : "daily",
      ),
    );
    if (recurrences.size !== 1)
      fail("vocabulary", "a recurring categorical schedule cannot mix daily and weekly rules");
    const recurrence = [...recurrences][0];
    const remainderKind =
      recurrence === "weekly" ? "weekly_time_remainder" : "daily_time_remainder";
    const windowKind = recurrence === "weekly" ? "weekly_time_windows" : "daily_time_windows";
    const remainders = scheduled.filter(({ schedule }) => schedule?.kind === remainderKind);
    const windowAtoms = scheduled.filter(({ schedule }) => schedule?.kind === windowKind);
    if (remainders.length !== 1 || windowAtoms.length === 0)
      fail(
        "vocabulary",
        "a recurring categorical schedule requires window values and one remainder value",
      );
    const windows = windowAtoms
      .flatMap((atom) => {
        if (atom.schedule?.kind === "weekly_time_windows") {
          const { days, windows: weeklyWindows } = atom.schedule;
          return days.flatMap((day) =>
            weeklyWindows.map((window) => ({ ...window, atom: atom.key, day })),
          );
        }
        return atom.schedule?.kind === "daily_time_windows"
          ? atom.schedule.windows.map((window) => ({ ...window, atom: atom.key, day: "daily" }))
          : [];
      })
      .sort(
        (left, right) =>
          compareUtf8(left.day, right.day) ||
          compareUtf8(left.from, right.from) ||
          compareUtf8(left.until, right.until),
      );
    for (let index = 1; index < windows.length; index += 1) {
      const previous = windows[index - 1];
      const current = windows[index];
      if (
        previous !== undefined &&
        current !== undefined &&
        previous.day === current.day &&
        previous.until > current.from
      )
        fail(
          "vocabulary",
          `recurring categorical schedules ${previous.atom} and ${current.atom} overlap`,
        );
    }
  }
}

function validateBook(book: PricingBook, context: ProviderValidation, ids: Set<string>): void {
  const path = `book ${book.book_key}`;
  assertSemantic(book.provider_id, `${path} provider ID`);
  assertNormalizedSemantic(book.book_key, `${path} key`);
  if (book.name !== undefined) assertReviewedText(book.name, `${path} name`);
  if (book.id !== pricingBookId(book.provider_id, book.book_key)) fail(path, "ID recipe mismatch");
  addUniqueId(ids, book.id, path);
  if (context.books.has(book.id)) fail(path, "duplicate book ID");
  context.books.set(book.id, book);
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
  if (book.scope.kind === "provider_resource") {
    assertNormalizedSemantic(book.scope.resource_key, `${path} resource key`);
    validateOwnedAtom("resource_kind", book.scope.resource_kind, undefined, context, path);
  }

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
      (book.scope.kind === "provider_resource" &&
        (observation.establishes.kind !== "provider_resource" ||
          canonicalJson(observation.establishes.resource_kind) !==
            canonicalJson(book.scope.resource_kind) ||
          observation.establishes.resource_key !== book.scope.resource_key))
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
  assertSortedUniqueBy(
    book.resource_edges,
    (left, right) => compareCanonicalValues(left, right),
    `${path} resource edges`,
  );
  for (const edge of book.resource_edges) {
    validateApplicability(edge.applicability, book, context, `${path} resource edge`);
    validateValidity(edge.validity, `${path} resource edge`);
    assertSortedUniqueBy(edge.observations, compareRawObservations, `${path} edge observations`);
    context.counts.observations += edge.observations.length;
    edge.observations.forEach((observation) =>
      validateObservationBase(observation, context, `${path} resource edge`),
    );
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
  if (offer.model_refs !== undefined) {
    assertSortedUnique(offer.model_refs, (modelRef) => [modelRef], `${path} model refs`);
    if (canonicalJson(offer.model_refs) === canonicalJson(book.scope.model_refs))
      fail(path, "offer repeats its complete book model scope");
    for (const modelRef of offer.model_refs) {
      assertSemantic(modelRef, `${path} model ref`);
      if (!book.scope.model_refs.includes(modelRef))
        fail(path, "offer references a model outside its book scope");
    }
  }
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
  assertBoundedApplicabilityGroups(
    offer.states,
    (state) => canonicalJson([state.state, ...optionalComponent(state.validity)]),
    `${path} state grouping key`,
  );
  assertSortedUnique(offer.terms, ({ id }) => [id], `${path} terms`);

  assertSortedUnique(
    offer.enrollment,
    (variant) => [
      variant.state,
      ...optionalComponent(variant.validity),
      canonicalJson(variant.applicability),
    ],
    `${path} enrollment`,
  );
  offer.enrollment.forEach((variant) =>
    validateNormalizedVariant(
      variant,
      variant.observations,
      book,
      context,
      `${path} enrollment`,
      false,
    ),
  );
  assertSortedUniqueBy(
    offer.settlement,
    (left, right) => compareCanonicalValues(left, right),
    `${path} settlement`,
  );
  for (const variant of offer.settlement) {
    assertReviewedText(variant.biller, `${path} settlement biller`);
    validateNormalizedVariant(
      variant,
      variant.observations,
      book,
      context,
      `${path} settlement`,
      false,
    );
  }

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
      if (offer.states[left]!.state !== offer.states[right]!.state)
        context.relationPairs.push([
          offer.states[left]!.applicability,
          offer.states[right]!.applicability,
        ]);

  validateOfferSemantics(offer, context, path);
  validateOfferRelations(offer, book, context, path);
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
  if (term.id !== pricingTermId(offer.id, term.kind, term.term_key))
    fail(path, "ID recipe mismatch");
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
    assertBoundedApplicabilityGroups(
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
    assertBoundedApplicabilityGroups(
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
  } else if (term.kind === "contribution") {
    assertSortedUniqueBy(term.variants, compareContributionVariants, `${path} variants`);
    assertSortedUniqueBy(term.raw_variants, compareRawVariants, `${path} raw variants`);
    validateContributionTerm(term, book, context, path);
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
    if (variant.charge_binding !== undefined)
      validateChargeBinding(variant.charge_binding, context, path, variant.price.per);
    validateRateSelectorSources(variant, context, path);
  }
  term.raw_variants.forEach((variant) => {
    if (
      variant.impact !== "base_price" &&
      !(variant.impact === "informational" && variant.reason === "superseded_value")
    )
      fail(path, "rate raw variant has invalid impact");
    if (variant.reason === "target_rate_not_normalized")
      fail(path, "target-rate fallback may appear only on an allowance");
    validateRawVariant(variant, book, context, path);
  });
  validateVariantConflicts(term.variants, (variant) => canonicalJson(variant.price), path);
  validateTermRelationPairs(term.variants, (variant) => canonicalJson(variant.price), context);
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
    if (variant.benefit.kind === "quantity")
      validateUnitExpression(variant.benefit.quantity.unit, context, path);
    else if (
      variant.benefit.kind === "credit" &&
      variant.benefit.denomination.kind === "provider_credit"
    )
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
  validateTermRelationPairs(
    term.variants,
    (variant) => canonicalJson([variant.benefit, variant.target, variant.reset]),
    context,
  );
  validateConflictFallback(term.variants, term.raw_variants, path);
  if (
    term.raw_variants.some(({ reason }) => reason === "target_rate_not_normalized") &&
    term.variants.length > 0
  )
    fail(path, "target-rate fallback must cover the whole allowance term");
}

function validateContributionTerm(
  term: PriceContributionTerm,
  book: PricingBook,
  context: ProviderValidation,
  path: string,
): void {
  context.counts.variants += term.variants.length + term.raw_variants.length;
  for (const variant of term.variants) {
    assertSortedUnique(variant.target_rate_refs, (ref) => [ref], `${path} target rate refs`);
    assertSortedUniqueBy(
      variant.charge_bindings,
      (left, right) => compareCanonicalValues(left, right),
      `${path} contribution bindings`,
    );
    validateNormalizedVariant(variant, variant.observations, book, context, path, false);
    variant.charge_bindings.forEach((binding) => validateChargeBinding(binding, context, path));
  }
  term.raw_variants.forEach((variant) => validateRawVariant(variant, book, context, path));
  validateVariantConflicts(
    term.variants,
    (variant) => canonicalJson([variant.target_rate_refs, variant.charge_bindings]),
    path,
  );
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
  if (
    (variant.reason === "superseded_value") !== (variant.resolution_policy !== undefined) ||
    (variant.reason === "superseded_value" && variant.impact !== "informational")
  )
    fail(path, "superseded raw variant has invalid resolution metadata");
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
      if (state.state === "free")
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

function validateOfferRelations(
  offer: PricingOffer,
  book: PricingBook,
  context: ProviderValidation,
  path: string,
): void {
  assertSortedUnique(
    offer.relations,
    (relation) => [
      relation.kind,
      canonicalJson(relation.target),
      ...optionalComponent(relation.validity),
      canonicalJson(relation.applicability),
    ],
    `${path} relations`,
  );
  for (const relation of offer.relations) {
    validateApplicability(relation.applicability, book, context, path);
    validateValidity(relation.validity, path);
    assertSortedUniqueBy(
      relation.observations,
      (left, right) =>
        compareObservationBase(left, right) ||
        compareCanonicalValues(left.establishes_offer_refs, right.establishes_offer_refs) ||
        compareCanonicalValues(left.establishes_book_refs, right.establishes_book_refs) ||
        compareCanonicalValues(left.raw, right.raw),
      `${path} relation observations`,
    );
    context.counts.observations += relation.observations.length;
    const targetOffers = relation.target.offer_refs;
    const establishedOffers = new Set<string>();
    const establishedBooks = new Set<string>();
    for (const observation of relation.observations) {
      validateObservationBase(observation, context, path);
      assertSortedUnique(
        observation.establishes_offer_refs,
        (offerRef) => [offerRef],
        `${path} established offer refs`,
      );
      assertSortedUnique(
        observation.establishes_book_refs,
        (bookRef) => [bookRef],
        `${path} established book refs`,
      );
      for (const offerRef of observation.establishes_offer_refs) {
        if (!targetOffers.includes(offerRef))
          fail(path, "relation evidence exceeds its offer target");
        establishedOffers.add(offerRef);
      }
      if (observation.establishes_book_refs.length > 0)
        fail(path, "offer relation evidence cannot establish book targets");
    }
    if (!setEquals(establishedOffers, new Set(targetOffers)) || establishedBooks.size > 0)
      fail(path, "relation evidence does not exactly cover its target");
  }
}

function validateChargeBinding(
  binding: NonNullable<PriceRateTerm["variants"][number]["charge_binding"]>,
  context: ProviderValidation,
  path: string,
  expectedUnit?: UnitExpression,
): void {
  validateOwnedAtom("usage_signal", binding.signal, undefined, context, path);
  const signalUnit = usageSignalUnit(binding.signal, context, path);
  validateUnitExpression(signalUnit, context, path);
  if (expectedUnit !== undefined && canonicalJson(signalUnit) !== canonicalJson(expectedUnit))
    fail(path, "charge signal unit differs from the rate denominator");
  for (const input of requiredUsageSignals(binding)) {
    validateOwnedAtom("usage_signal", input, undefined, context, path);
    const inputUnit = usageSignalUnit(input, context, path);
    validateUnitExpression(inputUnit, context, path);
  }
  if (binding.quantity_methods !== undefined) {
    assertSortedUniqueBy(
      binding.quantity_methods,
      compareCanonicalValues,
      `${path} quantity methods`,
    );
    for (const method of binding.quantity_methods) {
      if (method.calculation !== undefined)
        try {
          validateUsageQuantityCalculation(method.calculation);
          validateCalculationUnit(method.calculation, signalUnit, context, path);
        } catch (error) {
          fail(path, error instanceof Error ? error.message : "Invalid quantity calculation");
        }
      if (method.input_sources === undefined) continue;
      assertSortedUniqueBy(
        method.input_sources,
        compareCanonicalValues,
        `${path} usage input sources`,
      );
      const required = new Set(
        requiredUsageSignalsForMethod(binding, method).map((signal) => canonicalJson(signal)),
      );
      const covered = new Set<string>();
      for (const source of method.input_sources) {
        validateOwnedAtom("usage_signal", source.signal, undefined, context, path);
        validateInputLocator(source, `${path} usage input`);
        const key = canonicalJson(source.signal);
        if (!required.has(key)) fail(path, "usage input source does not belong to the method");
        covered.add(key);
      }
      if (covered.size !== required.size)
        fail(path, "usage input sources do not cover every method input");
    }
  }
  if (typeof binding.aggregation !== "string")
    validateOwnedAtom("aggregation", binding.aggregation, undefined, context, path);
  assertSortedUniqueBy(binding.observations, compareRawObservations, `${path} charge observations`);
  context.counts.observations += binding.observations.length;
  for (const observation of binding.observations)
    validateObservationBase(observation, context, path);
}

function validateCalculationUnit(
  calculation: UsageQuantityCalculation,
  outputUnit: UnitExpression,
  context: ProviderValidation,
  path: string,
): void {
  const units: UnitExpression[] = [];
  const unitAt = (index: number): UnitExpression => {
    const unit = units[index];
    if (unit === undefined) fail(path, "quantity calculation unit reference is out of range");
    return unit;
  };
  const sameUnit = (indexes: readonly number[]): UnitExpression => {
    const first = unitAt(indexes[0]!);
    if (indexes.some((index) => canonicalJson(unitAt(index)) !== canonicalJson(first)))
      fail(path, "quantity calculation combines incompatible units");
    return first;
  };
  for (const node of calculation.nodes) {
    const unit = (() => {
      switch (node.op) {
        case "constant":
          validateUnitExpression(node.unit, context, path);
          return node.unit;
        case "signal":
          return usageSignalUnit(node.signal, context, path);
        case "sum":
          return sameUnit(node.inputs);
        case "product": {
          const values = node.inputs.map(unitAt);
          const quantities = values.filter((value) => !isSingleStandardUnit(value, "item"));
          if (quantities.length !== 1)
            fail(path, "quantity product requires one quantity and one or more item counts");
          return quantities[0]!;
        }
        case "subtract_floor_zero":
          return sameUnit([node.minuend, node.subtrahend]);
        case "multiply":
        case "minimum":
        case "round_up":
          return unitAt(node.input);
      }
    })();
    units.push(unit);
  }
  if (canonicalJson(unitAt(calculation.result)) !== canonicalJson(outputUnit))
    fail(path, "quantity calculation result unit differs from its output signal");
}

function validateRateSelectorSources(
  variant: PriceRateTerm["variants"][number],
  context: ProviderValidation,
  path: string,
): void {
  if (variant.selector_sources === undefined) return;
  assertSortedUniqueBy(
    variant.selector_sources,
    compareCanonicalValues,
    `${path} selector sources`,
  );
  const dimensions = new Set(
    variant.applicability.any_of.flatMap(({ all_of }) =>
      all_of.map(({ dimension }) => canonicalJson(dimension)),
    ),
  );
  for (const source of variant.selector_sources) {
    const dimensionKey = canonicalJson(source.dimension);
    if (!dimensions.has(dimensionKey))
      fail(path, "selector source dimension is absent from applicability");
    validateOwnedAtom("dimension", source.dimension, undefined, context, path);
    validateInputLocator(source, `${path} selector input`);
    const allowedValues = new Set(
      variant.applicability.any_of.flatMap(({ all_of }) =>
        all_of.flatMap((condition) =>
          condition.kind === "categorical" && canonicalJson(condition.dimension) === dimensionKey
            ? condition.values.map((value) => canonicalJson(value))
            : [],
        ),
      ),
    );
    if (source.absent_value !== undefined && !allowedValues.has(canonicalJson(source.absent_value)))
      fail(path, "selector absent value is absent from applicability");
    if (source.normalization !== undefined) {
      if (allowedValues.size === 0)
        fail(path, "categorical selector normalization requires a categorical condition");
      assertSortedUnique(
        source.normalization.entries,
        ({ source_value }) => [source_value],
        `${path} selector normalization entries`,
      );
      for (const { value } of source.normalization.entries)
        if (!allowedValues.has(canonicalJson(value)))
          fail(path, "selector normalization value is absent from applicability");
    }
    assertSortedUniqueBy(
      source.observations,
      compareRawObservations,
      `${path} selector source observations`,
    );
    context.counts.observations += source.observations.length;
    for (const observation of source.observations)
      validateObservationBase(observation, context, path);
  }
}

function validateInputLocator(
  input: {
    channel: string;
    locator: { kind: string; value: string; convention_version?: string | undefined };
  },
  path: string,
): void {
  assertProvenance(input.locator.value, `${path} locator`);
  if (input.locator.kind === "otel_attribute") {
    if (input.locator.convention_version === undefined)
      fail(path, "OTel input locator lacks a convention version");
    assertNormalizedSemantic(input.locator.convention_version, `${path} OTel convention version`);
    if (input.channel !== "telemetry") fail(path, "OTel attributes require the telemetry channel");
  }
}

function usageSignalUnit(
  signal: UsageSignal,
  context: ProviderValidation,
  path: string,
): UnitExpression {
  if (signal.namespace === "provider") {
    const atom = context.atoms.get(
      atomIdentity(context.providerId, "usage_signal", undefined, signal.value),
    );
    if (atom?.kind !== "usage_signal") fail(path, "charge signal has no unit definition");
    return atom.unit;
  }
  return standardUsageSignalUnit(signal);
}

function validateProviderLinks(context: ProviderValidation): void {
  for (const offer of context.offers.values()) {
    for (const relation of offer.relations) {
      for (const offerRef of relation.target.offer_refs) {
        if (offerRef === offer.id || !context.offers.has(offerRef))
          fail(`offer ${offer.offer_key}`, "relation target is not another provider offer");
      }
    }

    for (const term of offer.terms) {
      if (term.kind === "allowance")
        term.variants.forEach((variant) =>
          validateAllowanceTarget(variant, context, `term ${term.term_key}`),
        );
      if (term.kind === "contribution")
        for (const variant of term.variants)
          for (const termRef of variant.target_rate_refs)
            if (context.terms.get(termRef)?.term.kind !== "rate")
              fail(`term ${term.term_key}`, "contribution target is not a provider rate term");
      if (term.term_key === "kmodels.offer-state")
        validateReservedStateTerm(term, offer, `term ${term.term_key}`);
    }
  }
  for (const book of context.books.values())
    for (const edge of book.resource_edges)
      if (edge.target.kind === "books") {
        for (const bookRef of edge.target.book_refs)
          if (bookRef === book.id || !context.books.has(bookRef))
            fail(`book ${book.book_key}`, "resource edge target is not another provider book");
      } else {
        for (const modelRef of edge.target.model_refs)
          if (ownedModel(context.core, modelRef).provider_id !== context.providerId)
            fail(`book ${book.book_key}`, "resource edge model belongs to another provider");
      }
  validateOfferClosureAcyclic(context);
}

function validateAllowanceTarget(
  variant: PriceAllowanceTerm["variants"][number],
  context: ProviderValidation,
  path: string,
): void {
  if (variant.target.kind !== "rate_terms" || variant.benefit.kind !== "quantity") return;
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
      target.term.kind !== "rate" ||
      target.term.variants.length === 0 ||
      target.term.raw_variants.length > 0
    )
      fail(path, "usage allowance target is not an exact normalized rate term");
    if (target.term.variants.some(({ price }) => canonicalJson(price.per) !== allowanceUnit))
      fail(path, "usage allowance unit differs from its target rate");
  }
}

function validateOfferClosureAcyclic(context: ProviderValidation): void {
  const edges = new Map<string, string[]>();
  for (const offer of context.offers.values())
    edges.set(
      offer.id,
      offer.relations.flatMap((relation) =>
        relation.kind === "requires" || relation.kind === "incurs"
          ? relation.target.offer_refs
          : [],
      ),
    );
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (offerRef: string): void => {
    if (visiting.has(offerRef)) fail(context.providerId, "offer closure contains a cycle");
    if (visited.has(offerRef)) return;
    visiting.add(offerRef);
    for (const target of edges.get(offerRef) ?? []) visit(target);
    visiting.delete(offerRef);
    visited.add(offerRef);
  };
  for (const offerRef of edges.keys()) visit(offerRef);
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
  payload: (variant: T) => string,
  context: ProviderValidation,
): void {
  const payloads = variants.map(payload);
  for (let left = 0; left < variants.length; left += 1)
    for (let right = left + 1; right < variants.length; right += 1)
      if (payloads[left] !== payloads[right])
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
    compareOptionalCanonical(left.resolution_policy, right.resolution_policy) ||
    compareOptionalCanonical(left.possible_scope, right.possible_scope) ||
    compareOptionalCanonical(left.validity, right.validity) ||
    compareCanonicalValues(left.observations, right.observations)
  );
}

function compareContributionVariants(
  left: PriceContributionTerm["variants"][number],
  right: PriceContributionTerm["variants"][number],
): number {
  return (
    compareCanonicalValues(left.target_rate_refs, right.target_rate_refs) ||
    compareCanonicalValues(left.charge_bindings, right.charge_bindings) ||
    compareOptionalCanonical(left.validity, right.validity) ||
    compareCanonicalValues(left.applicability, right.applicability) ||
    compareCanonicalValues(left.observations, right.observations)
  );
}

function rawVariantGroupKey(variant: RawPricingVariant): string {
  return canonicalJson([
    variant.impact,
    variant.reason,
    ...optionalComponent(variant.resolution_policy),
    ...optionalComponent(variant.possible_scope),
    ...optionalComponent(variant.validity),
  ]);
}

function isSingleStandardUnit(
  expression: UnitExpression,
  value: "item" | "token" | "second",
): boolean {
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

function assertBoundedApplicabilityGroups<T extends { applicability: PriceApplicability }>(
  values: T[],
  key: (value: T) => string,
  path: string,
): void {
  const groups = new Map<string, T[]>();
  for (const value of values) {
    const identity = key(value);
    const group = groups.get(identity);
    if (group === undefined) groups.set(identity, [value]);
    else group.push(value);
  }
  for (const group of groups.values())
    for (let left = 0; left < group.length; left += 1)
      for (let right = left + 1; right < group.length; right += 1) {
        try {
          const applicability = unionApplicabilities([
            group[left]!.applicability,
            group[right]!.applicability,
          ]);
          if (jsonByteLength(applicability) <= pricingLimits.applicabilityBytes)
            fail(path, "contains compactable variants");
        } catch (error) {
          if (!(error instanceof Error && /limit exceeded/.test(error.message))) throw error;
        }
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
