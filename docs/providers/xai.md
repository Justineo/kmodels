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
- The fixed `llms.txt` companion supplies the dedicated pricing section, release notes,
  lifecycle redirects, Batch and Priority terms, endpoint examples, Voice model IDs,
  and paid-tool semantics.
- The dedicated pricing table owns a current public amount when its model and
  applicability match exactly. Conflicts with the embedded payload or Models summary
  are retained as warnings; they do not discard the model or unrelated rates.
- Optional authenticated model inventories are enabled by `XAI_API_KEY`. They are
  account-scoped observations and may enrich a matching public identity, but cannot
  create global presence or replace the public price book.
- Comparator catalogs and Azure, OCI, or Agent Platform listings are audit evidence only. Their
  identities and prices belong to their respective sellers.

Preserve the structured `version` as identity. Dated aliases are evaluated at the
observation time. Exact retired IDs that still redirect remain separate legacy rows and
derive the target rate from the documented redirect date. Internal TTS/STT service
configuration names do not become model IDs when the public request schema selects no
model.

## Resilient collection

Unknown fields, model categories, feature tags, resolution attributes, and optional API
inventory fields are accepted with a structured contract signal. Recognized rows and
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
- Batch is a separate execution offer. Published discounts apply to exact listed text
  models and token types; supported but undiscounted media models keep standard rates.
- Priority is a synchronous rate condition selected from the realized response
  `service_tier`, not a separate capacity product.
- Image and video books use direct and, when supported, Batch offers. Output resolution,
  quality, and duration select rate variants; input media components remain additive.
- Speech to Speech is a model-bound realtime offer. xAI publishes one audio-duration
  rate rather than separate input/output audio rates, plus a per-text-input-event rate. An exact
  `Deprecated` suffix on a pricing row changes neither its ID nor its still-published numeric rate.
- TTS and STT are provider-resource books because their public request schemas do not
  select public model IDs. REST and streaming STT remain distinct offers because their
  published rates differ.
- Each paid server-side tool is a provider-resource book scoped to exact supported models.
  That scope already expresses applicability, so the partition does not repeat it as
  `compatible_with` relations. The model rate and each successful paid tool call are additive.
- The image-generation tool reuses the exact Imagine rate facts. xAI reports successful
  calls, but the tool does not expose the resolution/quality needed to choose a variant,
  so those variants remain displayed without an automatic charge binding.
- The pre-generation violation amount is normalized and displayed, but stays unbound
  until a stable request/result signal distinguishes that outcome.

No xAI offer contains settlement, enrollment, account-resource edges, storage,
allowances, or commercial-plan topology.

## Charge signals

The `llms.txt` source contributes a reviewed, field-local contract for 54 pricing
inputs. Each fact records its request, response, terminal stream event, or Batch result
channel; locator; reduction; availability; and source observation. The compiler binds
only the facts whose local contract is still present. Drift in one documented field
therefore removes that quantity method without erasing a sibling rate or substituting
an unverified raw locator.

The price book does not collect a runtime ledger. It instead tells a calculator exactly
which accepted request values, terminal result values, and realized selectors it must
retain. A calculator may choose any one complete quantity method published on a charge
binding; alternatives are not additive. Within one method, the closed calculation
graph defines the arithmetic and enforces signal units.

