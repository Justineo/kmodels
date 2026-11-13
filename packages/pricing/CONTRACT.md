# Unit-price lookup contract

Package version: `0.4.0`. Price data schema: `2.0`.

## Responsibility

Resolve published unit prices for a subject, meter and conditions. A query describes the usage
category whose unit price is wanted; it does not provide the amount of consumed usage. Conditions
can differ between groups of tokens in the same request. No cost API, quantity evaluator, monetary
total, allowance consumption or request-component composition is exposed.

## Inputs

`validatePriceData(unknown)` validates complete provider partitions from one snapshot. Only schema
`2.0` is accepted. Identifiers, references, provider vocabulary, units, rational values, applicability
and evidence must be coherent. Snapshot versions identify the canonical source pair, not an
authenticity signature of the reduced export.

`createInferencePriceLookup(priceData, mappingData)` returns a function accepting `provider_id`,
`model_id`, optional `meter`, `selectors`, `choices`, `offer_ref` and `evaluated_at`. Exact literal IDs
and explicit source aliases are supported; names and guessed aliases are not. The mapping must
reference the same snapshot and complete provider partitions as the price data.

`createCommercialPriceLookup(priceData, mappingData)` accepts `subject` (a model identity or provider
resource `book_ref`) and the same selection fields. `commercialPriceQuerySchema` and
`inferencePriceQuerySchema` validate their strict inputs. Unknown fields are rejected.

Selectors are categorical values, booleans or exact nonnegative decimals with units. Dimensions
are unique. Canonical `choices` translate reviewed commercial semantics into native conditions.
Conflicting fixed and supplied facts never silently replace one another. Missing conditions are
discovered from remaining rates. A context threshold does not cause token multiplication.

Evaluation time accepts RFC 3339 with a known offset and normalizes to UTC without losing fractional
precision. Omission uses the snapshot generation time. Freshness is independent of applicability.
Date-only validity boundaries remain unresolved where an exact instant cannot be established.

## Results

Results report matched prices, candidates or unknown evidence, preserving snapshot identity and
evaluation time even for an unknown ID. Each candidate includes its book and offer, applicable rate
variants, effective selectors, missing conditions, evidence and gaps. A rate contains an exact
reduced rational amount, denomination and denominator. Currencies and provider credits remain
distinct. Referenced contribution rates remain qualified by their own conditions.

Neither an unobserved price nor an empty candidate list establishes a zero price. No cheapest,
default or arbitrary offer is selected. Callers may narrow by meter and repeat queries with different
conditions. Price-basis metadata is descriptive; the package never executes its quantity graphs.

Factories clone and freeze validated snapshots. Returned results are separate copies. There is no
fetch, persistence, automatic refresh or catalog fallback. Replace snapshot and mapping together.

## Errors

`PricingError.code` is `UNSUPPORTED_SCHEMA`, `INVALID_DATA`, `INVALID_REQUEST` or
`DUPLICATE_SELECTOR`. Unresolved price evidence appears in query results rather than being treated
as a malformed request. `schema.json` defines portable data; `query.schema.json` defines commercial
queries. The audit-rich catalog pricing envelope is not portable query data.
