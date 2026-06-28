"""Cost estimation for a run, before the user confirms spend."""
from __future__ import annotations

from app.engines import no_website
from app.engines.registry import get_engine


def estimate(engine_key: str, params: dict) -> dict:
    meta = get_engine(engine_key)
    per_search = int(params.get("per_search", meta.default_per_search))
    target = int(params.get("target", 25))
    suburbs = params.get("suburbs") or no_website._default_suburbs()
    searches = no_website._searches_for_target(
        target, per_search, meta.expected_yield, len(suburbs))
    places = searches * per_search
    expected = places * meta.cost_per_place
    return {
        "places": places,
        "searches": searches,
        "cost_low": round(expected * 0.8, 3),
        "cost_expected": round(expected, 3),
        "cost_high": round(expected * 1.3, 3),
    }
