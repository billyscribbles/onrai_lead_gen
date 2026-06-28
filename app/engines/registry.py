"""Pluggable engine registry. Add an engine = add a module + an entry here."""
from __future__ import annotations

from dataclasses import dataclass

from app.config import settings


@dataclass(frozen=True)
class EngineMeta:
    key: str
    name: str
    description: str
    how_it_works: str
    icp_fit: str
    cost_per_place: float
    expected_yield: float
    default_per_search: int
    default_min_reviews: int


ENGINES: dict[str, EngineMeta] = {
    "no_website": EngineMeta(
        key="no_website",
        name="No-Website Finder",
        description="Established local businesses with a Google profile but no usable website.",
        how_it_works=("Sweeps Google Maps for a category across Melbourne suburbs, "
                      "keeps real, reviewed businesses whose site is missing, "
                      "social-only, broken, or not mobile-friendly."),
        icp_fit=("Exactly our ICP: a real going concern (reviews + hours) with an "
                 "obvious hole (no owned site) — a warm website-build lead."),
        cost_per_place=settings.cost_per_place,
        expected_yield=0.30,
        default_per_search=5,
        default_min_reviews=5,
    ),
}


def get_engine(key: str) -> EngineMeta:
    return ENGINES[key]
