# Agent guidelines for provider research and collection

Use this workflow for scheduled repair and local provider work, including source discovery,
optimization and behavior-preserving refactoring. The [collection contract](collection.md), the
[review method](refresh-repair-audit.md#review-method), and the relevant
[provider guide](../design.md#providers) define the repository's requirements.

## Recurring failure checks

These are current requirements, not an execution log. Apply the rows affected by the change;
an unrelated cleanup does not require a fresh crawl of every source. Keep provider-specific
resolutions and remaining evidence limits in the provider guide.

| Failure pattern                                                                               | Required response                                                                                                                                                                                                                                                                                                                            |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A local probe reports a missing key although collection has one.                              | Load the repository environment and check the registered credential name before probing. Never print the value. Repeat affected probes when a key changes; an earlier authentication failure cannot describe the new key.                                                                                                                    |
| An ordinary model list is treated as the complete price API.                                  | Inspect the owned full API definition for specialized model, mode and billing methods, pagination and regional origins. Verify their exact routes and access. An undiscovered route is pending research; an observed 401/403 is an access limit. Use owned structured console data or pages for missing claims.                              |
| A successful first-party response is treated as authoritative for every field.                | Resolve authority per claim: paid model limits can differ from trial inventory; nested SDK metadata, compatibility zeros and release timestamps do not establish service limits, free prices or release dates. Validate consumed fields, not unused metadata.                                                                                |
| An account list or omitted row changes the global catalog.                                    | Require a positive public identity bridge. Account visibility cannot admit private IDs, withdraw publicly documented models, or turn an omission into an exclusion. Distinguish local, hosted, preview and retired scopes.                                                                                                                   |
| A price is joined by a plausible name, region or API enum.                                    | Require exact owned model/route/operation/currency scope. Preserve documented deployment/region and tier correlations; do not invent their Cartesian product or identify the caller's location as the serving region. Keep conflicting evidence explicit.                                                                                    |
| Parser success hides a missed table, moved guide or delegated contract.                       | Compare consumed facts with the complete relevant first-party index and companions. Follow explicit delegations. Inspect native HTML, structured console data and schema/Markdown syntax before adding heuristics or lowering completeness bounds.                                                                                           |
| Known amounts disappear because a unit, condition or usage counter is missing.                | Preserve amount, currency, native label and applicability as raw evidence when normalization is unsupported. Keep independently known rates numeric when only acquisition is unknown. An estimate, credit, promotional label or empty cell is not a tariff or a zero price; preserve date precision.                                         |
| Similar token or duration fields are used as the same billable quantity.                      | Verify total/subset partitions, protocol and terminal-event ownership, units and rounding. Aggregate cache writes do not identify a TTL; request defaults do not identify an existing cache entry. Attempt counts and displayed results do not establish completed billable work. Keep a disjoint or missing-field control.                  |
| Independent tool/service charges depend on an arbitrary model row.                            | Collect and publish them under their own subject. Model price coverage cannot prove service coverage; another protocol's counter or a related seller's tariff cannot fill a gap.                                                                                                                                                             |
| A missing companion erases unrelated facts or a retained partition appears fresh.             | Preserve claim-local versus required-bundle failure scope, diagnostics, source revisions and retention behavior. A refactor must not change failure ordering, accepted inputs or historical replay compatibility accidentally.                                                                                                               |
| An inspector presents fixed metadata as a choice or vague additional conditions as a setting. | Use the shared pricing controls and matching semantics. Hide fixed request/billing/cache controls while retaining predicates. Name affected charges and evidence gaps; keep known siblings visible. Follow the [website contract](website.md#product-shape) for dependent selectors and notes.                                               |
| A green parser/test, one provider commit or old board closes unfinished work.                 | Reconcile the requested provider list with manifests, inspect residual findings against current evidence, and trace changed facts through normal assembly and actual consumers. Separate verified producer behavior, stored-data adoption and delivery. Keep task progress in ignored state and continue until the requested list is closed. |

## Discover and judge sources

1. Define the product and the missing claim first. Identify the exact request ID, endpoint,
   operation, model field, or charge that a consumer needs. Set a finite list of positive cases,
   negative controls, and remaining questions. Inspect the manifest, current adapter, and
   published output to locate the gap.
2. Inventory first-party surfaces that can own those claims. Check the model-list API, public
   product tables, API references and OpenAPI definitions, model cards, pricing and billing
   guides, lifecycle notices, and changelog. Use a provider's documentation index or
   `llms.txt` when available. Check adjacent endpoint families, pagination, and companion
   tables. Hosted, dedicated, downloadable, trial, and account-scoped products can overlap.
3. Prefer structured data for a claim when its ownership, applicability, and date match.
   Resolve disagreements at the field level. A completed Serverless retirement notice can
   supersede a listing for lifecycle, while the listing can still identify the model.
   A model card can establish that a structured quote is an estimate. A dated launch price
   needs current evidence before it becomes a tariff. Record the chosen authority and any
   uncertainty in the provider guide.
   Do not assign equal authority merely because two pages share the provider's domain. For each
   disputed claim, distinguish an explicit positive, an explicit exclusion, and an omission. An
   incomplete table is not a negative assertion. Compare exact model/route/region/operation scope,
   field ownership, specificity, currency, and corroboration; duplicated prose is not independent
   evidence. Follow relevant first-party links beyond the first page, including current prices,
   feature guides and dated announcements. A historical announcement can corroborate availability
   but cannot alone establish a current tariff. Record the supporting and contrary evidence, the
   resolution, and any bounded inference separately. Do not invent numerical confidence scores.
4. Require an explicit bridge between identity and claims from another source. Prefer an exact
   request ID, an explicit redirect, a shared canonical link, or a provider-defined join.
   A page slug is a discovery lead. For hosted admission, verify both the request identifier
   and the hosted origin in the operation spec. An OpenAPI definition for localhost can
   describe a deployable model without establishing a public hosted route.

## Verify acquisition

- Probe the URL with the collector's actual transport and authentication scheme. Check the
  final URL, HTTP status, content type, and a small structural sample. A browser view, a curl
  probe, and a successful collector fetch are separate observations. In particular, distinguish
  an authentication error, a transport-specific WAF response, and a valid response with no
  matching public rows. Keep credentials out of URLs, logs, fixtures, and research artifacts.
  Local probes must use the same environment loading as collection:
  `vp node --env-file-if-exists=.env <probe.ts>`. Check the registered credential names after
  loading that environment before declaring credentials unavailable. An unset variable in an
  unrelated shell process does not establish that the repository has no configured credential.
- Prefer documented JSON, OpenAPI, or Markdown. When the public site is the only source,
  inspect its embedded structured data or labeled HTML before depending on visual layout.
  Bound redirects, discovered hosts and paths, pagination, document counts, bytes, and
  concurrency. Compare coverage against the full reviewed index and record incomplete pages
  or document failures.
- Assign each source a role and scope. A companion can own an independent claim such as an
  optional description, or it can be required to qualify an existing claim such as the
  applicability of a tariff. Give those failures the corresponding scope. Verify new public
  origins against the repair workflow allowlist. Keep live captures and replay notes in
  ignored task state and commit only reviewed, minimal fixtures.
- For repair research, use `fetch-catalog-evidence.ts SOURCE_ID --linked ROOT TARGET [TARGET...]`.
  `ROOT` is an exact reviewed companion or `--index`; up to four targets must each be linked by
  the preceding freshly fetched HTML or Markdown document. The receipt retains the entire
  navigation chain. Plain inline Markdown links and HTML anchors are supported; an unsupported
  link syntax is a tool limitation, not provider unavailability. Inspect other permitted public
  tools or report the concrete acquisition gap. Research links do not become collection inputs
  without a reviewed manifest/parser change and deterministic fixtures.

## Extract and prove the result

- Apply the [offer boundary](commercial-topology.md#offers-and-dimensions) before normalizing prices.
  Record evidence of a separate enrollment, obligation, resource commitment, seller/account billing
  relationship or data-use program. Separate tariffs, operation names and aggregation alone
  establish conditions, not offers. Audit model, service and capacity subjects independently.
  Preserve conditional quantity methods when combining contexts; never copy synchronous mappings
  into Batch. Record each provider's relationships, conditions, source authority and evidence limits
  in its guide. Verify extraction/replay through assembly, public lookup and UI, including
  negative combinations and the declared book/offer/condition target of canonical choices.
- Read only the fields a consumer needs. Validate external shapes at the boundary, anchor
  extraction to the owning table or schema operation, and preserve literal identifiers.
  Check the meaning of structured fields as well as their shape. An ignored OpenAPI
  compatibility parameter supplies no model limit. Keep identity, lifecycle, invocation,
  capabilities, and price evidence separable.
- A normalized unit price needs an amount, denomination, denominator and applicability.
  Usage-counter bindings are optional metadata, not a prerequisite for a known price. Join discounts only where exact eligibility and base rates are known. Keep
  separately addressed Spot model IDs distinct; route identity alone does not establish a contract. Preserve estimates or
  unresolved units as raw evidence, with the known conditions and reason. Use the shared
  pricing meters and conditions. Do not split a condition into separate terms merely because
  different values can occur within one request. See [pricing coverage](pricing-coverage.md).
- Exercise the normal collection entry point in a read-only replay, then trace the result
  through canonical assembly and the relevant lookup, export, or website
  projection. Compare before and after exact IDs, field coverage, dispositions, and selectors.
  Include neighboring rows that must stay separate, a malformed or unavailable source,
  and a realistic false-positive case. A parser count measures extraction, while a consumer
  assertion proves the intended behavior.
- Run the focused regression and the [required handoff checks](testing.md#required-validation).
  Report the verified claims, the remaining limits, and any adoption in durable data
  separately. A live replay can verify a producer without publishing a catalog. Use
  `vp run collect` only when refreshing `data/` is explicitly in scope.

## Simplify without changing evidence

Read the complete requested provider implementation and relevant tests before selecting cleanup.
Remove real repetition, redundant state or unnecessary dependencies; no change is an acceptable
review outcome. Similar-looking protocols or source rows can have different ownership and failure
semantics and must not be merged merely to shorten code.

Use existing fixtures and sibling/negative controls to verify equivalent IDs, ordering, rates,
raw evidence, conditions, accounting locators, diagnostics and source ownership. Preserve fetch
bounds, optionality, asynchronous ordering and historical input compatibility. If a change alters
source interpretation, treat it as a separate evidenced repair, including the extractor version;
do not hide it in a refactor or weaken expected results. Run the validation planner for the actual
changed dependency closure and reuse unchanged passing evidence within that boundary.
