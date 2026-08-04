from typing import List, Optional
from .._models import BaseModel

class Metric(BaseModel):
    metric: str
    value: float
    unit: Optional[str] = None

class CreateChatCompletionResponse(BaseModel):
    completion_message: object
    metrics: Optional[List[Metric]] = None
