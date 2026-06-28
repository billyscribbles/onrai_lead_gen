"""Tests for the pure orchestration helpers in scrape_no_website.py.

The network fetch is injected so these run offline.
"""

from scrape_no_website import build_search_strings, resolve_status


def _healthy(url):
    return (True, 200, '<html><meta name="viewport" content="width=device-width"></html>')


def _broken(url):
    return (False, None, "")


# --- build_search_strings ---------------------------------------------------

def test_build_search_strings_is_suburb_major():
    grid = build_search_strings(["cafe", "barber"], ["Footscray", "Carlton"], None)
    assert grid == [
        "cafe Footscray VIC", "barber Footscray VIC",
        "cafe Carlton VIC", "barber Carlton VIC",
    ]


def test_build_search_strings_respects_max_searches():
    grid = build_search_strings(["cafe", "barber"], ["Footscray", "Carlton"], 3)
    assert len(grid) == 3


# --- resolve_status: http-only sites must be fetched, not auto-flagged -------

def test_resolve_status_drops_http_site_that_upgrades_to_healthy_https():
    # The George bug: http:// in Maps, but the site loads fine -> not a lead.
    place = {"website": "http://www.thegeorgeoncollins.com.au/"}
    status, consumed = resolve_status(place, True, 10, fetch_fn=_healthy)
    assert status == "healthy"
    assert consumed is True


def test_resolve_status_keeps_http_site_that_is_actually_broken():
    place = {"website": "http://dead.example/"}
    status, consumed = resolve_status(place, True, 10, fetch_fn=_broken)
    assert status == "broken"
    assert consumed is True


def test_resolve_status_fetches_https_live_site():
    place = {"website": "https://realsite.com.au/"}
    status, consumed = resolve_status(place, True, 10, fetch_fn=_healthy)
    assert status == "healthy"
    assert consumed is True


def test_resolve_status_skips_url_site_when_fetch_disabled():
    place = {"website": "http://shop.example.com.au/"}
    status, consumed = resolve_status(place, False, 10, fetch_fn=_healthy)
    assert status is None
    assert consumed is False


def test_resolve_status_skips_url_site_when_budget_exhausted():
    place = {"website": "https://shop.example.com.au/"}
    status, consumed = resolve_status(place, True, 0, fetch_fn=_healthy)
    assert status is None
    assert consumed is False


def test_resolve_status_no_fetch_for_no_site():
    status, consumed = resolve_status({"website": ""}, True, 10, fetch_fn=_healthy)
    assert status == "none"
    assert consumed is False


def test_resolve_status_no_fetch_for_social_only():
    place = {"website": "https://facebook.com/x"}
    status, consumed = resolve_status(place, True, 10, fetch_fn=_healthy)
    assert status == "social_only"
    assert consumed is False
