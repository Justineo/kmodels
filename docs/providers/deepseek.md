# DeepSeek

Status: current

## Offer boundary

[Shared ownership rules](../commercial-topology.md#offers-and-dimensions) govern this provider.

Keep one public PAYG relationship per model. Regional origin, currency, context, cache and dated tariff conditions do not create agreements. Search and Fetch keep separate service books, with standalone API versus server-tool invocation as operation conditions. Preserve successful-request quantities and date scopes. Harness/Codex labels do not establish additional account enrollment.

The source authorities and evidence limits below remain authoritative. Adapter keys such as
`sync`, `batch`, `usage`, and operation/model-specific labels describe extraction contexts;
`source_contexts` binds them to the published relationship and its conditions. They are not
additional user-selectable agreements. Migration preserves monetary facts, conditional accounting,
source revisions and independently charged subjects.

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
- the [Anthropic API guide](https://api-docs.deepseek.com/guides/anthropic_api) for compatible
  Messages support, and the independent [Messages API reference](https://api-docs.deepseek.com/api/create-message)
  for its owned response usage and terminal `message_delta` envelope;
- the [Vision guide](https://api-docs.deepseek.com/guides/vision) for the exact image-input model and
  its image-to-token billing rule;
- the public [Lists Models](https://api-docs.deepseek.com/api/list-models) example as a second
  current-inventory witness and typed, exact token-limit evidence; and
- the [Search & Fetch guide](https://api-docs.deepseek.com/guides/search/) for successful-request
  qualification and the distinction between direct client API calls and model-triggered
  server-side search. The English and Chinese price pages own amounts and the "Search & Fetch API
  Pricing" / "Search 与 Fetch API 价格" sections; the guide's repeated prices do not replace them.

Both price pages date the server-side exemption to November 18, 2026 at noon in Beijing
(04:00 UTC). Current standalone amounts apply only to direct successful requests. The server-tool
operation has a dated free state. These pages do not quantify earlier model-triggered charges.

The fixed [Web Tools guide](https://api-docs.deepseek.com/guides/web_tools) owns the native
server-tool billing statement. Its current "These server tools are not billed …" rule is verified
verbatim; an unrecognized rule is recorded as contract drift without weakening the standalone
tariffs. Because the source no longer bills per-query native tool usage, the extractor publishes no
per-model web-tool charge; the model-level usage counters stay published as unbilled accounting
inputs rather than being turned into rates. Historical bundles without that companion retain their
independently evidenced standalone/client-tool branches. Optional File Parsing, OCR, TTS and ASR
billing guides and the typed OCR response reference supply their independent usage semantics;
the main bilingual price tables own every amount.

The current `llms.txt` URL serves the documentation homepage rather than an index. Discovery uses
the full first-party sitemap and navigation instead. Its API/model, service, billing and lifecycle
pages are reviewed separately from account balance and integration-only pages. The authenticated
model list contains richer metadata, but no tariffs: its exact public limits, modalities and effort
levels agree with the typed public model reference. Account omissions cannot withdraw accepted
legacy IDs. Unused system-prompt-update behavior does not become a catalog or refresh dependency.

The [change log](https://api-docs.deepseek.com/zh-cn/updates) supplies exact-ID release and update
dates. The English `/updates` route currently renders the docs homepage, so the reviewed source is
the Chinese page; its `时间:` date headings, Chinese release wording and `model=` assignments are
parsed with the same exact-ID rules. Entries that only retire, redirect or alias an existing model
name never establish a release date.
Optional authenticated `GET /models`, enabled with `DEEPSEEK_API_KEY`, may add account-scoped
provenance to exact public matches but cannot create or remove global rows. Family-level marketing,
the consumer app, open weights, status pages, and third-party catalogs are not identity or price
sources.

The Chat Completions, Responses, and Anthropic Messages request references each own an optional
effort detail for exact callable IDs. The requested operation and native request-field location
must match, and Chat Completions and Responses use their own model enums. Messages also accepts an
explicit native model declaration and retains the catalog's independent Messages ownership check.
Compatibility aliases that map to a documented mode are qualified in the scope, rather than
appearing as additional effort levels. An explicit thinking setting can take precedence over the
effort toggle. A default-on thinking statement without a named level leaves the native default
absent. Legacy redirects, cache accounting counters, and the separate caching guide do not
establish API-scoped model cache modes.

## Rate-book boundary

### Inference model ID pricing

The current `MODEL` columns and successfully validated legacy acceptance/billing declarations emit
direct associations to each exact ID's existing `payg` offer. Legacy IDs keep their own catalog
identity and explicitly derived current tariff. A served model version, display name, retired alias,
Anthropic wildcard rewrite or regional-looking prefix cannot establish an additional request ID.

Associations fix no pricing selectors. Billing currency and the source-defined Peak/Off-peak category
remain required commercial inputs when the applicable offers use them. Missing inputs return
candidates; neither the ID nor the lookup clock chooses the customer's settlement currency or
holiday classification. Optional protocol, authentication, endpoint and usage-counter references
are not prerequisites for the price association. Search and Fetch remain separate service books.

Each fresh source revision replaces its direct associations. Removed legacy acceptance or billing
evidence cannot survive through retained display aliases or equal prices. A source outage may retain
the previously accepted source and mapping under the shared snapshot rules. Unknown private IDs and
unreviewed identifier layouts remain unknown rather than triggering deployment discovery.

### Model and service rates

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

Model books cover generation token rates. Native server-tool responses report the whole request's
summed inference usage; do not add the same internal steps again. Generic function calling
does not itself establish an extra service charge. Anthropic wildcard rewriting is request routing,
not pricing or catalog identity.

Search and Fetch have independent provider-service books, with no inferred model compatibility.
Each has a standalone API offer and a separate offer for model-triggered server-side use. The
standalone offer publishes one request tariff per currency; the guide states that a standalone
request is billable only when it returns a result, and that searches calling the Search and Fetch
APIs directly from the client are billed at the same prices (for example DeepSeek Harness with the
DeepSeek Search API as the web search provider, and Codex Alpha Search). The linked Codex
integration page describes the Alpha Search client feature but defers supported operations and
billing to this guide, so it establishes no separate tariff. The parser requires those exact
guide sentences, so a different client scope or any rounding of the qualification is rejected as
contract drift instead of being silently priced. The guide's repeated amounts never replace the
price pages' cells. These service rates do not inherit model Peak/Off-peak periods.

The English `Search & Fetch API Pricing` and Chinese `Search 与 Fetch API 价格` sections own the
amounts. Each publishes one `Item | Unit | Price` table (`项目 | 计费单位 | 价格`) with a
`Search API (text)` row (`Search API（文字）`) and a `Fetch API` row, each at
`Per 1,000 successful requests` (`每 1,000 次成功请求`). The section heading, column headers, row
labels and units are the contract: the retired `Web Search & Fetch Pricing` heading, `Search
(text, image)` row and `Per 1,000 searches` unit are rejected rather than reused, because a renamed
or re-headed section may have changed its billing basis. Both pages date the exemption for
model-triggered server-side search and web fetch; the parser cross-checks the English and Chinese
statements and records drift if they disagree. Both reviewed wordings distinguish the free
server-side tool call from billable model tokens, including results appended to context.
The complete billing prose must agree across each owned section. A later per-call fee or
exception in the same section invalidates the exemption even when the original sentence remains.

Both services charge per successful request, independently of the number of search results.
Search requires HTTP 200 and a non-empty results array; Fetch requires HTTP 200 with page content.
Failures, empty search results and timeouts are not billable. Consumers supply these precisely
qualified request counts. A results-array length, generated token count or emitted tool-call event
cannot substitute for a billable request count. No response counter or model association is guessed.

Native `deepseek_web_search` and `deepseek_read_url` operations are no longer billed per query. The
owned guide states that server-side search and page fetch triggered through the model are free from
the dated instant and that only model token usage is charged, so the extractor publishes no
per-model web-tool charge and verifies that sentence verbatim. An unrecognized rule is recorded as
contract drift without weakening the standalone tariffs. The typed
`usage.server_tool_use.tool_search`, `tool_image_search` and `tool_fetch` fields stay published as
unbilled accounting inputs; they no longer bind a rate. Display-only `web_search_requests` and
`web_fetch_requests` never supply quantities. A missing typed field removes its locator without
discarding the published rate.
The guide positively names `deepseek-flash`; these service books do not assert compatibility with
every model or propagate that capability through legacy redirects.

Independent File Parsing and OCR books use the combined table's page tariff: USD 0.225 or CNY 1.5
per thousand pages. Parsing is charged once on successful upload; later model input tokens remain
separate. Ordinary `user_data` uploads do not inherit the parsing charge. OCR uses the typed
successful `/page_count`, not its explanatory token totals. Disconnection does not cancel either
operation or establish that it was free; an absent result leaves the billable quantity unknown.

Text to Speech publishes the current limited-time USD 0.225 or CNY 1.5 per 10,000 billed
characters. Unit conversion preserves that exact denominator. A Chinese character counts as two;
other characters count as one. Callers supply the weighted billable count for the complete REST
utterance or WebSocket text session. Speech to Text publishes USD 0.058 or CNY 0.39 per audio hour,
with each request rounded up to whole seconds. The closed rounding calculation accepts canonical
seconds from the caller; the API's millisecond duration is not mislabeled as a seconds locator.
The price-page list amounts and limited-time labels remain observations, without a second
simultaneously applicable tariff or an invented promotion end date. These four services do not
create model IDs, subscription prices, or additional commercial agreements.

The collector intentionally discards account balance, granted credit, recharge/refund terms,
concurrency, capacity expansion, settlement order, and future price notices without an effective
rate and exact applicability rule. Training, retained files/artifacts, provisioned capacity, subscriptions, and
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
Request-side interface claims use a different rule for documented unions. A `oneOf` property such
as `tools` republishes its own named child per variant, so the `tools.type` claim aggregates the
`Possible values` of every variant and requires the expected value (`function`) in that union.
Requiring one unique child there would report drift for a union that still documents the variant.
This aggregation applies only to those boolean interface claims; accounting locators keep the
unique-declaration rule above.
The rendered OpenAPI reference can publish separate JSON and event-stream schemas. When those
media labels are present, REST uses the JSON schema and FIM streaming uses the event-stream schema.
Duplicating a field in one media schema does not invalidate its sibling transport. Older unlabelled
references use their shared response schema and still require independent terminal stream evidence.

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
typed returned fields and current response example, without imposing field order. The inventory's
single-value enums can render as a bare code value or a bracketed value. Unconsumed
additive example metadata cannot invalidate the ID witness or overwrite catalog fields.
The compatible Anthropic guide's stream support comes from its uniquely owned `Simple Fields`
table, independently of whitespace between rendered cells.

Chat and FIM cache-miss quantities are direct observations. Responses cache-miss input uses a
closed, unit-preserving calculation graph: total input tokens minus cached input tokens, floored at
zero. Kmodels publishes both response and terminal-stream locators as alternative acquisition
methods. It does not publish an arbitrary expression, CEL program, or provider-key pseudo-expression.
All bindings aggregate per request.

The Messages reference independently defines uncached `input_tokens`, cached
`cache_read_input_tokens`, and `output_tokens` under `/usage`. The owned input description must
explicitly exclude cached input before the first field supplies cache-miss quantity. The final
`message_delta` has the same cumulative usage; intermediate events are not deltas to add together.
Its request stream contract, event/type agreement and owned usage example are checked separately
from the REST schema. A failed stream can still have billed work even without the successful
terminal event; missing acquisition is not a zero quantity.

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
or validity evidence signals the responsible commercial dependency: collection retains the
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
show the independent Search and Fetch offers under the same `Other charges & services` disclosure
and offer-card layout used for other providers' model-associated services. Both invocation mechanisms
retain their own currency choices and validity timeline; the current declaration publishes no
upcoming change.
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
