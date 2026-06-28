"""Engine wrapper around scrape_no_website.collect_leads."""
from __future__ import annotations

import math
from pathlib import Path

import scrape_no_website as sw
import web_presence
from app.engines.registry import get_engine
from app.normalize import lead_template

PARAMS = {
    "category": "str (required) — the Google Maps category to sweep",
    "suburbs": "list[str] | None — defaults to suburbs_melbourne.txt",
    "per_search": "int — places per category x suburb search",
    "min_reviews": "int — min reviews to count as established",
    "target": "int — desired qualified leads (drives search breadth)",
    "fetch": "bool — fetch live sites to judge broken/not-mobile",
    "maps_dataset_id": "str | None — reuse an existing Maps dataset (free)",
}

_SUBURBS_FILE = Path(__file__).resolve().parent.parent.parent / "suburbs_melbourne.txt"


def _default_suburbs() -> list[str]:
    return web_presence.parse_suburb_lines(_SUBURBS_FILE.read_text("utf-8"))


def _searches_for_target(target: int, per_search: int, yield_: float, n_suburbs: int) -> int:
    """How many category x suburb searches to attempt for `target` leads."""
    places_needed = math.ceil(max(target, 1) / max(yield_, 0.01))
    return min(max(math.ceil(places_needed / max(per_search, 1)), 1), n_suburbs)


def run(params: dict, on_progress=None, client=None) -> list[dict]:
    meta = get_engine("no_website")
    if client is None:
        from apify_client import ApifyClient
        client = ApifyClient(sw.get_token())

    category = params["category"]
    suburbs = params.get("suburbs") or _default_suburbs()
    per_search = int(params.get("per_search", meta.default_per_search))
    min_reviews = int(params.get("min_reviews", meta.default_min_reviews))
    target = int(params.get("target", 25))
    fetch = bool(params.get("fetch", True))
    maps_dataset_id = params.get("maps_dataset_id")

    max_searches = _searches_for_target(target, per_search, meta.expected_yield, len(suburbs))

    rows = sw.collect_leads(
        client, categories=[category], suburbs=suburbs, per_search=per_search,
        max_searches=max_searches, min_reviews=min_reviews, country="au",
        chunk_size=200, limit=None, fetch=fetch, maps_dataset_id=maps_dataset_id,
        on_progress=on_progress)

    leads = []
    for r in rows:
        leads.append(lead_template(
            engine="no_website",
            business_name=r["business_name"], category=r["category"],
            suburb=r["suburb"], address=r["address"], phone=r["phone"],
            website=r["website"], web_status=r["web_status"],
            rating=r["rating"], reviews_count=r["reviews_count"],
            google_maps_url=r["google_maps_url"], place_id=r.get("place_id"),
            extra={"lead_tag": r.get("lead_tag", ""),
                   "google_search_url": r.get("google_search_url", "")},
        ))
    return leads
