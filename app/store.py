"""Persistence: runs and leads."""
from __future__ import annotations

import json
import sqlite3

import web_presence
from app import normalize
from app.industry import industry_options

_RUN_UPDATABLE = {
    "status", "cost_estimate", "cost_actual", "apify_run_id",
    "places_scraped", "leads_found", "progress", "error",
    "started_at", "finished_at",
}
_SORTABLE = {"tier", "hot", "newest", "reviews_count", "rating",
             "business_name", "created_at"}


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


def insert_leads(conn, run_id: int, engine: str, leads: list[dict]) -> dict:
    """Upsert leads keyed by (engine, dedup_key).

    A business already in the table (same place_id, or same name+suburb when it
    has no place_id) is refreshed in place rather than duplicated — so re-running
    overlapping searches never grows the table with copies. Tier/heat (ICP
    ranking) are computed here so every insert path — engine runs, the CLI, and
    CSV ingest — stays consistently ranked.

    Returns ``{"total", "new", "refreshed"}``: how many leads were saved, how many
    were brand new, and how many refreshed an existing row (de-duplicated)."""
    rows = []
    keys = []
    for l in leads:
        key = normalize.dedup_key(l.get("business_name", ""), l.get("suburb", ""),
                                  l.get("place_id"))
        has_phone = bool((l.get("phone") or "").strip())
        tier = web_presence.lead_tier(l.get("web_status") or "", has_phone)
        heat = web_presence.lead_heat(tier, l.get("reviews_count"), has_phone)
        keys.append(key)
        rows.append((
            run_id, engine, l.get("business_name", ""), l.get("category", ""),
            l.get("suburb", ""), l.get("address", ""), l.get("phone", ""),
            l.get("email", ""), l.get("website", ""), l.get("web_status", ""),
            l.get("rating"), l.get("reviews_count"), l.get("google_maps_url", ""),
            l.get("place_id"), key, tier, heat,
            json.dumps(l.get("extra") or {}),
        ))
    # Count how many of these keys already exist, so the caller can report
    # "N new, M refreshed duplicates" — proof the dedup is doing its job.
    existing = _existing_keys(conn, engine, keys)
    refreshed = sum(1 for k in set(keys) if k in existing)
    new = len(set(keys)) - refreshed
    conn.executemany(
        """INSERT INTO leads (run_id, engine, business_name, category, suburb,
           address, phone, email, website, web_status, rating, reviews_count,
           google_maps_url, place_id, dedup_key, tier, heat, extra)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(engine, dedup_key) DO UPDATE SET
             run_id=excluded.run_id, business_name=excluded.business_name,
             category=excluded.category, suburb=excluded.suburb,
             address=excluded.address, phone=excluded.phone,
             email=excluded.email, website=excluded.website,
             web_status=excluded.web_status, rating=excluded.rating,
             reviews_count=excluded.reviews_count,
             google_maps_url=excluded.google_maps_url,
             place_id=excluded.place_id, tier=excluded.tier, heat=excluded.heat,
             extra=excluded.extra""", rows)
    conn.commit()
    return {"total": len(rows), "new": new, "refreshed": refreshed}


def _existing_keys(conn, engine: str, keys: list[str]) -> set:
    """Subset of ``keys`` already present in the leads table for this engine."""
    found = set()
    for i in range(0, len(keys), 400):  # chunk to stay under SQLite var limits
        chunk = keys[i:i + 400]
        placeholders = ",".join("?" * len(chunk))
        rows = conn.execute(
            f"SELECT dedup_key FROM leads WHERE engine=? "
            f"AND dedup_key IN ({placeholders})", (engine, *chunk)).fetchall()
        found.update(r["dedup_key"] for r in rows)
    return found


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
    """Every lead for an engine, ICP-ranked best-first (for CSV export)."""
    rows = conn.execute(
        "SELECT * FROM leads WHERE engine=? "
        "ORDER BY tier IS NULL, tier ASC, reviews_count IS NULL, "
        "reviews_count DESC", (engine,)).fetchall()
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


