# Alibaba Cloud Model Studio

Status: current

## Boundary

The DashScope partition is an AI Gateway rate book, not a catalog of everything Alibaba Cloud
sells. It admits only public facts needed to select and account for a directly invoked model API,
an asynchronous inference result, or a provider-hosted component triggered by that request.

Included facts are:

- public model identities and invocation availability;
- pay-as-you-go inference rates, including text, media, embeddings, reranking, transcription, and
  voice-generation operations;
- request-visible rate dimensions such as region, deployment scope, context band, thinking mode,
  modality, resolution, operation, and promotion eligibility;
- distinct realtime and Batch invocation offers;
- explicit and implicit context-cache rates; and
- built-in web-search call rates for the exact supported models and scopes.

Training, retained storage, Model Unit/PTU/CU capacity, LoRA deployment charges, plans,
subscriptions, free-quota balances, savings commitments, invoices, discounts, and account
settlement are outside the partition. Their exclusion is intentional and does not create an
`unknown` price. The shared pricing wire may still decode these concepts while other providers
converge, but DashScope does not publish them.

All admitted facts use the shared book → offer → term → variant model. Provider differences are
limited to dimension values, model IDs, meters, and exact usage-field locators; DashScope has no
provider-specific pricing structure.

## Official source graph

Production collection uses only Alibaba Cloud first-party sources:

