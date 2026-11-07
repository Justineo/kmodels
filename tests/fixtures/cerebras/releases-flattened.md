# Change Log

For model deprecations, see [Deprecations](https://inference-docs.cerebras.ai/support/deprecation.md).

**2026-10-28**

**Dedicated models and API guidance**

- Added Kimi K3, GLM 5.3 Flash, Inkling, Reflection AI Beam, and MiMo V2.6 Pro to the [Dedicated model catalog](https://inference-docs.cerebras.ai/dedicated/overview.md#supported-models).
- Corrected the image-token usage field to `usage.prompt_tokens_details.image_tokens`. This count is already included in `usage.prompt_tokens`.

**2026-09-22**

**Temporary increase to Qwen 3.8 27B total token rate limit**

The Developer tier total token rate limit for [`qwen-3.8-27b`](https://inference-docs.cerebras.ai/models/qwen-3.8-27b) is temporarily increased from 450K to 750K tokens per minute.

**2026-09-03**

**Qwen 3.8 27B available on public endpoints**

[`qwen-3.8-27b`](https://inference-docs.cerebras.ai/models/qwen-3.8-27b) is now available on Cerebras public endpoints. Qwen 3.8 27B is a 27-billion-parameter dense multimodal model for agentic coding, tool use, research, and long-running workflows.

**2026-08-31**

**Use OpenAI SDK v3 for Python with Cerebras**

Keep the same Cerebras API configuration when you upgrade to OpenAI SDK v3 for Python. The SDK requires Python 3.10 or later and uses HTTPX2.

**2026-01-06**

Added preview support for [Z.ai GLM 4.7](https://inference-docs.cerebras.ai/models/zai-glm-47): `zai-glm-4.7`

**2025-08-05**

Added preview support for OpenAI GPT OSS: `gpt-oss-120b`

**2025-05-14**

- Added support for Qwen 3 32B: `qwen-3-32b`.
- Improvements to tool calling, including support for multi-turn tool calls.

**2024-12-10**

**Support for Llama 3.3 70B**

- We now support [`llama-3.3-70b`](https://www.llama.com/docs/model-cards-and-prompt-formats/llama3_3/), Meta's newly released model.
