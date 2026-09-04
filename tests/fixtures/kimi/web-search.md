# 使用联网搜索

`kimi-k3` 支持联网搜索。

```python
tools = [{"name": "$web_search"}]
```

`$web_search` 可配合 `kimi-k3` 和 `kimi-k2.6`；换用 `kimi-k2.5` 等模型只需替换 model 字段。

响应位于 `choices[0].message.tool_calls`。

搜索结果用量见 arguments.usage.total_tokens，最终响应包含 prompt_tokens、completion_tokens 和 total_tokens。

<Tabs>
