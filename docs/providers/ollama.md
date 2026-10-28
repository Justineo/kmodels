# Ollama

## Product boundary

Ollama has two distinct catalog channels: a curated Library for models runnable by an operator and
Ollama Cloud for provider-hosted inference. Both belong in the model catalog. Only public Ollama
Cloud invocation rates belong in the price book.

Local execution has no Ollama-billed inference rate. The operator's hardware, electricity, hosting,
and deployment costs are neither Ollama public prices nor reconstructable from an upstream request,
so the collector does not publish a local-execution commercial book. Cloud subscriptions, plan
allowances, ordinal usage levels, seats, extra-usage balances, credits, taxes, invoices, and
enterprise terms are account commercial facts outside the AI Gateway request-cost boundary. They
are discarded rather than preserved as raw or unknown pricing.

Training, stored artifacts, and general account services are likewise outside scope. A provider
service such as Web Search can enter later only if Ollama publishes both a first-party public rate
and an exact request/result trigger. The existence of an API alone does not create a price term.

## First-party source graph

Library and Cloud parsers return the explicit source envelope. Cloud usage contracts belong to the
source independently of model observations, so empty or filtered model results cannot discard
them from compilation input. The independent inventory bounds and exact Cloud identity joins
still apply. Replaying source facts does not turn a Library identity into a priced Cloud offer.

