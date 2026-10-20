<!-- Reviewed excerpt of https://docs.typesafe.ai/api/system-one.md, observed 2026-10-20. Schema owners and reference paths retained; examples and unrelated fields omitted. -->

# System One

## OpenAPI

```yaml https://api.typesafe.ai/openapi.json post /v1/systemone
openapi: 3.1.0
paths:
  /v1/systemone:
    post:
      requestBody:
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/SystemOneRequest"
      responses:
        "200":
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/SystemOneResponse"
components:
  schemas:
    SystemOneRequest:
      properties:
        questions:
          additionalProperties:
            $ref: "#/components/schemas/Question"
          type: object
      type: object
    SystemOneResponse:
      properties:
        answers:
          additionalProperties:
            $ref: "#/components/schemas/Answer"
          type: object
        usage:
          $ref: "#/components/schemas/Usage"
      type: object
    Answer:
      oneOf:
        - $ref: "#/components/schemas/NoulAnswer"
        - $ref: "#/components/schemas/ChoiceAnswer"
        - $ref: "#/components/schemas/ScoreAnswer"
    NoulAnswer:
      type: object
    ChoiceAnswer:
      type: object
    ScoreAnswer:
      type: object
    Question:
      oneOf:
        - $ref: "#/components/schemas/NoulQuestion"
        - $ref: "#/components/schemas/ChoiceQuestion"
        - $ref: "#/components/schemas/ScoreQuestion"
      discriminator:
        propertyName: type
    Usage:
      properties:
        input_tokens:
          type: integer
        output_tokens:
          type: integer
      type: object
    NoulQuestion:
      properties:
        type:
          type: string
          const: noul
      type: object
    ChoiceQuestion:
      properties:
        type:
          type: string
          const: choice
      type: object
    ScoreQuestion:
      properties:
        type:
          type: string
          const: score
      type: object
```
