"""Cross-run de-duplication and the swept-searches seen-set.

These exercise the SQLite persistence layer against a throwaway DB so they run
offline with no Apify calls.
"""

import sqlite3

import pytest

from app import db, store
from app.normalize import dedup_key


def _db(tmp_path):
    conn = db.connect(str(tmp_path / "leads.db"))
    db.init_db(conn)
    return conn


def _lead(**over):
    base = {
        "business_name": "Mr Baxter Cafe", "category": "Cafe",
        "suburb": "West Footscray", "address": "", "phone": "", "email": "",
        "website": "", "web_status": "none", "rating": 4.6, "reviews_count": 69,
        "google_maps_url": "", "place_id": "PID-1", "extra": {},
    }
    base.update(over)
    return base


# --- dedup_key --------------------------------------------------------------

def test_dedup_key_prefers_place_id():
    assert dedup_key("Some Cafe", "Footscray", "ChIJ123") == "ChIJ123"


def test_dedup_key_falls_back_to_name_and_suburb():
    assert dedup_key("Mr  Baxter  Cafe", " West Footscray ", "") == \
        "mr baxter cafe|west footscray"


def test_dedup_key_same_business_two_searches_collapses():
    # Same listing, no place_id, surfaced by two different category searches.
    assert dedup_key("Lavish Barbers", "Melbourne", None) == \
        dedup_key("lavish barbers", "Melbourne", None)


# --- upsert: no duplicate rows across runs ----------------------------------

def test_insert_leads_upserts_on_same_place_id(tmp_path):
    conn = _db(tmp_path)
    r1 = store.create_run(conn, "no_website", {}, "done", 0.0)
    store.insert_leads(conn, r1, "no_website", [_lead(reviews_count=69)])
    r2 = store.create_run(conn, "no_website", {}, "done", 0.0)
    store.insert_leads(conn, r2, "no_website", [_lead(reviews_count=80)])

    leads = store.all_leads(conn, "no_website")
    assert len(leads) == 1
    assert leads[0]["reviews_count"] == 80  # refreshed in place


def test_insert_leads_dedupes_by_name_suburb_when_no_place_id(tmp_path):
    conn = _db(tmp_path)
    r = store.create_run(conn, "no_website", {}, "done", 0.0)
    store.insert_leads(conn, r, "no_website", [
        _lead(place_id=None, business_name="Lavish Barbers", suburb="CBD"),
        _lead(place_id="", business_name="Lavish  Barbers", suburb="cbd"),
    ])
    assert len(store.all_leads(conn, "no_website")) == 1


def test_distinct_businesses_are_kept(tmp_path):
    conn = _db(tmp_path)
    r = store.create_run(conn, "no_website", {}, "done", 0.0)
    store.insert_leads(conn, r, "no_website", [
        _lead(place_id="A"), _lead(place_id="B")])
    assert len(store.all_leads(conn, "no_website")) == 2


# --- swept-searches seen-set ------------------------------------------------

def test_record_and_read_seen_pairs(tmp_path):
    conn = _db(tmp_path)
    store.record_searches(conn, "no_website",
                          [("cafe", "Footscray"), ("barber", "Carlton")])
    store.record_searches(conn, "no_website", [("cafe", "Footscray")])  # idempotent
    assert store.seen_pairs(conn, "no_website") == {
        ("cafe", "Footscray"), ("barber", "Carlton")}


def test_seen_pairs_scoped_per_engine(tmp_path):
    conn = _db(tmp_path)
    store.record_searches(conn, "no_website", [("cafe", "Footscray")])
    assert store.seen_pairs(conn, "other_engine") == set()


# --- migration collapses pre-existing duplicates ----------------------------

def test_migration_collapses_legacy_duplicate_rows(tmp_path):
    path = str(tmp_path / "legacy.db")
    raw = sqlite3.connect(path)
    raw.execute(
        """CREATE TABLE leads (
            id INTEGER PRIMARY KEY AUTOINCREMENT, run_id INTEGER, engine TEXT,
            business_name TEXT, category TEXT, suburb TEXT, address TEXT,
            phone TEXT, email TEXT, website TEXT, web_status TEXT, rating REAL,
            reviews_count INTEGER, google_maps_url TEXT, place_id TEXT,
            extra TEXT DEFAULT '{}', created_at TEXT)""")
    raw.executemany(
        "INSERT INTO leads (engine, business_name, suburb, place_id) "
        "VALUES ('no_website', 'Kitchen Republik', 'Box Hill', 'ChIJsame')",
        [() for _ in range(4)])
    raw.commit()
    raw.close()

    conn = db.connect(path)
    db.init_db(conn)  # runs the migration

    leads = store.all_leads(conn, "no_website")
    assert len(leads) == 1
    assert leads[0]["dedup_key"] == "ChIJsame"


# --- user_status: favourite / archive --------------------------------------


def test_new_lead_defaults_to_normal_status(tmp_path):
    conn = _db(tmp_path)
    r = store.create_run(conn, "no_website", {}, "done", 0.0)
    store.insert_leads(conn, r, "no_website", [_lead()])
    assert store.all_leads(conn, "no_website")[0]["user_status"] == "normal"


def test_set_lead_status_updates_and_returns_lead(tmp_path):
    conn = _db(tmp_path)
    r = store.create_run(conn, "no_website", {}, "done", 0.0)
    store.insert_leads(conn, r, "no_website", [_lead()])
    lead_id = store.all_leads(conn, "no_website")[0]["id"]

    updated = store.set_lead_status(conn, lead_id, "favourite")
    assert updated["user_status"] == "favourite"
    assert store.all_leads(conn, "no_website")[0]["user_status"] == "favourite"


def test_set_lead_status_rejects_unknown_value(tmp_path):
    conn = _db(tmp_path)
    r = store.create_run(conn, "no_website", {}, "done", 0.0)
    store.insert_leads(conn, r, "no_website", [_lead()])
    lead_id = store.all_leads(conn, "no_website")[0]["id"]
    with pytest.raises(ValueError):
        store.set_lead_status(conn, lead_id, "starred")


def test_set_lead_status_returns_none_for_missing_lead(tmp_path):
    conn = _db(tmp_path)
    assert store.set_lead_status(conn, 999, "favourite") is None


def test_upsert_preserves_user_status(tmp_path):
    # Re-scraping the same business must NOT wipe a star/archive.
    conn = _db(tmp_path)
    r1 = store.create_run(conn, "no_website", {}, "done", 0.0)
    store.insert_leads(conn, r1, "no_website", [_lead(reviews_count=69)])
    lead_id = store.all_leads(conn, "no_website")[0]["id"]
    store.set_lead_status(conn, lead_id, "favourite")

    r2 = store.create_run(conn, "no_website", {}, "done", 0.0)
    store.insert_leads(conn, r2, "no_website", [_lead(reviews_count=80)])  # re-scrape

    refreshed = store.all_leads(conn, "no_website")[0]
    assert refreshed["reviews_count"] == 80          # data refreshed
    assert refreshed["user_status"] == "favourite"   # status preserved
