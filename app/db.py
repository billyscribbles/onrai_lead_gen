"""SQLite connection + schema for the dashboard."""
from __future__ import annotations

import sqlite3
from pathlib import Path

from app import normalize
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
    progress TEXT,
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
    dedup_key TEXT,
    extra TEXT NOT NULL DEFAULT '{}',
    user_status TEXT NOT NULL DEFAULT 'normal',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_leads_engine ON leads(engine);
CREATE INDEX IF NOT EXISTS idx_leads_place ON leads(place_id);
-- Record of every category x suburb already swept per engine, so a later run can
-- skip ground it has covered and not pay Apify to re-crawl the same listings.
CREATE TABLE IF NOT EXISTS searches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    engine TEXT NOT NULL,
    category TEXT NOT NULL,
    suburb TEXT NOT NULL,
    last_swept_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(engine, category, suburb)
);
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
    _migrate(conn)
    conn.commit()


def _migrate(conn: sqlite3.Connection) -> None:
    """Idempotent schema upgrades for DBs created before a schema change."""
    run_cols = {r["name"] for r in conn.execute("PRAGMA table_info(runs)")}
    if "progress" not in run_cols:
        conn.execute("ALTER TABLE runs ADD COLUMN progress TEXT")

    lead_cols = {r["name"] for r in conn.execute("PRAGMA table_info(leads)")}
    if "dedup_key" not in lead_cols:
        conn.execute("ALTER TABLE leads ADD COLUMN dedup_key TEXT")
    if "user_status" not in lead_cols:
        conn.execute(
            "ALTER TABLE leads ADD COLUMN user_status TEXT NOT NULL "
            "DEFAULT 'normal'")
    # Backfill any rows still missing a key, collapse pre-existing duplicates,
    # then enforce one row per (engine, dedup_key) going forward. Order matters:
    # the unique index can only be created once duplicates are gone.
    _backfill_dedup_keys(conn)
    _collapse_lead_dupes(conn)
    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_dedup "
        "ON leads(engine, dedup_key)")


def _backfill_dedup_keys(conn: sqlite3.Connection) -> None:
    rows = conn.execute(
        "SELECT id, business_name, suburb, place_id FROM leads "
        "WHERE dedup_key IS NULL OR dedup_key = ''").fetchall()
    for r in rows:
        conn.execute(
            "UPDATE leads SET dedup_key = ? WHERE id = ?",
            (normalize.dedup_key(r["business_name"], r["suburb"], r["place_id"]),
             r["id"]))


def _collapse_lead_dupes(conn: sqlite3.Connection) -> None:
    """Keep the earliest row per (engine, dedup_key); delete the rest."""
    conn.execute(
        "DELETE FROM leads WHERE id NOT IN "
        "(SELECT MIN(id) FROM leads GROUP BY engine, dedup_key)")
