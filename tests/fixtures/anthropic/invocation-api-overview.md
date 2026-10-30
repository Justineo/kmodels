---
title: API overview
url: https://platform.claude.com/docs/en/api/overview
description: Understand the Claude API's available endpoints, authentication headers, client SDKs, pagination, rate limits, and cloud platform access options.
---

The Claude API is a RESTful API at `https://api.anthropic.com` that provides programmatic access to Claude models and Claude Managed Agents.

<Note>
  **New to Claude?** For direct model access, start with [Get started](https://platform.claude.com/docs/en/get-started) and [Working with Messages](https://platform.claude.com/docs/en/build-with-claude/working-with-messages). For managed agent infrastructure, see the [Claude Managed Agents quickstart](https://platform.claude.com/docs/en/managed-agents/quickstart).
</Note>

## Prerequisites

To use the Claude API, you need:

- A [Claude Console account](https://platform.claude.com/)
- An [API key](https://platform.claude.com/settings/keys) from the Console, or a configured [Workload Identity Federation](https://platform.claude.com/docs/en/manage-claude/workload-identity-federation) rule

For step-by-step setup instructions, see [Get started](https://platform.claude.com/docs/en/get-started).

## Available APIs

The Claude API includes the following APIs:

- **[Messages API](https://platform.claude.com/docs/en/api/messages/create):** Send messages to Claude for conversational interactions (`POST /v1/messages`)
- **[Message Batches API](https://platform.claude.com/docs/en/api/messages/batches/create):** Process large volumes of Messages requests asynchronously with a 50 percent cost reduction (`POST /v1/messages/batches`)
- **[Token Counting API](https://platform.claude.com/docs/en/api/messages/count_tokens):** Count tokens in a message before sending to manage costs and rate limits (`POST /v1/messages/count_tokens`)
- **[Models API](https://platform.claude.com/docs/en/api/models/list):** List available Claude models and their details (`GET /v1/models`)
- **[Files API](https://platform.claude.com/docs/en/api/files/upload):** Upload and manage files for use across multiple API calls (`POST /v1/files`, `GET /v1/files`)
- **[Skills API](https://platform.claude.com/docs/en/api/skills/create):** Create and manage custom agent skills (`POST /v1/skills`, `GET /v1/skills`)

The following APIs are in beta:

- **[Agents API](https://platform.claude.com/docs/en/managed-agents/agent-setup):** Define reusable, versioned agent configurations for Claude Managed Agents (`POST /v1/agents`, `GET /v1/agents`)
- **[Sessions API](https://platform.claude.com/docs/en/managed-agents/sessions):** Run stateful agent sessions in managed cloud sandboxes (`POST /v1/sessions`, `GET /v1/sessions/{id}/events/stream`)
- **[Environments API](https://platform.claude.com/docs/en/managed-agents/environments):** Configure sandbox templates for agent sessions (`POST /v1/environments`, `GET /v1/environments`)

For the complete API reference with all endpoints, parameters, and response schemas, explore the API reference pages listed in the navigation. To access beta features, see [Beta headers](https://platform.claude.com/docs/en/api/beta-headers).

## Authentication

For details on each authentication method and when to use it, see [Authentication](https://platform.claude.com/docs/en/manage-claude/authentication). Requests to the Claude API include these headers:

| Header                   | Value                                                                                                                                                                                                                                                                    | Required                                                                                                                                                                                                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Authorization`          | `Bearer <token>`, where `<token>` is your API key or a short-lived access token obtained from `POST /v1/oauth/token` through [Workload Identity Federation](https://platform.claude.com/docs/en/manage-claude/workload-identity-federation)                              | Yes, unless `x-api-key` is set                                                                                                                                                                                                                                               |
| `x-api-key`              | Your API key from Console. Legacy fallback for `Authorization`, still supported                                                                                                                                                                                          | No                                                                                                                                                                                                                                                                           |
| `anthropic-workspace-id` | ID of the [workspace](https://platform.claude.com/docs/en/manage-claude/workspaces) the request runs in (for example, `wrkspc_01JwQvzr7rXLA5AGx3HKfFUJ`). See [Select a workspace](https://platform.claude.com/docs/en/manage-claude/authentication#select-a-workspace). | Required with an API key that isn’t scoped to a workspace. Optional for other API keys. A key created for a single workspace runs in that workspace when you omit the header. Not used with Workload Identity Federation tokens, which select a workspace at token exchange. |
| `anthropic-version`      | API version (for example, `2026-10-21`)                                                                                                                                                                                                                                  | Yes                                                                                                                                                                                                                                                                          |
| `content-type`           | `application/json`                                                                                                                                                                                                                                                       | Yes                                                                                                                                                                                                                                                                          |

If you are using the [Client SDKs](https://platform.claude.com/docs/en/api/overview#client-sdks), the SDK sends the authentication, version, and content-type headers automatically; you pass `anthropic-workspace-id` yourself when your key needs it. For API versioning details, see [API versions](https://platform.claude.com/docs/en/api/versioning).

When accessing Claude through a [cloud platform](https://platform.claude.com/docs/en/api/overview#claude-api-vs-cloud-platforms), authentication is integrated with the cloud provider’s IAM system. See the platform-specific documentation for supported credential types, required headers, and authentication options.

### Getting API keys

The API is made available through the web [Console](https://platform.claude.com/). In the Console, you can use [playground](https://platform.claude.com/playground) (`platform.claude.com/playground`) to try out the API in the browser and then generate API keys on the [API keys](https://platform.claude.com/settings/keys) page (`platform.claude.com/settings/keys`). To learn how, see [Get your Claude API key](https://platform.claude.com/docs/en/get-api-key). You choose each key’s type (see [Key types](https://platform.claude.com/docs/en/manage-claude/authentication#key-types)) and its [expiration](https://platform.claude.com/docs/en/manage-claude/authentication#key-expiration) when you create it. Use [workspaces](https://platform.claude.com/settings/workspaces) in the Console to separate environments and [control spend](https://platform.claude.com/docs/en/api/rate-limits) by use case.
