# Kimi 官方工具

目前官方工具限时免费。

适用于 `kimi-k3`、`kimi-k2.6` 和 `kimi-k2.5`。

| 工具名称        | 说明            |
| --------------- | --------------- |
| `convert`       | 格式转换        |
| `web-search`    | 联网搜索        |
| `rethink`       | 重新思考        |
| `random-choice` | 随机选择        |
| `mew`           | Mew             |
| `memory`        | 记忆            |
| `excel`         | 表格处理        |
| `date`          | 日期处理        |
| `base64`        | Base64 编解码   |
| `fetch`         | 获取资源        |
| `quickjs`       | JavaScript 执行 |
| `code-runner`   | 代码执行        |

Formula `moonshot/web-search:latest` 包含资源用量并由平台处理计费；联网搜索价格另见定价页。

- `POST /v1/formulas/{uri}/fibers` — 创建 Fiber；此步骤产生工具调用计费。
