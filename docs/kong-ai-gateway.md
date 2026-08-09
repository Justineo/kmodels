# Kong AI Gateway consumer boundary

Status: implemented

Kmodels supplies model evidence to Kong AI Gateway 2.0. It is not a Kong model allowlist. Provider sources remain authoritative for identity and model facts; Kong documentation remains authoritative for adapters, capabilities, upstream APIs, and native formats.

This document is design guidance for a downstream compatibility projection.
The canonical catalog and price book contain no Kong-specific source dependency,
field, allowlist, configuration shape, or compatibility decision. Kong's product
direction may inform review of Kmodels' provider-neutral workload ontology, but
it never establishes or removes a provider model or price fact.

## Compatibility

- Compatibility is versioned and route-specific. It requires the Kong provider, Kong capability, upstream surface or native format, exact provider ID or official alias, lifecycle, and every required region, deployment, account, or runtime scope.
- Never publish or infer one context-free `supported_by_kong` boolean. A future projection must retain its evidence.
- Provider membership and normalized `tasks` never prove Kong support. Chat versus completions, Converse versus InvokeModel, and `generateContent` versus `predictLongRunning` require exact route evidence.
- Kong documentation examples demonstrate configuration shape. They are not identity allowlists or lifecycle authorities and never restore missing, deprecated, or retired provider rows.
- Current deployment candidates require positive active lifecycle, an acceptable release stage, exact route/capability evidence, and the relevant scoped availability. Unknown scope remains unknown.
- Historical deprecated and retired rows remain valid catalog history but are not current recommendations.
- Cloud platforms, gateways, publishers, and runtimes are distinct. A base model does not prove a deployment name, an artifact does not prove a self-hosted route, and a library entry does not prove installation.
- Keep accurate provider tasks even when Kong does not support them. Consumers derive the supported intersection without deleting provider facts.

Provider-specific intersections belong in a separate versioned consumer projection, not in provider collection rules or documents.
