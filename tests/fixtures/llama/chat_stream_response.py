from typing import List, Optional
from typing_extensions import Literal
from .._models import BaseModel

class EventMetric(BaseModel):
    metric: str
    value: float
    unit: Optional[str] = None

class Event(BaseModel):
    event_type: Literal["start", "complete", "progress", "metrics"]
    metrics: Optional[List[EventMetric]] = None
