from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from ..core.auth import TokenResponse, create_token, require_auth, verify_login
from ..core.config import get_settings

router = APIRouter(tags=["auth"])


class LoginRequest(BaseModel):
    username: str
    password: str


@router.post("/auth/login", response_model=TokenResponse)
async def login(body: LoginRequest):
    if not verify_login(body.username, body.password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    return TokenResponse(access_token=create_token(body.username))


@router.get("/auth/client-config", dependencies=[Depends(require_auth)])
async def client_config():
    """Connection bundle for mobile clients: after backend login the app can
    auto-configure its direct Navidrome/Subsonic account from this (single
    login step instead of two)."""
    settings = get_settings()
    return {
        "navidrome_url": settings.NAVIDROME_PUBLIC_URL,
        "navidrome_username": settings.NAVIDROME_USER,
        "navidrome_password": settings.NAVIDROME_PASS,
    }
