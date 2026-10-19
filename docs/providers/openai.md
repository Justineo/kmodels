# OpenAI

Status: current

OpenAI extraction lives in `src/catalog/openai.ts`, with the accounting recognizer in
`src/catalog/openai-accounting.ts`. `adapters.ts` owns dispatch and shared error translation;
`source-parse.ts` owns the structural parser input contract. Moving provider code does not change
transport, source order, publication or replay boundaries.

## Boundary

The OpenAI partition follows the shared invocation-cost boundary. It publishes public rates that
can be selected from a proxied request or attributed from its response or asynchronous result:

- Standard, Batch, Flex, and Fast model inference;
- text, cached input, cache write, audio, image, embedding, transcription-duration, generated
  image, and generated video rates;
- Web Search and File Search calls;
- GPT-Live active session time, Hosted Shell and Code Interpreter container sessions; and
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
| [Official OpenAPI](https://github.com/openai/openai-openapi/blob/master/openapi.yaml)                                     | Optional response and Realtime pricing-input contracts                           |
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
  Month/day headings must establish a real calendar date. An unreadable heading clears the
  previous date so later entries cannot inherit it. An irregular deprecation row is signaled and
  skipped locally. Repeated shutdown notices retain the latest date and all observed aliases,
  independently of row order.
- A missing, duplicated, or malformed card does not remove its indexed identity. The collector
  publishes the minimal indexed row, reports a contract signal, and continues with valid siblings.
- Discovered card fetches are optional within the bundle for the same reason. A failed card becomes
  a local omission rather than a provider transport failure.
- Endpoint rows use reviewed exact route/name pairs. A new route, support label, modality, region,
  or table column is withheld locally and reported; known sibling facts remain usable.
  Repeated endpoint rows must agree. A conflicting or unreadable peer withholds that route's
  support; a third matching row cannot erase the conflict. Equal peers retain the known support.
  The reviewed `Live` / `v1/live/sessions` pair supplies speech-to-speech session support;
  it does not replace separately declared backend Responses endpoints.
- The HTML price overlay binds only to an exact catalog ID. Missing, duplicate, unbound, or malformed
  HTML documents are skipped independently. Unrecognized price cells, units and tier-switch
  states preserve bounded raw quotes while readable sibling cells survive.
  Omitted overlay facts retain their previous observation;
  the dedicated pricing page remains the primary amount source.
  One owned Pricing region supplies cells and modifier paragraphs; competing regions stay raw.
  Quoted, code, and unrelated sections cannot supply executable modifiers. The exact full-request
  long-context rule establishes both the base upper bound and the derived lower bound. Counts
  require safe whole tokens and proper grouping; ambiguous bounds stay raw, while a known bound
  with an unreadable multiplier preserves the base band and the unresolved long rule.
  Explicit `Cache writes` cells take precedence over deriving the same scoped rate from its
  multiplier note. The reviewed long-context wording `input and cache rates` applies to both
  cache reads and writes. A flat explicit write quote remains flat when the long rule does not
  qualify writes; missing writes derive from the already scoped input rates. Unreadable owned
  modifiers retain raw evidence and report a contract diagnostic eligible for repair investigation.
  `Live session duration` / `Per minute` is a session-runtime rate,
  separate from backend model and tool charges. Minimal fixtures reproduce these public
  [Sol](https://developers.openai.com/api/docs/models/gpt-6-sol) and
  [Live](https://developers.openai.com/api/docs/models/gpt-live-1) card labels observed on 2026-10-04.
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
A new price-only identity requires a reviewed price-bearing table with a normalized or bounded raw
quote, or an explicit free schedule.
An unreviewed table or a row containing only missing amounts cannot create an identity or make an
otherwise empty pricing response pass admission. Valid sibling rows remain independent.

The pricing page's Short and Long context columns mean at most 272,000 and more than 272,000
input tokens respectively. The native HTML tooltips establish this definition; the Markdown
rendering retains the column names but omits those tooltips. Each column carries its own bound
even when every quote in the opposite column is absent. Neither a peer quote nor the model's
maximum context window establishes a tariff boundary.

Alias prices are derived only while the pricing page declares exact, unique target IDs. The current
[Daybreak guide](https://developers.openai.com/api/docs/guides/daybreak) says `latest` resolution
depends on access and can change; the returned model identifies the actual target. That does not
establish a universal static alias tariff, so the missing declaration leaves these rates unknown.

Model-card prices are fallbacks. For the same meter, denomination, unit, and applicability:

- equal card and pricing-page values coalesce;
- an unequal pricing-page value wins through
  `openai_pricing_page_over_model_card` and the superseded card value remains visible as conflict
  evidence; and
- unequal duplicates within the pricing page have no deterministic winner, so only that exact rate
  becomes bounded raw `conflicting_values`; sibling rates and models continue.

The provider-owned authority resolver compares denomination, canonical billing unit and published
validity before applying a pricing-page override. It subtracts only overlapping applicability;
disjoint resolution, region, quality and currency schedules survive. Equal prices retain both source
observations. Context-token boundaries use exact whole-token complements, and boolean or explicitly
bounded categorical remainders remain numeric. If a remainder would require an undeclared negative
categorical selector or exceed the reviewed selector contract, the card amount remains bounded raw
`unknown_applicability` evidence rather than disappearing or acquiring an invented selector.
Differently declared validity intervals are preserved for ordinary conflict validation; no temporal
boundary is inferred from the authority rule.

The source parser retains all distinct observations of the same page rate. Shared canonical assembly
turns unequal values into `conflicting_values` raw pricing, including third and later observations,
without restoring a fallback card tariff or using an assembly-reserved reason in adapter input.

Pricing sources return service facts, reviewed vocabulary and supplemental terms independently of
model observations. A service-only page can be admitted without a catalog carrier; a fixed-content
service binds only an exact model already established by the catalog or a reviewed price row.
Container minimums become typed charge calculations, fixed-search blocks become canonical
contributions, and Fast/EU exclusions become scoped state facts. Later assembly never decodes their
amounts or states from raw evidence.

Unknown sections, tiers, table shapes, rows, cells, tools, and modalities are reconciled locally.
They never reject already parsed tables. A refresh still fails atomically when the required pricing
source yields no admitted model or service fact at all; that protects the previous verified
partition from an unrecognizable whole-page rewrite.
Source accounting counts reviewed model-table price positions individually, including explicit
missing positions and excluded training cells. Tool schedules count each native quote (each
container capacity separately), while excluded storage rows and rejected structures have one
disposition each. HTML cards count price cells and explicit multiplier rules. Alias, container
minimum and fixed-search declarations each count once. Derived variants do not inflate the count;
conflict or scope failures recategorize the originating positions instead of adding another item.

Unsupported amounts retain the native value, known meter, unit and conditions as independent raw
terms, so a malformed long-context quote can coexist with a readable short-context rate. Unknown
currency text never acquires an invented USD denomination. An unreadable native transcription
token price cannot fall back to the page's estimated duration price. `Free` in an individual cell
is a scoped zero rate and participates in ordinary numeric conflicts; only the reviewed free
moderation schedule establishes a whole-model free state.

The normalized selectors are source-backed dimensions shared with other providers:

- `service_tier`: `standard`, `batch`, `flex`, `fast`, or `ultrafast`;
- context min/max token bands;
- modality, quality, resolution, and container capacity;
- operation for Web Search variants; and
- `account_eligibility=data_sharing` for the published fine-tuned inference discount.

Both `Fast` and the older `Fast mode` heading select the same tier. `Ultrafast` has its own published
table; it never inherits Fast amounts. Unknown tier/table/cell diagnostics remain local.
Batch is a separate result-item mechanism. Standard, Flex, Fast, and Ultrafast remain variants of synchronous
inference. Returned usage selects cache, modality, generated quantity, and served-tier rates; a
request selector alone is not treated as final billed usage.

The optional accounting contract maps Responses usage, image-generation usage, embedding usage,
video result duration/resolution, and Realtime response events into charge quantity methods.
These are source-level facts and do not create a model row.
The known uncached-input equation remains available with surviving locators when an accounting
field drifts; unmapped required signals remain caller inputs. Responses uncached input uses
`input_tokens - cached_tokens - cache_write_tokens` with a zero floor. Image output tokens,
embedding prompt tokens, generated-image counts and video durations use their own API's exact units.
Speech characters and transcription seconds remain caller quantities when no direct response field
establishes them. Reasoning usage remains a reported subset of output tokens and is not charged twice.

Every acquired field requires positive catalog support for its exact endpoint name and route.
Realtime, Responses, image, embedding and video contracts are not interchangeable. Batch result
items do not borrow synchronous response counters or selectors. Fine-tuned service schedules have
no inferred endpoint contract; their semantic quantities and known equations remain caller inputs.

Accounting paths require owned properties and declared types, including the returned object's
actual attachment to its usage schema. The recognizer follows reviewed local references and schema
compositions, rejects duplicate schemas/properties/types, nested lookalikes, reference cycles and
conflicting union types, and withholds only the affected mappings. Counters require integer
types; selectors and video duration retain their source-declared String representations; generated
image counts require an Array. Missing or partial mappings are reported as partial contracts.
The current official OpenAPI establishes all 23 reviewed fields; the
[prompt-caching guide](https://developers.openai.com/api/docs/guides/prompt-caching) independently
establishes the total-minus-cache-read-minus-cache-write quantity equation. Cache writes form their
own input partition rather than an additional charge on ordinary input.

For a model supporting the native Realtime API, the owned `response.done` event supplies text,
audio and image input counters, their separate cached subsets, and text/audio output counters.
Its typed event discriminator and attachment to `RealtimeResponse` must agree. The
[per-response cost guide](https://developers.openai.com/api/docs/guides/voice-latency-cost#example)
and OpenAPI establish that cached tokens are included in input totals. Each uncached modality
therefore subtracts its own cached counter with a zero floor; cache and output charges use only
their own partitions. The calculation boundary is one response, including terminal usage after a
failed, cancelled or incomplete response. There is no session-total substitution or absent-as-zero
rule. Missing counters keep known equations and surviving mappings while required values stay
unknown. Uncached quantities do not change meaning when a peer cache price is missing.

Realtime mappings require the matching endpoint and no unrelated operation restriction. A priced
cache-write partition with no native counter withholds the unproved uncached-input equation.
Related-rate checks use the same denomination, unit, overlapping applicability, published validity
and execution mechanism, so a different currency, time interval or Batch tariff cannot change a
synchronous quantity method. Other separately priced modalities do not acquire aggregate Responses
input/output or cached counters; a missing per-request partition is not filled from an account report.

The image-generation response reports total text/image input partitions but does not split either
partition into uncached and cache-read quantities. Because the pricing page publishes different
rates for those quantities, Kmodels publishes semantic charge bindings for all four input terms but
no input-source method. The downstream calculator must supply those billable partitions from a more
authoritative source. Kmodels does not mislabel the response totals as uncached usage.

Rate variants also expose source mappings for selectors that the contracts actually return:
served service tier, response input-token context, image quality/size, and video size. Deployment
scope, account eligibility, and tool operation remain required route/request inputs because the
accounting response does not establish them at the needed scope. Realtime does not borrow Responses'
served-tier or context selectors. Organization Usage results are time-bucket aggregates with optional
model, tier and Batch grouping. Neither a `results[*]` locator nor a reconciliation-only label proves
a single request or a homogeneous price scope. They are not pricing-input contracts for the
request, session or result-item bindings published here.
Historical acquisition corrections preserve captured price/source revisions and the original
compilation input. They may withdraw bucket or unsupported API paths while retaining independently
established calculations and valid direct response fields. They cannot attach a newer Realtime
contract to an older transaction. A calculation-only uncached-input method requires the published
total, cache-read and cache-write signals, rather than the withdrawn bucket shortcut.
The served-tier selector also publishes the response normalization proven by OpenAI's contract:
`default` selects Standard, `flex` selects Flex, returned `priority` or `fast` selects Fast mode,
and `ultrafast` selects the independently published Ultrafast schedule. Request
`auto`, Scale Tier, and access-controlled tiers do not select a public-list variant unless the
provider publishes and Kmodels admits a matching schedule.
Video result sizes are likewise normalized to the pricing table's size classes: `1280x720` and
`720x1280` select `720p`; `1024x1792` and `1792x1024` select `1024p`; and `1080x1920` and
`1920x1080` select `1080p`. An unreviewed size remains unmapped instead of being guessed from its
dimensions.

Optional first-party Fast and Ultrafast guides are claim-local pricing companions. The Fast guide's
explicit EU exclusion list binds exact named models, including GPT-6 Astra, GPT-6.1 Sol, GPT-6 Sol,
and GPT-6 Luna. Their Fast variants require `eu_data_residency=false`, with `not_supported` for
the excluded combination. The older pricing-page Astra declaration is still recognized.
Ultrafast admits global processing and US regional processing only when its guide establishes that
scope; the regional variant carries the published uplift and `region=United States`. If the guide
is absent or that claim drifts, Ultrafast amounts remain bounded raw evidence while other tiers
survive. The renamed Fast table likewise retains amounts as raw when neither its guide nor the
pricing page establishes the reviewed regional restriction. Preview access alone never supplies
another model's Ultrafast price.

## Direct provider services

The reviewed GPT-Live `Model | Price per minute` table publishes the exact model session-runtime
rate. It normalizes to seconds and binds active seconds at session scope; 90 seconds at $0.05 per
minute costs $0.075. Backend model and tool calls are separately priced components, so the session
fee alone is not the complete workflow cost. No whole-minute rounding is introduced.

Web Search and File Search calls are separate service books because they have their own event rates.
Their provider-owned charge signals require billable per-request counts from the caller. Emitted or
successful tool-call events and Organization Usage bucket totals do not establish that quantity.
Web Search content normally uses the model input-token rate. For the non-preview tool on
`gpt-4o-mini` and `gpt-4.1-mini`, the pricing page explicitly charges a fixed 8,000-input-token
block per call. A model-specific `web-search-content:<model>` service contributes
`8,000 tokens × billable call instances` to the exact synchronous model input rate term. The
contribution references that term rather than copying its price, so its tier and other conditions
remain authoritative. The ordinary
search call fee remains independently payable. No block is inferred for another model or the
preview tool. An unresolved target input rate leaves the fixed-block rule raw. The source parser
reads the block size as data from this reviewed sentence in the Tools section. Unknown wording keeps
a scoped raw rule; unequal declarations downgrade the conflicting contribution locally. Equal
quantities with different source formatting merge their native observations.

The fixed-content charge takes the number of billable calls whose content blocks are excluded
from separately priced model input usage. Consumers either exclude these blocks from ordinary
input usage and add this charge, or supply final billable input tokens including the blocks and
do not add the fixed-content charge again. A runtime locator is not required to publish or evaluate
this exact price rule; Kmodels does not assume an aggregate usage field supplies that partition.

Container prices remain a separate code-execution service with memory as applicability. The pricing
bundle includes the official changelog, whose June 2, 2026 announcement explicitly preserves the
underlying per-minute price while introducing a five-minute minimum for eligible sessions. When
both claims agree, the published 20-minute price divides by 20 and a session-level minimum applies
to the provider-billed duration. Minute billing and session-block billing are mutually exclusive
eligibility variants. The caller supplies eligibility and provider-billed duration at the provider's
minute granularity; no wall-clock rounding or acquisition field is invented. The legacy variant
still uses billed 20-minute blocks. The pricing declaration must belong to Tools, and every recognized
peer in the page and changelog must agree on the minimum and effective date. Missing, unreadable or
contradictory claims keep the native rules raw without affecting unrelated services or models.

Fine-tuned input, cached-input, and output rates form a direct `fine-tuned-inference:<base>` service.
Standard and Batch are split into the same synchronous/result-item mechanisms used by ordinary
model books. Within each mechanism, the unqualified published row uses
`account_eligibility=default` and the discounted row uses `account_eligibility=data_sharing`; this
keeps the two source-declared account schedules disjoint without adding a provider-specific price
dimension. The requested private ID, training job, retained artifacts, and account enrollment are
outside the public partition.

## Regional processing

An exact `Billing for <model> begins on <date>` notice bounds that model's tariffs by
`effective_from`; its explicitly stated approved-research eligibility remains a condition.
An unreadable announced date preserves raw amounts instead of publishing an undated rate.
In particular, GPT-Rosalind Research's published billing starts on 2026-10-05; the future
tariff does not imply either a paid or a free rate before that date.

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
methods. Fixed Web Search content contributes 8,000 input tokens per eligible call using the
referenced model input rate. Batch output-file locations, regional deployment scope, and
account-eligibility selectors remain explicit required inputs. Container proration remains a
localized raw limitation where the reviewed contracts do not prove an exact rule.
Organization Usage can support external grouped comparisons when all relevant price scopes are
independently established; actual spend, discounts, credits and invoice reconciliation remain
outside Kmodels.

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
