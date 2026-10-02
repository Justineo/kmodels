# Price-book completeness assessment

Status: 2026-09-30 baseline assessment, implemented parser repairs, and remaining evidence gaps.

## Evidence and interpretation

The accepted pair was generated at `2026-09-30T06:23:47.559Z` (14:23 China time).
All 20 catalog and pricing partitions were accepted. None retained or withheld an entire
pricing partition. This is publication success, not complete price coverage.

This assessment compared `data/catalog.json`, `data/pricing.json.gz`, and
`data/refresh-summary.json` with provider guides, adapter code, and current first-party pages.
Eight provider adapters were repaired and exercised against freshly fetched first-party pages
without publishing their output. These focused probes did not fetch every optional companion
and are not a replacement collection run. Generated `data/` remains unchanged: all coverage
counts below describe the pre-repair accepted snapshot, not a new published catalog.

Counts include every catalog status except `retired`, including deprecated models and artifacts.
“Numeric” means at least one applicable numeric rate, including linked hosting capacity for
SageMaker. It does not establish all meters, routes, tiers, or components. “Offers” includes
free, unpublished, and raw-only states. “Unknown” means Kmodels has no resolved pricing offer;
it is not proof that the provider has no published price.

The snapshot has 4,275 catalog identities, 4,067 non-retired identities, 2,053 books
(1,590 model books and 463 provider-resource books), and 1,887 pricing-unknown current models.
There are 74 blocking raw variants across 27 current model identities and two service books,
plus 145 informational raw variants. Missing books and silently omitted tiers are additional
gaps not measured by raw counts.

## Implemented repairs

| Provider       | Repair and focused live-source result                                                                                                                                                                                                                                  |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OpenAI         | Recognize Fast and Ultrafast; obtain geography restrictions from their official guides. Missing scope evidence preserves raw amounts instead of publishing unrestricted numeric rates.                                                                                 |
| Gemini API     | Exclude illustrative per-10-second equivalences from token tariffs. Both Gemini 3.8 TTS models now parse 30 scoped numeric facts with no raw facts in the focused replay.                                                                                              |
| xAI            | Accept the current Voice cost-cell wording; Voice Think Fast 2.0 produces six facts across three regions.                                                                                                                                                              |
| Vertex         | Bind the exact Live API label and avoid duplicate interpretation of abbreviated token headers. Gemini 3.8 Live produces 14 facts; each of three GLM models produces three, with no raw duplicates.                                                                     |
| DashScope      | Read table-local currency/denominator and combined modality headers. Qwen 3.8 Omni Flash Realtime produces 12 facts across Singapore and Beijing.                                                                                                                      |
| Amazon Bedrock | Use exact Runtime model-card tariffs when bulk SKUs cannot bind; retain valid sibling cells. Grok 4.7 includes Standard/Priority/Flex. Kimi K3 adds API-qualified Priority/Flex without Converse accounting assumptions.                                               |
| Azure          | Bind delegated Claude tariffs to the exact base model across offered versions, retaining exact-version precedence. Fifteen base IDs cover 29 catalog identities, including 22 previously without numeric pricing. A malformed component no longer drops the whole row. |
| Cohere         | Collect five explicitly named legacy Command tariffs from the public FAQ with `account_eligibility=existing_customer`; four previously lacked numeric offers. Missing eligibility evidence does not become an unrestricted price.                                      |

These are source-fact counts and exact binding checks, not post-publication coverage totals.
Fixtures cover layout drift, missing companion scope, malformed sibling cells, identity/version
boundaries, and API/account eligibility. No third-party amount or inferred successor tariff is used.

## Confirmed recoverable gaps from the follow-up recheck

Remaining unknowns must not be interpreted as exhausted research. The follow-up found additional
first-party price sources that the current adapters do not collect:

