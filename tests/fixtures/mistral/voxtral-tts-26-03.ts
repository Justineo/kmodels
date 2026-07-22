export default {
  name: "Voxtral TTS",
  describe: () => ({ description: "Multilingual text-to-speech with voice cloning." }),
  slug: "voxtral-tts-26-03",
  releaseDate: "2026-03-23",
  version: "26.03",
  type: "Open",
  status: "Active",
  contextLength: null,
  pricing: {
    type: "custom",
    free: false,
    input: [{ type: "range", price: 0.0, denominator: "/M Chars" }],
    output: [{ type: "range", price: 16.0, denominator: "/M Chars" }],
  },
  identifiers: { apiNames: ["voxtral-mini-tts-2603", "voxtral-mini-tts-latest"] },
  capabilities: { input: ["text", "audio"], output: ["audio"], features: ["tts"] },
  metadata: {},
};
