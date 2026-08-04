# Register as a provider

Hugging Face records a placeholder cost, then a background job runs every minute and retrieves the
actual provider cost. The response reports cost in nano-USD (10^-9 USD).

The job handles up to 10,000 request IDs and retries for roughly 30 minutes. Only requests that
completed successfully are billed. Responses provide an `Inference-Id`.

Provider model catalogs publish Price in US dollars per million input tokens.
