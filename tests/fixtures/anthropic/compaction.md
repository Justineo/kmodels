# Compaction

Compaction requires an additional sampling step, which contributes to rate limits and billing.

The `iterations` array shows usage for each sampling iteration. The top-level `input_tokens` and
`output_tokens` do not include compaction iteration usage. To calculate total tokens consumed and
billed for a request, sum across all entries in the `usage.iterations` array.

```json Output
{
  "usage": {
    "input_tokens": 23000,
    "output_tokens": 1000,
    "iterations": [
      { "type": "compaction", "input_tokens": 180000, "output_tokens": 3500 },
      { "type": "message", "input_tokens": 23000, "output_tokens": 1000 }
    ]
  }
}
```

Re-applying a previous `compaction` block incurs no additional compaction cost.
