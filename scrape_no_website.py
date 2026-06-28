#!/usr/bin/env python3
"""Find established Melbourne businesses that have a Google Business Profile but
no usable website -- prime website build/redesign prospects.

Flow:

  1. Sweep a grid of ``category x suburb`` Google Maps searches via the
     ``compass/crawler-google-places`` actor.
  2. Dedupe by place id.
  3. Classify each listing's web presence:
       Tier A (free, from Maps data) -- none / social_only / no_https / live_site
       Tier B (free, local HTTP fetch of live_site domains) -- broken / parked /
               not_mobile / healthy
  4. Keep every real, established listing whose site is NOT healthy. Drop the
     rest. Write a CSV sorted by review count (most-established first).

All record-level decisions live in the unit-tested ``web_presence`` module; this
file is the CSV/Apify/HTTP orchestration + CLI.

Usage:
    # Small test (~$0.50): cap the sweep, fetch live sites to judge them
    python scrape_no_website.py --max-searches 20 --per-search 5 --limit 60

    # Re-classify an earlier Maps run for free
    python scrape_no_website.py --maps-dataset-id <DATASET_ID>

    # Skip the local fetch (Tier A only: no-site + social-only + http-only leads)
    python scrape_no_website.py --no-fetch
"""

from __future__ import annotations

import argparse
import csv
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

from apify_client import ApifyClient

try:
    from dotenv import load_dotenv
except ImportError:  # python-dotenv is optional
    load_dotenv = None

import web_presence

MAPS_ACTOR = "compass/crawler-google-places"

_UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
       "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")


def get_token() -> str:
    """Read APIFY_TOKEN from env, falling back to a local .env; exit clearly if missing."""
    if load_dotenv:
        load_dotenv(Path(__file__).parent / ".env")
    token = os.environ.get("APIFY_TOKEN") or os.environ.get("APIFY_API_TOKEN")
    if not token:
        sys.exit(
            "ERROR: APIFY_TOKEN is not set.\n"
            "  Fix: add `export APIFY_TOKEN=your_token` to ~/.zshrc and restart your shell,\n"
            "       or copy .env.example to .env and put the token there."
        )
    return token


def _check_run(run, label):
    """Exit clearly if an Apify actor run did not succeed."""
    status = getattr(run, "status", None)
    status = getattr(status, "value", status)
    if status != "SUCCEEDED":
        sys.exit(f"ERROR: {label} run did not succeed (status={status}, runId={run.id}).")


def parse_args(argv=None):
    p = argparse.ArgumentParser(
        description="Find Melbourne businesses with a Google listing but no usable website."
    )
    p.add_argument("--categories-file", default="melbourne_categories.txt",
                   help="Categories to sweep (one per line)")
    p.add_argument("--suburbs-file", default="suburbs_melbourne.txt",
                   help="Suburbs to sweep (one per line)")
    p.add_argument("--per-search", type=int, default=5,
                   help="Max places per category x suburb search (cost dial)")
    p.add_argument("--max-searches", type=int, default=None,
                   help="Cap the number of category x suburb searches (cost dial)")
    p.add_argument("--min-reviews", type=int, default=5,
                   help="Min reviews for a listing to count as established")
    p.add_argument("--country", default="au", help="Two-letter country code")
    p.add_argument("--chunk-size", type=int, default=200,
                   help="Search strings per Maps actor run")
    p.add_argument("--limit", type=int, default=None,
                   help="Cap live-site fetches (Tier B) to the first N candidates")
    p.add_argument("--no-fetch", dest="fetch", action="store_false", default=True,
                   help="Skip Tier B fetch; drop live sites instead of judging them")
    p.add_argument("--maps-dataset-id", default=None,
                   help="Reuse an existing Maps dataset (skip the Apify run, no cost)")
    p.add_argument("--refresh", action="store_true",
                   help="Re-sweep category×suburb combos already swept before "
                        "(default: skip them to avoid paying Apify twice)")
    p.add_argument("--output", default="output/melbourne_no_website_leads.csv",
                   help="CSV output path")
    return p.parse_args(argv)


def build_search_pairs(categories, suburbs, max_searches, skip_pairs=None):
    """Grid of (category, suburb) pairs, suburb-major for category variety.

    Pairs in ``skip_pairs`` (already swept on a previous run) are dropped *before*
    the ``max_searches`` cap, so a capped run spends its whole budget on new ground.
    """
    skip = skip_pairs or set()
    pairs = [(category, suburb)
             for suburb in suburbs
             for category in categories
             if (category, suburb) not in skip]
    return pairs[:max_searches] if max_searches else pairs


