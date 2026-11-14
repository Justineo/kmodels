## Model pricing

The following table shows pricing for all Claude models:

| Model                                                                                                                                                                  | Base input tokens     | 5m cache writes | 1h cache writes | Cache hits and refreshes | Output tokens          |
| :--------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------- | :-------------- | :-------------- | :----------------------- | :--------------------- |
| Claude Fable 5.2                                                                                                                                                       | $8 / MTok             | $10 / MTok      | $16 / MTok      | $0.20 / MTok<sup>1</sup> | $40 / MTok             |
| Claude Mythos 5.2 ([limited availability](https://support.claude.com/en/articles/14604842))                                                                            | $8 / MTok             | $10 / MTok      | $16 / MTok      | $0.20 / MTok<sup>1</sup> | $40 / MTok             |
| Claude Fable 5.1                                                                                                                                                       | $10 / MTok            | $12.50 / MTok   | $20 / MTok      | $0.25 / MTok<sup>1</sup> | $50 / MTok             |
| Claude Mythos 5.1 ([limited availability](https://support.claude.com/en/articles/14604842))                                                                            | $10 / MTok            | $12.50 / MTok   | $20 / MTok      | $0.25 / MTok<sup>1</sup> | $50 / MTok             |
| Claude Fable 5                                                                                                                                                         | $10 / MTok            | $12.50 / MTok   | $20 / MTok      | $1 / MTok                | $50 / MTok             |
| Claude Mythos 5 ([limited availability](https://support.claude.com/en/articles/14604842))                                                                              | $10 / MTok            | $12.50 / MTok   | $20 / MTok      | $1 / MTok                | $50 / MTok             |
| Claude Opus 5.5                                                                                                                                                        | $4 / MTok             | $5 / MTok       | $8 / MTok       | $0.20 / MTok<sup>2</sup> | $20 / MTok             |
| Claude Opus 5                                                                                                                                                          | $5 / MTok             | $6.25 / MTok    | $10 / MTok      | $0.50 / MTok             | $25 / MTok             |
| Claude Opus 4.8                                                                                                                                                        | $5 / MTok             | $6.25 / MTok    | $10 / MTok      | $0.50 / MTok             | $25 / MTok             |
| Claude Opus 4.7                                                                                                                                                        | $5 / MTok             | $6.25 / MTok    | $10 / MTok      | $0.50 / MTok             | $25 / MTok             |
| Claude Opus 4.6                                                                                                                                                        | $5 / MTok             | $6.25 / MTok    | $10 / MTok      | $0.50 / MTok             | $25 / MTok             |
| Claude Opus 4.5                                                                                                                                                        | $5 / MTok             | $6.25 / MTok    | $10 / MTok      | $0.50 / MTok             | $25 / MTok             |
| Claude Opus 4.1 ([retired, except on Claude Models on Google Cloud (Google managed) and Bedrock](https://platform.claude.com/docs/en/about-claude/model-deprecations)) | $15 / MTok            | $18.75 / MTok   | $30 / MTok      | $1.50 / MTok             | $75 / MTok             |
| Claude Opus 4 ([retired, except on Claude Models on Google Cloud (Google managed)](https://platform.claude.com/docs/en/about-claude/model-deprecations))               | $15 / MTok            | $18.75 / MTok   | $30 / MTok      | $1.50 / MTok             | $75 / MTok             |
| Claude Sonnet 5.5                                                                                                                                                      | $2 / MTok             | $2.50 / MTok    | $4 / MTok       | $0.10 / MTok<sup>2</sup> | $10 / MTok             |
| Claude Sonnet 5                                                                                                                                                        | $2 / MTok<sup>3</sup> | $2.50 / MTok    | $4 / MTok       | $0.20 / MTok             | $10 / MTok<sup>3</sup> |
| Claude Sonnet 4.6                                                                                                                                                      | $3 / MTok             | $3.75 / MTok    | $6 / MTok       | $0.30 / MTok             | $15 / MTok             |
| Claude Sonnet 4.5                                                                                                                                                      | $3 / MTok             | $3.75 / MTok    | $6 / MTok       | $0.30 / MTok             | $15 / MTok             |
| Claude Sonnet 4 ([retired, except on Claude Models on Google Cloud (Google managed) and Bedrock](https://platform.claude.com/docs/en/about-claude/model-deprecations)) | $3 / MTok             | $3.75 / MTok    | $6 / MTok       | $0.30 / MTok             | $15 / MTok             |
| Claude Haiku 5.5 (for prompts up to 100,000 tokens)                                                                                                                    | $0.10 / MTok          | $0.125 / MTok   | $0.20 / MTok    | $0.01 / MTok             | $0.50 / MTok           |
| Claude Haiku 5.5 (for prompts over 100,000 tokens)                                                                                                                     | $0.50 / MTok          | $0.625 / MTok   | $1 / MTok       | $0.05 / MTok             | $2.50 / MTok           |
| Claude Haiku 4.5                                                                                                                                                       | $1 / MTok             | $1.25 / MTok    | $2 / MTok       | $0.10 / MTok             | $5 / MTok              |

_<sup>1 Cache hits and refreshes on Claude Fable 5.2, Claude Mythos 5.2, Claude Fable 5.1, and Claude Mythos 5.1 are priced at 0.025x the base input price.</sup>_

_<sup>2 Cache hits and refreshes on Claude Opus 5.5 and Claude Sonnet 5.5 are priced at 0.05x the base input price.</sup>_

_<sup>All other models use the standard 0.1x multiplier.</sup>_

_<sup>3 The $2/$10 per million input/output token pricing for Claude Sonnet 5, announced at launch as introductory pricing through August 31, 2026, is now the standard price. The previously scheduled increase to $3/$15 per million input/output tokens on September 1, 2026 will not occur.</sup>_

- **MTok:** Million tokens. $5 / MTok is $5 for every million tokens.
- **5m cache writes:** Writing a prompt prefix to the 5-minute prompt cache.
- **1h cache writes:** Writing a prompt prefix to the 1-hour prompt cache.
- **Cache hits and refreshes:** Reading a prompt prefix from the prompt cache, which also refreshes it.
- **Limited access:** Available only to organizations verified through Anthropic’s verification programs, such as the [Cyber Verification Program](https://support.claude.com/en/articles/14604842). To request access, apply to the program that covers your use case.
- **Retired:** May still be available on other cloud platforms. See [Model deprecations](https://platform.claude.com/docs/en/about-claude/model-deprecations) for more.

Claude 4.7 and later models and Claude Mythos Preview use a newer tokenizer that contributes to their improved performance on a wide range of tasks. This tokenizer produces approximately 30% more tokens for the same text. The exact increase depends on the content and workload shape. Claude Sonnet 4.6 and earlier models use the previous tokenizer.

## Claude in Microsoft Foundry pricing

[Claude in Microsoft Foundry](https://platform.claude.com/docs/en/build-with-claude/claude-in-microsoft-foundry) bills through the Azure Marketplace using Claude Consumption Units (CCUs). Anthropic rates your token usage in USD at standard per-model, per-feature rates, applies any negotiated discount, converts the result to CCUs at $0.01 USD per CCU, and reports the CCU quantity to the Azure Marketplace hourly. Your Azure bill shows a single CCU line item.

| Concept             | Details                                                                                                                                                                                                          |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Billing unit**    | Claude Consumption Unit (CCU)                                                                                                                                                                                    |
| **CCU price**       | $0.01 USD per CCU (fixed; discounts apply at token-to-CCU conversion, not to the CCU price)                                                                                                                      |
| **Conversion**      | Token usage rated in USD at standard per-model, per-feature rates (same as [Model pricing](https://platform.claude.com/docs/en/about-claude/pricing#model-pricing)), then converted to CCUs at $0.01 USD per CCU |
| **Billing cadence** | Hourly metering to the Azure Marketplace; monthly invoices                                                                                                                                                       |
| **Payment model**   | Arrears only (postpaid); no prepaid credits                                                                                                                                                                      |
| **Discounts**       | Applied as fewer CCUs metered                                                                                                                                                                                    |
| **Tax**             | Pre-tax metering; Azure Marketplace handles tax                                                                                                                                                                  |
| **Cost visibility** | Azure Cost Management shows aggregated CCU                                                                                                                                                                       |

**CCU:** Claude Consumption Unit. A CCU is a unit of measure used solely for Marketplace Platform invoicing. If Customer accesses the Services through certain Marketplace Platforms (for example, Claude Platform on AWS, Claude in Microsoft Foundry), usage is invoiced in Claude Consumption Units (“CCU”) rather than per MTok. One hundred (100) CCU represents $1.00 USD of fees owed for the Services, calculated at the applicable prices in the [API section of the Claude pricing page](https://claude.com/pricing#api), after application of any discounts.

### Inference geography

Deployments hosted on Azure can use the US Data Zone Standard deployment type, which keeps inference within the United States. This is equivalent to `inference_geo: "us"` on the Claude API and applies the same 1.1x pricing multiplier. See [Data residency](https://platform.claude.com/docs/en/manage-claude/data-residency) for details.

## Feature-specific pricing

### Fast mode pricing

[Fast mode](https://platform.claude.com/docs/en/build-with-claude/fast-mode) provides up to 2.5x higher output tokens per second at premium pricing. It is available for Claude Fable 5.2, Claude Opus 5.5, Claude Opus 5, and Claude Opus 4.8. Fast mode is in research preview for Claude Opus 5 and deprecated for Claude Opus 4.8.

Fast mode pricing applies across the full context window, including requests over 200k input tokens.

Fast mode is available on the Claude API (first-party). For Claude Opus 5.5, it is also available on [Claude Models on Google Cloud (Anthropic managed)](https://platform.claude.com/docs/en/build-with-claude/claude-models-on-google-cloud/anthropic-managed#billing) and on [Claude in Microsoft Foundry](https://platform.claude.com/docs/en/build-with-claude/claude-in-microsoft-foundry) for deployments hosted on Azure.

Fast mode for Claude Fable 5.2 is also available on [Claude Models on Google Cloud (Anthropic managed)](https://platform.claude.com/docs/en/build-with-claude/claude-models-on-google-cloud/anthropic-managed#billing).

Fast mode for Claude Fable 5.2 is also available on [Claude Models on Google Cloud (Google managed)](https://platform.claude.com/docs/en/build-with-claude/claude-models-on-google-cloud/google-managed). Google Cloud sets its prices there. See [Cloud platform pricing](https://platform.claude.com/docs/en/about-claude/pricing#cloud-platform-pricing).

Fast mode for Claude Fable 5.2 is also available on Claude in Microsoft Foundry for deployments hosted on Anthropic. See [Claude in Microsoft Foundry pricing](https://platform.claude.com/docs/en/about-claude/pricing#claude-in-microsoft-foundry-pricing).

Fast mode is also available for Claude Mythos 5.2 on the Claude API. [Availability of fast mode](https://platform.claude.com/docs/en/build-with-claude/fast-mode#feature-availability) lists every platform where Claude Mythos 5.2 has fast mode.

| Model                           | Input          | Output         |
| ------------------------------- | -------------- | -------------- |
| Claude Fable 5.2                | $16 USD / MTok | $80 USD / MTok |
| Claude Mythos 5.2               | $16 USD / MTok | $80 USD / MTok |
| Claude Opus 5.5                 | $8 USD / MTok  | $40 USD / MTok |
| Claude Opus 5 / Claude Opus 4.8 | $10 USD / MTok | $50 USD / MTok |

Fast mode pricing stacks with other pricing modifiers:

- [Prompt caching multipliers](https://platform.claude.com/docs/en/about-claude/pricing#prompt-caching) apply on top of fast mode pricing.
- [Data residency](https://platform.claude.com/docs/en/manage-claude/data-residency) multipliers apply on top of fast mode pricing.

Fast mode is not available with the [Batch API](https://platform.claude.com/docs/en/about-claude/pricing#batch-processing).

For more information, see [Fast mode](https://platform.claude.com/docs/en/build-with-claude/fast-mode).
