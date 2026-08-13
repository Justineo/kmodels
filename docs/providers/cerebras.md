# Cerebras

## Product boundary

Cerebras pricing is modeled as an AI Gateway rate book, not as a catalog of every Cerebras
commercial product. A fact is admitted only when it prices direct inference or a provider-hosted
component of an inference request, has a first-party public rate or explicit price state, and can in
principle be selected and measured from the request or result.

The current book therefore contains public shared-inference token rates and the explicit unpublished
state of Batch. Free Trial credits, account subscriptions, Cerebras Code subscriptions, Dedicated
capacity, training and fine-tuning, Batch file retention, Marketplace settlement, projects, quotas,
metrics, and console cost reports are outside the request-cost boundary. They are neither normalized
nor retained as raw pricing facts.

## First-party source graph

- [`GET /public/v1/models`](https://api.cerebras.ai/public/v1/models) is the primary current,
  machine-readable inventory and rate source. Only its native Cerebras representation is collected;
  the OpenRouter and Hugging Face serializers are alternate projections of the same record, not
  independent evidence.
- The [Model Catalog](https://inference-docs.cerebras.ai/models/overview) supplies exact callable
  IDs, maturity, endpoints, features, limits, scheduled lifecycle facts, and structured `ModelInfo`
  rates. Only model cards linked from its Production and Preview tables are fetched; nearby guides
  such as model selection are not collector inputs.
- The fixed [Chat Completions](https://inference-docs.cerebras.ai/api-reference/chat-completions) and
  [Completions](https://inference-docs.cerebras.ai/api-reference/completions) references establish
  request routes and returned token quantities.
- [Prompt Caching](https://inference-docs.cerebras.ai/capabilities/prompt-caching) establishes both
  `usage.prompt_tokens_details.cached_tokens` and the rule that cached input uses the standard input
  rate.
- [Service Tiers](https://inference-docs.cerebras.ai/capabilities/service-tiers) establishes that all
  current preview tiers are billed equally. This guards the unconditional applicability of the
  model rates; service tier is not emitted as a price dimension while it does not change price.
- [Batch](https://inference-docs.cerebras.ai/capabilities/batch) establishes the currently supported
  route, successful-result usage, completed-request charge trigger, and absence of a published public
  amount.
- Deprecations and release notes remain independent identity/lifecycle sources. Optional authenticated
  `/v1/models` remains an account-scoped inventory witness and cannot create or remove global rows.

Collection deliberately does not crawl `llms.txt` for commercial-looking pages or parse the dynamic
marketing pricing page. Those surfaces duplicate stronger structured sources and previously widened
the collector into unrelated billing products. Fixed relevant companions make refresh deterministic
without a content-keyword allowlist.

## Rate and binding rules

- The public API's exact model ID and native rate fields are the strongest current rate observation.
  Structured model-card rates are an independent official claim. Narrative prose that repeats those
  fields is not parsed as another price observation.
- Rates are USD per million tokens. The canonical token denominator is reconstructed without
  floating-point arithmetic.
- For prompt-cache-capable models, input cost is split into:
  - cached input = `usage.prompt_tokens_details.cached_tokens`;
  - uncached input = `usage.prompt_tokens - usage.prompt_tokens_details.cached_tokens`.
- Without a verified cache contract, input remains bound to total `usage.prompt_tokens` and no cache
  rate is emitted. Output binds to `usage.completion_tokens`.
- Chat and legacy Completions bindings are independently guarded. Drift in one usage contract removes
  only that route's binding observation. It does not remove the model, numeric rate, sibling endpoint,
  or other meter.
- Drift in the service-tier equality claim removes charge binding because the existing unqualified
  rate would no longer have proven applicability. Numeric rates remain visible as unbound facts.
- Accounting-gap markers are internal assembly controls. They are consumed when bindings are built
  and are not published as user-facing raw pricing exceptions.

## Batch

Batch is direct asynchronous inference and is therefore inside the product boundary. Cerebras
currently documents only `/v1/chat/completions`, charges only completed requests, and returns ordinary
prompt/completion usage, but publishes no Batch amount or discount. The canonical result is one
provider-level Batch offer with `not_published` pricing and one informational charge-trigger fact.

The collector does not infer model-by-model Batch compatibility from an example ID, copy synchronous
rates into Batch, mint a storage offer for its input file, or add relations to PAYG. If Cerebras later
publishes a Batch rate and exact applicability, it can use the same shared offer/variant/rate/binding
model.

## Resilience and refresh

- Unknown additive API fields and serializer extensions are accepted with a contract signal.
- Malformed inventory rows, rate components, model cards, usage companions, and lifecycle references
  are isolated to the affected claim.
- Missing model cards retain exact catalog identities. Missing usage companions retain numeric rates
  but withhold only unsupported charge bindings.
- Source conflicts choose the stronger exact structured observation and remain visible in pricing
  reconciliation.
- A failed optional source never erases valid sibling facts. Provider snapshot preservation remains
  the last resort only when the required exhaustive source cannot form a complete snapshot.
- Refresh is deterministic and requires no LLM. Downstream catalogs such as models.dev, LiteLLM,
  OpenRouter, or Hugging Face are not authority for Cerebras inventory or prices.
