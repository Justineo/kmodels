# Catalog schema scope

Status: current

The current design is [Inference model ID pricing](inference-pricing.md). It associates the exact provider-owned inference model ID
with canonical prices and necessary commercial conditions.

Full invocation protocol modeling, request templates, capability discovery, lifecycle policy and
account-resource configuration are outside this delivery. They must not gate price lookup.

The [minimal data contract](inference-pricing.md#minimal-data-contract) reuses canonical price books
and evidence without target/case identifiers. ID associations are an additive resource bound to the
accepted catalog and prices, preserving the original payloads and exact calculator.

The [implementation limits](inference-pricing.md#compatibility-and-implementation-limits) identify
adapter coverage and consumer requirements. A design decision does not establish
that a mapping has been adopted in stored data or deployed.

## Scoped limit details

The internal model schema permits optional `limit_details`, independently of legacy scalar
`limits`. Each strict group identifies its owning `source_ref` and adapter-owned `claim`, with
bounded statements and one to three document revisions. A statement distinguishes a finite
maximum, a default, or no separate provider cap; it always names its quantity, measurement and
complete display scope. Scope text is evidence for readers, not executable request conditions.
Shared context describes one combined budget, never an independent output grant.

The optional field has no default so existing records remain unchanged. Empty statements are
an evidenced withdrawal receipt; an absent group is unobserved. Claims are independently owned
and must not overwrite another source or claim. Evidence carries its original document URL,
locator, observation time, SHA-256 and excerpt, so retained facts cannot acquire a newer source
record's clock. The field is bounded to eight groups and 16 KiB of UTF-8 JSON. Invalid input is
rejected without truncation. Collection and full catalog-pair preparation both require declared,
same-provider source ownership. Serial preparation, parallel preparation, snapshot recovery and
mirror bootstrap validate this relationship before projecting public assets. Schema acceptance
alone does not establish those relationships or adoption in stored data.

Collection replaces an observed `(source_ref, claim)` group atomically, including evidenced
empty withdrawals. Missing groups retain their last verified revision independently of
`retainOmittedFacts`, so a failed optional companion does not restore old ordinary card limits.
This requires an unchanged owning extractor version; changed interpretations do not inherit
old groups. Claim-local dependency failures leave successful model observations fresh. Whole
bundle failures retain the existing broader fallback policy. Invalid, duplicate, oversized or
unowned detail observations produce a local diagnostic while identity and pricing stay usable.
The owner must be a public source declaring `limit_details`, and evidence URLs must belong to
its allowed hosts. Independent groups preserve their own document clocks even when the source
record has been refreshed.

## Scoped capability details

The optional internal `capability_details` field uses the same bounded, source-owned claim and
document revision structure as `limit_details`. Each field has independent bounds and claims.
Capability details allow ten groups within the same 16 KiB limit. This accommodates three
operation-specific effort claims and two independently retained cache claims in each of Kimi's
two documented markets.
Prompt-cache observations give the implicit or explicit mode and an evidenced support state for
one API scope. Reasoning-effort observations preserve documented native option spellings,
explicit exclusions and an independently evidenced default. A documented default can establish
its own support when a partial option list omits it. Each statement states its API scope.

Collection, retention, ownership validation and full snapshot binding use the same claim rules
as qualified limits. Both detail fields remain optional and independently populated. Bad
capability observations do not revoke limits, model identity or pricing. Legacy audit and v1
profiles omit both detail fields, while the private accepted manifest commits the full core.
