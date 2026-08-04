from typing import Iterable
from typing_extensions import Required, TypedDict
from ..message_param import MessageParam

class CompletionCreateParamsBase(TypedDict, total=False):
    messages: Required[Iterable[MessageParam]]
    model: Required[str]
    max_completion_tokens: int
    stream: bool
