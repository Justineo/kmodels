# NVIDIA NIM

Status: implemented

Kmodels covers the public model-ID inventory from NVIDIA's hosted
[`GET /v1/models`](https://integrate.api.nvidia.com/v1/models). This is the inventory of the
shared endpoint, which can be collected without a key. The
[NVIDIA API Catalog quickstart](https://docs.api.nvidia.com/nim/docs/api-quickstart)
describes the hosted service and its invocation credentials.

The response supplies exact model identifiers. It does not establish which inference routes
each ID supports, per-account access, commercial rates, or release dates. The catalog scope
is non-exhaustive because the broader NVIDIA site also covers other endpoint families,
partner endpoints and downloadable artifacts.

This is a catalog-only provider. NVIDIA's developer program and self-hosted enterprise
licensing do not establish a per-model rate for this inventory. The
[Triton repository index](https://docs.nvidia.com/deeplearning/triton-inference-server/user-guide/docs/protocol/extension_model_repository.html)
reports models configured on an individual Triton deployment, outside the hosted NIM scope.
