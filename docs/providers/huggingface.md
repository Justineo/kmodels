# Hugging Face

Status: current

## Sources and identity

- Global presence comes only from Hugging Face-operated public services. The
  OpenAI-compatible router is a bounded current product catalog. The partner
  mapping registries are a much broader deployment inventory; they contribute
  routes only for rows that also meet the positive product boundary below. Both
  surfaces use the exact `namespace/repository` ID. An ordinary Hub repository
  is never a catalog model merely because it can be deployed.
- The mapping collector calls
  `GET /api/partners/{provider}/models?status=live` for the 18 partners linked by
  the official Inference Providers overview: Baseten, Cerebras, Cohere, DeepInfra,
  fal, Featherless AI, Fireworks AI, Groq, HF Inference, Novita, Nscale, OVHcloud,
  Public AI, Replicate, Scaleway, Together, WaveSpeedAI, and Z.ai. The endpoint is
  documented as public, complete, and grouped by task. `huggingface-hf-inference`
  remains the stable historical source key even though it now aggregates every
  partner mapping registry.
- A concrete `live` mapping proves callability, but not by itself that the Hub
  artifact belongs in a compact reusable model catalog. Registration is partly
  mechanical: it requires a real Hub repository and matching pipeline tag, and
  large providers can consequently expose thousands of per-artifact deployments.
  Treating that registry as the product catalog made one Featherless inventory
  dominate Kmodels even though peer catalogs intentionally publish much smaller
  product surfaces.
- Catalog membership is the deterministic union of three positive signals: an
  exact row in the router catalog; an exact model with live mappings from at
  least two distinct integrated providers; or an exact live mapping named in an
  official Inference Providers task page as a `Recommended model` or in that
  page's bounded `InferenceSnippet` provider mapping. Router rows are collected
  independently, so the mapping parser itself emits the latter two sets and all
  their concrete routes. Distinct providers are corroborating productization,
  not a popularity score. Official task-page evidence preserves specialized
  single-provider image, video, audio, retrieval, and traditional-ML candidates.
- Task pages are discovered on every refresh from the official task index and
  exact-joined to the live registries. There is no hard-coded task list, model
  allowlist, model-name heuristic, download/like threshold, modality cutoff, or
  Top-N. A new official task page or featured model enters mechanically; a new
  raw deployment does not. Generated per-artifact pages, provider IDs copied
  from the artifact, and the generic warm/trending model browser are not
  additional admission signals.
- The fixed overview and the official `huggingface_hub` provider registry are
  independent inventory drift guards. The SDK registry currently has the same 18
  routed partners plus `openai`; the latter is an SDK integration and has no public
  partner mapping registry, so it is validated but not collected as an HF gateway
  route. A configured partner disappearing still fails the source. Newly documented
  partners are accepted as additive drift and surfaced as unsupported until their
  official mapping endpoint is configured.
- The router source bundles fixed first-party documentation for the Hub and mapping
  APIs, provider selection, pricing, Chat Completions, Responses, partner validation
  and billing, the Python inference client, and Hub billing. Those companions guard
  semantics and accounting. Only the task-index documents described above supply
  bounded product evidence, and only by exact join to a current live mapping.
- Featherless's unauthenticated native `GET /v1/models?status=active` catalog is a
  provider-operated pricing overlay, not presence evidence. Pagination requests the
  documented maximum of 1,000 rows and follows the returned page count with bounded
  concurrency. Only an exact catalog model that already has a concrete
  `featherless-ai` live mapping is retained from this source. Native Featherless models
  without that HF route are discarded before merge and cannot create catalog rows,
  source references, routes, or price books.
- The paginated Hub query filtered to `hf-inference` overlays the exact repository
  artifact `lastModified` date onto matching current rows. It cannot create presence,
  and repository creation or router `created` timestamps do not become model release
  dates. Partner-only models intentionally lack this overlay rather than inheriting a
  timestamp with different semantics.
