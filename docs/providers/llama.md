# Meta Llama

Status: current

## Boundary

Meta is both the publisher of downloadable Llama weights and the operator of a
limited Llama API. The catalog records official model artifacts because they are
valid deployment candidates. The Meta price book records only direct calls to
Meta-operated generation or moderation routes.

Artifact downloads, licenses, acceptable-use terms, local inference, training,
storage, reserved compute, deployment partners, grants, credits, and settlement are
outside pricing. They do not become free, externally billed, or unpublished offers:
they simply are not request rates sold by Meta. A managed Llama rate belongs to the
provider that operates and bills that route.

## Sources and identity

- Statically parse the official
  [`llama-models`](https://github.com/meta-llama/llama-models) registry used by
  `llama-model list --show-all`; never execute remote Python.
- The exact registry descriptor, including its variant, is `model_id`. The official
  Hugging Face repository is an alias. Parse every `CoreModelId`, family assignment,
  descriptor, and closed numeric context rule; incomplete registry semantics reject
  this exhaustive source.
- The registry README, exact model cards, and Meta release pages establish release
  dates, modalities, tasks, and family capabilities. Repository commits are not model
  release dates.
- The official
  [`llama-api-python`](https://github.com/meta-llama/llama-api-python) SDK establishes
  the API origin, routes, response shape, and only the exact model IDs used by reviewed
  examples. SDK documents are optional, claim-local dependencies: one missing or
  changed file suppresses only the affected hosted alias, route, or capability while
  the artifact registry still refreshes.
- Authenticated `GET /v1/models`, enabled by `LLAMA_API_KEY`, is a non-creating account
  inventory. It can enrich matching catalog rows but cannot create a public model or
  retire one absent from the account. Unknown root or item fields are accepted with a
  contract signal. Identity and the model object kind are required; malformed unused creation or
  owner metadata cannot erase a valid identity. Invalid identities are skipped independently.

## Hosted pricing

The reviewed public SDK proves two exact Chat identities—
`Llama-3.3-70B-Instruct` and
`Llama-4-Maverick-17B-128E-Instruct-FP8`—and one exact Moderations identity,
`Llama-Guard-4-12B`. Each resolves to an existing registry row and receives its exact
Meta route.

The reviewed sources establish these hosted routes without a public numeric rate or an explicit
non-publication claim. Pricing therefore remains `unknown` for hosted identities and other registry
artifacts, and produces no price book. A route's existence cannot establish `not_published`, free
usage or any other commercial state. Never project a hosted example or route to siblings.
The registry/SDK source is catalog evidence rather than a pricing source. Meta has no canonical
commercial partition or calculator-provider export until an admitted commercial source exists;
the complete catalog still exposes every model with unknown pricing.

Dated limited-preview announcements cannot establish current free usage. Partner-operated
routes have their prices under the provider that operates and bills them.

The Chat response and stream expose open `{metric, value, unit}` entries, but the
first-party SDK does not enumerate stable metric names, define their aggregation or
terminal semantics, or relate them to a billed quantity. These generic types establish no `pricing_inputs`:
a runtime-selected metric name is not a stable acquisition contract for input,
output, cached, or reasoning tokens. The Moderations response publishes no usage
quantity at all. Request fields such as `max_completion_tokens` are controls rather
than observed billable quantities and are not accounting evidence.

The consumer owns request/result observation and measured quantities. Kmodels publishes neither
dynamic provider-field placeholders nor assumed OpenAI-compatible token semantics.
Caller-defined function tools, streaming,
structured output, and image input are capabilities, not separate charges without
official rate evidence.

## Resilience and refresh

- Registry identity, family, descriptor uniqueness, count bounds, context rules, and
  required release evidence remain source-level invariants because partial acceptance
  would make the exhaustive catalog misleading.
- Hosted identities, routes and examples are fact-local. Drift emits diagnostics and suppresses
  only the dependent claim. Actual authenticated inventory responses are validated at their own
  boundary; unused SDK wrapper types, generic metrics and historical preview pages are not fetched
  or audited as catalog or pricing dependencies.
- Optional hosted-document omissions retain the last verified affected facts and mark
  the source partial; independently observed registry facts continue to advance.
- Hosted route proofs require the reviewed HTTPS `api.llama.com` origin without a custom port.
  Another SDK origin suppresses the dependent routes while independently verified registry facts
  survive. Generic metrics and unknown prices are deliberate source limits, not failed rate parsing.
- Refresh is deterministic and uses only first-party repository, SDK, release-page,
  and optional authenticated API inputs. No comparator catalog, inference, or LLM is
  needed.