def query_leads(conn, *, engine=None, status=None, category=None,
                web_status=None, industry=None, suburb=None, q=None,
                bucket=None, phone_only=False, run_id=None, sort="tier",
                page=1, page_size=50) -> dict:
    where, args = [], []
    if engine:
        where.append("engine=?"); args.append(engine)
    if run_id is not None:
        where.append("run_id=?"); args.append(run_id)

    # status: "top" is the tier-1 bucket (social_only + phone); "all"/None is a
    # no-op; any other value is a web_status. An explicit web_status= arg is the
    # back-compat fallback when status isn't given.
    if status == "top":
        where.append("tier=1")
    elif status and status != "all":
        where.append("web_status=?"); args.append(status)
    elif web_status:
        where.append("web_status=?"); args.append(web_status)

    if category:
        where.append("category=?"); args.append(category)
    if industry:
        where.append("industry_group(category)=?"); args.append(industry)
    if suburb:
        where.append("suburb=?"); args.append(suburb)
    if phone_only:
        where.append("TRIM(COALESCE(phone,''))!=''")
    if bucket == "active":
        where.append("user_status!='archived'")
    elif bucket in ("favourites", "archived"):
        where.append("user_status=?")
        args.append("favourite" if bucket == "favourites" else "archived")
    if q:
        where.append("(business_name LIKE ? OR category LIKE ? OR suburb LIKE ?)")
        args += [f"%{q}%", f"%{q}%", f"%{q}%"]

    clause = ("WHERE " + " AND ".join(where)) if where else ""

    sort_col = sort if sort in _SORTABLE else "tier"
    # ICP order: best tier first, most-established within a tier.
    tier_order = ("tier IS NULL, tier ASC, reviews_count IS NULL, "
                  "reviews_count DESC")
    if sort_col == "business_name":
        order = "ORDER BY business_name ASC"
    elif sort_col in ("tier", "hot"):
        order = f"ORDER BY {tier_order}"
    elif sort_col == "newest":
        order = f"ORDER BY created_at DESC, {tier_order}"
    else:
        order = f"ORDER BY {sort_col} IS NULL, {sort_col} DESC"
    total = conn.execute(f"SELECT COUNT(*) c FROM leads {clause}", args).fetchone()["c"]
    page = max(1, int(page)); page_size = max(1, min(int(page_size), 500))
    rows = conn.execute(
        f"SELECT * FROM leads {clause} {order} LIMIT ? OFFSET ?",
        (*args, page_size, (page - 1) * page_size)).fetchall()
    return {"items": [_lead_to_dict(r) for r in rows], "total": total,
            "page": page, "page_size": page_size}


def lead_facets(conn, engine=None) -> dict:
    """Global pool stats for the dashboard chrome (counts + dropdown options).

    Intentionally ignores the active refine filters: the StatStrip and filter
    counts describe the whole pool, not the current page's filter selection.
    """
    where = "WHERE engine=?" if engine else ""
    args = (engine,) if engine else ()

    def count(expr):
        joiner = "AND" if where else "WHERE"
        return conn.execute(
            f"SELECT COUNT(*) c FROM leads {where} {joiner} {expr}",
            args).fetchone()["c"]

    total = conn.execute(
        f"SELECT COUNT(*) c FROM leads {where}", args).fetchone()["c"]
    top = count("tier=1")
    social_only = count("web_status='social_only'")
    none = count("web_status='none'")
    # Reachable mirrors socialOf() in leads.ts: a phone, or a website that's a URL
    # or a known social handle (handles are often stored without an http prefix).
    reachable = count(
        "TRIM(COALESCE(phone,''))!='' OR COALESCE(website,'') LIKE 'http%' "
        "OR COALESCE(website,'') LIKE '%instagram%' "
        "OR COALESCE(website,'') LIKE '%facebook%' "
        "OR COALESCE(website,'') LIKE '%tiktok%' "
        "OR COALESCE(website,'') LIKE '%linktr%'")
    cats = [r["category"] for r in conn.execute(
        f"SELECT DISTINCT category FROM leads {where}", args)]
    subs = sorted({r["suburb"] for r in conn.execute(
        f"SELECT DISTINCT suburb FROM leads {where}", args) if r["suburb"]})
    return {"total": total, "top": top, "social_only": social_only,
            "none": none, "reachable": reachable,
            "industries": industry_options(cats), "suburbs": subs}


def lead_stats(conn) -> dict:
    total = conn.execute("SELECT COUNT(*) c FROM leads").fetchone()["c"]
    by_engine = {r["engine"]: r["c"] for r in conn.execute(
        "SELECT engine, COUNT(*) c FROM leads GROUP BY engine")}
    by_status = {r["web_status"]: r["c"] for r in conn.execute(
        "SELECT web_status, COUNT(*) c FROM leads GROUP BY web_status")}
    return {"total": total, "by_engine": by_engine, "by_web_status": by_status}
