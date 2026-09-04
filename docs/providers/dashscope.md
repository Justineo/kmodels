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
- distinct on-demand and Batch invocation offers;
- explicit and implicit context-cache rates; and
- built-in web, image-to-image, and text-to-image search call rates for the exact supported models
  and scopes; and
- the provider-published request, terminal response, terminal stream event, asynchronous result,
  and Batch-result fields needed by an external cost calculator.

Training, retained storage, Model Unit/PTU/CU capacity, LoRA deployment charges, plans,
subscriptions, free-quota balances, savings commitments, invoices, discounts, and account
settlement are outside the partition. Their exclusion is intentional and does not create an
`unknown` price. The shared pricing wire may still decode these concepts while other providers
converge, but DashScope does not publish them.

Kmodels does not observe requests, join stream events, decide whether an interrupted invocation is
billable, or reconcile invoices. Its responsibility ends at a machine-readable price book plus an
input contract: it states which exact values a runtime cost service must retain, how those values
select a rate, and which closed quantity calculation applies. Account reports and Model Studio
telemetry may be useful downstream evidence, but they are not substituted for request-attributable
provider usage here.

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
- the [image-search guide](https://www.alibabacloud.com/help/en/model-studio/image-search.md)
  and [text-to-image search guide](https://www.alibabacloud.com/help/en/model-studio/web-search-image.md)
  own their separate compatibility, regional rates, and count fields;
- the [OpenAI-compatible Chat](https://www.alibabacloud.com/help/en/model-studio/qwen-api-via-openai-chat-completions.md),
  [native Qwen](https://www.alibabacloud.com/help/en/model-studio/qwen-api-via-dashscope.md),
  [Anthropic-compatible Messages](https://www.alibabacloud.com/help/en/model-studio/anthropic-api-messages.md),
  [Responses](https://www.alibabacloud.com/help/en/model-studio/qwen-api-via-openai-responses.md),
  and [Batch](https://www.alibabacloud.com/help/en/model-studio/batch-interfaces-compatible-with-openai.md)
  guides own their protocol-specific usage envelopes;
- the [image](https://www.alibabacloud.com/help/en/model-studio/qwen-image-api.md),
  [video](https://www.alibabacloud.com/help/en/model-studio/text-to-video-api-reference.md),
  [TTS](https://www.alibabacloud.com/help/en/model-studio/qwen-tts-api.md),
  [music](https://www.alibabacloud.com/help/en/model-studio/fun-music-api.md), and
  [ASR](https://www.alibabacloud.com/help/en/model-studio/non-realtime-speech-recognition-user-guide.md)
  API guides own successful-result quantities; the
  [ASR event guide](https://www.alibabacloud.com/help/en/model-studio/fun-asr-server-events.md)
  owns its terminal streaming duration; and
- the [Base URL guide](https://www.alibabacloud.com/help/en/model-studio/base-url.md) establishes
  that the resolved endpoint and API-key plan determine the billing region;
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

The recommendation page adds only exact region and endpoint evidence. Detailed cards provide exact
request routes and regions. Compact listings provide exact model IDs in console links and the
console path's reviewed region, but no request route; repeated links are merged by exact ID. A
malformed card or link, unknown route or console region, or route/region contradiction suppresses
only that item and records a contract finding; valid siblings survive.

Lifecycle and release pages are structured table sources. Malformed dates, cells, or model IDs are
skipped at row scope and reported. The lifecycle summaries may temporarily contain only dated
notice links and no exact model rows; that is a valid empty non-exhaustive observation and retains
the last accepted lifecycle facts. The collector never guesses IDs from notice titles or depends on
unstable announcement DOM or OCR.

The authenticated deployment response requires a complete pagination envelope, but its model rows
and plan entries are recognized independently. Unknown response fields are ignored, an unknown plan
is skipped, and valid rows and plans remain usable. A truncated or inconsistent page is still a
systemic failure because it cannot establish a complete inventory.

## Pricing mapping

The public price book produces one model book per exact catalog identity. A model book has an
on-demand offer and, where published, a Batch offer. Rates remain separate variants under their
exact applicability rather than expanding a Cartesian product or choosing a default.

For token-priced models, total request input selects the published context band and the selected
band applies to the request. Input, output, cache-read, and cache-write terms retain separate meters.
Published Batch rows are moved to the Batch offer and lose the source-native `service_tier=batch`
condition because the offer identity already carries that distinction.

The cache guide contributes only exact model/region eligibility and its published multipliers:
explicit writes are 125% of ordinary input, explicit reads 10%, and implicit reads 20%. A cache
rate is derived only when its exact base input rate exists. Published exceptions suppress only the
affected derived read rate; the model, base price, other cache mode, and sibling regions survive.

Built-in web, image-to-image, and text-to-image search are separate shared provider-service books.
Equal scope/rate variants are stored once with all exact compatible model references instead of
copying the same offer into every model. Web search binds to either
`usage.plugins.search.count` or `usage.x_tools.web_search.count`; the two image search products bind
to `usage.x_tools.image_search.count` and `usage.x_tools.web_search_image.count` respectively.
Search-result content is already included in the model's reported input tokens, so it does not need
a second raw pricing fact.
Markdown web-search guides derive regional scope from `Tab` titles; inline heading anchors are
presentation markup, not section identity.

### Cost-calculator input contract

Every input is field-local and source-backed. A missing sibling removes only that locator; it does
not invalidate the price, a different protocol, or another usage field. The current contract covers:

- OpenAI-compatible Chat response and final stream-chunk totals, text/image/video/audio partitions,
  reasoning, cache-read, and explicit-cache-creation details;
- native Qwen response and stream totals, text/image/video/audio modality token details, reasoning
  tokens, cache reads, and cache creation;
- Anthropic-compatible response and terminal `message_delta` input, output, cache-read, and
  cache-creation counters, preserving that protocol's separately reported cache-token semantics;
- Responses response and `response.completed` totals, multimodal billing details, ordinary and
  session-cache fields, reasoning details, and priced hosted-tool counts;
- successful Batch JSONL result-item usage for both Chat-style and Responses-style bodies;
- successful image count and effective size, video output/total/input durations and effective
  resolution, TTS characters and token details, music duration, and ASR duration; and
- request-side resolved region, thinking-mode flags, and `prompt_extend` where those values select
  variants.

Token rate bindings use those observable counters:

- non-cached input → total input minus cached input and, on protocols that report it, explicit
  cache-creation input, floored at zero;
- cache reads → cached input tokens;
- cache writes → cache-creation input tokens; and
- output → output tokens.

Batch has no cache discount, so Batch input binds directly to each successful result item's total
input counter. Thinking tokens remain a separately observable diagnostic signal but are not added a
second time when Alibaba bills them inside output tokens. Character-priced TTS binds directly to
`usage.characters`; ASR and music bind to successful-result seconds; generated images bind to
`usage.image_count`; and video generation uses one provider-owned billable-duration signal. For
video-to-video rows whose source says “input and output price,” the quantity is the single published
total duration rather than two duplicated rate terms.

Context bands select from total input, not uncached input. Region selects from a canonical
`HttpRequest.resolved_region` value that the downstream collector derives from the actual endpoint;
Kmodels publishes the expected value but does not inspect the request. Thinking, prompt-extension,
and resolution selectors use closed categorical maps. There is no embedded CEL or arbitrary script:
the only arithmetic is the shared, unit-checked calculation graph.

A numeric rate without a verified quantity remains a valid rate with no fabricated locator. For
example, the current public voice-clone request rate is retained even though no reviewed per-result
counter has yet been admitted. OTel GenAI attributes can be an optional downstream adapter, but the
current semantic conventions do not replace provider-only cache-write, hosted-tool, media-result,
region, and operation signals, so OTel is not the canonical DashScope input contract.

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
required dependency for adopting a fresh DashScope pricing partition. Cache, tool, protocol, media,
and regional companions are optional fetches. A missing price-bearing companion is reported for
source-fact retention; a missing accounting field suppresses only that input contract and leaves its
rate and verified siblings intact.

Within a fetched source, table/card/row/plan failures are localized. Unknown object fields and new
enum values do not reject recognized siblings. Systemic failures remain limited to conditions that
invalidate the source's own completeness claim: malformed transport envelopes, inconsistent
pagination, missing required table structure, impossible sparse-row reconstruction, cardinality
bounds, or an invalid assembled pricing partition.

Refresh is deterministic and requires no LLM, fuzzy matching, family inheritance, or majority vote.
Previously accepted facts are removed only when a fresh source is authoritative and exhaustive for
the exact fact scope. Retention is reported as stale or a coverage gap rather than silently
restamped.

## Comparison boundary

models.dev's compact typed cost object and context tiers are useful for token/cache/audio discovery,
and LiteLLM's cost calculator covers many provider-specific counters and user-supplied custom prices.
Neither is used as the authority for this partition. Kmodels preserves first-party regional
variants, protocol channels, exact usage locators, successful-result aggregation, selector
provenance, and unit-checked subtraction in the price book itself. Conversely, LiteLLM or a gateway
runtime may collect live usage and compute a request total; Kmodels intentionally does not.

No cross-provider “same model” identity is introduced for comparison. DashScope prices bind only to
exact DashScope catalog identities, which keeps refresh deterministic and avoids an unmaintainable
semantic-family matcher.

## Presentation

Model details show invocation mechanisms, only the dimensions needed to choose an applicable rate,
published meter/rate rows, observable usage fields when known, and compatible built-in search
rates. The UI does not calculate a total and does not expose training, storage, capacity procurement,
plan enrollment, or settlement topology.

Third-party catalogs such as models.dev and LiteLLM remain drift comparators only. Their flatter
rows can help reveal a missing model or changed amount, but cannot replace Alibaba's regional,
tiered, operation-specific first-party contract.
