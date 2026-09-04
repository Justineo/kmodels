# 使用 Batch API

相比实时 API 调用可以节省 40%。Batch API 支持 `kimi-k2.6` 和 `kimi-k2.5` 模型，暂不支持 `kimi-k3`。

输出 usage 包含 prompt_tokens、completion_tokens 和 total_tokens。

```json
{
  "response": {
    "body": { "usage": { "prompt_tokens": 128, "completion_tokens": 32, "total_tokens": 160 } }
  }
}
```
