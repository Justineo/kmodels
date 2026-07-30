# Microsoft Foundry

Status: current

## Sources and identity

- The non-exhaustive regional catalog is one atomic bundle of reviewed MicrosoftDocs catalogs, lifecycle/region matrices, and fixed stable and preview Azure OpenAI v1 specifications.
- IDs come only from labeled model cells. Identity is exact `model.name` plus optional `model.version`; never slugify or guess a version.
- Keep internal provider ID `azure`. Join versioned, versionless, and case-only evidence only when exact or unambiguous. Keep ambiguous versionless rows separate.
- Preserve exact, multi-valued service families: Azure OpenAI, Foundry Models sold by Azure, and partner/community models.
- Do not duplicate these rows into an `azure-openai` provider without a separate authoritative standalone catalog.
- Collect current USD consumption rates from the public, unauthenticated Azure Retail Prices API. It covers Foundry meters across regions and SKUs; it does not establish negotiated discounts or subscription-specific availability.
- Enable optional ARM inventory with `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_SUBSCRIPTION_ID`, and `AZURE_LOCATION`. Missing credentials must not suppress public retail pricing.

## Mapping

- Tasks are non-exclusive and stay bound to the observed model/version.
- Attach Azure OpenAI endpoints only from Azure OpenAI catalog evidence or its exact batch matrix, validated against fixed operation/path specifications.
- Other Foundry rows do not inherit Azure OpenAI endpoints from a task or type.
- Keep exact `{region, deployment_type}` pairs, lifecycle versions, and replacements.
- Retail SKU parsing is a reviewed provider grammar, not fuzzy matching. The initial grammar covers Azure OpenAI product groups; other Foundry and partner product groups remain unknown until their SKU semantics are reviewed. It may attach a rate only to an exact model/version or to one unambiguous version of an existing public model. Ambiguous or unsupported SKUs remain unmodeled, and pricing evidence never creates catalog rows.
- Preserve the retail region, deployment class, service tier, context tier, native unit, and effective-start label. The Retail Prices endpoint establishes that returned consumption rows are the current snapshot, so its effective-start label is retained as raw evidence rather than treated as a historical-only validity constraint.
- When one exact SKU family contains an unequal explicit long-context row, its otherwise identical unqualified row is the standard context tier. This reviewed pair rule does not apply to ambiguous or unmatched retail rows.
- Optional ARM inventory is subscription/region scoped. It may enrich exact model tuples and provides the strongest meter-ID join for that configured scope, but it cannot define the global catalog or the complete public price book.

## Kong AI Gateway

Compatibility requires all of:

1. Azure OpenAI service-family evidence.
2. An exact endpoint for the requested operation.
3. Active lifecycle and acceptable maturity.
4. A compatible region/deployment pair.
5. The user's deployment-name binding.

Legacy Completions in the service specification is not model support without an exact positive relation.
