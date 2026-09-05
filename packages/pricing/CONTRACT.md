# Portable pricing contract 1.0

Status: implemented. This document, `schema.json`, `request.schema.json`, and `conformance.json` define the language-neutral contract. JSON Schema describes structure; the semantic checks and evaluator rules below are also mandatory. Another implementation need not use TypeScript or Zod.

## Data ownership and compatibility

The runtime contains no real price data, performs no I/O, reads no environment or wall clock, and retains no usage. Initialization validates and clones a caller-supplied JSON value into an immutable private snapshot. Each call uses only that snapshot and its arguments. Results and discovery outputs are isolated copies. Replacing an instance is the refresh mechanism; existing instances continue to use their original data.

The envelope has `schemaVersion: "1.0"`, `snapshot`, and a nonempty `providers` array. This release accepts exactly version `1.0`; unsupported versions produce `UNSUPPORTED_SCHEMA`. Data updates with that schema do not require a package release. Changes to wire or evaluator semantics require a declared compatible package version and an explicit schema-version decision. Do not silently reinterpret an unknown version.

`snapshot` contains the canonical `pricingDataVersion`, `coreCatalogVersion`, and `generatedAt`. A provider partition contains its publication/observation metadata, complete vocabulary, model dispositions, source identity/URL/hash/extractor metadata, and complete books. Preserve book → offer → logical term → qualified variant identity. Preserve states, enrollment and settlement metadata, resource edges, relations, rate/allowance/contribution/raw terms, selector mappings, bindings, applicability, validity, and evidence locators. Omit observation fragments and copied upstream bodies. Enrollment/settlement describe access and billing context; they do not discount a public list rate.

All references must resolve inside the supplied provider partition. Provider-owned vocabulary must belong to that provider, including categorical values under their exact dimension. Book, offer, and term IDs are globally unique; sources and model IDs are unique within a provider. Model `offers` dispositions agree with the books. Input mappings cover exactly the signals in their quantity method. Units, applicability, rational values, and calculation graphs must be canonical and coherent. A partition is an export of the complete provider, not an arbitrary offer filter. Validation verifies structure and reference closure, not source authenticity or a cryptographic signature. Snapshot version fields identify the canonical source pair, not a digest of the reduced export.

Provider publication `retained` is preserved with its failed-refresh metadata. The caller decides whether a retained or old observation is acceptable. Completeness and freshness are independent: a retained snapshot may calculate a complete amount. No automatic stale threshold, source retrieval, or historical substitution occurs.

## API and normalized input

- `validatePriceData(data)` returns a validated independent data value or throws a stable error.
- `createCalculator(data)` returns an immutable calculator instance.
- `listOffers({ modelRef?, providerId? })` returns exact matching offers and book/provider/model references. Empty filters list all offers. There is no default, ranking, cheapest-price choice, alias inference, or cross-provider name matching.
- `requirements({ offerRef, selectors? })` returns potentially applicable charge contracts, selectors still needed, full alternative signal sets, validity, states, aggregation boundaries, related offers/resource edges, and known gaps. It does not choose an offer or assume input values. Contribution requirements include referenced rate IDs and their selectors.
- `calculate({ evaluatedAt, components })` evaluates one or more billing components. `evaluatedAt` is an explicit RFC 3339 instant used for published validity. It is canonicalized to UTC without discarding sub-millisecond precision.

A component contains a unique `id`, `offerRef`, normalized `quantities`, and optional `selectors`, `aggregation`, `assumptions`, and `relatedComponents`. Optional arrays default to empty. Each quantity has a canonical signal and a nonnegative reduced rational. Unit is defined by that signal's canonical vocabulary; the caller cannot relabel a count as tokens or seconds. Duplicate signals, even equal values, are invalid. Quantities not admitted by any binding of the selected offer are invalid, including an incompatible explicit zero.

Selectors are categorical values, booleans, or exact nonnegative decimal quantities with their units. Each dimension occurs at most once and uses its published type and vocabulary. A requested tier is not a served tier. Caller normalization must honor acquisition metadata and preserve route, operation, region, cache TTL, modality, billing time-window, context, and outcome distinctions. Recurring UTC schedules are retained in vocabulary: callers identify the actual billing window using the authoritative request/accounting timestamp and supply that selector. `evaluatedAt` alone does not assert the provider's billing timestamp or time-window classification.

Acquisition locators are metadata, never executable extraction programs. The caller captures terminal usage, separates attempts/results/iterations, resolves outcomes, and supplies normalized values. An interrupted stream does not establish zero usage. Neither absence nor a conditional locator establishes zero. When reasoning is already included in output, it must not be added again. A binding's published graph determines the applicable partition or sum.

