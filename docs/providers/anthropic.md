# Anthropic

Status: current

## Sources and identity

- The exhaustive public bundle starts from the official model overview and fixed pricing, lifecycle, launch, Messages, Message Batches, and batch-support references.
- IDs and aliases come only from labeled cells. A display-name join is allowed only when it resolves uniquely; never generate a callable ID from a display name.
- Retain current and historical official IDs. Keep lifecycle and release maturity independent.
- Authenticated `GET /v1/models?limit=1000` is a one-page account inventory. Pagination, an empty response, or schema drift fails it. It may enrich matching public rows but cannot create rows or retain raw data.
- Enable the optional inventory with `ANTHROPIC_API_KEY`.

## Mapping

- Messages applies to active, preview, and not-yet-retired deprecated Claude API rows.
- Message Batches applies only to active rows. Retired rows get no current endpoint.
- The shared generated SDK model enum is not an operation matrix and never proves legacy `/v1/complete` support.
- Keep direct, batch, fast-mode, cache-write, and cache-read prices in published units and conditions.
- Derive cache and US-inference rates only from Anthropic's exact stacking multipliers using decimal-string arithmetic; publish the exact result while retaining the multiplier as evidence.

## Kong AI Gateway

- Select candidates with active lifecycle, acceptable maturity, and positive Messages or batch evidence.
- Kong's service-level legacy Completions support does not prove that a current Anthropic model accepts `/v1/complete`.
- Treat retired Kong examples as documentation drift, not deployability evidence.
