# Z.ai GLM 4.7

> A tool-using reasoning model.

Model ID: `zai-glm-4.7`. Pricing: $2.25 per million input tokens, $2.75 per million output tokens.

Use the `reasoning_effort` parameter to control reasoning.

<Callout>
  **Z.ai GLM 4.7** is scheduled for deprecation on August 17, 2026.
</Callout>

<ModelInfo
modelId="zai-glm-4.7"
contextLength={{
    freeTier: "64k tokens",
    paidTiers: "131k tokens"
  }}
maxOutput={{
    freeTier: "40k tokens",
    paidTiers: "40k tokens"
  }}
pricing={{
    inputPrice: "$2.25 / M tokens",
    outputPrice: "$2.75 / M tokens"
  }}
endpoints={[
"Chat Completions"
]}
features={[
"Reasoning",
"Streaming",
"Structured Outputs",
"Tool Calling",
"Parallel Tool Calling",
"Prompt Caching"
]}
inputOutput={{
    inputFormats: ["text"],
    outputFormats: ["text"]
  }}
/>
