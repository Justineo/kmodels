# Price-book completeness assessment

Status: current accepted snapshot, 2026-09-11

## Evaluation boundary

This assessment asks whether the **collected price book**, supplied with accurate quantities and
the selected model, route, region, tier, modality, time, and other applicability values, can
reconstruct the public cost. Where an allowance applies, its already-consumed quantity is also an
input. Missing response fields, telemetry mappings, streaming usage, log correlation, and runtime
capture are not pricing gaps in this assessment. A missing amount, component, applicability rule,
or published allowance remains a gap even when all quantities are known.

Amounts are evaluated in their published denomination. Databricks DBU is not silently converted
to USD. Private discounts, taxes, account settlement, capacity procurement, retained storage, and
local model deployment remain outside the request-rate boundary in
[Commercial topology](commercial-topology.md).

The shared working tree includes the pricing normalization and catalog/resilience changes,
including native Perplexity. This assessment uses a new `vp run collect`, not a compilation of old
parsed inputs. The current snapshot includes the session, geography, search, and grounding parser corrections
documented in the [pricing research](pricing-research.md).

## Accepted result

- Snapshot: `2026-09-11T05:50:05.136Z`.
- Catalog version: `4186a13c9b50ea665b6c9075063cee2e6205d255bc2d9b7a5c0b36a024ba5b24`.
- All 19 catalog and pricing partitions were accepted; none retained old pricing or withheld pricing.
- 3,633 catalog models, including 3,441 non-retired models.
- 1,600 books: 1,536 model books and 64 provider-resource books; 2,111 offers.
- 13,996 normalized rate variants, 12 allowance variants, and two quantity contributions.
- 39 raw variants affect base prices or allowances; 144 more are informational.

The refresh report's `publication: complete` means every provider publication succeeded. It does
not mean every model, route, or service has a complete price. The result remains an incomplete
universal request-cost book, with both explicit raw gaps and omissions outside canonical raw.

## Model coverage

Counts use exact non-retired catalog identities, not model families or pricing rows. “Book” includes
numeric, free, unpublished, and raw-only offers. “Numeric” means at least one numeric rate, not
complete coverage of every route or component. “Blocking raw” counts models, not raw variants,
and can overlap Numeric. “Unknown” excludes explicit `not_applicable` dispositions.

| Provider       | Current models |      Book |   Numeric |   Unknown | Blocking raw models |
| -------------- | -------------: | --------: | --------: | --------: | ------------------: |
| amazon-bedrock |            115 |       111 |       111 |         4 |                   0 |
| anthropic      |             14 |        13 |        13 |         1 |                   0 |
| azure          |            229 |       159 |       159 |        70 |                   0 |
| cerebras       |             15 |         2 |         2 |        13 |                   0 |
| cohere         |             37 |        16 |         8 |        21 |                   0 |
| dashscope      |            375 |       355 |       355 |        20 |                   0 |
| databricks     |             59 |        59 |        59 |         0 |                   3 |
| deepseek       |              4 |         4 |         4 |         0 |                   0 |
| gemini         |             49 |        38 |        38 |        11 |                   0 |
| huggingface    |          1,640 |       142 |       134 |     1,498 |                  11 |
| kimi           |              4 |         4 |         4 |         0 |                   0 |
| llama          |             48 |         3 |         0 |        45 |                   0 |
| mistral        |             39 |        39 |        38 |         0 |                   0 |
| ollama         |            248 |        14 |        14 |       234 |                   0 |
| openai         |             92 |        85 |        84 |         5 |                   0 |
| perplexity     |              8 |         8 |         8 |         0 |                   0 |
| vercel         |            369 |       369 |       361 |         0 |                   0 |
| vertex         |             74 |        70 |        70 |         4 |                   1 |
| xai            |             22 |        22 |        22 |         0 |                   0 |
| **Total**      |      **3,441** | **1,513** | **1,484** | **1,926** |              **15** |

OpenAI has two additional `not_applicable` models. The 1,513 models with books partition into
1,484 with numeric rates, 17 free-only models, four unpublished-only models, and eight raw-only
models. A numeric model can still contain an incomplete sibling route.

The unknown denominator needs product context:

- Hugging Face: 1,459 of the 1,498 unpriced models have an `hf-inference` route; 39 have other
  unpriced media or specialized routes. Even with exact compute duration, the snapshot lacks a
  bound hardware price for `hf-inference`. This is a rate-book gap, independent of runtime capture.
- Ollama: 221 unpriced identities are Library-only local models outside hosted pricing. The other
  13 are Cloud identities without a bound rate card, including exact tagged variants.
- Meta: 45 identities are model artifacts outside Meta-operated request pricing. Its three
  admitted hosted identities explicitly have unpublished rates.
