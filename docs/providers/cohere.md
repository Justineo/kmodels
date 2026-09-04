# Cohere

Status: current

## Boundary

Cohere contributes only public rates for Cohere-hosted inference that an AI Gateway can attribute
to one request or result. The canonical partition contains model books with one hosted-inference
offer, exact rate terms, applicability variants, semantic charge bindings, and provider-documented
quantity methods. Kmodels is the price-book layer: it publishes which observations a cost service
must capture, but it does not observe requests, detect interrupted streams, aggregate usage, or
reconcile invoices.

The following Cohere products are outside the rate-book boundary and are neither normalized nor
retained as raw commercial facts:

- general trial-key plans, rate-limit allowances, account enrollment, credits, invoices, and
  settlement;
- Model Vault instances, Fixed/Flex commitments, encrypted capacity, and private deployments;
- training, customization, stored datasets, downloaded weights, and licenses; and
- North, Compass, and other application or orchestration products.

Model-specific Cohere-hosted access explicitly published as free remains an exact model offer.
General trial-key usage does not create a second free offer for every model. A Model Vault or
contact-sales alternative does not turn an otherwise unknown hosted inference price into
`custom_quote`.

Prices published only for “existing customers” are account-entitlement facts, not globally
selectable request rates. They are excluded rather than attached unconditionally to legacy model
IDs. A separately published public model rate, such as the Aya Expanse API rate, remains in scope.
“Free until rate limits” is an exact zero request rate for the named API path: reaching the service
limit rejects further requests rather than selecting a paid fallback. The limit itself is not a
price-book allowance.

Batch and Embed Jobs remain catalog endpoint facts when first-party model documentation names them.
They do not receive price books until Cohere publishes an exact amount, an explicit same-price rule,
or another exact non-numeric price state. Absence of a separate price is unknown, not
`not_published`.

## Sources and identity

- The public model index at `https://docs.cohere.com/docs/models/llms.txt` discovers Cohere model
  pages. The maintained Models overview, exact cards, deprecations, release notes, and API
  references establish model identity, lifecycle, tasks, modalities, endpoints, and limits.
- `https://cohere.com/pricing` is a separate required pricing overlay. Its embedded structured
  model records establish token, embedding, rerank-search, and explicit model-specific free prices.
  Each newline-delimited record in its Next.js RSC stream is decoded independently.
  Separating it from the model bundle lets catalog identity advance when pricing transport or
  structure is unavailable while the last accepted provider pricing partition remains intact.
- `https://docs.cohere.com/docs/how-does-cohere-pricing-work.md` establishes the pricing meters and
  that `billed_units`, rather than generic token totals, are the billable usage counters.
- Chat V2/V1, their streaming references, Embed V2, and Rerank V2 establish endpoint-local
  response fields. The model source explicitly owns `pricing_inputs` in addition to catalog and
  model-card pricing facts. The authenticated `/v1/models` inventory is optional, account-scoped
  corroboration and cannot create global models, prices, or accounting contracts. Enable it with
  `COHERE_API_KEY`.

Callable IDs come only from labeled Cohere model fields or the exact documented Command A card
correction. That correction requires agreement between card title and path, one exact SDK ID in an
official release note, and a separate path-matching card for the incorrect ID. Price matching uses
one exact model ID, one documented alias, or one unique normalized product label; it never uses
family inheritance or fuzzy matching. Model-card rates use catalog evidence; central price-book
rows use the stronger price-book evidence class.

## Pricing mapping

- Generative input and output amounts map to `input_text` and `output_text` per token.
- Embed text and image amounts map to `embedding` per token with a modality applicability condition.
- Rerank amounts map to `rerank` per Cohere search unit. One search unit is the source-native billed
  unit and is not rewritten as an ordinary HTTP request.
- Retired models receive an exact `not_applicable` disposition and retain no current hosted rate.
  Missing prices for current models remain unknown; absence never means free.
- Responsive copies of the same structured pricing product must agree. A disagreement removes only
  that product payload and records a local conflict; other products and card rates survive.

Bindings use Cohere's billed counters, not the similarly named generic token counters. The source
publishes the following exact acquisition contracts:

- Chat V2: `response.usage.billed_units.input_tokens` and `output_tokens`;
- Chat V2 streaming: terminal `message-end.delta.usage.billed_units.input_tokens` and
  `output_tokens`;
- Chat V1: `response.meta.billed_units.input_tokens` and `output_tokens`;
- Chat V1 streaming: terminal `stream-end.response.meta.billed_units.input_tokens` and
  `output_tokens`;
- Embed V2: `response.meta.billed_units.input_tokens` or `image_tokens`; and
- Rerank V2: `response.meta.billed_units.search_units`.

Each price variant keeps a semantic charge signal even if no current response contract resolves
it. When a matching contract exists, `quantity_methods.input_sources` gives the response or
terminal-stream JSON Pointer, channel, availability, and aggregation boundary. Text embedding uses
the standard `input_tokens` signal. Image embedding and reranking retain provider-owned
`billed_image_tokens` and `billed_search_units` signals because collapsing them into generic token
or request counters would lose Cohere's billing semantics.

The standard OpenTelemetry GenAI token attributes are not an exact alternative for Cohere. They do
not identify Cohere's `billed_units` partition, and the current convention has no portable Cohere
rerank search-unit or image-token field. A runtime may emit the provider JSON values through its
own telemetry pipeline, but Kmodels does not claim an `otel_attribute` source until a standard
attribute has the same billing meaning.

A missing or drifted accounting field removes only that input source. It does not create a raw
price term, erase the semantic charge binding, or invalidate the numeric rate. A completed stream
has its counters only in the terminal event; Kmodels declares `terminal_only`, leaving interruption
detection and incomplete-attempt policy to the consuming runtime.

The current exact gaps are:

- the OpenAI-compatible Chat Completions guide does not establish that OpenAI-style usage fields
  are the authoritative Cohere billed counters, so no compatibility-path quantity method is
  published;
- Generate V1 has no reviewed billed-unit acquisition contract in this price book;
- Embed Jobs are not attached to online Embed rates without an explicit same-price rule, even
  though their job metadata exposes accounting-looking fields;
- Cohere Transcribe is published as model-specific free access where documented, while Model Vault
  instance pricing remains outside request-rate scope; and
- account reports and invoice reconciliation are runtime or billing-system inputs, not data that
  Kmodels can produce before invocation.

## Refresh resilience

The source is non-exhaustive and refreshed without an LLM. Known catalog sections, endpoint labels,
and documents are parsed independently:

- an unknown section or endpoint label is ignored locally rather than rejecting Cohere;
- a missing discovered model page is reported as a partial source and removes only facts owned by
  that page;
- an API-reference drift removes only the affected quantity input while preserving endpoint
  identity, the semantic charge binding, and the rate;
- malformed embedded pricing frames and unsupported products, units, or meters are isolated;
- an additive Models API field, malformed row, or new endpoint value is signaled and isolated
  without rejecting recognized sibling rows or known endpoint facts;
- duplicate prices are deduplicated, while conflicting amounts become a claim-local diagnostic; and
- lifecycle and model-count guards still reject a bundle that no longer resembles the Cohere
  catalog at all.

Because the source is not exhaustive, omission does not prove model removal. Provider-atomic
publication retains the previously accepted Cohere pricing partition if the required pricing
overlay is unavailable or the assembled partition fails validation. Missing optional accounting
or release companions removes only their local facts or methods; missing optional discovered
cards does not block independently refreshed central prices.
