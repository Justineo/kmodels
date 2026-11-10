# Models

Jev is TypeSafe's flagship model and the first [System One model](/concepts/system-one). Every model on this page is served by the same endpoint, `POST /v1/systemone`. The request's `model` field selects which one handles the call; see the [API reference](/api) for the full request shape.

## Current models

|                             | Jev 1.14                           | Jev 1.13                           |
| :-------------------------- | :--------------------------------- | :--------------------------------- |
| Model ID                    | `jev-1.14.0`                       | `jev-1.13.0`                       |
| Price (per Btok / per Mtok) | $42 / $0.042                       | $42 / $0.042                       |
| Context length              | 64k per-request / 32k per-question | 64k per-request / 32k per-question |
| Input                       | Text, images                       | Text, images                       |
| Question types              | Choice, Score, Noul, Box           | Choice, Score, Noul                |

- **Price:** You pay per input token. Output tokens are free. A Btok is a billion tokens and an Mtok is a million tokens.
- **Input:** Jev reads natural-language text, sent as a string, a JSON object, or an array of text values. It also reads PNG and JPEG [images](/images) anywhere in the request.
- **Question types:** [Box](/primitives/box) questions need Jev 1.14.

## Aliases

An alias is a model name that points to a versioned model ID. Send it in the `model` field the same way you send a model ID.

| Alias         | Points to    | Meaning                                   |
| :------------ | :----------- | :---------------------------------------- |
| `jev-latest`  | `jev-1.13.0` | The most recent stable, official release. |
| `jev-preview` | `jev-1.14.0` | The most recent release, official or not. |
