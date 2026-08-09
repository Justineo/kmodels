# Public models

This endpoint supports three response formats via the `format` query parameter:
Default (Cerebras), OpenRouter, and HuggingFace. Options: `openrouter`, `huggingface`.

The native response reports Pricing per token in USD.

- `prompt`: Cost per prompt token.
- `completion`: Cost per completion token.

The OpenRouter `input_cache_read` field describes Cost per cached input token read (typically
`"0"`). These compatibility placeholders are not native cache prices.

The HuggingFace response reports Pricing in USD per million tokens.
