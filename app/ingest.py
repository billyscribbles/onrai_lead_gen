"""One-time import of existing CSV output into SQLite."""
from __future__ import annotations

import csv
from pathlib import Path

from app import store
from app.normalize import lead_template, parse_place_id

_NO_WEBSITE_CSV = "melbourne_no_website_leads.csv"


def _to_num(v, cast):
    try:
        return cast(v)
    except (TypeError, ValueError):
        return None


def ingest_existing(conn, output_dir: str = "output") -> int:
    if conn.execute("SELECT COUNT(*) c FROM leads").fetchone()["c"] > 0:
        return 0
    path = Path(output_dir) / _NO_WEBSITE_CSV
    if not path.exists():
        return 0
    leads = []
    with path.open(encoding="utf-8") as f:
        for row in csv.DictReader(f):
            url = row.get("google_maps_url", "")
            leads.append(lead_template(
                engine="no_website",
                business_name=row.get("business_name", ""),
                category=row.get("category", ""),
                suburb=row.get("suburb", ""),
                address=row.get("address", ""),
                phone=row.get("phone", ""),
                website=row.get("website", ""),
                web_status=row.get("web_status", ""),
                rating=_to_num(row.get("rating"), float),
                reviews_count=_to_num(row.get("reviews_count"), int),
                google_maps_url=url,
                place_id=parse_place_id(url),
                extra={"lead_tag": row.get("lead_tag", ""),
                       "google_search_url": row.get("google_search_url", "")},
            ))
    if not leads:
        return 0
    rid = store.create_run(conn, "no_website",
                           {"source": _NO_WEBSITE_CSV}, "imported", 0.0)
    store.insert_leads(conn, rid, "no_website", leads)
    store.update_run(conn, rid, leads_found=len(leads))
    return len(leads)
