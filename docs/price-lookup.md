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

The portable data schema is `2.0`, published by package `0.4.0`. Old calculator schemas and requests
are rejected; there are no compatibility evaluators or legacy asset aliases.

- `/pricing/lookup/index.json` contains all complete provider partitions.
- `/pricing/lookup/providers/{provider}.json` contains one complete provider partition.
- `/pricing/lookup/coverage.json` inventories rates, conditions, raw evidence and freshness.
- `/pricing/inference.json` binds literal model IDs and canonical choices to the same price snapshot.

The audit envelope `/pricing/index.json` is a different schema. It preserves full observations.
Portable exports preserve evidence references, exact rates, scopes, validity and relationships.
Provider-owned price-basis metadata remains descriptive: it explains denominators, minimums and
source-defined billable categories. No runtime executes its quantity graphs or consumes actual
usage. Known unit prices remain usable when such metadata is missing.

## Queries and results

Inference lookup accepts a provider and exact model ID. Commercial lookup additionally accepts a
provider resource book. Both accept a meter, canonical choices, native conditions, an optional exact
offer reference and evaluation time. Canonical choices resolve to the same native conditions used
by provider tariffs; consumers need not interpret provider offer keys.

Results preserve exact rational unit prices and their denomination and denominator. They include
candidate offers, applicable terms, effective conditions, missing conditions, evidence and freshness.
Missing facts produce candidates; unknown, conflicting or unsupported evidence stays explicit.
Neither missing prices nor missing usage implies zero. No cheapest/default offer is selected.

The factories validate and privately clone their inputs. Results are independent copies. Mapping
and price data must identify the same accepted snapshot; replace them together. Complete provider
partitions preserve reference closure, including contributions to independently priced terms.

The public [package contract](../packages/pricing/CONTRACT.md) and generated data/query JSON schemas
describe the wire. Fixtures check conditions, evidence, unknowns and mutation isolation. Package
checks verify packed declarations and equivalent Node/browser query results with networking
disabled. Generated checks compare every provider export with the canonical data. Production builds
replay mapped IDs against the materialized price assets.
