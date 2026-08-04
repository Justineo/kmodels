from typing import List
from .._models import BaseModel

class Result(BaseModel):
    flagged: bool

class ModerationCreateResponse(BaseModel):
    model: str
    results: List[Result]
