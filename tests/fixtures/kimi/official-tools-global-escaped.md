# How to Use Official Tools in Kimi API

Kimi Open Platform documents Formula execution through the standard `function` tool flow.

1. `GET /v1/formulas/{uri}/tools` — fetch the tool declarations.
2. `POST /v1/chat/completions` — the model returns standard `function`-type `tool_calls`.
3. `POST /v1/formulas/{uri}/fibers` — this step produces the tool\_call billing.

The example uses `moonshot/web-search:latest`.
