# Anthropic

Status: current

## Sources and identity

- The exhaustive public bundle starts from the official model overview and fixed pricing, lifecycle, launch, operation, and feature-compatibility references. Core model and capability disclosure never depends on credentials.
- IDs and aliases come only from labeled cells. A display-name join is allowed only when it resolves uniquely; never generate a callable ID from a display name.
- Retain current and historical official IDs. Keep lifecycle and release maturity independent.
- Authenticated `GET /v1/models?limit=1000` is a one-page account inventory. Pagination, an empty response, or schema drift fails it. It may fill missing fields on matching public rows, but account-scoped values never override known global facts, create rows, or retain raw data.
- Enable the optional inventory with `ANTHROPIC_API_KEY`.

## Mapping

- Messages applies to active, preview, and not-yet-retired deprecated Claude API rows.
- Merge the lifecycle table with labeled inline lifecycle statements; both use exact API IDs, and a newer inline status may cover a limited-access model omitted from the main table.
- The Messages operation contract proves streaming for every callable row. Message Batches applies only to active rows; non-active callable rows are explicitly non-batch, and retired rows get no current endpoint.
- Parse universal active-model support for citations, PDF input, prompt caching, and batches directly from the corresponding guides. Parse context editing and the absence of fine-tuning from their provider-wide contracts.
- Parse structured output, code execution, computer use, effort, thinking, and tool use from their current compatibility statements or tables. An exhaustive “following models” list supports both positive and negative facts for callable rows; an inclusive statement supports only the models it names.
- The shared generated SDK model enum is not an operation matrix and never proves legacy `/v1/complete` support.
- Keep direct, batch, fast-mode, cache-write, and cache-read prices in published units and conditions.
- Derive cache and US-inference rates only from Anthropic's exact stacking multipliers using decimal-string arithmetic; publish the exact result while retaining the multiplier as evidence.
- A fast-mode row may name one model or an explicit combined model list; every named model receives the same published rate. When a model has an unequal US-only inference alternative, an otherwise unqualified rate is the reviewed global base. Consecutive promotion and standard validity intervals remain distinct normalized variants.
- Invitation-only availability does not imply custom pricing. Keep pricing unknown when Anthropic documents a callable model but publishes no rate.

## Kong AI Gateway

- Select candidates with active lifecycle, acceptable maturity, and positive Messages or batch evidence.
- Kong's service-level legacy Completions support does not prove that a current Anthropic model accepts `/v1/complete`.
- Treat retired Kong examples as documentation drift, not deployability evidence.
