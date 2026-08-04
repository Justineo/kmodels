# Vercel AI Gateway

Status: current

## Sources and identity

- Unauthenticated `GET https://ai-gateway.vercel.sh/v1/models` is the exhaustive global catalog and canonical `creator/model` identity source.
- One atomic first-party bundle also fetches `GET /v1/models/{creator}/{model}/endpoints` for every catalog ID. This documented endpoint is the route-specific authority for provider name, route price, context limits, supported parameters, implicit caching, and active status.
- The endpoint response also contains rolling uptime, latency, and throughput. The transport validates and removes only those volatile observations before hashing and parsing. Stable route identity and pricing enter the model; live telemetry belongs in a separate routing snapshot and never in `ProviderModel`.
- A catalog item with an empty `pricing` object triggers its public model page. Page discovery is an exact, globally unique final ID segment; ambiguous slugs, missing pages, title changes, provider-link changes, or pricing-table drift reject the source. The transport reduces the server-rendered page to its stable title, route provider, column labels, values, and unit tooltips so unrelated page assets and live performance do not cause catalog churn.
- Fixed Markdown companions cover pricing policy, provider options, REST usage/cost APIs, custom reporting, and logs. Exact policy markers guard the account/billing boundary and freshness claims. They are validation inputs in the same bundle, not a second price book.
- Require 250–600 valid catalog items, one endpoint document per item, one page per empty catalog price, exact owner/ID agreement, and reviewed semantic/pricing vocabularies. Extended model fields outside owned semantics are stripped with a contract signal; nested pricing and endpoint objects fail closed.

## Mapping

- Structured model type is primary task evidence. Exact capability tags may add task semantics. A present `supported_parameters` list is explicit positive and negative evidence for reasoning and tool calling.
- Realtime and WebSocket tags are positive realtime-delivery evidence. Bidirectional audio is `speech_to_speech`; realtime transcription remains `transcription`.
- Top-level modalities remain authoritative except that video `input_limits` add explicit image, video, or audio inputs omitted by the summary modalities. Zero limits are omitted.
- `released` is release date. An effective `deprecated_at` changes lifecycle. Catalog `created` is not an update date. `regions` publishes regional-inference availability, not account access.
- Preserve every native token, cache, service-tier, region, fast, image, video, speech, transcription, realtime, and tool amount. Scale per-token decimals exactly and convert source-exclusive tier maxima to canonical inclusive bounds.
- Route endpoint token and specialized rates carry `route_provider`. When route-specific facts cover the same meter and commercial conditions, they replace the unqualified catalog companion; this prevents the catalog's creator/list summary from hiding cheaper or more expensive provider routes. Catalog-only meters such as image variants and web-search charges remain model-level facts.
- Endpoint region prices retain route provider, geographic or provider region, and `zone`/`specific` deployment scope. Endpoint zero placeholders for request, image, web search, and reasoning are not free offers. A zero token route is accepted only when the model catalog explicitly publishes the corresponding zero token rate.
- Public pages repair empty API pricing only from visible, unit-bearing cells. `/M` token prices, `/K` rerank queries, `/img`, and `/MP` are normalized; megapixel rates become exact million-pixel prices. A starred value or `+N more` summary has unresolved applicability, so it is retained as a raw first-party fact instead of being flattened into an unconditional rate.
- Empty API pricing without a usable page fact remains `not_published`. A page with only an ambiguous raw fact remains `unknown`, never free.
- Stable endpoint providers become model routes. Route context/parameter differences remain at the source boundary because the canonical route shape cannot represent them faithfully.

## Public estimate and account-exact cost

- Vercel says AI Gateway token charges have no markup or platform fee and use provider list prices. Free credits are an account allowance; free and paid accounts use the same listed model rates. The allowance, rate limits, payment fees, and enterprise invoicing do not rewrite model prices.
- BYOK has no Vercel markup, but the upstream provider contract, credits, discounts, and invoice remain account facts. If BYOK credentials fail, Vercel may retry with system credentials and charge the Vercel credits balance, so the submitted credential policy does not guarantee the billed path.
- Team-wide provider allowlists, team-wide ZDR, Custom Reporting writes/queries, and trace drains add request-, entity-, query-, trace-, or egress-based charges outside model inference. Per-request `only` and per-request ZDR are documented as no-additional-cost alternatives. These service terms are guarded and documented but are not duplicated across every model until provider-service add-ons and their native billing units have a canonical home.
- A public estimate therefore needs the requested model or fallback set, provider `order`/`only`/`sort`, actual route provider, region, service/fast tier, cache policy and hit/write outcome, modality, tools, input size, predicted output, and enabled team add-ons. Account credits change remaining balance, not the request's economic rate.

## Request, response, and freshness

- `GET /v1/generation?id=...` is the request-level post-run authority. It returns `total_cost`, selected provider, model, BYOK state, prompt/completion/reasoning/cache-read/cache-creation tokens, billable web-search calls, latency, and generation time. `total_cost` includes Vercel surcharges. For BYOK, `upstream_inference_cost` is the provider's market-price estimate and is not included in `total_cost`; it is not evidence of a negotiated upstream invoice amount.
- Generation usage is asynchronous. Vercel says an immediate lookup can return `Usage event not found`; poll after a few seconds. This is sufficiently fresh for post-request correction and adaptive routing of later requests, not a synchronous quote for the request already in flight.
- Custom Reporting can take a few minutes and exposes charged, market, surcharge, gateway, token, cache, and request aggregates. Logs refresh every five seconds but take about 90 seconds to fully ingest. Those surfaces are reconciliation and observability inputs, not hot-path cost oracles.
- `GET /v1/credits` returns current balance and lifetime total used, not a model/route price decision.
- Vercel itself supports request-time `sort: "cost"` across provider routes and composes it with provider filtering/ordering. A separate gateway can likewise route from the local first-party endpoint price book, request parameters, and an output/cache prediction. Neither approach knows final output, cache behavior, fallbacks, or account-specific BYOK net cost before completion; reconcile against generation cost afterward.

## Extraction and reconciliation

- The refresh is deterministic and non-LLM: bounded JSON schemas own API semantics; exact URL/ID joins own route documents; compact DOM extraction owns only the primary page table; fixed Markdown markers own commercial-policy assertions.
- The current official surfaces resolve numeric pricing for every catalog model except one image model whose page exposes a price plus undisclosed alternatives. That visible amount is preserved raw. An endpoint list with zero specialized placeholders never repairs a missing amount by itself.
- ccusage, LiteLLM, and models.dev are comparison-only diagnostics. ccusage estimates coding-agent costs from local usage and explicitly excludes tool calls; it is not a Vercel billing or generation-log reader. LiteLLM has a partial, flat Vercel model map and omits route-provider alternatives and several official page-only prices. models.dev tracks nearly the full Vercel identity set but publishes cost for only a subset and likewise omits route-specific alternatives. None is used to fill or override first-party facts.

## Kong AI Gateway

- Kong supports only streaming generation through `/v1/chat/completions`.
- Project active, acceptable-maturity rows with explicit chat-generation evidence.
- Image, audio, video, embedding, reranking, realtime, and other Vercel operations do not become Kong support. Multi-task rows qualify only through independent chat evidence.
