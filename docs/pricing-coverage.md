# Pricing coverage and evidence

Status: current

## Meaning of coverage

A successful refresh or an accepted provider partition establishes publication integrity, not
complete commercial coverage. Catalog identities can include downloadable artifacts, deprecated
models and hosted routes without public rates. An aggregate unknown-model count is therefore not
a hosted-service failure percentage.

Pricing has four independent evidence levels:

1. A normalized rate establishes amount, denomination, denominator, applicability and validity.
2. A semantic charge binding identifies the final billable quantity and aggregation boundary.
3. A quantity method establishes native input locators and any arithmetic needed to obtain that
   quantity. Alternative methods stay within their own protocol and observation boundary.
4. A complete operation additionally needs every applicable charge, selector and eligibility
   condition. One known token rate or computable component cannot establish a complete total.

Missing acquisition does not erase a known rate. A caller can supply an independently measured
billable quantity. An absent counter does not become zero unless its owned contract says so.
Numeric zero, explicit free usage, `not_published`, `not_supported` and `not_applicable` require
positive commercial evidence. An unobserved price remains unknown. Catalog-only evidence creates
no commercial partition; Meta's registry and hosted SDK illustrate this boundary.

## Current coverage resources

The versioned `/pricing/calculation/coverage.json` export is the snapshot-specific inventory. It
enumerates logical components, operation predicates, bindings, acquisition alternatives, missing
selectors, raw reasons, source references and freshness. An empty operation predicate does not
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
with consumer exports. Portable synthetic conformance vectors independently verify evaluator
semantics and packed Node/browser behavior. These checks complement native evidence; none alone
proves every published service or charge has been discovered.
