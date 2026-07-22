export default {
  name: "Mistral Medium 3.5",
  describe: () => ({ description: "A multimodal model for agentic and coding use cases." }),
  slug: "mistral-medium-3-5-26-04",
  releaseDate: "2026-04-28",
  version: "26.04",
  type: "Open",
  status: "Active",
  contextLength: "256k",
  outputTokenLimit: "32k",
  pricing: {
    type: "custom",
    free: false,
    input: [{ type: "range", price: 1.5, denominator: "/M Tokens" }],
    output: [{ type: "range", price: 7.5, denominator: "/M Tokens" }],
  },
  identifiers: {
    apiNames: ["mistral-medium-3-5", "mistral-medium-3", "mistral-medium-latest"],
  },
  capabilities: {
    input: ["text", "image"],
    output: ["reasoning", "text"],
    features: [
      "structured-outputs",
      "function-calling",
      "document-qna",
      "batching",
      "agents-conversations",
      "chat-completions",
    ],
  },
  metadata: {},
};
