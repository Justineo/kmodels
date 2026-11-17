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
rejected without truncation. Source ownership and same-provider closure are collection-boundary
requirements; schema acceptance alone does not establish those relationships or adoption in
stored data.
