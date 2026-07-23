# Azure AI Foundry refinement

Status: implemented and replayed against catalog snapshot `2026-07-22T17:04:19.221Z` and the current official Azure OpenAI v1 specifications

## Catalog assessment

The deterministic replay produces 221 rows: 124 active, 46 preview, 31 deprecated, 12 retired, and eight unknown. The extra row is the officially listed versionless `model-router`; because several current versioned tuples exist, the collector retains the source identity instead of assigning its facts to an arbitrary version.

This remains a non-exhaustive Foundry platform catalog, not an Azure OpenAI allowlist. Identity is the exact model name plus an optional separately observed version. Versioned catalog facts join only exact tuples; versionless and case-only facts join only when the current target is unique.

Every row now has positive family evidence. The replay observes 103 Azure OpenAI memberships, 66 Foundry Models sold by Azure memberships, and 56 partner/community memberships; four exact tuples occur in two official families. Families are therefore multi-valued and are not derived from publisher or normalized operation type.

The public documents still provide no pricing join or subscription-specific availability. The optional ARM inventory remains the only source for exact regional account/SKU facts, and Retail Prices remain joined only by ARM billing meter ID.

## API and Kong compatibility

The atomic source includes the fixed stable and preview Azure OpenAI v1 specifications. Catalog rows and the Azure OpenAI batch matrix provide positive model-to-operation evidence; the specifications validate the server base, exact path, and operation ID. A changed reviewed operation fails the source instead of silently publishing stale paths.

The replay attaches 107 endpoint facts to 73 rows across batch, chat completions, embeddings, responses, realtime sessions, speech, transcription, translation, image, and video operations. Legacy completions remains in the validated service specification but is not attached to a model because the current catalog does not make an exact positive model relation. Other Azure-sold and partner/community rows never inherit Azure OpenAI endpoints from a broad matching `type`.

Kong's Azure provider is specifically Azure OpenAI, and requests address a user-created deployment name rather than the base `model_id`. Compatibility therefore requires all of:

1. `Azure OpenAI` in `service_families`;
2. an exact positive `api_endpoints` entry for the requested operation;
3. an active or preview base model/version;
4. a compatible region/deployment-type pair; and
5. the user's deployment-name binding.

Pricing and account availability remain unresolved until the optional ARM and Retail Prices join succeeds.
