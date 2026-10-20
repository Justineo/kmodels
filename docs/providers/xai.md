# xAI

Status: current

## Boundary

The xAI partition contains only public first-party rates that an AI Gateway can
attribute to a direct generation request or its result. It is an implementation of the
shared canonical price model, not a separate xAI billing model.

Included:

- synchronous and Batch text inference, including cache read, long-context, region,
  and realized Priority variants;
- direct image and video generation, including published resolution, quality, input
  media, and duration components;
- Speech to Speech, Text to Speech, and REST/streaming Speech to Text;
- paid server-side Web Search, X Search, Code Execution, File Attachment Search,
  Collections Search, and Responses image-generation tool calls;
- the published pre-generation Responses usage-guideline violation fee.

Excluded:

- retained File and Collection storage or downloads;
- custom-voice creation, slots, account settings, ZDR, data residency, and rate-limit
  contracts;
- prepaid/postpaid balances, credits, invoices, negotiated discounts, and other
  settlement or procurement facts;
- consumer Grok subscriptions and partner-cloud prices;
- included or zero-price tool descriptions, undocumented PSTN candidates, and
  amount-unpublished context compaction.

Those excluded facts may matter to an xAI account, but they do not define the rate of a
proxied generation request. The collector therefore does not fetch or hard-code their
dynamic product documentation as a refresh dependency.

## Sources and identity

- The public Models page embeds `globalThis.__XAI_PUBLIC_MODELS__`. Statically extract
  this first-party payload; never execute it. It supplies public model/service identity,
  version, aliases, regions, capabilities, and exact fixed-point rates.
- The fixed `llms-full.txt` companion supplies the dedicated pricing section, release notes,
  lifecycle redirects, Batch and Priority terms, endpoint examples, Voice model IDs,
  and paid-tool semantics. `llms.txt` is only a link index and cannot replace the complete
  sectioned document; the missing pricing sections would discard provider-resource evidence.
- Only release-note entries that announce availability (`is [now] available`, `is live`,
  `is released`, `you can now use`, `generally available`, `early access`, `beta`) establish
  `release_date`. Retirement, redirect, pricing, and modality-update entries for an already
  callable model are revisions. A model documented only through such revisions reports no
  `release_date`, and its alias snapshot date stays the `updated_date`.
  The Chat Completions, Responses, and Speech to Text accounting contracts are read from their
  reviewed `/developers/rest-api-reference/inference/chat-completions`,
  `/developers/rest-api-reference/inference/responses`, and
  `/developers/rest-api-reference/inference/speech-to-text` sections.
- The dedicated pricing table owns a current public amount when its model and
  applicability match exactly. Conflicts with the embedded payload or Models summary
  are retained as warnings; they do not discard the model or unrelated rates.
  Language models with different fixed-point prices across public clusters retain one identity
  and distinct region-qualified amounts. For these models, the unscoped summary cannot override
  the narrower regional prices. Batch and Priority multipliers apply to each region's own base
  rates. Batch availability is a regional commercial attribute and does not split identity.
  Conflicting intrinsic identity/capability fields across regions, or competing prices within the
  same region, still reject rather than selecting an arbitrary row.
- Optional authenticated model inventories are enabled by `XAI_API_KEY`. They are
  account-scoped observations and may enrich a matching public identity, but cannot
  create global presence or replace the public price book.
- Comparator catalogs and Azure, OCI, or Agent Platform listings are audit evidence only. Their
  identities and prices belong to their respective sellers.

Catalog and authenticated inventory parsers return the explicit source envelope. Public service
rates and accounting contracts belong to the source, independently of its model observations;
no model is selected as their storage carrier. Service-only results can be captured and replayed.
Services whose applicability names models still require the exact admitted model identities.

Preserve the structured `version` as identity. Dated aliases are evaluated at the
observation time. Exact retired IDs that still redirect remain separate legacy rows and
derive the target rate from the documented redirect date. The model inventory admits the public
Realtime identities. Internal service configuration labels alone do not establish additional
TTS/STT model identities.

## Resilient collection

Unknown additive fields are accepted with an `unknown_field` signal and do not trigger
unchanged-body repair. Unknown consumed model categories, feature tags, resolution attributes,
and optional API inventory values retain their contract signals. Recognized rows and
rates continue to refresh. Unknown model categories are not guessed into the catalog;
they remain visible for review.

