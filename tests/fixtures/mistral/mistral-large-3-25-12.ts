export default {
  name: "Mistral Large 3",
  describe: () => ({ description: "A current general-purpose language model." }),
  slug: "mistral-large-3-25-12",
  releaseDate: "2025-12-02",
  version: "25.12",
  type: "Open",
  status: "Active",
  contextLength: "256k",
  pricing: {
    type: "range",
    free: false,
    input: 0.5,
    output: 1.5,
    denominator: "/M Tokens",
  },
  identifiers: { apiNames: ["mistral-large-2512", "mistral-large-latest"] },
  capabilities: {
    input: ["text", "image"],
    output: ["text"],
    features: ["chat-completions", "function-calling"],
  },
  metadata: {},
};
