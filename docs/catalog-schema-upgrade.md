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
