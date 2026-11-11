# Gemini Enterprise Agent Platform

Status: current

The exact Mistral OCR model-page companion owns page/token equivalence. Other pricing and
accounting documents cannot supply that claim. Its
parenthetical page prices normalize only when both input and output amounts exactly equal their
published token prices times the documented per-page token counts. For Mistral OCR (25.05), one
page represents one million input and one million output billing tokens; both directions apply.
This is not ordinary text tokenization. DeepSeek-OCR's parenthetical page alternatives remain raw
because its model page does not publish an equivalent conversion contract. Missing runtime usage
locators do not by themselves invalidate an established rate or equivalence.

## Boundary

Kmodels catalogs models that Google exposes as managed APIs on Gemini Enterprise Agent Platform or
through its Model-as-a-Service offerings. The provider ID remains `vertex`. Agent Platform agents,
runtimes, registries, gateways, skills, generic self-deployment inventory, and other non-model
resources do not create catalog rows.

The price book covers public costs attributable to one proxied inference request or its result:

- online, Priority, Flex, and Batch inference;
- input, output, cache-read, embedding, image, audio, and video generation rates; and
- independently metered request components such as grounding, Maps, and Claude web search.

Training, retained cache storage, Provisioned Throughput, savings plans, agents, CodeMender,
AlphaEvolve, model optimization, account credits, billing export, and settlement are outside
this boundary. Cache-read inference is in scope; cache storage over time is not.

Kmodels publishes a price book and calculation-input contracts. It does not own the runtime request
lifecycle: the Gateway still captures requests, terminal responses or stream events, asynchronous
results, interruptions, retries, and any account-side reconciliation data.

## Sources

Model discovery and pricing remain independent:

- the Google, partner, and managed-open indexes plus bounded model cards establish model identity,
  capabilities, lifecycle, availability, and invocation routes;
