# Portable request calculator

Status: implemented; package preparation is complete, registry publication is a separate release step.

`@kmodels/pricing` packages the exact request evaluator as ESM targeting ES2023 with TypeScript declarations. Its only runtime dependency is Zod. The authoritative portable interface is the [package contract](../packages/pricing/CONTRACT.md); the [README](../packages/pricing/README.md) shows initialization, discovery, calculation, and instance replacement.

## Ownership

The npm package contains no provider price data. Applications obtain and retain a compatible export, pass it to `createCalculator`, capture and normalize usage, and atomically replace their calculator reference after a refresh. The package never fetches, caches, persists, refreshes, or correlates usage. It has no dependency on Vue, the collector, Node I/O, or generated `data/`.

One component represents one billing aggregation instance. Exact offers are selected by the application. Requirements discovery exposes selectors, alternative input sets, source locators, aggregation boundaries, related charges, and known gaps. Missing measurements remain missing, and assumptions require explanations. Results separate known subtotals from complete totals and freshness from completeness.

Rate selector sources remain qualified by their variant's applicability and validity. Contribution discovery carries referenced rate contracts within the contribution scope. Allowance discovery retains benefit, target and reset, and reports statically unsupported mechanisms. Charges retain the applied binding, unit price and combined contribution/rate/binding evidence. Public component types describe input; parsed components stay internal. Results and requirements use discriminated unions so consumers can safely narrow complete totals and term-specific metadata.

Package `1.0.0` accepts data/request schema `2.0` at its default entry and preserves the synchronous
schema `1.0` reader at `@kmodels/pricing/v1`. Both entries share the exact monetary evaluator. V2
initialization is asynchronous; its results preserve the complete v2 snapshot and invocation selections.
The package contract documents migration and the explicit compatibility entry.

## V2 implementation boundary

The source entry `src/pricing/v2/index.ts` and default package entry accept only calculation schema
`2.0`. The compatibility entry `src/pricing/index.ts` / `@kmodels/pricing/v1` accepts only `1.0`.
Registry publication is a separate release step. Durable data has not adopted v2.

V2 initialization uses `await validatePriceData(data)` or `await createCalculator(data)`. Web Crypto
verifies observed-selector contract references without a Node dependency or network access.
Calculations remain synchronous after initialization and reuse the exact evaluator. The internal
evaluator view is not a legacy publication: returned results retain the complete v2 snapshot.

The v2 snapshot adds `coreDataSha256` and `pricingAssetSha256`, respectively identifying complete C2
data and the exact P2 response. Selected provider partitions retain the parent metadata. Each provider
includes `invocation`, `invocation_bindings`, and `invocation_sources`; invocation sources remain
separate from retained price source revisions. Reference, provider, public-source and selector
validation is shared with canonical publication. These metadata fields do not authenticate arbitrary
input: clients still verify downloaded resource hashes against their accepted publication manifest.

`listInvocationBindings()` exposes exact target/case/offer joins. An offer with published bindings
requires explicit `invocation: { targetRef, caseRef, inputs?, observed? }` selection in requirements
and calculation components. `bindInvocation()` derives fixed selectors and reports missing context
or observed inputs. Fixed selectors may be categorical or boolean. Context and observed input values
are normalized categorical values under their declared dimension;
the caller follows the acquisition contract when collecting and normalizing observations. Ordinary
selectors cannot bypass those inputs or override a fixed value. Unknown cases, unrelated offers,
undeclared inputs and conflicting selectors fail. Requirements/calculation reject unresolved
invocation pricing inputs. Offers without invocation bindings retain ordinary explicit offer
calculation; absence of bindings does not establish callability.

Results record each component's selected target and case. A conditional price calculation does not
establish account access, runtime configuration, lifecycle eligibility or successful execution.
Those conclusions remain the responsibility of invocation resolution and selection policy.

New pairs also publish `/pricing/v2/calculation/index.json`, complete provider partitions under
`/pricing/v2/calculation/providers/`, and `/pricing/v2/calculation/coverage.json`. Coverage has schema
version `2.0`, the full v2 snapshot, and the existing per-provider calculation coverage plus
`targetCoverage` and `invocationBindings` (target, case and offer references). All response hashes
participate in `catalog/publication.json`. Legacy paths and strict schemas remain unchanged.

## Legacy calculation export

Pair publication and `vp run prepare:assets` generate these separate export-pack assets:

- `/pricing/calculation/index.json`: all complete provider partitions;
- `/pricing/calculation/providers/{provider}.json`: one complete provider partition;
- `/pricing/calculation/coverage.json`: calculation coverage by offer, operation selector, and logical charge component, with source and freshness references.

