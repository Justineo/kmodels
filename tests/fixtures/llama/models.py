from typing import Type, cast

from .._wrappers import DataWrapper
from ..types.llama_model import LlamaModel
from ..types.model_list_response import ModelListResponse


class ModelsResource(SyncAPIResource):
    def retrieve(self, model: str) -> LlamaModel:
        return self._get(f"/models/{model}", cast_to=LlamaModel)

    def list(
        self,
        *,
        extra_headers: Headers | None = None,
        extra_query: Query | None = None,
        extra_body: Body | None = None,
        timeout: float | httpx.Timeout | None | NotGiven = not_given,
    ) -> ModelListResponse:
        return self._get(
            "/models",
            options=make_request_options(
                extra_headers=extra_headers,
                extra_query=extra_query,
                extra_body=extra_body,
                timeout=timeout,
                post_parser=DataWrapper[ModelListResponse]._unwrapper,
            ),
            cast_to=cast(Type[ModelListResponse], DataWrapper[ModelListResponse]),
        )


class AsyncModelsResource(AsyncAPIResource):
    pass
