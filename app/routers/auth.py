from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app import auth

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginBody(BaseModel):
    password: str


@router.post("/login")
def login(body: LoginBody, request: Request):
    if not auth.check_password(body.password):
        raise HTTPException(status_code=401, detail="Wrong password")
    request.session["authed"] = True
    return {"ok": True}


@router.post("/logout")
def logout(request: Request):
    request.session.clear()
    return {"ok": True}


@router.get("/me")
def me(request: Request):
    return {"authed": bool(request.session.get("authed")) or not auth.password_required(),
            "password_required": auth.password_required()}
