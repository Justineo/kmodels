# Kimi

Status: current

## Boundary and source authority

Kmodels publishes Kimi's public price book and the machine-readable inputs needed to calculate its
request-attributable list-price cost. It does not observe request lifecycles, persist usage, infer a
missing terminal event, apply vouchers or contracts, or reconcile invoices. Those are downstream
responsibilities; this catalog states exactly which request, response, stream, and Batch-result
fields the downstream cost service must retain.

Kimi operates separate China and international platforms. Production collection therefore uses
both first-party source sets:

- [`https://platform.kimi.com/docs/openapi.json`](https://platform.kimi.com/docs/openapi.json)
  establishes the China API origin `https://api.moonshot.cn`.
- [`https://platform.kimi.ai/docs/openapi.json`](https://platform.kimi.ai/docs/openapi.json)
  establishes the international API origin `https://api.moonshot.ai`.
- The regional model catalogs establish labeled current, restricted, and retired identities.
- The regional pricing pages independently establish CNY and USD rates. Currency conversion never
  selects between them; the actual request origin selects exactly one region.
- Optional authenticated `GET /v1/models` sources may enrich exact public IDs for their own account,
  but cannot create or remove public catalog identities.

The OpenAPI parser cross-checks the Chat discriminator, each referenced request model enum, the
Token Estimate enum, and the reviewed List Models shape. The current callable Chat set is
`kimi-k2.6`, `kimi-k2.7-code`, `kimi-k2.7-code-highspeed`, and `kimi-k3`. The same OpenAPI documents
also establish Responses and Anthropic-compatible Messages for `kimi-k3`. These two endpoint claims
are fact-local: drift removes only that endpoint and its dependent calculation methods.

## Deterministic source graph

Each regional pricing collector fetches its K3 price page plus 18 fixed companions in one bounded
bundle. The reviewed set contains K2.7, K2.6, K2.5, Moonshot V1, Batch and web-search prices; the
model-pricing overview; Batch route and result guidance; Files operations; built-in web search;
Formula official tools; and the regional `llms.txt` index. The index completeness check is limited
to this price-book boundary. Account balances, quotas, budgets, invoices, consumer subscriptions,
and organization controls are intentionally not collected as model-pricing reconciliation facts.

Extraction is bilingual and deterministic. Exact IDs, labeled tables, reviewed JSON/MDX structures,
and bounded semantic markers are accepted; an LLM is never used during refresh. Identity
contradictions fail the source. Price rows and calculation inputs are claim-local: one malformed row
or field suppresses only that fact while valid siblings remain.

## Current public price book

Standard rates per one million tokens are:

| Model                      | China cache / input / output | International cache / input / output |
| -------------------------- | ---------------------------- | ------------------------------------ |
| `kimi-k3`                  | CNY 2 / 20 / 100             | USD 0.30 / 3 / 15                    |
| `kimi-k2.7-code`           | CNY 1.30 / 6.50 / 27         | USD 0.19 / 0.95 / 4                  |
| `kimi-k2.7-code-highspeed` | CNY 2.60 / 13 / 54           | USD 0.38 / 1.90 / 8                  |
| `kimi-k2.6`                | CNY 1.10 / 6.50 / 27         | USD 0.16 / 0.95 / 4                  |
| `kimi-k2.5`                | CNY 0.70 / 4 / 21            | USD 0.10 / 0.60 / 3                  |

Moonshot V1 has no cache-rate dimension. Its 8K, 32K, and 128K text and vision variants respectively
publish China input/output rates of CNY 2/10, 5/20, and 10/30, and international rates of USD
0.20/2, 1/3, and 2/5. `moonshot-v1-auto` remains unknown-priced: the concrete variants differ and no
first-party field resolves the billed variant.

Batch is a separate asynchronous offer. China cache/input/output rates are CNY 0.78/3.90/16.20 for
K2.7, 0.66/3.90/16.20 for K2.6, and 0.42/2.40/12.60 for K2.5. International rates are USD
0.114/0.57/2.40, 0.10/0.57/2.40, and 0.06/0.36/1.80. The price page includes K2.7 while the current
Batch guide names only K2.6 and K2.5, so K2.7's numeric observations remain published without a
charge binding.

Web search costs CNY 0.03 or USD 0.005 per billed event. Two route-distinct offers use that amount:

- Built-in Chat `$web_search` is billed for each exact emitted matching call when
  `finish_reason=tool_calls`; declaration and `finish_reason=stop` do not incur the event charge.
- Formula `moonshot/web-search:latest` is billed at Fiber creation. The dedicated pricing prose
  still describes the built-in route, so failed-Fiber charging remains unknown.

The other 11 official Formula tools and the Files service are published as temporary `free` states,
not numeric zero rates. Their promotion end and post-promotion pricing are unknown. Ordinary
caller-defined functions are not Kimi services and receive no Kimi tool rate.

## Calculation-input contract

The OpenAPI sources publish 16 field-local inputs per region: one region selector plus six Chat,
three Responses, and six Messages usage locators. The pricing source publishes four additional
inputs for Batch and priced web-search routes. `provider_field` is used only where the billable
quantity is a provider-defined reduction over several response fields; it is not an arbitrary raw
payload escape hatch.

| Offer / route                    | Canonical quantity                     | Required acquisition input                                    | Calculation and completeness rule                                                                                                                 |
| -------------------------------- | -------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Regional selection               | `region`                               | Request `HttpRequest.api_origin`                              | Map `.cn` to China and `.ai` to International. Every regional rate variant carries this selector source.                                          |
| Chat cache hit                   | `cached_input_tokens`                  | Response or terminal stream `/usage/cached_tokens`            | Direct quantity. A complete stream requires the final usage chunk.                                                                                |
| Chat cache miss                  | `uncached_input_tokens`                | Response or stream prompt and cached usage                    | Closed graph `max(prompt_tokens - cached_tokens, 0)`.                                                                                             |
| Chat output                      | `output_tokens`                        | Response or terminal stream `/usage/completion_tokens`        | Direct quantity. Thinking is already included in output.                                                                                          |
| K3 Responses cache hit           | `cached_input_tokens`                  | Response `/usage/input_tokens_details/cached_tokens`          | Direct quantity.                                                                                                                                  |
| K3 Responses cache miss          | `uncached_input_tokens`                | Response total input and cached detail                        | Closed graph `max(input_tokens - cached_tokens, 0)`. The OpenAPI has no typed terminal SSE payload, so no Responses-stream locator is invented.   |
| K3 Responses output              | `output_tokens`                        | Response `/usage/output_tokens`                               | Direct quantity; the field explicitly includes reasoning tokens.                                                                                  |
| K3 Anthropic Messages cache hit  | `cached_input_tokens`                  | Response or terminal `message_delta` cache-read usage         | Direct quantity.                                                                                                                                  |
| K3 Anthropic Messages cache miss | `uncached_input_tokens`                | Response or terminal `message_delta` `/usage/input_tokens`    | Direct quantity because Kimi describes this field as input excluding cache hits.                                                                  |
| K3 Anthropic Messages output     | `output_tokens`                        | Response or terminal `message_delta` `/usage/output_tokens`   | Direct quantity; output includes thinking. Cache-creation and thinking details are explanatory because Kimi publishes no separate rates for them. |
| Moonshot V1 input/output         | `input_tokens` / `output_tokens`       | Chat prompt/completion usage                                  | Full prompt input is billed once; do not subtract cache usage because the V1 table has no cache rate.                                             |
| K2.5/K2.6 Batch output           | `output_tokens` per result item        | Result `/response/body/usage/completion_tokens`               | Direct quantity.                                                                                                                                  |
| K2.5/K2.6 Batch cache/input      | cache hit / cache miss per result item | Prompt usage plus a cached-token partition                    | The result publishes prompt usage but no cached partition. Both rates retain semantic bindings with no quantity method; cost is partial.          |
| Built-in Chat web search         | exact billed `$web_search` call count  | Response `KimiChatResponse.billable_builtin_web_search_calls` | Count calls satisfying the documented finish reason and exact function name. This provider field avoids an unsafe unfiltered array-length rule.   |
| Formula web search               | successful created web-search Fibers   | Response `KimiFormulaFiber.created_web_search_fibers`         | One per successful creation of the exact Formula URI. Failed-call billing remains unbound.                                                        |

Search-result tokens reported inside built-in tool arguments are explanatory. They are billed only
when submitted in the next Chat request, whose authoritative prompt usage already includes them;
adding the argument count again would double-charge.

The quantity language is the shared closed, unit-checked calculation graph, not CEL or executable
provider scripts. A consumer may compile it to CEL internally. Kimi currently publishes no OTel
locator because no reviewed OTel convention expresses these Kimi-specific fields with equivalent
semantics; the provider JSON and normalized-field locators remain canonical.

## Missing evidence and raw policy

Absence of an acquisition path does not turn a valid rate into raw pricing. The current structured
partial cases are:

- Batch prompt usage lacks the cached-token partition needed to separate the two input rates.
- K2.7 Batch applicability conflicts between the price page and workflow guide.
- Responses streaming has no typed terminal usage envelope in the OpenAPI contract.
- The Responses `web_search` tool is documented operationally, but the current price prose binds an
  amount only to Chat `$web_search` and Formula Fiber execution.
- Formula failure charging, promotional end dates, and `moonshot-v1-auto` resolution are not
  published.

Batch cache/input terms therefore keep a canonical signal but no `quantity_methods`; K2.7 Batch has
no charge binding. Raw variants are reserved for genuine source-native commercial ambiguity, such
as the K2.7 applicability conflict, Formula trigger caveat, K3 documentation warning, and unknown
promotion validity. The old informational raw entries for missing Chat or Batch accounting locators
are intentionally removed.

Downstream cost services must record the actual regional origin, model, endpoint or offer, terminal
completeness, provider-defined tool count or Fiber result, and the usage inputs referenced by the
selected quantity method. Kmodels does not prescribe storage or request orchestration; it only makes
the required information and the consequence of absence explicit.

## Refresh and comparator policy

Regional OpenAPI, catalogs, model-price pages, Batch, web search, Formula, Files, lifecycle sources,
and `llms.txt` discovery are independent claim groups. A missing page, changed field, malformed row,
new Formula URI, or one-region drift suppresses only the dependent fact and cannot erase sibling
models, other rates, free states, or the other regional book. Pricing-input observations add their
source references to every dependent term so calculation provenance is auditable.

models.dev, LiteLLM, Portkey, Helicone, gateways, and resellers remain audit-only. They can point to
a first-party claim worth reviewing, but cannot create a Kimi-direct ID, replace a regional amount,
select an account's origin, or establish a billable provider signal. No third-party model or price
fact enters the production refresh.
