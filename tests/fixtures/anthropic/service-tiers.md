# Service tiers

Priority Tier capacity commitments are no longer available for purchase. Organizations with an existing commitment can continue to use Priority Tier through their contract end date.

The `service_tier` parameter accepts `"auto"` (default) or `"standard_only"`.

The response reports `"service_tier": "priority"` when Priority Tier was assigned. Requests beyond your committed capacity automatically fall back to standard tier.

Priority Tier pricing is defined by an organization's existing capacity commitment.

A Priority Tier commitment consists of input and output tokens per minute, a commitment duration of 1, 3, 6, or 12 months, and a specific model version.

Priority Tier is supported on all available Claude models except Claude Mythos 5, Claude Mythos Preview, Claude Fable 5, and Claude Sonnet 5.