- A published concrete mapping preserves provider, provider model ID, task, source,
  and status in `routes`. The 23 currently observed tag-filter entries are dynamic
  LoRA routing contracts, not 23 model identities: validate their `adapterType` and
  exact tag set, then exclude them with an explicit reconciliation record.
- Do not flatten `api/models?inference_provider=all&expand=inferenceProviderMapping`
  into presence. A read-only audit still had a next page after 30,000 Hub models and
  mixed 9,705 concrete routes with more than 50,000 tag-filter expansions. The
  bounded per-partner mapping registries preserve the contract before those filters
  expand over matching Hub artifacts.
- Global collection uses neither an HF token nor a Featherless token. Broken top-level
  envelopes, missing configured partners or task documents, empty admitted inventories,
  and hard safety bounds still fail their source. Expected cardinality is not an
  admission rule; provider-level churn validation protects publication from a partial
  exhaustive response. Additive fields are ignored, while malformed, duplicate,
  credential-like, and dynamic-LoRA rows are handled independently. This keeps refresh
  deterministic and best-effort without allowing one bad row to erase a valid model or
  meter.

## Routes and mapping

- Task is not an admission filter. A task page may supply exact positive product
  evidence, but its task label never admits or rejects a row. Once a candidate is
  admitted, preserve all its concrete live routes, including classification,
  fill-mask, extractive QA, segmentation, object detection, and unknown future tasks.
  This avoids using a coarse pipeline tag to discard prompt guards, moderation models,
  cross-encoder rerankers, turn detectors, or future workloads that share a traditional
  task API.
- `feature-extraction` is normalized as embeddings. `sentence-similarity` and
  `text-ranking` are normalized as reranking because their callable result is a score,
  not an embedding vector. Classification pipeline tags remain classification;
  image segmentation and object detection retain their exact canonical families.
  Extractive QA, table QA, and fill-mask retain text input/output modalities and raw
  route tasks without being mislabeled as text generation. An unknown future task
  likewise keeps the model and raw route while canonical task and modalities remain
  unknown. In particular, `image-text-to-video` means text plus image input and video
  output.
- Hugging Face tests each live mapping every six hours; failed mappings are retested
  hourly and temporarily removed from the active provider list. Mapping `live` is the
  public offer state, not a guarantee that a transient health probe currently passes;
  collection does not flap durable presence based on latency or temporary route
  health.
- Router rows with at least one live backend are active and carry exact
  `/v1/chat/completions` and `/v1/responses` endpoint evidence. Responses is currently
  beta, but Hugging Face states that all Inference Providers chat-completion models
  should be compatible.
- Each live backend retains a separate `route_provider` price condition. Aggregate
  capability flags are positive if a live route supports them; the published model
  context is the maximum advertised by a live route. A pinned backend must still use
  that route's context and capabilities rather than the aggregate maximum.
- `is_free` means a temporary promotion. If a row simultaneously declares `is_free`
  and a nonzero explicit price, retain the more specific input/output prices and mark
  the conflict ambiguous instead of rejecting the model. A live route with no
  published price remains an `unbound` diagnostic; zero values without `is_free`
  remain ordinary published zero rates.
- Parse route prices independently by meter. If one price field is malformed, retain
  the valid meter and live route, mark the record ambiguous, and let the volume guard
  detect systemic failure. Invalid optional architecture, context, or capability
  metadata likewise cannot erase an otherwise valid live route.
- Server-side suffixes are routing policies, not aliases or service tiers.
  `:fastest` uses throughput, `:cheapest` uses the lowest output-token price,
  `:preferred` uses account preference order, and `:<provider>` pins a backend.
  Automatic failover can change the realized route, so cost-sensitive requests should
  pin the provider they priced.
- First-token latency and throughput come from the latest validation probe. They are
  useful live routing inputs but too volatile to become durable model facts.

## Public estimate and account-exact cost

- The router publishes input and output USD per million tokens for each backend when
  available. Public list-price cost can be calculated only after selecting a route and
  estimating or observing prompt/output tokens. `:cheapest` compares output price,
  not combined request cost, so it is not a general minimum-total-cost policy.
