"""Engine wrapper around scrape_no_website.collect_leads."""
from __future__ import annotations

import math
from pathlib import Path

import scrape_no_website as sw
import web_presence
from app import store
from app.config import settings
from app.engines.registry import get_engine
from app.normalize import lead_template

PARAMS = {
    "category": "str (required) — the Google Maps category to sweep",
    "suburbs": "list[str] | None — defaults to suburbs_melbourne.txt",
    "per_search": "int — places per category x suburb search",
    "min_reviews": "int — min reviews to count as established",
    "target": "int — desired qualified leads (drives search breadth)",
    "no_website": "bool — keep only leads with no usable site (none/social_only)",
    "social_only": "bool — keep only leads whose only presence is a social link",
    "phone_required": "bool — keep only leads with a phone number",
    "fetch": "bool — fetch live sites to judge broken/not-mobile (default off)",
    "maps_dataset_id": "str | None — reuse an existing Maps dataset (free)",
    "refresh": "bool — re-sweep category×suburb combos already swept before",
}

_SUBURBS_FILE = Path(__file__).resolve().parent.parent.parent / "suburbs_melbourne.txt"


def _default_suburbs() -> list[str]:
    return web_presence.parse_suburb_lines(_SUBURBS_FILE.read_text("utf-8"))


def _searches_for_target(target: int, per_search: int, yield_: float, n_suburbs: int) -> int:
    """How many category x suburb searches to attempt for `target` leads."""
    places_needed = math.ceil(max(target, 1) / max(yield_, 0.01))
    return min(max(math.ceil(places_needed / max(per_search, 1)), 1), n_suburbs)


def _keep(row: dict, no_website_only: bool, social_only: bool,
          phone_required: bool) -> bool:
    """Apply the user's good-lead gates to a classified lead row."""
    status = row.get("web_status")
    if social_only and status != "social_only":
        return False
    if no_website_only and status not in ("none", "social_only"):
        return False
    if phone_required and not (row.get("phone") or "").strip():
        return False
    return True


def run(params: dict, on_progress=None, client=None, conn=None,
        should_abort=None, on_run_start=None) -> list[dict]:
    meta = get_engine("no_website")
    if client is None:
        from apify_client import ApifyClient
        client = ApifyClient(sw.get_token())

    category = params["category"]
    suburbs = params.get("suburbs") or _default_suburbs()
    per_search = int(params.get("per_search", meta.default_per_search))
    min_reviews = int(params.get("min_reviews", meta.default_min_reviews))
    target = int(params.get("target", 25))
    # Default fetch OFF: the reliable buckets (none/social_only) need no site
    # fetch, and the fetched redesign buckets are flaky (see CLAUDE.md).
    fetch = bool(params.get("fetch", False))
    no_website_only = bool(params.get("no_website", True))
    social_only = bool(params.get("social_only", False))
    phone_required = bool(params.get("phone_required", False))
    maps_dataset_id = params.get("maps_dataset_id")
    refresh = bool(params.get("refresh", False))

    max_searches = _searches_for_target(target, per_search, meta.expected_yield, len(suburbs))

    # The DB is the shared seen-set: skip suburbs already swept for this category
    # (unless refreshing), so Apify isn't paid to re-crawl covered ground.
    skip = set() if (refresh or maps_dataset_id or conn is None) \
        else store.seen_pairs(conn, "no_website")
    swept = []

    # Surface the seen-set saving money, so the user sees dedup working up front.
    if on_progress and skip:
        skipped_here = sum(1 for (cat, _sub) in skip if cat == category)
        if skipped_here:
            on_progress({"stage": "maps", "places_scraped": 0, "leads_found": 0,
                         "message": f"Skipped {skipped_here} suburbs already swept "
                                    f"for {category} (no Apify cost)"})

    rows = sw.collect_leads(
        client, categories=[category], suburbs=suburbs, per_search=per_search,
        max_searches=max_searches, min_reviews=min_reviews, country="au",
        chunk_size=200, limit=None, fetch=fetch, maps_dataset_id=maps_dataset_id,
        skip_pairs=skip, on_searched=swept.extend, on_progress=on_progress,
        should_abort=should_abort, on_run_start=on_run_start,
        plateau_secs=settings.maps_plateau_secs,
        max_run_secs=settings.maps_max_run_secs)

    if conn is not None and swept:
        store.record_searches(conn, "no_website", swept)

    rows = [r for r in rows
            if _keep(r, no_website_only, social_only, phone_required)]

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
