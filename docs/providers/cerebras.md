# Cerebras

## Boundary

Cerebras is represented as a public AI Gateway price book. Kmodels publishes the public
shared-inference rates and the machine-readable inputs needed to calculate one synchronous response
or terminal stream. Batch is retained as an existing but `not_published` inference offer.

Kmodels does not model Free Trial credits, subscriptions, Dedicated capacity, training,
fine-tuning, Batch file retention, Marketplace settlement, projects, quotas, account analytics, or
invoice reconciliation. Private-preview service tiers apply to dedicated endpoints and currently
have no separate public rate, so they do not create a public price dimension or selector.

## First-party source graph

- [`GET /public/v1/models`](https://api.cerebras.ai/public/v1/models) is the primary current,
  machine-readable inventory and rate source. Its OpenRouter and Hugging Face serializers are
  alternate projections, not independent evidence.
- The [Model Catalog](https://inference-docs.cerebras.ai/models/overview) supplies exact callable
  IDs, maturity, endpoints, features, limits, scheduled lifecycle facts, and structured model-card
  rates.
- [Chat Completions](https://inference-docs.cerebras.ai/api-reference/chat-completions) and
  [Completions](https://inference-docs.cerebras.ai/api-reference/completions) establish request
  routes and response usage fields.
- [Prompt Caching](https://inference-docs.cerebras.ai/capabilities/prompt-caching) establishes the
  cached-token counter and that cached input uses the standard model input rate.
- The official
  [Python SDK](https://github.com/Cerebras/cerebras-cloud-sdk-python#streaming-responses) establishes
  that streaming usage is present only in the final chunk.
- [Batch](https://inference-docs.cerebras.ai/capabilities/batch) establishes its route,
  successful-result usage fields, completed-request charging rule, and absence of a published
  public amount.
- Deprecations and release notes remain independent identity/lifecycle sources. Authenticated
  `/v1/models` is only an optional account-scoped inventory witness.

The collector uses fixed companions rather than crawling every commercial-looking page. This keeps
the source bundle deterministic and prevents unrelated account products from becoming pricing
facts.

## Rates and calculation inputs

Public model rates are USD per million tokens. The native per-token API values are scaled with exact
decimal arithmetic. A structured model-card rate is independent supporting evidence; narrative
duplicates are not parsed as additional rates.

For prompt-cache-capable models, Kmodels preserves the provider's explicit same-price cache split:

```text
cached input   = usage.prompt_tokens_details.cached_tokens
uncached input = max(usage.prompt_tokens - cached input, 0)
output         = usage.completion_tokens
```

The subtraction is a closed, dimension-checked calculation graph. It is not a script or a runtime
policy. A calculator may use any published alternative that is present in its evaluation record.

| Protocol / channel   | Canonical quantity    | Source locator                               | Availability         |
| -------------------- | --------------------- | -------------------------------------------- | -------------------- |
| Chat response        | total input           | `/usage/prompt_tokens`                       | successful response  |
| Chat response        | cached input          | `/usage/prompt_tokens_details/cached_tokens` | successful response  |
| Chat response        | output                | `/usage/completion_tokens`                   | successful response  |
| Chat stream          | same three quantities | same locators on the final chunk             | terminal only        |
| Completions response | same three quantities | same locators                                | successful response  |
| Completions stream   | same three quantities | same locators on the final chunk             | terminal only        |
| Batch result item    | total input           | `/response/usage/prompt_tokens`              | successful item only |
| Batch result item    | output                | `/response/usage/completion_tokens`          | successful item only |

Chat and Completions contracts are field-local. Drift in one field removes only the affected input
method; it does not erase the model, rate, endpoint, or sibling quantity. Missing terminal usage after
an interrupted stream is a downstream capture outcome, not a Kmodels lifecycle problem.

`usage.image_tokens` and `usage.completion_tokens_details.reasoning_tokens` are breakdowns of the
already billed prompt or completion totals. Cerebras does not publish separate image or reasoning
rates, so Kmodels binds the full prompt and completion totals and does not mint duplicate modality or
thinking charges.

## Batch

Batch is directly callable asynchronous inference and remains inside the boundary. Cerebras
currently documents only `/v1/chat/completions`, exposes prompt/completion usage on successful result
items, and charges only completed requests, but publishes no Batch amount or discount. The canonical
result is therefore one provider-level Batch offer in `not_published` state with no fabricated rate
or raw pseudo-price.

The extracted Batch result locators are retained as source calculation inputs so a future published
rate can bind without changing quantity semantics. Until an amount is published, no total can be
calculated and the synchronous rate is not copied into Batch.

## Resilience

- Unknown additive API fields are accepted with a contract signal.
- Malformed inventory rows, rate components, model cards, usage fields, and lifecycle references are
  isolated to the affected claim.
- Missing model cards retain exact catalog identities. Missing usage companions retain numeric rates
  but omit unsupported quantity methods.
- Source conflicts choose the stronger exact structured observation and remain visible in pricing
  reconciliation.
- A failed optional source never erases valid sibling facts. Provider snapshot preservation remains
  the last resort when the required exhaustive source cannot form a complete snapshot.
- Downstream catalogs such as models.dev, LiteLLM, OpenRouter, and Hugging Face are comparison inputs,
  not Cerebras pricing authority.
