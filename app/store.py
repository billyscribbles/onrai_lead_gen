"""Persistence: runs and leads."""
from __future__ import annotations

import json
import sqlite3

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
    rows = [(
        run_id, engine, l.get("business_name", ""), l.get("category", ""),
        l.get("suburb", ""), l.get("address", ""), l.get("phone", ""),
        l.get("email", ""), l.get("website", ""), l.get("web_status", ""),
        l.get("rating"), l.get("reviews_count"), l.get("google_maps_url", ""),
        l.get("place_id"), json.dumps(l.get("extra") or {}),
    ) for l in leads]
    conn.executemany(
        """INSERT INTO leads (run_id, engine, business_name, category, suburb,
           address, phone, email, website, web_status, rating, reviews_count,
           google_maps_url, place_id, extra)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""", rows)
    conn.commit()
    return len(rows)


def _lead_to_dict(row: sqlite3.Row) -> dict:
    d = dict(row)
    d["extra"] = json.loads(d.get("extra") or "{}")
    return d


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
    page = max(1, int(page)); page_size = max(1, min(int(page_size), 200))
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
