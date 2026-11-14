## Using Exa Search

The `exaSearch` tool can be used with any model regardless of the model provider or creator. [Exa](https://exa.ai/) returns web results and extracted content for agent workflows that need current information, domain filters, date filters, and token-efficient excerpts.

To use Exa Search, import `gateway` from `ai` and pass `gateway.tools.exaSearch()` to the `tools` parameter. When the model needs current information, it calls the tool and AI Gateway routes the request to [Exa's Search API](https://exa.ai/docs/reference/search-api-guide-for-coding-agents).

> **💡 Note:** Exa web search requests are charged at $7 per 1,000 `auto` or `fast` requests
> and $4 per 1,000 `instant` requests. Each request includes up to 10 results.
> Additional requested results beyond 10 are charged at $1 per 1,000 additional
> results.

### Tako pricing

`gateway.tools.takoSearch()`

AI Gateway bills each Tako Search call at the cost Tako reports in
`usage.total_cost_usd`, and doesn't bill failed calls:

| Charge                                       | Price                                                                                    |
| -------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Search                                       | $7 per 1,000 instant or fast requests. $12 per 1,000 deep requests.                      |
| Inline data (`sources.data.includeContents`) | A fee per card plus a rate per row, listed in each card's `content.export_pricing`.      |
| Variable-cost data                           | A charge per variable-cost card, up to `maxVariableCostUsd` per call ($0.25 by default). |

For current inline-data and variable-cost rates, see Tako's
[Contents pricing](https://docs.tako.com/documentation/integrating-tako/contents/pricing).
To stop variable-cost charges, set [`variableCost: false`](#tako-parameters).
To avoid inline-data charges, leave `sources.data.includeContents` unset.
AI Gateway also charges for the host model's tokens. See
[AI Gateway pricing](/docs/ai-gateway/pricing).

## Using Browserbase Search

The `browserbaseSearch` tool can be used with any model regardless of the model
provider or creator. [Browserbase](https://browserbase.com/) provides fast,
structured web discovery through its
[Search API](https://docs.browserbase.com/reference/api/web-search), returning
result titles, URLs, and metadata without opening a browser session. Use it when
you want the model to find pages, then pair it with
[Browserbase Fetch](#using-browserbase-fetch) to read one.

To use Browserbase Search, import `gateway` from `ai` and pass
`gateway.tools.browserbaseSearch()` to `tools`:

> **💡 Note:** Browserbase Search costs $7 per 1,000 requests, regardless of how many results
> you request.

## Using Browserbase Fetch

The `browserbaseFetch` tool retrieves the contents of a URL the model already
has, rather than searching for one. It uses
[Browserbase's Fetch API](https://docs.browserbase.com/platform/fetch/overview),
a lightweight option for pages that do not need JavaScript execution or browser
interaction, and can return the raw response body, Markdown, or structured JSON
extracted against a JSON Schema you supply. Pair it with
[Browserbase Search](#using-browserbase-search) when the model needs to find the
page first.

To use Browserbase Fetch, import `gateway` from `ai` and pass
`gateway.tools.browserbaseFetch()` to `tools`:

> **💡 Note:** Browserbase Fetch is priced per option. A plain `raw` fetch costs $1 per 1,000
> requests. Routing through proxies adds $3 per 1,000, and extraction (`markdown`
> or `json` format) adds another $3 per 1,000, so a proxied extraction costs $7
> per 1,000. The surcharges are billed from the options actually sent upstream and
> reported in the gateway usage metadata.

### DeepSeek Search and Fetch pricing

`gateway.tools.deepseekSearch()`
`gateway.tools.deepseekFetch()`

| Tool            | Price per 1,000 billable requests |
| --------------- | --------------------------------- |
| DeepSeek Search | $0.75                             |
| DeepSeek Fetch  | $0.75                             |

Search is billable when a successful request returns a nonempty results array,
including results that are filtered before reaching the model. Fetch is billable
when a successful request returns nonempty page content. Failed requests,
timeouts, and empty results are not billed. The requested result count does not
change the price.

The host model's input and output tokens are charged separately, including tool
results in its context. Remove the tools from `tools` to stop further tool calls.
See [AI Gateway pricing](/docs/ai-gateway/pricing) for model pricing and spending
controls.