Malformed required identity, invalid required price values, or a recognized row that no
longer satisfies its semantic schema remains a row-local signal where possible. A
claim-specific prose/table drift suppresses only that claim. It must not reject the
provider or erase sibling model, lifecycle, capability, or price facts. Item-count
bounds still protect against an empty or obviously truncated primary catalog.

Resolution and quality values are source-owned strings with bounded structural
validation rather than a closed provider allowlist. This lets new published choices
refresh mechanically while preserving their exact applicability.

## Shared price projection

- Text Chat Completions and Responses use one synchronous offer. Streaming and
  response retrieval are delivery behavior unless xAI publishes a distinct rate.
- Batch is a separate execution offer. Explicit per-model, per-region `batchEnabled` flags own
  availability. A published exclusion list is a fallback only for unflagged rows; a guide that
  delegates eligibility to model pages leaves those rows unknown. Published discounts apply to
  exact listed text models and token types. Media Batch prices additionally require the independent
  published standard-rate rule. Availability alone cannot create a tariff.
- Priority is a synchronous rate condition selected from the realized response
  `service_tier`, not a separate capacity product.
- Base text price fields explicitly own xAI's native `default` tier before assembly, including
  their context bands and independent of a Priority quote. The provider contract equates `default`
  with Standard processing. Commercial topology partitions Batch and projects the served-tier
  dimension; it cannot add a missing default predicate or an unobserved vocabulary value.
- Image and video books use direct and, when supported, Batch offers. Output resolution,
  quality, and duration select rate variants; input media components remain additive. The
  unqualified summary is a consistency check against the explicit resolution rates, not an
  additional tariff or an assertion about the default resolution. A matching published tier is
  consistent regardless of list order. Deprecated `imagePrice` neither supplies prices nor
  invalidates a model whose resolution tariffs remain readable.
- Speech to Speech is a model-bound realtime offer. xAI publishes one audio-duration
  rate rather than separate input/output audio rates, plus a per-text-input-event rate. An exact
  `Deprecated` suffix on a pricing row changes neither its ID nor its still-published numeric rate.
  The audio-duration row accepts the current layout without the redundant `audio` word before the
  line break. The minute amount and text-input-event amount remain separate charges; the adjacent
  hourly equivalent is not charged again.
- TTS and STT tariffs are provider-resource books. The optional STT model selector does not scope
  the public price rows, which distinguish REST from streaming mode. These remain distinct offers
  because their published rates differ; the partition does not turn shared service prices into
  engine-specific model rates.
- Each paid server-side tool is a provider-resource book. A Responses endpoint alone does not
  establish support for every built-in tool; no text-model compatibility list is inferred from it.
  The Voice guide's explicit tool support can establish Voice model references. The partition
  does not repeat references as `compatible_with` relations. The model rate and each separately
  billed tool quantity are additive.
  X Search's current table charges separately per fetched post (including parent and quoted posts)
  and fetched user profile. These use distinct provider resources and item quantities; a successful
  tool-call counter cannot substitute for either quantity. The legacy per-call layout remains
  supported only when that rate is actually published.
- The image-generation tool reuses the exact Imagine model named by its dedicated tool guide,
  resolved against an existing public catalog identity. xAI reports successful
  calls, but the reviewed result contract does not establish an exact completed-image extraction
  or the resolution/quality needed to choose a variant. Those quantities and selectors remain
  caller supplied. Synchronous tool prices never inherit the source model's Batch variants.
- The pre-generation violation amount is normalized and displayed, but stays unbound
  until a stable request/result signal distinguishes that outcome.

No xAI offer contains settlement, enrollment, account-resource edges, storage,
allowances, or commercial-plan topology.

## Charge signals

The source maintains 31 reviewed, field-local accounting contracts. REST fields must belong
to the unique documented operation's Response Body, have the expected numeric/string/array type,
and retain their exact parent chain. SDK counters require their owned token-usage sections;
billable tool categories additionally require the successful-call map and category table.
Fenced examples, request lookalikes, duplicate owners, and unrelated mentions cannot establish
these facts. A missing consumed field suppresses only its locator, with a local diagnostic.
Deliberately unsupported coverage is not a recurring contract failure.

