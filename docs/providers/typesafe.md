# TypeSafe AI

## Boundary and sources

TypeSafe AI (`typesafe`) is a hosted provider. Its public
[Models](https://docs.typesafe.ai/models.md) page is the exhaustive current catalog and
first-party token price book. Each current-model table's code-formatted header establishes
one exact callable model ID and its separate display name. The alias table attaches exact
alternate request names to that model; aliases do not create duplicate catalog rows. The
stable-release alias establishes maturity only for its current target. Version strings and
release dates are not inferred from IDs or the provider launch date.

The catalog is collected atomically with the bounded
[documentation index](https://docs.typesafe.ai/llms.txt). Newly indexed commercial paths
require review before publication. SDK usage guides and application cookbooks are outside
the commercial index partition. The optional, claim-local
[API reference](https://docs.typesafe.ai/api.md) supplies typed-question and response-usage
contracts. It cannot erase independently observed identities or rates when unavailable.
All requests stay on the reviewed documentation host; linked content is not automatically crawled.

Authenticated `GET /v1/models` is account inventory and currently lists aliases, not an
exhaustive versioned catalog. It is not needed to collect the public catalog. Third-party
gateway IDs, prices and availability are not evidence for direct TypeSafe service.

## Model facts

System One's Choice question selects from a defined set, establishing `classification`.
Noul, Choice and Score return typed judgments, establishing structured output without
asserting free-form text generation, tool calling, streaming or batch delivery. Text-only
input is explicit; the shared modality vocabulary has no numeric-decision output, so output
modalities remain empty. SDK asynchronous clients do not imply asynchronous inference delivery.

Every current model is served by `/v1/systemone`. The published total request context
budget is normalized from decimal `k` tokens. The separate state-plus-longest-question
constraint remains in the model-card context label; it is not a global maximum-input field.
The current table lists 64k total and 32k for state plus the longest question.

## Pricing and accounting

The current price book charges $0.042 per million input tokens and explicitly makes output
tokens free. Both billion-token and million-token amounts must agree exactly. Input text
and structured output have separate rate terms; a zero output rate is published only from
the explicit free-output statement. Missing or inconsistent billing evidence fails closed.

The System One offer binds input and output token signals to one request. The API's nested
`usage.input_tokens` and `usage.output_tokens` fields establish response JSON-pointer
locators independently. These optional fields are conditional acquisition methods; absent
usage never means zero. Field drift removes only the affected locator. Prices and billable
signals survive an unavailable API companion.

Rate limits describe throughput, not billable quantities. Private custom/enterprise plans,
account credits, taxes, invoices and negotiated adjustments are outside the public invocation
price book. No unsupported cache discount or separate per-question charge is inferred.

## Validation

`tests/fixtures/typesafe/` contains minimal reviewed excerpts of the official documents
observed on 2026-09-22, with formatting retained where the parser depends on it. Adapter
tests cover exact identity, aliases, capabilities, the two context constraints, decimal
pricing, commercial assembly, malformed input, index drift and claim-local usage omissions.
Registering this provider does not refresh durable `data/`; collection requires a separately
authorized live refresh.
