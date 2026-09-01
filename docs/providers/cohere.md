# Cohere

Status: current

## Boundary

Cohere contributes only public rates for Cohere-hosted inference that an AI Gateway can attribute
to one request or result. The canonical partition contains model books with one hosted-inference
offer, exact rate terms, applicability variants, and optional charge bindings.

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
- Chat V2/V1, Embed V2, and Rerank V2 references establish endpoint-local response fields. The
  authenticated `/v1/models` inventory is optional, account-scoped corroboration and cannot create
  global models or prices. Enable it with `COHERE_API_KEY`.

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

Bindings use the exact documented response paths:

- Chat V2: `response.usage.billed_units.input_tokens` and `output_tokens`;
- Chat V1: `response.meta.billed_units.input_tokens` and `output_tokens`;
- Embed V2: `response.meta.billed_units.input_tokens` or `image_tokens`; and
- Rerank V2: `response.meta.billed_units.search_units`.

A missing or drifted accounting reference removes only the affected binding. The numeric rate and
unrelated route bindings remain publishable.

## Refresh resilience

The source is non-exhaustive and refreshed without an LLM. Known catalog sections, endpoint labels,
and documents are parsed independently:

- an unknown section or endpoint label is ignored locally rather than rejecting Cohere;
- a missing discovered model page is reported as a partial source and removes only facts owned by
  that page;
- an API-reference drift removes that endpoint and its charge binding while preserving the model
  and rate;
- malformed embedded pricing frames and unsupported products, units, or meters are isolated;
- an additive Models API field, malformed row, or new endpoint value is signaled and isolated
  without rejecting recognized sibling rows or known endpoint facts;
- duplicate prices are deduplicated, while conflicting amounts become a claim-local diagnostic; and
- lifecycle and model-count guards still reject a bundle that no longer resembles the Cohere
  catalog at all.

Because the source is not exhaustive, omission does not prove model removal. Provider-atomic
publication retains the previously accepted Cohere pricing partition if the required pricing
overlay is unavailable or the assembled partition fails validation. Missing optional accounting
or release companions removes only their local facts or bindings; missing optional discovered
cards does not block independently refreshed central prices.
