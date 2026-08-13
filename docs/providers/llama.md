# Meta Llama

Status: current

## Boundary

Meta is both the publisher of downloadable Llama weights and the operator of a
limited Llama API. The catalog records official model artifacts because they are
valid deployment candidates. The Meta price book records only direct calls to
Meta-operated generation or moderation routes.

Artifact downloads, licenses, acceptable-use terms, local inference, training,
storage, reserved compute, deployment partners, grants, credits, and settlement are
outside pricing. They do not become free, externally billed, or unpublished offers:
they simply are not request rates sold by Meta. A managed Llama rate belongs to the
provider that operates and bills that route.

## Sources and identity

- Statically parse the official
  [`llama-models`](https://github.com/meta-llama/llama-models) registry used by
  `llama-model list --show-all`; never execute remote Python.
- The exact registry descriptor, including its variant, is `model_id`. The official
  Hugging Face repository is an alias. Parse every `CoreModelId`, family assignment,
  descriptor, and closed numeric context rule; incomplete registry semantics reject
  this exhaustive source.
- The registry README, exact model cards, and Meta release pages establish release
  dates, modalities, tasks, and family capabilities. Repository commits are not model
  release dates.
- The official
  [`llama-api-python`](https://github.com/meta-llama/llama-api-python) SDK establishes
  the API origin, routes, response shape, and only the exact model IDs used by reviewed
  examples. SDK documents are optional, claim-local dependencies: one missing or
  changed file suppresses only the affected hosted alias, route, or capability while
  the artifact registry still refreshes.
- Authenticated `GET /v1/models`, enabled by `LLAMA_API_KEY`, is a non-creating account
  inventory. It can enrich matching catalog rows but cannot create a public model or
  retire one absent from the account. Unknown root or item fields are accepted with a
  contract signal; malformed rows are skipped independently.

## Hosted pricing

The reviewed public SDK proves two exact Chat identities—
`Llama-3.3-70B-Instruct` and
`Llama-4-Maverick-17B-128E-Instruct-FP8`—and one exact Moderations identity,
`Llama-Guard-4-12B`. Each resolves to an existing registry row and receives its exact
Meta route.

Meta publishes no current numeric Llama API price book. These three hosted identities
therefore have a model-scoped `not_published` usage offer with no placeholder rate.
Other registry artifacts remain `unknown` and produce no price book. Never project a
hosted example, route, or price state to siblings.

The April 29, 2025 LlamaCon announcement describes a dated limited free preview. It is
excluded as historical promotion evidence because it has no current validity period.
It cannot make current calls free. Partner-backed Cerebras or Groq routes mentioned in
the announcement are also excluded; their current rates belong to those providers.

The Chat response exposes open `{metric, value, unit}` entries rather than documented
stable meter names. Preserve that as usage-contract evidence, but do not bind input,
output, cached, or reasoning token meters until Meta publishes exact semantics. The
Moderations response currently publishes no usage quantity. Caller-defined function
tools, streaming, structured output, and image input are capabilities, not separate
charges without official rate evidence.

## Resilience and refresh

- Registry identity, family, descriptor uniqueness, count bounds, context rules, and
  required release evidence remain source-level invariants because partial acceptance
  would make the exhaustive catalog misleading.
- Hosted identities, routes, examples, SDK accounting fields, and the historical
  preview check are fact-local. Drift emits diagnostics and suppresses only the claim
  that can no longer be proven.
- Optional hosted-document omissions retain the last verified affected facts and mark
  the source partial; independently observed registry facts continue to advance.
- Exact hosted rows are `not_published` only while a reviewed route remains proven.
  If hosted evidence disappears, retain the last verified pricing snapshot rather
  than converting every artifact to unknown or rejecting the provider.
- Refresh is deterministic and uses only first-party repository, SDK, release-page,
  and optional authenticated API inputs. No comparator catalog, inference, or LLM is
  needed.
