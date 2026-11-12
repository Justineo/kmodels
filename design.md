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

- [Pricing coverage and evidence](docs/pricing-coverage.md): rate, binding, acquisition and operation
  completeness; generated coverage resources, unknowns and evidence-preserving repair.
- [Catalog semantics](docs/catalog.md): product boundary, identity, taxonomy, lifecycle, evidence, and public fields.
- [Invocation addressing](docs/invocation-addressing.md): static identifiers, positive deployment
  tuples, evidence limits, and UI projection.
- [Inference model ID pricing](docs/inference-pricing.md): minimal ID-to-price
  relation, candidate/missing-condition semantics, direct UI and compatibility boundary.
- [Catalog schema scope](docs/catalog-schema-upgrade.md): additive pricing associations and compatibility.
- [Collection](docs/collection.md): source trust, scopes, matching, validation, fallback, provenance, and generated data.
- [Provider research and collection guidelines](docs/agent-provider-research.md): an agent workflow
  for first-party discovery, transport verification, extraction, and consumer replay.
- [Website](docs/website.md): information architecture, interaction, visual system, frontend behavior, and security.
- [Automation](docs/automation.md): CI, scheduled refresh, deployment, dependencies, and ownership.
- [Review and repair method](docs/refresh-repair-audit.md): finite review scope, source-to-consumer evidence, diagnostic admission, periodic review and historical-data repair.
- [Source semantic audit](docs/semantic-audit.md): manual Jev experiment, evidence replay, and evaluation limits; not scheduled.
- [Testing](docs/testing.md): test layers, data boundaries, assertion policy, and required validation.
- [Pricing](docs/pricing.md): canonical current-snapshot price books,
  request and inference-capacity rates, scoped usage signals, selector inputs and exact calculations, best-effort normalization and raw
  fallback, compact UI projections, exact catalog binding, provider-atomic collection, and
  crash-consistent pair publication.
- [Portable pricing calculator](docs/pricing-calculator.md): caller-owned calculation exports, pure ESM package, exact evaluation, and language-neutral conformance.
- [Commercial topology](docs/commercial-topology.md): the shared model/offer/term contract,
  inference and hosting-capacity admission boundary, charge binding, presentation, conflict resolution, and
  resilient refresh. Provider adapters converge to this boundary one at a time;
  `docs/pricing.md` owns the exact wire.
- [Canonical commercial selection](docs/offer-semantics-design.md): evidenced scoped offer semantics,
  canonical-to-native selectors, shared model/resource selection and stored migration.

## Downstream consumers

- [Kong AI Gateway](docs/kong-ai-gateway.md): separate consumer compatibility evidence; it does not define the catalog schema or provider semantics.

## Providers

- [TypeSafe AI](docs/providers/typesafe.md)
- [OpenAI](docs/providers/openai.md)
- [Anthropic](docs/providers/anthropic.md)
- [Amazon Bedrock](docs/providers/amazon-bedrock.md)
- [Amazon SageMaker AI](docs/providers/amazon-sagemaker.md)
- [Databricks](docs/providers/databricks.md)
- [Vercel AI Gateway](docs/providers/vercel.md)
- [Microsoft Foundry](docs/providers/azure.md)
- [Gemini API](docs/providers/gemini.md)
- [Gemini Enterprise Agent Platform](docs/providers/vertex.md)
- [Cohere](docs/providers/cohere.md)
- [Mistral AI](docs/providers/mistral.md)
- [Meta](docs/providers/meta.md)
- [xAI](docs/providers/xai.md)
- [Hugging Face](docs/providers/huggingface.md)
- [Alibaba Cloud Model Studio](docs/providers/dashscope.md)
- [DeepSeek](docs/providers/deepseek.md)
- [Kimi](docs/providers/kimi.md)
- [Cerebras](docs/providers/cerebras.md)
- [Ollama](docs/providers/ollama.md)
- [Together AI](docs/providers/together.md)
- [Fireworks AI](docs/providers/fireworks.md)
- [NVIDIA NIM](docs/providers/nvidia-nim.md)
