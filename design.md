# Kmodels decision index

Status: current

This index points to the repository's current decisions. Detailed documents are normative; this file does not repeat them.

## Decision rules

- Keep only the latest accepted decision and the rationale needed to apply it.
- Update the relevant document in the same change as the implementation.
- Replace stale text instead of keeping a changelog. Git retains history.
- Split a document when its topic can change independently. Keep provider decisions separate from shared domain decisions.
- Keep proposals clearly marked as proposals until implementation and adoption.

## Domain topics

- [Catalog semantics](docs/catalog.md): product boundary, identity, taxonomy, lifecycle, evidence, and public fields.
- [Collection](docs/collection.md): source trust, scopes, matching, validation, fallback, provenance, and generated data.
- [Kong AI Gateway](docs/kong-ai-gateway.md): consumer boundary and compatibility evidence.
- [Website](docs/website.md): information architecture, interaction, visual system, frontend behavior, and security.
- [Automation](docs/automation.md): CI, scheduled refresh, deployment, dependencies, and ownership.
- [Testing](docs/testing.md): test layers, data boundaries, assertion policy, and required validation.
- [Pricing](docs/pricing.md): canonical current-snapshot price books,
  best-effort normalization and raw fallback, compact UI projections, exact
  catalog binding, provider-atomic collection, commercial diffing, and
  crash-consistent pair publication.

## Providers

- [OpenAI](docs/providers/openai.md)
- [Anthropic](docs/providers/anthropic.md)
- [Amazon Bedrock](docs/providers/amazon-bedrock.md)
- [Databricks](docs/providers/databricks.md)
- [Vercel AI Gateway](docs/providers/vercel.md)
- [Microsoft Foundry](docs/providers/azure.md)
- [Gemini API](docs/providers/gemini.md)
- [Vertex AI](docs/providers/vertex.md)
- [Cohere](docs/providers/cohere.md)
- [Mistral AI](docs/providers/mistral.md)
- [Meta Llama](docs/providers/llama.md)
- [xAI](docs/providers/xai.md)
- [Hugging Face](docs/providers/huggingface.md)
- [Alibaba Cloud Model Studio](docs/providers/dashscope.md)
- [DeepSeek](docs/providers/deepseek.md)
- [Kimi](docs/providers/kimi.md)
- [Cerebras](docs/providers/cerebras.md)
- [Ollama](docs/providers/ollama.md)
