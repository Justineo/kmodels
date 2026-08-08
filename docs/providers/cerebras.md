# Cerebras

Status: current

## Sources and identity

- The unauthenticated public API and official Model Catalog are independent exhaustive sources for shared endpoints. The structured public API is the primary exact-ID price source; the public pricing page is an independently maintained corroborating source.
- Callable IDs must be exact structured IDs or labeled model-card IDs. Dedicated endpoint weights and account-defined deployments do not create global rows.
- Model Catalog Production/Preview sections own maturity when public API lifecycle flags disagree.
- `/models/choose-a-model` is a reviewed selection guide, not a model card: it intentionally has no
  `modelId`. Only exact model links from the Production/Preview catalog tables enter the card set;
  any other newly discovered `/models/*` page still fails closed until classified.
- Deprecations add only model lifecycle rows; parameter deprecations do not. Replacement links resolve through exact path/ID bindings in the current catalog or exact name/ID bindings in the change log. Unresolved, conflicting, or dangling replacements reject the source; there is no model allowlist.
- Release dates require exact structural label/ID bindings. Historical models keep limits, prices, and dates unknown when current official sources no longer publish them.
- Optional authenticated `/v1/models` is account-scoped validation. It cannot create/remove rows or retain raw data.
- Enable the optional inventory with `CEREBRAS_API_KEY`.

## First-party commercial discovery

- The official `llms.txt` index is collected atomically with the model catalog. Commercial-looking links are partitioned against the reviewed companion allowlist; a new pricing, billing, credit, subscription, usage, cost, or metering page rejects the source until reviewed.
- Reviewed companions cover public model pricing, the website price card, Chat/Completions usage, prompt caching, image inputs, reasoning, predicted outputs, service tiers, tools, Batch, account billing, console usage/cost reporting, projects, rate limits, dedicated endpoints, metrics, and AWS Marketplace billing.
- Every reviewed commercial input is reconciled as normalized, deliberately outside the public model price book, or unresolved. Tests assert the denominator and each unresolved reason, so a newly fetched page cannot merely disappear from extraction.
- Only first-party Cerebras sources are admissible. This provider does not use `ccusage`, LiteLLM, models.dev, or another community price book.

## Mapping

- Current endpoint cards accept only reviewed Chat Completions and Completions labels bound to fixed POST method/path references. Unknown labels or changed references reject the provider; historical rows get no inferred endpoint.
- Structured API limits and prices have priority over model-card fallbacks. This keeps the machine-readable billing values when an independently maintained card lags; both observations retain provenance.
- The public pricing page must bind one row to every current exact model ID. Equal rates corroborate the structured source; a difference is retained as a bounded source-conflict diagnostic rather than overriding the structured value or rejecting otherwise valid model data.
- Card prices require an exact `/ M tokens` suffix or the same component's exact `per million tokens` label. Conflicting prose is ignored.
- Cache-read prices derive only from the official standard-input rule. Placeholder cache fields are not free pricing.
- A single unconditional rate is valid only while the official service-tier guide says all tiers are billed equally. A change to that policy rejects the source instead of silently flattening tiered billing.
- `reasoning_effort` is positive effort-control evidence only when the exact parameter appears on the model card. Absence remains unknown.
- Credits are allowances. Dedicated capacity without stable shared IDs stays outside model pricing. The Batch API remains private preview and its current guide publishes no current rate, so a historical launch discount does not become current pricing or model capability evidence.
- All 12 unknown-priced rows in the current refresh are deprecated identities retained only by
  lifecycle or release history. None appears in the current structured price source or current
  public pricing table. Copying a successor's rate or preserving an old launch price would turn
  historical evidence into a false current offer, so no parser change can resolve them safely.
- Account-tier rate limits and per-request image limits do not fit the provider-neutral scalar model limits and are not flattened into them. API creation values are not model dates.

## Cost boundary

- For current usage-based shared inference, a completed response is publicly calculable from the exact model ID plus `usage.prompt_tokens` and `usage.completion_tokens`. `prompt_tokens_details.cached_tokens` is observable, but cached input has the normal input rate and therefore does not change the formula.
- Image tokens are included in prompt tokens. Hidden reasoning tokens and rejected predicted-output tokens are included in completion accounting; they must not be added again. All service tiers currently share one rate during preview. The client executes tool calls, so there is no documented Cerebras tool-execution meter to add.
- Streaming Chat responses and Batch results publish usage fields. Batch charges only completed requests, but its current public rate is not published, so the shared synchronous rate must not be inferred for Batch.
- The result is a public list-cost estimate, not the account's effective invoice cost. Trial credits, credit expiry and recharge, per-model monthly subscriptions, enterprise/dedicated contracts, and AWS Marketplace billing are account or channel adjustments outside the public price book. Monthly subscription tiers are visible only in the console; enterprise terms are private.
- Cerebras documents console Usage, Cached-Usage, and Cost reports with CSV export, but no public Usage/Costs ledger API. Console cost may lag by up to 10 minutes, active monthly-subscription requests are excluded from usage-based billing, and AWS Marketplace charges may take 24–48 hours to appear.
- The opt-in dedicated-endpoint Metrics API reports aggregate input, output, and cache token counters for the last complete minute, not request cost. It can support operational reconciliation, but neither it nor delayed console cost is suitable for request-time cost-based load balancing. A gateway should route on the public marginal-rate estimate and response usage, while reconciling account-effective cost asynchronously.

## Kong AI Gateway

- Candidates require active lifecycle, acceptable maturity, exact Chat Completions evidence, positive streaming, and visibility in the user's account.
- Keep global `account_availability` unknown; account confirmation remains scoped provenance.
- Do not create a dedicated-model allowlist or flatten credits/capacity into the current rate list.
- Record the request's exact model and service-tier selector, then use returned usage as the authoritative completed-token count. Treat the estimate as provisional whenever the account may have an active monthly plan, custom dedicated terms, Marketplace billing, or Batch execution.
