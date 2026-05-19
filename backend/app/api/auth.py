from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from ..core.auth import TokenResponse, create_token, verify_login

router = APIRouter(tags=["auth"])


class LoginRequest(BaseModel):
    username: str
    password: str


@router.post("/auth/login", response_model=TokenResponse)
async def login(body: LoginRequest):
    if not verify_login(body.username, body.password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    return TokenResponse(access_token=create_token(body.username))
