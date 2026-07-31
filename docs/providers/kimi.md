# Kimi

Status: current

## Sources and identity

- Kimi has China and international API platforms. Use the international OpenAPI contract for callable routes, the labeled China model catalog for lifecycle, and both regional pricing surfaces for commercial facts.
- The non-exhaustive public catalog unions the exact OpenAPI Chat Completions discriminator mapping with labeled current and retired model tables. A current discriminator entry establishes active callability unless stronger lifecycle evidence says legacy or retired.
- A route exists only when the discriminator and referenced request enum agree. Rows observed only in models, pricing, lifecycle, or releases never inherit it.
- Parse restricted and retired IDs, series prefixes, dates, and replacements from their notices. Do not encode particular model families in the extractor.
- Join release titles only when their normalized identity uniquely matches an exact ID from the current model catalog. Exact IDs in the changelog remain direct evidence; unrelated research titles are ignored.
- Optional international `.ai` inventory is account-scoped. It may enrich exact public IDs; omitted flags stay unknown. It cannot create/remove rows or retain raw data.
- Preserve every independently matching source reference.
- Enable the optional inventory with `MOONSHOT_API_KEY`.

## Mapping

- Parse official pricing MDX statically without executing page code, including reviewed JSX currency literals.
- Preserve China CNY and international USD cached input, uncached input, output, and Batch rates. Region and Batch tier are explicit applicability conditions; no regional price is an unconditional global default.
- The table publishes no effective dates. Treat its rows as current observations; never infer historical start/end dates from collection time.
- Validate the OpenAPI server, response-format enum, streaming type, function-tool reference, prompt-cache field, thinking controls, effort values, discriminator mapping, and request enum before publishing capabilities.
- Map prose-only output ceilings from the OpenAPI field description only when a published display name resolves uniquely to an exact discriminator ID; do not encode a model-specific limit table.
- Attach `/v1/batches` only to exact Batch pricing rows while the fixed create-batch reference retains its reviewed operation and payload endpoint.
- Exclude the web-search charge while its own source says it is outdated and the implemented pricing schema cannot bind the add-on coherently.
- Preserve `legacy` for models still callable only by existing users; do not flatten it into deprecation.
- Do not convert API object creation timestamps into first-public-availability dates.

## Kong AI Gateway

- Kong has no native Kimi provider.
- Kimi's OpenAI-compatible route does not prove that Kong's OpenAI adapter targets Kimi or accepts its IDs.
- Report no Kong-native intersection until Kong publishes one.
