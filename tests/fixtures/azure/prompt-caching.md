# Prompt caching

For supported models, cache reads are billed at a discount on input token pricing.

On GPT-5.6 models and later model families, cache writes can incur charges in addition to discounted
cache reads. Standard deployments report cache reads in `cached_tokens` and cache writes in
`cache_write_tokens`.

In explicit mode, a request without explicit breakpoints doesn't use prompt caching or incur cache-write charges.
Prompt caching is enabled by default for supported models.
