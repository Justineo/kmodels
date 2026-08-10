# Session event stream

The session object reports cumulative usage.

```json
{
  "usage": {
    "list_cost": { "amount": "187", "currency": "USD" },
    "active_seconds": 342.5,
    "server_tool_use": { "web_search_requests": 3, "web_fetch_requests": 0 }
  }
}
```

`list_cost` is the session's cumulative consumption priced at public list rates. `active_seconds` is the deduplicated running duration used to price the session runtime cost. Per-thread figures exclude session running-time cost and must not be summed into the authoritative session total.
