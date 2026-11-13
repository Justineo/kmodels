# @kmodels/pricing

Conditional unit-price lookup for Node and browsers. ESM, ES2023, with TypeScript declarations.
The package contains no provider prices and performs no usage or cost calculation.

```ts
import { createCommercialPriceLookup } from "@kmodels/pricing";

const lookup = createCommercialPriceLookup(priceData, inferenceMapping);
const result = lookup({
  subject: { kind: "model", provider_id: "anthropic", model_id: "claude-sonnet-5-5" },
  meter: { namespace: "kmodels", value: "cache_write_text" },
  choices: [{ dimension: "execution", value: { namespace: "kmodels", value: "request" } }],
  selectors: [
    {
      dimension: { namespace: "kmodels", value: "cache_ttl_seconds" },
      kind: "decimal",
      value: "300",
      unit: { factors: [{ unit: { namespace: "kmodels", value: "second" }, power: 1 }] },
    },
  ],
});
```

Results retain applicable unit prices, exact rational amounts and units, missing conditions,
evidence and freshness. Supply remaining conditions to narrow candidates. Query another TTL
independently when another group of tokens uses it. Usage attribution and cost aggregation belong
to the caller.

Use `/pricing/lookup/index.json` or complete `/pricing/lookup/providers/{provider}.json` partitions
with their bound `/pricing/inference.json` mapping. The audit endpoint `/pricing/index.json` uses a
different schema. Replace price data and mapping together. No transport or caching is built in.

Version `0.4.0` accepts price data schema `2.0` and removes the cost API. See [CONTRACT.md](CONTRACT.md)
and the exported `schema.json` and `query.schema.json`. `validatePriceData` exposes initialization
validation independently; `createInferencePriceLookup` is the direct model-ID query API.
