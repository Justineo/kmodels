---
title: Fast mode
url: https://platform.claude.com/docs/en/build-with-claude/fast-mode
description: Get up to 2.5x higher output tokens per second from supported Claude models.
featureMetadata:
  betaHeader: fast-mode-2026-02-01
  zdr:
    eligibility: eligible
    note: Excludes [Covered Models](https://platform.claude.com/docs/en/manage-claude/api-and-data-retention#model-specific-data-retention-requirements). Same Messages API endpoint with faster inference. ZDR applies regardless of speed setting.
  supportedModels:
    - claude-opus-5-5
    - claude-opus-5
    - claude-opus-4-8
  supportedPlatforms:
    Claude API: ga
    Claude Models on Google Cloud (Anthropic managed): ga
    Microsoft Foundry (hosted on Azure): ga
  details:
    - Fast mode on Claude Opus 5 and Claude Opus 4.8 is in research preview and needs the `fast-mode-2026-02-01` beta header.
---

**API support**: Usage differs by product.

- **Messages API**: Set `speed: "fast"` on the request.
- **Managed Agents**: Set `speed` on the agent’s model object, for example `{"id": "claude-opus-5-5", "speed": "fast"}`.

Fast mode delivers up to 2.5x higher output tokens per second at premium pricing. Set `speed: "fast"` on your request to opt in. Fast mode is available on Claude Opus 5.5 and in research preview on Claude Opus 5 and Claude Opus 4.8.

## How fast mode works

Fast mode runs the same model with a faster inference configuration. There is no change to intelligence or capabilities.

- Up to 2.5x higher output tokens per second compared to standard speed
- Speed benefits are focused on output tokens per second (OTPS), not time to first token (TTFT)
- Compatible with [streaming](https://platform.claude.com/docs/en/build-with-claude/streaming), where the OTPS gain is most visible

## Checking which speed was used

The response `usage` object includes a `speed` field that indicates which speed was used, either `"fast"` or `"standard"`. Requesting `speed: "fast"` on a [model that doesn’t support fast mode](https://platform.claude.com/docs/en/build-with-claude/fast-mode#availability-feature-support) returns an error, and so does exceeding fast mode’s rate limits or capacity (a `429` or `529`). When a request with `speed: "fast"` succeeds, `usage.speed` is `"fast"`. Claude Opus 4.6 is an exception: instead of returning an error, a request with `speed: "fast"` and the `fast-mode-2026-02-01` beta header succeeds, but runs at standard speed. This behavior is correctly reflected in `usage.speed`, which shows `"standard"` in this situation. On Claude Models on Google Cloud (Anthropic managed), a Claude Opus 4.6 request with `speed: "fast"` returns a `400` error even with the header.

## Considerations

- **Batch API:** Fast mode is not available with the [Batch API](https://platform.claude.com/docs/en/build-with-claude/batch-processing).
- **Priority Tier:** Fast mode is not available with a [Priority Tier](https://platform.claude.com/docs/en/api/service-tiers) commitment.

## Pricing

Fast mode is priced at a multiplier on standard rates across the full context window, including requests over 200k input tokens.

| Model                           | Input          | Output         |
| ------------------------------- | -------------- | -------------- |
| Claude Opus 5.5                 | $8 USD / MTok  | $40 USD / MTok |
| Claude Opus 5 / Claude Opus 4.8 | $10 USD / MTok | $50 USD / MTok |

Fast mode pricing stacks with other pricing modifiers:

- [Prompt caching multipliers](https://platform.claude.com/docs/en/about-claude/pricing#prompt-caching) apply on top of fast mode pricing.
- [Data residency](https://platform.claude.com/docs/en/manage-claude/data-residency) multipliers apply on top of fast mode pricing.

For complete pricing details, see the [Pricing](https://platform.claude.com/docs/en/about-claude/pricing#fast-mode-pricing) page.

## Availability

Fast mode is available or in research preview on select models and eligible for zero data retention and HIPAA readiness.

### API support

Fast mode is available only on the following models. If you were using fast mode on an earlier model, [migrate to a model that supports fast mode](https://platform.claude.com/docs/en/models/opus-5-5/migration-guide).

To access fast mode on Claude Opus 5 or Claude Opus 4.8, contact your account manager or [join the waitlist](https://claude.com/fast-mode).

#### [Messages API](https://platform.claude.com/docs/en/build-with-claude/working-with-messages)

- Availability: Available
- Usage: Set `speed: "fast"` on the request.

| Status           | Cloud platforms                                                                                                                                                                                                                                                                                  | Models                                                                                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Available        | Claude API, [Claude Models on Google Cloud (Anthropic managed)](https://platform.claude.com/docs/en/build-with-claude/claude-models-on-google-cloud/anthropic-managed), [Microsoft Foundry (hosted on Azure)](https://platform.claude.com/docs/en/build-with-claude/claude-in-microsoft-foundry) | [Claude Opus 5.5](https://platform.claude.com/docs/en/models/opus-5-5/overview)                                                                              |
| Research preview | Claude API                                                                                                                                                                                                                                                                                       | [Claude Opus 5](https://platform.claude.com/docs/en/models/opus-5/overview), [Claude Opus 4.8](https://platform.claude.com/docs/en/models/opus-4-8/overview) |

#### [Managed Agents](https://platform.claude.com/docs/en/managed-agents/overview)

- Availability: Available
- Usage: Set `speed` on the agent’s model object, for example `{"id": "claude-opus-5-5", "speed": "fast"}`.

| Status           | Cloud platforms | Models                                                                                                                                                       |
| ---------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Available        | Claude API      | [Claude Opus 5.5](https://platform.claude.com/docs/en/models/opus-5-5/overview)                                                                              |
| Research preview | Claude API      | [Claude Opus 5](https://platform.claude.com/docs/en/models/opus-5/overview), [Claude Opus 4.8](https://platform.claude.com/docs/en/models/opus-4-8/overview) |

### Required beta headers

[Beta headers overview](https://platform.claude.com/docs/en/api/beta-headers)

Beta headers allow you to access experimental features and new model capabilities before they become part of the standard API.

| Header                 | Models                                                                                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `fast-mode-2026-02-01` | [Claude Opus 5](https://platform.claude.com/docs/en/models/opus-5/overview), [Claude Opus 4.8](https://platform.claude.com/docs/en/models/opus-4-8/overview) |

### Data handling

[Data handling overview](https://platform.claude.com/docs/en/manage-claude/api-and-data-retention#feature-eligibility)

| Item    | Zero data retention                                                                                                                                       | HIPAA    |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Status  | Eligible (excludes [Covered Models](https://platform.claude.com/docs/en/manage-claude/api-and-data-retention#model-specific-data-retention-requirements)) | Eligible |
| Details | Same Messages API endpoint with faster inference. ZDR applies regardless of speed setting.                                                                | —        |

Applicable endpoints:

- `/v1/messages` with `speed: "fast"`

## Next steps

<CardGroup cols={2}>
  <Card title="Structured outputs" icon="code-brackets" href="https://platform.claude.com/docs/en/build-with-claude/structured-outputs">
    Get validated JSON results from agent workflows.
  </Card>

  <Card title="Pricing" icon="calculator" href="https://platform.claude.com/docs/en/about-claude/pricing#fast-mode-pricing">
    Learn about Anthropic’s pricing structure for models and features.
  </Card>

  <Card title="Effort" icon="gauge" href="https://platform.claude.com/docs/en/build-with-claude/effort">
    Control how many tokens Claude uses when responding with the effort parameter, trading off between response thoroughness and token efficiency.
  </Card>

  <Card title="Streaming messages" icon="arrow-right" href="https://platform.claude.com/docs/en/build-with-claude/streaming">
    Stream Messages API responses incrementally with server-sent events, including text, tool use, and extended thinking deltas.
  </Card>
</CardGroup>
