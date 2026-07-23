export default {
  name: "Codestral Embed",
  describe: () => ({ description: "Semantic code embeddings." }),
  slug: "codestral-embed-25-05",
  releaseDate: "2025-05-28",
  version: "25.05",
  type: "Premier",
  status: "Active",
  contextLength: "8k",
  pricing: {
    type: "custom",
    free: false,
    input: [{ type: "flat", price: 0.15, denominator: "/M Tokens" }],
    output: [],
  },
  identifiers: { apiNames: ["codestral-embed-2505", "codestral-embed"] },
  capabilities: {
    input: ["text"],
    output: ["embeddings"],
    features: ["embeddings", "batching"],
  },
  metadata: {},
};
