# Agent guidelines for provider research and collection

Use this workflow when adding a provider, revisiting its source coverage, or investigating
missing or conflicting model facts. The [collection contract](collection.md), the
[review method](refresh-repair-audit.md#review-method), and the relevant
[provider guide](../design.md#providers) define the repository's requirements.

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

## Extract and prove the result

- Apply the offer/condition decision rules in [Commercial topology](commercial-topology.md#offers-and-dimensions)
  before normalizing a price table. Record the exact source evidence for an independently selectable
  mechanism, or explain why the distinction only qualifies an existing mechanism's rates. Provider
  labels such as Standard, Online, Realtime and operation are not shared semantics by themselves.
  Review the request/result aggregation and acquisition contracts when splitting an offer; Batch
  cannot inherit synchronous response paths merely because its meters have the same names.
  Verify both the producer's canonical offer boundary and selection through the public
  `choices` query, including a sibling condition that must remain inside the offer. Emit evidenced
  selection scope in the owning commercial adapter; model tasks, endpoint support and transport
  tags are not tariff proof. Preserve partial coverage, native bindings and requested/served
  distinctions as specified in [Commercial selection](offer-semantics-design.md).
- Read only the fields a consumer needs. Validate external shapes at the boundary, anchor
  extraction to the owning table or schema operation, and preserve literal identifiers.
  Check the meaning of structured fields as well as their shape. An ignored OpenAPI
  compatibility parameter supplies no model limit. Keep identity, lifecycle, invocation,
  capabilities, and price evidence separable.
- A normalized rate needs a currency, denominator, applicability, and a supported usage
  binding. Join discounts only where exact eligibility and base rates are known. Keep
  separately addressed offers such as Spot under their own IDs. Preserve estimates or
  unresolved units as raw evidence, with the known conditions and reason. Use the shared
  pricing selectors and quantity model. See [pricing coverage](pricing-coverage.md).
- Exercise the normal collection entry point in a read-only replay, then trace the result
  through canonical assembly and the relevant lookup, calculation, export, or website
  projection. Compare before and after exact IDs, field coverage, dispositions, and selectors.
  Include neighboring rows that must stay separate, a malformed or unavailable source,
  and a realistic false-positive case. A parser count measures extraction, while a consumer
  assertion proves the intended behavior.
- Run the focused regression and the [required handoff checks](testing.md#required-validation).
  Report the verified claims, the remaining limits, and any adoption in durable data
  separately. A live replay can verify a producer without publishing a catalog. Use
  `vp run collect` only when refreshing `data/` is explicitly in scope.
