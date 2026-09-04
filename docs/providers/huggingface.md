# Hugging Face

Status: current

## Product boundary

Kmodels represents Hugging Face Inference Providers as a routed inference product, not as the
complete Hugging Face commercial platform. Catalog presence and pricing remain independent:

- a model may enter the catalog with an official live route even when no public rate is available;
- pricing cannot admit an ordinary Hub repository or a provider-native model that is not an admitted
  Hugging Face route; and
- training, repository storage, Spaces, Jobs, Inference Endpoint capacity, Hub plans, credits,
  account billing, and custom-provider-key settlement are outside the AI Gateway request-rate book.

The canonical Hugging Face pricing partition contains only model books for routed inference. Each
book has one `routed-inference` offer with route-qualified request rates, exact non-numeric states,
and bounded raw fallbacks. It does not publish provider-resource books, commercial relations,
resource edges, enrollment, allowances, or settlement.

## Catalog identity

The ordinary Hub is an artifact registry and is not the catalog boundary. Kmodels admits the
deterministic union of four positive first-party signals:

1. an exact live `hf-inference` mapping;
2. an exact model in the OpenAI-compatible router catalog;
3. an exact model with live mappings from at least two distinct integrated providers; or
4. an exact live mapping named by an official task page as a recommended model or in its bounded
   `InferenceSnippet` provider mapping.

This keeps HF-operated and specialized single-provider models without admitting every mechanical
partner deployment. There is no model-name heuristic, popularity threshold, modality cutoff, fixed
task allowlist, or Top-N. A newly published official task page or route enters mechanically.

The mapping collector reads the documented live registries for the integrated partners and
discovers task pages from the official task index on every refresh. It preserves every concrete
route and its provider model ID. Dynamic LoRA tag filters are routing contracts rather than stable
model identities and are excluded with a reconciliation record.

The Hub `hf-inference` query only overlays exact repository `lastModified` dates. It cannot create
catalog presence, and repository creation time is not treated as model release time.

## First-party sources

- `GET /api/partners/{provider}/models?status=live` and the official task pages establish current
  concrete routes and bounded product evidence.
- `GET https://router.huggingface.co/v1/models` establishes the current routed chat product,
  backend-specific input/output rates, context, and route capabilities.