- Most mapping tasks have no price in the mapping registry. A route is not assigned a
  representative token price merely because the same model or provider appears in the
  chat router. The router price is bound only to its exact model/backend chat offer.
- For `featherless-ai`, the provider's active model API currently embeds exact
  per-model `prompt` and `completion` decimal-string prices. Featherless documents
  these per-token values as the output of the same cascade used at billing time and
  documents request cost as input tokens times input price plus output tokens times
  output price. Kmodels scales those exact decimal strings to USD per million tokens
  and binds them only to `route_provider=featherless-ai`.
- The listing also exposes numeric `input` and `output` projections. They are a
  cross-check, not the chosen authority: when rounding or another discrepancy makes
  them conflict with the documented billing-resolution decimal strings, retain the
  `prompt`/`completion` result and publish the other observation as a visible
  `superseded_value` under
  `featherless_native_price_over_huggingface_route_snapshot`. A malformed or missing
  meter does not erase its valid sibling. `image` and `request` values are not imported
  because this source does not establish a usable billed unit and operation for them.
- Absence from Featherless's native active snapshot does not negate a concurrent HF
  `live` mapping. It is recorded as an unresolved first-party set conflict, while the
  catalog model and route remain. Conversely, native Featherless-only inventory never
  enlarges the HF catalog. Model-class table rates are not spread across IDs because
  the exact model payload is more specific and avoids a heuristic class join.
- `hf-inference` is billed as request compute time multiplied by the underlying
  hardware rate. Its mapping does not bind an invocation to a hardware SKU or publish
  eventual compute time, so those routes remain unknown-priced rather than receiving
  a fabricated token rate.
- Hugging Face charges routed requests at the underlying provider's standard API rate
  with no markup. Eligible monthly credits apply to HF-routed billing; a custom
  provider key bypasses HF billing and is charged by that provider. Organization
  attribution, shared credits, spending limits, disabled providers, private discounts,
  taxes, and invoices are account inputs, not model rates.

## Request, response, and billing freshness

- Chat Completions returns `prompt_tokens`, `completion_tokens`, and `total_tokens`.
  For streaming, `stream_options.include_usage` requests a final usage chunk. The
  public schema does not guarantee cached-token, reasoning-token, realized provider,
  hardware-time, or exact-cost fields. Responses documentation also does not establish
  a client-visible billed-cost field.
- HF immediately records a placeholder for a routed request, then a background job
  asks the provider's private billing API every minute for successful request costs in
  integer nano-USD. HF retries for roughly 30 minutes. Request IDs are correlated by a
  response header such as `Inference-Id`, including for streaming.
- That cost API is provider-to-HF infrastructure, not a documented customer API. The
  settings UI exposes the past month's usage by model and provider; the billing
  dashboard and invoices are also account/UI surfaces. No documented customer
  Usage/Costs API or ingestion SLA was found.
- Exact account cost therefore cannot drive pre-request or immediate post-response
  balancing. Use the route-conditioned public book before execution, returned token
  totals for an immediate list-price correction, and delayed billing data for
  reconciliation. BYOK must use the selected provider's own cost interfaces.
- There is a first-party documentation conflict for native-client `provider="auto"`:
  the overview describes fastest-provider selection, while the Python client guide
  says it selects the first provider in account preference order. Server-side suffix
  semantics are clear; native-client users should pin a provider until this is
  resolved.

## Extraction, reconciliation, and coverage

- Refresh is deterministic and non-LLM. One bounded transport fetches all 18 mapping
  registries, the official task index, and every linked task page with concurrency 6,
  retaining an observation for every dependency. The adapter requires configured
  partners in stable order and a bounded task-page set, then parses all valid routes in
  process before applying the positive admission union. Cardinality bounds are resource
  ceilings (100,000 models and 200,000 routes), not expected-count gates. Required
  envelopes plus at least one parseable recommendation and featured mapping remain
  guarded while individual rows, optional fields, and meters are best-effort.