- [Ollama's central pricing page](https://ollama.com/pricing) explicitly prices five still-unpriced
  exact Cloud IDs: `gemma4`, `gpt-oss:120b`, `gpt-oss:20b`, `nemotron-3-nano`, and
  `nemotron-3-super`. It also publishes an Off-Peak schedule. The current source graph omits this
  page; its subscription content is not a reason to exclude the independent invocation-rate table.
  Family/tag aliases still require separate proof and are not included in this five-ID count.
- Alibaba's independent cards for
  [paraformer-realtime-v1](https://help.aliyun.com/en/model-studio/paraformer-realtime-v1) and
  [paraformer-realtime-8k-v1](https://help.aliyun.com/en/model-studio/paraformer-realtime-8k-v1)
  each publish CNY 0.00024 per audio second for China (Beijing). The international aggregate price
  page omits these rows. These are viable model-card supplements, with their original currency and
  domestic billing scope; they must not be converted into guessed international USD tariffs.

These seven exact identities have verified additional public price evidence, but the new sources
are not yet integrated. They are not a claim of seven newly published price books.

Microsoft's [official GPT-6.1 Sol launch article](https://techcommunity.microsoft.com/blog/azure-ai-foundry-blog/introducing-gpt-6-1-sol-in-microsoft-foundry-advanced-intelligence-optimized-for/4560811)
also publishes Standard input/cache-read/cache-write/output rates for Global and US/EU/APAC
Data Zones, with short/long context rows. Fresh HTML contains the full article in JSON-LD and
`__NEXT_DATA__` even though the basic page-text reader returns no article. Both structured copies
were read and agree. This is a confirmed additional first-party source, not merely an indexed
snippet. Integration still needs exact offered-version/context-band binding and precedence against
the current retail price book; the announcement itself points to the central page for current terms.

Gemini Embedding 001 has an exact amount in Google's older launch article; a dated announcement
alone does not settle current applicability. It deserves continued first-party investigation
rather than an assertion that no price exists.

## Baseline provider coverage

| Provider                                  |   Current |   Numeric |    Offers |   Unknown | Blocking raw models |
| ----------------------------------------- | --------: | --------: | --------: | --------: | ------------------: |
| Amazon Bedrock                            |       128 |       126 |       126 |         2 |                   0 |
| Amazon SageMaker AI                       |       628 |       623 |       623 |         5 |                   0 |
| Anthropic                                 |        16 |        15 |        15 |         1 |                   0 |
| Microsoft Foundry / Azure                 |       232 |       163 |       163 |        69 |                   0 |
| Cerebras                                  |        15 |         2 |         2 |        13 |                   0 |
| Cohere                                    |        40 |         9 |        17 |        23 |                   0 |
| Alibaba Cloud Model Studio                |       377 |       355 |       355 |        22 |                   0 |
| Databricks                                |        66 |        64 |        65 |         1 |                   4 |
| DeepSeek                                  |         4 |         4 |         4 |         0 |                   0 |
| Gemini API                                |        48 |        39 |        39 |         9 |                   2 |
| Hugging Face                              |     1,588 |       133 |       140 |     1,448 |                  10 |
| Kimi                                      |         4 |         4 |         4 |         0 |                   0 |
| Meta Llama                                |        48 |         0 |         3 |        45 |                   0 |
| Mistral                                   |        40 |        39 |        40 |         0 |                   0 |
| Ollama                                    |       248 |        12 |        12 |       236 |                   0 |
| OpenAI                                    |        89 |        78 |        79 |         8 |                   0 |
| TypeSafe AI                               |         1 |         1 |         1 |         0 |                   0 |
| Vercel AI Gateway                         |       395 |       395 |       395 |         0 |                   0 |
| Vertex / Gemini Enterprise Agent Platform |        78 |        70 |        74 |         4 |                  11 |
| xAI                                       |        22 |        21 |        21 |         1 |                   0 |
| **Total**                                 | **4,067** | **2,153** | **2,178** | **1,887** |              **27** |

OpenAI additionally has two explicit `not_applicable` identities. SageMaker's linked capacity
explains why resolved-model coverage is larger than the number of model-scoped books.

## Findings by provider

### Amazon Bedrock

The two unknown IDs are `amazon.titan-embed-g1-text-02` and `xai.grok-4.7`.
The latter was a confirmed collection gap: its
[official model card](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-xai-grok-4-7.html)
publishes Standard Geo/Global CRIS prices and Priority/Flex multipliers.
The accepted bulk-price diagnostics instead contain Mantle-labeled dimensions, while the card
establishes Runtime CRIS access and explicitly excludes Mantle. Those rows cannot simply be
attached to the Runtime route. The repaired fallback extracts the exact card table, resolves Geo
from published profile aliases, and derives the explicit service-tier multipliers. Kimi K3's
Priority/Flex rates additionally require a Responses or Chat Completions operation; missing
scope evidence retains Standard and reports the unresolved tier scope.
The Titan identity still lacks an exact binding in the accepted source set; this audit did not
establish a safe substitute.

There are 1,905 `price_dimension_target_unbound` source items, including Kimi K3 as well as Grok;
this is a route/tier coverage issue beyond the two entirely unknown models, not 1,905 missing
models. Three canonical raw variants are superseded-value provenance only.

### Amazon SageMaker AI

623 models resolve to numeric offers, predominantly infrastructure capacity. This does not mean
623 token price cards or complete deployment bills. The five Nova IDs
(`nova-textgeneration-lite`, `lite-v2`, `micro`, `micro-v2`, and `pro`, with the common prefix)
have no supported-instance list and no public per-inference rate from which to bind a model price.
Twenty Marketplace listings expose no usable public pricing query. Missing software charges can
therefore coexist with a known AWS instance price.

The optional regional Hub API aborted in the latest run; public SDK, hosting, and Marketplace
pricing were accepted independently. See the [provider guide](providers/amazon-sagemaker.md) and
[AWS pricing](https://aws.amazon.com/sagemaker/ai/pricing/).

### Anthropic

Only `claude-mythos-preview` remains unknown. The current
[lifecycle page](https://platform.claude.com/docs/en/about-claude/model-deprecations) still calls it
deprecated with retirement to be announced; it must not be silently counted as retired.
The current [price table](https://platform.claude.com/docs/en/about-claude/pricing) omits an exact
Mythos Preview row. A successor's price is insufficient evidence.

The tool-overhead table diagnostic concerns billing-input interpretation, not a missing base rate.
No blocking canonical raw remains for the 15 priced models.

### Microsoft Foundry / Azure

The 69 unknown identities are a mixture of model/version joins, partner naming, unsupported meters,
and unavailable public cells. Retail reconciliation contains 6,127 nonunique identity rows,
1,632 ambiguous version rows, and 14 unsupported meter/unit rows. Public HTML adds 213 unbound
identity rows, four unsupported rows, and five unavailable price cells. These are source-row
counts, not disjoint model counts.

Twenty-three baseline unknown identities are Claude variants. The repaired delegated parser uses
Microsoft's explicit per-model Anthropic billing contract to bind an exact base ID to its offered
versions; the live replay recovers 22 of these. Exact-version observations retain precedence,
and a Data Zone uplift requires positive availability across every candidate in a shared book.
This does not authorize cross-family or guessed-version joins. Other missing identities include
new GPT-6.1 Sol, image/audio models, Fireworks-prefixed partner IDs, and older embedding versions.

The portal inventory timed out, but all pricing partitions were accepted. Treat the transport
failure separately from these persistent joins. Sources:
[Foundry pricing](https://azure.microsoft.com/en-us/pricing/details/ai-foundry-models/microsoft/)
and [binding rules](providers/azure.md).

### Cerebras

All 13 unknown models are deprecated catalog identities. The current
[Shared Inference catalog](https://inference-docs.cerebras.ai/models/overview) lists exactly the
two models with numeric prices: GPT OSS 120B and Qwen 3.8 27B.
The [deprecation feed](https://inference-docs.cerebras.ai/support/deprecation) explains the older
identities. A deprecated model remains in the non-retired denominator without a current price.
Separately, the admitted Batch offer has explicitly unpublished pricing; synchronous prices
must not be reused for it.

### Cohere

Nine models have numeric rates and eight additional models have free-only offers.
The 23 unknowns mix older Command/Embed/Rerank models, new Embed 5 variants, and research models.

The [official FAQ](https://cohere.com/pricing) publishes five legacy Command tariffs for existing
customers. The adapter now collects their ten components with explicit account eligibility,
replacing the previous blanket exclusion. Each name must bind uniquely to an exact catalog
identity, and the eligibility statement must be in the same FAQ block.
Generic trial-key access must not become a production zero rate. Missing research-model
prices and exact central-product joins remain unknown. One missing quantity contract
(`11/12` inputs) does not erase the accepted rates.

### Alibaba Cloud Model Studio / DashScope

22 baseline identities have no price. The parser gap for
`qwen3.8-omni-flash-realtime`: the
[pricing page](https://www.alibabacloud.com/help/en/model-studio/model-pricing) publishes exact
Singapore and Beijing modality rates in a new header layout with currency declared above
the table. The repaired parser combines that local declaration with each modality header,
including text/image/video input, and recovers both regions. Without the currency declaration,
it does not guess the denomination.

Other unknowns include Qwen 2.5 variants, Paraformer, MiniMax/GLM names, and Wan regional IDs;
their exact identity and scope still require individual joins. The two Paraformer realtime v1
identities now have confirmed first-party domestic CNY card prices, as described above.
Source diagnostics also report
11 unbound model-price items, nine unsupported units, eight unsupported identities, two cache
scope gaps, and unbound Beijing web/image-search charges. Some unsupported rows concern
products absent from the admitted catalog, so these counts must not be added to the 22 models.

### Databricks

The one entirely unknown model is `databricks-grok-4-7`: the
[supported-model page](https://docs.databricks.com/aws/en/machine-learning/foundation-model-apis/supported-models)
lists it, while the reviewed
[proprietary rate table](https://www.databricks.com/product/pricing/proprietary-foundation-model-serving)
still lists Grok 4.6. Native xAI USD prices cannot establish Databricks DBU prices.

Two Gemini image models retain 24 conflicting DBU/pass-through-USD variants. The future
post-promotion DBU schedule and undated delegated USD observations lack an accepted precedence
or separate billing choice. Priority amounts are additionally unknown for Grok 4.6 and
GPT-6.1 Sol; the latter has a raw-only model offer. There are 26 blocking variants in total.
The workspace API timeout affects optional inventory, not public pricing acceptance.
See [DBU research](pricing-research.md) for the conversion boundary.

### DeepSeek

All four callable identities have numeric rates. Their four raw notes are informational:
the [official peak schedule](https://api-docs.deepseek.com/quick_start/pricing/) depends on
weekday, UTC windows, and Chinese public holidays. The rates exist, but the consumer must supply
the applicable billing period; a general holiday-calendar selector is not compiled.
Inventory/Anthropic-streaming contract drift affects metadata or usage acquisition, not amounts.

### Gemini API

Nine exact catalog identities lack a bound offer: two Antigravity previews, two Deep Research
previews, `gemini-3-pro-image-preview`, `gemini-3.1-flash-image-preview`,
`gemini-embedding-001`, `gemini-robotics-er-1.6-preview`, and `lyria-realtime-exp`.
Agent pricing may delegate to underlying model/tool usage; that is not an independent agent
price. Preview and older IDs must not inherit successor rates merely by name.

A repaired adapter bug affected `gemini-3.8-flash-tts` and
`gemini-3.8-flash-lite-tts`. The
[official page](https://ai.google.dev/gemini-api/docs/pricing) gives token prices followed by
equivalent per-10-second estimates. `priceUnit` recognizes minutes and seconds but not
“per 10s”; it falls back to the table's million-token header. The fresh-page parser probe
reproduced `0.001125` as USD per million tokens instead of an audio-duration equivalence.
Canonical conflict handling then downgraded 16 scoped variants. The parser now separates these
equivalences from actual token tariffs and preserves the dated tariff scopes. If the primary
tariff is missing, the illustrative estimate remains unresolved raw evidence instead of
inheriting the token denominator. This was our unit-recognition error, not contradictory prices.

### Hugging Face

Of 1,448 unknown models, 1,405 have an `hf-inference` route. The
[official billing guide](https://huggingface.co/docs/inference-providers/en/pricing) charges
compute time against hardware price, while the collected route evidence lacks an exact
hardware-rate binding. The other 43 unknown identities have unpriced specialized/partner routes.

Ten model books retain blocking route-specific unknown amounts: seven Cohere routes
(Aya Vision, Command A Reasoning/Translate, and four Tiny Aya models), Qwen3.8 2.4T on Fireworks,
DeepSeek V4 Flash 0731 on Scaleway, and GLM-4.6V-Flash on Z.ai.
Their issues include missing exact paid native rates, non-serverless products, denomination,
and native-free versus HF-paid disagreement. An amount for another route is insufficient.
Three Featherless unit conflicts have deterministic winners and remain informational.
Missing auto-routing observations are a separate calculation-input limitation.

### Kimi

All four current models have numeric China/international rates. The
[current pricing page](https://platform.kimi.ai/docs/pricing/chat-k3) consolidates the current
model families. A rejected K2.5 page concerns a retired model, not a current base-price outage.
Remaining limits are Formula web-search failure charging, unpublished promotion end dates for
temporary free tools/files, and missing Batch cached-token acquisition. Eleven raw variants
are informational; these limits still matter for complete service-cost reconstruction.

### Meta Llama

45 unpriced identities are downloadable artifacts, not Meta-billed inference offers.
Three exact SDK-established hosted identities have `not_published` offers and no numeric rate.
The [official SDK](https://github.com/meta-llama/llama-api-python) establishes routes and examples,
not a current public amount. Historical free-preview announcements do not establish a current
zero price. The hosted documentation endpoint was unavailable in this recheck, so the
unpublished-price conclusion remains based on the accepted source set and reviewed SDK boundary.

### Mistral

All 40 current models have offers: 39 numeric and one free-only. The accepted partition has no
blocking raw. The [public API page](https://mistral.ai/pricing/api/) was rechecked; no new
base-price gap was established. This is not a claim that every private deployment or
enterprise contract is represented.

### Ollama

236 unknowns split into 224 Library-only local identities and 12 Cloud identities.
The Cloud gaps are `deepseek-v4-flash`, `deepseek-v4-pro:0813`, `gemma4`, `gemma4:31b`,
`glm-5.1`, `gpt-oss`, `gpt-oss:120b`, `gpt-oss:20b`, `mistral-large-3:675b`,
`nemotron-3-nano`, `nemotron-3-nano:30b`, and `nemotron-3-super`.
An unpriced exact tag cannot inherit a family card without an official equivalence.

Two priced Cloud models have Base/Peak variants without a compiled selector schedule.
The central pricing page supplies the previously missed Off-Peak rule and five exact missing-model
rates. Family/tag binding and the schedule's canonical representation still need implementation.
See [Ollama collection rules](providers/ollama.md). The earlier family-page-only recheck did not
establish that no other official pricing source existed.

### OpenAI

Eight unknowns are four Daybreak aliases (with and without the `gpt-` prefix),
`gpt-4-1106-preview`, `gpt-4o-tts`, `gpt-5.4-cyber`, and `sora-2`.
The fresh [pricing Markdown](https://developers.openai.com/api/docs/pricing.md) no longer
contains the exact alias-to-underlying-model sentence required by `openAiPricingAliases`.
Those aliases therefore remain unresolved; their historical targets are not current proof.
The other exact IDs lack current bound rows in the accepted source set.

The former tier recognizer accepted `Fast mode` but skipped current `Fast` and new `Ultrafast`
tables. Both are now collected, with optional first-party guide companions establishing the
EU Fast exclusions and Ultrafast's US-residency/global-processing restriction. If those
scope contracts are unavailable, the affected amounts remain raw while other tiers survive.
Served-tier normalization accepts both historical `priority` and current `fast` values.
Ninety baseline raw variants are resolved card-versus-page conflicts, not missing tiers.
The exact GPT-Rosalind Research billing notice now bounds its prices from 2026-10-05 with
approved-internal-research eligibility; no pre-start free rate is inferred.

### TypeSafe AI

The one current model has both numeric input and explicit zero output rates. The
[official model page](https://docs.typesafe.ai/models) confirms USD 0.042 per million input
tokens and free output. No missing base amount or blocking raw was found.

### Vercel AI Gateway

All 395 current models have numeric offers, with no model-scoped blocking raw.
One service gap remains: Tako data-export cost depends on each result card's
`content.export_pricing` and requested rows. A static book cannot supply a universal amount.
The [provider/model documentation](https://vercel.com/docs/ai-gateway/models-and-providers)
does not make one route's price a guarantee for every possible provider choice.

### Vertex / Gemini Enterprise Agent Platform

Four identities are unknown: Claude Opus 4, Opus 4.1, Sonnet 4, and Gemini 3.8 Live.
The [live pricing page](https://cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing.html)
publishes “Gemini 3.8 Live API” rates. The repaired exact label normalization now binds
`gemini-3.8-live` without changing model versions or broadening other names.

The baseline has 21 blocking variants: nine Claude cache conflicts, eight raw embedding variants,
three GLM raw variants, and one grounding allowance. The live HTML itself contains inconsistent
cache labels, including Opus 4.5 regional “1h Cache Write” rows at both 11.00 and 5.50,
and Batch Cache Hit labels with write-like amounts. The source needs a scoped clarification;
do not resolve these by silently borrowing another region's rate.

The four embedding books retain “Price / 1,000 count” as unknown applicability because “count”
does not independently establish tokens versus characters. Three GLM models already have
numeric token rates; the repaired abbreviated-header recognizer prevents the generic labeled
pass from also emitting raw duplicates. The embedding units remain unresolved: older indexed
snippets mention tokens/characters, but the current fetched page says only `count`, so those
snippets cannot establish a current tariff denominator. One Live grounding allowance remains
unbound to an exact model scope.
The older DeepSeek-OCR gap from the previous assessment is not present in this snapshot.

The web reader failed on this page; a direct HTTPS fetch succeeded and its HTML was inspected
and replayed through the existing parser.

### xAI

Only `grok-voice-think-fast-2.0@1.0` lacked a model price in the baseline. The
[official pricing page](https://docs.x.ai/developers/pricing) already lists the exact base name
with audio-session and text-input charges. The new combined “Model or mode / Cost” layout
previously failed the realtime Voice recognizer because its hourly equivalence no longer repeated
the word `audio`. The repaired parser accepts both forms and retains the actual per-minute
audio and per-request text rates for each published region.

The image summary conflict has an accepted exact-resolution winner and is informational.
Batch exclusions and quantity-contract drift remain separate partial-coverage diagnostics.

## Remaining gaps and acceptance criteria

1. Integrate the confirmed Ollama central table and DashScope domestic model-card supplements.
   Keep subscription prose excluded locally; preserve each tariff's currency and billing scope.
2. Seek or explicitly retain unresolved source semantics: Vertex cache labels/count units,
   Databricks denomination and future schedule precedence, missing Priority amounts, and HF
   exact routed prices.
3. Require exact first-party evidence for still-unbound identities, including Titan's old
   embedding ID, Azure partner/version rows, DashScope regional IDs, and Ollama Cloud tags.
   Hardware-time billing without a model/hardware mapping and downloadable artifacts cannot
   be repaired by inventing token prices.
4. Report Library/artifact identities, deprecated identities, missing hosted amounts, and
   missing selectors separately. Do not turn the aggregate unknown count into a hosted-service
   failure percentage.

A repair should verify the exact previously missing model/route/tier/component and retain safe
siblings. Passing whole-provider publication or finding any numeric rate is insufficient.
Rate-source failures, usage-input failures, and informational superseded values must remain
distinguishable. The implemented repairs above have source replay and fixture coverage; a future
explicit live collection is required to measure and publish the resulting full-catalog coverage.
