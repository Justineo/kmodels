# OpenAI

Status: current

## Boundary

The OpenAI partition follows the shared invocation-cost boundary. It publishes public rates that
can be selected from a proxied request or attributed from its response or asynchronous result:

- Standard, Batch, Flex, and Fast model inference;
- text, cached input, cache write, audio, image, embedding, transcription-duration, generated
  image, and generated video rates;
- Web Search and File Search calls;
- Hosted Shell and Code Interpreter container sessions; and
- inference through a fine-tuned model, including the published data-sharing selector.

It does not publish fine-tuning training, vector-store or ChatKit retained storage, capacity,
subscriptions, spend limits, invoices, credits, or account settlement. Those facts do not become
raw pricing merely because the canonical wire can represent them.

Fine-tuned inference remains in scope because it is a direct generation call. It is one shared
provider-service book per published base schedule, not a private-model template. Training rates,
enrollment state, derived-resource edges, and private fine-tuned IDs are unnecessary for pricing
that call and are excluded.

## First-party sources

| Source                                                                                                                    | Role                                                                             |
| ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| [`/api/docs/models/all.md`](https://developers.openai.com/api/docs/models/all.md) and its exact Markdown model-card links | Exhaustive public identity and model semantics                                   |
| [`/api/docs/models/all`](https://developers.openai.com/api/docs/models/all) and its HTML cards                            | Optional card-local price fallback where the Markdown rendering omits tier state |
| [Changelog](https://developers.openai.com/api/docs/changelog)                                                             | Exact public model release dates                                                 |
| [Pricing](https://developers.openai.com/api/docs/pricing)                                                                 | Current public amount authority and provider-service rates                       |
| [Official OpenAPI](https://github.com/openai/openai-openapi/blob/master/openapi.yaml)                                     | Optional response and Organization Usage pricing-input contracts                 |
| [Batch guide](https://developers.openai.com/api/docs/guides/batch)                                                        | Asynchronous result and output-file accounting contract evidence                 |
| [Fast mode](https://developers.openai.com/api/docs/guides/fast-mode)                                                      | Fast request and returned served-tier semantics                                  |
| [Flex processing](https://developers.openai.com/api/docs/guides/flex-processing)                                          | Flex request-tier and processing semantics                                       |
| [Deprecations](https://developers.openai.com/api/docs/deprecations)                                                       | Non-exhaustive lifecycle dates and replacements                                  |
| [Your data](https://developers.openai.com/api/docs/guides/your-data)                                                      | Exact endpoint and regional-processing eligibility                               |
| Authenticated `GET /v1/models`                                                                                            | Optional account-scoped positive inventory evidence                              |

No community catalog supplies production facts. `models.dev` and LiteLLM are investigation aids
only.

The model crawl fetches only the model index and discovered model cards. General documentation
indexes and guide pages are not atomic dependencies of the catalog. The OpenAPI repository is a
separate optional pricing-input source: it never creates model identity or rates, and its absence or
field-level drift removes only the affected input mapping. It cannot stall or erase the required
pricing-page partition.

## Identity and catalog extraction

- The model index establishes the exhaustive set of public model IDs and current/deprecated badge.
- A card contributes rich facts only when its URL and single `Model ID` agree.
- Display name, description, snapshots, routed aliases, modalities, limits, endpoint support,
  capabilities, and tool support are parsed independently where possible.
- Changelog `Feature` entries provide the earliest exact release date for catalog identities; later
  updates do not move that date and unknown changelog identities cannot create catalog rows.
- A missing, duplicated, or malformed card does not remove its indexed identity. The collector
  publishes the minimal indexed row, reports a contract signal, and continues with valid siblings.
- Discovered card fetches are optional within the bundle for the same reason. A failed card becomes
  a local omission rather than a provider transport failure.
- Endpoint rows use reviewed exact route/name pairs. A new route, support label, modality, region,
  or table column is withheld locally and reported; known sibling facts remain usable.
- The HTML price overlay binds only to an exact catalog ID. Missing, duplicate, unbound, or malformed
  HTML cards are skipped independently. Omitted overlay facts retain their previous observation;
  the dedicated pricing page remains the primary amount source.
- The optional API inventory can add only positive account-visible evidence. Absence and private
  IDs never remove or widen the global catalog, and raw authenticated bodies are not retained.

Natural catalog growth is bounded by a generous transport safety ceiling rather than a narrow
expected-count allowlist. Provider-level regression validation, not a hard-coded current row count,
protects against accidental mass deletion.

## Pricing mapping

The dedicated pricing page is non-exhaustive for model identity but authoritative for every exact
rate it publishes. An exact valid model-ID row may create a minimal public row when the model index
does not list it. Non-ID labels bind only through a unique exact display name or documented alias;
there is no family inheritance or fuzzy matching.

The same page currently states that `gpt-daybreak-blue-latest` and `gpt-daybreak-red-latest` route to
`gpt-5.6-sol` and `gpt-5.6-cyber`, respectively, with pricing adjusted to the underlying model.
Kmodels therefore derives the aliases' current rates from those exact targets while preserving all
four callable IDs as separate catalog identities. If that declaration disappears or stops binding
uniquely, only the alias rates become unknown.

Model-card prices are fallbacks. For the same meter, denomination, unit, and applicability:

- equal card and pricing-page values coalesce;
- an unequal pricing-page value wins through
  `openai_pricing_page_over_model_card` and the superseded card value remains visible as conflict
  evidence; and
- unequal duplicates within the pricing page have no deterministic winner, so only that exact rate
  becomes bounded raw `conflicting_values`; sibling rates and models continue.

Unknown sections, tiers, table shapes, rows, cells, tools, and modalities are reconciled locally.
They never reject already parsed tables. A refresh still fails atomically when the required pricing
source yields no admitted model or service fact at all; that protects the previous verified
partition from an unrecognizable whole-page rewrite.

The normalized selectors are source-backed dimensions shared with other providers:

- `service_tier`: `standard`, `batch`, `flex`, or `fast`;
- context min/max token bands;
- modality, quality, resolution, and container capacity;
- operation for Web Search variants; and
- `account_eligibility=data_sharing` for the published fine-tuned inference discount.

Batch is a separate result-item mechanism. Standard, Flex, and Fast remain variants of synchronous
inference. Returned usage selects cache, modality, generated quantity, and served-tier rates; a
request selector alone is not treated as final billed usage.

The optional accounting contract maps Responses usage, image-generation usage, embedding usage,
video result duration/resolution, and Organization Usage result fields into charge quantity methods.
Text uncached input has two exact alternatives where available: the Organization Usage
aggregate `input_uncached_tokens` counter, or the response calculation
`input_tokens - cached_tokens - cache_write_tokens` with a zero floor. Completion audio/image token
partitions, image-generation output tokens, speech characters, transcription seconds,
generated-image counts, and Web/File Search request counts use provider fields whose schemas
establish those exact units. Reasoning usage remains a reported subset of output tokens and is not
charged twice.

When a model publishes distinct text, audio, or image token rates, Kmodels does not reuse aggregate
response totals for the text term. It binds the text, audio, image, and cached partitions only to
their matching Organization Usage counters. This prevents one multimodal quantity from being
charged under two modality rates.

The image-generation response reports total text/image input partitions but does not split either
partition into uncached and cache-read quantities. Because the pricing page publishes different
rates for those quantities, Kmodels publishes semantic charge bindings for all four input terms but
no input-source method. The downstream calculator must supply those billable partitions from a more
authoritative source. Kmodels does not mislabel the response totals as uncached usage.

Rate variants also expose source mappings for selectors that the contracts actually return:
served service tier, response input-token context, image quality/size, and video size. Deployment
scope, account eligibility, and tool operation remain required route/request inputs because the
accounting response does not establish them at the needed scope. Organization Usage mappings are
marked reconciliation-only; they are an aggregate calculation path, not a request lifecycle or an
invoice reconciliation feature inside Kmodels.
The served-tier selector also publishes the response normalization proven by OpenAI's contract:
`default` selects Standard, `flex` selects Flex, and returned `priority` selects Fast mode. Request
`auto`, Scale Tier, and access-controlled tiers do not select a public-list variant unless the
provider publishes and Kmodels admits a matching schedule.
Video result sizes are likewise normalized to the pricing table's size classes: `1280x720` and
`720x1280` select `720p`; `1024x1792` and `1792x1024` select `1024p`; and `1080x1920` and
`1920x1080` select `1080p`. An unreviewed size remains unmapped instead of being guessed from its
dimensions.

## Direct provider services

Web Search and File Search calls are separate service books because they have their own event rates.
Their provider-owned charge signals map to Organization Usage `num_requests`, rather than assuming
that emitted or successful tool-call events have the same billing semantics. Those mappings are
reconciliation-only; a request-time calculator still needs an equally authoritative per-request
counter if it cannot wait for the account report.
Web Search content tokens are additional model input usage. Kmodels does not create a contribution
edge merely to repeat that prose: ordinary input-token accounting already prices provider-reported
content tokens when they are included in input usage. The current fixed 8,000-token rule for the
non-preview tool on `gpt-4o-mini` and `gpt-4.1-mini` remains a visible accounting limitation until
the exact billable block can be bound without double-counting response input tokens.

Container prices remain a separate code-execution service with memory as applicability. The
published table states a 20-minute session schedule while the current prose states per-minute
billing with a five-minute minimum for eligible sessions. The numeric schedule binds to a
provider-owned count of billed 20-minute session blocks, which makes the calculator's required input
explicit but intentionally has no source mapping. The five-minute eligible-session minimum remains
a `base_price` raw term; Kmodels does not invent proration or reuse the Code Interpreter account
counter for Hosted Shell.

Fine-tuned input, cached-input, and output rates form a direct `fine-tuned-inference:<base>` service.
Standard and Batch are split into the same synchronous/result-item mechanisms used by ordinary
model books. Within each mechanism, the unqualified published row uses
`account_eligibility=default` and the discounted row uses `account_eligibility=data_sharing`; this
keeps the two source-declared account schedules disjoint without adding a provider-specific price
dimension. The requested private ID, training job, retained artifacts, and account enrollment are
outside the public partition.

## Regional processing

The data-residency matrix supplies exact eligible endpoints, models/snapshots, regions, and listed
snapshot exceptions. Unknown regions or endpoints are withheld without discarding known values in
the same row.

OpenAI publishes a 10% regional-processing uplift for eligible data-residency models released on or
after 2026-03-05. The changelog supplies the exact release date and the data-residency matrix supplies
regional eligibility. When both facts establish applicability, each published rate is split into a
global-processing value and a derived `1.1 ×` regional-processing value. Earlier models keep their
published rate without a processing-scope selector. The collector neither infers release dates from
model IDs nor applies the uplift to every model merely because it appears in the residency matrix.

## Presentation and cost use

Model detail presents synchronous and Batch mechanisms and their rate dimensions. Web/File Search,
code execution, and fine-tuned inference are named provider services. Training and storage do not
appear as plans, standalone offers, or advanced raw details.

A Gateway can calculate the public-list portion of a request from the returned model, served tier,
token/cache and modality breakdown, generated quantity or duration, and the published quantity
methods. Batch output-file locations, container proration, regional deployment scope,
account-eligibility selectors, and the fixed Web Search content-token block remain explicit required
inputs or localized raw limitations where the reviewed contracts do not yet prove an exact mapping.
Organization Usage may calculate or compare grouped public-list cost later; actual spend, discounts,
credits, and invoice reconciliation remain outside Kmodels.

Model books use separate synchronous and Batch offers, but do not add redundant `exclusive_with`
edges: the mechanisms already select different executions. Service-book `model_refs` fully express
which models can use Web Search, File Search, or containers, so those books likewise need no
`compatible_with` fan-out to every model offer.

## Refresh invariants

- Refresh is deterministic and requires no LLM.
- First-party model, pricing, lifecycle, residency, and optional inventory sources fail or retain
  independently.
- One bad card, row, cell, tool, endpoint, or region cannot reject the provider.
- Indexed identity survives a bad card; an exhaustive fresh index omission may still remove it,
  subject to lifecycle evidence and provider-level regression gates.
- No price is inherited across a family, successor, provider, deployment channel, or private ID.
- Every admitted normalized or raw fact retains its exact source reference and observation time.