def build_search_strings(categories, suburbs, max_searches, skip_pairs=None):
    """'<category> <suburb> VIC' strings for the (filtered) search grid."""
    return [f"{category} {suburb} VIC"
            for category, suburb in build_search_pairs(
                categories, suburbs, max_searches, skip_pairs)]


def run_maps_lookup(client, search_strings, per_search, country, chunk_size):
    """Look up every search string on Google Maps; return all place items."""
    places = []
    for start in range(0, len(search_strings), chunk_size):
        chunk = search_strings[start:start + chunk_size]
        run_input = {
            "searchStringsArray": chunk,
            "maxCrawledPlacesPerSearch": per_search,
            "language": "en",
            "countryCode": country,
        }
        print(f"[maps] Searching {len(chunk)} queries "
              f"({start + 1}-{start + len(chunk)} of {len(search_strings)}), "
              f"<= {per_search} places each...")
        run = client.actor(MAPS_ACTOR).call(run_input=run_input)
        _check_run(run, "Google Maps lookup")
        items = list(client.dataset(run.default_dataset_id).iterate_items())
        print(f"[maps]   -> {len(items)} listings (dataset {run.default_dataset_id})")
        places.extend(items)
    return places


def fetch_site(url, timeout=10):
    """Local HTTP GET. Returns (fetched_ok, status_code, html). Never raises."""
    req = urllib.request.Request(url, headers={"User-Agent": _UA})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read(200_000)
            charset = resp.headers.get_content_charset() or "utf-8"
            return True, resp.status, raw.decode(charset, "replace")
    except urllib.error.HTTPError as exc:
        try:
            body = exc.read(200_000).decode("utf-8", "replace")
        except Exception:  # noqa: BLE001
            body = ""
        return True, exc.code, body
    except Exception:  # noqa: BLE001 - DNS/timeout/SSL/etc. all mean "broken"
        return False, None, ""


def resolve_status(place, fetch_enabled, fetch_budget, fetch_fn=fetch_site):
    """Web status for a place. Returns (status, consumed_fetch).

    Any real URL -- whether Maps stored it as http or https -- is FETCHED and
    judged by how it actually loads (an http URL that redirects to a healthy
    https site is not a lead). Only ``none`` and ``social_only`` skip the fetch.

    ``status`` is None when the listing should be skipped entirely: a real site
    we can't judge because fetching is disabled or the fetch budget is spent.
    """
    status = web_presence.classify_website(place.get("website"))
    if status not in ("live_site", "no_https"):
        return status, False
    if not fetch_enabled or fetch_budget <= 0:
        return None, False
    url = place["website"].strip()
    print(f"[fetch] {url}")
    return web_presence.classify_live_site(*fetch_fn(url)), True


def write_csv(rows, output_path):
    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=web_presence.LEAD_COLUMNS, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)
    print(f"Wrote {len(rows)} leads -> {path}")


def collect_leads(client, *, categories, suburbs, per_search, max_searches,
                  min_reviews, country, chunk_size, limit, fetch,
                  maps_dataset_id=None, skip_pairs=None, on_searched=None,
                  on_progress=None, fetch_fn=fetch_site):
    """Core no-website pipeline, decoupled from CLI/CSV. Returns lead rows
    (web_presence.no_website_row shape) each with an added 'place_id'.

    ``skip_pairs`` are (category, suburb) combos already swept on a prior run;
    they are excluded from the grid so Apify is never paid to re-crawl them. After
    a successful sweep ``on_searched`` is called with the pairs actually crawled,
    so the caller can record them as covered."""
    def _emit(stage, message, places=0):
        if on_progress:
            on_progress({"stage": stage, "message": message,
                         "places_scraped": places})

    if maps_dataset_id:
        _emit("maps", f"Reusing dataset {maps_dataset_id}")
        raw_places = list(client.dataset(maps_dataset_id).iterate_items())
    else:
        pairs = build_search_pairs(categories, suburbs, max_searches, skip_pairs)
        if not pairs:
            _emit("done", "0 new searches — all category×suburb ground already swept")
            return []
        searches = [f"{category} {suburb} VIC" for category, suburb in pairs]
        _emit("maps", f"Sweeping {len(searches)} new searches")
        raw_places = run_maps_lookup(client, searches, per_search, country, chunk_size)
        if on_searched:
            on_searched(pairs)

    places = web_presence.dedupe_by_place_id(raw_places)
    places.sort(key=lambda p: p.get("reviewsCount") or 0, reverse=True)
    _emit("classify", f"{len(places)} unique listings", len(places))

    rows = []
    fetch_budget = limit if limit is not None else len(places)
    for place in places:
        if not web_presence.is_real_listing(place, min_reviews):
            continue
        status, consumed = resolve_status(place, fetch, fetch_budget, fetch_fn=fetch_fn)
        if consumed:
            fetch_budget -= 1
        if status is None or not web_presence.is_lead_status(status):
            continue
        row = web_presence.no_website_row(place, status)
        row["place_id"] = place.get("placeId")
        rows.append(row)
    rows.sort(key=lambda r: r["reviews_count"] or 0, reverse=True)
    _emit("done", f"{len(rows)} leads", len(places))
    return rows


