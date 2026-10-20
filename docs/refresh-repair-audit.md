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

## Review method

### Set a finite scope

For a targeted repair, use the admitted candidates, publication boundary and investigation deadline.
Preparation selects one error-driven provider per UTC day against the stable configured-provider
rotation, keeping all of that provider's source and validation candidates together. It also admits
the independent periodic slot and workflow evidence items. Other candidates stay in the prepared
deferred queue and latest refresh report; they are neither resolved nor part of this run's closing
list. A continuously failing provider gets its own slot at least once per configured-provider cycle;
same-day reruns select from the latest evidence. Closing a batch is not a whole-catalog health claim.
Source-acquisition review follows the admitted providers too; an unrelated transport failure must
not silently expand a bounded batch. Keep those failures visible in the full refresh report. The
periodic architecture slot reviews acquisition globally, and execution failures remain workflow-wide.
For a comprehensive review, define the provider queue and acceptance conditions first. Prioritize
wrong prices or quantities, identity loss, misleading states and regressions; select further cleanup
only for a concrete correctness or maintenance benefit. Complete provider rounds and a concentrated
shared review, then freeze the closing list. Reopen accepted work for new concrete defects, not to
exhaust every possible coverage improvement.

A non-blocking hypothesis outside the admitted work gets a bounded source/local investigation and
an explicit limitation if evidence remains insufficient. This does not waive the evidence or status
requirements for an admitted candidate. Correct invocation errors and test an independent explanation
before calling a source, contract or tool unavailable. Neither time spent nor a scheduled review slot
establishes completion. Keep execution progress local; update guides with the current rule and reason.

### Follow the claim through its owners

Read the complete requested provider/module scope, including its discovery and transport dependencies,
parser, commercial/accounting mapping and consumers. An ordinary localized repair does not require
reviewing unrelated providers. For each affected claim, establish:

- **Native authority:** the exact model, route, API family, table/section or typed field that owns the
  claim. Visible labels and local headers establish meaning; internal DOM keys, quoted examples,
  similarly named SDK fields and neighboring tariffs do not supply missing semantics. Inspect
  first-party navigation as well as the currently configured source set: a missed page can omit a
  tariff without producing a parse error.
- **Independent facts:** distinguish identity/capability, numeric price, billable quantity,
  acquisition method and selector evidence, using [pricing coverage](pricing-coverage.md). Preserve
  known siblings and explicit unknowns. Validate fields actually consumed by those facts; do not
  add audit-only fetches or make a service fact depend on an arbitrary model carrier.
- **Consumer behavior:** follow parsed facts through canonical scope, retention, persisted revisions,
  calculation exports and UI projection. Confirm the original defect disappears without changing
  unrelated facts. When quantity or scope changes, exercise both a known calculation and a relevant
  unknown/missing-input or disjoint-scope control. Use distinct quantities where totals overlap cache
  or modalities so a superficially plausible total cannot hide a wrong mapping.

Fix the owning parser or shared boundary. A UI exception, synthetic commercial state or raw-text
control protocol must not compensate for an unresolved source contract. After a justified change,
review the full requested scope for removable repetition, indirection and unconsumed dependencies;
preserve observable contracts and leave already-clear code alone.

### Verify the repair at the changed boundary

Replay the actual affected parser/assembly on saved first-party evidence, with the reviewed manifest
and required catalog context. Use a reduced fixture that retains the relevant ownership, labels,
types and scope, and demonstrate the old failure when practical. Passing neighboring fixtures or
fallback behavior is not reproduction. Assertions should test the claim and its independent siblings,
not mirror implementation structure. Do not add tests that merely assert this guide's wording.
Preserve existing negative controls during repair. Do not delete a failing case or weaken its
assertion to make a patch pass; first establish whether current owned evidence actually changes
that contract. Verify an acquisition locator's complete parent/leaf path, not just nearby matching
tokens. A repair report and passing tests do not replace review of the proposed diff.

Check whether a producer fix also affects accepted stored data; changing an extractor does not repair
an older partition automatically. Use offline pricing compilation only with admitted inputs and
current extractor/revision guards, and projection preparation only when the canonical pair is already
correct. Do not force an obsolete replay to make a source fix appear adopted. Changes to executable
pricing or exported scope need proof in the actual built/packed consumer path as well as in-memory
assembly. Run focused checks during editing and the required full gate after the final relevant edit;
revalidate changes from upstream before delivering that exact tree. Workflow publication permissions
and retry limits remain owned by [Automation](automation.md).

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

An operator-authorized historical-data repair pins the accepted pair and original source revisions
before mutation. Prove which interpretation is unsupported, and assert that literal source quotes,
evidence revisions, observation clocks and unaffected facts survive. Without the original evidence needed to
establish a replacement, withdraw the unsupported interpretation to raw/unknown; do not flip a label,
add a new API contract or backdate a current observation into that snapshot. Publish through normal
pair preparation/commit APIs so validation, projections and crash recovery remain intact.

If upstream data advances, compare the common ancestor, local normalization repair and incoming
facts. Keep new identities/quotes and their true revisions; carry local corrections only across
unchanged claims, and investigate overlapping changes explicitly. Preserve retained price-source
revisions separately from current catalog metadata and unaccepted candidate inputs. Pin the reviewed
candidate again before publishing. Automatic repair still cannot edit generated data or bypass its
admitted patch boundary.

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
