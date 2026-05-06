from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class RoleRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    code: str
    name: str


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_uid: str
    email: EmailStr
    full_name: str
    phone: str | None = None
    is_active: bool
    last_login_at: datetime | None = None
    created_at: datetime
    updated_at: datetime
    roles: list[RoleRead] = []


class UserCreate(BaseModel):
    email: EmailStr
    full_name: str = Field(min_length=1)
    phone: str | None = Field(default=None, max_length=32)
    password: str = Field(min_length=12)
    role_codes: list[str] = []


class UserUpdate(BaseModel):
    full_name: str | None = Field(default=None, min_length=1)
    phone: str | None = Field(default=None, max_length=32)
    is_active: bool | None = None


class UserRolesUpdate(BaseModel):
    role_codes: list[str]


class UserListResponse(BaseModel):
    items: list[UserRead]
    page: int
    page_size: int
    total: int
