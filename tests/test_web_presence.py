"""Tests for the pure web-presence classification logic (no network calls)."""

from web_presence import (
    classify_website,
    classify_live_site,
    is_lead_status,
    is_real_listing,
    no_website_row,
    google_search_url,
    lead_tag,
    extract_suburb,
    dedupe_by_place_id,
    parse_suburb_lines,
    LEAD_COLUMNS,
)


# --- extract_suburb ---------------------------------------------------------

def test_extract_suburb_prefers_neighborhood():
    assert extract_suburb({"neighborhood": "Richmond", "city": "Melbourne"}) == "Richmond"


def test_extract_suburb_falls_back_to_city():
    assert extract_suburb({"neighborhood": "", "city": "Carlton"}) == "Carlton"


def test_extract_suburb_parses_australian_address():
    place = {"neighborhood": None, "city": None,
             "address": "12 Smith St, Fitzroy VIC 3065, Australia"}
    assert extract_suburb(place) == "Fitzroy"


def test_extract_suburb_empty_when_unknown():
    assert extract_suburb({}) == ""


# --- dedupe_by_place_id -----------------------------------------------------

def test_dedupe_by_place_id_removes_duplicates():
    places = [{"placeId": "a", "title": "First"}, {"placeId": "b", "title": "Second"},
              {"placeId": "a", "title": "Dup"}]
    assert [p["title"] for p in dedupe_by_place_id(places)] == ["First", "Second"]


def test_dedupe_keeps_places_without_id():
    assert len(dedupe_by_place_id([{"title": "No id 1"}, {"title": "No id 2"}])) == 2


# --- parse_suburb_lines -----------------------------------------------------

def test_parse_suburb_lines_strips_blanks_and_comments():
    text = "# header\nRichmond\n\n  Carlton  \n# comment\nFitzroy\n"
    assert parse_suburb_lines(text) == ["Richmond", "Carlton", "Fitzroy"]


def test_parse_suburb_lines_empty():
    assert parse_suburb_lines("\n\n# only comments\n") == []


# --- lead_tag: plain-English label describing the pitch angle ----------------

def test_lead_tag_none_is_hot_no_website():
    assert lead_tag("none") == "Hot — no website"


def test_lead_tag_social_only_is_hot_strong_social():
    assert lead_tag("social_only") == "Hot — no website, strong social"


def test_lead_tag_broken_is_redesign():
    assert lead_tag("broken") == "Redesign — site not loading"


def test_lead_tag_not_mobile_is_redesign():
    assert lead_tag("not_mobile") == "Redesign — not mobile-friendly"


def test_lead_tag_unknown_status_is_blank():
    assert lead_tag("healthy") == ""


# --- google_search_url: a one-click "research this business" link ------------

def test_google_search_url_encodes_name():
    assert (google_search_url("Goddess of Nails & Beauty")
            == "https://www.google.com/search?q=Goddess+of+Nails+%26+Beauty")


def test_google_search_url_empty_name():
    assert google_search_url("") == ""


# --- classify_website (Tier A: from the Maps `website` field) ---------------

def test_classify_website_none_when_empty():
    assert classify_website("") == "none"
    assert classify_website(None) == "none"
    assert classify_website("   ") == "none"


def test_classify_website_facebook_is_social_only():
    assert classify_website("https://www.facebook.com/mrbaxter") == "social_only"


def test_classify_website_instagram_is_social_only():
    assert classify_website("https://instagram.com/mrbaxtermelbourne") == "social_only"


def test_classify_website_linktree_is_social_only():
    assert classify_website("https://linktr.ee/somebiz") == "social_only"


def test_classify_website_other_link_aggregators_are_social_only():
    assert classify_website("https://beacons.ai/somebiz") == "social_only"


def test_classify_website_http_real_domain_is_no_https():
    assert classify_website("http://example.com.au/") == "no_https"


def test_classify_website_https_real_domain_is_live_site():
    assert classify_website("https://example.com.au") == "live_site"


def test_classify_website_bare_domain_assumed_live_site():
    # No scheme: we can't prove it's http-only, so don't flag it as no_https.
    assert classify_website("example.com") == "live_site"


# --- classify_live_site (Tier B: from a local fetch of a real domain) -------