An assumption is either `{kind: "quantity", quantity, explanation}` or `{kind: "selector", selector, explanation}`. Explanations must contain non-whitespace text. An assumption may only fill an absent value. Conflicts with another assumption or a measurement are errors, including equal-value attempts to overwrite one. Every supplied assumption is returned and makes an otherwise complete result `estimated`.

Components are billing aggregation instances, not logs to deduplicate. The caller owns request, attempt, item, job, resource, and session correlation. A single unambiguous applicable binding boundary may be inferred. Otherwise supply `aggregation`. If an offer has multiple boundaries, represent them as explicitly linked components with the appropriate boundaries. A charge belonging to another boundary is resolved there only when such a component is explicitly linked. Never sum durations across independent instances before applying an increment or minimum.

## Exact quantity evaluation

A rational is `{numerator, denominator}` using decimal integer strings. Numerators are nonnegative; denominators are positive; values are reduced by their greatest common divisor. Zero is exactly `0/1`. Both strings and every normalized arithmetic result are limited to 128 digits. No binary floating-point monetary arithmetic or currency conversion is permitted.

Without quantity methods, a binding reads its result signal directly. Each declared method is an alternative complete input path. A method without a graph reads the result signal; a graph reads its signal nodes. Evaluate every fully supplied method. All resolved method values must agree exactly before multiplying once by the optional binding `scale`. If none resolves, return the alternative sets of missing signals; do not substitute another method's partial inputs or silently accept conflicting results.

Graphs have at most 64 nodes. References are nonnegative indexes pointing only to earlier nodes; the result is the final node and every node is reachable from it. Signal nodes are unique. Sum/product input indexes are sorted and unique. Operations are:

| Operation             | Exact meaning                                                                                                                |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `signal`              | The supplied value for that signal.                                                                                          |
| `constant`            | A published rational and unit.                                                                                               |
| `sum`                 | Sum all input values of the same unit.                                                                                       |
| `subtract_floor_zero` | `max(minuend − subtrahend, 0)`, with equal units.                                                                            |
| `product`             | Multiply one dimensional quantity by one or more `item` counts; preserve the quantity's unit.                                |
| `multiply`            | Multiply by a positive dimensionless rational factor.                                                                        |
| `minimum`             | `max(input, value)`, preserving the input unit. The published minimum is positive.                                           |
| `round_up`            | `ceil(input / increment) × increment`, preserving the input unit. The increment is a positive rational. Zero rounds to zero. |

Minimum and increment composition follows graph order. There is no implicit minimum, increment, calendar conversion, rounding mode, or monetary rounding. The resulting binding unit must equal the rate denominator. A charge's gross amount is the exact normalized quantity multiplied by its unit price. Display/settlement rounding is outside this evaluator.

## Applicability, validity, and composition

Applicability is OR across `any_of` clauses and AND across `all_of` conditions. An empty conjunction is true. Conditions compare provider-qualified categorical values, exact booleans, or exact decimal range boundaries. A false condition rules out that clause; missing selectors are unknown. Variants of one logical term are alternatives. Different applicable terms are additive.

Never choose the lowest or first of different potentially applicable rates. Equal semantic variants may resolve without a selector only when their union covers the remaining selected offer state. Coverage is checked over the finite cells induced by the published categorical values and numeric boundaries; above 4,096 cells the selector remains unresolved. Differing simultaneously selected variants are conflicts. Equivalent evidence variants do not add another charge.

Datetime validity is checked exactly, including an explicitly exclusive endpoint. Missing `inclusive` means inclusive. Coarser year/month/date boundaries remain unresolved rather than inventing a UTC time. Outside-validity rates cannot become a complete subtotal from sibling rates alone. A current observation does not prove a price before that observation unless an exact published datetime `from` establishes it. A caller needing an earlier price must retain and supply the appropriate historical snapshot. No current-price fallback occurs.

A contribution references existing rate terms and evaluates them using the contribution's binding. It does not copy the price or imply another request. Duplicate rate/binding charges within a component are invalid. Charging a contribution and its referenced rate in components explicitly linked as the same event is also invalid. Independent, unlinked billing instances may legitimately use the same rate.

`compatible_with` expresses availability and never incurs cost. Applicable `requires`/`incurs` relations need explicitly linked components for the target offers, each with its own complete usage. Missing links are unresolved; the runtime never invents a service-call count. Applicable `exclusive_with` relations reject linked target offers. Resource edges remain discovery metadata and do not create charges automatically.