Only admitted commercial partitions appear in these exports. Catalog-only registry or SDK evidence
does not establish a pricing partition merely by naming a hosted route. A provider without such a
partition remains in the core catalog with unknown model pricing; absence from a price export is
not absence from the model catalog.

The checked-in export pack must include these endpoints. After a projection change, regenerate it from the accepted local pair with `vp run prepare:assets`; this does not collect live prices. `vp run build` verifies the materialized calculation index, matching coverage and every provider partition, including calculator initialization. A stale pack missing the endpoints fails the build.

The calculation envelope has its own `schemaVersion` and the canonical pair identity. It preserves vocabulary, models and explicit dispositions, source hashes, provider freshness, books/offers/terms/variants, bindings, applicability, validity, relations, enrollment/settlement context, raw reasons, and evidence locators. It omits bulky observation fragments. The canonical `/pricing/index.json` remains the audit resource and cannot initialize the npm package directly.

Provider `sources` reports the source revisions captured with the price snapshot, including when
that snapshot is retained while the catalog advances. For a legacy snapshot without captured
revisions, only catalog records with the same observation time can establish that metadata.
Every evidence source must resolve; unavailable historical metadata rejects the export with its
source ID. Recover verified records from the corresponding accepted catalog transaction before
publication, rather than substituting a newer source hash or weakening reference closure.
The portable snapshot keeps its existing freshness shape; the canonical snapshot's captured
records are projected into `sources`, without changing calculation schema `1.0`.

Consumers may combine whole providers only from the same source pair. They must preserve all potentially applicable terms; rate/offer filtering can turn a partial cost into a falsely complete one. No export is bundled into npm. Price refreshes within schema `1.0` are independent of npm releases. Unknown versions fail explicitly.

Coverage distinguishes normalized price availability, semantic charge bindings, complete acquisition alternatives, selectors without acquisition, unsupported raw reasons, and nonnumeric states. An operation array with no values means the term does not publish an operation predicate; it does not mean every operation is supported. Counts are diagnostic facts, not a claim that all request components can be calculated. [Pricing coverage](pricing-coverage.md) defines the evidence levels and their limits; provider guides own exact current mechanisms.

## Shared arithmetic and release checks

Canonical and packaged evaluation share rational arithmetic, quantity graphs, applicability predicates, and validity semantics. The pure `pricing-applicability.ts` interpreter is shared with website projection; calculator imports do not pass through presentation or formatting modules. `round_up` is the exact positive-increment ceiling operation on quantities, composed in graph order with `minimum` and applied separately within each billing boundary. A provider binding uses it only after evidence establishes the increment and boundary. No existing raw billing block is upgraded merely because the operation exists.

`vp run package:build` emits the neutral ESM bundle/declarations, JSON Schemas, and synthetic conformance fixtures. `vp run package:check` packs the artifact, checks its allowlist and dependency boundary, blocks network access, and executes calculation and error vectors in Node and a bundled browser-like ESM context. Generated-data tests validate every provider export against the canonical pair. CI runs package checks alongside repository checks. Nothing in those commands publishes to a registry.

## Code organization

The default package entry point `src/pricing/v2/index.ts` exports the v2 reader and invocation-aware
calculator; `src/pricing/index.ts` exports the explicit v1 compatibility surface.
`src/pricing/calculator.ts` exposes the shared evaluator, and `errors.ts` defines the stable error
codes. `snapshot.ts` owns the immutable data index and term traversal; `requirements.ts` owns
discovery. Request validation is in `request.ts`, while `validation.ts`,
`validation-vocabulary.ts`, and `validation-quantity.ts` validate supplied price data.

`evaluation.ts` assembles request results. `component-evaluation.ts` handles one billing instance, `composition.ts` checks component relationships, and `allowances.ts` applies supported benefits. `selection.ts` resolves applicability and validity. Public result/interface types live in `types.ts`; wire schemas remain in `schema.ts`.

The package checker runs explicit stages: pack and inspect the artifact, verify frozen v1 contract
hashes, compile consumers of both entries against packed declarations in NodeNext and
bundler-compatible module modes, load each version's synthetic conformance data, and verify Node
and browser runtimes through the same conformance runner. Consumer checks cover asynchronous v2
initialization, optional component inputs, complete/incomplete result narrowing and term-specific
requirement fields. Frozen schemas, numerical vectors and contract text are tied to the pre-migration
commit in `tests/fixtures/calculator/v1-contract-hashes.json`; regeneration cannot silently widen
the v1 reader. V2 vectors add explicit fixed/context/observed selection, cross-version rejection,
missing inputs, conflicting values and unresolved acquisition references.
