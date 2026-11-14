# Hugging Face HF Inference

Status: current

## Offer boundary

[Shared ownership rules](../commercial-topology.md#offers-and-dimensions) govern this provider.

The admitted subject is HF-operated HF Inference, not partner routing. Public hardware/compute billing prose does not identify a request SKU or measured duration, so there is no established public per-model offer to normalize. Keep pricing unknown. Do not recreate router partner offers, infer free usage from credits, or admit dedicated/account products through this boundary change.

The source authorities and evidence limits below remain authoritative. This catalog-only provider
has no admitted price partition or source offer contexts to migrate.

Kmodels covers [HF Inference](https://huggingface.co/docs/inference-providers/en/providers/hf-inference),
the Hugging Face-operated serverless inference provider. A Hub repository qualifies when an exact
concrete mapping names `hf-inference` with status `live`, a provider model ID, and a task.
Router listings, partner mappings, documentation recommendations, and ordinary Hub repositories
cannot establish eligibility. The catalog includes all qualifying tasks. A task in the Hub task
vocabulary maps through the shared canonical task mapping, so the masked-language (`fill-mask`),
extractive (`question-answering`) and tabular (`table-question-answering`) question-answering
pipelines resolve to `text_generation` alongside the other Hugging Face text-output pipelines. A
task outside that vocabulary keeps its raw route while canonical tasks and modalities remain
unknown.

The [Hub API](https://huggingface.co/docs/inference-providers/en/hub-api) lists candidates with
`inference_provider=hf-inference`. One paginated query expands `inferenceProviderMapping` and
`lastModified`, so each page provides eligibility, task, provider model ID, and optional repository
update date together. The filter selects candidates and each mapping independently proves live
support. The collector ignores staging and third-party mappings, dynamic mappings, and invalid
identifiers. Identical routes collapse and distinct live tasks are preserved. Repository
modification supplies the latest valid update date among qualifying rows for that repository.

The source is exhaustive after all validated cursor pages complete. A failed or redirected page, a repeated
cursor, or a response with no qualifying models fails refresh and uses normal provider fallback.
After a successful refresh, models without a qualifying mapping leave the current catalog.

The complete first-party documentation index, Hub API reference, provider page and billing guide
have distinct roles. Provider-page task examples are a discovery aid, not an exhaustive inventory
or an exclusion of live tasks returned by the API. Repository configuration describes weights and
does not establish hosted context limits or service capabilities.

The documented [Router model API](https://router.huggingface.co/v1/models) is a separate,
chat-only comparison surface. Its `providers` entries can contain token prices, context limits,
tool support and temporary free flags, all owned by the specifically named serving provider.
Those facts cannot price HF Inference merely because the same repository appears in the router.
The task-complete Hub inventory remains authoritative for this provider; unrelated router entries
are not collected as HF-operated offers or used as metadata for its routes.

The [pricing guide](https://huggingface.co/docs/inference-providers/en/pricing) describes billing by
compute time and underlying hardware price. Public mappings provide neither a request hardware SKU
nor billed duration, so public request pricing is unknown. The refresh collects no third-party
rates or router price associations. A successful catalog-only refresh clears the previous routed
pricing partition in the same publication. If collection fails, the accepted catalog and pricing
pair follow the normal stale fallback.
The hardware amount in the guide's FLUX example is an illustration, not a public request SKU.
The Enterprise organization-usage API reports delayed daily account costs rounded to cents. It
does not expose a public hardware tariff or repair the missing request SKU/duration relationship;
zero rounded usage is not free inference. That account ledger is outside this collector's inputs.