VIEWPORT_HTML = '<html><head><meta name="viewport" content="width=device-width"></head><body>Welcome to our cafe</body></html>'
NO_VIEWPORT_HTML = "<html><head><title>Cafe</title></head><body>Welcome to our cafe</body></html>"
PARKED_HTML = "<html><body>This domain is for sale. Buy this domain.</body></html>"


def test_classify_live_site_broken_when_fetch_failed():
    assert classify_live_site(False, None, "") == "broken"


def test_classify_live_site_broken_on_4xx():
    assert classify_live_site(True, 404, VIEWPORT_HTML) == "broken"


def test_classify_live_site_broken_on_5xx():
    assert classify_live_site(True, 503, VIEWPORT_HTML) == "broken"


def test_classify_live_site_parked_domain():
    assert classify_live_site(True, 200, PARKED_HTML) == "parked"


def test_classify_live_site_not_mobile_without_viewport():
    assert classify_live_site(True, 200, NO_VIEWPORT_HTML) == "not_mobile"


def test_classify_live_site_healthy_with_viewport():
    assert classify_live_site(True, 200, VIEWPORT_HTML) == "healthy"


# --- is_lead_status: everything but a healthy site is a prospect ------------

def test_is_lead_status_keeps_no_site_and_problem_sites():
    for status in ("none", "social_only", "no_https", "broken", "parked", "not_mobile"):
        assert is_lead_status(status), status


def test_is_lead_status_drops_healthy():
    assert not is_lead_status("healthy")


# --- is_real_listing: a real, established business, not a locality centroid --

def test_is_real_listing_true_for_established_business():
    place = {"title": "Mr Baxter Cafe", "categoryName": "Cafe", "reviewsCount": 69}
    assert is_real_listing(place, min_reviews=5)


def test_is_real_listing_false_when_too_few_reviews():
    place = {"title": "Brand New", "categoryName": "Cafe", "reviewsCount": 2}
    assert not is_real_listing(place, min_reviews=5)


def test_is_real_listing_false_without_category():
    # A locality/postcode centroid has no business category.
    place = {"title": "Footscray", "reviewsCount": 100}
    assert not is_real_listing(place, min_reviews=5)


def test_is_real_listing_false_without_title():
    assert not is_real_listing({"categoryName": "Cafe", "reviewsCount": 50}, min_reviews=5)


def test_is_real_listing_false_when_permanently_closed():
    place = {"title": "Gone", "categoryName": "Cafe", "reviewsCount": 50,
             "permanentlyClosed": True}
    assert not is_real_listing(place, min_reviews=5)


def test_is_real_listing_missing_reviews_treated_as_zero():
    place = {"title": "No reviews", "categoryName": "Cafe"}
    assert not is_real_listing(place, min_reviews=1)


# --- no_website_row: shape of an output CSV row -----------------------------

def test_no_website_row_maps_fields():
    place = {
        "title": "Mr Baxter Cafe",
        "categoryName": "Cafe",
        "totalScore": 4.6,
        "reviewsCount": 69,
        "phone": "+61 3 9000 0000",
        "website": "",
        "address": "Unit 1/1 Ormond Rd, West Footscray VIC 3012, Australia",
        "url": "https://maps.google.com/?cid=1",
    }
    row = no_website_row(place, "none")
    assert row["business_name"] == "Mr Baxter Cafe"
    assert row["category"] == "Cafe"
    assert row["web_status"] == "none"
    assert row["lead_tag"] == "Hot — no website"
    assert row["rating"] == 4.6
    assert row["reviews_count"] == 69
    assert row["phone"] == "+61 3 9000 0000"
    assert row["suburb"] == "West Footscray"
    assert row["google_maps_url"] == "https://maps.google.com/?cid=1"
    assert row["google_search_url"] == "https://www.google.com/search?q=Mr+Baxter+Cafe"
    assert set(row.keys()) == set(LEAD_COLUMNS)


def test_no_website_row_phone_blank_when_absent():
    # Mr Baxter had no phone on Google; that must not break row building.
    place = {"title": "X", "categoryName": "Cafe", "website": "https://fb.com/x"}
    row = no_website_row(place, "social_only")
    assert row["phone"] == ""
    assert row["website"] == "https://fb.com/x"
