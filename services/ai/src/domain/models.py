from pydantic import BaseModel


class GeneratedPost(BaseModel):
    title: str
    body: str
    summary: str
    tags: list[str]
