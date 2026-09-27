## Documentation Index

> Fetch the complete documentation index at: https://platform.kimi.com/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# 联网搜索定价

> 查看 Kimi 联网搜索与网页抓取工具的调用价格、计费单位和使用说明。

export const DocTable = ({columns = [], rows = []}) => {
return <div className="doc-table-wrap">
<table className="doc-table">
{columns.length > 0 ? <colgroup>
{columns.map((column, index) => <col key={index} style={column.width ? {
width: column.width
} : undefined} />)}
</colgroup> : null}
<thead>
<tr>
{columns.map((column, index) => <th key={index}>{column.title}</th>)}
</tr>
</thead>
<tbody>
{rows.map((row, rowIndex) => <tr key={rowIndex}>
{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}
</tr>)}
</tbody>
</table>
</div>;
};

## 产品定价

通过独立的 REST 接口调用联网搜索与网页抓取能力，按次计费，请求成功且返回数据时才收费：

<DocTable
columns={[
{ title: "工具名称", width: "20%" },
{ title: "调用方式", width: "26%" },
{ title: "价格", width: "14%" },
{ title: "计费条件", width: "40%" },
]}
rows={[
["联网搜索 Basic", <><code>POST /v1/tools/search</code></>, "￥0.01 / 次", <>请求成功（HTTP 200）且 <code>search_results</code> 非空</>],
["联网搜索 Pro", <><code>POST /v1/tools/search_pro</code></>, "￥0.015 / 次", <>请求成功（HTTP 200）且 <code>search_results</code> 非空</>],
["网页抓取", <><code>POST /v1/tools/fetch</code></>, "￥0.01 / 次", <>请求成功（HTTP 200）且返回的 <code>markdown</code> 非空白</>],
]}
/>

<Note>
  三个接口相互独立、分别计费；请求失败或未返回结果/内容时均不计费。新接入的联网搜索能力请使用以上 REST 接口。
</Note>

## 联网搜索 Basic / 联网搜索 Pro 计费逻辑

当你调用 `/v1/tools/search` 或 `/v1/tools/search_pro` 接口，且响应满足以下两个条件时，我们收取一次调用费用（联网搜索 Basic ￥0.01/次，联网搜索 Pro ￥0.015/次）：

- 请求成功，返回 HTTP 200；
- 响应中的 `search_results` 非空（即至少返回一条搜索结果）。

请求失败（如参数错误、频率限制、服务错误、超时等）或请求成功但未返回任何搜索结果时，不计费。

两个接口的区别在于：联网搜索 Pro 额外支持通过 `sites` 将结果约束在指定站点内、通过 `time_window` 约束结果时间范围，并为每个结果返回结构化正文片段（`chunks`）。

## 网页抓取计费逻辑

当你调用 `/v1/tools/fetch` 接口，且响应满足以下两个条件时，我们收取一次调用费用（￥0.01/次）：

- 请求成功，返回 HTTP 200；
- 响应中的 `markdown` 非空白（即成功抓取到页面正文内容）。

请求失败（如 URL 非法、触发安全风控、频率限制、服务错误、超时等）、页面无可提取正文（404 `markdown_not_found`）或抓取内容为空时，不计费。

## 内建工具 \$web\_search 计费逻辑（存量方式）

<Note>
  `$web_search` 是在 `/v1/chat/completions` 中通过 `tools` 触发的内建工具，与上述 REST 接口相互独立、分别计费。该方式预计于 2026 年 10 月 20 日下线，新接入请使用 `/v1/tools/search` 接口或官方工具 `web-search`，详见[联网搜索指南](/docs/guide/use-web-search)。
</Note>

当你在 `/v1/chat/completions` 的 `tools` 中加入 `$web_search` 工具，并获得了一个 `finish_reason = tool_calls` 且 `tool_call.function.name = $web_search` 的响应时，我们收取联网搜索 `$web_search` 调用费用 0.03 元；当响应 `finish_reason = stop` 时，不会收取调用费用。

此外，在使用 `$web_search` 时，我们依然会按照不同的模型大小收取 `/chat/completions` 接口产生的 Tokens 费用，**额外值得注意的是，当触发了联网搜索 `$web_search` 工具调用，搜索结果也会被计入 Tokens 中，搜索结果占用的 Tokens 数量可以在返回的 `tool_call.function.arguments` 中获取**，例如：当你触发了联网搜索 `$web_search` 工具调用时，如果联网搜索的内容占用了 4k Tokens，这 4k Tokens 会在调用方 **下次** 调用 `/chat/completions` 接口时计入总 Tokens 中，此时总计费 Tokens 为：

```text theme={null}
total_tokens = prompt_tokens + search_tokens + completions_tokens
```

_注：如果你在触发了联网搜索 `$web_search` 时，不继续完成 `tool_calls`，而是就此停止，那么我们只会收取 ¥0.03 元的工具调用费用，联网搜索内容占用的 Tokens 将不会计费。_
