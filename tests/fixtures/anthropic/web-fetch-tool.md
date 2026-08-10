# Web fetch tool

You can include the web fetch tool in the Messages Batches API. Web fetch tool calls through the Messages Batches API are priced the same as those in regular Messages API requests.

## Usage and pricing

Web fetch usage has no additional charges beyond standard token costs:

```json
{ "usage": { "server_tool_use": { "web_fetch_requests": 1 } } }
```

The web fetch tool is available on the Claude API at no additional cost. You only pay standard token costs for fetched content.
