# Meta Llama

Status: current

## Boundary

Meta publishes downloadable Llama weights and operates Meta Model API. The catalog keeps the
existing `llama` provider identity and artifact descriptors. A separate public source adds hosted
Model API IDs and their direct request prices; it does not rename or merge existing artifacts.

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

The public [Models](https://dev.meta.ai/docs/models) and
[Pricing and rate limits](https://dev.meta.ai/docs/pricing-rate-limits) pages establish exact hosted
IDs and current tariffs. The old Llama developer documentation entry point now redirects to this
Model API documentation. The `meta-model-api` source reads these two public HTML pages; no account,
protocol discovery, SDK or request template is required to associate their prices.

- Muse Wonder and Muse Spark publish cached input, uncached input and output token prices.
  Standard and Contributor are distinct literal request IDs. The model availability row and the
  pricing declaration must agree on the mode; a `-contributor` suffix alone establishes nothing.
  Contributor mode permits Meta to use submitted content and responses to train future models.
  This distinction is described on the model, rather than exposed as a redundant price selector.
- Muse Image is priced per successfully generated and returned image. Failed or safety-filtered
  images do not count. Built-in search is included; response token counts do not add token charges.
- Muse Voice Transcribe is priced per hour of processed audio, rounded down to whole seconds.
  Streaming and file transcription have the same price. Zero data retention has no premium.
- SAM 3.1 has separate per-image and per-video-frame rates. Video quantities are already-billed
  frames, including the 50-frame request minimum, rather than the raw clip's frame count.
  The model description exposes this minimum in the website; the unit price alone is insufficient.
- Text-model web search is an independent service rate per 1,000 queries. It is not attached to
  an arbitrary model row and is not part of Muse Image's separately included search.

The parser emits exact-ID associations to the existing canonical model usage offers. All numbers
come from the current tables; no rate is inferred from a related family, partner, prefix or amount.
The website and portable lookup share these associations. An absent price declaration withdraws
that ID's association while preserving the independent catalog identity. An unknown pricing mode,
unit, new unreviewed hosted line or changed accounting rule rejects the source for review.

The price book binds caller-supplied billable quantities. It does not currently publish extraction
formulas for all Model API response protocols. In particular, callers must supply uncached and
cached input separately, floored audio seconds, and minimum-adjusted video frames. This limit does
not prevent publishing an independently established rate. Registry creation timestamps are not
release dates; country access restrictions are not regional pricing without commercial evidence.
Muse Spark Open, Muse Glimmer, Muse Code subscriptions and partner-operated endpoints have no
direct Model API tariff through this source.

## Earlier Llama API evidence

The reviewed public Llama SDK proves two exact Chat identities—
`Llama-3.3-70B-Instruct` and
`Llama-4-Maverick-17B-128E-Instruct-FP8`—and one exact Moderations identity,
`Llama-Guard-4-12B`. Each resolves to an existing registry row and receives its exact
Meta route.

The reviewed sources establish these hosted routes without a public numeric rate or an explicit
non-publication claim. Pricing therefore remains `unknown` for hosted identities and other registry
artifacts, and produces no price book. A route's existence cannot establish `not_published`, free
usage or any other commercial state. Never project a hosted example or route to siblings.
The registry/SDK source remains catalog evidence rather than pricing evidence. The new Model API
price book does not establish tariffs for these earlier hosted IDs or downloadable Llama artifacts.

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
- Refresh is deterministic and uses first-party repository, SDK, release-page, public Model API
  documentation, and optional authenticated API inputs. No comparator catalog, inference, or LLM is
  needed. Model API fixtures exercise collection, canonical rates, static lookup, UI projection,
  price withdrawal and commercial-rule drift. Stored-data adoption remains a separate operation.