- The aggregate 1,926 unknown count is not a hosted-price completeness percentage. At least the
  266 Library-only / artifact identities above are outside provider-billed inference pricing.

## Coverage of pricing dimensions

“Present” means actual accepted variants or rules, not schema capacity. The model coverage and
omissions apply independently; support does not imply every model has an offer.

| Dimension or component             | Accepted support                                                                                               | Remaining limitation                                                                                     |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Input / output tokens              | Present across 18 providers with numeric token books                                                           | Exact model gaps in the coverage table                                                                   |
| Cache read                         | Present across 14 providers                                                                                    | HF routed cache prices are not published in this book; some source scopes remain unresolved              |
| Cache write and retention          | Seven providers; explicit Anthropic 300/3,600-second TTLs and Databricks default/1h alternatives               | Do not infer a default TTL from a named option                                                           |
| Long context                       | Numeric bands in OpenAI, Gemini, Vertex and others; Databricks named short/long bands                          | Current Claude 4.6+ uses the same rate across its full context window; absence of a premium is not a gap |
| Service tier / Batch               | Standard, Priority/Fast, Flex and Batch where published                                                        | Cerebras Batch is explicitly unpublished; availability is provider-specific                              |
| Anthropic Fast                     | Opus 5 and Opus 4.8 Fast rates, cache modifiers and US geography multiplier                                    | Respect model-specific availability                                                                      |
| Regional prices                    | Anthropic geography; OpenAI regional-processing uplift; Vertex global/non-global; Azure and Bedrock regions    | Explicit Fast × EU `not_supported`; other provider/model availability remains scoped                     |
| Text / image / audio / video       | Separate rates and units where published; Gemini image-output tokens present                                   | Databricks image conflicts; unpriced media IDs and routes                                                |
| Document input / OCR               | Image-input billing or page rates where published; Vertex Mistral OCR equivalence resolved                     | Vertex DeepSeek-OCR page alternative remains raw                                                         |
| Thinking / reasoning               | Ordinary output rates include reasoning where specified; Perplexity has separate reasoning and citation rates  | No duplicate surcharge is invented for reasoning already included in output                              |
| Web search                         | Native provider services plus Vercel Perplexity, Exa, Tako and Parallel                                        | Tako export depends on the result card’s variable price                                                  |
| File search / retrieval            | OpenAI and Azure File Search, xAI collection/attachment search, Mistral retrieval                              | Retained storage is outside request-rate scope                                                           |
| Code execution                     | Anthropic standalone/included modes, minimum and allowance; OpenAI containers; Azure, Mistral and xAI services | No general claim for unpriced orchestration products                                                     |
| Grounding                          | Gemini and Vertex Search/Maps with shared allowances; Vertex enterprise, data and Claude search                | Respect query versus grounded-prompt units and shared consumption                                        |
| Reranking                          | Cohere, Bedrock, Azure and Vercel rates                                                                        | Exact Cohere model coverage is partial                                                                   |
| Perplexity                         | Eight native model books, seven service books; all five Deep Research price components                         | Third-party Agent/Router prices are outside the native model partition                                   |
| Audio duration / TTS characters    | Second-based rates across nine providers; character rates across six                                           | GPT-Live active time is priced separately from backend model/tool usage                                  |
| Images / searches / container time | Image, pixel, request, search-unit, event, second and session prices                                           | No universal image or search unit is assumed                                                             |
| Shared allowances / minimums       | Gemini and Vertex grounding pools; Anthropic container allowance; OpenAI and Anthropic minimum rules           | Unrecognized sharing rules remain raw; shared pools are not per-model grants                             |
| Bedrock logs / interrupted streams | Excluded from this evaluation                                                                                  | No price-book gap when correct quantities are supplied                                                   |

Anthropic's current [pricing page](https://platform.claude.com/docs/en/about-claude/pricing)
confirms standard pricing across the 1M context window and the two supported Fast models. The
accepted Fable 5.1 cache-read amount is correct: its model-specific 0.025× multiplier is not a
missing price, despite a redundant generic-multiplier diagnostic.

## Remaining canonical raw prices

| Provider / family                         | Variants |                         Affected current models | Effect                                                              |
| ----------------------------------------- | -------: | ----------------------------------------------: | ------------------------------------------------------------------- |
| Databricks Gemini image DBU / USD overlap |       24 |                                               2 | Conflicting denomination and applicability                          |
| Databricks Grok 4.6 Priority              |        1 |                                               1 | Exact DBU amount unpublished                                        |
| Hugging Face exact route amounts          |       11 |                                              11 | Exact route price or denomination unresolved                        |
| Vertex DeepSeek-OCR                       |        1 |                                               1 | Page alternative lacks independent billing-token equivalence        |
| Vercel Tako export                        |        1 |                                               — | Result-specific variable surcharge; applies when exporting contents |
| Vertex Live grounding allowance           |        1 |                          1 service-scoped model | Published Flash allowance does not explicitly bind the Live variant |
| **Total**                                 |   **39** | **15 model-book gaps plus shared-service gaps** | Includes one unresolved allowance                                   |

