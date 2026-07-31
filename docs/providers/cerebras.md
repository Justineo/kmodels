# Cerebras

Status: current

## Sources and identity

- The unauthenticated public API and official Model Catalog are independent exhaustive sources for shared endpoints.
- Callable IDs must be exact structured IDs or labeled model-card IDs. Dedicated endpoint weights and account-defined deployments do not create global rows.
- Model Catalog Production/Preview sections own maturity when public API lifecycle flags disagree.
- Deprecations add only model lifecycle rows; parameter deprecations do not. Replacement links resolve through exact path/ID bindings in the current catalog or exact name/ID bindings in the change log. Unresolved, conflicting, or dangling replacements reject the source; there is no model allowlist.
- Release dates require exact structural label/ID bindings. Historical models keep limits, prices, and dates unknown when current official sources no longer publish them.
- Optional authenticated `/v1/models` is account-scoped validation. It cannot create/remove rows or retain raw data.
- Enable the optional inventory with `CEREBRAS_API_KEY`.

## Mapping

- Current endpoint cards accept only reviewed Chat Completions and Completions labels bound to fixed POST method/path references. Unknown labels or changed references reject the provider; historical rows get no inferred endpoint.
- Structured API limits and prices have priority over model-card fallbacks. This keeps the machine-readable billing values when an independently maintained card lags; both observations retain provenance.
- Card prices require an exact `/ M tokens` suffix or the same component's exact `per million tokens` label. Conflicting prose is ignored.
- Cache-read prices derive only from the official standard-input rule. Placeholder cache fields are not free pricing.
- A single unconditional rate is valid only while the official service-tier guide says all tiers are billed equally. A change to that policy rejects the source instead of silently flattening tiered billing.
- `reasoning_effort` is positive effort-control evidence only when the exact parameter appears on the model card. Absence remains unknown.
- Credits are allowances. Dedicated capacity without stable shared IDs stays outside model pricing. The Batch API remains private preview and its current guide publishes no current rate, so a historical launch discount does not become current pricing or model capability evidence.
- Account-tier rate limits and per-request image limits do not fit the provider-neutral scalar model limits and are not flattened into them. API creation values are not model dates.

## Kong AI Gateway

- Candidates require active lifecycle, acceptable maturity, exact Chat Completions evidence, positive streaming, and visibility in the user's account.
- Keep global `account_availability` unknown; account confirmation remains scoped provenance.
- Do not create a dedicated-model allowlist or flatten credits/capacity into the current rate list.
