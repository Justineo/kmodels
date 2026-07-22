export default {
  name: "Mistral Large 2.0",
  describe: () => ({ description: "A general-purpose language model." }),
  slug: "mistral-large-2-0-24-07",
  releaseDate: "2024-07-24",
  version: "24.07",
  type: "Premier",
  status: "Retired",
  contextLength: "128k",
  pricing: { type: "custom", free: false, input: [], output: [] },
  identifiers: { apiNames: ["mistral-large-2407"] },
  capabilities: { input: ["text"], output: ["text"], features: [] },
  metadata: {
    deprecationDate: "2024-11-30",
    retirementDate: "2025-03-30",
    replacement: "Mistral Large 3",
  },
};
