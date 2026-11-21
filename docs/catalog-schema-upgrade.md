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

The internal model schema permits optional `limit_details` to qualify existing fields in
`limits`. Each strict group identifies its owning `source_ref` and adapter-owned `claim`, with
bounded statements and one to three document revisions. Statements preserve their quantity,
measurement, and finite maximum, default, or explicit absence of a separate cap. The source's
`scope` is retained with the claim for audit and replay.

A visible annotation needs a complete structured `applicability`: a provider-owned endpoint
and, when required, the presence or absence of an exact beta value in a named request header.
Use the endpoint spelling from the provider adapter. Output annotations distinguish text-only
from general output and measure each response. Context annotations describe a shared budget.
Finite maxima and explicitly absent caps can annotate a field. Defaults, per-hop measurements,
and richer request conditions stay outside this presentation. The existing detail envelope
accepts older observations without the optional binding, which cannot supply visible notes.

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

Detail chunk version 13 adds explicit capability support by interface, market-specific
registration conditions and account-tier model limits. A rounded published maximum retains
its native label separately from an exact numeric limit. Writers select this version only
when one of those facts occurs. Website
consumers can interpret support or exclusion independently of the coarse model flag. The
legacy audit envelope and v1 semantic profiles continue to omit these internal details.

The optional internal `capability_details` field uses the same bounded, source-owned claim and
document revision structure as `limit_details`. Each field has independent bounds and claims.
Capability details allow ten groups within the same 16 KiB limit. This accommodates three
operation-specific effort claims and two independently retained cache claims in each of Kimi's
two documented markets.
Prompt-cache observations record each implicit or explicit mode documented as usable for one API
scope. An unsupported or excluded mode is not stored; its absence is the record. Reasoning-effort
observations preserve documented native options and independently evidenced defaults; effort
exclusions are not stored either. A documented default can establish its own support when a partial option list
omits it. Each statement names its documented scope.
Optional `applicability` retains an interface label and, where documented, a native parameter
and residual condition. The interface and parameter are bounded to 128 characters each and the
condition to 768. The original scope remains required. The website version-selects structured
detail chunks independently of the private catalog envelope and the legacy public profiles.

Stored data written before that rule carries a cache `supported` flag or effort
`unsupported_values`. The strict schema rejects both, and `migrateCatalogStorage` removes them on
read. Because the full core hash covers capability details, a read-time migration alone breaks the
stored pricing, inference and replay bindings, so accepted data is adopted explicitly with
`scripts/migrate-capability-statements.ts`. Dry run is the default; `--write` backs up the
mirrors to `capability-statements.local/` and adopts the pair through normal preparation. It
recomputes changed provider versions and the core catalog version with the collector's
derivation, and rebinds the unchanged pricing data, inference mapping and replay input. It asserts
that only capability statements and those versions change and that group evidence is preserved,
and it is idempotent. Run it on the latest hydrated snapshot, validate, publish that snapshot,
and land the resulting pointer with the schema change: main cannot load an older-format snapshot.

Collection, retention, ownership validation and full snapshot binding use the same claim rules
as qualified limits. Both detail fields remain optional and independently populated. Bad
capability observations do not revoke limits, model identity or pricing. Legacy audit and v1
profiles omit both detail fields, while the private accepted manifest commits the full core.