def _row_to_lead(row):
    """Map a no_website_row to the unified lead shape persisted in the DB."""
    return {
        "business_name": row["business_name"], "category": row["category"],
        "suburb": row["suburb"], "address": row["address"], "phone": row["phone"],
        "email": "", "website": row["website"], "web_status": row["web_status"],
        "rating": row["rating"], "reviews_count": row["reviews_count"],
        "google_maps_url": row["google_maps_url"], "place_id": row.get("place_id"),
        "extra": {"lead_tag": row.get("lead_tag", ""),
                  "google_search_url": row.get("google_search_url", "")},
    }


def export_csv(conn, store, engine, output_path):
    """Write the full deduped master list for an engine to CSV (reviews-first)."""
    rows = []
    for l in store.all_leads(conn, engine):
        name = l.get("business_name") or ""
        rows.append({
            "business_name": name,
            "category": l.get("category") or "",
            "web_status": l.get("web_status") or "",
            "lead_tag": web_presence.lead_tag(l.get("web_status") or ""),
            "rating": l.get("rating"),
            "reviews_count": l.get("reviews_count"),
            "phone": l.get("phone") or "",
            "website": l.get("website") or "",
            "suburb": l.get("suburb") or "",
            "address": l.get("address") or "",
            "google_maps_url": l.get("google_maps_url") or "",
            "google_search_url": web_presence.google_search_url(name),
        })
    write_csv(rows, output_path)
    return len(rows)


def main(argv=None):
    args = parse_args(argv)
    client = ApifyClient(get_token())

    if args.maps_dataset_id:
        categories, suburbs = [], []
    else:
        categories = web_presence.parse_suburb_lines(
            Path(args.categories_file).read_text(encoding="utf-8"))
        suburbs = web_presence.parse_suburb_lines(
            Path(args.suburbs_file).read_text(encoding="utf-8"))
        if not categories or not suburbs:
            sys.exit("ERROR: need at least one category and one suburb.")

    # The DB is the shared seen-set: skip category×suburb ground already swept
    # (unless --refresh), persist new leads deduped, and record what we covered.
    from app import db as appdb, store
    conn = appdb.connect()
    appdb.init_db(conn)
    engine = "no_website"
    skip = set() if (args.refresh or args.maps_dataset_id) \
        else store.seen_pairs(conn, engine)
    swept = []

    rows = collect_leads(
        client, categories=categories, suburbs=suburbs, per_search=args.per_search,
        max_searches=args.max_searches, min_reviews=args.min_reviews,
        country=args.country, chunk_size=args.chunk_size, limit=args.limit,
        fetch=args.fetch, maps_dataset_id=args.maps_dataset_id,
        skip_pairs=skip, on_searched=swept.extend)

    rid = store.create_run(conn, engine, {"source": "cli"}, "done", 0.0)
    store.insert_leads(conn, rid, engine, [_row_to_lead(r) for r in rows])
    store.record_searches(conn, engine, swept)
    store.update_run(conn, rid, leads_found=len(rows))
    total = export_csv(conn, store, engine, args.output)
    conn.close()

    counts = {}
    for r in rows:
        counts[r["web_status"]] = counts.get(r["web_status"], 0) + 1
    breakdown = ", ".join(f"{k}: {v}" for k, v in sorted(counts.items())) or "none"
    skipped = "" if (args.refresh or args.maps_dataset_id) \
        else f", skipped {len(skip)} already-swept"
    print(f"This run: {len(rows)} leads from {len(swept)} new searches"
          f"{skipped} (by status -> {breakdown}).")
    print(f"Master list now holds {total} unique leads -> {args.output}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
