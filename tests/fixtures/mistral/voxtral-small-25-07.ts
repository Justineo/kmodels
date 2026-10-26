export default {
  name: "Voxtral Small",
  describe: () => ({ description: "Real-time speech understanding with text output." }),
  slug: "voxtral-small-25-07",
  releaseDate: "2025-07-15",
  version: "25.07",
  type: "Open",
  status: "GA",
  contextLength: 32000,
  pricing: {
    type: "custom",
    free: false,
    input: [
      { type: "range", price: 0.004, denominator: "/Min" },
      { type: "flat", price: 0.1, denominator: "/M Tokens" },
    ],
    output: [{ type: "range", price: 0.4, denominator: "/M Tokens" }],
  },
  identifiers: { apiNames: ["voxtral-small-2507", "voxtral-small-latest"] },
  capabilities: {
    input: ["text", "audio"],
    output: ["text"],
    features: ["chat-completions", "batching"],
  },
  metadata: {},
};
