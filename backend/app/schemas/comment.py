from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

CommentEntityType = Literal["work_order", "inspection", "service_request", "schedule"]


class CommentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    entity_type: CommentEntityType
    entity_id: int
    body: str
    created_by: int | None = None
    author_name: str | None = None
    created_at: datetime
    edited_at: datetime | None = None


class CommentCreate(BaseModel):
    entity_type: CommentEntityType
    entity_id: int
    body: str = Field(min_length=1, max_length=5000)


class CommentUpdate(BaseModel):
    body: str = Field(min_length=1, max_length=5000)


class CommentListResponse(BaseModel):
    items: list[CommentRead]
