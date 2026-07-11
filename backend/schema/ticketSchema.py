from uuid import UUID
from pydantic import BaseModel,Field

class EditedFile(BaseModel):
    filename:str
    content:str


class SubmissionRequest(BaseModel):
    idempotency_key:UUID
    framework:str
    challenge_id:int
    base_ref:str
    files: list[EditedFile] = Field(min_length=1)