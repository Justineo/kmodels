# Together AI

Status: implemented

The [Serverless model catalog](https://docs.together.ai/docs/serverless/models) owns public
admission. Accept exact API model strings from the model tables. When Chat and Vision list
the same ID, retain one model and add image input from Vision. The dedicated catalog is a
separate product. The catalog is non-exhaustive and describes the shared Serverless API.

The optional authenticated `GET /v1/models` uses `TOGETHER_API_KEY`. Treat it as a scoped
inventory. It can fill an unknown context length on an exact public match. Account-only
entries and inventory pricing cannot define a public model or rate. A missing credential or
failed inventory leaves the public source independently usable.

The public tables supply exact USD token rates and the listed audio duration and character
rates. Cached input is an independent quantity where Together publishes a cached rate.
US-only token pricing joins a unique exact catalog label in the dedicated US table and
keeps its endpoint selector separate from the standard endpoint. Exact API IDs bind these
offers through the shared inference-price lookup.

Image estimates, step-dependent megapixel rates and video examples remain raw when the
published headline does not establish a complete executable billing rule. Batch discounts,
provisioned throughput, dedicated capacity and negotiated account terms are outside this
source's commercial scope.
