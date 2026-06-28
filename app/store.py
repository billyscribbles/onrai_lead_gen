"""Persistence: runs and leads."""
from __future__ import annotations

import json
import sqlite3

from app import normalize

_RUN_UPDATABLE = {
    "status", "cost_estimate", "cost_actual", "apify_run_id",
    "places_scraped", "leads_found", "progress", "error",
    "started_at", "finished_at",
}
_SORTABLE = {"reviews_count", "rating", "business_name", "created_at"}


def create_run(conn, engine, params: dict, status: str, cost_estimate: float) -> int:
    cur = conn.execute(
        "INSERT INTO runs (engine, params, status, cost_estimate) VALUES (?,?,?,?)",
        (engine, json.dumps(params), status, cost_estimate))
    conn.commit()
    return cur.lastrowid


def update_run(conn, run_id: int, **fields) -> None:
    cols = {k: v for k, v in fields.items() if k in _RUN_UPDATABLE}
    if not cols:
        return
    sets = ", ".join(f"{k}=?" for k in cols)
    conn.execute(f"UPDATE runs SET {sets} WHERE id=?", (*cols.values(), run_id))
    conn.commit()


def _run_to_dict(row: sqlite3.Row) -> dict:
    d = dict(row)
    d["params"] = json.loads(d.get("params") or "{}")
    return d


def get_run(conn, run_id: int) -> dict | None:
    row = conn.execute("SELECT * FROM runs WHERE id=?", (run_id,)).fetchone()
    return _run_to_dict(row) if row else None


def list_runs(conn, limit: int = 50) -> list[dict]:
    rows = conn.execute(
        "SELECT * FROM runs ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
    return [_run_to_dict(r) for r in rows]


def insert_leads(conn, run_id: int, engine: str, leads: list[dict]) -> int:
    """Upsert leads keyed by (engine, dedup_key).

    A business already in the table (same place_id, or same name+suburb when it
    has no place_id) is refreshed in place rather than duplicated — so re-running
    overlapping searches never grows the table with copies.
    """
    rows = [(
        run_id, engine, l.get("business_name", ""), l.get("category", ""),
        l.get("suburb", ""), l.get("address", ""), l.get("phone", ""),
        l.get("email", ""), l.get("website", ""), l.get("web_status", ""),
        l.get("rating"), l.get("reviews_count"), l.get("google_maps_url", ""),
        l.get("place_id"),
        normalize.dedup_key(l.get("business_name", ""), l.get("suburb", ""),
                            l.get("place_id")),
        json.dumps(l.get("extra") or {}),
    ) for l in leads]
    conn.executemany(
        """INSERT INTO leads (run_id, engine, business_name, category, suburb,
           address, phone, email, website, web_status, rating, reviews_count,
           google_maps_url, place_id, dedup_key, extra)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(engine, dedup_key) DO UPDATE SET
             run_id=excluded.run_id, business_name=excluded.business_name,
             category=excluded.category, suburb=excluded.suburb,
             address=excluded.address, phone=excluded.phone,
             email=excluded.email, website=excluded.website,
             web_status=excluded.web_status, rating=excluded.rating,
             reviews_count=excluded.reviews_count,
             google_maps_url=excluded.google_maps_url,
             place_id=excluded.place_id, extra=excluded.extra""", rows)
    conn.commit()
    return len(rows)


def record_searches(conn, engine: str, pairs) -> int:
    """Mark every (category, suburb) pair as swept for this engine."""
    pairs = list(pairs)
    conn.executemany(
        """INSERT INTO searches (engine, category, suburb, last_swept_at)
           VALUES (?,?,?,datetime('now'))
           ON CONFLICT(engine, category, suburb)
           DO UPDATE SET last_swept_at=datetime('now')""",
        [(engine, cat, sub) for cat, sub in pairs])
    conn.commit()
    return len(pairs)


def seen_pairs(conn, engine: str) -> set:
    """Every (category, suburb) already swept for this engine."""
    rows = conn.execute(
        "SELECT category, suburb FROM searches WHERE engine=?", (engine,)).fetchall()
    return {(r["category"], r["suburb"]) for r in rows}


def all_leads(conn, engine: str) -> list[dict]:
    """Every lead for an engine, most-established first (for CSV export)."""
    rows = conn.execute(
        "SELECT * FROM leads WHERE engine=? "
        "ORDER BY reviews_count IS NULL, reviews_count DESC", (engine,)).fetchall()
    return [_lead_to_dict(r) for r in rows]


def _lead_to_dict(row: sqlite3.Row) -> dict:
    d = dict(row)
    d["extra"] = json.loads(d.get("extra") or "{}")
    return d


_USER_STATUSES = {"normal", "favourite", "archived"}


def set_lead_status(conn, lead_id: int, status: str) -> dict | None:
    """Set a lead's user_status (normal/favourite/archived).

    Returns the updated lead dict, or None if no lead has that id.
    Raises ValueError for an unknown status.
    """
    if status not in _USER_STATUSES:
        raise ValueError(f"invalid user_status: {status!r}")
    cur = conn.execute(
        "UPDATE leads SET user_status=? WHERE id=?", (status, lead_id))
    conn.commit()
    if cur.rowcount == 0:
        return None
    row = conn.execute("SELECT * FROM leads WHERE id=?", (lead_id,)).fetchone()
    return _lead_to_dict(row) if row else None


def query_leads(conn, *, engine=None, category=None, web_status=None,
                suburb=None, q=None, sort="reviews_count",
                page=1, page_size=50) -> dict:
    where, args = [], []
    for col, val in (("engine", engine), ("category", category),
                     ("web_status", web_status), ("suburb", suburb)):
        if val:
            where.append(f"{col}=?"); args.append(val)
    if q:
        where.append("business_name LIKE ?"); args.append(f"%{q}%")
    clause = ("WHERE " + " AND ".join(where)) if where else ""
    sort_col = sort if sort in _SORTABLE else "reviews_count"
    order = f"ORDER BY {sort_col} IS NULL, {sort_col} DESC" \
        if sort_col != "business_name" else "ORDER BY business_name ASC"
    total = conn.execute(f"SELECT COUNT(*) c FROM leads {clause}", args).fetchone()["c"]
    page = max(1, int(page)); page_size = max(1, min(int(page_size), 500))
    rows = conn.execute(
        f"SELECT * FROM leads {clause} {order} LIMIT ? OFFSET ?",
        (*args, page_size, (page - 1) * page_size)).fetchall()
    return {"items": [_lead_to_dict(r) for r in rows], "total": total,
            "page": page, "page_size": page_size}


def lead_stats(conn) -> dict:
    total = conn.execute("SELECT COUNT(*) c FROM leads").fetchone()["c"]
    by_engine = {r["engine"]: r["c"] for r in conn.execute(
        "SELECT engine, COUNT(*) c FROM leads GROUP BY engine")}
    by_status = {r["web_status"]: r["c"] for r in conn.execute(
        "SELECT web_status, COUNT(*) c FROM leads GROUP BY web_status")}
    return {"total": total, "by_engine": by_engine, "by_web_status": by_status}
