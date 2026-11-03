# Hugging Face HF Inference

Status: current

Kmodels covers [HF Inference](https://huggingface.co/docs/inference-providers/en/providers/hf-inference),
the Hugging Face-operated serverless inference provider. A Hub repository qualifies when an exact
concrete mapping names `hf-inference` with status `live`, a provider model ID, and a task.
Router listings, partner mappings, documentation recommendations, and ordinary Hub repositories
cannot establish eligibility. The catalog includes all qualifying tasks. An unfamiliar task keeps
its raw route while canonical tasks and modalities remain unknown.

The [Hub API](https://huggingface.co/docs/inference-providers/en/hub-api) lists candidates with
`inference_provider=hf-inference`. One paginated query expands `inferenceProviderMapping` and
`lastModified`, so each page provides eligibility, task, provider model ID, and optional repository
update date together. The filter selects candidates and each mapping independently proves live
support. The collector ignores staging and third-party mappings, dynamic mappings, and invalid
identifiers. Identical routes collapse and distinct live tasks are preserved. Repository
modification supplies an update date when valid.

The source is exhaustive after all validated cursor pages complete. A failed page, a repeated
cursor, or a response with no qualifying models fails refresh and uses normal provider fallback.
After a successful refresh, models without a qualifying mapping leave the current catalog.

The [pricing guide](https://huggingface.co/docs/inference-providers/en/pricing) describes billing by
compute time and underlying hardware price. Public mappings provide neither a request hardware SKU
nor billed duration, so public request pricing is unknown. The refresh collects no third-party
rates or router price associations. A successful catalog-only refresh clears the previous routed
pricing partition in the same publication. If collection fails, the accepted catalog and pricing
pair follow the normal stale fallback.
