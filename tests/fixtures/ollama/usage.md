# Usage

`prompt_eval_count`: How many input tokens were processed.

`prompt_eval_cached_count`: How many prompt tokens were read from the cache.

`eval_count`: How many output tokens were processed.

For streaming responses, usage fields are included in the final chunk where `done` is `true`.
