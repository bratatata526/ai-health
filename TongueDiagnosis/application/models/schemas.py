from typing import Optional

from pydantic import BaseModel


class Result(BaseModel):
    tongue_color: Optional[int] = None
    coating_color: Optional[int] = None
    tongue_thickness: Optional[int] = None
    rot_greasy: Optional[int] = None


class UploadResponse(BaseModel):
    code: int
    message: str
    data: Optional[dict] = None
