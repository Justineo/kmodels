# TypeSafe AI

## Offer boundary

[Shared ownership rules](../commercial-topology.md#offers-and-dimensions) govern this provider.

Keep one public System One usage relationship per established versioned model ID. Input/output terms retain the exact nested request usage fields. System One is a product label, not an inferred subscription or execution enum. Model identity and published unit/rate evidence control admission; no additional plan is created from a model/version distinction.

The source authorities and evidence limits below remain authoritative. Adapter keys such as
`sync`, `batch`, `usage`, and operation/model-specific labels describe extraction contexts;
`source_contexts` binds them to the published relationship and its conditions. They are not
additional user-selectable agreements. Migration preserves monetary facts, conditional accounting,
source revisions and independently charged subjects.

## Boundary and sources

TypeSafe AI (`typesafe`) is a hosted provider. Its public
[Models](https://docs.typesafe.ai/models.md) page is the exhaustive current catalog and
first-party token price book. The current-model table may be vertical (one model per table)
or horizontal (one column per model); in either layout, a code-formatted Model ID establishes
one exact callable model and its table header supplies the separate display name. The alias
table attaches exact alternate request names to that model; aliases do not create duplicate
catalog rows. The stable-release alias establishes maturity only for its current target.
Version strings and release dates are not inferred from IDs or the provider launch date.
Markdown delimiter cells accept one or more hyphens with optional alignment colons, including
the compact `:-` form. Header and row column counts and labeled fields remain strict.

The catalog is collected atomically with the bounded
[documentation index](https://docs.typesafe.ai/llms.txt). Newly indexed commercial paths
require review before publication. SDK usage guides and application cookbooks are outside
the commercial index partition. The optional, claim-local
[System One API reference](https://docs.typesafe.ai/api/system-one.md) supplies typed-question and response-usage
contracts. It cannot erase independently observed identities or rates when unavailable.
Usage contracts are source-level facts, shared by the observed System One models; they are not
copied into each model observation or repeated in compilation input.
The current index links the operation-specific page instead of the former `/api.md`. Its labeled
OpenAPI block must bind the JSON request and successful response to their owning schemas. Question
union members and constants establish typed output as a shared fallback when the Models table omits
its per-model `Question types` row; referenced integer fields on the response's
direct `usage` property establish counters. Examples and unrelated operation schemas cannot supply
missing contracts. Reviewed legacy MDX response fields remain readable for historical fixtures.
All requests stay on the reviewed documentation host; linked content is not automatically crawled.

Authenticated `GET /v1/models` is account inventory and currently lists aliases, not an
exhaustive versioned catalog. It is not needed to collect the public catalog. Third-party
gateway IDs, prices and availability are not evidence for direct TypeSafe service.

## Model facts

The current Models page publishes a per-model `Question types` row. A model whose row lists
`Choice` selects from a defined set, establishing `classification`. Row members `Noul`, `Choice`,
`Score` and `Box` return typed judgments, establishing structured output without asserting
free-form text generation, tool calling, streaming or batch delivery. `Box` answers locate a
region inside a supplied image and have no exact canonical task family yet, so they add no task.
A table without the row falls back to the shared API union, which still requires Noul, Choice and
Score. Rows that omit `Choice` do not establish classification, and an unrecognized member is a
source contract finding rather than a guess.

The published `Input` row lists the accepted input kinds. `Text` maps to text input and
`Text, images` maps to text and image input; the page states that PNG and JPEG images are read
anywhere in the request and that audio and video are not accepted natively. Only reviewed labels
produce modalities, and an unreviewed label records a source contract finding. The shared modality
vocabulary has no numeric-decision output, so output modalities remain empty. SDK asynchronous
clients do not imply asynchronous inference delivery.

Every current model is served by `/v1/systemone`. The published total request context
budget is normalized from decimal `k` tokens. The separate state-plus-longest-question
constraint remains in the model-card context label; it is not a global maximum-input field.
The current table lists 64k total and 32k for state plus the longest question.

## Inference ID and price mapping

The official Models page states that its model IDs select the request's `model` field and that
aliases point to versioned model IDs accepted in that field. Its model table also publishes the
token price. These statements establish direct price associations without validating API origins,
authentication, request templates, release stages or capability coverage.

The parser emits one direct ID-to-`systemone` offer association for every established versioned ID
and alias, retaining the model's exact catalog reference and source locator. Alias destinations
follow the explicit current table, not string similarity, equal amounts or an assumed latest
version. The mapping describes its collected snapshot; a historical request using a rolling alias
may require the actual version returned by that response.
Evidence links open the Current models or Aliases section in the rendered Models page.

A missing or changed request-ID statement withholds that class of association and records a source
contract finding. Independent catalog prices remain available. Missing optional API documentation
does not remove price associations; response-usage extraction remains a separate accounting concern.

The published long-context option costs the same per token. It therefore introduces no additional
pricing selector. No region, protocol or service-tier choice is needed for the documented System One
tariff. Unknown private or unreviewed IDs have no implicit association. The reviewed
`models-id-pricing.md` fixture preserves the relevant model table, alias table and long-context
statement from the [official Models page](https://docs.typesafe.ai/models.md).

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
The `usage` object must be a top-level response property, and each counter must belong directly
to that object across documentation-only wrappers. A same-named counter inside another response
property cannot establish `/usage/input_tokens` or `/usage/output_tokens`; nested lookalikes also
cannot invalidate an independently declared direct counter.

Rate limits describe throughput, not billable quantities. The current table no longer publishes
them; a `Rate limits` row stays readable for historical revisions and is excluded from the price
book. Private custom/enterprise plans, account credits, taxes, invoices and negotiated adjustments
are outside the public invocation price book. No unsupported cache discount or separate
per-question charge is inferred.

## Validation

`tests/fixtures/typesafe/` contains minimal reviewed excerpts of the official documents,
including the legacy vertical and current horizontal model-table layouts, with formatting
retained where the parser depends on it. Adapter tests cover exact identity, aliases,
capabilities, reviewed input labels and question types, the two context constraints, decimal
pricing, commercial assembly, malformed input, index drift, unreviewed input and question-type
labels, and claim-local usage omissions.
Registering this provider does not refresh durable `data/`; collection requires a separately
authorized live refresh.
