"""SQLite connection + schema for the dashboard."""
from __future__ import annotations

import sqlite3
from pathlib import Path

from app import normalize
from app.config import settings
from app.industry import industry_group

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
    tier INTEGER,
    heat INTEGER,
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
    # Lets SQL filter/group leads by industry bucket (see app/industry.py).
    conn.create_function("industry_group", 1, industry_group, deterministic=True)
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
    if "tier" not in lead_cols:
        conn.execute("ALTER TABLE leads ADD COLUMN tier INTEGER")
    if "heat" not in lead_cols:
        conn.execute("ALTER TABLE leads ADD COLUMN heat INTEGER")
    # Backfill any rows still missing a key, collapse pre-existing duplicates,
    # then enforce one row per (engine, dedup_key) going forward. Order matters:
    # the unique index can only be created once duplicates are gone.
    _backfill_dedup_keys(conn)
    _collapse_lead_dupes(conn)
    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_dedup "
        "ON leads(engine, dedup_key)")
    _backfill_tier_heat(conn)
    _reconcile_interrupted_runs(conn)


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


def _backfill_tier_heat(conn: sqlite3.Connection) -> None:
    """Compute tier/heat for any lead saved before the ranking columns existed."""
    import web_presence
    rows = conn.execute(
        "SELECT id, web_status, phone, reviews_count FROM leads "
        "WHERE tier IS NULL").fetchall()
    for r in rows:
        has_phone = bool((r["phone"] or "").strip())
        tier = web_presence.lead_tier(r["web_status"] or "", has_phone)
        heat = web_presence.lead_heat(tier, r["reviews_count"], has_phone)
        conn.execute("UPDATE leads SET tier=?, heat=? WHERE id=?",
                     (tier, heat, r["id"]))


def _reconcile_interrupted_runs(conn: sqlite3.Connection) -> None:
    """Mark runs left mid-flight by a process restart as failed.

    A run executes in a daemon thread that dies with the process (redeploy /
    crash), leaving its row stuck at running/classifying so the dashboard polls
    a status that will never resolve. On boot, no worker thread exists yet, so
    any such row is provably orphaned."""
    conn.execute(
        "UPDATE runs SET status='failed', "
        "error=COALESCE(error,'interrupted by restart'), "
        "finished_at=datetime('now') "
        "WHERE status IN ('running','classifying')")
