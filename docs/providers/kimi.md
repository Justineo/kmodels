# Kimi

Status: current

## Sources and identity

- The non-exhaustive public catalog unions the exact OpenAPI Chat Completions discriminator mapping with labeled current and retired model tables.
- A route exists only when the discriminator and referenced request enum agree. Rows observed only in models, pricing, lifecycle, or releases never inherit it.
- Join context, names, cache support, and dates only through the same row or one unique reviewed identity.
- Optional international `.ai` inventory is account-scoped. It may enrich exact public IDs; omitted flags stay unknown. It cannot create/remove rows or retain raw data.
- Preserve every independently matching source reference.
- Enable the optional inventory with `MOONSHOT_API_KEY`.

## Mapping

- Parse official pricing MDX statically without executing page code.
- Preserve CNY cached input, uncached input, output, and Batch rates. Batch is a tier condition.
- The table publishes no effective dates. Treat its rows as current observations; never infer historical start/end dates from collection time.
- Attach `/v1/batches` only to exact Batch pricing rows while the fixed create-batch reference retains its reviewed operation and payload endpoint.
- Exclude the web-search charge while its own source says it is outdated and the implemented pricing schema cannot bind the add-on coherently.
- Preserve `legacy` for models still callable only by existing users; do not flatten it into deprecation.

## Kong AI Gateway

- Kong has no native Kimi provider.
- Kimi's OpenAI-compatible route does not prove that Kong's OpenAI adapter targets Kimi or accepts its IDs.
- Report no Kong-native intersection until Kong publishes one.
