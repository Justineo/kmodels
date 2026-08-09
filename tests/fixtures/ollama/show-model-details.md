# Show model details

```yaml
paths:
  /api/show:
    post:
      operationId: show
      requestBody:
        schema:
          $ref: "#/components/schemas/ShowRequest"
      responses:
        "200":
          schema:
            $ref: "#/components/schemas/ShowResponse"
components:
  schemas:
    ShowRequest:
      properties:
        model: { type: string }
    ShowResponse:
      properties:
        parameters: { type: string }
        license: { type: string }
        modified_at: { type: string }
        details: { type: object }
        template: { type: string }
        capabilities: { type: array }
        model_info: { type: object }
```