The compiler binds an endpoint-specific method only to a model with positive evidence for that
route. Quantities without an established acquisition path remain caller inputs. Text prices use
provider-owned uncached text, cached text, and text-output quantities; an aggregate input or output
quantity cannot silently satisfy a Text quote.

| Surface                    | Reviewed acquisition                                                                           | Calculation and limits                                                                                           |
| -------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Chat Completions           | prompt text, aggregate cache, prompt image, completion, reasoning, total prompt, realized tier | uncached text = prompt text − cache only for text-only input; output = completion + reasoning                    |
| Chat streaming             | the same counters, with the documented terminal usage chunk                                    | missing terminal usage remains unknown                                                                           |
| Responses                  | aggregate input/cache, output, realized tier, fetched X posts/profiles                         | input − cache and cache-to-text mapping only for text-only models; output is direct                              |
| xAI SDK agent              | cumulative prompt, cached prompt text, prompt image, completion, reasoning                     | text cache/image are distinct; output = completion + reasoning; cumulative prompt is not a context-band selector |
| Direct image generation    | owned successful output `data` array                                                           | count returned images; request input count and effective resolution/quality remain caller supplied               |
| Direct video generation    | owned successful polled result's `video.duration`                                              | generated seconds; request media and resolution remain caller supplied                                           |
| REST Speech to Text        | owned numeric `duration` response                                                              | processed audio seconds                                                                                          |
| Per-call server-side tools | successful SDK Web Search, Code Execution, and Collections Search categories                   | attempted calls cannot substitute for successful billable calls                                                  |
| X Search                   | Responses `usage.server_side_tool_usage_details.x_posts_fetched` and `x_users_fetched`         | distinct item quantities, including nested/thread posts and repetitions; never substitute X Search call counts   |

Chat completion tokens exclude the separately reported reasoning count; Responses output tokens
already contain reasoning. These endpoint-specific formulas must remain distinct. Chat's text
counter includes cached and uncached text, but its cache counter has no documented modality split.
For multimodal models, aggregate cache is therefore not automatically mapped to Text prices.
The SDK's explicitly named cached-text counter remains usable.

Long-context selection uses a request's total prompt/input count, including cache, rather than
the uncached charge quantity. Cumulative SDK agent prompt tokens cannot select one inference's
context band. Priority uses the realized response tier. When the owned response field explicitly
equates Fast and Priority, a source-qualified contract projects `fast` to the existing `priority`
value through the shared categorical map. Losing that equivalence leaves ordinary tier fields
usable without retaining the alias.

The catalog specifies acquisition metadata and closed calculation graphs; it does not collect a
runtime ledger. A calculator selects one complete method per quantity, rather than adding
alternative methods together. Array length, sum, and floor-at-zero subtraction cover the reviewed
formulas without executable expressions or a provider-specific calculation engine.

## Deliberate unresolved inputs

- Batch usage fields are not inherited from synchronous schemas or guessed from prose describing
  result wrappers. Batch prices remain available with caller-supplied quantities.
- SDK uncached prompt text, realtime accepted/emitted audio durations and billable text events,
  TTS billing characters, streaming STT duration aggregation, accepted image/video input quantities,
  and effective media selectors lack the reviewed exact extraction contracts needed for automation.
  They retain semantic quantities or known formulas, without invented provider-field paths.
- File Attachment Search has a successful-call rate without a reviewed returned category counter.
- Multimodal Responses input has no documented text/image partition; aggregate cache cannot establish
  the Text cache quantity. Explicit SDK text-cache and output methods remain independently usable.
- The image-generation tool's completed output count and effective quality/resolution remain caller
  supplied. A generic `result` mention does not establish an array count or a successful outcome.
- The pre-generation usage-guideline fee lacks a stable documented response/error discriminator.
- Serving region is a caller-supplied route/request fact. Missing terminal stream usage cannot be
  reconstructed from partial content.
- Legacy redirect validity retains the extractor's day precision. Where an exact activation instant
  is required, calculation reports unresolved validity rather than silently selecting a timezone.
- `cost_in_usd_ticks` is downstream verification evidence, rather than a quantity or selector for
  reconstructing a published rate. Invoice and account settlement remain outside the price book.

A downstream calculator must retain the offer, snapshot, accepted request, successful terminal
result, and applicable quantity method. Kmodels does not own request lifecycle detection, stream
completion, ledger persistence, or invoice settlement.
