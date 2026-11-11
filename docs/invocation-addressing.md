# Invocation addressing

Status: current identifier and availability semantics

## Boundary

Catalog identity and invocation addressing are different domains. An exact
catalog row is identified by `(provider_id, model_id, version)`. An invocation
address selects that row through a provider surface and may additionally depend
on endpoint, region, deployment type, an account-created resource, or another
request-visible parameter.

## Static identifiers

Kmodels publishes every accepted `model_id` and alias in the provider-scoped
`/catalog/identifiers.json` index. Each value maps to all exact target rows and
records whether the edge came from `model_id` or `aliases`. The mapping is
one-to-many; consumers must not select an arbitrary target when an identifier
is ambiguous.

The website carries the same aliases in its compact index and includes them in literal search.

## Positive deployment evidence

`ProviderModel.availability` stores exact positive `{region, deployment_type}`
tuples. The website groups those tuples by deployment type only for display; it
never publishes independent region and deployment arrays or reconstructs their
Cartesian product. Model details label the result as observed combinations.

Static identifier support does not by itself prove that a value is callable on
every route. Today `aliases` is a string set without endpoint or deployment
scope. Provider adapters must retain that scope before Kmodels can make a
route-specific invocation claim.

An omitted tuple remains unknown. Publishing `unsupported` would require one
of:

- an explicit official negative combination;
- an exhaustive matrix whose cells include both positive and negative states;
  or
- a provider contract that explicitly defines a closed finite domain.

The availability projection retains positive facts only, so it does not infer negative support
claims. Provider-owned deployment names, private inference-profile ARNs, project resources and
locally installed tags cannot be discovered from public model labels. Dynamic account resources are
never enumerated as public catalog values. A documented address syntax alone does not establish
its model or tariff. Exact public identifiers and their commercial scope require the independent
provider evidence described in each provider guide.

## UI projection

The UI keeps the original catalog identifier directly copyable without a separate visible label in the inspector header.
Pricing displays evidenced inference IDs with the same copy control. The inspector summarizes
positive deployment/region tuples as `Availability details`. It explains that listed regions are documented facts,
not an exhaustive support matrix.

Pricing uses independently evidenced request IDs for the selected catalog row. When the only
request ID equals the catalog ID, Pricing still shows that value with its own copy control. When mapping
is unknown, Pricing shows that status and ordinary catalog prices. A catalog alias can also be a
request ID when provider evidence establishes that role.

## Price lookup boundary

The current [inference price mapping decision](inference-pricing.md) associates provider-owned
request IDs with canonical prices. Static catalog IDs, name aliases and actual request IDs remain
separate concepts. An alias or display-name match alone is not evidence of a price association.

Only conditions that change price applicability participate in lookup. Source Region, commercial
routing scope, API/endpoint, served tier or another selector is retained when provider evidence makes
it necessary. Method/path templates, general capability discovery, account-resource confirmations
and execution policy are not lookup prerequisites. Unknown mapping evidence produces an unknown
result; missing commercial conditions produce explicit candidate prices and missing-condition labels.

Collection, static output and the UI use direct source-owned ID/price associations. An invocation
graph, target/case workflow and configuration gates are not part of this contract. See the
[implementation limits](inference-pricing.md#compatibility-and-implementation-limits) for the
distinction between implemented mappings, source coverage and stored-data adoption.
