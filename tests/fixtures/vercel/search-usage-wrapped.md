<!-- Reviewed excerpts from https://vercel.com/docs/ai-gateway/models-and-providers/web-search.md, 2026-09-19. Tool names retained as the identity context; response paragraph preserves original wrapping. -->

Built-in search tools:

- exaSearch (`vercel:exa_search`)
- parallelSearch (`vercel:parallel_search`)
- perplexitySearch (`vercel:perplexity_search`)
- takoSearch (`vercel:tako_search`)

AI Gateway executes server tools internally. The final Chat Completions response
has `finish_reason: "stop"` and does not include client-facing `tool_calls` or raw
search results. Inspect `choices[0].message.provider_metadata.gateway.gatewayToolCalls`
for successful search-call counts and the gateway metadata for aggregate cost.
