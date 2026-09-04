Cached prompt tokens are billed at 10% of the standard input token price.
Completion responses report cached prompt tokens in
`usage.prompt_tokens_details.cached_tokens`. `prompt_tokens` contains all prompt tokens, so
billable uncached input is `prompt_tokens - cached_tokens`. When no cache entry is served,
`cached_tokens` is 0 or omitted.