### Databricks image overlap

The models are `databricks-gemini-3-1-flash-image` and `databricks-gemini-3-pro-image`. Each has
four affected meters: input text, input image, output text and output image. For each meter the
conflict contains two post-promotion DBU variants and one delegated USD variant: 2 × 4 × 3 = 24.

The [partner pricing table](https://www.databricks.com/product/pricing/proprietary-foundation-model-serving)
publishes DBU prices and a regional uplift. The
[model documentation](https://docs.databricks.com/aws/en/machine-learning/foundation-model-apis/supported-models)
also delegates these exact global endpoints to Google pass-through prices. Both paths enter the
same `pay-per-token` offer without a reviewed precedence rule or disjoint billing choice. The
connected overlap is correctly downgraded instead of summing DBU and USD.

Promotional DBU variants remain numeric. Sixteen raw variants start on `2027-02-01`; eight USD
observations have no date bound and have `promotion=false`. All 24 do not affect every request
today, but the book cannot describe complete billing alternatives or the future schedule until
this source interaction is resolved.

The [research](pricing-research.md) establishes DBU-to-currency calculation and explains current
promotional equivalence conditionally, but not future schedule precedence.

`databricks-grok-4-6` separately has a Priority unknown: its support contract establishes a premium
tier, but no exact DBU amount. Sibling premiums and xAI USD prices are insufficient evidence.

### Hugging Face: each unresolved route

| Hub model                                    | Route        | Missing price evidence                                     |
| -------------------------------------------- | ------------ | ---------------------------------------------------------- |
| `CohereLabs/aya-vision-32b`                  | cohere       | Production input/output rates                              |
| `CohereLabs/command-a-translate-08-2025`     | cohere       | Production input/output rates                              |
| `CohereLabs/c4ai-command-r7b-arabic-02-2025` | cohere       | Exact Arabic variant rates                                 |
| `CohereLabs/tiny-aya-water`                  | cohere       | Exact route input/output rates                             |
| `CohereLabs/tiny-aya-global`                 | cohere       | Exact route input/output rates                             |
| `CohereLabs/tiny-aya-earth`                  | cohere       | Exact route input/output rates                             |
| `CohereLabs/tiny-aya-fire`                   | cohere       | Exact route input/output rates                             |
| `CohereLabs/command-a-reasoning-08-2025`     | cohere       | Production input/output rates                              |
| `Qwen/Qwen3.8-2.4T-A95B`                     | fireworks-ai | Exact on-demand-only backend has no serverless token price |
| `deepseek-ai/DeepSeek-V4-Flash-0731`         | scaleway     | HF route denomination; native EUR cannot be relabeled USD  |
| `zai-org/GLM-4.6V-Flash`                     | zai-org      | HF paid classification conflicts with native free pricing  |

Trial access is not a production zero price. A similarly named Fireworks backend is not an exact
join. These gaps are independent of the ability to obtain usage.

### Vertex DeepSeek-OCR

`deepseek-ocr-maas` retains known token rates and one unresolved page alternative. Its
[model page](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/maas/deepseek/deepseek-ocr)
does not provide the explicit page-to-billing-token relation supplied for Mistral OCR. Deriving
that relation from the ratio of the two prices would be circular. The
[research](pricing-research.md) also compares LiteLLM and Bifrost: their differing calculations
do not establish a Google page-billing contract.

## Corrected source omissions

The live output now includes GPT-Live session time, the explicit GPT-6 Astra Fast × EU
`not_supported` state, Tako/Parallel search rates and the Tako variable-export exception, and
Vertex combined Search/Enterprise scope with reviewed shared grounding allowances. Regression
fixtures cover the actual table/prose structures. Source evidence and calculation limits are
recorded in the [pricing research](pricing-research.md).

## Remaining omissions outside canonical raw

Raw count alone misses absent books and incomplete service scopes. These must also be considered
when evaluating a total cost.

1. **Exact model-to-price binding.** Azure has 70 current unpriced models. Its Retail source
   reports 5,786 unbound rows, 2,034 version ambiguities and 14 unsupported meter/unit rows;
   these are source-row counts, not missing-model counts. Bedrock has four unpriced current
   identities, Gemini API 11, and Vertex four. Vertex's current page publishes Gemini 3.7/3.8 Flash
   rows, yet both exact catalog models lack a model book. Their dated promotion labels need a
   binding review. Other identity gaps must not inherit sibling prices.
2. **Published scope diagnostics.** DashScope reports two cache-model scope gaps and unbound
   Beijing web/image-search prices. xAI reports Batch exclusion and image-generation-tool scope
   drift. These do not erase known rates, but prevent exhaustive mechanism/component coverage
   claims. Kimi's informational promotion/trigger notes do not prove future schedules.

Anthropic's `cache_price_conflict` is different: its accepted exact Fable 5.1 rate matches the
model-specific official exception. Missing usage locators, source protocol capability drift and
that redundant generic check are not counted as absent prices. Upstream router gaps resolved by
exact native overlays are not counted twice.

## Accepted provider-resource inventory

These 64 books supplement model rates; their presence does not establish universal model/tool
compatibility. Fine-tuned inference is distinct from excluded training jobs.

| Provider       | Books | Components                                                                                                         |
| -------------- | ----: | ------------------------------------------------------------------------------------------------------------------ |
| Amazon Bedrock |     5 | Two Nova grounding books, Guardrails, web search, prompt routing                                                   |
| Anthropic      |     2 | Web search, code execution                                                                                         |
| Azure          |     3 | Computer use, Responses File Search, Responses Code Interpreter                                                    |
| Cerebras       |     1 | Batch, explicitly `not_published`                                                                                  |
| DashScope      |     3 | Web search, image search, text-to-image search                                                                     |
| Gemini         |     2 | Google Search and Maps, with seven allowance pools                                                                 |
| Kimi           |     3 | Web search, files, Formula                                                                                         |
| Mistral        |     5 | Web search, premium news, code execution, image generation, library retrieval                                      |
| OpenAI         |    14 | Nine fine-tuned inference books, search, File Search, containers, two fixed search-content contributions           |
| Perplexity     |     7 | Search API, four Agent tools, sandbox session and sandbox search                                                   |
| Vercel         |     6 | Native web/Maps search, Perplexity Search, Exa Search, Tako Search, Parallel Search                                |
| Vertex         |     5 | Google Search, Maps, Enterprise grounding, grounded generation, Claude search; four current shared allowance pools |
| xAI            |     8 | Web/X/collection/attachment search, code execution, STT, TTS, response-policy charge                               |

Meta's three hosted model books and Mistral `mistral-ocr-2503@25.03` are explicitly unpublished.
They are represented price states but cannot produce numeric public totals, separate from
Cerebras' unpublished provider-level Batch service.

## Arithmetic checks against accepted data

These examples use rates read from the refreshed canonical file, independent of acquisition paths:

- Perplexity Deep Research: 10,000 input, 2,000 answer-output, 1,000 citation and 3,000 reasoning
  tokens plus four search queries cost $0.020 + $0.016 + $0.002 + $0.009 + $0.020 = **$0.067**.
- OpenAI eligible 1-GiB container: two billed minutes invoke the five-minute minimum, producing
  **$0.0075**; eight billed minutes produce **$0.012**.
- Vercel Exa: one search requesting 15 results costs $0.007 + 5 × $0.001 = **$0.012** for search,
  before separately priced model tokens.

These positive cases do not imply omitted services or unpriced models are zero-cost.

## Informational raw inventory

| Provider       | Variants | Purpose                                                                         |
| -------------- | -------: | ------------------------------------------------------------------------------- |
| amazon-bedrock |        3 | Price-list observations superseded by Marketplace rates                         |
| huggingface    |        3 | Superseded Featherless snapshots                                                |
| kimi           |       13 | Search/Formula trigger warnings and promotion-end information                   |
| openai         |       93 | Superseded model-card observations                                              |
| vertex         |       31 | Grounding billing clauses and malformed Claude suffix beside valid scoped rates |
| xai            |        1 | Superseded image summary                                                        |
| **Total**      |  **144** | Excluded from commercial equality and base-price completeness                   |

## Validation and reproduction

Evidence is the accepted [catalog](../data/catalog.json),
[canonical pricing envelope](../data/pricing.json.gz),
[parsed pricing compilation inputs](../data/pricing-inputs.json.gz) and
[refresh report](../data/refresh-summary.json). Model counts filter `status != retired`; raw counts
sum raw-term variants and raw variants attached to normalized terms, rather than counting
observations or source-extraction diagnostics. Source reconciliation and provider-resource scopes
are inspected separately because omissions may never reach canonical raw.

`vp install --frozen-lockfile`, `vp check`, `vp test --run` (762 tests),
`vp run collect:fixtures` (357 tests), and `vp run build` passed. Data and static asset packs were
regenerated; deployment was not performed. Passing structural tests does not establish pricing
completeness.
