# Prompt Caching

Prompt caching is automatically enabled for all users on supported models.

Track cache hits using `usage.prompt_tokens_details.cached_tokens`. Setting
`prompt_cache_key` does not change billing.

Input tokens, whether served from the cache or processed fresh, are billed at the standard input token rate for the respective model.
