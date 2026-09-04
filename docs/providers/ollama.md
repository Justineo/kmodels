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

Collection deliberately does not scan `llms.txt` for commercial-looking pages or dynamically fetch
pricing, terms, authentication, capability, and subscription pages. Those surfaces either duplicate
stronger inputs or describe facts outside the rate-book boundary. The reviewed compatibility page
is a fixed input. This source graph keeps refresh deterministic without a brittle content-keyword
allowlist.

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
  Unknown additive fields and enum values produce bounded diagnostics and suppress only the affected
  claim.
- A Cloud retirement is applied globally only when the exact identity is absent from the current
  Library. Current Library evidence keeps the shared catalog identity active.

## Canonical price book

Every Cloud family page with a valid public rate card produces one model-scoped `cloud-inference`
offer. A simple card has up to three shared rate terms; for example, Kimi K3 publishes:

- input text: USD 3 per million tokens;
- cached input text: USD 0.30 per million tokens;
- output text: USD 15 per million tokens.

Some pages publish separate `Base` and `Peak` amounts. Kmodels preserves both as exact
`billing_period` variants. Ollama does not currently publish a first-party schedule or response
field that says which period applies, so Kmodels does not invent a clock rule or selector source.
Consumers can display both variants and may select one only when they possess an independently
authoritative period value. This is a selector gap, not a reason to discard either rate.

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
contract removes only the affected locators and methods. Rates, identities, and sibling inputs
survive. Kmodels does not add a raw accounting pseudo-term or claim that a runtime event was
captured. Ollama's Responses implementation currently emits `reasoning_tokens: 0` with an upstream
TODO, so Kmodels does not expose it as a trustworthy thinking-token input.

## Resilience and refresh

- Model list, search, page, and Show results are parsed row by row. Malformed entries and newly
  observed fields are localized; recognized siblings survive.
- Page tags are used only for exact Cloud identity discovery. Unknown presentation labels do not
  reject the page or provider.
- Malformed rate fields suppress only that meter within that named variant. A valid input, cached,
  output, Base, or Peak sibling remains published.
- Absence of a rate card means unknown price, not `not_published`. A previous verified rate is
  removed only when a fresh exhaustive source disproves it under the provider-atomic publication
  rules.
- Inventory witnesses run independently, while per-model page and Show requests use bounded
  concurrency. Refresh requires no LLM or authenticated local runtime.
- Downstream catalogs such as models.dev, LiteLLM, or OpenRouter can be comparison inputs but never
  authority for Ollama identity, lifecycle, or price.
