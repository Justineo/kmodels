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
  model rates. The collector extracts only the numeric input, cached-input, and output amounts and
  their denominator; plan and credit prose is intentionally not transported into canonical pricing.
- The fixed [Cloud guide](https://docs.ollama.com/cloud) supplies route and lifecycle facts,
  including structured retirement tables. Retirement applies to an exact Cloud route and does not
  retire a still-current Library identity.
- The fixed [native usage guide](https://docs.ollama.com/api/usage) and
  [OpenAPI document](https://docs.ollama.com/openapi.yaml) independently establish native token
  counters. Either can preserve the reviewed binding contract if the other is temporarily
  unavailable.

Collection deliberately does not scan `llms.txt` for commercial-looking pages or fetch pricing,
terms, compatibility, authentication, capability, and subscription pages. Those surfaces either
duplicate stronger inputs or describe facts outside the rate-book boundary. The fixed source graph
keeps refresh deterministic without a brittle content-keyword allowlist.

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

At the current snapshot, Kimi K3 is the only Ollama Cloud model page with a public numeric rate
card. It produces one model-scoped `cloud-inference` offer with three shared rate terms:

- input text: USD 3 per million tokens;
- cached input text: USD 0.30 per million tokens;
- output text: USD 15 per million tokens.

The Pro/Max access gate and extra-usage-credit settlement do not qualify these list rates and are not
price dimensions. Other Cloud models remain `pricing_state: unknown`; an ordinal Low/Medium/High
usage class is an allowance-consumption label, not a currency rate or proof that pricing is
explicitly unpublished. Models without admitted rates do not create empty price books.

The canonical Ollama topology therefore contains only model books with public request rates. It has
no provider-resource books, subscription rates, local-execution offer, allowance terms, enrollment,
settlement, or commercial relations.

## Usage binding

Native Generate and Chat responses expose:

- `prompt_eval_count`: input tokens processed;
- `eval_count`: output tokens generated.

Streaming responses expose these fields on the final `done: true` chunk. Output rates bind to
`eval_count` for the reviewed native `/api/generate` and `/api/chat` routes. These routes are fixed
by the same first-party usage/OpenAPI contract as the counters; binding does not depend on a model
page repeating global endpoint metadata.

Ollama publishes a distinct cached-input rate for Kimi K3 but does not publish a native counter that
separates cached from uncached input. Binding the ordinary input rate to total
`prompt_eval_count` would risk charging cached tokens at both rates or at the wrong rate. The input
and cached-input amounts therefore remain visible but unbound; only output is currently exactly
reconstructable. If a model has an input rate without a separate cache rate, the shared adapter may
bind it to `prompt_eval_count`.

Failure of both usage-contract witnesses removes only charge bindings through an internal
accounting-gap marker. It never removes numeric rates, model identities, or sibling price terms, and
the marker itself is not published.

## Resilience and refresh

- Model list, search, page, and Show results are parsed row by row. Malformed entries and newly
  observed fields are localized; recognized siblings survive.
- Page tags are used only for exact Cloud identity discovery. Unknown presentation labels do not
  reject the page or provider.
- Malformed rate fields suppress only that meter. A valid input or output sibling remains published.
- Absence of a rate card means unknown price, not `not_published`. A previous verified rate is
  removed only when a fresh exhaustive source disproves it under the provider-atomic publication
  rules.
- Inventory witnesses run independently, while per-model page and Show requests use bounded
  concurrency. Refresh requires no LLM or authenticated local runtime.
- Downstream catalogs such as models.dev, LiteLLM, or OpenRouter can be comparison inputs but never
  authority for Ollama identity, lifecycle, or price.
