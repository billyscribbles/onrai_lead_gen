"""SQLite connection + schema for the dashboard."""
from __future__ import annotations

import sqlite3
from pathlib import Path

from app.config import settings

_SCHEMA = """
CREATE TABLE IF NOT EXISTS runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    engine TEXT NOT NULL,
    params TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL,
    cost_estimate REAL,
    cost_actual REAL,
    apify_run_id TEXT,
    places_scraped INTEGER NOT NULL DEFAULT 0,
    leads_found INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    started_at TEXT,
    finished_at TEXT
);
CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id INTEGER REFERENCES runs(id),
    engine TEXT NOT NULL,
    business_name TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT '',
    suburb TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    website TEXT NOT NULL DEFAULT '',
    web_status TEXT NOT NULL DEFAULT '',
    rating REAL,
    reviews_count INTEGER,
    google_maps_url TEXT NOT NULL DEFAULT '',
    place_id TEXT,
    extra TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_leads_engine ON leads(engine);
CREATE INDEX IF NOT EXISTS idx_leads_place ON leads(place_id);
"""


def connect(db_path: str | None = None) -> sqlite3.Connection:
    path = db_path or settings.db_path
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db(conn: sqlite3.Connection) -> None:
    conn.executescript(_SCHEMA)
    conn.commit()
