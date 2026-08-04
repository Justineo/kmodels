# Data controls in the OpenAI platform

## Data residency controls

### API Endpoint, tool and model support

| Endpoint or feature                                                  | Service          | Storage regions    | Processing regions                                              | Supported models and snapshots            | Regional processing snapshot exceptions    | Notes |
| -------------------------------------------------------------------- | ---------------- | ------------------ | --------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------ | ----- |
| `/v1/audio/transcriptions, /v1/audio/translations, /v1/audio/speech` | Audio            | All listed regions | United States, Europe (EEA + Switzerland)                       | `tts-1`, `whisper-1`, `gpt-4o-tts`        | None                                       | —     |
| `/v1/chat/completions`                                               | Chat Completions | All listed regions | United States, Europe (EEA + Switzerland), United Arab Emirates | `gpt-5.2-2025-12-11`, `gpt-4o-2024-11-20` | United Arab Emirates: `gpt-5.2-2025-12-11` | —     |
| `/v1/responses`                                                      | Responses        | All listed regions | United States, Europe (EEA + Switzerland), United Arab Emirates | `gpt-5.2-2025-12-11`, `gpt-4o-2024-11-20` | United Arab Emirates: `gpt-5.2-2025-12-11` | —     |
| `Code Interpreter tool`                                              | Tools            | All listed regions | United States, Europe (EEA + Switzerland)                       | Service-level support                     | None                                       | —     |
