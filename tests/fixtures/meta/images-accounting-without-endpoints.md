# Images schemas

The full schema and model definitions referenced by the [Images](https://dev.meta.ai/docs/api-reference/images/create-image) endpoints. Each endpoint page links here for the detailed shape of its request and response objects.

## Schemas

### Image Object

| Field      | Type     | Required | Description                |
| ---------- | -------- | -------- | -------------------------- |
| `b64_json` | `string` | No       | Base64-encoded image data. |
| `url`      | `string` | No       | Image URL.                 |

### Images Response

| Field   | Type                                                                                         | Required | Description                                   |
| ------- | -------------------------------------------------------------------------------------------- | -------- | --------------------------------------------- |
| `data`  | array of [`ImageObject`](https://dev.meta.ai/docs/api-reference/images/schemas#image-object) | Yes      | Array of generated images.                    |
| `usage` | [`ImageGenUsage`](https://dev.meta.ai/docs/api-reference/images/schemas#image-gen-usage)     | No       | Token usage for the image generation request. |
