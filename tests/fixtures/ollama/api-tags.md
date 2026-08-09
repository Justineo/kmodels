# List models

```yaml
paths:
  /api/tags:
    get:
      operationId: list
      responses:
        "200":
          schema:
            $ref: "#/components/schemas/ListResponse"
components:
  schemas:
    ListResponse:
      properties:
        models:
          items:
            $ref: "#/components/schemas/ModelSummary"
    ModelSummary:
      properties:
        name: { type: string }
        model: { type: string }
        remote_model: { type: string }
        remote_host: { type: string }
        modified_at: { type: string }
        size: { type: integer }
        digest: { type: string }
        details:
          properties:
            format: { type: string }
            family: { type: string }
            families: { type: array }
            parameter_size: { type: string }
            quantization_level: { type: string }
```
