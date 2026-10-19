# Refresh and repair evidence

Status: current

## Decision

Treat source acquisition, extraction contracts, catalog acceptance, pricing acceptance and repair
investigation as separate decisions. A successful publication does not prove complete commercial
coverage. A diagnostic does not establish a code defect, and an unavailable source does not
establish that its published schema changed.

[Collection](collection.md) owns transport, source roles, retention and durable publication.
[Automation](automation.md) owns the repair sandbox, trusted checks and delivery. Provider guides
own exact identities, pricing policies, known source limits and reviewed fixtures.

## Diagnostic boundaries

- Acquisition reports native HTTP status, bounded sanitized errors and independent dependency
  histories. Authentication, configuration, reviewed URL controls and resource limits remain
  operational failures. Invalid successful-response JSON, owned envelopes and contradictory
  pagination are extraction-contract failures even when the transport discovers them.
- An optional dependency reports its own cause and `bundle` or `claim` impact. A claim-local failure
  can coexist with fresh independently observed facts. A missing rate bundle retains the complete
  commercial partition; optional accounting-only omissions remove acquisition mappings without
  erasing known rates. An explicit required-input policy still applies.
- A fetched document whose interpretation failed remains failed. Its successful HTTP response
  cannot reset its failure streak or last-success time. Recovery resets that history; dependencies
  no longer observed by the current source are retired.
- Contract findings retain their original observation cohorts, including callbacks before a later
  exception. Cohorts can overlap or measure different populations; never add their denominators.
  Reports bound contract findings and dependency failures independently to 16 entries each, retain
  deterministic ordering and expose omitted counts.
- Accepted local contract loss, unrelated additive extensions and rejected publication remain
  distinct signals. Native price-cell reconciliation is separate from catalog and usage-schema
  diagnostics. A source investigation retains independent provider or pricing validation context.

## Investigation admission

Repair investigates persistent consumed-contract drift even when bytes are unchanged. A purely
additive field does not retrigger solely because it persists. Truncated evidence remains reviewable.
Known missing accounting, endpoint, identity, currency, owned tariff/API scope, tier and served-tier
contracts can require investigation while publication succeeds. An unknown meter or unbound product alone is not proof
of an implementation defect.

This includes a previously consumed card input/output amount, public API price field or cache
billing policy becoming unreadable. The native reconciliation reason and bounded sample survive
even when accepted source bytes and a retained commercial partition are unchanged. Generic usage
envelopes and unused SDK/promotion types are not monitored as pricing contracts.

A public source or dependency with two consecutive HTTP 404/410 failures enters relocation review.
Native status is authoritative; prose matching exists only for older reports without that field.
A source move requires an independent first-party index or link and verified replacement content.
Transient acquisition and authentication failures remain incomplete evidence, rather than parser
repair instructions. Missing optional credentials remain normal configured scope.

Every admitted candidate needs a conclusion backed by actual parser replay, source evidence and a
concrete alternative diagnostic. Independent repairs may complete while another candidate remains
blocked. A failed investigation cannot be dismissed because neighboring fixtures pass or the
published fallback is valid.

## Periodic review

The existing daily serialized repair job also rotates one provider review per UTC day, followed by
a global architecture review. The current 20 providers therefore form a nominal 21-day cycle.
This review is independent of error-triggered candidates and examines discovery, identity,
lifecycle, pricing inventory and scopes, accounting, retention, replay, calculator/display behavior
and simplicity against current first-party evidence.

A calendar slot is an attempt, not proof of completed coverage. Failed or unfinished reviews remain
incomplete. The workflow artifact retains conclusions and evidence limits. This complements
targeted repair without introducing another scheduler.

## Evidence and conclusions

The manifest-backed evidence CLI reports source/dependency hashes, fetch outcomes and attempt
times. Refresh retains hashes and sanitized diagnostics rather than original response bodies.
A refetch establishes current state; only a matching hash establishes identical refresh evidence.
Hash mismatch limits historical attribution, but does not invalidate an independently reproduced
current defect. Authenticated bodies cannot become public evidence artifacts.

When discovery rejects a bundle, `fetch-catalog-evidence.ts SOURCE_ID --index` retrieves its reviewed
root index. Examine first-party navigation and exact paths before concluding that commercial
content is unpublished. Do not weaken count, identity or trust bounds to make an investigation pass.

A healthy no-op is permitted only when every admitted candidate has independently checked
`not_a_defect` evidence and the patch is empty. Missing evidence, blockers, pending reviews and
repaired candidates cannot become a healthy no-op. Missing acquisition evidence has its own
admission item, so an unrelated healthy review cannot hide it.

A repaired outcome requires a concrete admitted patch, all four repository validations and
portable-package checks. The trusted publication job applies it to latest `main`, repeats
validation and commits the exact validated tree with a normal non-force push. Conflicts, rejected
pushes and missing delivery fail that repaired outcome. A verified no-op requires no publication.
Investigation or framework failure creates no issue. Remote execution and delivery are verified
by their CI outcomes, not inferred from local fixtures.

## Evidence limits

Reviewed URL discovery checks selected hosts, paths, suffixes and counts; it does not inventory
every excluded link. Fetched-page coverage and parser coverage therefore need independent review.
Retained pricing, accepted counts and unchanged hashes cannot establish semantic completeness.

Unavailable public rates, ambiguous denominators, missing acquisition fields and private
adjustments remain explicit unknown or raw facts with local incomplete-cost behavior. Provider
guides describe those boundaries; copied search results, naming resemblance and another provider's
price cannot supply missing first-party authority.

Use deterministic code for established rules, identities, units and mappings. Use the repair agent
for evidence gathering, multi-document investigation and executable regressions. The Vercel Jev
checks remain manual experiments; scheduled refresh and repair do not run that classifier.
Consider an additional intelligent node only when independently reviewed real cases show repeated
semantic decisions left after these checks. Include insufficient evidence and measure incremental
confirmed defects, false dismissals, unnecessary reviews and investigation cost.
