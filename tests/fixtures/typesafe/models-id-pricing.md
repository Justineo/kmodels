# Models

Every model on this page is served by the same endpoint, `POST /v1/systemone`. The request's `model` field selects which one handles it; see the [API reference](https://docs.typesafe.ai/api) for the full request shape.

## Current models

|                             | Jev 1.14                           | Jev 1.13                           |
| :-------------------------- | :--------------------------------- | :--------------------------------- |
| Model ID                    | `jev-1.14.0`                       | `jev-1.13.0`                       |
| Price (per Btok / per Mtok) | \$42 / \$0.042                     | \$42 / \$0.042                     |
| Context length              | 64k per-request / 32k per-question | 64k per-request / 32k per-question |
| Input                       | Text                               | Text                               |

Jev 1.14 is the newest Jev release, available from October 14, 2026.

- **Price:** You pay per input token. Output tokens are free. A Btok is a billion tokens and an Mtok is a million tokens.

## Context length

### Long context

Long context is off by default and works on both Jev 1.14 and Jev 1.13. To turn it on, send the `TypeSafe-Danger-Zone-Long-Context: true` header with each request that needs it. With the header, the per-request context and the per-question context are both 262k tokens. Requests without the header keep the default limits in the table above.

Long context costs the same per token as any other request. It is slower and less accurate than staying within the default limits, so turn it on only for requests that need it.

## Aliases

An alias is a model name that points to a versioned model ID. Send it in the `model` field the same way you send a model ID.

| Alias         | Points to    | Meaning                                                                                                                |
| :------------ | :----------- | :--------------------------------------------------------------------------------------------------------------------- |
| `jev-latest`  | `jev-1.14.0` | The most recent stable, official release. The default in our client SDKs, and the name the examples in these docs use. |
| `jev-preview` | `jev-1.14.0` | The most recent release, official or not. Moves ahead of `jev-latest` when a preview build is available.               |
