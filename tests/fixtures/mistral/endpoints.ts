export const AVAILABLE_ENDPOINTS = {
  "chat-completions": { name: "Chat / Completions", path: "/v1/chat/completions" },
  "fim-completions": { name: "Fim / Completions", path: "/v1/fim/completions" },
  moderations: { name: "Moderations", path: "/v1/moderations" },
  "chat-moderations": { name: "Chat / Moderations", path: "/v1/chat/moderations" },
  ocr: { name: "OCR", path: "/v1/ocr" },
  agents: { name: "Agents", path: "/v1/agents" },
  conversations: { name: "Conversations", path: "/v1/conversations" },
  batch: { name: "Batch", path: "/v1/batch" },
  embeddings: { name: "Embeddings", path: "/v1/embeddings" },
  "audio-transcriptions": {
    name: "Audio Transcriptions",
    path: "/v1/audio/transcriptions",
  },
  "audio-speech": { name: "Audio Speech", path: "/v1/audio/speech" },
} as const;
