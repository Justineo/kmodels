from typing_extensions import Literal

from .._models import BaseModel


class LlamaModel(BaseModel):
    id: str
    """The unique model identifier."""

    created: int
    """The creation time of the model."""

    object: Literal["model"]
    """The object type."""

    owned_by: str
    """The owner of the model."""