| Surface           | Published calculator inputs                                                                                            | Calculation and aggregation                                                                                        |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Chat Completions  | prompt text, cached prompt text, prompt image, completion, reasoning, total prompt tokens, and realized service tier   | uncached text = prompt text − cached text; output = completion + reasoning; aggregate per request                  |
| Chat streaming    | the same usage fields from the terminal usage chunk                                                                    | the same formulas; absence of the terminal chunk leaves the exact quantity unavailable                             |
| Responses         | aggregate input, cached input, output, and realized service tier                                                       | uncached text = input − cached only for text-only models; output is direct                                         |
| xAI SDK agent     | uncached prompt text, total prompt, cached prompt text, prompt image, completion, and reasoning tokens                 | direct text/cache/image; output = completion + reasoning                                                           |
| Batch text        | the corresponding Chat or Responses usage object in each successful result item                                        | the same endpoint-specific formulas, aggregated per result item                                                    |
| Imagine image     | accepted source-image count, successful output-array length, effective resolution, and effective quality               | input images and completed outputs are additive quantities; resolution and quality select variants                 |
| Imagine video     | accepted source-image count, accepted source-video duration, completed video duration, and effective output resolution | source media and completed seconds are additive quantities; resolution selects the output variant                  |
| Batch media       | successful image-result array length or completed video duration in each result item                                   | aggregate per result item; request media and selectors still come from the accepted original request               |
| Speech to Speech  | accepted input-audio seconds, emitted output-audio seconds, and billable text-input-event count                        | billed audio = accepted input + emitted output, aggregated per session; billable text events are an additive meter |
| Text to Speech    | accepted REST text billing characters or accepted streaming `text.delta` billing characters                            | provider-owned `tts_utterance` aggregation prevents REST and streaming fragments from being double-counted         |
| Speech to Text    | successful REST response duration or terminal streaming transcript duration                                            | processed audio seconds, aggregated per REST request or streaming session                                          |
| Server-side tools | successful Web Search, X Search, Code Execution, and Collections Search counters from `server_side_tool_usage`         | each provider category binds to its own successful-call meter                                                      |
| Image tool        | completed `image_generation_call` outputs                                                                              | output count is bound per request; resolution and quality stay unresolved                                          |

The endpoint-specific distinctions are intentional:

- Chat reports text and image prompt tokens separately, so the text meter uses
  `prompt_tokens_details.text_tokens - prompt_tokens_details.cached_tokens`. Its
  completion count excludes separately reported reasoning, so the billed output meter
  sums `completion_tokens + completion_tokens_details.reasoning_tokens`.
- Responses reports aggregate input tokens without a documented text/image split.
  The input-minus-cache method is therefore offered only for models whose published
  input modalities are text-only. It is not guessed for multimodal Responses models.
- The xAI SDK's `prompt_text_tokens` already means uncached prompt text, while
  `cached_prompt_text_tokens` and `prompt_image_tokens` are separate. It is a direct
  alternative rather than another subtraction.
- Long-context selection uses the endpoint's total prompt/input count, not the
  uncached-text charge quantity. Priority selection uses only the realized response
  `service_tier`; a requested tier alone does not prove the Priority rate was served.
- Provider fields are used only when the wire value requires a provider-defined
  semantic extraction, such as accepted media duration, billable TTS characters, or an
  SDK result category. They are named, sourced inputs, not an unrestricted `raw`
  escape hatch.

The closed calculation graph is sufficient for the xAI formulas: direct acquisition,
array length, sum, and floor-at-zero subtraction. Arbitrary CEL or executable
expressions are neither required nor published. In particular, kmodels does not invent
a Unicode string-length rule for TTS because xAI owns the meaning of a billable
character; the caller supplies the provider-consistent accepted billing-character
count.

## Deliberate unresolved inputs

- File Attachment Search has a published successful-call rate, but the reviewed public
  result contract has no stable category counter. Its semantic charge binding remains,
  without an acquisition method.
- Multimodal Responses input has no documented text/image token breakdown. Cache and
  output remain bindable, but input decomposition must come from a more specific
  first-party signal before it can be automated.
- A Responses image-generation tool result exposes completed images but not the
  effective resolution and quality needed to select every Imagine price variant.
- The pre-generation usage-guideline violation has a published fee but no stable,
  documented response/error discriminator. Its semantic outcome signal remains
  unbound.
- Serving region is a route/request fact supplied by the caller; xAI does not return a
  realized region beside usage. A missing terminal stream usage event likewise cannot
  be reconstructed exactly from partial content.
- `cost_in_usd_ticks` is useful downstream verification evidence, including on terminal
  streams and Batch results, but it is not a quantity or selector for reconstructing a
  published rate. Invoice, account, and contract reconciliation stays outside this
  pre-runtime price book.

Request selectors establish applicability; result fields establish realized quantities
or tiers. A downstream calculator must preserve the selected offer, price-book
snapshot, accepted request inputs, successful terminal result, and the applicable
quantity method. Kmodels specifies that input contract; it does not own request
lifecycle detection, stream completion, ledger persistence, or invoice settlement.
