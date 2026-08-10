# Fallback credit

A refusal returns a `fallback_credit_token` for an eligible retry.

Retry with the token within its five-minute window.

Refusals in [Message Batches](/docs/en/build-with-claude/batch-processing) don't mint credit tokens.

When a credit applies, `cache_creation_input_tokens` is lower and `cache_read_input_tokens` is higher by the same amount.

The token redeems only from the organization and workspace that received the refusal.

Claude Fable 5's permitted targets are Claude Opus 4.8 (`claude-opus-4-8`) and Claude Opus 5 (`claude-opus-5`).
