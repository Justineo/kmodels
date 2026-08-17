# Pricing

Flagship models

Standard

### Standard pricing data

| Model                          | Short context input | Short context cached input | Short context cache writes | Short context output | Long context input | Long context cached input | Long context cache writes | Long context output |
| ------------------------------ | ------------------- | -------------------------- | -------------------------- | -------------------- | ------------------ | ------------------------- | ------------------------- | ------------------- |
| gpt-5.4 (<272K context length) | $2.50               | $0.25                      | -                          | $15.00               | $5.00              | $0.50                     | -                         | $22.50              |

Batch

### Batch pricing data

| Model                          | Short context input | Short context cached input | Short context cache writes | Short context output | Long context input | Long context cached input | Long context cache writes | Long context output |
| ------------------------------ | ------------------- | -------------------------- | -------------------------- | -------------------- | ------------------ | ------------------------- | ------------------------- | ------------------- |
| gpt-5.4 (<272K context length) | $1.25               | $0.13                      | -                          | $7.50                | $2.50              | $0.25                     | -                         | $11.25              |

Flex

### Flex pricing data

| Model                          | Short context input | Short context cached input | Short context cache writes | Short context output | Long context input | Long context cached input | Long context cache writes | Long context output |
| ------------------------------ | ------------------- | -------------------------- | -------------------------- | -------------------- | ------------------ | ------------------------- | ------------------------- | ------------------- |
| gpt-5.4 (<272K context length) | $1.25               | $0.13                      | -                          | $7.50                | $2.50              | $0.25                     | -                         | $11.25              |

Fast mode

### Fast pricing data

| Model                          | Short context input | Short context cached input | Short context cache writes | Short context output |
| ------------------------------ | ------------------- | -------------------------- | -------------------------- | -------------------- |
| gpt-5.4 (<272K context length) | $5.00               | $0.50                      | -                          | $30.00               |

Image generation models

Standard

### Grouped Pricing Table data

| Model       | Modality | Input | Cached input | Output |
| ----------- | -------- | ----- | ------------ | ------ |
| gpt-image-2 | Image    | $8.00 | $2.00        | $30.00 |
| gpt-image-2 | Text     | $5.00 | $1.25        | -      |

Batch

### Grouped Pricing Table data

| Model       | Modality | Input | Cached input | Output |
| ----------- | -------- | ----- | ------------ | ------ |
| gpt-image-2 | Image    | $4.00 | $1.00        | $15.00 |
| gpt-image-2 | Text     | $2.50 | $0.625       | -      |

Transcription models

Prices per 1M tokens unless noted.

| Model             | Use case      | Input | Output | Estimated cost   |
| ----------------- | ------------- | ----- | ------ | ---------------- |
| gpt-transcribe    | Transcription | -     | -      | $0.0045 / minute |
| gpt-4o-transcribe | Transcription | $2.50 | $10.00 | $0.006 / minute  |
| Whisper           | Transcription | -     | -      | $0.006 / minute  |

Tools

### Grouped Pricing Table data

| Tool        | Details                                                  | Pricing                                                                               |
| ----------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Web search  | Web search (all models)                                  | $10.00 / 1k calls + Search content tokens billed at model rates.                      |
| Web search  | Image Web search (all models)                            | $10.00 / 1k calls + Search content tokens billed at model rates.                      |
| Web search  | Web search preview (reasoning models, including `gpt-5`) | $10.00 / 1k calls + Search content tokens billed at model rates.                      |
| Web search  | Web search preview (non-reasoning models)                | $25.00 / 1k calls + Search content tokens are free.                                   |
| Containers  | Hosted Shell and Code Interpreter                        | 1 GB $0.03, 4 GB $0.12, 16 GB $0.48, 64 GB $1.92 per 20-minute session per container. |
| File search | Storage                                                  | $0.10 / GB per day (1 GB free)                                                        |
| File search | Tool call                                                | $2.50 / 1k calls                                                                      |
| Agent Kit   | ChatKit file and image upload storage                    | $0.10 / GB-day after 1 GB free per account per month                                  |

Specialized models

Standard

### Grouped Pricing Table data

| Category   | Model                  | Input | Cached input | Output |
| ---------- | ---------------------- | ----- | ------------ | ------ |
| Search     | gpt-5-search-api       | $1.25 | $0.125       | $10.00 |
| Moderation | omni-moderation-latest | Free  | -            | -      |

Finetuning

Standard

### Pricing Table data

| Model                             | Training       | Input | Cached input | Output |
| --------------------------------- | -------------- | ----- | ------------ | ------ |
| gpt-4.1-2025-04-14                | $25.00         | $3.00 | $0.75        | $12.00 |
| o4-mini-2025-04-16                | $100.00 / hour | $4.00 | $1.00        | $16.00 |
| o4-mini-2025-04-16 (data sharing) | $100.00 / hour | $2.00 | $0.50        | $8.00  |

Batch

### Pricing Table data

| Model                             | Training       | Input | Cached input | Output |
| --------------------------------- | -------------- | ----- | ------------ | ------ |
| o4-mini-2025-04-16                | $100.00 / hour | $2.00 | $0.50        | $8.00  |
| o4-mini-2025-04-16 (data sharing) | $100.00 / hour | $1.00 | $0.25        | $4.00  |