Only allowances with canonical reset `none` are evaluated within the component and its explicit outgoing links. Coverage can zero resolved target charges. A quantity allowance reduces one compatible target quantity with a zero floor before repricing. A credit reduces one matching-denomination amount with a zero floor. Target evidence is preserved on adjusted charges. Overlapping allowances, unresolved target inputs, allocation across multiple charges for a quantity/credit benefit, rate substitution, or longer reset periods remain explicit gaps. In particular, an organization/month allowance cannot be consumed from one request without account state. Known subtotals in these cases retain unallocated gross amounts; they are not final invoice totals.

Raw facts that could affect cost remain unresolved within their possible scope. Informational raw facts do not block totals. Unbound rates and nonnumeric states remain visible. A compatibility relation, unobserved quantity, or unavailable price never establishes a free charge.

## Result and errors

Results include `evaluatedAt`, snapshot identity, used-provider freshness, itemized charges, exact `subtotals` by denomination, returned assumptions, and `unresolved` requirements. Each charge identifies its component, offer, logical term, referenced rate term, quantity, gross/net amount, denomination, evidence, and applied allowances. `totals` exists only when no unresolved requirement remains. No sum crosses a denomination boundary.

| Status       | Meaning                                                                                                            |
| ------------ | ------------------------------------------------------------------------------------------------------------------ |
| `calculated` | All potentially applicable charges resolve using supplied measurements and published contracts.                    |
| `estimated`  | Complete, with one or more explicit caller assumptions.                                                            |
| `partial`    | At least one known amount or known free/included state exists, but some applicable requirement remains unresolved. |
| `unknown`    | Unresolved requirements prevent establishing any amount.                                                           |

Unresolved codes: `missing_selector`, `missing_quantity`, `unbound_charge`, `unsupported_structure`, `conflicting_variants`, `unresolved_validity`, `historical_evidence_missing`, `missing_related_component`, `unsupported_aggregation`, `unknown_price`, `outside_validity`. Entries carry relevant component/offer/term IDs, missing dimensions or alternative signals, a related offer, and/or a reason. Known subtotals are amounts supported by resolved lines, not a bound on the eventual total when missing discounts or conflicting evidence exist.

Malformed data/input is a thrown `PricingError` with stable `code`; message text is diagnostic and not a portable assertion:

| Code                     | Meaning                                                                                        |
| ------------------------ | ---------------------------------------------------------------------------------------------- |
| `INVALID_DATA`           | Schema, ownership, reference, unit, graph, or canonical-data validation failed.                |
| `UNSUPPORTED_SCHEMA`     | Unsupported calculation-data schema version.                                                   |
| `INVALID_REQUEST`        | Invalid request shape, instant, rational, selector kind/unit/vocabulary, or empty explanation. |
| `UNKNOWN_OFFER`          | Offer is absent from this snapshot.                                                            |
| `DUPLICATE_COMPONENT`    | Repeated billing component ID.                                                                 |
| `DUPLICATE_SIGNAL`       | Repeated measured usage signal.                                                                |
| `DUPLICATE_SELECTOR`     | Repeated selector dimension.                                                                   |
| `CONFLICTING_QUANTITIES` | Fully supplied alternative methods disagree.                                                   |
| `INCOMPATIBLE_QUANTITY`  | Signal is foreign, unregistered, or not an input to the selected offer.                        |
| `ASSUMPTION_CONFLICT`    | An assumption overwrites another supplied value.                                               |
| `INVALID_COMPOSITION`    | Invalid component link, exclusivity, or duplicate contribution/rate charging.                  |
| `ARITHMETIC_LIMIT`       | Exact evaluation exceeded the bounded arithmetic contract.                                     |

Request bounds are 1–1,024 components, up to 1,024 measured quantities, 128 selectors, 1,024 assumptions and 256 related IDs per component. Data admits up to 256 providers, with canonical limits of 512 books, 8,192 offers, 65,536 terms and 262,144 variants per provider. The canonical schema supplies predicate and graph bounds. Unknown object fields are rejected.

## Conformance

`conformance.json` contains only synthetic datasets. For each `cases` entry initialize from `datasets[dataset]`, evaluate `request`, and compare status, exact denomination subtotals, and the set of unresolved codes to `expected`. Complete statuses must expose `totals`; incomplete statuses must omit it. For each `errors` entry initialize from inline `data` or the named dataset, optionally calculate its raw `request`, and compare the thrown code to `expectedCode`.

Fixtures cover token/cache partitions and explicit zero, missing data, assumptions, history and retained freshness, minimums/increments per instance, mixed TTLs, reasoning, currencies/DBUs, media products, tiers/time windows, service relations, contributions, request allowances and unresolved monthly/overlapping allowances, mixed aggregation boundaries, and malformed inputs. They are independently stated fractions, not snapshots of implementation output. Node and browser checks run the same packed package against these fixtures. No second-language implementation is included in this release.
