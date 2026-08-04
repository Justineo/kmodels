# Vertex AI

Status: current

## Sources and identity

- Use the current Gemini Enterprise Agent Platform Google, partner, and managed-open catalogs while
  retaining provider identity `Vertex AI`. Each catalog is regional, independent, and
  non-exhaustive. Use the MaaS model list, not the generic self-deployment chooser, as the
  managed-open index.
- Pin English and crawl bounded model-card namespaces. Same-depth capability guides can be fetched,
  but only documents containing labeled model cards satisfy card-coverage bounds. Card IDs come
  from labeled `Model ID` cells; paths, headings, display labels, and approximate dates do not
  create identity.
- Fixed first-party companions cover the shared pricing page, Cloud SKU table, Gemini response and
  grounding metadata, exact Search/Maps/customer-data supported-model lists,
  Standard/Flex/Priority PayGo, Provisioned Throughput routing and accounting, Claude web search,
  partner/open response usage, the Google Cloud Pricing API, and Cloud Billing export latency.
  These documents are accounting drift guards; they do not create model identity.
- The optional paginated Model Garden inventory is account-scoped. Use the fixed publisher set and
  300-item page maximum; an omitted repeated field is an empty page. It can validate known rows but
  cannot create public catalog rows or retain raw account data. Enable it with
  `GOOGLE_SERVICE_ACCOUNT_JSON`.

## Mapping

- Keep publisher/API families, facts, lifecycle, and exact region/deployment pairs bound to the
  relevant card section. A publisher link elsewhere on a shared page cannot classify another
  model. Partner and open indexes can contribute an exact publisher, ID, name, description, and
  modality only when a unique Model Garden URL establishes that relation.
- Normalize documented `global endpoint` and geography-labeled `Multi-region` values to `global`,
  `us`, or `eu`. Other availability requires an exact region code. A future retirement date does
  not retire a model early.
- Endpoint evidence is family-scoped and requires a fixed first-party reference: Google
  `generateContent`, `embedContent`, `predict`, or `predictLongRunning`; Claude raw prediction;
  Grok/Llama OpenAI-compatible routes; or an exact managed-open sample. Mistral partner cards,
  unlisted open models, and Live/Realtime Google cards receive no inferred endpoint.
- Price joins preserve model version, parameter size, tier, context threshold, cache TTL, region,
  deployment scope, modality, resolution, native unit, and exact conditions. A family label can
  apply to every exact ID on one card; a less-specific label otherwise requires one unique
  most-specific target.
- Expand a shared `Flex/Batch` amount into the two selectable tiers. An explicitly labeled amount
  applies only to its tier; `Online requests` is Standard and `Batch requests` is Batch. Treat
  `<=` and the published `=<` 200K heading as the same closed upper bound.
- Normalize explicit token, character, image, frame, second, request, grounded-prompt, and search-
  query prices. A fixed-duration song is one request. Gemini 3 Search, Image Search, Web Grounding,
  and Maps are charged per executed query and use `thousand_search_units`; Gemini 2.5 and older
  grounding is charged per successful grounded prompt and uses `thousand_requests`. Grounding with
  customer data remains request-priced. Bind each operation only to the exact current models listed
  in its dedicated first-party grounding guide; do not widen a family-level price row to every
  similarly prefixed Gemini ID.
- Bind Claude web search's `$10 per 1000 searches` only to models listed by the dedicated current
  Claude web-search guide. The main pricing page's embedded supported-model sentence is stale, so
  it establishes the amount but not the complete applicability set. The response's
  `server_tool_use.web_search_requests` supplies the billable search count.
- Shared grounding allowances and success/input-token billing rules remain raw allowance or
  informational facts. They span models or depend on response outcome and must not become a model-
  local zero rate. `ON_DEMAND_OFF_PEAK` is a documented response value but has no reviewed public
  price, so it receives no invented rate.
- Detect damaged labeled-price cells from repeated table structure, retain rejected suffixes as raw
  evidence, and collapse Claude's unqualified cache-write label only when it exactly duplicates the
  explicit five-minute amount. Verify page/token alternatives and alternate SKU units with exact
  decimal or structured-SKU evidence; otherwise retain ambiguity as raw.
- Every reviewed pricing item receives a reconciliation disposition. Numeric rates are normalized,
  duplicate bindings are excluded, published `N/A` cells are explicit non-numeric, unsupported
  commercial structures are raw, and out-of-scope retired generations are excluded. Unbound,
  ambiguous, unsupported, or unresolved current items remain diagnostics instead of being guessed.
- Every current-model source has a minimum numeric-coverage guard: 80% for Google and 90% for
  partner and managed-open models. Provider-level agents, tuning, optimizer examples, and
  Provisioned Throughput are not token base rates and are not attached to ordinary model offers.

## Public estimate and account-exact cost

- The public pricing page can calculate a list-price estimate only when the gateway knows the exact
  provider surface, model/version, operation, returned Standard/Flex/Priority tier, global or non-
  global endpoint, context threshold, input/output modality, cache hit/write/storage behavior,
  resolution or duration, grounding/search count, and whether an outcome was billable. Request
  configuration alone is insufficient when Priority can downgrade or a tool can execute multiple
  queries.
- Standard PayGo's account spend tier controls quota and baseline throughput; it is not a separate
  published token price. Flex is client-selected and discounted. Priority can fall back to
  Standard, in which case the request is charged at Standard rates. The returned `trafficType` is
  the authoritative per-request tier observation.
