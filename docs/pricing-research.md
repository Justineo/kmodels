# Pricing evidence and calculation decisions

Status: current, researched 2026-09-11

This investigation covers Databricks DBU/USD image prices and Grok Priority, Vertex DeepSeek-OCR
page billing, and the sources behind four corrected extraction gaps. It assumes accurate usage
quantities and selectors are supplied. Runtime telemetry acquisition is not a completeness test.
Production rates still require first-party evidence; third-party implementations and discussions
are useful cross-checks, not automatic pricing authorities.

## Databricks: how DBU and currency actually relate

The calculation is established. For each separately billable token partition:

```text
DBU = sum(tokens / 1,000,000 × applicable DBU-per-million-token rate)
public currency cost = DBU × effective currency price per DBU for the matching SKU
```

The DBU rate must include the applicable model, token type, geography, tier and promotion. The
currency multiplier must match the SKU, cloud, currency and effective date. A private contract or
currency conversion can subsequently change settlement. DBU and USD observations of that same
charge must not be added. Databricks Labs' [FMAPI token pricing guide](https://databrickslabs.github.io/lakemeter-oss/user-guide/pricing/fmapi-tokens/)
explicitly implements this conversion and its [proprietary model guide](https://databrickslabs.github.io/lakemeter-oss/user-guide/fmapi-proprietary/)
separates input, output and cache quantities. This is stronger evidence than a generic marketing
claim that model serving starts at a certain DBU price.

For an account-specific public-list calculation, Databricks documents
[`system.billing.list_prices`](https://docs.databricks.com/aws/en/admin/system-tables/pricing).
`pricing.default` is the base estimate; `pricing.promotional` is a temporary public price;
`pricing.effective_list.default` resolves the currently applicable list/promotion price. Select
the matching SKU/cloud/currency and validity interval. Apply each promotion once at the layer
where it is defined: a token-rate discount and a SKU-price discount are not interchangeable.

### Why the two Gemini image schedules appear equivalent today

The reviewed [Databricks Labs pricing export](https://github.com/databrickslabs/lakemeter-oss/blob/1a8871e7577704d9a933c7686889a6383b20e499/backend/static/pricing/dbu-rates.json)
contains `GEMINI_MODEL_SERVING` at $0.07/DBU across its 102 published cloud/region/tier rows. The
[manifest](https://github.com/databrickslabs/lakemeter-oss/blob/1a8871e7577704d9a933c7686889a6383b20e499/backend/static/pricing/manifest.json)
dates that export to August 27, 2026. It is a dated planning snapshot, not proof of every current
account price. Its extraction uses base `pricing.default` values, which is another reason not to
substitute it for an effective-price lookup.

The current [proprietary serving table](https://www.databricks.com/product/pricing/proprietary-foundation-model-serving)
lists Gemini 3.1 Flash Image at 8.929 DBU/M input tokens, 53.571 DBU/M text output and 1,071.43
DBU/M image output. Its marked promotion gives 20% off through January 31, 2027, and regional
processing adds 10%. At the exported $0.07/DBU price, the global promotional arithmetic is:

| Meter               | DBU/M × 0.8 × $0.07 | Delegated Google USD/M |
| ------------------- | ------------------: | ---------------------: |
| Text or image input |           $0.500024 |                  $0.50 |
| Text output         |           $2.999976 |                  $3.00 |
| Image output        |           $60.00008 |                 $60.00 |

The small differences follow from the displayed DBU precision. The Google figures come from the
exact image section linked by the [Databricks supported-model documentation](https://docs.databricks.com/aws/en/machine-learning/foundation-model-apis/supported-models)
to [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing). **Inference:** promotion plus
SKU monetization explains the apparent DBU/USD disagreement for this current global scenario.
It supports treating these as two descriptions of one charge, not additive charges.

It does not establish a timeless identity. Without the 20% promotion, those same DBU figures
convert to approximately $0.62503, $3.74997 and $75.0001 per million tokens. The model guide's
pass-through wording does not independently establish which future schedule wins. Kmodels
therefore retains the unresolved cross-denomination overlap, rather than applying an undated
universal multiplier or deleting future prices. Current promotional DBU variants remain usable.

### Community cross-check and remaining evidence

A [Databricks user discussion about cached-token costs](https://www.reddit.com/r/databricks/comments/1te8ij7/finding_databricks_cached_token_usage_count_andor/)
also separates token counts, DBU rates and SKU monetization, but does not supply a verifiable
Gemini image invoice or establish post-promotion precedence. No reviewed forum post resolved
that specific future overlap. The remaining evidence would be a Databricks clarification of the
pass-through schedule's validity/precedence or a matching effective SKU schedule; it is not a
missing mathematical formula.

## Databricks Grok 4.6 Priority

The [Priority contract](https://docs.databricks.com/aws/en/machine-learning/foundation-model-apis/priority-mode)
lists Grok 4.6 and says Priority has a premium. The inspected public Databricks pricing table
publishes its Standard amounts but no exact Grok Priority amount or multiplier. Eligibility
alone cannot determine a price.

Research beyond that page did not produce a Databricks-specific Priority tariff:

- The [Databricks Labs proprietary-rate dataset](https://github.com/databrickslabs/lakemeter-oss/blob/1a8871e7577704d9a933c7686889a6383b20e499/backend/static/pricing/fmapi-proprietary-rates.json)
  has no Grok row in the inspected snapshot, so it cannot fill this gap.
- [Pass.io's Grok comparison](https://pass.io/index/xai/grok-4-6) includes a Databricks Standard
  comparison and a separate xAI Priority route. The latter is not Databricks billing evidence.
- [xAI's own pricing](https://docs.x.ai/developers/pricing) publishes a 2× Priority multiplier,
  including after cache discounts. It establishes xAI's tariff only. The inspected
  [Bedrock Grok model card](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-xai-grok-4-6.html)
  marks Priority unsupported, demonstrating why host-specific support and pricing must be checked.
- Searches of Databricks community discussions, Reddit and public GitHub material did not locate
  an attributable Databricks Grok Priority billed example or model-qualified premium.

The decision remains `unknown_amount` for this exact tier. A 2× assumption would be a scenario
estimate, not a collected price. This is a bounded negative research result, not a claim that no
private contract or unpublished price exists.

## Vertex DeepSeek-OCR: page alternative is not yet a billing contract

The [Google pricing page](https://cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing.html)
publishes $0.30/M input tokens with $0.0003/page in parentheses, and $1.20/M output tokens with
$0.00012/page in parentheses. The exact `.html` rendering matters: other renderings inspected
during research omitted the parentheticals. The
[model card](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/maas/deepseek/deepseek-ocr)
does not explain whether those are fixed billed tokens per page, alternative billing or examples.

The amount ratios imply 1,000 input and 100 output tokens per page **if** they are equivalent
fixed tariffs. That conditional arithmetic does not establish that Google bills every page at
those quantities. DeepSeek's [own model documentation](https://github.com/deepseek-ai/DeepSeek-OCR)
lists multiple visual-token modes and dynamic crops, so a fixed 1,000-token page is not an
intrinsic tokenizer property. Nor does that model implementation establish Google's billing.

Third-party implementations disagree in a way that prevents using consensus as a substitute:

| Source                                                                                                                                                                                                                                                                       | Inspected behavior                                                                      | Evidentiary limit                                                                                                       |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| [LiteLLM rate registry](https://github.com/BerriAI/litellm/blob/7419a536ad6857165b28b9b545a62d5916f696d2/model_prices_and_context_window.json) and [calculator](https://github.com/BerriAI/litellm/blob/7419a536ad6857165b28b9b545a62d5916f696d2/litellm/cost_calculator.py) | Registry stores both token rates and $0.0003/page; OCR calculation uses pages × $0.0003 | Does not explain the $0.00012 output-page alternative or prove Google's policy                                          |
| [Bifrost calculator](https://www.getmaxim.ai/bifrost/llm-cost-calculator/provider/vertex_ai/model/deepseek-ocr-maas)                                                                                                                                                         | Displayed example adds $0.0003 input, $0.0012 output and $0.0003 OCR, totaling $0.0018  | An additive implementation differs from the page-only interpretation; no supporting Google billing contract is supplied |

Neither implementation independently verifies actual page billing. Forum and source searches
did not produce a Google invoice or contract that resolves the alternatives. Known token prices
remain normalized; the page rule remains bounded raw. Do not add page and token charges, drop the
published output alternative, or manufacture a fixed conversion from a ratio of prices.

## Corrected extraction and applicability

### OpenAI GPT-Live

The [official pricing page](https://developers.openai.com/api/docs/pricing) establishes $0.05 per
minute, billed by active second, with backend inference and tools charged separately. The parser
now accepts the reviewed session table, normalizes the amount to a second rate and binds duration
at session scope. A 90-second session costs $0.075 before backend/tool charges. Regression coverage
checks the exact arithmetic; no whole-minute rounding is introduced.

### OpenAI GPT-6 Astra Fast with EU data residency

The same pricing page explicitly forbids this combination. Kmodels now publishes a scoped
`not_supported` state, and Fast numeric variants require `eu_data_residency=false`. Standard
remains available under its own conditions. The exclusion is independent of regional-processing
uplift. Tests check that the unsupported and numeric scopes do not overlap and that removing the
source declaration does not invent a restriction.

### Vercel Tako and Parallel sources

The [search guide](https://vercel.com/docs/ai-gateway/models-and-providers/web-search.md) wraps price
sentences across Markdown quote lines. Normalizing quote prefixes and whitespace restores the
reviewed Tako $7/1,000 Instant/Fast and $12/1,000 Deep rates, Parallel $5/1,000 base and $1/1,000
excess-result rates, and the variable Tako export exception. Tests cover the wrapped first-party
prose and equivalent unwrapped text.

There is partially structured first-party evidence. The public [Tako page](https://vercel.com/ai-gateway/models/tako-search)
and [Parallel page](https://vercel.com/ai-gateway/models/parallel-search) embed tool objects with
`webSearchCallCost` values of 7 and 5. Their inspected records omit Tako Deep/export and Parallel
excess-result rules. Their zero input/output placeholders do not mean all tool activity is free.
The [model API](https://ai-gateway.vercel.sh/v1/models) did not list these generic tools as models,
and the [gateway SDK](https://github.com/vercel/ai/blob/main/packages/gateway/src/gateway-provider.ts)
exposes model metadata and tool schemas, not a complete search tariff. Therefore the corrected
guide parser remains necessary for full pricing semantics; migrating solely to those base-price
objects would still omit real charges.

### Vertex grounding

The [pricing page](https://cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing.html)
establishes combined Search/Enterprise scope and shared monthly/daily benefits. Extraction now
retains those clauses, maps the combined label to both services, and normalizes reviewed shared
allowances. Gemini 3 web services share one monthly query pool; Maps has its own pool. Reviewed
Flash/Flash-Lite daily Search prompt pools are shared across models, with a separate Pro pool.
The published Maps daily benefit is under Gemini 2.0 and is not inherited by 2.5 models. Four
pools bind current models. One Live 2.5 Flash allowance remains raw because the named Flash
eligibility does not explicitly bind that Live variant.
The allowance targets exact rate terms so a consumer cannot multiply a shared quota by the number
of models. Unknown sharing text remains raw; informational billing clauses remain visible.

The [completeness assessment](pricing-raw-audit.md) records the accepted live output and remaining
gaps. These fixes establish prices and applicability when their required quantities are supplied;
they do not turn an incomplete catalog into a universal invoice calculator.
