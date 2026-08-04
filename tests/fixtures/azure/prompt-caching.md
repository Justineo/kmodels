# Prompt caching

For supported models, cache reads are billed at a discount on input token pricing.

For `gpt-5.6` models, the usage response doesn't report cache writes separately. Use `cached_tokens` to monitor cache reads.

There's no opt-out support for prompt caching.