- Provisioned Throughput is a fixed GSU subscription scoped to a project, region, model, and
  version. Its token burndown measures capacity rather than an on-demand token charge. By default,
  an overflowed whole request is processed and billed as PayGo; `dedicated` blocks overflow and
  `shared` deliberately bypasses provisioned capacity. Public token tables therefore cannot
  reconstruct a subscription's allocated per-request cost.
- The preview Google Cloud Pricing API is the first-party source for public SKU prices and custom
  contract prices associated with a billing account. It is useful only after an exact Vertex charge
  is joined to the right Cloud SKU. The Cloud Billing detailed export supplies effective price,
  negotiated discount, credits, currency, adjustments, and invoice attribution. Public tables do
  not establish those account-specific values.
- Account-level adjustments include contract discounts, promotional credits, currency conversion,
  tax, quota/allowance sharing, Priority fallback, and Provisioned Throughput commitments. They
  cannot be inferred from a public model price book or from the client request alone.

## Request, response, and freshness

- Gemini `GenerateContentResponse.usageMetadata` reports prompt, candidate, tool-result prompt,
  thinking, cached-content, and total token counts. It also reports prompt/cache/candidate/tool
  modality breakdowns and `trafficType`, distinguishing Standard, Priority, Flex, Off-Peak, and
  Provisioned Throughput processing. Preserve modality breakdowns because one total-token number is
  not enough to select every public meter.
- `GroundingMetadata` reports `webSearchQueries`, `imageSearchQueries`, chunks, and supports. For
  Gemini 3, executed query arrays support query-based pricing; for older Search/Web grounding, a
  successful response with grounding support determines whether the grounded prompt is billable.
  Maps and customer-data operations still require their operation-specific response evidence.
- Claude Messages reports input, output, cache-creation, and cache-read tokens; Claude web search
  additionally reports `server_tool_use.web_search_requests`. Grok Responses reports input,
  cached-input, output, reasoning, and Google traffic-type details. Managed-open Chat Completions
  reports prompt, completion, and total tokens. These response schemas improve the estimate but do
  not reveal negotiated account price or every billing adjustment.
- Cloud Billing says detailed costs are typically available within a day and can take more than 24
  hours. Some account charges may post in 5–15 minutes, but reports, exports, alerts, and dashboards
  still lag. Provisioned Throughput monitoring is minute-granularity. None is a reliable hot-path
  cost oracle.
- Cost-based routing should use a locally cached first-party public or account-contract price book,
  deployment/account policy, and request parameters before dispatch. Update future estimates from
  returned usage, actual traffic tier, cache result, and tool counts; reconcile later against Cloud
  Billing export and invoices. Do not load-balance on delayed aggregate cost reports.

## Extraction and reconciliation

- Refresh is deterministic and non-LLM. Bounded model-card tables own identity; exact pricing table
  headers/cells own public rates; fixed response and commercial-policy phrases fail closed when
  accounting semantics drift. Pricing evidence never creates a catalog identity.
- The previous extractor focused on model base-rate tables. It deliberately skipped provider tools,
  did not fetch billing/accounting companions, did not join the Claude tool price to the dedicated
  supported-model guide, and had no source-item reconciliation callback. Consequently, official
  `Feature | Pricing` and `Tool | Price` rows could disappear without affecting model numeric
  coverage. The corrected pipeline crawls those first-party documents, validates their accounting
  fields, normalizes the two tool table grammars, preserves allowances/rules as raw facts, and
  partitions every reviewed source item.
- The current live Google bundle has 49 identities, including 26 non-retired models; all 26 have
  numeric public pricing. It produces 1,045 normalized facts and 69 raw facts. The new grounding
  extraction adds 51 tool rates across 11 explicitly supported current Gemini models. Its
  reconciliation partitions 1,395 reviewed items into 1,045 normalized, 69 raw, 277 explicit
  non-numeric, and four excluded,
  with no current unbound, ambiguous, unsupported, or unresolved item.
- The partner bundle has 33 identities and 26 non-retired models, all numeric. It produces 545
  normalized facts and one raw fact, including Claude web-search rates on all 13 models in the
  dedicated supported list. Reconciliation has 545 normalized, one raw, five explicit non-numeric,
  and 88 excluded items with no problem disposition. The managed-open bundle has 18 non-retired
  identities, all numeric, with 60 normalized and one raw fact. Across overlapping sources there
  are 69 unique non-retired Vertex IDs and no unknown base-pricing model.
- The live main pricing page and the dedicated Claude feature guide conflict on the embedded
  supported-model list: the feature guide is newer and lists current Claude 5 and newer Claude 4.x
  models omitted from the pricing table note. Keep the numeric price from the pricing row and bind
  it only through the dedicated first-party feature list; fail closed if either structure drifts.
- ccusage remains comparison-only because it obtains pricing through LiteLLM. The inspected
  LiteLLM snapshot has 172 raw Vertex-labeled entries and overlaps 59 of 69 current exact IDs after
  prefix normalization; its extras are largely aliases, retired IDs, or mixed Gemini Developer API
  surfaces. models.dev has 41 Vertex entries and only 13 exact current overlaps before alias/version
  normalization, with flattened standard costs and broad media/partner omissions. These books were
  useful for locating possible gaps, but none of their values enters collection or canonical
  pricing.

## Kong AI Gateway

- Kong's provider is Gemini Vertex, not a generic adapter for every Vertex model.
- Compatibility requires the Gemini-compatible publisher/API family, exact method, active
  lifecycle, acceptable maturity, and region. Partner/open-model text generation alone is
  insufficient.
- Files, batches, ranking, tools, and grounding may be service-level/native operations. Missing
  route or response evidence remains unknown; never infer an alias or billing counter from a nearby
  model.
