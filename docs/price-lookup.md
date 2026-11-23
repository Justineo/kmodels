# Portable unit-price lookup

Status: current

Kmodels resolves the published unit price for a subject, meter and supplied conditions. It does not
accept usage quantities, attribute usage, apply account balances or calculate request costs.
Consumers can query the same meter repeatedly with different conditions, including different cache
TTLs within one request. A context token count selects a price band; it is not a billable quantity.

## Contract and distribution

`@kmodels/pricing` provides `createInferencePriceLookup`, `createCommercialPriceLookup` and
`validatePriceData`. The package is pure ESM for Node and browsers, with no network, storage,
frontend dependencies or bundled provider prices. Callers retrieve and replace complete snapshots.

The portable data schema is `3.0`, published by package `0.5.0`. Old calculator and v1/v2 schemas
and requests are rejected; there are no compatibility evaluators or legacy asset aliases. Each
provider partition interns unique `PriceApplicability` objects into `provider.applicabilities[]`
referenced by zero-based `applicability_id` / `possible_scope_id` indexes, and each offer embeds
its reviewed commercial `selection` claims directly. Lookup results hydrate interned
applicabilities back onto returned candidate offers and terms.

- `/pricing/lookup/index.json` contains all complete provider partitions.
- `/pricing/lookup/providers/{provider}.json` contains one complete provider partition.
- `/pricing/lookup/coverage.json` inventories rates, conditions, raw evidence and freshness.
- `/pricing/inference.json` binds literal model IDs to the same price snapshot.

The audit envelope `/pricing/index.json` is a different schema. It preserves full observations and
provider-owned price-basis accounting metadata (`charge_binding`, `selector_sources`). Portable
exports omit retired accounting/unused fields and preserve evidence references, exact rates,
commercial selection claims, interned scopes, validity and relationships. Known unit prices remain
usable independently of accounting metadata.

## Queries and results

Inference lookup accepts a provider and exact model ID. Commercial lookup additionally accepts a
provider resource book. Both accept a meter, canonical choices, native conditions, an optional exact
offer reference and evaluation time. Canonical choices resolve to the same native conditions used
by provider tariffs; consumers need not interpret provider offer keys.

Results preserve exact rational unit prices and their denomination and denominator. They include
candidate offers, applicable terms, effective conditions, missing conditions, evidence and freshness.
Missing facts produce candidates; unknown, conflicting or unsupported evidence stays explicit.
Neither missing prices nor missing usage implies zero. No cheapest/default offer is selected.

Applicable raw `conflicting_values` evidence and competing numeric prices both report the existing
`conflicting_variants` gap. Raw reasons and evidence remain on their selected terms; unsupported
structures remain distinct. Interactive website explanations show a conflict only after its
conditions are resolved, and specific conflict or validity gaps take precedence over generic
`unresolved_price`. Identity and scope failures retain their own explanations. Precomputed
website assets preserve their established fallback wording for the same publication identity.
The inspector uses the stored matching data to explain the current selection. These diagnoses
leave tariff selection, applicability, validity and amounts unchanged.

Evaluation uses exact datetime boundaries directly. Calendar-only boundaries can exclude clearly
future or expired rates, while the whole published period and adjacent UTC dates remain an
uncertainty window for an unspecified effective instant/time zone. Rates in that window retain
`unresolved_validity`; source precision and future schedules are unchanged. See
[published validity](pricing.md#published-validity) for the shared rule.

The factories validate and privately clone their inputs. Results are independent copies. Mapping
and price data must identify the same accepted snapshot; replace them together. Complete provider
partitions preserve reference closure, including contributions to independently priced terms.
The commercial factory shares one owned snapshot and mapping across its model and resource paths.
Literal IDs and commercial selections are indexed once inside that owned state. Validation-only
canonical keys and applicability indexes end with their synchronous validation scope; retaining a
lookup or a validated export must not retain those temporary validation caches.

The public [package contract](../packages/pricing/CONTRACT.md) and generated data/query JSON schemas
describe the wire. Fixtures check conditions, evidence, unknowns and mutation isolation. Package
checks verify packed declarations and equivalent Node/browser query results with networking
disabled. Generated checks compare every provider export with the canonical data. Production builds
replay mapped IDs against the materialized price assets.
Build verification compares each provider file exactly with its independently validated complete
index partition before replaying the public matcher. That equality reuses the proven schema and
reference closure instead of cloning and validating the same partition a second time.
Mismatch diagnostics identify the artifact and provider without formatting complete price books
into an assertion diff; rejecting a damaged publication must not duplicate its data into logs.
