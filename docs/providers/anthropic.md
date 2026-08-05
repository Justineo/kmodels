# Anthropic

Status: current

## Sources and identity

- The exhaustive public bundle starts from the official model overview and fixed pricing, lifecycle, launch, operation, and feature-compatibility references. Core model and capability disclosure never depends on credentials.
- The official platform release notes fill public launch dates only when a dated entry explicitly says Anthropic launched a named model or exact API ID. A release-note mention about retirement, feature support, or migration is not launch evidence. Conflicting public launch dates fail the provider instead of selecting one silently.
- IDs and aliases come only from labeled cells. A display-name join is allowed only when it resolves uniquely; never generate a callable ID from a display name.
- Retain current and historical official IDs. Keep lifecycle and release maturity independent.
- Authenticated `GET /v1/models?limit=1000` is a one-page account inventory. Pagination, an empty response, or schema drift fails it. It may fill missing fields on matching public rows, but account-scoped values never override known global facts, create rows, or retain raw data.
- Enable the optional inventory with `ANTHROPIC_API_KEY`.

## Mapping

- Messages applies to active, preview, and not-yet-retired deprecated Claude API rows.
- Merge the lifecycle table with labeled inline lifecycle statements; both use exact API IDs, and a newer inline status may cover a limited-access model omitted from the main table.
- The Messages operation contract proves streaming for every callable row. Message Batches applies only to active rows; non-active callable rows are explicitly non-batch, and retired rows get no current endpoint.
- Parse universal active-model support for citations, PDF input, prompt caching, and batches directly from the corresponding guides. Parse context editing and the absence of fine-tuning from their provider-wide contracts.
- Parse structured output, code execution, computer use, effort, thinking, and tool use from their current compatibility statements or tables. The structured-output guide's explicit `Supported models` ID list is exhaustive for callable rows and therefore supports both positive and negative facts. An inclusive statement supports only the models it names.
- The shared generated SDK model enum is not an operation matrix and never proves legacy `/v1/complete` support.
- Keep direct, batch, fast-mode, cache-write, and cache-read prices in published units and conditions. `speed` is independent of `service_tier`: Fast is selected and reported as request speed, while Standard, Priority, and Batch are service-tier outcomes. Never encode Fast as a service tier.
- Parse cache and US-inference multipliers from the current pricing page, rather than keeping them as parser constants. Validate the published base cache columns against those multipliers, then derive Batch, Fast, and US-inference combinations with decimal-string arithmetic while retaining the multiplier as evidence.
- A fast-mode row may name one model or an explicit combined model list; every named model receives the same published rate. When a model has an unequal US-only inference alternative, an otherwise unqualified rate is the reviewed global base. Consecutive promotion and standard validity intervals remain distinct normalized variants.
- Invitation-only availability does not imply custom pricing. Keep pricing unknown when Anthropic documents a callable model but publishes no rate.
- Reconcile the pricing source by reviewed source item: every base, Batch, Fast, cache-multiplier, inference-geography, and tool-overhead row is accounted for. Model token rates are normalized; tool prompt overhead is deliberately excluded because Anthropic includes it in returned input-token usage. Web search, web fetch, code execution, Managed Agents runtime, marketplace CCUs, and negotiated discounts are recorded as explicit boundaries until provider-service books and account-scoped billing state can represent them. An output-model count is not a substitute for this source-item denominator.
- Third-party pricing registries are comparison inputs only. They never create a model or rate and never repair a failed Anthropic refresh.

## Gateway accounting boundary

- A pre-request estimate needs the actual endpoint and request selectors: model, Message Batches versus synchronous Messages, `speed`, `inference_geo`, cache TTL, and any server-side tools. Workspace `default_inference_geo` supplies the geo when the request omits it, while `allowed_inference_geos` can reject an override.
- Price a completed request from the returned usage outcome rather than assuming that the submitted selector won. The response reports uncached input, cache creation and cache-read tokens, output tokens, cache-creation TTL breakdown, actual `service_tier`, `inference_geo`, and—on the Fast beta surface—`speed`; server-tool counters identify web-search and related calls. `output_tokens` already includes billed thinking output, so do not add thinking tokens a second time.
- Public prices calculate the standard token charge and its published Batch, Fast, cache, geography, and promotion modifiers. They cannot determine Priority Tier contract cost, negotiated volume or marketplace discounts, credits, taxes, code-execution allowance exhaustion or execution duration, or Managed Agents running time without additional account/usage state.
- The organization Usage API provides minute, hour, or day buckets and can group token usage by model, workspace, API key, service tier, context window, inference geography, and beta speed. The Cost API provides daily USD-cent line items for token, web-search, and code-execution charges; it excludes Priority Tier costs. Console organizations require an Admin API key, individual accounts do not have these endpoints, Enterprise uses a separate Analytics API, and Claude Platform on AWS does not expose the programmatic Usage/Cost endpoints.
- Usage and cost records normally appear within about five minutes and can occasionally take longer. They are delayed reconciliation evidence, not a synchronous per-request quote: do not use them for hot-path cost-based load balancing. Route on a conservative public-price estimate, correct it from the response usage, and reconcile aggregate/account-specific differences later.

## Kong AI Gateway

- Select candidates with active lifecycle, acceptable maturity, and positive Messages or batch evidence.
- Kong's service-level legacy Completions support does not prove that a current Anthropic model accepts `/v1/complete`.
- Treat retired Kong examples as documentation drift, not deployability evidence.
