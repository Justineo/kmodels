# Models

Jev is TypeSafe's flagship model and the first [System One model](/concepts/system-one). Every model on this page is served by the same endpoint, `POST /v1/systemone`. The request's `model` field selects which one handles the call.

## Current models

| Jev 1.13                    | `jev-1.13.0`                                                                              |
| :-------------------------- | :---------------------------------------------------------------------------------------- |
| Price (per Btok / per Mtok) | \$42 / \$0.042                                                                            |
| Rate limits                 | 250,000 tokens per second / 1,200 requests per minute                                     |
| Context length              | 64k tokens per request; 32k tokens for `state` plus the longest question                  |
| Input                       | Text only. String, JSON object, or array of text values. No image, audio, or video input. |

- **Price:** Charged per input token. Output tokens are free. A Btok is a billion tokens and an Mtok is a million tokens.
- **Context length:** Jev ingests the `state` once and evaluates every question against it in parallel. The 64k budget covers the `state` plus all questions combined; the 32k budget applies to the `state` plus the single longest question.

## Aliases

An alias is a model name that resolves to a versioned model ID. Send it in the `model` field like any other name.

| Alias         | Points to    | Meaning                                                                   |
| :------------ | :----------- | :------------------------------------------------------------------------ |
| `jev-latest`  | `jev-1.13.0` | The most recent stable, official release. The default in our client SDKs. |
| `jev-preview` | `jev-1.13.0` | The most recent release, whether or not it is an official one.            |

## Listing models

`GET /v1/models` returns the names your account can send in the `model` field, with a description and release date for each. It currently lists the aliases. Versioned IDs such as `jev-1.13.0` are accepted by the `model` field whether or not they appear in the list.