- The [Ollama Library](https://ollama.com/library) supplies curated family identities,
  descriptions, capability badges, and update dates. It is non-exhaustive and does not claim a
  public Ollama invocation price.
- Public [`GET /api/tags`](https://ollama.com/api/tags) and the
  [Cloud-filtered Library](https://ollama.com/search?c=cloud) are independent current Cloud inventory
  witnesses. The collector takes their exact-ID union, then requests each reviewed family page and
  `POST /api/show` for claim-local enrichment.
- A Cloud family page may publish an exact token rate card. It is the current first-party source for
  model rates. The collector extracts numeric input, cached-input, and output amounts, their
  denominator, and exact named variants such as `Base` and `Peak`; plan and credit prose is
  intentionally not transported into canonical pricing.
- The fixed [Cloud guide](https://docs.ollama.com/cloud) supplies route and lifecycle facts,
  including structured retirement tables. Retirement applies to an exact Cloud route and does not
  retire a still-current Library identity.
- The fixed [native usage guide](https://docs.ollama.com/api/usage),
  [OpenAPI document](https://docs.ollama.com/openapi.yaml), and
  [OpenAI-compatibility guide](https://docs.ollama.com/api/openai-compatibility) establish supported
  routes and public usage behavior.
- Exact released source from Ollama `v0.33.3` establishes the wire contract that the prose and
  OpenAPI do not fully describe: native cached-token fields, OpenAI-compatible usage conversion,
  terminal `include_usage` chunks, and Responses usage events. The tag is deliberately pinned so a
  moving branch cannot silently change a calculation input; a provider review bumps it.

The fixed [pricing page](https://ollama.com/pricing) supplies an independent model token-price table
and Off-Peak schedule. Only its owned `Model pricing` section, per-million-token claim, exact column
headers and linked model identities establish rates. Rows join current Cloud identities exactly;
a table row cannot admit a model or spread a family rate to a named size. Subscription sections
remain outside the price book. Agreeing family-page and central quotes share canonical rates;
conflicting quotes become local raw evidence while safe sibling meters survive. No source wins by
document order. Collection does not discover arbitrary commercial pages through `llms.txt`.

## Catalog and identity rules

- Library family IDs are accepted exactly as published. The collector does not enumerate arbitrary
  community namespaces or tags from a local daemon and does not invent size, quantization,
  `:cloud`, or `-cloud` identities.
- Cloud list IDs, Cloud search families, normalized family-page tags, and Show detail identities are
  reconciled by exact ID. `remote_model` and `remote_host` are recognized transport fields but do not
  mint another catalog identity.
- Exact overlaps retain both `Ollama Library` and `Ollama Cloud` service-family evidence. A missing
  list, page, or Show detail cannot erase an identity supplied by another current witness.
- Show capabilities and model metadata enrich tasks, modalities, context limits, and update dates.
  A `/api/show` `thinking.values` list containing named levels establishes effort control; malformed
  thinking metadata is isolated as a contract signal without discarding the model.
  Unknown additive fields and enum values produce bounded diagnostics and suppress only the affected
  claim.
- A `decision` badge or Show capability establishes classification with structured output. A vision
  badge adds image input; a typed judgment does not imply generated text output. Cloud Decision
  models use the documented [System One endpoint](https://docs.ollama.com/api/systemone.md).
  Generate/Chat usage contracts do not establish System One accounting. Library cards may omit
  update dates. List/Show modification instants are compared in UTC and projected to the latest day;
  differently formatted or independently updated observations are not contradictory lifecycle claims.
  Unused additive list properties remain informational; malformed consumed fields stay actionable.
- Library cards describe a model with a paragraph inside the card's intro block; Cloud-filtered
  cards place the same paragraph directly under the card link, beside an inline `Updated` timestamp
  span. Card extraction accepts either position and reports a missing description only when both are
  empty. The `Updated` span label is relative ("1w"), so Cloud cards take lifecycle dates from
  List/Show modification instants rather than that label.
- A Cloud retirement is applied globally only when the exact identity is absent from the current
  Library. Current Library evidence keeps the shared catalog identity active.

## Canonical price book

Every Cloud family page with a valid public rate card produces one model-scoped `cloud-inference`
offer. A simple card has up to three shared rate terms; for example, Kimi K3 publishes:

- input text: USD 3 per million tokens;
- cached input text: USD 0.30 per million tokens;
- output text: USD 15 per million tokens.

Named family-card periods come from visible button labels. Internal `data-rate` keys are UI state
and may have the opposite meaning: a key named `base` can display Peak, while `peak` displays
Off-Peak. Missing or ambiguous labels cannot establish a conditional numeric quote.
The central table's explicit Off-Peak rows and their paired standard rows establish `off_peak` and
`peak` variants. The owned schedule uses the shared weekly UTC rule: Peak is weekdays from 12:00
to 18:00, and Off-Peak is the remainder, including weekends. Windows follow the shared inclusive
start/exclusive end convention. The caller resolves the period from its billing instant and supplies
that selector. SDK `evaluatedAt` controls snapshot and quote validity; it does not supply a server
billing timestamp or implicitly select a period. If that exact schedule claim drifts, prices remain
manually selectable and the structured rule is withheld. Legacy `Base` labels
remain separate caller selections unless their meaning is established by the source.
Snapshots that recorded only internal rate keys do not establish the displayed period's
applicability. Their original quotes remain raw evidence until a fresh owned source establishes it;
current labels and schedules are never assigned to historical observations.

An unrecognized or missing component quote, including a table dash, remains raw unknown evidence
rather than zero. The central table separates Input from Cached input; its input rates retain the
uncached-input binding even when the cache amount itself is unavailable.

The Pro/Max access gate and extra-usage-credit settlement do not qualify list rates and are not price
dimensions. An ordinal Low/Medium/High usage class is an allowance-consumption label, not a currency
rate or proof that pricing is explicitly unpublished. Models without admitted rates remain
`pricing_state: unknown` and do not create empty price books.

The canonical Ollama topology therefore contains only model books with public request rates. It has
no provider-resource books, subscription rates, local-execution offer, allowance terms, enrollment,
settlement, or commercial relations.

## Usage binding

Kmodels publishes calculation inputs, not a runtime request ledger. A consumer captures an Ollama
response or terminal stream event, resolves one of the published locators, and evaluates the closed
quantity method. The price book supplies the following alternatives.

Native Generate and Chat responses expose:

- `prompt_eval_count`: total input tokens processed;
- `prompt_eval_cached_count`: input tokens read from cache;
- `eval_count`: output tokens generated.

Streaming native responses expose those fields only on the final `done: true` chunk. The same
quantities are available through Ollama's OpenAI-compatible surfaces:

- Chat Completions and Completions non-stream responses use `usage.prompt_tokens`,
  `usage.prompt_tokens_details.cached_tokens`, and `usage.completion_tokens`.
- Their streams expose the same pointers in the terminal usage chunk only when the request sets
  `stream_options.include_usage`.
- Responses non-stream results use `usage.input_tokens`,
  `usage.input_tokens_details.cached_tokens`, and `usage.output_tokens`.
- A Responses stream exposes the corresponding fields under `response.usage` on the terminal
  `response.completed` event.

For a card with separate input and cached-input prices, the input term binds to
`max(total_input_tokens - cached_input_tokens, 0)`, the cached-input term binds directly to cached
tokens, and output binds directly to output tokens. Each native, Chat Completions, Completions, and
Responses response/stream pairing is a separate alternative method, so fields from two protocols
cannot be mixed accidentally. A card without a cache rate may bind input directly to total input.

Pricing-input extraction is field-local. Drift in one cached field or one streaming terminal
contract removes only the affected locators. Known cache subtraction and surviving mappings
remain within their protocol and channel method; required unmapped signals remain caller inputs.
Rates, identities, and sibling inputs survive. Kmodels does not add a raw accounting pseudo-term or claim that a runtime event was
captured. Ollama's Responses implementation currently emits `reasoning_tokens: 0` with an upstream
TODO, so Kmodels does not expose it as a trustworthy thinking-token input.

## Resilience and refresh

- Model list, search, page, and Show results are parsed row by row. Malformed entries and newly
  observed fields are localized; recognized siblings survive.
- Page tags are used only for exact Cloud identity discovery. Unknown presentation labels do not
  reject the page or provider.
- Malformed rate fields suppress only that meter within that named variant. A valid input, cached,
  output, Base, or Peak sibling remains published.
- A mismatched page origin, path, model ID or title cannot supply prices or additional tag identities.
  Independently witnessed list/catalog identities survive. A malformed central pricing dependency
  retains the accepted commercial partition while catalog observations can still refresh.
- Absence of a rate card means unknown price, not `not_published`. A previous verified rate is
  removed only when a fresh exhaustive source disproves it under the provider-atomic publication
  rules.
- Inventory witnesses run independently, while per-model page and Show requests use bounded
  concurrency. Refresh requires no LLM or authenticated local runtime.
- Downstream catalogs such as models.dev, LiteLLM, or OpenRouter can be comparison inputs but never
  authority for Ollama identity, lifecycle, or price.
