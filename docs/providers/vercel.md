# Vercel AI Gateway

Status: current

## Catalog and pricing boundary

Vercel publishes a directly callable gateway catalog, so Kmodels admits every valid model row from
`GET https://ai-gateway.vercel.sh/v1/models`. This is an identity boundary, not a hand-maintained
model-family allowlist. The exact `creator/model` ID is canonical; the creator must equal
`owned_by`.

Kmodels publishes the public request cost that can be reconstructed from a proxied AI Gateway
request and its generation record:

- model input, output, cache, media, realtime-message, and session-duration rates;
- route-provider, Region, Fast, service-tier, context-band, modality, quality, resolution, and
  related request/result dimensions;
- provider-native web and Maps search rates attached to their exact model routes; and
- the independently callable Perplexity, Exa, and Parallel gateway search tools.

It does not publish free-credit allowances, BYOK or Credits settlement paths, plans, team-wide
allowlist or ZDR surcharges, Custom Reporting, budgets, logs, Trace Drains, invoices, or account
controls. Those facts describe an account or a product surrounding inference, and their
applicability is not established by the proxied request, route, response, result, or generation
usage record alone. They are outside this rate book rather than unknown prices.

## First-party sources

The model list is the authoritative exhaustive inventory and the primary model-level price source.
For every ID, the documented per-model endpoint API is a claim-local enrichment for route identity
and route-specific rates. A public model page is fetched only when the model-list price object is
empty and can supply an exact visible fallback price. The fixed first-party companions are:

- `models-and-providers.md`, for the list and endpoint API contract;
- `rest-api.md`, for generation usage counters; and
- `web-search.md`, for the three generic search services and their published amounts.

All companions and per-model enrichments are optional at refresh time. Losing one endpoint, model
page, or guide withholds only facts owned by that document. It never rejects another model, the
model-list price, or the complete provider refresh.

## Normalization

The model-list price object publishes per-token values. Kmodels scales them exactly to prices per
million tokens and retains the original value and unit as evidence. Tier bounds are converted to
non-overlapping inclusive ranges. Regional, Fast, and named service-tier objects become conditions
on the same inference offer; they do not create separate commercial mechanisms.

Endpoint prices add `route_provider` and any exact regional condition. The endpoint API wins only
inside that exact route-qualified scope. Catalog summary rates remain valid outside it. A visible
model page fills an otherwise empty price object only when its amount, denominator, and route are
unambiguous. Compound cells such as `+N more` remain raw at the affected term.

The model inference book keeps one `usage` offer. Provider-native web and Maps prices move to two
shared service books whose model references express exact compatibility; no relation or settlement
graph is needed. Generic search tools each use one shared service book:

- Perplexity: `$5 / 1,000 requests`;
- Exa: `$7 / 1,000 requests`, plus `$1 / 1,000` requested results above ten; and
- Parallel: `$5 / 1,000 requests`, plus `$1 / 1,000` additional results above ten.

The Parallel excess-result amount remains published without a charge binding because the official
guide does not define a request or result field precisely enough. Missing binding is local and does
not erase the rate.

## Usage binding

Token rates bind to the generation record's native prompt, completion, cached, and cache-creation
counters when the partitions are exact. A base input-token rate is deliberately left unbound when
separate cache rates exist and the source does not establish whether prompt tokens include those
partitions. Provider-native web search binds to the published billable search-call counter. Maps
search remains unbound until Vercel publishes an exact counter contract.

Generic search requests bind to the selected gateway tool result. Exa excess results bind to the
requested result count above ten. These bindings describe how a Gateway can count usage; they do
not calculate totals in the catalog UI.

## Resilience and refresh

Tags, supported parameters, specification versions, model types, Regions, media operations, and
pricing dimensions are dynamic provider vocabulary. New strings are retained or ignored when
Kmodels has no reviewed semantic mapping; they do not reject the model row. Unknown object fields
are stripped after the known claims are parsed.

Malformed model rows are isolated with a contract signal while valid siblings continue. A malformed
optional capability suppresses that capability rather than the model. Endpoint and model-page
fetch or parse failures are reported as claim-local omissions. Identity disagreement, duplicate
route ownership, a truncated exhaustive list, an unsafe count change, or an invalid final pricing
partition can still reject the provider refresh and retain the prior accepted snapshot.

Collection and normalization are deterministic and require no LLM. Refresh publishes the catalog
and pricing partition atomically after validation.
