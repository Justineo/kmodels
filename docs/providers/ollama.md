# Ollama

Status: current

## First-party discovery and identity

- Treat both official `llms.txt` indexes as discovery roots. The site index must continue to
  expose pricing and the Library; the documentation index is scanned for new commercial,
  usage, caching, quota, batch, and billing pages. A newly indexed relevant page fails the
  collection until it is classified.
- The non-exhaustive official Library publishes exact callable family names; omitted tags
  select `latest`. Never synthesize size, quantization, `:cloud`, `-cloud`, or community IDs.
  Community namespaces remain outside the reviewed catalog.
- Cloud `/api/tags`, the Cloud-filtered Library, every Cloud family page, and `/api/show` for
  every exact ID are one atomic source. The family pages publish the relationship between
  Library tags such as `kimi-k3:cloud` and direct Cloud API IDs such as `kimi-k3`. A missing
  page or detail rejects the source.
- Exact catalog probes may add aliases or validate retired Cloud presence. Retain independent
  Library and Cloud source/service-family evidence for exact overlaps.
- Do not authenticate or contact arbitrary local runtimes in CI.

## Public price coverage

- The pricing page publishes account plans and allowance mechanics, not a general per-model
  dollar rate book: Free is `$0`; Pro is `$20/month` or `$200/year`; Max is `$100/month` with
  new sign-ups paused; Team is `$25/seat/month` with a five-seat minimum and included usage;
  Enterprise is custom. Session limits reset every five hours, weekly limits every seven days,
  and concurrency also varies by plan.
- Individual allowance consumption depends on the model and the counts of input, cached-input,
  and output tokens. Team usage consumes the seat allowance first and then the shared extra
  usage balance at the model token rate. Pro and Max can add an extra usage balance. Exact
  allowance sizes and an account's remaining balance are not public catalog facts.
- Most Cloud model pages publish only an ordinal usage level (`low`, `medium`, `high`, or
  `extra high`). Preserve that level as a raw allowance fact; it is neither a currency amount
  nor a stable multiplier. The base price therefore remains `not_published`, while the raw fact
  distinguishes this known allowance mechanic from a model with no commercial evidence.
- `kimi-k3` is the current first-party exception: its page publishes extra-usage rates of
  `$3.00 / 1M` input tokens, `$0.30 / 1M` cached tokens, and `$15.00 / 1M` output tokens, and
  says that a Pro or Max subscription plus extra usage credits is required. Publish those
  exact rates with `account_eligibility=extra_usage_balance`; do not apply them to included
  allowance consumption or other models.
- Local-only Library weights use `not_applicable` for Ollama provider billing. The operator's
  compute and infrastructure cost is outside this provider price book. A hosted Cloud badge
  without an exact dollar rate uses `not_published`; a bound usage level retains that state and
  adds the non-monetary raw allowance fact.
- Subscriptions automatically renew; taxes are account-specific; purchased extra-usage
  credits expire after one year. These terms affect account-effective cost but do not bind to
  a model meter.

## Request, response, and account boundaries

- The callable model and actual input/output volume come from each request and response.
  Native generate/chat responses return `prompt_eval_count` and `eval_count`; streaming puts
  them in the final `done: true` chunk. OpenAI compatibility accepts
  `stream_options.include_usage`.
- Native OpenAPI does not return cached-input token count even though the pricing page says
  cached input affects usage. Consequently even `kimi-k3` cannot be reconstructed exactly
  from a normal API response when cache reads occur.
- Anthropic compatibility reports `usage.input_tokens` and `usage.output_tokens`, but Ollama
  documents those counts as tokenizer approximations and does not support prompt caching.
- Thinking controls, vision input, and client-executed tool follow-up requests can change work
  performed or token volume. The first-party docs do not publish separate thinking- or
  image-token accounting rules; tool execution itself is client-side. Do not invent monetary
  meters from these feature flags.
- The public official indexes document neither a Usage/Costs ledger API nor its freshness.
  Settings can show account usage, but that UI is not a stable machine-readable source. Plan,
  included allowance, balance, negotiated Enterprise terms, taxes, and credit expiry therefore
  remain account-level facts unavailable to unauthenticated collection.
- A gateway may estimate a published marginal token charge after the response where an exact
  rate and all billed counters exist. It cannot derive Ollama's account-effective cost before
  the request, and there is no documented cost API suitable for request-time cost-based load
  balancing.

## Mapping

- Library and Cloud lifecycle are separate. A current Library family remains globally active
  even if its Cloud channel retires.
- Publish Cloud lifecycle only for an exact ID without current Library evidence. A
  channel-scoped lifecycle resource is required before exposing suppressed Cloud retirement
  history completely.
- Sort the unordered Cloud list and remove only the request-specific retired-response UUID
  before hashing. Normalize each family page to exact Cloud tags, usage levels, and rate cards;
  discard navigation and page chrome before hashing.
- Explicit Library/API update fields become `updated_date`, not release.
- Reconciliation records every Cloud model as numeric, raw, or explicit non-numeric and records
  account plans, allowances, unsupported counters, and undocumented billing surfaces as
  excluded or unbound evidence. Collection fails on new indexed commercial pages, changed
  price-card structure, or a newly documented cached-token field so the mapping is reviewed
  rather than silently guessed.
- Pricing evidence is ranked at the exact model-state boundary. A numeric `price_book` fact suppresses
  only a lower-authority `commercial_terms` claim that the price is not published; it does not
  override another amount, a local `not_applicable` disposition, or a different model. This resolves
  Kimi K3's generic Library absence against its exact Cloud rate card while preserving the source
  reconciliation record and conditional `extra_usage_balance` applicability.
- The sole current unknown-priced row, `gemini-3-flash-preview`, is a retained observation from the
  non-exhaustive Library with both Library and Cloud family evidence, but the current bundle has
  neither a current Cloud rate/page nor local-weight evidence. That is insufficient to prove either
  hosted `not_published` or local `not_applicable`; the row remains unknown until Ollama publishes
  current channel or commercial evidence.

## Kong AI Gateway

- Kong uses `/api/chat` for streaming generation and `/api/embed` for non-streaming embeddings
  on a configured upstream.
- Compatibility requires the configured host, exact accepted tag, matching operation, and
  current runtime availability.
- Library families, Cloud IDs, and pulled local tags are different scope claims. General API
  references and normalized tasks do not create per-model endpoints.
- Do not manufacture tagged Kong examples from family rows or claim that an operator has pulled
  them.
