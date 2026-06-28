"""Single shared-password auth via signed-cookie session."""
from __future__ import annotations

import hmac

from fastapi import HTTPException, Request

from app.config import settings


def password_required() -> bool:
    return bool(settings.app_password)


def check_password(candidate: str) -> bool:
    if not password_required():
        return True
    return hmac.compare_digest(candidate or "", settings.app_password)


def require_auth(request: Request) -> None:
    if not password_required():
        return
    if not request.session.get("authed"):
        raise HTTPException(status_code=401, detail="Not authenticated")
