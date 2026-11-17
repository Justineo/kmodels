## How caching works

### Example cohort

Both implicit and explicit caching are supported, where explicit caching gives you more control over which context is written to cache.

**Explicit mode:** You choose where to place cache breakpoints based on your context management.

**Implicit mode:** OpenAI chooses breakpoint locations out of the box that work well for most use cases.

## Cache lifetime

### Example cohort

Responses API request with explicit breakpoints

```json
{
  "model": "gpt-5.4",
  "prompt_cache_options": { "mode": "explicit" },
  "input": []
}
```

## Summary of model differences

| Behavior             | Example cohort                             |
| -------------------- | ------------------------------------------ |
| Implicit breakpoints | At the end of the latest eligible message. |
| Explicit breakpoints | Supported                                  |
