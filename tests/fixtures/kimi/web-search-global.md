# Use Web Search

`kimi-k3` supports web search.

```python
tools = [{"name": "$web_search"}]
```

`$web_search` works with `kimi-k3` and `kimi-k2.6`; to use `kimi-k2.5`, replace the model field.

The response is returned in `choices[0].message.tool_calls`.

Search result usage is arguments.usage.total_tokens; final usage includes prompt_tokens, completion_tokens, and total_tokens.

<Tabs>