- the public Agent Platform pricing page and its linked
  [partner-model pricing page](https://cloud.google.com/model-garden/partner-models/pricing)
  establish rates and applicability; and
- the Discovery schema and fixed first-party Batch, grounding, Claude, Grok Responses,
  OpenAI-compatible, Imagen, and Veo documents establish calculation inputs and selectors.

The managed-open index's Model Garden links establish exact IDs from its hosted inventory.
Public model cards add details where Google publishes them. The crawl excludes capability guides
and bounds the number and size of cards without assuming that the live inventory has a fixed
number of detail pages. The open-model deprecation table is required and owns retirement even
after an older card or inventory row disappears. Where two inventory rows share a link, the
open index cannot distinguish them. The partner Llama card supplies each exact Model ID.

For Imagen and Veo cards with several exact Model ID tables, the owned Generate, Fast Generate,
Lite Generate, and Ultra Generate headings identify display variants within the page's named
model family. Display names omit the procedural Generate suffix and its revision ordinal; literal
model IDs and inference aliases stay unchanged. This preserves exact price-label matching without
guessing a family tariff from an arbitrary similar model ID.

The optional merged [Imagen 3 card](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/imagen/3-0-generate)
retains exact revision tables, owned family names and discontinuation dates after their individual
URLs redirect. It supplements discovery and preserves their family-quote association without
reviving retired endpoints or resolving the price table's generic `count` denominator.
Older Veo 2 and Veo 3 IDs discovered only through reference or deprecation inventory can retain
literal-ID display names without a current model-card price-label association. Their former
card URLs redirect to the model index. Family quotes alone do not establish the revision-specific
join, so these models remain Unknown.

The pricing source explicitly owns both `pricing` and `pricing_inputs`. Accounting contracts are not
treated as rate evidence. The optional authenticated Model Garden API validates known public
identities only; it cannot create rows, contribute private prices, or retain account data.
Its service-account key must be active: an OAuth `invalid_grant` is reported as a credential
failure and skips only this optional account-scoped validation source. Replacing
`GOOGLE_SERVICE_ACCOUNT_JSON` with a current key restores it; public catalog and pricing sources do
not depend on that credential.

Each source owns only its claims. A pricing-page failure does not reject model discovery. A changed
route guide withholds only that route. A missing accounting field removes only the affected input
or selector method while preserving the semantic charge binding and published rate. Previously
accepted provider data is retained only when the provider refresh cannot publish a valid
replacement.

The partner price page is a commercial companion of the pricing source. The Google-model page now
links to it instead of containing the partner tables. Both pages are parsed with the same owned
table, location, context and footnote rules. If the current index links to that page, a missing or
duplicated companion rejects the replacement pricing snapshot; an incomplete fetch must not erase
partner rates. Historical bundles with inline partner tables remain readable. Accounting and
capability guides do not establish the price amounts.

## Inference model ID lookup

Google Cloud's Anthropic pricing section may shorten display labels to family and version,
such as `Opus 5.5`. Resolve that spelling within the Anthropic publisher when joining rate rows.
The official API ID table independently supplies the request spelling.

Catalog sources emit the literal managed Model IDs established by labeled model-card fields or
exact Model Garden links. These identify the native managed model component, separately from a
display name or an account's deployment name. Associations join only existing model-scoped `sync`
and `batch` offers. Merely appearing in the catalog does not create a price or an offer. General
service fees and grounding allowances keep their independent commercial records.

For Google-managed Claude, the optional [Anthropic API model ID table](https://platform.claude.com/docs/en/build-with-claude/claude-models-on-google-cloud/google-managed)
establishes the exact online request spelling. Join the documented base component to one admitted
Anthropic publisher record and retain the full request ID, including any date suffix, in the
association. Catalog model-card IDs alone establish no Claude request association. Missing or
unrecognized table evidence leaves Claude online request lookup unknown while preserving catalog prices.
The optional [Google Cloud Claude batch guide](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/partner-models/claude/batch)
establishes the batch resource spelling through its request template and supported model-card
links. Associate those resource IDs with existing batch offers for the listed Claude models.

The OpenAI-compatible APIs also use publisher-qualified request values. Extract those exact
spellings from official request examples and join their model component exactly to an admitted
model. A documented `meta/MODEL` request template applies only to models with independently
established `publishers/meta` ownership. Do not infer a universal publisher prefix from Model Garden
URLs, copy response model names as aliases, or generate project-qualified private resource IDs.
Qualified request forms currently establish online inference associations; they do not themselves
prove the resource spelling required for a Batch job. Bare model IDs can identify either existing
offer, and a missing offer choice keeps both candidates.

This is price lookup, not request construction. It does not promise that every spelling works on
every API. Qualified forms lacking owned request evidence remain unknown even when the native
Model ID has prices. Removing an example or optional guide withdraws only its additional request
spellings; literal catalog IDs and independent prices survive. A missing HTTP path, capability or
usage counter does not suppress an independently established ID-to-price association.

Request location remains separate from the ID. The partner endpoint guide distinguishes `global`,
`us`, `eu` and named regions, while commercial tables distinguish their own `region` and
`deployment_scope` conditions. No regional-looking prefix, publisher prefix, available-region list
or globally routed URL selects a tariff implicitly. Served tier, context, cache TTL and validity
also retain their existing conditions. Unfilled values produce candidates; incompatible known
conditions produce no applicable prices. Known IDs with contradictory context footnotes, imprecise
promotional dates or unknown units retain unresolved price evidence rather than invented amounts.

The public mapping and compact website projection use the shared lookup. The UI exposes copyable
IDs, offer choices when needed and the remaining price conditions, without an invocation graph,
protocol selector or account configuration step. Stored catalog/pricing adoption remains separate
from source collection and mapping implementation.

## Mapping

- Model IDs come from labeled model-card fields or exact Model Garden links. Headings, display
  labels, and approximate dates do not create identity.
- A family price may apply to multiple IDs only when a model card establishes that family. Price
  labels must equal a source-owned model name or literal ID after the reviewed typography and
  label normalization. Prefix/suffix similarity, longest-name ranking and stripped ID suffixes do
  not establish a price association. Unowned family labels remain unmatched.
  Section headings paired with their own Model ID table can establish names inside a multi-model
  card. A broader price label such as `Llama 4 Scout` does not by itself bind the more specific
  `llama-4-scout-17b-16e-instruct-maas` ID. That price association remains unknown until independent
  commercial evidence establishes it; a documented request spelling alone is insufficient.
- Flexible Savings Plan columns are excluded because they are account commitments, not request
  rates. New unrelated columns and sections are ignored locally.
- Standard, Priority, Flex, and Batch are shared `service_tier` values. Online conditions become
  `served_service_tier`; `trafficType` or the equivalent partner response value selects Standard,
  Priority, or Flex. Batch is a separate offer and uses successful result-item accounting.
- A Region column's Global and Non-global categories use `deployment_scope`. Named endpoint-location
  tabs use `region`, including `global`, `us`, `eu`, and explicit regional locations. The
  [partner endpoint contract](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/partner-models/use-partner-models)
  defines these as distinct request `locations` values. A concrete request location does not infer
  the wildcard meaning of Non-global. Processing and billing-unit tabs supply no geographic scope.
  A tab requires one unquoted matching label; a missing, duplicated or unreadable location owner
  preserves local raw quotes. Normalizing the page preserves typed table metadata rather than
  trusting synthetic attributes embedded in external HTML.
  A quote without a region stays unqualified. A separately priced location cannot establish a
  synthetic default region for another quote, including a globally routed or differently dated row.
- Context thresholds, modality, operation, resolution, audio, cache TTL, and effective dates remain
  independent applicability dimensions.
  A dated ordinary price remains unqualified by promotion unless its own source establishes
  eligibility. A promotional quote cannot add `promotion=false` to a sibling price or date.
- A model label's footnote belongs to that model's quote, including subsequent blank continuation
  rows. The public Gemini credit-back promotions describe an account benefit rather than an
  independently published gross request tariff. Their displayed amounts remain bounded raw evidence
  with their original unit, meter, validity and owned credit note; no doubling, future-price
  substitution or automatic discount turns them into executable request rates. Understood account
  credit evidence is an intentional raw result, without a missing-contract repair trigger. A missing,
  duplicated, unreadable or contradictory referenced model note produces an owned model-scope
  diagnostic and enters repair investigation even on unchanged bytes.
- A comma-separated Gemini model cell resolves each named model independently. A date annotation
  belongs only to its own item, so an undated Cyber model does not inherit another model's future
  start date or credit eligibility. Unknown members are reported without discarding readable members.
  Published date-only labels remain imprecise validity, not inferred UTC transition instants.
- A model's uniquely owned, date-only `no charge until` note bounds its displayed paid tariff
  from the following calendar date. Wrapped partner sections own their notes only when they
  contain one pricing table; neighboring sections and quoted examples cannot supply that note.
  This preserves the paid amounts without inventing a historical free rate or the cutover instant.
  The calculator retains unresolved date-only validity, and a cache tariff alone does not establish
  a managed partner model's cache quantity binding.
- An output row under the cached-input price column still prices output tokens. It cannot create
  a cache-read charge. Identical output observations converge to one canonical price; inconsistent
  output amounts remain conflicting evidence rather than being added together.
- Cached audio, image and video prices retain their provider-owned meters. Google's token binding
  admits those exact native cache meters and uses the corresponding response quantities; it does
  not require every recognized meter to belong to the shared vocabulary. Image and document cache
  tokens use the same reported quantities for both cached billing and uncached-input subtraction.
- Each numeric context header owns its bound, using safe whole-token counts. A missing opposite
  quote cannot create a complementary range. Only the table's own readable footnotes can constrain
  its bound. If the exact same threshold disagrees only on inclusivity, publish the intersection
  for each quoted column and preserve the exact disputed token count as raw applicability evidence.
  Unknown, missing or otherwise contradictory declarations retain each affected quote and known scope
  as raw evidence, including the original amount, unit, meter, labels and owned notes.
  Readable sibling columns and endpoint panels survive independently.
  Labeled-cell shape checks retain the literal column heading, so another context band cannot
  supply a label sequence that silently chooses between conflicting prices in the affected cell.
  The public Claude tables currently disagree at the 100K and some 200K boundaries: headers use
  strict `>` while their notes use “longer than or equal to”. A complementary short and long
  pair in the [Cloud Billing SKU list](https://cloud.google.com/skus/sku-groups/gemini-enterprise-flexible-savings-plan-eligible-skus)
  can corroborate the header for the exact model, region, meter, processing tier, and cache TTL.
  Claude SKUs can be listed under a model-specific billing service or under the Vertex AI service
  with an explicit Claude model label. A dot or a space can separate the version components.
  The SKU pair establishes the cutoff and the price table supplies the amounts. Without that
  pair, only the exact disputed count remains unknown.
  Owned context/location failures produce explicit diagnostics and enter repair investigation even
  on unchanged source bytes. Ordinary raw prices do not acquire that contract-failure trigger.
- Reviewed partner sections may use `Price /1M (USD)` token tables; the header is recognized only
  under the reviewed model-provider section titles. The Gemini 2.5 layout keeps its exact
  short/long-context and cached-input columns. Unrelated abbreviated tables remain excluded.
  The generic inline-label parser does not parse those same tables again merely because a cache
  cell includes `Cached Input:$...`; this prevents spurious GLM raw records alongside valid rates.
- A `Gemini <version> Live API` price label normalizes to the exact `Gemini <version> Live` model
  identity. This is a naming-format rule, not inheritance across Gemini versions or Live variants.
- Model-cell paragraph boundaries and trailing published effective-date annotations do not form
  part of a model name. The annotations still contribute applicability dates. Cache-read and
  cache-write rows retain their distinct meters and explicit five-minute/one-hour TTLs. An exact
  `Free` or `No charge` cell establishes zero, while a missing cell never does.
- A reviewed Gemini Omni table can name both Flash versions in one model cell; each target must
  resolve independently to an existing catalog identity. Lyria's `$ / 1 count` entries price
  generated music outputs as items, counting each full song or clip once: a request can return multiple
  outputs. The source amount scales exactly to the shared thousand-item unit; callers supply the
  generated item count without an invented response locator.
- The current text-embedding table publishes dollars per 1,000 `count` without defining whether
  that count is tokens or billable characters. Its exact online/Batch and input/output cells are
  retained as bounded raw rates for Gemini Embedding 001 and the named older Google text-embedding
  IDs. No token or character unit is inferred from an example response that reports both counts.
- Page alternatives are ignored only when a model card gives an exact token equivalence. Otherwise
  the token rate stays normalized and the unresolved alternative remains bounded raw evidence.
- An exact owned `Available at no charge until <date>.` footnote does not make the listed paid
  tariff permanently ambiguous. A wrapped partner pricing section owns its footnotes only when
  it contains one table; neighboring sections and quoted paragraphs cannot supply them. Its
  paid rates apply from the following calendar date, with date
  precision. The cutover day remains uncovered because `until` does not establish inclusivity;
  no historical free rate or timestamp is invented. Missing, conflicting, or invalid notes stay raw.
- A price cell's explicit denominator overrides a token column heading for that amount. A video
  cell containing both a per-second price and a per-million-token price retains those distinct
  units. The parser does not reinterpret the per-second amount as a conflicting token price or
  charge both alternative measures of the same output. A provider-owned `billing_unit` selector
  separates the alternatives; consumers supply the applicable token or second billing basis.
- Media denominators normally come from the price cell or its price-column heading. The public
  [Cloud calculator](https://cloud.google.com/products/calculator) independently establishes generated
  seconds for exact managed `veo-3.1-generate-001` and `veo-3.1-fast-generate-001` generation rates,
  including video with audio. Their `count` cells use seconds while retaining resolution and operation.
  This reviewed unit contract does not extend to Lite, other revisions, or advanced operations.
  Calculator estimates are not a new amount source or an additional collection dependency.
  Input/output labels
  such as `Text/Image prompt` cannot establish a per-image unit. An unexplained `/ 1 count` Veo quote
  retains its amount, meter and scope as raw `unknown_unit` evidence with an explicit diagnostic;
  it does not imply images, seconds or one request.
  The owning media section is captured from unquoted document headings before table wrappers or
  display normalization are considered. Nested layout containers cannot hide a table or lend it
  an unrelated caption. An empty model cell continues the last exact model's row; a new unbound
  model label clears that owner and emits an identity diagnostic, so subsequent continuation
  prices cannot leak onto the previous model.
  Embedding tables with an explicit token unit stay owned by the token-table parser, which
  retains Online/Batch request type and input modality across continuation rows. The media
  parser cannot add a second unconditional quote over those scoped token rates.
- Explicit `N/A` cells are local non-numeric evidence and do not reject another meter or model.

## Grounding prices and allowances

The partner pricing companion owns the Claude Web Search price when present. A single-page
historical bundle can still carry that table in its index. The feature guide independently
supplies the supported models.

Grounding tables can contain either Feature / Pricing or Feature / Usage / Price (USD). The
header-selected Usage cell owns allowance and billing-rule prose in the latter form; the last
price cell alone cannot establish those rules. Column layout changes must not silently erase the
accepted allowance topology.

A combined Google Search / Web Grounding for Enterprise label applies to both services. Published
monthly web-query allowances share one pool across the explicitly named model families and web
services; Maps has a separate monthly pool. The current pricing page names Gemini 3 and Gemini 4
together. A clause naming only Gemini 3 cannot grant the benefit to Gemini 4 or a future family.
Reviewed Gemini 2.0/2.5 Flash and Flash-Lite daily prompt
allowances share their published Search pool; Pro uses its separately published daily quantity.
The Maps daily benefit appears in the Gemini 2.0 section and is not inherited by 2.5 models.
The Live 2.5 Flash allowance remains raw because the clause
names Flash and Flash-Lite without explicitly binding Live. Query and grounded-prompt units
come from the native price's explicit denominator, rather than a model-generation guess. A price
whose denominator is unknown stays bounded service-level raw evidence. An unrecognized Gemini
family heading cannot inherit the previous family's pricing section.

The source parser recognizes allowance clauses and creates canonical allowance terms with exact
rate targets, including targets in other service books. Services, allowances, accounting inputs
and reviewed vocabulary are independent source facts; none needs an arbitrary model carrier.
Commercial assembly binds documented quantities and relationships without interpreting raw prose
as an executable allowance policy. Consumers supply already-consumed shared usage when evaluating
a marginal charge. Only reviewed sharing/reset wording, valid grouped integers, agreeing quantities
and matching target units normalize. Unknown or conflicting allowances retain bounded raw evidence.
Unequal native prices survive extraction so canonical conflict resolution can withhold the affected
rate. Grounding billing-rule notes remain informational evidence.

DeepSeek-OCR's parenthetical page amounts do not establish whether they are alternative tariffs,
illustrations or fixed token quantities. Preserve known token rates and both bounded page notes;
do not add page and token charges or derive a billing conversion from their price ratio. Only a
Google-owned contract for those alternatives can resolve that raw evidence.

## Calculation inputs

The current reviewed accounting surface is:

- Gemini `generateContent` and terminal stream responses: total and per-modality prompt, cached,
  candidate, tool-result prompt, and thought tokens; served traffic type; generated inline-image
  count; Google Search and Image Search query counts; and returned Web, Maps, or Agent Search
  grounding presence;
- Gemini Batch Cloud Storage JSONL: the same `usageMetadata` and grounding fields under each
  successful row's `response`; failed rows do not contribute completed inference usage;
- embeddings: total plus text, image, video, audio, and document prompt-token details;
- Claude: input, cache-write, cache-read, output, and web-search-request counts from response usage
  for non-streaming and streaming calls;
- Grok Responses: input, cached input, output, reasoning, traffic type, server-side tool count, and
  source count from a response usage object, plus the same fields from a terminal
  `response.completed` event only while that document publishes it;
- OpenAI-compatible chat: prompt and completion tokens from a response or final stream usage chunk;
- Imagen: actual returned `predictions` count and requested output resolution; and
- Veo: requested duration and actual returned video count, multiplied to produce generated seconds,
  plus requested resolution and audio selection.

These are protocol contracts, not publisher-wide capabilities. Live-only models retain caller-owned
quantities and selectors unless their own catalog evidence also establishes GenerateContent.
Predict-only and embedding routes likewise cannot establish GenerateContent usage or grounding.
GenerateContent inline-image counters and Imagen `predict` counters/resolution selectors bind only
to models with the corresponding documented route. Model-specific grounding offers use the same
protocol boundary as their model's inference book. Known arithmetic remains available even when
no native acquisition is established.

The former Veo generation guide now redirects to the generic `endpoints.predict` method. Its
`parameters` field links to the first-party
[VideoGenerationModelParams](https://docs.cloud.google.com/gemini-enterprise-agent-platform/reference/rest/Shared.Types/VideoGenerationModelParams)
type, which documents `durationSeconds`, `sampleCount`, `resolution`, and `generateAudio`.
The fixed video companion uses that type page for request fields. Historical bundles with the
former combined guide remain replayable. The parameter page does not establish a completed
operation's `videos` result envelope; the Discovery
`GoogleCloudAiplatformV1beta1GenerateVideoResponse` schema does, so the result count binds there
and request selectors survive independently. The expected accounting surface follows the same
evidence: a result field the reviewed schemas do not document is not counted as a missing fact.

A documented streaming usage channel requires the terminal event that restates usage. Extraction
and the expected fact count share one marker predicate, so a provider that stops publishing the
marker shrinks the documented contract instead of leaving a permanently partial one.

Uncached Gemini input is calculated as prompt input minus cached input with a zero floor, plus tool
execution results provided back to the model. Grok input subtracts cached input with the same zero
floor. Gemini image-rate input and cache quantities include image and document modality buckets.
Text output adds thought tokens; aggregate candidate output is used only when no separately priced
output modality would be double counted. Thinking is therefore included when the public output
rate covers it, while the separate reasoning counter remains available as a calculation input.

Grounding mappings intentionally distinguish queries from grounded prompts. Google Search and Image
Search expose query arrays. Returned `GroundingChunkWeb`, `GroundingChunkMaps`, and
`GroundingChunkRetrievedContext` chunks can establish a qualifying grounded request; each result
contract names its own `GroundingChunk` sibling schema, so a renamed or retired detail type is
reported instead of silently dropped. Agent Platform does not expose the actual number of Google Maps
queries, so a Maps query-priced rate has a semantic binding but no quantity method; the deprecated
Maps widget context token is not treated as a query count.

## Known calculation gaps

The following remain explicit downstream inputs rather than invented mappings:

- partner-model Batch result usage, until Google documents its exact result envelope;
- Claude cache-TTL selection and Claude long-context threshold calculation on Agent Platform;
- wildcard `deployment_scope` selection from a concrete regional endpoint;
- actual Google Maps query count;
- interrupted-stream attribution and retry policy; and
- invoice, discount, billing-export, or invocation-log reconciliation.

These gaps do not erase rates. A binding without quantity methods states the billable semantic
quantity. Known token arithmetic and video-duration multiplication retain every independently
verified input locator when a companion field drifts. A partial or absent provider mapping leaves
the remaining calculation inputs to the caller; missing signals never imply zero.

## Refresh behavior

Refresh is deterministic and uses official pages, public APIs, and optional configured credentials.
No LLM or OCR participates. Discovery contracts are checked field by field, so one renamed usage
member removes only contracts that depend on it. The pricing-input reconciliation reports the exact
bound count against the reviewed surface. Unsupported in-boundary rate facts stay bounded and local;
unrelated table, route, or accounting drift does not fail the provider.

The pricing bundle has a larger transport bound because the Cloud page and fixed first-party
documents are large. That bound is a transport safety limit, not a schema assertion.