- the official [recommended-model page](https://www.alibabacloud.com/help/en/model-studio/models.md)
  and nine task catalogs discover public model identities and capabilities;
- the [model price book](https://www.alibabacloud.com/help/en/model-studio/model-pricing) owns
  current public invocation prices;
- the [context-cache guide](https://www.alibabacloud.com/help/en/model-studio/context-cache.md) owns
  cache eligibility and multipliers;
- the [web-search guide](https://www.alibabacloud.com/help/en/model-studio/web-search.md) owns its
  compatible-model lists, regional scopes, and per-call rates;
- the maintained
  [international](https://www.alibabacloud.com/help/en/model-studio/model-depreciation) and
  [China](https://help.aliyun.com/zh/model-studio/model-depreciation) lifecycle tables own
  retirement dates and replacements;
- the fixed
  [international](https://www.alibabacloud.com/help/en/model-studio/model-release-notes) and
  [China](https://help.aliyun.com/zh/model-studio/newly-released-models) update tables provide
  release dates; and
- the documented, authenticated regional deployment inventory is an optional availability
  cross-check when `DASHSCOPE_API_KEY` is configured.

The product `llms.txt`, individual announcements, bulletin IDs, undocumented content APIs, images,
OCR, console data, and third-party catalogs are not refresh inputs. Announcement links may remain
human-facing provenance on Alibaba's maintained summary pages, but the collector does not fetch or
interpret them.

Task catalogs and the price book may both create exact public model identities. Recommendation,
lifecycle, release, and authenticated inventory sources are non-creating overlays. The
authenticated inventory is account- and region-scoped: presence may enrich an exact public match,
while absence never removes a public model.

## Catalog mapping

Task pages are independent regional catalogs. The collector recognizes exact IDs only in labeled
model columns under reviewed model sections. It does not infer identities from prose family names,
examples, or nearby specification tables. Exact IDs remain distinct; regional suffixes and
snapshots are not collapsed through family similarity.

If two rows in one source make contradictory capability claims for the same exact ID, only that
capability becomes `unknown` and the conflict is reported. The model and every non-conflicting field
remain available.

The recommendation page adds only exact region and endpoint evidence. Each card is parsed
independently. A new field, malformed card, unknown route, or route/region contradiction suppresses
that card and records a contract finding; valid sibling cards survive.

Lifecycle and release pages are structured table sources. Malformed dates, cells, or model IDs are
skipped at row scope and reported. The maintained lifecycle summaries replace the earlier
announcement-detail path: the collector never depends on unstable announcement DOM or OCR.

The authenticated deployment response requires a complete pagination envelope, but its model rows
and plan entries are recognized independently. Unknown response fields are ignored, an unknown plan
is skipped, and valid rows and plans remain usable. A truncated or inconsistent page is still a
systemic failure because it cannot establish a complete inventory.

## Pricing mapping

The public price book produces one model book per exact catalog identity. A model book has a
realtime offer and, where published, a Batch offer. Rates remain separate variants under their exact
applicability rather than expanding a Cartesian product or choosing a default.

For token-priced models, total request input selects the published context band and the selected
band applies to the request. Input, output, cache-read, and cache-write terms retain separate meters.
Published Batch rows are moved to the Batch offer and lose the source-native `service_tier=batch`
condition because the offer identity already carries that distinction.

The cache guide contributes only exact model/region eligibility and its published multipliers:
explicit writes are 125% of ordinary input, explicit reads 10%, and implicit reads 20%. A cache
rate is derived only when its exact base input rate exists. Published exceptions suppress only the
affected derived read rate; the model, base price, other cache mode, and sibling regions survive.

Built-in web search is a shared provider-service book. Equal scope/rate variants are stored once
with all exact compatible model references instead of copying the same offer into every model. Its
per-call charge binds to `usage.x_tools.web_search.count`. Search-result content is already included
in the model's reported input tokens, so it does not need a second raw pricing fact.

Token rate bindings use observable response counters:

- ordinary input → uncached input tokens;
- cache reads → cached input tokens;
- cache writes → cache-creation input tokens; and
- output → output tokens.

The adapter records exact Chat Completions, Responses, Anthropic-compatible, or Batch result field
locators where established. A numeric rate without a verified response counter remains a valid rate
with no charge binding; it is not rejected or converted to raw. This is common for provider-specific
image, video, audio, or successful-operation quantities whose exact usage fields differ by API.

Per-successful-voice-clone prices use the shared `speech_generation` meter and request unit. Generic
caller-defined functions are not a paid tool event. Provider-hosted tools enter the rate book only
when Alibaba publishes both an exact rate and a countable trigger.

## Conflicts and unknowns

The current public price book owns public PAYG amounts and applicability. A more specific official
operation guide may own its exact meter or eligibility, but account-scoped API observations without
complete currency and conditions cannot replace the public row.

Different region, route, model, context band, mode, promotion, validity, or currency values are
different variants, not conflicts. For a truly overlapping claim, a deterministic claim-specific
authority rule must select the winner and preserve the losing observation as conflict evidence. If
no exact rule exists, only the disputed value is withheld. Valid siblings remain visible.

An in-boundary rate may be numeric but unbound when its usage counter is not established. A missing
or unsupported in-boundary fact is unknown only at that smallest scope. Facts outside the Gateway
boundary are discarded rather than serialized as unknown or raw commercial data.

## Refresh resilience

All public DashScope sources are independently optional and retain their last verified source-owned
facts when temporarily unavailable or non-exhaustively omitted. The pricing page is nevertheless a
required dependency for adopting a fresh DashScope pricing partition. Context-cache and web-search
companions are optional fetches, but if either fails the previous complete pricing partition is
retained instead of publishing a fresh partial bundle.

Within a fetched source, table/card/row/plan failures are localized. Unknown object fields and new
enum values do not reject recognized siblings. Systemic failures remain limited to conditions that
invalidate the source's own completeness claim: malformed transport envelopes, inconsistent
pagination, missing required table structure, impossible sparse-row reconstruction, cardinality
bounds, or an invalid assembled pricing partition.

Refresh is deterministic and requires no LLM, fuzzy matching, family inheritance, or majority vote.
Previously accepted facts are removed only when a fresh source is authoritative and exhaustive for
the exact fact scope. Retention is reported as stale or a coverage gap rather than silently
restamped.

## Presentation

Model details show invocation mechanisms, only the dimensions needed to choose an applicable rate,
published meter/rate rows, observable usage fields when known, and compatible built-in web-search
rates. The UI does not calculate a total and does not expose training, storage, capacity
procurement, plan enrollment, or settlement topology.

Third-party catalogs such as models.dev and LiteLLM remain drift comparators only. Their flatter
rows can help reveal a missing model or changed amount, but cannot replace Alibaba's regional,
tiered, operation-specific first-party contract.
