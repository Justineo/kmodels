# Meta Llama

Status: current

## Sources and identity

- The exhaustive public catalog statically parses the official `llama-models` registry used by `llama-model list --show-all`; never import remote Python.
- Every core ID must have one descriptor. The exact CLI descriptor, including variants, is `model_id`; the exact Hugging Face repository is an alias. Never slugify.
- Registry context semantics and reviewed family shapes own artifact limits. Unknown family shapes fail closed.
- Fixed README/model cards may add dates, modalities, and tool evidence. Model-specific evidence wins; repository commits are not update dates.
- Optional `/v1/models` is account-scoped and non-creating; API `created` is not artifact release.
- Enable the optional inventory with `LLAMA_API_KEY`.

## Mapping

- Generative weights are text generation, Llama Guard is moderation, and Prompt Guard is classification.
- Downloadable weights have `not_applicable` pricing. Registry presence is active evidence, not a deprecation inference.
- Hosted aliases, Chat Completions, streaming, tool use, and structured output apply only when an exact example names one uniquely resolvable artifact. Never copy them to siblings.

## Kong AI Gateway

- Kong's Llama2 adapter is operator-defined. A registry artifact or Meta-hosted endpoint does not prove served name, format, quantization, upstream path, or deployment availability.
- Do not publish a direct compatibility list without a runtime binding that retains configured model name, format, upstream, operation, availability, and artifact relation.
- Moderation/classification artifacts remain outside Kong's Llama matrix.