- A second bounded transport fetches the complete unauthenticated Featherless active
  inventory plus its official model and request-pricing documentation. The API's
  embedded list pricing is a semi-structured first-party surface: official detail
  documentation guarantees billing-resolved per-token prices, while the current list
  payload supplies those same fields at refresh scale. The overlay is optional for the
  catalog but required for a fresh pricing partition. If its API or semantic guard
  fails, catalog collection can still advance and the previous compatible pricebook is
  retained rather than silently collapsing coverage.
- Every admitted concrete mapping receives a price disposition. `hf-inference`
  routes use `hf_inference_compute_price_unbound`, partner routes use
  `partner_route_price_not_published`. A valid single-provider inventory row without
  positive product evidence contributes only the aggregate reason
  `single_provider_inventory_without_product_evidence`; its model ID, routes, and prices
  are discarded. Invalid and non-identity rows are likewise aggregate diagnostics. A
  later exact router or Featherless offer can make an admitted model numeric without
  pretending that the mapping registry itself published a price.
- Every router backend also receives one disposition: live priced/free offers are
  normalized, live unpriced offers are unbound, and error offers are excluded. Account
  credits, controls, BYOK, provider-side exact-cost retrieval, and dashboard history
  are classified separately.
- Featherless's complete native active inventory is still fetched so every admitted
  Featherless route can exact-join its current price when available. All native-only and
  boundary-excluded rows are discarded even if they contain valid prices. When a matched
  row's billing-resolution decimal conflicts with its numeric projection, refresh keeps
  the documented billing-resolution value and retains the other observation as
  superseded evidence; a one-meter defect does not erase its valid sibling.
- The mapping registries themselves publish no rates. Exact Featherless-native prices extend
  coverage for admitted Featherless candidates; other partner mappings remain explicitly unknown
  unless an exact first-party route price is available.

## Comparator audit

- Comparators remain audit-only. models.dev now has an hourly sync that reads the HF
  router, but it only creates new rows that can resolve to provider-agnostic metadata
  and have a price. It does not delete missing rows, deliberately treats every existing
  row as already synchronized, and flattens route pricing to the fastest backend or the
  fastest priced fallback.
- LiteLLM dynamically queries the official per-model Hub
  `inferenceProviderMapping` when an explicitly prefixed HF route is used and caches the
  result locally. That is a useful request-time lookup, not a global catalog refresh.
  Its committed task lists are broad legacy inventories rather than a current hosted catalog, and
  its price book has no direct Hugging Face provider rows.
- Portkey's audited model-data repository has no direct Hugging Face provider catalog
  or price book; HF-named artifacts occur only under other providers such as Workers
  AI. It therefore supplies no independent HF gateway rate to import.

## Catalog and consumer boundary

- Catalog membership and downstream compatibility are separate questions. Speech
  synthesis, reranking, classification, segmentation, or another published workload
  remains an ordinary Kmodels model fact regardless of whether a particular consumer
  release implements it. No Kong field or current feature appears in this boundary.
- Hugging Face Hub size and generic HTTP callability do not define this catalog. An
  ordinary repository, a `staging` mapping, a single-provider inventory row without
  positive product evidence, a dynamic tag filter without one exact identity, and a
  malformed or credential-like ID remain outside it. Excluded rows are not retained as
  hidden history, routes, source references, prices, or raw fallbacks.
- Price availability also does not define membership. An admitted official live route
  may remain unknown-priced, while a provider-native priced model with no admitted HF
  candidate remains outside this catalog. Presence and commercial coverage refresh
  independently; provider corroboration and bounded official task features establish
  productization, while popularity, task family, and pricing coverage do not.
- A downstream cost calculation should retain canonical model ID, selected route
  provider, routing policy, bill-to target, BYOK versus HF-routed billing,
  input/output usage, and request ID. Unknown or mismatched task/endpoint
  combinations remain unclassified.
