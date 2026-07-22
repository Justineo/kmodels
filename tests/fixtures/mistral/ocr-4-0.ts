export default {
  name: "OCR 4",
  describe: () => ({ description: "Document OCR with structural annotations." }),
  slug: "ocr-4-0",
  releaseDate: "2026-06-23",
  version: "4.0",
  type: "Premier",
  status: "Active",
  contextLength: null,
  pricing: {
    type: "custom",
    free: false,
    input: [
      { type: "flat", price: 4.0, denominator: "/1000 Pages" },
      { type: "flat", price: 5.0, denominator: "/1000 Annotated Pages" },
    ],
    output: [],
  },
  identifiers: { apiNames: ["mistral-ocr-4-0", "mistral-ocr-latest"] },
  capabilities: {
    input: ["image", "document"],
    output: ["text", "image"],
    features: ["bbox-extraction", "ocr", "annotations-structured-ocr", "batching"],
  },
  metadata: {},
};
