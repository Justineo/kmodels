# Register as a provider

`hfModel` is the name of the model on HF in `namespace/model-name` form. The API validates that
`hfModel` is indeed of `pipeline_tag == task`. "staging" models are only available to members of the
partner's organization; providers switch them to "live" when they're ready to go live. After mapping
creation, Hugging Face automatically tests whether the Partner API handles huggingface.js/inference
calls for the relevant task.

`GET /api/partners/{provider}/models?status=staging|live` is publicly accessible and returns the
complete mapping grouped by task. Each live model is tested every 6 hours; failed mappings undergo
retesting every hour.

Hugging Face records a placeholder cost, then a background job runs every minute and retrieves the
actual provider cost. The response reports cost in nano-USD (10^-9 USD).

The job handles up to 10,000 request IDs and retries for roughly 30 minutes. Only requests that
completed successfully are billed. Responses provide an `Inference-Id`.

Provider model catalogs publish Price in US dollars per million input tokens.
