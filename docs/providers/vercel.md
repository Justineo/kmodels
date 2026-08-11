# Vercel AI Gateway

Status: current

## Sources and identity

- Unauthenticated `GET https://ai-gateway.vercel.sh/v1/models` is the exhaustive global catalog and canonical `creator/model` identity source.
- One atomic first-party bundle also fetches `GET /v1/models/{creator}/{model}/endpoints` for every catalog ID. This documented endpoint is the route-specific authority for provider name, route price, context limits, supported parameters, implicit caching, and active status.
- The endpoint response also contains rolling uptime, latency, and throughput. The transport validates and removes only those volatile observations before hashing and parsing. Stable route identity and pricing enter the model; live telemetry belongs in a separate routing snapshot and never in `ProviderModel`.
- A catalog item with an empty `pricing` object triggers its public model page. Page discovery is an exact, globally unique final ID segment; ambiguous slugs, missing pages, title changes, provider-link changes, or pricing-table drift reject the source. The transport reduces the server-rendered page to its stable title, route provider, column labels, values, and unit tooltips so unrelated page assets and live performance do not cause catalog churn. A trailing presentation-only column is discarded only when both its header and value are empty; any non-empty or interior shape change still rejects the page.
- Fixed first-party companions cover the model directory, pricing policy, provider routing and
  sorting, web search, fast mode, service tiers, regional inference, BYOK, REST usage/cost APIs,
  reporting, both allowlists, ZDR, trace drains, budgets, controls, and the documentation sitemap.
  Operational contract markers remain source-wide guards. Commercial claims are parsed
  independently inside a complete bundle. An unavailable companion retains the
  previously accepted provider pricing partition.
- Require 250–600 valid catalog items, one endpoint document per item, one page per empty catalog price, exact owner/ID agreement, and reviewed semantic/pricing vocabularies. Extended model fields outside owned semantics are stripped with a contract signal; nested pricing and endpoint objects fail closed.

## Mapping

- Structured model type is primary task evidence. Exact capability tags may add task semantics. A present `supported_parameters` list is explicit positive and negative evidence for reasoning and tool calling.
- Realtime and WebSocket tags are positive realtime-delivery evidence. Bidirectional audio is `speech_to_speech`; realtime transcription remains `transcription`.
- Top-level modalities remain authoritative except that video `input_limits` add explicit image, video, or audio inputs omitted by the summary modalities. Zero limits are omitted.
- `released` is release date. An effective `deprecated_at` changes lifecycle. Catalog `created` is not an update date. `regions` publishes regional-inference availability, not account access.
- Preserve every native token, cache, service-tier, region, fast, image, video, speech, transcription, realtime, and tool amount. Scale per-token decimals exactly and convert source-exclusive tier maxima to canonical inclusive bounds. Video-token price sets retain both the video-input selector and every explicit resolution tier; duplicate or unknown tier labels reject the source.
- Source tier maxima are exclusive. When a current endpoint payload repeats the preceding exclusive
  maximum as the next tier's minimum minus one, normalize the next minimum to that exclusive
  boundary; this repairs the source's one-token overlap without changing either published amount.
- Route endpoint token and specialized rates carry `route_provider`. When route-specific facts cover the same meter and commercial conditions, they replace the unqualified catalog companion; this prevents the catalog's creator/list summary from hiding cheaper or more expensive provider routes. Model inference keeps image and other native model meters; `web_search` and `maps_search` move into exact model/route-qualified provider-service offers.
- Endpoint region prices retain route provider, geographic or provider region, and `zone`/`specific` deployment scope. When either endpoint or catalog evidence publishes regional alternatives, the corresponding unqualified route rate carries `region=default`; it no longer overlaps the named EU or other regional price. Vercel documents that a pinned region can cost more, that the provider sets that regional amount, and that AI Gateway adds no regional markup.
- Endpoint zero placeholders for request, image, web search, and reasoning are not free offers. A zero prompt or completion route is accepted only when the model catalog publishes the corresponding zero token rate. Optional token fields such as a zero cache-write amount are different: because they are absent when inapplicable and the endpoint contract defines them as prices, preserve a present zero as an exact route price.
- Public pages repair empty API pricing only from visible, unit-bearing cells. `/M` token prices, `/K` rerank queries, `/img`, `/MP`, and video `/sec` prices are normalized; megapixel rates become exact million-pixel prices. A starred value or `+N more` summary has unresolved applicability, so it is retained as a raw first-party fact instead of being flattened into an unconditional rate.
- Empty API pricing without a usable page fact remains `not_published`. A page with only an ambiguous raw fact remains `unknown`, never free. The structured `free` tag is explicit non-numeric price evidence; a matching page must show both input and output as free, and any simultaneous paid fact rejects the model.
- The REST prose table currently describes `pricing.web_search` as a per-request amount, while the official model pages display matching catalog numbers as `$N/K` and may disclose additional input costs or variants. The visible `/K` denomination and the catalog's current numeric scale agree, so normalized catalog `web_search` and `maps_search` facts are per thousand requests. Page summaries with `*`, `+N more`, or `+ input costs` are never used to invent an unconditional amount.
- Stable endpoint providers become model routes. Route context/parameter differences remain at the source boundary because the canonical route shape cannot represent them faithfully.

