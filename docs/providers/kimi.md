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

- Start commercial discovery from each platform's first-party `docs/llms.txt`, then require every indexed pricing page and every reviewed billing, usage, balance, cache, search, Batch, account, project, and product-plan page in the same atomic bundle. A newly indexed commercial page fails the source as unreviewed instead of remaining silently undiscovered.
- Parse official pricing MDX statically without executing page code, including reviewed JSX currency literals and text fragments.
- Preserve China CNY and international USD cached input, uncached input, output, Batch, and successful `$web_search` call rates. Region, Batch tier, and web-search operation are explicit applicability conditions; no regional price is an unconditional global default.
- Bind the web-search add-on only to exact model IDs stated before the guide's examples. Do not infer support from all priced or tool-capable models.
- The table publishes no effective dates. Treat its rows as current observations; never infer historical start/end dates from collection time.
- Validate the OpenAPI server, response-format enum, streaming type, function-tool reference, prompt-cache field, thinking controls, effort values, discriminator mapping, request enum, non-streaming/streaming token-usage fields, and interrupted-stream warning before publishing capabilities.
- Map prose-only output ceilings from the OpenAPI field description only when a published display name resolves uniquely to an exact discriminator ID; do not encode a model-specific limit table.
- Attach `/v1/batches` only to exact Batch pricing rows while the fixed create-batch reference retains its reviewed operation and payload endpoint.
- Preserve `legacy` for models still callable only by existing users; do not flatten it into deprecation.
- Do not convert API object creation timestamps into first-public-availability dates.

## Public cost boundary

- For ordinary Chat Completions, the response publishes `prompt_tokens`, `completion_tokens`, `total_tokens`, and `cached_tokens`. The public pre-tax list cost can therefore be reconstructed after a completed response as uncached input, cached input, output, and any successfully triggered `$web_search` calls. Search-result tokens appear separately as `arguments.usage.total_tokens`, then enter the next call's `prompt_tokens`; do not charge them twice.
- With streaming, request `stream_options.include_usage`. The final usage chunk has whole-request counts, but Kimi explicitly warns that an interrupted stream may never deliver it. The Token Estimate API returns `data.total_tokens` before execution; it is an estimate, not a billed-cost or post-request usage ledger.
- Batch publishes separate rates and each completed output record includes prompt, completion, and total tokens. Its example does not document `cached_tokens`, so exact cached-versus-uncached Batch reconstruction remains unbound even though the Batch price table publishes both rates.
- The Batch price page currently lists `kimi-k2.7-code`, while the Batch guide still says only `kimi-k2.6` and `kimi-k2.5` are supported. Preserve the exact price row and record the guide-scope conflict rather than hiding either first-party claim.
- Kimi's Formula guide says its official tools are free for a limited time and names the supported models. Normalize each exact non-search tool ID as a promotional zero-price tool call for those models. `moonshot/web-search:latest` instead points readers to the web-search price page, which defines the fee through the separate `$web_search` built-in trigger rather than the Formula `/fibers` operation; keep that trigger mismatch unbound instead of inventing a duplicate search rate.
- Kimi documents no public Usage/Costs API and returns no exact monetary cost on an inference response. The authenticated balance endpoint returns only available, voucher, and cash balances. Console organization/project consumption analysis is not a public API, and project budget enforcement can lag by about 10 minutes. Neither is suitable as the feedback signal for request-time cost load balancing.
- Account tiers follow cumulative recharge and change concurrency/RPM/TPM/TPD, not the published model rate. Project budgets, balance alerts, vouchers, the China new-user voucher exclusion for Kimi K3, Batch console Tier1 eligibility, international checkout tax, and unpublished enterprise terms are account or invoice concerns outside the public price book. They can change usable capacity or effective cash outlay without changing the list-cost calculation.
- China and international accounts, keys, balances, currencies, and endpoints are independent. A gateway must retain the credential's platform/region and the request's model, endpoint/tier, tool outcome, and returned usage/cache outcome; model ID alone is insufficient.

This provider audit uses only Kimi/Moonshot first-party documentation and API contracts. It does not import or use a third-party pricing catalog.

## Kong AI Gateway

- Kong has no native Kimi provider.
- Kimi's OpenAI-compatible route does not prove that Kong's OpenAI adapter targets Kimi or accepts its IDs.
- Report no Kong-native intersection until Kong publishes one.
