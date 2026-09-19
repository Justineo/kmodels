# Parse

POST https://api.cohere.com/v2/parse
Content-Type: application/json

## Request

- `model` (string, required)
- `document` (object, required)
  - `type` (enum, required): `image_url`
  - `image_url` (string, required)

## Response

- `pages` (list of object, required)
- `meta` (object, optional)
  - `billed_units` (object, optional)
    - `pages` (double, optional) — The number of billed pages parsed.

## Examples

```json
{
  "model": "parse-v5.0",
  "document": { "type": "image_url", "image_url": "https://cohere.com/favicon-32x32.png" }
}
```

```json
{
  "pages": [{ "type": "markdown", "index": 0, "markdown": { "content": "# Sample Document" } }],
  "meta": { "billed_units": { "pages": 1 } }
}
```
