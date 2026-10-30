# Invocation addressing

Status: typed invocation framework implemented; provider migration and stored-data adoption in progress

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

The UI labels the exact model ID as `Catalog ID`, keeps it directly copyable, places static aliases in a
collapsed disclosure, and summarizes positive deployment/region tuples as
`Availability details`. It explains that listed regions are documented facts,
not an exhaustive support matrix.

## Typed invocation contracts

The [schema upgrade design](catalog-schema-upgrade.md) separates surfaces, literal or caller-supplied
addresses, atomic support cases, scoped facts, evidence, typed identifier relations, and coverage.
`invocation-schema.ts` defines strict bounded objects. `invocation-validation.ts` checks reference
closure and provider ownership, including evidence sources and scoped facts. Public invocation facts
cannot originate from account, workspace, or private runtime observations.

`invocation-identity.ts` derives target IDs from model, surface, address, upstream routing, and wire
selectors; case IDs include their target and joint scope. Observation times, support state, lifecycle,
and prices do not change those identities. Evidence IDs include source, document, locator, and content
hash, while the observation time remains separately recorded.

`resolveInvocation()` returns individual case assessments. Exact matching preserves ambiguous model
identities and explicit negative or conflicting results. Missing caller context retains incomplete
choices; unknown catalog scope stays unknown. Overlapping positive and negative cases produce conflict
diagnostics. Surface region inputs and request-region context select the same region; contradictory
values remain configuration conflicts. Account access and actual request verification stay unknown
and not tested, respectively.

`configureInvocation()` binds caller-owned resource confirmations to an exact target, case, model,
consumed input map and scope context. Deployment/endpoint addresses always require a deployment
binding; installation and runtime compatibility require the case's declared confirmations. Changing
the resource, origin, region, version or case invalidates the confirmation. This runtime object is
never persisted as public catalog evidence and does not establish account eligibility. Surface
region inputs and context share one value; caller origins must match the declared transport and
cannot embed credentials, a query or a path.

`assessInvocations()` adds lifecycle/release policy and case-scoped capability/limit assessment to
every resolver diagnostic. Defaults permit active, stable targets; callers can explicitly allow
legacy/deprecated targets or preview/experimental releases. Unknown lifecycle or release stage
remains unknown. Only the selected case's fact references participate in requirements. Conflicting
facts remain conflicting; recommendations do not replace supported embedding dimensions. Pinned
alias drift is conflicting, while an unverified rolling resolution cannot silently rebind pricing.

A request addressing template is exposed only for a supported, matched, fully configured case
whose policy requirements are satisfied. Ambiguous identity needs explicit target selection.
Templates contain method, transport, URL, noncredential headers and JSON-pointer body assignments;
task payloads and authentication remain caller-owned. Path identifiers are encoded as single
segments, query values use URL encoding, and conflicting assignments are rejected. Template
generation executes no request and retains unknown account access and untested request status.
Missing catalog scope—including unknown execution geography—does not become a wildcard merely
because the address is documented. All cases remain available for inspection and conditional
pricing even when no request template can be established.

Sources declare `invocation` ownership separately from model-field ownership. The collector persists
their accepted graph under the internal catalog's `invocation` field. Unmigrated models receive
explicit `not_collected` coverage and unclassified legacy alias edges. Provider rollback restores its
invocation graph with the model partition. An unavailable API companion can retain previously verified
targets only while fresh identity evidence still names those addresses; retained documents keep their
original observation times. Changed wire evidence does not receive this transport-failure fallback.

Publication generates separate v2 catalog/pricing assets and a resource-hash manifest alongside the
unchanged v1 projection, including provider metadata/models and closed invocation profiles. New
invocation facts participate in v2 identity. The v2 calculation exports and source reader retain
invocation bindings. Durable data has not been refreshed, so these
implementation paths do not establish adoption in the checked-in catalog.

The website projection carries each model's invocation graph, evidence ownership and price bindings
in its deferred detail chunk, bounded to 2 MiB. Resolved model references remain in the closure even
when they name a different catalog row. Version 7 detail chunks carry invocation semantics; the
loader still reads existing version 6 chunks. It rejects foreign graph references and mixed data
versions before caching a chunk. The website data version uses the full v2 catalog and price hashes
when that pair exists.
A model's complete graph must fit in one detail record; oversized records reject projection rather
than truncating their evidence or silently dropping targets.

The inspector requires an explicit target and documented case; it does not select the first target,
region or account resource. Catalog facts remain separately labeled as unscoped. Case-scoped facts,
support, context matching, configuration and selection policy stay visible independently. Only
supported cases expose a request-ID copy action; a ready addressing template additionally requires
matched scope, complete configuration and eligible lifecycle/release policy. Resource confirmation
is local to the exact selection and is cleared when its inputs or case change.

Conditional pricing uses the same binding resolver as the portable calculator. Fixed selectors are
read-only; context and observed inputs require explicit values even when only one value is available.
Observed served values never come from the requested route. A context input sharing a request input
name must match its exact value; display labels do not translate provider values. All linked charges
share these selectors. Missing inputs, incompatible context and unsupported cases withhold rates;
unknown execution geography still permits explicitly labeled conditional rates when the price binding
itself is established. Changing target, case or request context clears previous price inputs. This
does not verify account access or execute a provider request.

Invocation bindings supply values for canonical commercial conditions. Each non-model selector must
occur in each linked offer's applicability; model selectors fix the target's resolved identity and
cannot come from caller context. An incompatible binding rejects the candidate before commit,
retaining the complete accepted publication. Invocation geography does not by itself establish a
commercial restriction; that requires independent pricing evidence.
