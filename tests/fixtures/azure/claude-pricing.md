# Pricing

## Model pricing

| Model           | Base input tokens | 5m cache writes | 1h cache writes | Cache hits and refreshes | Output tokens | Availability |
| --------------- | ----------------- | --------------- | --------------- | ------------------------ | ------------- | ------------ |
| Claude Opus 4.8 | $5 / MTok         | $6.25 / MTok    | $10 / MTok      | $0.50 / MTok             | $25 / MTok    | Public       |
| Claude Sonnet 5 | $2 / MTok         | $2.50 / MTok    | $4 / MTok       | $0.20 / MTok             | $10 / MTok    | Public       |
| Claude Opus 4   | $15 / MTok        | $18.75 / MTok   | $30 / MTok      | $1.50 / MTok             | $75 / MTok    | Retired      |

## Claude in Microsoft Foundry pricing

| Concept    | Details                                                                                                           |
| ---------- | ----------------------------------------------------------------------------------------------------------------- |
| Conversion | Token usage rated in USD at standard per-model, per-feature rates (same as [Claude API pricing](#model-pricing)). |

### Inference geography

Deployments hosted on Azure can use the US Data Zone Standard deployment type and apply the same 1.1x pricing multiplier.
