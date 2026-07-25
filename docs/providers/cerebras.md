# Cerebras

Status: current

## Sources and identity

- The unauthenticated public API and official Model Catalog are independent exhaustive sources for shared endpoints.
- Callable IDs must be exact structured IDs or labeled model-card IDs. Dedicated endpoint weights and account-defined deployments do not create global rows.
- Model Catalog Production/Preview sections own maturity when public API lifecycle flags disagree.
- Deprecations add only model lifecycle rows; parameter deprecations do not. Release dates require exact structural label/ID bindings.
- Optional authenticated `/v1/models` is account-scoped validation. It cannot create/remove rows or retain raw data.
- Enable the optional inventory with `CEREBRAS_API_KEY`.

## Mapping

- Current endpoint cards accept only reviewed Chat Completions and Completions labels bound to fixed POST method/path references. Unknown labels or changed references reject the provider; historical rows get no inferred endpoint.
- Structured API limits and prices have priority.
- Card prices require an exact `/ M tokens` suffix or the same component's exact `per million tokens` label. Conflicting prose is ignored.
- Cache-read prices derive only from the official standard-input rule. Placeholder cache fields are not free pricing.
- Credits are allowances. Dedicated capacity without stable shared IDs stays outside model pricing. API creation values are not model dates.

## Kong AI Gateway

- Candidates require active lifecycle, acceptable maturity, exact Chat Completions evidence, positive streaming, and visibility in the user's account.
- Keep global `account_availability` unknown; account confirmation remains scoped provenance.
- Do not create a dedicated-model allowlist or flatten credits/capacity into the current rate list.
