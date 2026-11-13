# Pricing coverage and evidence

Status: current

## Meaning of coverage

A successful refresh or an accepted provider partition establishes publication integrity, not
complete commercial coverage. Catalog identities can include downloadable artifacts, deprecated
models and hosted routes without public rates. An aggregate unknown-model count is therefore not
a hosted-service failure percentage.

Unit-price completeness requires amount, denomination, denominator, applicability and validity.
It does not require billable quantities or usage acquisition. Coverage inventories normalized
rate variants, condition dimensions, operation predicates, raw reasons, evidence references and
provider freshness. It does not assess whether a consumer could reconstruct a total cost.

Missing acquisition does not erase a known rate. Price-basis metadata may describe provider-owned
billing categories and rules, but Kmodels does not execute them or accept runtime usage.
Numeric zero, explicit free usage, `not_published`, `not_supported` and `not_applicable` require
positive commercial evidence. An unobserved price remains unknown. Catalog-only evidence creates
no commercial partition; Meta's registry and hosted SDK illustrate this boundary.

## Current coverage resources

The versioned `/pricing/lookup/coverage.json` export is the snapshot-specific inventory. It
enumerates terms, operation predicates, condition dimensions, raw reasons, source references and freshness. An empty operation predicate does not
assert support for every operation. The canonical `/pricing/index.json` retains the full evidence;
the core catalog independently retains model identity and lifecycle.

Use these generated resources for counts and amounts. Provider guides in [the decision
index](../design.md#providers) own current source authority, exact joins, supported mechanisms and
known evidence limits. Do not duplicate volatile provider totals or resolved findings in a dated
audit table. Execution plans, review receipts and task boards are local working state; Git retains
superseded design decisions.

## Unresolved and excluded facts

- Unknown amount, denominator, model/route scope, modality, selector or time semantics remain
  local raw or missing facts. Another provider's price, a successor name, a ratio of prices or
  a model capability cannot fill that evidence gap.
- Shared cache/input totals cannot establish independently priced text, image or audio partitions.
  Terminal stream usage, completed Batch job aggregates and result-item counts have distinct
  aggregation boundaries. Interruption or a missing modality counter can leave an operation partial.
- DBU, credit and currency observations retain their published denominations. Account-specific
  SKU conversion and private settlement cannot supply a universal public exchange multiplier.
- Hosting capacity directly associated with an admitted model is priced independently of request
  usage. An instance-hour is never allocated across a guessed request throughput.
- Training, retained storage, subscriptions, private discounts and unrelated account products are
  excluded under [commercial topology](commercial-topology.md). Excluded products are not missing
  request prices. Provider guides document narrower exceptions and exact admitted components.

## Review and repair

Source discovery, extraction, pricing reconciliation and operation coverage need separate review.
An omitted first-party page can hide a tariff without raising a parser error; an unconsumed SDK
field can change without breaking an admitted fact. Diagnose the actual consumed boundary.

[Refresh and repair](refresh-repair-audit.md) combines targeted diagnostic-driven investigations
with a rotating comprehensive provider/global review. A review attempt does not prove completion.
Retained partitions and unchanged hashes cannot establish semantic completeness.

A parser repair requires owned evidence and a reduced deterministic regression. A historical-data
repair additionally requires the original source identity/revision and proof of the unsupported
normalization. Withdraw the unproved interpretation while preserving literal quotes, source clocks,
unaffected facts and publication invariants. A current refetch cannot be backdated into an older
snapshot. When original evidence is insufficient, retain an explicit limitation instead of inventing
a replacement contract.

Provider fixtures test extraction and local gaps. Generated-data checks compare canonical terms
with consumer exports. Portable synthetic fixtures independently verify unit-price query
semantics and packed Node/browser behavior. These checks complement native evidence; none alone
proves every published service or charge has been discovered.

Production build verification replays every exact mapped inference ID against its published
price-data partition and summarizes lookup failures and candidate evidence gaps by provider.
After a build, `vp node scripts/check-price-assets.ts --list-inference-gaps` lists affected
IDs and reasons. Missing caller conditions alone are normal candidates. The replay covers
published mappings and supplies a review queue for source investigations, including known gaps.