## Commercial topology audit

Design status: implemented. Vercel is a gateway and a billing intermediary, so one submitted
request can realize model inference, a provider-native search tool, a Vercel-owned search service,
governance/reporting surcharges, a separately invoiced trace drain, and an external BYOK attempt.
Those components need separate offers, meters, and settlement ownership even when Vercel exposes one
post-run total.

### Public commercial source graph

- `GET /v1/models` owns global model identity and catalog-level price summaries.
  `GET /v1/models/{creator}/{model}/endpoints` owns route provider, route price, region, tier,
  parameter support, and route activity. A model page owns visible unit-bearing route cells, an
  explicit `Free` assertion, while the server-rendered model directory owns free-tier eligibility.
  None of these sources owns a
  generic provider-service price merely because a model can call tools.
- The [pricing guide](https://vercel.com/docs/ai-gateway/pricing) owns the no-markup policy, paid/free
  tier boundary, AI Gateway Credits, invoice boundary, and current add-on amounts. Feature-specific
  guides own the exact billable event, exclusions, plan scope, filter composition, and BYOK behavior.
  The model and provider allowlist guides are both required: the newer model allowlist is a distinct
  resource but explicitly shares one surcharge with the provider allowlist when both are enabled.
- The [web-search guide](https://vercel.com/docs/ai-gateway/models-and-providers/web-search) owns three
  Vercel-routed search services and their rates. Provider-native web-search and Maps prices remain
  model/route-qualified service facts from model APIs and pages. The three gateway search services
  do not occur in `/v1/models`; documentation discovery creates provider-service resources, never
  pseudo-models.
- The [generation API](https://vercel.com/docs/ai-gateway/sdks-and-apis/rest-api), response gateway
  metadata, Custom Reporting, logs, and trace attributes own realized route, credential, usage, and
  aggregate-cost evidence. They reconcile outcomes but do not override current list-price sources.
- The [AI Gateway trace guide](https://vercel.com/docs/ai-gateway/observability-and-spend/trace-drains)
  owns the two-meter trace topology and delivery event. The general
  [Drains guide](https://vercel.com/docs/drains) owns the public Pro volume rate and the uncompressed
  JSON byte definition. Neither currently publishes a public trace-event amount.
- Budgets, routing rules, provider options, Fast Mode, service tiers, regional inference, BYOK,
  Custom Reporting, both allowlists, ZDR, no-training, and trace drains are mechanically discoverable
  from the official documentation sitemap. Migration should maintain a recognized/ignored companion
  ledger so a new commercial page produces a review signal without invalidating unrelated claims.
  The collector now applies that claim-local contract.

### Resources, books, and offer boundaries

| Resource or book                                                                           | Target offers                               | Boundary                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------ | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exact Vercel model and route                                                               | System-credential model inference           | Route provider, region, served service tier, Fast/base outcome, cache class, modality, and size are variants of one inference mechanism. A routing rule or fallback can change the realized model, so requested identity is not the billed identity.     |
| BYOK route                                                                                 | Externally billed upstream inference        | Vercel publishes no markup, not a zero upstream price. The upstream provider contract and invoice own the economic charge. System-credential fallback is another realized attempt and may add a Vercel Credits charge.                                   |
| Perplexity Search                                                                          | Gateway Perplexity Search                   | A Vercel-routed provider service usable with any model; `$5 / 1,000` search requests. It is not Perplexity model inference and not an ordinary function call.                                                                                            |
| Exa Search                                                                                 | Gateway Exa Search                          | `$7 / 1,000` search requests, including up to ten results, plus `$1 / 1,000` additional requested results. The base and excess-result terms share one independently callable service offer.                                                              |
| Parallel Search                                                                            | Gateway Parallel Search                     | `$5 / 1,000` search requests, including up to ten results, plus `$1 / 1,000` additional results. The source does not yet define whether the excess quantity is requested, returned, or billable-provider reported.                                       |
| Provider-native web search                                                                 | Route/model-qualified native-search service | Preserve `web_search` separately from model tokens and qualify it by exact model and route provider. It is not interchangeable with the three gateway search services.                                                                                   |
| Google Maps grounding                                                                      | Route/model-qualified Maps service          | Preserve the public numeric `maps_search` price. No reviewed current guide defines the exact billable event, so price normalization can precede charge binding.                                                                                          |
| Custom Reporting                                                                           | Reporting-write and reporting-query offers  | Writes attach entities to a Gateway request, while queries call a distinct reporting endpoint. Their API mechanisms and billable events differ, so they are separate offers under one account-enabled service, not model-token variants.                 |
| Team model/provider restrictions                                                           | One restriction-enforcement service         | Model and provider allowlists remain distinct governance resources. If either or both team settings are active, Vercel charges one `$0.10 / 1,000` successful-response surcharge, never two. Per-request provider `only` is included at no extra charge. |
| Team-wide ZDR                                                                              | ZDR enforcement service                     | `$0.10 / 1,000` successful responses that return usage data. Per-request ZDR is a no-additional-charge routing filter and cannot activate this surcharge.                                                                                                |
| AI Gateway Trace Drains                                                                    | Trace delivery and egress service           | One provider service has a delivered-trace-event term and an uncompressed-JSON egress term. Pro volume is `$0.50 / GB`; the event amount is `not_published`. Settlement is Vercel Drains usage, not AI Gateway Credits.                                  |
| Free-tier entitlement                                                                      | `$5` Credits allowance every 30 days        | This is an account allowance for the officially selected free-tier model set, anchored to the first Gateway request. It does not rewrite model rates. A genuinely `Free` model remains a separate explicit zero-marginal-price inference offer.          |
| Budgets, routing rules, cache automation, no-training, request `only`, and per-request ZDR | Control or included-policy resources        | They affect admission, routing, or accounting context but have no separately published marginal price. “No additional cost” records inclusion in the inference mechanism; it does not create a numeric-zero service.                                     |

Provider-specific native search can itself have multiple route prices or `+ input costs`. Preserve
those as route/model-qualified service terms. Do not copy one search amount across models, routes, or
providers and do not use tool capability as applicability evidence.

### Relationship matrix

| Source                                      | Relationship     | Exact target or rule                                                                                                                                                                                         |
| ------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| System-credential inference                 | `exclusive_with` | BYOK inference for one realized provider attempt. A whole request may still contain a failed BYOK attempt followed by a system attempt, so this is an attempt-local exclusion, not a request-wide assertion. |
| Generic Perplexity, Exa, or Parallel Search | `requires`       | One realized Gateway model-inference execution that emitted the exact named gateway search call. The services are compatible with every published model but are not auto-selected from compatibility alone.  |
| Provider-native web search or Maps          | `requires`       | A realized inference route for the exact supporting route provider and model. A configured but uncalled tool produces no service charge.                                                                     |
| Custom Reporting writes                     | `requires`       | A Gateway request carrying the realized, merged reporting entities. Reporting queries are independently callable operations and do not require model inference in the same request.                          |
| Team restriction surcharge                  | `requires`       | A successful model response while at least one team allowlist is enabled. Model and provider allowlists are an OR trigger for one charge, while their admission checks remain independent and cumulative.    |
| Team-wide ZDR surcharge                     | `requires`       | A successful model response with usage data while the team-wide setting is active. A request-level ZDR flag alone is explicitly insufficient.                                                                |
| Trace delivery and egress                   | `requires`       | An enabled drain and the realized Gateway request trace delivered to that drain. Each drain is a separate delivered event; fallback spans do not create extra events.                                        |

The public model/provider routing graph is dynamic. Provider order, `only`, cost sorting, team
allowlists, ZDR/no-training filters, regional selection, Fast fallback, service-tier fallback, model
routing rules, and credential fallback are request/account controls. They select realized offer
variants or attempts; they are not static commercial relationships between every model and route.
The free-tier allowance is not an offer relationship: its allowance target selects only exact
system-credential offers whose current directory entries are marked `availableToFreeTier`. That target set can
change independently of catalog membership and explicit zero-price models.

### Meters, denominators, signals, and resolution phase

| Commercial atom                          | Published denominator                                                  | Charge or reconciliation signal                                                                                | Earliest reliable phase |
| ---------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------- |
| Model input/output/cache/reasoning/media | Exact token, image, pixel, second, request, or other model unit        | Direct response usage and generation record, qualified by realized model and route                             | Outcome                 |
| Fast and service-tier amount             | Native model unit at the tier actually served                          | Response/generation `service_tier`, resolved model, and route; a requested selector is preflight only          | Outcome                 |
| Regional amount                          | Native model unit for the route and region actually used               | Requested region constrains routing; resolved provider/region and generation evidence reconcile it             | Request / outcome       |
| Perplexity Search                        | One named Perplexity search request                                    | Executed `gateway.tools.perplexitySearch` call/result                                                          | Outcome                 |
| Exa Search                               | One named Exa search request                                           | Executed `gateway.tools.exaSearch` call/result                                                                 | Outcome                 |
| Exa excess results                       | One additional requested result above ten                              | Exact `numResults - 10`, gated by execution of the named Exa search                                            | Request / outcome       |
| Parallel Search                          | One named Parallel search request                                      | Executed `gateway.tools.parallelSearch` call/result                                                            | Outcome                 |
| Parallel excess results                  | One additional result above ten                                        | No reviewed exact requested/returned/billable counter; retain the amount unbound                               | Unresolved              |
| Provider-native web search               | One provider-native billable web-search call or published search unit  | `billable_web_search_calls` only when the selected service is unambiguous; otherwise exact route/tool evidence | Outcome                 |
| Google Maps grounding                    | One published Maps-search unit                                         | No reviewed exact billable-event signal                                                                        | Unresolved              |
| Custom Reporting write                   | One unique tag, user ID, or quota-entity ID write within request scope | Distinct realized entities after header/body merge and de-duplication; aggregate surcharge can reconcile later | Request / outcome       |
| Custom Reporting query                   | One reporting-endpoint query                                           | Accepted exact report API operation                                                                            | Outcome                 |
| Team restriction                         | One successful response under either team allowlist                    | Account settings plus successful response; `403` and other failures are excluded                               | Account / outcome       |
| Team-wide ZDR                            | One successful response returning usage data                           | Account setting plus successful usage-bearing response; failures are excluded                                  | Account / outcome       |
| Trace delivery                           | One delivered root-span trace per drain                                | Successful root-span delivery; provider-attempt spans do not increment the event count                         | Post-outcome            |
| Trace egress                             | One GB of uncompressed serialized JSON records                         | Drains billing quantity, not destination compressed bytes                                                      | Account                 |
| Free Credits                             | `$5` credit value per 30-day entitlement interval                      | Unpaid/free account state, first-request anchor, eligible model usage, and Credits ledger                      | Account                 |

`billable_web_search_calls` is a precise count but not a complete service identity. It can bind a
route/model-qualified native-search rate when the selected tool/provider makes the attribution
unique; it cannot allocate one aggregate count across differently priced native, Perplexity, Exa,
and Parallel services. `generation.total_cost` can still be exact for the Vercel-owned sum even when
one component cannot be reconstructed from public counters.

### Requested, realized, allowance, enrollment, procurement, and settlement facts

Publication facts select model, backing routes, current route prices, free-tier eligibility,
explicit `Free` status, plan availability, and public add-on rates. Request facts select model or
fallback list, provider routing, region, tier/speed preference, tools, reporting entities, policy
filters, and request-scoped BYOK credentials. Outcome facts select the served model, route provider,
tier, cache/media/token quantities, named tool executions, credential type, provider/model attempts,
and aggregate cost. Account facts supply team controls, plan, free-tier state, allowance anchor and
balance, persistent BYOK credentials, budgets, drain configuration, sampling, and settlement.

BYOK and system credentials are not request-wide alternatives. A failed or timed-out BYOK attempt
may still incur an upstream provider charge, then a successful system-credential fallback consumes
Vercel Credits. Likewise, model and provider fallbacks can produce several economically relevant
attempts even though the final response has one winner. Preserve each through the shared runtime
`attempt` aggregation boundary; do not flatten them to one request boolean or create static offer
resources for event records.

Vercel system-credential inference and AI Gateway add-ons settle from AI Gateway Credits, or through
an Enterprise invoice where configured. Public product material also permits AWS Marketplace private
offers as a procurement route. Trace Drains settle as Vercel plan usage. BYOK inference settles with
the upstream provider. Payment-processing fees, negotiated prices, taxes, credit balance, auto
top-up, marketplace commitment treatment, and the final invoice remain account facts.

Budgets are soft preflight controls, not allowances: scoped team/project/key budgets stack, the
crossing request can complete, later requests are rejected, BYOK spend is excluded, and budgets
neither buy capacity nor establish price. Routing rules similarly rewrite the requested model but do
not create a priced service. Reconciliation always follows the realized execution and billing owner.

### Commercial-atom disposition ledger

| First-party atom                                                                            | Target disposition                                                        | Rationale                                                                                                                                                |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Route token, cache, media, regional, Fast, and service-tier amounts                         | Normalize as model-inference variants                                     | Exact route/model conditions exist; requested fallback-capable selectors do not control the final amount.                                                |
| BYOK upstream use and Vercel no-markup fact                                                 | Normalize as externally billed settlement path                            | “No markup” describes Vercel's fee, not absence of upstream cost.                                                                                        |
| Generic Perplexity, Exa, and Parallel search                                                | Normalize as three provider-service offers                                | Exact callable service identity and base rates exist; they must not become model rows or generic tool-call prices.                                       |
| Exa additional requested results                                                            | Normalize as a separate exact rate term                                   | Denominator and requested quantity above ten are explicit.                                                                                               |
| Parallel additional results                                                                 | Normalize amount; leave charge binding raw                                | The published amount is exact but the quantity signal is underspecified.                                                                                 |
| Native `web_search`                                                                         | Normalize as route/model-qualified provider-service terms                 | Search is separately charged and model/route dependent. A generic function call is the wrong meter.                                                      |
| `maps_search`                                                                               | Normalize amount; leave charge binding raw                                | Exact price exists without an exact current billable-event contract.                                                                                     |
| Custom Reporting writes and queries                                                         | Normalize as two provider-service offers under one enrollment             | The write and query API mechanisms differ; the pricing guide owns exact rates while the reporting guide owns merge, query, and reconciliation semantics. |
| Model and provider allowlists                                                               | Preserve two governance resources; normalize one shared restriction offer | Both controls can apply, but Vercel explicitly forbids double charging when both are active.                                                             |
| Team-wide ZDR                                                                               | Normalize provider-service offer                                          | Team enrollment and a successful usage-bearing response are exact charge conditions.                                                                     |
| Per-request `only`, per-request ZDR, and no-training                                        | Included routing controls                                                 | Official evidence says no additional charge. Do not emit zero-rate add-on offers.                                                                        |
| Trace delivered event                                                                       | Normalize meter and `not_published` amount                                | The billed event is exact but no public numeric event rate is currently published.                                                                       |
| Trace egress                                                                                | Normalize `$0.50 / GB` with exact byte semantics                          | The specialized trace guide owns applicability; the general Drains guide owns amount and measurement.                                                    |
| Explicit `Free` model                                                                       | Preserve exact free model-inference offer                                 | The current model page and tag both assert free input/output; no paid fact may coexist.                                                                  |
| Free-tier model eligibility and `$5 / 30 days`                                              | Normalize selection plus cross-book account allowance                     | Eligibility, account enrollment, time anchor, and model price are independent facts.                                                                     |
| Budgets, routing rules, rate limits, provider health, and automatic caching                 | Control/account facts                                                     | They affect admission or realization but publish no separate marginal charge.                                                                            |
| `gateway.cost`, `marketCost`, generation totals, reports, logs, and trace cost fields       | Reconciliation evidence                                                   | They report realized or aggregated cost; they are not current list-price authority.                                                                      |
| Credits, invoices, AWS Marketplace, BYOK provider invoice, payment fees, tax, and discounts | Settlement facts                                                          | Public routes are in scope; account-specific amounts and balances are not.                                                                               |

### Authority and conflicts

Authority is claim-specific:

1. The endpoint API controls exact route prices and route dimensions; the model API controls catalog
   summaries. A visible model-page unit can repair an empty summary or resolve the current
   `web_search` scale, but a starred/compound page value remains raw.
2. The pricing guide controls current add-on amounts and plan/payment rules. The more specific
   feature guide controls successful-event exclusions, deduplication, combined charging, BYOK
   behavior, and policy scope. Thus the model and provider allowlists form one commercial surcharge
   despite two independent resource controls.
3. The newer specialized trace guide controls the two-meter topology. The general Drains guide
   controls only the shared `$0.50 / GB` amount and uncompressed serialization measurement. It
   cannot supply the missing trace-event amount.
4. Generation/response records control realized route, quantities, and Vercel-charged totals.
   `marketCost` and `upstream_inference_cost` are list-price estimates, not the BYOK invoice. Custom
   Reporting and logs are delayed aggregates and cannot replace a per-request price source.
5. If equally specific current sources conflict, select a winner only through a reviewed
   source-purpose, route-containment, unit, or effective-date rule and retain the losing observation
   as a visible conflict. Otherwise withhold only the disputed amount, signal binding, or condition.

The pricing guide includes quota-entity writes while the feature page's shorter pricing table names
only tags and users. The newer, broader pricing contract owns the commercial denominator; the
feature page still owns request merge and reporting behavior. The REST field description calls
`pricing.web_search` a per-request amount while official model pages display the same numeric scale
as `/K`; visible denomination plus current data scale controls normalization, and the prose conflict
remains diagnostic.

The current pricing guide says free credits cover a selected subset, while an official knowledge-base
guide still says there are no model restrictions. The pricing guide and current server-rendered
`availableToFreeTier` entries control eligibility; the knowledge-base guide supplies only the still
corroborated `$5 / 30 days` amount and reset interval. The losing eligibility statement remains a
visible raw conflict rather than widening the allowance to the full catalog.

Refresh must enumerate every model, route, page-only price cell, free-tier marker, recognized
commercial companion, and commercial atom. Malformed fact-level evidence suppresses only
the dependent amount, binding, relationship, or policy fact. An unavailable companion retains the
complete provider pricing partition and does not reject the model catalog. A newly discovered official service is
retained as raw evidence and surfaced for review; an unknown pricing key is never silently dropped
or guessed. Source removal retires a claim only when the source is exhaustive for that exact claim;
temporary bundle failure retains the prior partition with visible staleness. Publication remains
crash-atomic after fact-local reconciliation.

### Model-detail composition and cost coverage

Model details project exact model-inference offers and only those provider services with exact model
applicability. Generic gateway search is a standalone service compatible with all models; it appears
as a supplemental choice only after exact service selection. Provider-native search/Maps appears
only on the exact model/route. Reporting, team restrictions, ZDR, and traces are account-enabled
services, not capabilities of the model. Budgets, routing rules, free-tier selection, and BYOK keys
remain controls or settlement context and never become model rows.

A calculator sums every independently charged realized component once: each provider/model attempt,
model units, executed search service calls, additional results where bound, reporting writes,
restriction/ZDR surcharge, and each drain's delivery/egress. It then applies the correct settlement
owner and allowance. Coverage is `complete` only when every realized component has an exact amount,
quantity, applicability, and settlement path. It is `partial` when, for example, Parallel excess
results, Maps calls, trace events, an external BYOK invoice, attempt attribution, or account
allowance state is missing. An exact Vercel `generation.total_cost` may reconcile the Vercel-owned
sum without making omitted line-item allocation or external BYOK cost exact.

## Public estimate and account-exact cost

- Vercel says AI Gateway token charges have no markup or platform fee and use provider list prices. Free credits are an account allowance; free and paid accounts use the same listed model rates. The allowance, rate limits, payment fees, and enterprise invoicing do not rewrite model prices.
- BYOK has no Vercel markup, but the upstream provider contract, credits, discounts, and invoice remain account facts. If BYOK credentials fail, Vercel may retry with system credentials and charge the Vercel credits balance, so the submitted credential policy does not guarantee the billed path. BYOK spend is metered separately and is not counted by Vercel budgets. Azure BYOK is another explicit boundary: the catalog UI uses East US 2 rates, while the account's actual Azure region can differ.
- Team-wide model/provider restrictions share one surcharge when either or both are enabled. Team-wide ZDR, Custom Reporting writes/queries, generic or provider-native search, and trace drains have independent meters outside model inference. Per-request `only`, per-request ZDR, and no-training are documented as no-additional-cost controls. These terms now have provider-service ownership rather than being duplicated across model inference.
- A public estimate therefore needs the requested model or fallback set, provider `order`/`only`/`sort`, actual route provider, region, service/fast tier, cache policy and hit/write outcome, modality, tools, input size, predicted output, and enabled team add-ons. Fast mode can fall back to the base model unless disabled. Service tier is best effort and Vercel bills the tier actually served, not merely the tier requested. Account credits change remaining balance, not the request's economic rate.

## Request, response, and freshness

- `GET /v1/generation?id=...` is the request-level post-run authority. It returns `total_cost`, selected provider, model, BYOK state, prompt/completion/reasoning/cache-read/cache-creation tokens, billable web-search calls, latency, and generation time. `total_cost` includes Vercel surcharges. For BYOK, `upstream_inference_cost` is the provider's market-price estimate and is not included in `total_cost`; it is not evidence of a negotiated upstream invoice amount. The response-level `gateway.cost` is inference cost only and explicitly excludes Custom Reporting, ZDR, and other add-ons; `gateway.marketCost` is the market-rate companion.
- Generation usage is asynchronous. Vercel says an immediate lookup can return `Usage event not found`; poll after a few seconds. This is sufficiently fresh for post-request correction and adaptive routing of later requests, not a synchronous quote for the request already in flight.
- Custom Reporting can take a few minutes and exposes charged, market, surcharge, gateway, token, cache, and request aggregates. Logs refresh every five seconds but take about 90 seconds to fully ingest. Those surfaces are reconciliation and observability inputs, not hot-path cost oracles.
- `GET /v1/credits` returns current balance and lifetime total used, not a model/route price decision.
- Vercel itself supports request-time `sort: "cost"`, `sort: "ttft"`, and `sort: "tps"` across provider routes and composes them with provider filtering/ordering. Health remains a guard rail: degraded or recovering routes are penalized and down routes sort last. A separate gateway can likewise route from the local first-party endpoint price book, request parameters, and an output/cache prediction. Neither approach knows final output, cache behavior, fallbacks, or account-specific BYOK net cost before completion; reconcile against generation cost afterward.

## Extraction and reconciliation

- The refresh is deterministic and non-LLM: bounded JSON schemas own API semantics; exact URL/ID joins own route documents; compact DOM extraction owns only reviewed page facts; a sitemap-driven recognized/ignored companion ledger owns commercial-policy assertions. Fact-level normalization stays local inside a complete bundle, while incomplete commercial bundles retain the provider pricing partition and publication remains crash-atomic.
- Specialized zero placeholders never repair a missing amount by themselves. Page values whose
  `+N more` presentation hides applicability remain raw rather than guessed.
- models.dev fetches the same Vercel API but preserves hand-maintained enrichment and only the first
  base token tier. LiteLLM's scheduled transformer requires a narrow language-model shape, so it
  cannot represent page-only, media-native, rerank, speech, realtime, route, regional, or service-tier
  pricing.
- ccusage refreshes pinned LiteLLM and models.dev pricing inputs hourly, embeds both snapshots, and can refresh them at runtime. It estimates coding-agent token cost from local usage and explicitly excludes tool calls; it is not a Vercel billing or generation-log reader. Portkey's public model-price repository has no first-class Vercel AI Gateway price book. All of these remain comparison-only diagnostics and never fill or override first-party facts.
