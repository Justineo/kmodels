---
title: Effort
featureMetadata:
  supportedModels:
    - claude-opus-5-5
    - claude-haiku-5-5
    - claude-opus-4-6
  supportedPlatforms:
    Claude API: stable
    Amazon Bedrock: stable
---

- **Messages API**: Set `output_config.effort` on the request. With no value, the model’s default level applies.
- **Managed Agents**: Set `effort` on the agent’s model object.

## How effort works

Most Claude models default to high effort, spending as many tokens as needed for excellent results; Claude Opus 5.5 and Claude Haiku 5.5 default to medium.

Setting `effort` to the model’s default (`"medium"` on Claude Opus 5.5 and Claude Haiku 5.5, `"high"` on other models) produces exactly the same behavior as omitting the `effort` parameter entirely.

### Effort levels

| Level    | Description                                                                                               | Typical use case |
| :------- | :-------------------------------------------------------------------------------------------------------- | :--------------- |
| `max`    | Absolute maximum capability. Available on Claude Opus 5.5, Claude Haiku 5.5, and Claude Opus 4.6.         | Deep analysis    |
| `xhigh`  | Extended capability. Available on Claude Opus 5.5 and Claude Haiku 5.5.                                   | Long tasks       |
| `high`   | More effort. The default on every model that supports effort except Claude Opus 5.5 and Claude Haiku 5.5. | Complex tasks    |
| `medium` | Balanced approach. The default on Claude Opus 5.5 and Claude Haiku 5.5.                                   | General tasks    |
| `low`    | Most efficient.                                                                                           | Simple tasks     |

## Recommended effort levels

**[Claude Opus 5.5](https://platform.claude.com/docs/en/models/opus-5-5/overview)**

Claude Opus 5.5 supports all five effort levels, and `medium` is the default.

## Availability

### API support

#### [Messages API](https://platform.claude.com/docs/en/build-with-claude/working-with-messages)

- Availability: Always on
- Usage: Set `output_config.effort` on the request. With no value, the model’s default level applies.

| Status    | Cloud platforms         | Models                                                                                                                                                                                                                                              |
| :-------- | :---------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Available | All supported platforms | [Claude Opus 5.5](https://platform.claude.com/docs/en/models/opus-5-5/overview), [Claude Haiku 5.5](https://platform.claude.com/docs/en/models/haiku-5-5/overview), [Claude Opus 4.6](https://platform.claude.com/docs/en/models/opus-4-6/overview) |

#### [Managed Agents](https://platform.claude.com/docs/en/managed-agents/overview)

| Status    | Cloud platforms | Models                                                                          |
| :-------- | :-------------- | :------------------------------------------------------------------------------ |
| Available | Claude API      | [Claude Opus 5.5](https://platform.claude.com/docs/en/models/opus-5-5/overview) |
