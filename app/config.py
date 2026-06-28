"""Environment-driven settings for the dashboard backend."""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parent.parent / ".env")
except ImportError:  # python-dotenv optional
    pass


@dataclass(frozen=True)
class Settings:
    db_path: str
    apify_token: str | None
    app_password: str | None
    session_secret: str
    cost_per_place: float


def _load() -> Settings:
    return Settings(
        db_path=os.environ.get("DB_PATH", "output/leads.db"),
        apify_token=os.environ.get("APIFY_TOKEN") or os.environ.get("APIFY_API_TOKEN"),
        app_password=os.environ.get("APP_PASSWORD"),
        session_secret=os.environ.get("SESSION_SECRET", "dev-insecure-secret-change-me"),
        cost_per_place=float(os.environ.get("COST_PER_PLACE", "0.004")),
    )


settings = _load()
