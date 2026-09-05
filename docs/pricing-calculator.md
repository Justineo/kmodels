# Portable request calculator

Status: implemented; package preparation is complete, registry publication is a separate release step.

`@kmodels/pricing` packages the exact request evaluator as ESM targeting ES2023 with TypeScript declarations. Its only runtime dependency is Zod. The authoritative portable interface is the [package contract](../packages/pricing/CONTRACT.md); the [README](../packages/pricing/README.md) shows initialization, discovery, calculation, and instance replacement.

## Ownership

The npm package contains no provider price data. Applications obtain and retain a compatible export, pass it to `createCalculator`, capture and normalize usage, and atomically replace their calculator reference after a refresh. The package never fetches, caches, persists, refreshes, or correlates usage. It has no dependency on Vue, the collector, Node I/O, or generated `data/`.

One component represents one billing aggregation instance. Exact offers are selected by the application. Requirements discovery exposes selectors, alternative input sets, source locators, aggregation boundaries, related charges, and known gaps. Missing measurements remain missing, and assumptions require explanations. Results separate known subtotals from complete totals and freshness from completeness.

## Calculation export

Pair publication and `vp run prepare:assets` generate these separate export-pack assets:

- `/pricing/calculation/index.json`: all complete provider partitions;
- `/pricing/calculation/providers/{provider}.json`: one complete provider partition;
- `/pricing/calculation/coverage.json`: calculation coverage by offer, operation selector, and logical charge component, with source and freshness references.

The calculation envelope has its own `schemaVersion` and the canonical pair identity. It preserves vocabulary, models and explicit dispositions, source hashes, provider freshness, books/offers/terms/variants, bindings, applicability, validity, relations, enrollment/settlement context, raw reasons, and evidence locators. It omits bulky observation fragments. The canonical `/pricing/index.json` remains the audit resource and cannot initialize the npm package directly.

Consumers may combine whole providers only from the same source pair. They must preserve all potentially applicable terms; rate/offer filtering can turn a partial cost into a falsely complete one. No export is bundled into npm. Price refreshes within schema `1.0` are independent of npm releases. Unknown versions fail explicitly.

Coverage distinguishes normalized price availability, semantic charge bindings, complete acquisition alternatives, selectors without acquisition, unsupported raw reasons, and nonnumeric states. An operation array with no values means the term does not publish an operation predicate; it does not mean every operation is supported. Counts are diagnostic facts, not a claim that all request components can be calculated. The [18-provider audit](pricing-audit.md) records the reviewed mechanisms and outstanding evidence limits.

## Shared arithmetic and release checks

Canonical and packaged evaluation share rational arithmetic, quantity graphs, applicability predicates, and validity semantics. `round_up` is the exact positive-increment ceiling operation on quantities, composed in graph order with `minimum` and applied separately within each billing boundary. A provider binding uses it only after evidence establishes the increment and boundary. No existing raw billing block is upgraded merely because the operation exists.

`vp run package:build` emits the neutral ESM bundle/declarations, JSON Schemas, and synthetic conformance fixtures. `vp run package:check` packs the artifact, checks its allowlist and dependency boundary, blocks network access, and executes calculation and error vectors in Node and a bundled browser-like ESM context. Generated-data tests validate every provider export against the canonical pair. CI runs package checks alongside repository checks. Nothing in those commands publishes to a registry.

## Code organization

The package entry point in `src/pricing/calculator.ts` initializes the snapshot and exposes the public methods. `snapshot.ts` owns the immutable data index and term traversal; `requirements.ts` owns discovery. Request validation is in `request.ts`, while `validation.ts`, `validation-vocabulary.ts`, and `validation-quantity.ts` validate supplied price data.

`evaluation.ts` assembles request results. `component-evaluation.ts` handles one billing instance, `composition.ts` checks component relationships, and `allowances.ts` applies supported benefits. `selection.ts` resolves applicability and validity. Public result/interface types live in `types.ts`; wire schemas remain in `schema.ts`.

The package checker runs explicit stages: pack and inspect the artifact, load synthetic conformance data, and verify Node and browser runtimes through the same conformance runner. Helpers are named for those stages so the execution order and boundaries are visible in the code.
