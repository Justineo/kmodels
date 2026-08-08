# Hugging Face

Status: current

## Sources and identity

- Global rows come from Hugging Face-operated public service listings: the
  OpenAI-compatible router's `/v1/models` response and concrete `live`
  `hf-inference` mappings. Both use the exact `namespace/repository` ID. A successful
  omission removes only that listing's provenance.
- The router source bundles fixed first-party documentation for Hub routing APIs,
  provider selection, pricing, Chat Completions, Responses, provider billing
  integration, the Python inference client, and Hub billing. These companions are
  deterministic accounting drift guards; they do not create model identities.
- The paginated Hub query filtered to `hf-inference` overlays the exact repository
  artifact `lastModified` date onto matching current rows. It cannot create presence,
  and repository creation or router `created` timestamps do not become model release
  dates.
- Preserve each exact concrete mapping's provider model ID, task, and state in
  `routes`. Parameterized tag filters are dynamic LoRA routing contracts, not model
  rows; validate the reviewed contract without flattening it. Exclude credential-like
  identifiers.
- The official [Hub API](https://huggingface.co/docs/inference-providers/en/hub-api)
  can also enumerate every partner's `inferenceProviderMapping`. That broader surface
  currently exceeds 10,000 volatile route records and mixes single-model routes with
  parameterized adapters. The current model catalog does not silently flatten it;
  partner mapping expansion remains an explicit excluded reconciliation item until a
  route-offer catalog can retain its identity and adapter semantics.
- Mapping/router responses are not snapshotted. Malformed data, duplicate identities,
  undocumented states, or count drift reject the source. Global collection never uses
  an HF token, so private or account-specific models cannot leak into the catalog.

## Routes and mapping

- Union reviewed task registrations. Unknown tasks remain raw route evidence; an empty
  task list stays unknown. The `hf-inference` catalog currently covers concrete
  feature-extraction, classification, question-answering, transcription, image, and
  related task routes without inventing a generic token rate.
- Router rows with at least one live backend are active and carry exact
  `/v1/chat/completions` and `/v1/responses` endpoint evidence. Responses is currently
  beta, but Hugging Face states that all Inference Providers chat-completion models
  should be compatible.
- Each live backend retains a separate `route_provider` price condition. Aggregate
  capability flags are positive if a live route supports them; the published model
  context is the maximum advertised by a live route. A gateway that pins a backend
  must still use that route's own context and capabilities rather than treating the
  aggregate maximum as universal.
- An explicitly free route cannot also have a nonzero price. `is_free` means a
  temporary promotion. A live route with no published price remains an `unbound`
  pricing diagnostic; zero values without `is_free` remain ordinary published zero
  rates rather than being relabeled as a promotion.
- Server-side model suffixes are request routing policies, not aliases or service
  tiers. `:fastest` uses throughput, `:cheapest` uses the lowest output-token price,
  `:preferred` uses account preference order, and `:<provider>` pins a backend.
  Automatic failover can change the realized route, so a cost-sensitive gateway should
  pin the provider it priced.
- First-token latency and throughput come from the latest validation probe. They are
  useful live routing inputs but too volatile to become durable model facts.

## Public estimate and account-exact cost

- The router price book publishes input and output USD per million tokens for each
  backend when available. A gateway can calculate public list-price cost after it knows
  the selected route and actual prompt/output tokens. Before execution, output length
  is a forecast; the request's reasoning effort, tools, content, and provider-specific
  behavior affect realized tokens.
- Hugging Face charges routed requests at the underlying provider's standard API rate
  with no markup. However, `:cheapest` compares output-token price rather than the
  request's combined input/output estimate. It is therefore not a general least-total-
  cost algorithm, especially for input-heavy requests.
- `hf-inference` is different: its public formula is request compute time multiplied by
  the underlying hardware rate. The public mapping does not bind each model invocation
  to an exact hardware SKU or publish the eventual compute time, so those models remain
  unknown-priced with an explicit unbound diagnostic. A representative token price
  would be false precision.
- [Routed billing](https://huggingface.co/docs/inference-providers/en/pricing) uses the
  HF account and eligible monthly credits. Current public allowances are `$0.10` for a
  free user, subject to change, `$2.00` for PRO, and `$2.00` per Team/Enterprise seat.
  A custom provider key bypasses HF billing and is charged by that provider instead.
- Organization attribution comes from `X-HF-Bill-To`; Enterprise resource groups,
  shared credits, spending limits, disabled providers, purchased credits, private
  discounts, taxes, and invoices are account-level inputs, not model rates.

## Request, response, and billing freshness

- Chat Completions returns `prompt_tokens`, `completion_tokens`, and `total_tokens`.
  For streaming, `stream_options.include_usage` requests a final usage chunk. The
  public schema does not guarantee cached-token, reasoning-token, actual route-provider,
  hardware-time, or exact-cost fields. Responses API documentation likewise does not
  currently establish an exact client-visible billed-cost field.
- The provider-onboarding contract reveals the account-exact backend: HF immediately
  records a placeholder, then every minute asks each provider's private billing API for
  successful request costs in integer nano-USD. A provider may require an additional
  delay; HF retries and gives up after roughly 30 minutes, in which case the request is
  not charged. Request IDs are correlated through a response header such as
  `Inference-Id`, including for streaming.
- That per-request cost API is provider-to-HF infrastructure, not a documented customer
  API, and the response body does not return its value. The settings UI shows the past
  month's usage broken down by model and provider; the general billing dashboard and
  monthly invoices are also UI/account surfaces. No documented customer Usage/Costs API
  or ingestion SLA was found.
- Consequently, exact account cost cannot drive pre-request or immediate post-response
  load balancing. Use the route-conditioned public book and estimated units before the
  request, returned token totals for an immediate list-price correction, and delayed HF
  billing data for reconciliation. BYOK must instead use the selected provider's own
  usage/cost interfaces.
- There is a current first-party conflict in automatic client routing. The Inference
  Providers overview describes `provider="auto"` as fastest, while the official Python
  client guide says `auto` selects the first provider in the user's preference order.
  The OpenAI-compatible server-side suffix semantics are clear; native-client users
  should pin a provider until the conflicting default documentation is resolved.

## Extraction and reconciliation

- Refresh is deterministic and non-LLM. Zod validates the router list and complete
  input/output price pairs. Fixed documentation claims validate rate units, promotions,
  request routing, usage fields, account allowances, BYOK, organization controls,
  provider-side exact-cost timing, and the absence of a documented client cost field.
- Every router backend gets one pricing disposition: a live price/free offer is
  normalized, a live backend without price is unbound, and an error backend is excluded.
  Every concrete `hf-inference` identity is unbound because the public compute formula
  lacks the model-to-hardware/run-time binding. Account allowances, controls, BYOK,
  internal exact-cost retrieval, dashboard history, and the broader partner mapping
  catalog are classified explicitly instead of disappearing behind model-level coverage.
- The earlier flow already captured route-conditioned token prices, but treated output
  coverage as sufficient. It missed Responses, the public compute billing formula, the
  provider-side one-minute exact-cost reconciliation process, account billing modes,
  usage response limits, unpublished live-route prices, and the official routing-default
  conflict. These are now fixed companions and source-item reconciliation contracts.
- The live first-party sources currently yield 1,408 concrete `hf-inference` models,
  all unbound on public cost. The chat router yields 131 models, of which 110 have
  numeric offers. Its live backends partition into 205 normalized price sets and 98
  unpublished prices, plus seven excluded provider-wide
  commercial/account observations and one ambiguous routing-policy conflict. At model level this is
  1,429 unknown prices: all 1,408 compute-billed `hf-inference` identities plus 21 router models for
  which every live backend omits a price. Neither group can be repaired with a representative token
  rate without inventing a hardware/runtime binding or a route offer.
- Third-party books remain audit-only. The current LiteLLM snapshot has no direct
  Hugging Face gateway price entries, so ccusage has no independent HF route book.
  models.dev flattens the gateway to 56 model-level prices: only 37 match a currently
  published route pair, 25 of those models have multiple priced routes, 14 prices differ
  from every current route, and five listed IDs are absent from the current chat router.
  Flattening removes the provider condition and becomes stale quickly, so none of those
  values is imported.

## Kong AI Gateway

- Compatibility is versioned and requires an exact Kong capability, upstream surface,
  and Hugging Face route; provider membership and `source_refs` are insufficient.
- AI Gateway 2.0 chat requires live router membership. Embeddings require a concrete
  `hf-inference` `feature-extraction` mapping. Audio transcription, image, video, and
  native generation each require the matching concrete task and route.
- AI Gateway 2.0 does not support completions, files, batches, agents, speech synthesis,
  audio translation, realtime, or reranking for Hugging Face. AI Gateway 1.x supports
  chat from 3.9, embeddings from 3.11, video from 3.13, and native text generation from
  3.9; do not project 2.0-only image/audio support backward.
- Cost-aware requests should retain canonical model ID, selected route provider, routing
  policy, bill-to target, BYOK versus HF-routed billing, input/output usage, and request
  ID. Unknown or mismatched task/endpoint combinations remain unclassified.
