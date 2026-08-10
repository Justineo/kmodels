# Compaction

Compaction requires an additional sampling step, which contributes to rate limits and billing.

The `iterations` array shows usage for each sampling iteration. The top-level `input_tokens` and
`output_tokens` do not include compaction iteration usage. To calculate total tokens consumed and
billed for a request, sum across all entries in the `usage.iterations` array.

Re-applying a previous `compaction` block incurs no additional compaction cost.
