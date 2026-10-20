# DeepSeek

Status: current

## Sources and identity

The exhaustive global catalog and current public rates come from the official
[Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing/) table. A valid model column
creates one exact callable ID. A current first-party footnote can additionally establish a legacy
request ID only when it explicitly says the ID is still accepted, identifies its current table
target, and binds its billing to that target. Such IDs retain exact rows with `legacy` status,
replacement IDs, and target rates with explicit derivation evidence. A dated future redirect does
not apply early. Other names in integrations, wildcard routing, old pages, or release history do
not create current rows. The current table is also authoritative over
orphaned `pricing-details-*` pages that still describe retired models.

Redirect validation compares the served version with the current row's exact version text and the
billing label with its callable ID. A date suffix in a served version, such as
`DeepSeek-V4.1-Flash-1017`, is not part of the billing label. It cannot discard an explicitly
accepted legacy ID; a different served version or billing target still cannot establish a redirect.

The fetch bundle contains only companions that contribute a current catalog or rate-book field:

- the official [Chinese price table](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/) for
  CNY-denominated variants;
- [Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion),
  [Responses](https://api-docs.deepseek.com/api/create-response), and
  [FIM](https://api-docs.deepseek.com/api/create-completion) references for exact operation model
  sets, returned usage fields, and terminal streaming envelopes;
- the [Anthropic API guide](https://api-docs.deepseek.com/guides/anthropic_api) for the compatible
  Messages endpoint and streaming support, but not for usage locators that the guide does not
  document;
- the [Vision guide](https://api-docs.deepseek.com/guides/vision) for the exact image-input model and
  its image-to-token billing rule;
- the public [Lists Models](https://api-docs.deepseek.com/api/list-models) example as a second
  current-inventory witness and typed, exact token-limit evidence; and
- the [Search & Fetch guide](https://api-docs.deepseek.com/guides/search/) for successful-request
  qualification and the server-tool billing transition. The English and Chinese price pages own
  amounts; the guide's repeated prices do not replace them.

The [change log](https://api-docs.deepseek.com/zh-cn/updates) supplies exact-ID release and update
dates. The English `/updates` route currently renders the docs homepage, so the reviewed source is
the Chinese page; its `时间:` date headings, Chinese release wording and `model=` assignments are
parsed with the same exact-ID rules. Entries that only retire, redirect or alias an existing model
name never establish a release date.
Optional authenticated `GET /models`, enabled with `DEEPSEEK_API_KEY`, may add account-scoped
provenance to exact public matches but cannot create or remove global rows. Family-level marketing,
the consumer app, open weights, status pages, and third-party catalogs are not identity or price
sources.

## Rate-book boundary

Each current model owns one PAYG inference offer. The offer contains the three rates published by
DeepSeek:

- cache-hit input tokens;
- cache-miss input tokens; and
- output tokens.

USD and CNY remain separate `billing_currency` variants with no FX conversion. They are not a
conflict because their denominations differ. Kmodels does not infer which currency settles a
credential; a consumer selects the applicable currency from its own account configuration.

The current price tables publish Peak and Off-peak rows directly inside the model table. They are
`billing_period=peak|off_peak` variants. The current rule defines Peak as UTC `01:00–04:00` and
`06:00–10:00`, Monday through Friday excluding Chinese public holidays. All other hours, weekends
and Chinese public holidays are Off-peak. The Chinese table independently establishes the matching
Beijing-time windows. Both categories preserve the exact source definition and informational
evidence; callers supply the applicable category. Kmodels neither maintains annual holiday dates
nor evaluates make-up workdays or the current clock. A plain weekly schedule would misrepresent
the holiday exception, so the current categories deliberately omit executable schedule metadata.
Historical fixtures retain their independently reviewed daily or weekly rules. Those schedules
come from parsed source evidence, never from the later compilation date. A source with a future
daily-to-weekly transition preserves both rules and the exact Beijing-time change as a caller-selected
category without a single timeless executable schedule. Both currency documents must establish the
same policy and, for a separate price transition, the same effective instant.
The parser emits these definitions directly as typed source vocabulary. Commercial assembly does
not decode policy names from raw term keys or reparse the preserved prose. Source-level usage
contracts also survive independently of model records.

Cache hits and misses partition input. A cache miss already pays the miss rate, so the catalog does
not invent a cache-write or storage charge. Thinking tokens are part of output, and thinking effort
changes quantity rather than rate. FIM, Responses, and Anthropic compatibility do not create new
offers when they use the same model rates.

`deepseek-flash` is the current Flash identity. The explicitly accepted legacy IDs
`deepseek-v4-flash` and `deepseek-v4-flash-vision-exp` route to it and use its current rates, rather
than retaining the retired underlying models' prices. Images are converted to tokens from their dimensions and included with text input
tokens, so the price book does not duplicate that aggregate input usage as a second image rate. The
Vision guide establishes image input in the model catalog, while verified Chat Completions and
Responses usage counters remain the charge bindings for the combined billable input-token totals.

Model books cover generation token rates. A tool loop can cause additional
generation requests, which an AI Gateway observes and prices individually. Generic function calling
does not itself establish an extra service charge. Anthropic wildcard rewriting is request routing,
not pricing or catalog identity.

Search and Fetch have independent provider-service books, with no inferred model compatibility.
Each has a standalone API offer and a separate offer for provider-side tool calls made through
DeepSeek Harness, Claude Code or Codex. The latter is free until the source's published transition,
then uses the request tariff. The English price page, Chinese price page and guide must establish
the same eligibility and Beijing-time instant. The current declaration starts billing on
2026-11-01 at 00:00 Beijing time: the free interval ends exclusively and the paid interval starts
inclusively at 2026-10-31T16:00:00Z. These service rates do not inherit model Peak/Off-peak periods.

Both services charge per successful request, independently of the number of search results.
Search requires HTTP 200 and a non-empty results array; Fetch requires HTTP 200 with page content.
Failures, empty search results and timeouts are not billable. Consumers supply these precisely
qualified request counts. A results-array length, generated token count or emitted tool-call event
cannot substitute for a billable request count. No response counter or model association is guessed.

The collector intentionally discards account balance, granted credit, recharge/refund terms,
concurrency, capacity expansion, settlement order, and future price notices without an effective
rate and exact applicability rule. Training, storage, provisioned capacity, subscriptions, and
self-hosted execution are also outside the direct request-rate boundary. Excluded facts are not
published as `unknown` or raw pricing.

## Pricing inputs and calculation methods

The price book publishes provider-independent charge signals separately from the provider fields
that can supply them. Numeric rates therefore remain useful if an optional interface reference
drifts. Each verified field is an independent `pricing_input`; losing one field removes only that
locator, not a known calculation, sibling field, endpoint, model, or rate. The uncached-input
equation and surviving mappings remain available; an unmapped signal is an explicit caller input.

The current machine-readable input contract is:

| Rate             | Chat Completions           | Responses                                           | FIM                        |
| ---------------- | -------------------------- | --------------------------------------------------- | -------------------------- |
| Cache-hit input  | `prompt_cache_hit_tokens`  | `input_tokens_details.cached_tokens`                | `prompt_cache_hit_tokens`  |
| Cache-miss input | `prompt_cache_miss_tokens` | `input_tokens - input_tokens_details.cached_tokens` | `prompt_cache_miss_tokens` |
| Output           | `completion_tokens`        | `output_tokens`                                     | `completion_tokens`        |

Chat and FIM non-streaming paths are rooted at `/usage`; their terminal stream chunk exposes the
same usage object immediately before `data: [DONE]`. Responses non-streaming paths are rooted at
`/usage`; terminal `response.completed`, `response.incomplete`, and `response.failed` events expose
the full response under `/response`, so their streaming paths are rooted at `/response/usage`.
Every stream input is marked `terminal_only`.

Each locator requires the exact API operation and an owned response schema. Object parents and
integer leaves must be directly and uniquely declared at every step, including
`usage → input_tokens_details → cached_tokens`. Request properties, unrelated nested objects,
prose markers and quoted schemas cannot establish those paths. A duplicate or retyped field
withholds only its affected mappings; an unrelated nested lookalike cannot erase a valid direct
field. A duplicate companion path withholds that document's mappings in either order.

Chat/FIM terminal acquisition additionally requires the owned boolean `stream` and
`stream_options.include_usage` contracts. Accounting prose is read as rendered HTML text within
that field, so inline `<code>` around `data: [DONE]` remains supported. Responses streaming requires
its owned boolean stream contract, terminal event markers, and an owned response example whose
event/type agree and whose JSON has `/response/usage` on the response object. Reviewed partial
examples may omit object members with an unquoted `...`; the existing JSON tokenizer preserves
quoted names and values, and duplicate or malformed ownership cannot establish the envelope.
Envelope drift removes stream acquisition independently of the REST response mappings.

The same operation/owner/type reader supplies request model enumerations and the public model-list
response witness. A response model field cannot establish request compatibility, and an unrelated
nested enumeration cannot invalidate the actual request model field. Public inventory needs its
typed returned fields and current response example, without imposing field order. Unconsumed
additive example metadata cannot invalidate the ID witness or overwrite catalog fields.
The compatible Anthropic guide's stream support comes from its uniquely owned `Simple Fields`
table, independently of whitespace between rendered cells.

Chat and FIM cache-miss quantities are direct observations. Responses cache-miss input uses a
closed, unit-preserving calculation graph: total input tokens minus cached input tokens, floored at
zero. Kmodels publishes both response and terminal-stream locators as alternative acquisition
methods. It does not publish an arbitrary expression, CEL program, or provider-key pseudo-expression.
All bindings aggregate per request.

The Anthropic-compatible endpoint is part of the callable model catalog, but the current first-party
guide does not define its response or stream usage envelope. Kmodels therefore does not guess a
Messages usage locator. The same token rates remain semantically applicable to Anthropic-compatible
requests; a cost consumer must wait for a documented provider input contract before claiming exact
automatic extraction through that protocol.

Reasoning-token fields are subsets used for explanation, not additional charged quantities. Image
tokens are already included in input totals, so they do not need a second charge signal. Cache
creation is automatic and has no published cache-write price. Search/Fetch request charges use
their own successful-request quantities and dated offers; ordinary token counters cannot measure
those requests. Known prices remain useful without an automatic acquisition method.

Operation-specific model enumerations control protocol bindings. A general table feature cannot
expand those enumerations. A disagreement is reported without removing either model or its
independent numeric rates.

## Resilience and conflicts

Every native tariff cell is handled independently across static, inline-period and separate-period
tables. An unreadable amount remains bounded raw base-price evidence with the original quote,
meter, published currency context, known period and exact validity. An unreadable period retains
its literal label and a broader possible scope; it cannot acquire a guessed period. Valid siblings
remain numeric. Equal-scope duplicate cells withhold every candidate and preserve their quotes;
document order cannot select a winner. An adapter reports this unsupported source structure rather
than emitting an assembly-reserved conflict reason.

Rules, missing whole periods/tables and unbound priced columns are different: their commercial
scope cannot safely be represented by a local raw quote. The parser reports a typed commercial
dependency failure while returning independently valid catalog facts. Collection rejects the new
provider pricing and its replay capture, retains the complete accepted price partition and previous
replay input, and can advance compatible catalog metadata. If the new catalog removes an ID needed
by retained pricing, pair composition retains the previous provider core too. Missing or duplicate
CNY companions use this same commercial boundary; English and Chinese policies cannot silently
share one global billing-period definition when they disagree.

The public Models reference independently defines `context_window` as total input/output token
capacity and `max_output_tokens` as the per-response output limit. Its unique current response
example can refine the price table's rounded labels for exact matching IDs. Each value requires
the owned integer schema and a positive safe integer; field drift withholds that limit locally,
while unreadable or duplicate JSON properties cannot select a last value. The price-table limit
remains the fallback. Explicit legacy redirects inherit the verified target's limits.
This authority is limited to these documented token fields: example names, modalities, effort
settings and other additive metadata cannot overwrite independently established catalog facts or
create identities. The table remains the identity and served-version authority.

The change log is an optional lifecycle overlay. A fetch or parse failure preserves previously
verified dates and the overlay's original observation time, while independent catalog and pricing
collection continues. The failure, streak and parser count guard remain visible for repair; a
temporary empty page cannot erase release evidence or freeze otherwise valid prices.

Service quotes use the same local raw fallback for unreadable amounts or units. Unreviewed service
rows report a source pricing diagnostic. Missing or conflicting billing qualification, eligibility
or transition evidence signals the responsible commercial dependency: collection retains the
complete accepted provider pricing and replay input while valid catalog metadata may advance.
Current topology admission requires the reviewed service resources as well as charge bindings.

Pricing reconciliation counts native tariff cells and verified billing rules once each, including
one item for an explicit redirect rule rather than its derived model/rate copies. Catalog, interface, inventory and
usage-acquisition findings use the source-contract channel, so unrelated metadata drift cannot
inflate the price-item denominator. Successful input mappings remain pricing-input facts rather
than normalized price items.

- A missing or ambiguous main model table is systemic and retains the previously accepted DeepSeek
  partition.
- A malformed catalog field, support value, companion operation, or usage group suppresses only
  that claim. A damaged price or period retains bounded raw evidence alongside numeric siblings;
  unbound priced headers and unrepresentable commercial contracts trigger pricing retention.
- An optional companion failure cannot erase current IDs or numeric price-table rows. If usage
  evidence fails, only the affected pricing-input locator is omitted. Known arithmetic, surviving
  mappings, the semantic charge binding, and the numeric rate remain.
- The public model-list witness and optional authenticated inventory report exact-ID disagreements
  but do not override the exhaustive price table.
- Unknown table rows are reported and ignored. Account-only and otherwise out-of-scope rows are
  recognized but deliberately discarded.
- Current canonical price tables outrank stale auxiliary pages for the same exact model, currency,
  meter, and validity. A genuinely unresolved same-scope conflict withholds only the disputed rate.

Refresh is deterministic and non-LLM. Matching uses exact callable IDs and exact operation schemas;
there is no fuzzy reconciliation, family inheritance, or comparator fallback.

## Presentation

Model details show one PAYG mechanism, billing-currency and Peak/Off-peak selectors,
the three applicable published rates, and their verified pricing-input methods. The categorical
definitions preserve the holiday rule. They do not
show balance, concurrency, settlement, routing, provisioning, training or storage. Provider details
show the independent Search and Fetch resources under the model inspector's collapsed DeepSeek
services section, both invocation mechanisms and the shared current/upcoming validity timeline.
This is provider context, not an assertion of model compatibility. Identical USD/CNY policy notes
appear once when their scopes cover the complete offer; distinct rates retain their currency
selector. The website presents rates rather than calculating a total or deciding the
current billing period; Gateway consumers may select the applicable rule, multiply rates by
returned usage, and sum requests. Runtime collection, request lifecycle, ledgers, contract-price
overrides, and invoice reconciliation remain consumer responsibilities rather than Pricebook data.

## Comparator audit only

models.dev, LiteLLM, Portkey, Helicone, gateways, and cloud sellers may reveal claims worth checking
against DeepSeek documentation. They cannot create a direct DeepSeek ID, copy another seller's rate,
or override the current official model and pricing tables.
