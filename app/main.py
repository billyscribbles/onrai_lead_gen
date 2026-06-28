"""FastAPI app assembly: middleware, routers, static SPA, startup."""
from __future__ import annotations

import logging
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from starlette.middleware.sessions import SessionMiddleware

from app import auth, db, ingest
from app.config import settings
from app.routers import auth as auth_router
from app.routers import engines as engines_router
from app.routers import leads as leads_router
from app.routers import runs as runs_router

log = logging.getLogger("lead_gen")
app = FastAPI(title="Lead-Gen Dashboard")
app.add_middleware(SessionMiddleware, secret_key=settings.session_secret,
                   same_site="lax", https_only=False)

app.include_router(auth_router.router)
app.include_router(engines_router.router)
app.include_router(runs_router.router)
app.include_router(leads_router.router)


@app.on_event("startup")
def _startup():
    conn = db.connect()
    try:
        db.init_db(conn)
        ingest.ingest_existing(conn)
    finally:
        conn.close()
    if not auth.password_required():
        log.warning("APP_PASSWORD not set — dashboard is OPEN (no login).")


@app.get("/api/health")
def health():
    return {"ok": True}


# --- Static SPA (built React) -------------------------------------------------
_DIST = Path(__file__).resolve().parent.parent / "web" / "dist"
if _DIST.exists():
    app.mount("/assets", StaticFiles(directory=_DIST / "assets"), name="assets")

    @app.get("/{full_path:path}")
    def spa(full_path: str):
        candidate = _DIST / full_path
        if full_path and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(_DIST / "index.html")
