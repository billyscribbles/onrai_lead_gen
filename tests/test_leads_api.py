"""Integration tests for PATCH /api/leads/{id}.

Uses FastAPI's TestClient with a throwaway SQLite DB wired in via dependency
override — no import of app.main (avoids startup event + production DB).
"""
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app import db, store
from app.routers import leads as leads_router


@pytest.fixture()
def client(tmp_path):
    conn = db.connect(str(tmp_path / "leads.db"))
    db.init_db(conn)

    # Insert one lead so we have a real id to work with.
    run_id = store.create_run(conn, "no_website", {}, "done", 0.0)
    store.insert_leads(conn, run_id, "no_website", [{
        "business_name": "Test Cafe", "category": "Cafe",
        "suburb": "Footscray", "address": "", "phone": "0412345678",
        "email": "", "website": "", "web_status": "none",
        "rating": 4.5, "reviews_count": 42,
        "google_maps_url": "", "place_id": "TEST-1", "extra": {},
    }])

    app = FastAPI()
    app.include_router(leads_router.router)

    # Override DB dependency to use the throwaway connection.
    app.dependency_overrides[leads_router.get_conn] = lambda: conn

    # require_auth is a no-op when APP_PASSWORD is not set (which is the case
    # in the test environment), but override it defensively to avoid any
    # session-middleware requirement.
    from app.auth import require_auth
    app.dependency_overrides[require_auth] = lambda: None

    with TestClient(app) as c:
        yield c, conn


def test_patch_lead_sets_favourite(client):
    c, conn = client
    lead_id = store.all_leads(conn, "no_website")[0]["id"]

    resp = c.patch(f"/api/leads/{lead_id}", json={"user_status": "favourite"})

    assert resp.status_code == 200
    assert resp.json()["user_status"] == "favourite"


def test_patch_lead_rejects_bogus_status(client):
    c, conn = client
    lead_id = store.all_leads(conn, "no_website")[0]["id"]

    resp = c.patch(f"/api/leads/{lead_id}", json={"user_status": "bogus"})

    assert resp.status_code == 400


def test_patch_lead_returns_404_for_missing_id(client):
    c, _ = client

    resp = c.patch("/api/leads/999999", json={"user_status": "favourite"})

    assert resp.status_code == 404


def test_list_leads_status_top_excludes_non_tier1(client):
    c, _ = client
    resp = c.get("/api/leads", params={"status": "top"})
    assert resp.status_code == 200
    # The seeded lead is 'none' (tier 3), not tier 1.
    assert resp.json()["total"] == 0


def test_list_leads_pagination_shape(client):
    c, _ = client
    body = c.get("/api/leads", params={"page": 1, "page_size": 10}).json()
    assert set(body) == {"items", "total", "page", "page_size"}
    assert body["page"] == 1 and body["page_size"] == 10


def test_facets_endpoint(client):
    c, _ = client
    body = c.get("/api/leads/facets", params={"engine": "no_website"}).json()
    assert body["total"] == 1
    assert body["none"] == 1
    assert "Hospitality & Tourism" in body["industries"]   # seeded "Cafe"
    assert body["suburbs"] == ["Footscray"]
