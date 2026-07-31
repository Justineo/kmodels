# Meta Llama

Status: current

## Sources and identity

- The exhaustive public catalog statically parses the official `llama-models` registry used by `llama-model list --show-all`; never import or execute remote Python.
- Every core ID must have one descriptor. The exact CLI descriptor, including variants, is `model_id`; the exact Hugging Face repository is an alias. Never slugify.
- Parse the registry's complete `CoreModelId` → `ModelFamily` mapping. Statically interpret the closed numeric forms used by `Model.max_seq_length`; unknown expressions, incomplete family classification, and descriptors without a context rule fail closed.
- The README launch table, exact model cards, and official Meta release announcements establish release dates. Every registry identity must resolve once; model-specific dates win when a family table and card differ. Repository commits are not model update dates.
- Official API examples and generated resources establish exact hosted identities, capabilities, and relative routes. Official release evidence establishes Llama Guard 4 multimodality and its Moderations API availability.
- Optional `/v1/models` is account-scoped and non-creating; API `created` is not artifact release.
- Enable the optional inventory with `LLAMA_API_KEY`.

## Mapping

- Generative weights are text generation, Llama Guard is moderation, and Prompt Guard is classification.
- Downloadable-only weights have `not_applicable` pricing. A Meta-hosted API identity with no published public amount is `not_published`, never free or not applicable.
- Registry presence is active artifact evidence, including entries shown only by `--show-all`; it is not release-stage or deprecation evidence.
- Hosted aliases, routes, streaming, tool use, structured output, and multimodality apply only to the exact identity or release family supported by official evidence. Never copy them to siblings.

## Kong AI Gateway

- Kong's Llama2 adapter is operator-defined. A registry artifact or Meta-hosted endpoint does not prove served name, format, quantization, upstream path, or deployment availability.
- Do not publish a direct compatibility list without a runtime binding that retains configured model name, format, upstream, operation, availability, and artifact relation.
- Moderation/classification artifacts remain outside Kong's Llama matrix.
