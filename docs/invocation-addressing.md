# Invocation addressing

Status: implemented for static identifiers and positive deployment tuples

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

The website carries the same aliases in its compact index, includes them in
literal search, and shows them as copyable alternate identifiers in model
details.

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

Current collectors retain positive facts only, so Kmodels does not infer
negative support claims. Endpoint/alias coupling, provider-owned deployment
names, inference-profile ARNs, project resources, and locally installed tags
remain outside this contract. Dynamic account resources are never enumerated
as public catalog values.

## UI projection

The UI keeps the exact model ID directly copyable, places static aliases in a
collapsed disclosure, and summarizes positive deployment/region tuples as
`Availability details`. It explains that listed regions are documented facts,
not an exhaustive support matrix.
