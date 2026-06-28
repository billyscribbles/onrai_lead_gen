"""Tests for the pure orchestration helpers in scrape_no_website.py.

The network fetch is injected so these run offline.
"""

from scrape_no_website import (
    build_search_pairs, build_search_strings, resolve_status)


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


def test_build_search_pairs_skips_already_swept():
    # 'cafe Footscray' was swept before -> exclude it from the new grid.
    pairs = build_search_pairs(
        ["cafe", "barber"], ["Footscray", "Carlton"], None,
        skip_pairs={("cafe", "Footscray")})
    assert ("cafe", "Footscray") not in pairs
    assert ("barber", "Footscray") in pairs
    assert len(pairs) == 3


def test_build_search_pairs_skips_before_capping():
    # The cap must apply to NEW ground, not be eaten by skipped combos.
    pairs = build_search_pairs(
        ["cafe", "barber"], ["Footscray", "Carlton"], 2,
        skip_pairs={("cafe", "Footscray"), ("barber", "Footscray")})
    assert pairs == [("cafe", "Carlton"), ("barber", "Carlton")]


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


# --- abort plumbing ---------------------------------------------------------

import pytest
from scrape_no_website import RunAborted, collect_leads, run_maps_lookup


class _FakeActor:
    def __init__(self, run):
        self._run = run

    def start(self, run_input=None):
        return self._run


class _FakeDataset:
    def __init__(self, items):
        self._items = items

    def iterate_items(self):
        return iter(self._items)


class _OneShotRunClient:
    """Returns SUCCEEDED on the first .get() so the poll loop never sleeps."""
    def get(self):
        return {"status": "SUCCEEDED", "id": "R1", "defaultDatasetId": "DS1"}

    def abort(self):
        raise AssertionError("abort() should not be called on the happy path")


class _HappyClient:
    def actor(self, name):
        return _FakeActor({"id": "R1"})

    def run(self, run_id):
        return _OneShotRunClient()

    def dataset(self, ds_id):
        return _FakeDataset([{"placeId": "p1"}])


def test_run_maps_lookup_starts_polls_and_returns_items():
    captured = {}
    places = run_maps_lookup(
        _HappyClient(), ["cafe Footscray VIC"], 5, "au", 200,
        on_run_start=lambda rid: captured.__setitem__("rid", rid))
    assert captured["rid"] == "R1"
    assert places == [{"placeId": "p1"}]


def test_run_maps_lookup_reports_live_listing_count(monkeypatch):
    """on_count receives the dataset's growing item count while polling."""
    import scrape_no_website
    monkeypatch.setattr(scrape_no_website.time, "sleep", lambda *_: None)
    counts = []

    class _RunsThenDone:
        def __init__(self):
            self._calls = 0

        def get(self):
            self._calls += 1
            status = "RUNNING" if self._calls == 1 else "SUCCEEDED"
            return {"status": status, "id": "R1", "defaultDatasetId": "DS1"}

        def abort(self):
            raise AssertionError("happy path must not abort")

    class _Client:
        def actor(self, name):
            return _FakeActor({"id": "R1", "defaultDatasetId": "DS1"})

        def run(self, run_id):
            return _RunsThenDone()

        def dataset(self, ds_id):
            class _DS:
                def get(self):
                    return {"itemCount": 7}

                def iterate_items(self):
                    return iter([{"placeId": "p1"}])
            return _DS()

    places = run_maps_lookup(_Client(), ["cafe VIC"], 5, "au", 200,
                             on_count=counts.append)
    assert counts == [7]            # one tick while RUNNING, before completion
    assert places == [{"placeId": "p1"}]


def test_run_maps_lookup_aborts_apify_run_when_requested():
    aborted = []

    class _RunningRunClient:
        def get(self):
            return {"status": "RUNNING", "id": "R1", "defaultDatasetId": "DS1"}

        def abort(self):
            aborted.append("R1")

    class _Client:
        def actor(self, name):
            return _FakeActor({"id": "R1"})

        def run(self, run_id):
            return _RunningRunClient()

        def dataset(self, ds_id):
            raise AssertionError("dataset() must not be read after an abort")

    with pytest.raises(RunAborted):
        run_maps_lookup(_Client(), ["x VIC"], 5, "au", 200,
                        should_abort=lambda: True)
    assert aborted == ["R1"]


def test_collect_leads_aborts_immediately_without_touching_client():
    class _NoCallClient:
        def actor(self, *a, **k):
            raise AssertionError("actor() must not be called once aborted")

        def dataset(self, *a, **k):
            raise AssertionError("dataset() must not be called once aborted")

    with pytest.raises(RunAborted):
        collect_leads(
            _NoCallClient(), categories=["cafe"], suburbs=["Footscray"],
            per_search=5, max_searches=1, min_reviews=5, country="au",
            chunk_size=200, limit=None, fetch=False, maps_dataset_id="DS-1",
            should_abort=lambda: True)
