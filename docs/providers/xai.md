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
- Comparator catalogs and Azure, OCI, or Vertex listings are audit evidence only. Their
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
  rate rather than separate input/output audio rates, plus a per-text-input-event rate.
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

Use exact first-party request/result quantities:

| Rate component        | Signal                                                              |
| --------------------- | ------------------------------------------------------------------- |
| uncached input tokens | `usage.input_tokens - usage.input_tokens_details.cached_tokens`     |
| cache-read tokens     | `usage.input_tokens_details.cached_tokens`                          |
| output tokens         | `usage.output_tokens`                                               |
| paid tools            | the matching `usage.server_side_tool_usage_details.*_calls` counter |
| direct images/videos  | accepted input media and completed result count/duration            |
| Speech to Speech      | accepted/emitted realtime audio duration and text-input events      |
| TTS                   | accepted input character count                                      |
| STT                   | accepted audio duration                                             |

Request selectors establish applicability; result fields establish realized quantities
or tiers. Do not use account cost totals or invoice settlement as a per-request rate
binding.
