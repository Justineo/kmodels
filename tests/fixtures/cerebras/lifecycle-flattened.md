# Deprecations

> A list of all deprecations, with the most recent announcements appearing first.

**2026-09-03**

**Gemma 4 31B availability changes with Shared Inference**

Starting September 3, 2026, `gemma-4-31b` is no longer available with Cerebras Shared Inference. This change doesn't affect [Dedicated Inference](https://inference-docs.cerebras.ai/dedicated/overview.md), where Gemma 4 31B remains available.

Use [`qwen-3.8-27b`](https://inference-docs.cerebras.ai/models/qwen-3.8-27b) for Shared Inference workloads. To continue using Gemma 4 31B, [contact us](https://www.cerebras.ai/contact) to set up Dedicated Inference.

**2026-08-17**

**Deprecated `zai-glm-4.7`**

**2026-05-27**

**Deprecated `llama3.1-8b` and `qwen-3-235b-a22b-instruct-2507`**

We recommend migrating to [GPT OSS 120B](https://inference-docs.cerebras.ai/models/openai-oss.md).

**2026-03-24**

**Deprecating `disable_reasoning` parameter for `zai-glm-4.7`**

The `disable_reasoning` parameter will no longer be supported after **July 21, 2026**. Migrate to `reasoning_effort="none"` to disable reasoning on `zai-glm-4.7`.

**2026-02-16**

**Deprecated `qwen-3-32b` and `llama-3.3-70b`**

We recommend migrating to [GPT OSS 120B](https://inference-docs.cerebras.ai/models/openai-oss.md).

> [!NOTE]
>
> **Migration Notes**:
>
> - Qwen 3 32B had reasoning enabled by default. GPT OSS supports configurable reasoning via the `reasoning_effort` parameter.

**2025-01-17**

The `llama3.1-70b` model has been deprecated. We recommend transitioning to `llama-3.3-70b`, a more powerful model released by Meta.
