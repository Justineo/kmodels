# Microsoft Foundry

Status: current

## Sources and identity

- The non-exhaustive regional catalog is one atomic bundle of reviewed MicrosoftDocs catalogs, lifecycle/region matrices, and fixed stable and preview Azure OpenAI v1 specifications.
- IDs come only from labeled model cells. Identity is exact `model.name` plus optional `model.version`; never slugify or guess a version.
- Keep internal provider ID `azure`. Join versioned, versionless, and case-only evidence only when exact or unambiguous. Keep ambiguous versionless rows separate.
- Preserve exact, multi-valued service families: Azure OpenAI, Foundry Models sold by Azure, and partner/community models.
- Do not duplicate these rows into an `azure-openai` provider without a separate authoritative standalone catalog.
- Enable optional ARM inventory with `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_SUBSCRIPTION_ID`, and `AZURE_LOCATION`.

## Mapping

- Tasks are non-exclusive and stay bound to the observed model/version.
- Attach Azure OpenAI endpoints only from Azure OpenAI catalog evidence or its exact batch matrix, validated against fixed operation/path specifications.
- Other Foundry rows do not inherit Azure OpenAI endpoints from a task or type.
- Keep exact `{region, deployment_type}` pairs, lifecycle versions, and replacements.
- Optional ARM inventory is subscription/region scoped. It may enrich exact tuples; Retail Prices joins require exact meter IDs. Never fuzzy-match price names, create rows, or retain ARM data.

## Kong AI Gateway

Compatibility requires all of:

1. Azure OpenAI service-family evidence.
2. An exact endpoint for the requested operation.
3. Active lifecycle and acceptable maturity.
4. A compatible region/deployment pair.
5. The user's deployment-name binding.

Legacy Completions in the service specification is not model support without an exact positive relation.
