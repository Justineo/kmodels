# Pricing

| Model                                      | Base Input Tokens | 5m Cache Writes | 1h Cache Writes | Cache Hits & Refreshes | Output Tokens |
| ------------------------------------------ | ----------------- | --------------- | --------------- | ---------------------- | ------------- |
| Claude Fable 5                             | $10 / MTok        | $12.50 / MTok   | $20 / MTok      | $1 / MTok              | $50 / MTok    |
| Claude Mythos 5 (limited availability)     | $10 / MTok        | $12.50 / MTok   | $20 / MTok      | $1 / MTok              | $50 / MTok    |
| Claude Opus 4.8                            | $5 / MTok         | $6.25 / MTok    | $10 / MTok      | $0.50 / MTok           | $25 / MTok    |
| Claude Opus 4.7                            | $5 / MTok         | $6.25 / MTok    | $10 / MTok      | $0.50 / MTok           | $25 / MTok    |
| Claude Sonnet 5 through August 31, 2026    | $2 / MTok         | $2.50 / MTok    | $4 / MTok       | $0.20 / MTok           | $10 / MTok    |
| Claude Sonnet 5 starting September 1, 2026 | $3 / MTok         | $3.75 / MTok    | $6 / MTok       | $0.30 / MTok           | $15 / MTok    |

| Model                             | Input      | Output     |
| --------------------------------- | ---------- | ---------- |
| Claude Opus 4.8 / Claude Opus 4.7 | $10 / MTok | $50 / MTok |

| Model                                      | Batch input  | Batch output  |
| ------------------------------------------ | ------------ | ------------- |
| Claude Fable 5                             | $5 / MTok    | $25 / MTok    |
| Claude Mythos 5 (limited availability)     | $5 / MTok    | $25 / MTok    |
| Claude Opus 4.8                            | $2.50 / MTok | $12.50 / MTok |
| Claude Opus 4.7                            | $2.50 / MTok | $12.50 / MTok |
| Claude Sonnet 5 through August 31, 2026    | $1 / MTok    | $5 / MTok     |
| Claude Sonnet 5 starting September 1, 2026 | $1.50 / MTok | $7.50 / MTok  |

Claude Fable 5, Claude Mythos 5, Claude Mythos Preview, Claude Opus 4.8, Opus 4.7, and Sonnet 5 include the full [1M token context window](https://example.test).

| Model           | Tool choice | Tool use system prompt token count |
| --------------- | ----------- | ---------------------------------- |
| Claude Opus 4.8 | auto        | 290 tokens                         |
| Claude Opus 4.7 | auto        | 675 tokens                         |
| Claude Sonnet 5 | auto        | 354 tokens                         |

Prompt caching uses the following pricing multipliers relative to base input token rates:

| Cache operation      | Multiplier             | Duration                             |
| -------------------- | ---------------------- | ------------------------------------ |
| 5-minute cache write | 1.25x base input price | Cache valid for 5 minutes            |
| 1-hour cache write   | 2x base input price    | Cache valid for 1 hour               |
| Cache read (hit)     | 0.1x base input price  | Same duration as the preceding write |

For Claude 4.6 and later models, specifying US-only inference through the `inference_geo` parameter incurs a 1.1x multiplier on all token pricing categories.

Each organization receives **1,550 free hours** of usage per month. Additional usage beyond 1,550 hours is billed at **$0.05 USD per hour, per container**.

Web search is available for **$10 per 1,000 searches**.

Web fetch usage has **no additional charges** beyond standard token costs.

| SKU             | Rate                   | Metering                  |
| --------------- | ---------------------- | ------------------------- |
| Session runtime | $0.08 per session-hour | `running` status duration |

| Concept       | Details                                                  |
| ------------- | -------------------------------------------------------- |
| **CCU price** | $0.01 per CCU (fixed; discounts apply during conversion) |

| Concept       | Details                                                  |
| ------------- | -------------------------------------------------------- |
| **CCU price** | $0.01 per CCU (fixed; discounts apply during conversion) |

Volume discounts may be available for high-volume users. These are negotiated on a case-by-case basis.
