# Code execution tool

## Model compatibility

The code execution tool is available on the following models:

| Model                                      | Tool versions             |
| ------------------------------------------ | ------------------------- |
| Claude Fable 5 (claude-fable-5)            | `code_execution_20260521` |
| Claude Mythos 5 (claude-mythos-5)          | `code_execution_20260521` |
| Claude Opus 4.8 (claude-opus-4-8)          | `code_execution_20260521` |
| Claude Opus 4.7 (claude-opus-4-7)          | `code_execution_20260521` |
| Claude Sonnet 5 (claude-sonnet-5)          | `code_execution_20260521` |
| Claude Opus 4.1 (claude-opus-4-1-20250805) | `code_execution_20250825` |

For [Claude Mythos Preview](https://anthropic.com/glasswing), code execution is supported on the Claude API and Microsoft Foundry only.

## Usage and pricing

Code execution is free when used with web search or web fetch. When `web_search_20260209` (or later) or `web_fetch_20260209` (or later) is included in your API request, there are no additional charges for code execution tool calls beyond standard token costs.

When used without these tools, code execution is billed by execution time, tracked separately from token usage:

- Execution time has a minimum of 5 minutes
- Each organization receives 1,550 free hours of usage per month
- Additional usage beyond 1,550 hours is billed at $0.05 USD per hour, per container

```json
{ "usage": { "server_tool_use": { "code_execution_requests": 1 } } }
```
