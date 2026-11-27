Each Claude model ID identifies a pinned version of the model. When you use a model ID in an API request, the underlying model remains constant for the lifetime of that ID. This guarantee covers model IDs, not the convenience aliases that the Claude API accepts for some earlier models (see [Before the 4.6 generation](https://platform.claude.com/docs/en/about-claude/models/model-ids-and-versions#before-the-4-6-generation)).

## Model ID format

### The 4.6 generation and later

Starting with the Claude 4.6 generation, model IDs use a dateless format:

### Before the 4.6 generation

On the Claude API, the Claude 4.5 models also have shorter aliases, such as `claude-haiku-4-5`. Each alias points to the most recent dated snapshot for its minor version.

## Dateless IDs are pinned snapshots

For the 4.6 generation and later, the dateless ID is the canonical model ID for that release. It maps to a single, fixed model snapshot. Anthropic does not update the weights or configuration of an existing model ID. When an updated version is available, it ships under a new model ID.
