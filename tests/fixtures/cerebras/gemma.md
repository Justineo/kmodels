# Gemma 4 31B

> A multimodal reasoning model.

Model ID: `gemma-4-31b`. Pricing: $2.15 per million input tokens, $2.70 per million output tokens.

Use the `reasoning_effort` parameter to control reasoning.

<span>per million tokens</span>

<ModelInfo
modelId="gemma-4-31b"
contextLength={{
    freeTier: "65k tokens",
    paidTiers: "131k tokens"
  }}
maxOutput={{
    freeTier: "32k tokens",
    paidTiers: "40k tokens"
  }}
pricing={{
    inputPrice: "$0.99",
    outputPrice: "$1.49"
  }}
endpoints={[
"Chat Completions",
"Completions"
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
    inputFormats: ["text", "image"],
    outputFormats: ["text"]
  }}
/>
