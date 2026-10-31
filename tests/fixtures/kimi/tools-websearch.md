> ## Documentation Index
>
> Fetch the complete documentation index at: https://platform.kimi.com/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# 联网搜索定价

> 查看 Kimi 联网搜索与网页抓取工具的调用价格、计费单位和使用说明。

## 产品定价

联网搜索与网页抓取能力按次计费，各方式相互独立、分别计费：

<table>
  <thead>
    <tr />
  </thead>

  <tbody />
</table>

> [!NOTE]
>
> 请求失败、模型未触发搜索或未返回结果/内容时均不计费。通过 Responses API 或 Formula API 使用联网搜索时，模型输入输出 Tokens 仍按对应[模型价格](https://platform.kimi.com/docs/pricing/chat.md)正常计费。

## 计费说明

### 联网搜索 Basic / 联网搜索 Pro

调用 `/v1/tools/search` 或 `/v1/tools/search_pro`：

- 请求成功（HTTP 200）且响应中的 `search_results` 非空（至少返回一条搜索结果）时，计一次费用；
- 请求失败（如参数错误、频率限制、服务错误、超时等）或未返回任何搜索结果时，不计费；
- 联网搜索 Pro 额外支持通过 `sites` 将结果约束在指定站点内、通过 `time_window` 约束结果时间范围，并为每个结果返回结构化正文片段（`chunks`）。

接口参数与调用示例详见 [联网搜索最佳实践](https://platform.kimi.com/docs/guide/best-practices-for-web-search.md)。

### 网页抓取

调用 `/v1/tools/fetch`：

- 请求成功（HTTP 200）且响应中的 `markdown` 非空白（成功抓取到页面正文内容）时，计一次费用；
- 请求失败（如 URL 非法、触发安全风控、频率限制、服务错误、超时等）、页面无可提取正文（404 `markdown_not_found`）或抓取内容为空时，不计费。

接口参数与调用示例详见 [联网搜索最佳实践](https://platform.kimi.com/docs/guide/best-practices-for-web-search.md)。

### Responses API web\_search

在 `POST /v1/responses` 的 `tools` 中加入 `{"type": "web_search"}`：

- 服务端会先判断是否需要搜索，需要时执行搜索并把结果注入模型上下文；
- 服务端实际执行搜索（`output` 中出现 `web_search_call`）时计一次费用；模型未触发搜索时不计费；
- `search_content_types` 包含 `image`（图片搜索）时不额外收费。

详见 [Responses API](https://platform.kimi.com/docs/api/responses.md)。

### Formula API web-search

在 `kimi-k3` 上通过 Formula API 执行官方 `web-search` 工具（`POST /v1/formulas/{uri}/fibers`），每次执行计一次费用。详见 [如何在 Kimi API 中使用官方工具](https://platform.kimi.com/docs/guide/use-official-tools.md)。
