"""Apify client construction with a clear error when unconfigured."""
from __future__ import annotations

from app.config import settings


def make_client():
    if not settings.apify_token:
        raise RuntimeError(
            "APIFY_TOKEN is not set — add it to the environment to launch runs.")
    from apify_client import ApifyClient
    return ApifyClient(settings.apify_token)
