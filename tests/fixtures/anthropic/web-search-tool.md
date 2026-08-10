# Web search tool

You can include the web search tool in the Messages Batches API. Web search tool calls through the Messages Batches API are priced the same as those in regular Messages API requests.

## Usage and pricing

```json
{ "usage": { "server_tool_use": { "web_search_requests": 1 } } }
```

Web search is available on the Claude API for $10 per 1,000 searches, plus standard token costs for search-generated content. Each web search counts as one use. If an error occurs during web search, the web search will not be billed.
