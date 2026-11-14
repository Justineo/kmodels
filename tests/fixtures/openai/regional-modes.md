# Data residency

In Australia, India, and Japan, `gpt-6-luna` supports regional processing. These regions support Standard pay-as-you-go only. Use a project in the selected region. The Responses and Chat Completions APIs support text and image inputs and text output. Hosted tools are unavailable for regional processing in these three regions.

### API Endpoint, tool and model support

| Endpoint or feature | Service   | Storage regions    | Processing regions                                                                       | Supported models and snapshots                             | Regional processing snapshot exceptions                                         | Notes                                                                |
| ------------------- | --------- | ------------------ | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `/v1/responses`     | Responses | All listed regions | United States, Europe (EEA + Switzerland), United Arab Emirates, Australia, India, Japan | `gpt-6-astra`, `gpt-6.1-sol`, `gpt-6-luna`, `gpt-5.6-luna` | United Arab Emirates: `gpt-5.6-luna`<br />Australia, India, Japan: `gpt-6-luna` | Fast mode supports EU data residency for GPT-6.1 Sol and GPT-6 Luna. |
