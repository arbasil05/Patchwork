from uuid import UUID
from pydantic import BaseModel,Field

class EditedFile(BaseModel):
    filename:str
    content:str


class SubmissionRequest(BaseModel):
    idempotency_key:UUID
    challenge_id:str
    base_ref:str
    files: list[EditedFile] = Field(min_length=1)