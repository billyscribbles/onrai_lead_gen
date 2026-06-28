"""query_leads filtering/sorting/pagination + lead_facets, against a throwaway DB."""

from app import db, store


def _db(tmp_path):
    conn = db.connect(str(tmp_path / "leads.db"))
    db.init_db(conn)
    return conn


def _seed(conn):
    run_id = store.create_run(conn, "no_website", {}, "done", 0.0)
    leads = [
        # social_only + phone -> tier 1 ("top")
        dict(business_name="Lavish Barbers", category="Barber shop",
             suburb="Melbourne", phone="0400000001", website="instagram.com/lav",
             web_status="social_only", rating=4.8, reviews_count=1493),
        # social_only, no phone -> tier 2
        dict(business_name="Glow Salon", category="Beauty salon",
             suburb="Richmond", phone="", website="instagram.com/glow",
             web_status="social_only", rating=4.5, reviews_count=200),
        # none + phone -> tier 3
        dict(business_name="Mr Baxter Cafe", category="Cafe",
             suburb="West Footscray", phone="0400000003", website="",
             web_status="none", rating=4.6, reviews_count=69),
        # none, no phone -> tier 4
        dict(business_name="Quiet Books", category="Bookshop",
             suburb="Richmond", phone="", website="",
             web_status="none", rating=4.0, reviews_count=10),
    ]
    full = [dict(address="", email="", google_maps_url="", extra={},
                 place_id=f"PID-{i}", **l) for i, l in enumerate(leads)]
    store.insert_leads(conn, run_id, "no_website", full)
    return run_id


def test_status_top_only_returns_tier1(tmp_path):
    conn = _db(tmp_path); _seed(conn)
    res = store.query_leads(conn, engine="no_website", status="top")
    assert [i["business_name"] for i in res["items"]] == ["Lavish Barbers"]
    assert res["total"] == 1


def test_status_passthrough_web_status(tmp_path):
    conn = _db(tmp_path); _seed(conn)
    res = store.query_leads(conn, engine="no_website", status="none")
    assert {i["business_name"] for i in res["items"]} == {"Mr Baxter Cafe", "Quiet Books"}


def test_phone_only(tmp_path):
    conn = _db(tmp_path); _seed(conn)
    res = store.query_leads(conn, engine="no_website", phone_only=True)
    assert {i["business_name"] for i in res["items"]} == {"Lavish Barbers", "Mr Baxter Cafe"}


def test_industry_filter(tmp_path):
    conn = _db(tmp_path); _seed(conn)
    res = store.query_leads(conn, engine="no_website", industry="Hospitality & Tourism")
    assert [i["business_name"] for i in res["items"]] == ["Mr Baxter Cafe"]


def test_search_matches_category_and_suburb(tmp_path):
    conn = _db(tmp_path); _seed(conn)
    # "Richmond" matches by suburb, not by business_name.
    res = store.query_leads(conn, engine="no_website", q="Richmond")
    assert {i["business_name"] for i in res["items"]} == {"Glow Salon", "Quiet Books"}


def test_bucket_archived_and_active(tmp_path):
    conn = _db(tmp_path); _seed(conn)
    lead_id = store.query_leads(conn, engine="no_website", q="Quiet")["items"][0]["id"]
    store.set_lead_status(conn, lead_id, "archived")
    active = store.query_leads(conn, engine="no_website", bucket="active")
    assert "Quiet Books" not in {i["business_name"] for i in active["items"]}
    archived = store.query_leads(conn, engine="no_website", bucket="archived")
    assert [i["business_name"] for i in archived["items"]] == ["Quiet Books"]


def test_run_id_filter(tmp_path):
    conn = _db(tmp_path); run_id = _seed(conn)
    res = store.query_leads(conn, engine="no_website", run_id=run_id)
    assert res["total"] == 4
    assert store.query_leads(conn, engine="no_website", run_id=run_id + 999)["total"] == 0


def test_sort_hot_tier_order(tmp_path):
    conn = _db(tmp_path); _seed(conn)
    res = store.query_leads(conn, engine="no_website", sort="hot")
    assert [i["business_name"] for i in res["items"]] == [
        "Lavish Barbers", "Glow Salon", "Mr Baxter Cafe", "Quiet Books"]


def test_sort_newest_recent_first(tmp_path):
    conn = _db(tmp_path); _seed(conn)
    res = store.query_leads(conn, engine="no_website", sort="newest")
    # All seeded in one batch (same created_at); tier breaks the tie.
    assert res["items"][0]["business_name"] == "Lavish Barbers"
    assert res["total"] == 4


def test_pagination_total_vs_items(tmp_path):
    conn = _db(tmp_path); _seed(conn)
    res = store.query_leads(conn, engine="no_website", sort="hot", page=1, page_size=2)
    assert res["total"] == 4
    assert [i["business_name"] for i in res["items"]] == ["Lavish Barbers", "Glow Salon"]
    res2 = store.query_leads(conn, engine="no_website", sort="hot", page=2, page_size=2)
    assert [i["business_name"] for i in res2["items"]] == ["Mr Baxter Cafe", "Quiet Books"]


def test_lead_facets(tmp_path):
    conn = _db(tmp_path); _seed(conn)
    f = store.lead_facets(conn, "no_website")
    assert f["total"] == 4
    assert f["top"] == 1            # Lavish Barbers (tier 1)
    assert f["social_only"] == 2
    assert f["none"] == 2
    # reachable: Lavish (phone+site), Glow (site), Baxter (phone) = 3; Quiet has neither.
    assert f["reachable"] == 3
    assert f["industries"] == ["Hospitality & Tourism", "Beauty & grooming", "E-commerce & Retail"]
    assert f["suburbs"] == ["Melbourne", "Richmond", "West Footscray"]
