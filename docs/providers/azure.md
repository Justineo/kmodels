# Microsoft Foundry

Status: current

## Boundary

The Azure catalog contains first-party documented model identities that can be invoked through a
Foundry inference endpoint. Pricing contains only public list rates attributable to an inference
request, a completed Batch item, or an exactly observable built-in request component.

The shared book → offer → term → variant model is used without Azure-specific topology. Azure
vocabulary is limited to source-native model IDs, meters, deployment scopes, regions, service tiers,
and usage signals.

The catalog does not require a model to have a currently resolved price. A missing price is local to
the model or offer. Capacity-only products, training artifacts, and infrastructure SKUs do not enter
the catalog merely because they appear in a broad marketplace or pricing page.

## Sources

| Source                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Purpose and authority                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Microsoft Learn models sold by Azure](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/models-sold-directly-by-azure) and [partner models](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/models-from-partners)                                                                                                                                                                                                                                                                                                                                                                            | Primary public model/version identity, operation, modality, limit, and API evidence. The official Markdown view expands the published tables.                                                                                                                         |
| Microsoft Learn lifecycle tables and Standard, Provisioned, and Batch deployment matrices                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Lifecycle and deployment availability. Provisioned availability is a catalog fact, not an admitted request price. Each companion is optional; a missing companion retains its last verified facts.                                                                    |
| Anonymous `ai.azure.com` catalog API                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Optional first-party supplement for exact identities already supported by the documented catalog family and for newer exact versions. It is undocumented, fill-only for documented tuples, never overrides documented lifecycle, and never blocks a provider refresh. |
| [Azure Retail Prices API](https://learn.microsoft.com/rest/api/cost-management/retail-prices/azure-retail-prices)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Current public consumption meters. A row is published only after a deterministic model/version and meter join.                                                                                                                                                        |
| [Azure OpenAI pricing](https://azure.microsoft.com/pricing/details/azure-openai/) and the [Foundry Models pricing index](https://azure.microsoft.com/pricing/details/ai-foundry-models/microsoft/)                                                                                                                                                                                                                                                                                                                                                                                                                                          | Public model-family list prices and request-attributable built-in tool rates. Discovered family pages are optional and parsed independently.                                                                                                                          |
| [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing.md), delegated by [Microsoft's Claude billing contract](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/claude-models-billing)                                                                                                                                                                                                                                                                                                                                                                                                         | Claude token/cache rates in Foundry. Microsoft states that each call is first priced with Anthropic's published per-model token rates. CCU conversion, Marketplace discounts, and invoice settlement are outside scope.                                               |
| [Azure OpenAI Chat](https://learn.microsoft.com/rest/api/aifoundry/azureopenai/chat), [Responses](https://learn.microsoft.com/rest/api/aifoundry/azureopenai/responses), [Batch](https://learn.microsoft.com/rest/api/aifoundry/azureopenai/batch), [Embeddings](https://learn.microsoft.com/rest/api/aifoundry/azureopenai/embeddings), [media](https://learn.microsoft.com/azure/foundry/openai/reference-preview-latest), [Realtime](https://learn.microsoft.com/en-us/azure/foundry-classic/openai/realtime-audio-reference-ga), and [prompt caching](https://learn.microsoft.com/azure/foundry/openai/how-to/prompt-caching) contracts | Optional first-party accounting supplement. It establishes exact response, terminal stream-event, completed-job, and media-result fields from which a downstream request calculator can acquire quantities. It publishes no price and no runtime lifecycle.           |
| Authenticated Azure Location Models and exact ARM meter inventory                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Optional account-scoped confirmation of public model/version availability and exact meter IDs. It may enrich an existing public tuple but does not publish subscription resources, principals, deployment names, private prices, or account-only identities.          |

The required public index and its fixed companions use Microsoft Learn's
`?accept=text/markdown` representation. The published page's canonical URL, source metadata,
and navigation establish continuity with the unavailable MicrosoftDocs repository inputs. The
combined sold-models page must contain exactly one `azure-openai` pivot and one
`azure-direct-others` pivot. Each group keeps its own service family; an absent, duplicate, or
unterminated pivot rejects the source. One expanded regional-availability page supplies Standard,
Provisioned, and Batch tables. Lifecycle and retired-model tables remain independent optional
companions. Historical repository bundles remain replayable, and the reviewed GitHub raw host
stays admitted for the accepted snapshot's provenance. Current acquisition uses Learn only. The
120–300 model guard is unchanged.

The undocumented portal and every pricing overlay are optional. Transport, page, or schema failure
therefore keeps the public catalog usable and retains the last accepted Azure pricing partition with
a freshness warning.

## Catalog mapping

- Preserve Azure's case-sensitive model ID and explicit version. A versionless public row and a
  versioned row remain distinct identities unless Microsoft publishes an exact relation.
- Exclude the superseded `claude-sonnet-5.5` spelling from retained catalog facts. Microsoft
  [corrected that documentation typo to `claude-sonnet-5-5`](https://github.com/MicrosoftDocs/azure-ai-docs/commit/7fead43dc377b21792e30269412f903a62e376c6).
  The corrected ID binds to the delegated Claude Sonnet 5.5 price row; the typo is neither a
  separate model nor a documented callable alias. Other omitted IDs retain the normal
  non-exhaustive-source behavior.
- Merge repeated exact tuples across catalog tables, deployment matrices, the optional portal, and
  authenticated inventory. Known public lifecycle wins over portal lifecycle; fill-only supplements
  cannot replace a known scalar.
  An omitted limit in another documented capability row cannot erase an already known limit.
  ARM location observations are reconciled as a complete group: missing values can be filled, but
  two distinct known values remain unresolved even if a third location repeats one side. This
  applies independently to descriptions, context/output limits, lifecycle, and each capability.
- Treat OpenAI, models sold directly by Azure, and partner/community models as service-family
  evidence, not as different identity namespaces.
- Derive tasks and endpoints only from explicit table types and endpoint text. The portal's
  `zero-shot-classification` task maps to the shared `classification` task, while other new
  unrecognized labels are reported and ignored locally; they do not reject the model row.
- The portal's `outputModalities: ["json"]` value is a structured-output capability signal, not a
  separate catalog modality. It is recognized without widening the modality vocabulary or
  treating the value as an unreviewed contract extension.
- Availability records deployment type and region. Standard, Batch, and Provisioned matrices may all
  describe a callable model, but only request-attributable usage rates enter pricing.
- Optional account inventory contributes only positive, non-secret facts to an existing public
  identity. Missing credentials or a failed region leaves public facts unchanged.

## Pricing mapping

All Azure parsers return the explicit source envelope. Public tool prices and accounting contracts
belong to their respective sources, independently of model observations; no selected model stores
these facts. A service-only result can be captured and replayed against the admitted catalog.
Source-specific model-count and public catalog requirements still apply, and model prices retain
their exact identity/version joins and pricing-source evidence.

### Request-cost input contract

Kmodels is a price book, not a request observer. The optional `azure-accounting` source publishes
the first-party data contract a calculator may consume; it does not intercept streams, persist
usage, detect retries, or reconcile an invoice.
Its acquisition contracts are independent source facts. They require no catalog carrier and do
not create a placeholder model observation.

Current exact acquisition paths are:

- Chat/Completions response usage for prompt, cached prompt, cache-write, completion, input-audio,
  and output-audio tokens. The same documented usage object is available from the terminal stream
  chunk when `include_usage` is enabled; that path is explicitly `terminal_only` because an
  interrupted stream may not deliver it.
- Responses response usage for input, cached input, output, and reasoning tokens. Reasoning is
  available as a breakdown but remains part of output unless a price source publishes a distinct
  meter.
- Batch job usage for input, cached input, output, and reasoning tokens. These are job aggregates,
  so the binding resets at `job`, not at a fabricated result-item counter.
- Embeddings response prompt tokens.
- Realtime `response.done` stream events: independent text/audio/image input and cached-input
  partitions, plus text/audio output partitions under `/response/usage`. The direct OpenAI GA
  reference owns these fields; similarly named Voice Live or agent SDK fields do not establish
  this contract. Terminal usage may accompany completed, failed, cancelled or incomplete responses.
  Each response is an `attempt`, rather than an entire session. Missing fields remain unknown.
- Image response text-input, image-input, and image-output tokens; generated-image array length;
  and the returned `quality` and `size` selectors.
- Conditional transcription and translation response duration, and successful video-result
  duration.

Accounting facts are endpoint-gated. A Chat locator is not attached to a model that only documents
Responses, and image, audio, or video locators are attached only to a matching model task. When
Azure publishes separately priced cache or audio input without independent cache-modality rates,
uncached text is calculated within one API family as
`total input - cached input - cache write - audio input`, floored at zero. Separately
priced text output is similarly `total output - audio output`. Each API family retains its known
calculation and only its independently verified input locators, even when that mapping is partial.
Chat and Responses remain separate acquisition methods; missing signals must be supplied by the
caller rather than filled with a field from another family.
The usage recognizer also verifies the declared field type and its reviewed direct or flattened
position. Retyped counters, contradictory duplicate properties, nested lookalikes for direct
fields, and duplicate schema headings withhold that mapping; recognized sibling fields survive.
The published [Chat schema](https://learn.microsoft.com/en-us/rest/api/microsoft-foundry/azureopenai/chat#openaicompletionusage)
separates the root usage counters from their detail schemas.

Quantity equations use only related meters in the selected tariff's currency, applicability and
published validity. A cache rate in one region cannot make another region subtract cached tokens.
If a related component covers only part of a broader input-rate scope, automatic acquisition is
withheld and the caller supplies the billable quantity; the known rate and semantic signal remain.
Token equations are not inferred from a related rate with a different billing unit.

Provider-owned audio, image and video cache meters participate in those same scope checks.
When a tariff separately prices cached modalities, aggregate cached/write counts cannot supply
the text-cache charge, and aggregate audio/image input cannot supply the uncached modality charge.
The total-input equation is also withheld: aggregate cached and audio counts may overlap.
The known prices and semantic charge bindings survive; callers supply independent billable
partitions for those aggregate protocols. Realtime-capable synchronous models instead use the
owned per-modality partitions: uncached input is that modality's input minus its cached subset,
floored at zero. Cache and output charges use their own exact counters. A separately priced cache
write with no corresponding native counter withholds that modality's input acquisition. Realtime
fields never supply Chat, Images or Batch quantities, and missing optional references cannot
remove a price or imply a zero counter. A disjoint region, currency or
validity remains independent, while partial overlap or incompatible units withhold acquisition.

Realtime extraction requires one owned `response.done` section, the matching typed event property
table and one strict JSON event structure. Duplicate document identities or declarations, quoted
examples, malformed JSON, and retyped or unsafe counters cannot establish acquisition. A drifting
field withholds only that mapping and emits the existing partial-input diagnostic, which can
admit repair even on unchanged source bytes. The example establishes field shape; its sample
values are never catalog usage or prices.

The current Azure contracts do not establish an exact response selector for priority versus
standard deployment pricing, a request/result field for region or deployment scope, a filtered
count of File Search or Web Search calls, a Code Interpreter session boundary, Model Router's
selected-model contribution, document-page counts, rerank search units, TTS billing characters, or
video resolution as one categorical field. Those rates retain semantic charge bindings without
`input_sources`; callers must supply the exact quantity or selector from their own configuration or
telemetry. Kmodels does not invent a JSON path to make a list price appear executable.

### Admitted offers

- `sync`: synchronous pay-as-you-go inference.
- `batch`: the distinct asynchronous Batch mechanism. Rates apply to the completed job's reported
  usage aggregate; enqueued tokens and quota are not prices.
- `router`: Model Router input markup. The response `model` selects the underlying model whose normal
  inference rates are additive.

Within an offer, retain only conditions that select or establish the applied rate: model/version,
region, deployment scope, served service tier, context tier, modality, operation, quality,
resolution, cache TTL, and validity when first-party evidence supplies them. Equal prices are not
expanded into a synthetic Cartesian product.

Explicit ShortCo/short-context and LongCo/long-context labels establish their respective native
context classes. A quote without such a declaration stays unqualified; another long-context price
cannot create a Standard or short-context selector on it. Unequal overlapping quotes retain their
original evidence as bounded conflicts. A model's context window or a direct provider's threshold
does not supply an Azure tariff bound.

Normalized meters include input/output/cache token classes, embeddings, rerank searches, image,
audio, video, pages, requests, and duration units used directly by inference. A numeric rate remains
useful without a charge binding; a missing signal is local to that term.

### Request components

The Azure OpenAI pricing page can publish separate service books for components whose charged event
is observable from the proxied operation:

- Responses File Search tool calls;
- Responses Web Search calls when published;
- Code Interpreter sessions; and
- Computer Use token usage.

Persistent File Search/vector storage is excluded. An unknown row in the reviewed built-in-tools
table is retained as one bounded raw request-component fact; an explicitly identified storage or
capacity row is discarded rather than serialized as raw. When one Computer Use cell contains both
Input and Output regional amounts, each amount is classified from its nearest local label rather
than from the combined cell text.

An unclassified tool quote carries no `not_published` state: its literal amount is present while
the meter or denominator remains unresolved. Raw interpretation and commercial states are separate.

### Excluded commercial facts

The collector discards:

- fine-tuning/training jobs, checkpoints, graders, and training compute;
- fine-tuned-model hosting and other persistent hosting charges;
- PTU/provisioned capacity, Reservations, commitment plans, and spillover procurement;
- Managed Compute GPU/VM charges;
- hosted-agent vCPU/GiB runtime and persistent agent storage;
- standalone Agent Service, Content Safety, evaluation, and observability products unless a future
  reviewed source proves an exact separately billed event in the proxied inference protocol;
- Agent prepurchase/ACU plans, subscriptions, credits, balances, and allowances at account scope; and
- Marketplace enrollment, CCU conversion, private offers, MACC, invoices, taxes, and settlement.

These facts are outside the Gateway rate-book boundary, not unknown pricing. They do not appear in
canonical raw facts or website projections.

## Exact matching and conflicts

Retail matching is deterministic:

1. constrain the Microsoft product/SKU family;
2. match normalized ordered identity tokens and explicit version markers;
3. bind only an exact catalog version, an existing versionless tuple, or the sole eligible public
   version; and
4. infer a meter only when the native unit and a unique task/meter interpretation agree.

Never fuzzy-match a SKU, guess input versus output, or copy a family price to every version. An
unbound row is reported but does not reject recognized siblings.

For an exact overlapping claim, authority is:

1. public Retail Prices SKU/meter for its exact model, region, deployment, tier, and validity scope;
2. a first-party price book: an exact Microsoft model-family row or an explicitly delegated
   provider price book, currently Anthropic for Claude.

Exact-version pricing takes precedence over a base-model fallback for that version. There is no
additional automatic winner between two conflicting price books at the same authority and binding
scope. Authenticated ARM joins can confirm an exact public tuple and meter meaning, but the
account-scoped inventory is outside the public canonical pricing dependency set. It cannot raise
the authority of a public rate or introduce account-only pricing into offline replay.

Different region, deployment mechanism, seller, tier, or validity is not a conflict. A conflict with
no deterministic winner withholds only the disputed rate and emits reconciliation evidence; valid
sibling rates survive.
Public-page and direct ARM parsing preserve unequal observations for the same price scope instead
of discarding them or keeping the last amount. Canonical public assembly retains a bounded raw
conflict with both amounts while preserving disjoint regional prices and readable meters.
Price amounts accept nonnegative decimal strings or finite nonnegative JSON numbers. Shared Azure
amount parsing expands numeric scientific notation with exact decimal operations and rejects
placeholders such as `Pending` before they can enter a numeric fact.

## Resilient refresh

- Retail Prices retries honor both `Retry-After` and
  `x-ms-ratelimit-retailPrices-retry-after`, taking the longer valid wait when both are present.
  These cooldowns also apply to the reviewed `Too many requests` response body returned with
  HTTP 200. A cooldown that exceeds the shared request retry budget fails the refresh rather
  than causing an early retry; the accepted pricing partition remains stale.
- A pricing `source_unavailable` outcome can also wrap a parser rejection after a successful
  fetch. Inspect the underlying warning and replay the Retail parser before diagnosing transport.
  The public feed includes model SKUs absent from the documented catalog and versionless rows
  with multiple possible catalog versions. These emit `retail_identity_not_unique` or
  `retail_version_not_unique`; if exact bindings fall below the reviewed coverage guard, the
  previous pricing partition remains stale. Fetch success does not justify guessing identities,
  assigning an ambiguous family rate to every version, or lowering `minHandledRatio`.
  Azure OpenAI's compact GPT numbers (`54`, `55`, `56luna`, `61 terra`) and `ShCo`/`LoCo`/`Fl`
  labels are expanded only inside the OpenAI product family. Standard, Priority and Flex remain
  disjoint served tiers within synchronous inference; Batch stays a separate mechanism. Microsoft's
  [Flex guide](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/flex-processing) and
  [Priority guide](https://learn.microsoft.com/en-us/azure/foundry/openai/concepts/priority-processing)
  establish standard processing as the default tariff and Flex as a Global Standard processing
  tier. This does not invent a context class for an unqualified quote. BFL's Flex identity is not
  a processing tier. Scoped `MM3.5` and omitted Llama `Instruct` suffixes still require a unique
  catalog identity; competing base/instruct identities remain ambiguous. The 70% guard is unchanged.
- A local Retail Prices failure can occur before any HTTP response: the observed local proxy
  path timed out during TLS, while the same public request completed directly. Diagnose curl exit
  code and phase before changing an extractor. Where direct access is verified and intended, add
  `prices.azure.com` to the local `NO_PROXY` configuration; the collector does not silently bypass
  configured proxies. This endpoint is public and does not depend on Azure credentials.

- The primary Microsoft Learn index is required. Its fixed catalog, lifecycle, and deployment
  companions are independently optional and retain last verified facts when omitted.
- The portal, Retail Prices, public price pages, Claude price book, and authenticated inventory are
  optional overlays. Their failure cannot reject the documented catalog.
- JSON collections parse row by row. A malformed row or new enum value is skipped or partially
  interpreted with a contract signal; recognized rows survive.
- HTML prices parse table, row, price cell, region, and meter independently. A malformed price cell
  cannot erase another model or tool rate.
- Delegated Claude pricing validates the semantic Foundry conversion and Data Zone contract, then
  locates rate columns by header. Prose/link changes and unrelated new columns do not invalidate
  readable model rows. A trailing numeric superscript on an exact `MTok` cell is a first-party
  footnote marker, not part of the amount; its presence does not discard the Claude Opus 5.5 row.
  An unreadable meter leaves the readable cells in that model row intact. The delegated schedule
  binds at `base_model_id` scope to currently offered, exact same-ID catalog versions, using the
  shared fallback-pricebook mechanism. It does not fabricate version-specific prices or fuzzy
  aliases, and exact version prices retain priority. A Data Zone multiplier is emitted only when
  all matching catalog tuples establish that deployment support. Microsoft documents
  [both hosting versions](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/claude-models)
  and their common [per-model pricing basis](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/claude-models-billing).
- Dynamic pricing-family discovery has no minimum page-count dependency. A new family page may add
  exact prices but cannot widen identity matching.
- If an optional pricing dependency is missing, or the assembled Azure partition fails topology
  validation, publish the previous accepted Azure pricing partition as stale. Never mix a partial
  current price graph with retained siblings.
- Catalog/pricing publication remains crash-consistent; staleness and reconciliation stay in
  operational metadata rather than being hidden in displayed rates.

## Presentation

Model details show only applicable invocation offers, the dimensions that materially select a rate,
published meter/rate rows, and exact request components. They do not show plans, capacity,
training, storage, enrollment, or settlement. Known usage-counting parameters remain visible, but
the website does not ask for quantities or calculate a total.
