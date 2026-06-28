"""Normalize engine output into the unified lead shape."""
from __future__ import annotations

from urllib.parse import parse_qs, urlparse

_LEAD_KEYS = (
    "engine", "business_name", "category", "suburb", "address", "phone",
    "email", "website", "web_status", "rating", "reviews_count",
    "google_maps_url", "place_id", "extra",
)


def parse_place_id(google_maps_url: str) -> str | None:
    if not google_maps_url:
        return None
    qs = parse_qs(urlparse(google_maps_url).query)
    vals = qs.get("query_place_id")
    return vals[0] if vals else None


def lead_template(**overrides) -> dict:
    base = {
        "engine": "", "business_name": "", "category": "", "suburb": "",
        "address": "", "phone": "", "email": "", "website": "",
        "web_status": "", "rating": None, "reviews_count": None,
        "google_maps_url": "", "place_id": None, "extra": {},
    }
    base.update({k: v for k, v in overrides.items() if k in _LEAD_KEYS})
    if base["extra"] is None:
        base["extra"] = {}
    return base


def dedupe_leads(leads: list[dict]) -> list[dict]:
    seen: set[str] = set()
    out: list[dict] = []
    for lead in leads:
        pid = lead.get("place_id")
        if pid:
            if pid in seen:
                continue
            seen.add(pid)
        out.append(lead)
    return out