- The official [Inference Providers pricing guide](https://huggingface.co/docs/inference-providers/en/pricing)
  establishes that HF-routed calls use provider rates without markup and that `hf-inference`
  charges compute time against underlying hardware.
- The [Inference Providers overview](https://huggingface.co/docs/inference-providers/en/index),
  [Chat Completion guide](https://huggingface.co/docs/inference-providers/en/tasks/chat-completion),
  [Responses guide](https://huggingface.co/docs/inference-providers/en/guides/responses-api), and
  official SDK provider registry are claim-local contract audits. Their absence or prose drift does
  not invalidate independently parsed router rows or rates.
- The OpenAI OpenAPI document referenced by the Hugging Face Responses guide is the protocol
  authority for `ResponseUsage`. It can establish Responses quantity locators only while the local
  Hugging Face compatibility claim also remains present; it cannot establish Hugging Face prices or
  routes.
- Featherless's unauthenticated active-model API and pricing documentation provide an exact native
  rate overlay only for already admitted models with a live `featherless-ai` route. Native models
  without such a route are discarded before merge.
- The public Fireworks model catalog, Z.ai pricing table, Groq model card, and Cohere pricing page
  provide paid token-rate overlays only after an exact live Hugging Face route and provider model ID
  have already been established. These sources cannot create catalog presence or cross provider
  boundaries.

models.dev, LiteLLM, Portkey, gateways, and marketplaces are comparison inputs only. They may reveal
a missing official claim but cannot create Hugging Face identities or rates.

## Pricing

Router rates are normalized independently by meter and qualified by exact `route_provider`. A
malformed input price does not erase a valid output price, route, model, or sibling backend. A live
route without a published amount remains a local raw unknown rather than inheriting another route's
rate. When the exact Featherless overlay supplies complete input and output rates for that same
`featherless-ai` route, those native rates satisfy the router fallback; the missing router fields
remain a collection diagnostic instead of making the canonical offer incomplete. The same bounded
resolution applies to a paid Fireworks, Z.ai, Groq, or Cohere rate only when the live partner mapping
binds the Hugging Face model to the exact native provider model ID. The Z.ai GLM-5.3-Flash
strikethrough row is accepted only while the same page identifies the deleted amounts as list prices
and publishes its exact promotion end. Kmodels emits discounted input/output rates through that
boundary and list rates afterward. A bare native free or promotional claim without numeric request
rates and an exact validity boundary never overrides a router route explicitly marked non-free;
that disagreement remains a local raw unknown. Missing prices without an exact paid join remain
local raw unknowns. Cached-input and cache-storage columns stay outside this overlay because the
routed product evidence binds only prompt and completion usage counters.

Featherless publishes both per-token and per-million-token fields. Kmodels normalizes the exact
per-token value and uses it as the deterministic winner when the redundant fields conflict. The
other observation remains conflict evidence; valid sibling meters survive.

`is_free` is a current route promotion, not permanent model pricing. Kmodels preserves the exact
free state separately from any published base list rates and invents neither an end date nor a
provider-wide free claim.

The `hf-inference` documentation supplies a formula—compute time multiplied by underlying hardware
price—but the public mapping does not bind a request to both a hardware SKU and its billed duration.
The route therefore remains in the catalog with unknown public pricing. Kmodels does not fabricate a
token rate or import unrelated Endpoint, Spaces, or Jobs capacity tables.

Custom provider keys change credentials and who sends the invoice. They do not establish a public
Hugging Face request rate, so BYOK settlement is not represented in this provider partition. The
upstream provider's own price book owns that economic cost.

Chat token rates bind to the official response usage counters. Routing policies such as `auto`,
`:fastest`, `:cheapest`, `:preferred`, and a pinned `:<provider>` are route-selection behavior, not
separate offers. Because failover can change the realized backend, an exact per-request rate requires
the selected route provider. Kmodels publishes an exact selector method for a pinned provider; it
does not guess the result of a server-side routing policy.

Tool support and structured output are capabilities. They create no price term unless Hugging Face
publishes a separate request charge; no such surcharge is currently modeled.

## Calculator input contract

The router source publishes nine field-local pricing inputs. These describe what a downstream cost
calculator must retain; Kmodels does not collect requests, detect completion, or persist a usage
ledger.

| Surface              | Quantity inputs                                               | Availability                            |
| -------------------- | ------------------------------------------------------------- | --------------------------------------- |
| Chat Completions     | `usage.prompt_tokens`, `usage.completion_tokens`              | terminal synchronous response           |
| Chat streaming       | the same fields in the `include_usage` terminal chunk         | terminal chunk before `[DONE]` only     |
| Responses            | `usage.input_tokens`, `usage.output_tokens`                   | terminal response                       |
| Responses streaming  | `response.usage.input_tokens`, `response.usage.output_tokens` | `response.completed` event only         |
| route-price selector | normalized exact pinned provider                              | accepted request with an exact provider |

The Responses fields are admitted only while both the Hugging Face compatibility statement and the
referenced OpenAI `ResponseUsage` schema remain present. Chat and Responses are alternative
quantity methods for the same routed-inference offer; they are never added together. All token
rates aggregate per request. The prompt/input counter binds to `input_tokens`, and the
completion/output counter binds to `output_tokens`.

Each rate variant is also conditioned on `route_provider`. The calculator derives
`HuggingFaceRequest.pinned_route_provider` only from an exact provider choice, either the explicit
Inference Client provider or a model suffix naming a provider. Policy suffixes and unsuffixed
requests do not satisfy this selector. A successful request proves quantities, but without the
selected provider it does not prove which route-specific amount applies.

Pricing-input drift is isolated to the affected method. If one usage field or the provider-selection
claim disappears, the rate remains visible with its semantic charge binding, but the unverified
quantity or selector acquisition method is omitted. The compiler never substitutes an invented
`response:usage.*` raw locator.

## Deliberate unresolved inputs

- Hugging Face does not document a stable response field or header that reports the realized
  provider after server-side `auto`, `:fastest`, `:cheapest`, or `:preferred` selection and
  failover. Those calls need a route observation supplied by the caller or remain unpriceable from
  the public contract alone.
- A stream without its terminal Chat usage chunk or Responses `response.completed` event has no
  exact usage quantity. Partial text is not retokenized as billing evidence.
- Router rows publish one aggregate input-token rate. Although a model may accept images, the public
  rate and response contract do not expose a separately priced text/image token split.
- No routed cache-read, cache-write, reasoning, server-tool, regional, service-tier, or Batch rate is
  published. Their request options or capabilities therefore do not create synthetic price terms.
- `hf-inference` still lacks the request-level hardware SKU and billed compute duration needed by
  its documented compute-time formula. Non-chat routes with no exact numeric overlay remain unknown.
- Account usage pages, credits, provider invoices, and BYOK settlement may verify downstream spend,
  but they are not rate-formula inputs and remain outside this pre-runtime price book.

## Resilience and refresh

- External objects are open to additive fields; known fields are parsed independently.
- Malformed, credential-like, duplicate, error-state, and dynamic-filter records are rejected at the
  smallest row or route scope.
- Unknown future tasks retain the model and raw route while canonical task and modalities remain
  unknown.
- Fixed documentation companions are optional claim-local audits. A missing companion produces a
  diagnostic instead of rejecting router catalog or pricing data.
- The partner registry bundle remains exhaustive: every configured partner response must complete
  before it can replace the previous mapping snapshot. This protects against a partial inventory,
  not against additive row fields.
- Featherless is an optional non-exhaustive overlay. When it is unavailable or omits an admitted
  route, the collector retains only its last verified facts on exact current model matches; current
  router and mapping rates still refresh. A newly parsed Featherless snapshot replaces facts only
  for rows it actually observes.
- Native provider price pages form an optional commercial overlay bundle. Only exact current paid
  joins are published; if a dependency is unavailable, the last accepted Hugging Face pricing
  partition is retained. An ambiguous, promotional, or structurally changed native row leaves the
  router fallback visible instead of borrowing a sibling model or provider rate.
- A complete but locally imperfect bundle publishes every safe sibling fact. An invalid assembled
  provider partition retains the previous provider pricing snapshot with visible staleness.

## Presentation

The UI shows routed inference mechanisms, the route-provider selector, published request rates,
usage bindings, free/not-published state, and local source exceptions. It does not show Hugging Face
plans, storage, training, capacity, credits, enrollment, or settlement topology.
