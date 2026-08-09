# Fallback credit

A refusal returns a `fallback_credit_token` for an eligible retry.

Refusals in [Message Batches](/docs/en/build-with-claude/batch-processing) don't mint credit tokens.

When a credit applies, `cache_creation_input_tokens` is lower and `cache_read_input_tokens` is higher by the same amount.

The token redeems only from the organization and workspace that received the refusal.
