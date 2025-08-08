from enum import Enum
from dataclasses import dataclass
from typing import List, Optional


@dataclass
class FormField:
    tag: str
    xpath: str
    name: Optional[str] = None
    id: Optional[str] = None
    type: Optional[str] = None
    value: Optional[str] = None
    placeholder: Optional[str] = None
    required: bool = False
    maxlength: Optional[str] = None
    checked: Optional[bool] = None
    selected_options: Optional[List[dict]] = None

@dataclass
class Form:
    index: int
    action: Optional[str] = None
    method: str = "GET"
    id: Optional[str] = None
    className: Optional[List[str]] = None
    action_absolute: Optional[str] = None
    fields: List[FormField] = None

class FormSendResult(Enum):
    GET_FAILED = 1
    FILLING_FAILED = 2
    SUBMIT_FAILED = 3
    SUCCESS = 4