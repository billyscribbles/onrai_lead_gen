# Lead-Gen Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A deployed web dashboard that stores all lead-gen output, explains the engine, and lets you launch a live Apify scrape (category + target count → cost estimate → confirm → browse results).

**Architecture:** A single FastAPI service holds an engine registry (one engine today: `no_website`), an in-process async worker that drives Apify runs, and SQLite storage. A React (Vite + TypeScript + Tailwind) SPA is built to static files and served by the same FastAPI service. The existing `web_presence.py` and `scrape_no_website.py` logic is reused, not rewritten.

**Tech Stack:** Python 3, FastAPI, uvicorn, stdlib `sqlite3`, Starlette `SessionMiddleware`, apify-client, pytest + httpx `TestClient`; React 18 + TypeScript + Vite + Tailwind + TanStack Query + React Router.

## Global Constraints

- Python import root is the repo root (`conftest.py` exists so tests `import web_presence` directly). Backend package lives in `app/`; tests live in `tests/`.
- Do NOT modify `web_presence.py`'s public functions; reuse them. `scrape_no_website.py` may be refactored only to *extract* a reusable callable — its CLI (`main`) must keep working.
- All money is USD. Apify Google Places actor key: `compass/crawler-google-places`. Assumed cost: `cost_per_place = 0.004` USD.
- SQLite path comes from env `DB_PATH` (default `output/leads.db` locally, `/data/leads.db` on Railway).
- Secrets via env only: `APIFY_TOKEN`, `APP_PASSWORD`, `SESSION_SECRET`. Never hard-code.
- Unified lead dict keys (every engine returns these exact keys):
  `business_name, category, suburb, address, phone, email, website, web_status, rating, reviews_count, google_maps_url, place_id, extra` (where `extra` is a JSON-serializable dict).
- Run status values (exact strings): `awaiting_confirm`, `running`, `classifying`, `done`, `failed`, `aborted`, `imported`.
- Frontend talks to the API under the same origin at `/api/*`. In dev, Vite proxies `/api` to `http://localhost:8000`.

---

## File Structure

**Backend (`app/`)**
- `app/__init__.py` — marks package.
- `app/config.py` — env-driven settings (DB_PATH, secrets, cost constant).
- `app/db.py` — sqlite connection + schema init + tiny query helpers.
- `app/normalize.py` — `parse_place_id`, `lead_template`, `dedupe_leads`.
- `app/engines/__init__.py`
- `app/engines/registry.py` — `EngineMeta` + `ENGINES` dict + `get_engine`.
- `app/engines/no_website.py` — `run(params, on_progress)` reusing the CLI core.
- `app/cost.py` — `estimate(engine_key, params)`.
- `app/apify.py` — `ApifyRunner` (launch/poll/fetch; injectable for tests).
- `app/store.py` — persistence: create/update runs, insert leads, query leads.
- `app/worker.py` — `execute_run(run_id)` state machine + an asyncio launcher.
- `app/auth.py` — password check + session dependency.
- `app/routers/auth.py`, `app/routers/engines.py`, `app/routers/runs.py`, `app/routers/leads.py`.
- `app/ingest.py` — import existing CSV(s) on first boot.
- `app/main.py` — app assembly, middleware, static mount, startup hooks.

**Refactor**
- `scrape_no_website.py` — extract `collect_leads(...)` core used by both the CLI and the engine wrapper.

**Frontend (`web/`)**
- `web/index.html`, `web/vite.config.ts`, `web/tailwind.config.js`, `web/postcss.config.js`, `web/tsconfig.json`, `web/package.json`
- `web/src/main.tsx`, `web/src/App.tsx`, `web/src/index.css`
- `web/src/api.ts` — typed fetch helpers.
- `web/src/auth.tsx` — login state + guard.
- `web/src/pages/Dashboard.tsx`, `NewRun.tsx`, `Runs.tsx`, `Leads.tsx`, `Engines.tsx`, `Login.tsx`
- `web/src/components/` — `StatCard.tsx`, `EngineCard.tsx`, `RunStatusBadge.tsx`, `LeadDrawer.tsx`

**Tests (`tests/`)**
- `tests/test_normalize.py`, `tests/test_cost.py`, `tests/test_engine_no_website.py`, `tests/test_store.py`, `tests/test_ingest.py`, `tests/test_api.py`

**Deploy**
- `requirements.txt` (extend), `Procfile`, `railway.json`, `README` deploy section.

---

## Phase 0 — Scaffolding & dependencies

### Task 0.1: Backend dependencies + app package

**Files:**
- Modify: `requirements.txt`
- Create: `app/__init__.py`, `app/config.py`
- Test: `tests/test_config.py`

**Interfaces:**
- Produces: `app.config.settings` with attributes `db_path: str`, `apify_token: str | None`, `app_password: str | None`, `session_secret: str`, `cost_per_place: float`.

- [ ] **Step 1: Extend requirements.txt**

Append to `requirements.txt`:
```
fastapi>=0.110
uvicorn[standard]>=0.29
httpx>=0.27
itsdangerous>=2.1
```

- [ ] **Step 2: Install**

Run: `.venv/bin/pip install -r requirements.txt`
Expected: installs without error.

- [ ] **Step 3: Write the failing test**

Create `tests/test_config.py`:
```python
import importlib

def test_settings_reads_env(monkeypatch):
    monkeypatch.setenv("DB_PATH", "/tmp/x.db")
    monkeypatch.setenv("APIFY_TOKEN", "tok")
    monkeypatch.setenv("APP_PASSWORD", "pw")
    import app.config as cfg
    importlib.reload(cfg)
    assert cfg.settings.db_path == "/tmp/x.db"
    assert cfg.settings.apify_token == "tok"
    assert cfg.settings.app_password == "pw"
    assert cfg.settings.cost_per_place == 0.004

def test_settings_defaults(monkeypatch):
    monkeypatch.delenv("DB_PATH", raising=False)
    import app.config as cfg
    importlib.reload(cfg)
    assert cfg.settings.db_path.endswith("leads.db")
    assert isinstance(cfg.settings.session_secret, str) and cfg.settings.session_secret
```

- [ ] **Step 4: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_config.py -v`
Expected: FAIL (`ModuleNotFoundError: No module named 'app'`).

- [ ] **Step 5: Create the package + config**

Create `app/__init__.py` (empty).
Create `app/config.py`:
```python
"""Environment-driven settings for the dashboard backend."""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parent.parent / ".env")
except ImportError:  # python-dotenv optional
    pass


@dataclass(frozen=True)
class Settings:
    db_path: str
    apify_token: str | None
    app_password: str | None
    session_secret: str
    cost_per_place: float


def _load() -> Settings:
    return Settings(
        db_path=os.environ.get("DB_PATH", "output/leads.db"),
        apify_token=os.environ.get("APIFY_TOKEN") or os.environ.get("APIFY_API_TOKEN"),
        app_password=os.environ.get("APP_PASSWORD"),
        session_secret=os.environ.get("SESSION_SECRET", "dev-insecure-secret-change-me"),
        cost_per_place=float(os.environ.get("COST_PER_PLACE", "0.004")),
    )


settings = _load()
```

- [ ] **Step 6: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_config.py -v`
Expected: PASS.

- [ ] **Step 7: Commit (if repo is git-initialized; otherwise skip commit steps throughout)**

```bash
git add requirements.txt app/__init__.py app/config.py tests/test_config.py
git commit -m "feat: backend package + env-driven settings"
```

---

## Phase 1 — Database

### Task 1.1: SQLite schema + connection helper

**Files:**
- Create: `app/db.py`
- Test: `tests/test_store.py` (begun here; expanded in Task 3.x)

**Interfaces:**
- Produces:
  - `connect(db_path: str | None = None) -> sqlite3.Connection` (row_factory = `sqlite3.Row`, FK on).
  - `init_db(conn) -> None` (idempotent; creates `runs` and `leads`).
  - Schema columns exactly as in Global Constraints / spec.

- [ ] **Step 1: Write the failing test**

Create `tests/test_store.py`:
```python
from app import db

def test_init_db_creates_tables(tmp_path):
    conn = db.connect(str(tmp_path / "t.db"))
    db.init_db(conn)
    names = {r["name"] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'")}
    assert {"runs", "leads"} <= names

def test_init_db_is_idempotent(tmp_path):
    conn = db.connect(str(tmp_path / "t.db"))
    db.init_db(conn)
    db.init_db(conn)  # must not raise
    cols = {r["name"] for r in conn.execute("PRAGMA table_info(leads)")}
    assert {"business_name", "place_id", "extra", "run_id"} <= cols
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_store.py -v`
Expected: FAIL (`ModuleNotFoundError: No module named 'app.db'`).

- [ ] **Step 3: Implement `app/db.py`**

```python
"""SQLite connection + schema for the dashboard."""
from __future__ import annotations

import sqlite3
from pathlib import Path

from app.config import settings

_SCHEMA = """
CREATE TABLE IF NOT EXISTS runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    engine TEXT NOT NULL,
    params TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL,
    cost_estimate REAL,
    cost_actual REAL,
    apify_run_id TEXT,
    places_scraped INTEGER NOT NULL DEFAULT 0,
    leads_found INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    started_at TEXT,
    finished_at TEXT
);
CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id INTEGER REFERENCES runs(id),
    engine TEXT NOT NULL,
    business_name TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT '',
    suburb TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    website TEXT NOT NULL DEFAULT '',
    web_status TEXT NOT NULL DEFAULT '',
    rating REAL,
    reviews_count INTEGER,
    google_maps_url TEXT NOT NULL DEFAULT '',
    place_id TEXT,
    extra TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_leads_engine ON leads(engine);
CREATE INDEX IF NOT EXISTS idx_leads_place ON leads(place_id);
"""


def connect(db_path: str | None = None) -> sqlite3.Connection:
    path = db_path or settings.db_path
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db(conn: sqlite3.Connection) -> None:
    conn.executescript(_SCHEMA)
    conn.commit()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_store.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/db.py tests/test_store.py
git commit -m "feat: sqlite schema + connection helper"
```

---

## Phase 2 — Lead normalization

### Task 2.1: place_id parsing, lead template, dedupe

**Files:**
- Create: `app/normalize.py`
- Test: `tests/test_normalize.py`

**Interfaces:**
- Produces:
  - `parse_place_id(google_maps_url: str) -> str | None` — reads `query_place_id` param.
  - `lead_template(**overrides) -> dict` — returns a unified lead dict with all keys present and safe defaults (`extra={}`), applying overrides.
  - `dedupe_leads(leads: list[dict]) -> list[dict]` — drop later duplicates sharing a truthy `place_id`; leads without a place_id are all kept.

- [ ] **Step 1: Write the failing test**

Create `tests/test_normalize.py`:
```python
from app import normalize

def test_parse_place_id_extracts_query_place_id():
    url = ("https://www.google.com/maps/search/?api=1&query=Foo"
           "&query_place_id=ChIJ123abc")
    assert normalize.parse_place_id(url) == "ChIJ123abc"

def test_parse_place_id_none_when_absent():
    assert normalize.parse_place_id("https://example.com") is None
    assert normalize.parse_place_id("") is None

def test_lead_template_has_all_keys_and_defaults():
    lead = normalize.lead_template(business_name="Mr Baxter", engine="no_website")
    assert lead["business_name"] == "Mr Baxter"
    assert lead["engine"] == "no_website"
    for k in ("category", "suburb", "address", "phone", "email", "website",
              "web_status", "google_maps_url", "place_id"):
        assert k in lead
    assert lead["extra"] == {}

def test_dedupe_keeps_first_per_place_id():
    leads = [
        normalize.lead_template(business_name="A", place_id="p1"),
        normalize.lead_template(business_name="B", place_id="p1"),
        normalize.lead_template(business_name="C", place_id="p2"),
        normalize.lead_template(business_name="D", place_id=None),
        normalize.lead_template(business_name="E", place_id=None),
    ]
    out = normalize.dedupe_leads(leads)
    names = [l["business_name"] for l in out]
    assert names == ["A", "C", "D", "E"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_normalize.py -v`
Expected: FAIL (`ModuleNotFoundError`).

- [ ] **Step 3: Implement `app/normalize.py`**

```python
"""Normalize engine output into the unified lead shape."""
from __future__ import annotations

from urllib.parse import parse_qs, urlparse

_LEAD_KEYS = (
    "engine", "business_name", "category", "suburb", "address", "phone",
    "email", "website", "web_status", "rating", "reviews_count",
    "google_maps_url", "place_id", "extra",
)


def parse_place_id(google_maps_url: str) -> str | None:
    if not google_maps_url:
        return None
    qs = parse_qs(urlparse(google_maps_url).query)
    vals = qs.get("query_place_id")
    return vals[0] if vals else None


def lead_template(**overrides) -> dict:
    base = {
        "engine": "", "business_name": "", "category": "", "suburb": "",
        "address": "", "phone": "", "email": "", "website": "",
        "web_status": "", "rating": None, "reviews_count": None,
        "google_maps_url": "", "place_id": None, "extra": {},
    }
    base.update({k: v for k, v in overrides.items() if k in _LEAD_KEYS})
    if base["extra"] is None:
        base["extra"] = {}
    return base


def dedupe_leads(leads: list[dict]) -> list[dict]:
    seen: set[str] = set()
    out: list[dict] = []
    for lead in leads:
        pid = lead.get("place_id")
        if pid:
            if pid in seen:
                continue
            seen.add(pid)
        out.append(lead)
    return out
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_normalize.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/normalize.py tests/test_normalize.py
git commit -m "feat: lead normalization (place_id, template, dedupe)"
```

---

## Phase 3 — Engine registry & no_website wrapper

### Task 3.1: Extract a reusable core from `scrape_no_website.py`

**Files:**
- Modify: `scrape_no_website.py` (extract `collect_leads`, call it from `main`)
- Test: `tests/test_engine_no_website.py` (part 1)

**Interfaces:**
- Produces in `scrape_no_website.py`:
  - `collect_leads(client, *, categories, suburbs, per_search, max_searches, min_reviews, country, chunk_size, limit, fetch, maps_dataset_id=None, on_progress=None, fetch_fn=fetch_site) -> list[dict]`
    returns rows from `web_presence.no_website_row(...)` (CSV row shape) **plus** a `place_id` key per row.
  - `on_progress(event: dict)` is called with `{"stage": str, "message": str, "places_scraped": int}` at milestones; may be `None`.
- Consumes: existing `run_maps_lookup`, `resolve_status`, `web_presence.*`.

- [ ] **Step 1: Write the failing test (offline, Apify client faked)**

Create `tests/test_engine_no_website.py`:
```python
import scrape_no_website as sw

class _FakeDataset:
    def __init__(self, items): self._items = items
    def iterate_items(self): return iter(self._items)

class _FakeClient:
    """Stands in for ApifyClient; returns canned Maps items for any run."""
    def __init__(self, items): self._items = items
    def dataset(self, _id): return _FakeDataset(self._items)
    def actor(self, _key):
        client = self
        class _Actor:
            def call(self, run_input=None):
                class _Run:
                    id = "run1"; status = "SUCCEEDED"
                    default_dataset_id = "ds1"
                return _Run()
        return _Actor()

def _place(title, website, reviews=10, pid="p1"):
    return {
        "title": title, "categoryName": "Cafe", "website": website,
        "reviewsCount": reviews, "totalScore": 4.6, "phone": "",
        "address": "1 X St, Footscray VIC 3011, Australia",
        "url": f"https://maps.google.com/?q=x&query_place_id={pid}",
        "placeId": pid,
    }

def test_collect_leads_keeps_no_website_drops_healthy():
    items = [
        _place("No Site Cafe", "", pid="p1"),
        _place("Healthy Co", "https://healthy.example", pid="p2"),
    ]
    client = _FakeClient(items)
    healthy = lambda url: (True, 200,
        '<html><meta name="viewport" content="width=device-width"></html>')
    leads = sw.collect_leads(
        client, categories=["cafe"], suburbs=["Footscray"], per_search=5,
        max_searches=None, min_reviews=5, country="au", chunk_size=200,
        limit=None, fetch=True, fetch_fn=healthy)
    names = {l["business_name"] for l in leads}
    assert "No Site Cafe" in names
    assert "Healthy Co" not in names
    assert all("place_id" in l for l in leads)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_engine_no_website.py -v`
Expected: FAIL (`AttributeError: module 'scrape_no_website' has no attribute 'collect_leads'`).

- [ ] **Step 3: Refactor `scrape_no_website.py`**

Add `collect_leads` (extracted from the body of `main`) above `main`:
```python
def collect_leads(client, *, categories, suburbs, per_search, max_searches,
                  min_reviews, country, chunk_size, limit, fetch,
                  maps_dataset_id=None, on_progress=None, fetch_fn=fetch_site):
    """Core no-website pipeline, decoupled from CLI/CSV. Returns lead rows
    (web_presence.no_website_row shape) each with an added 'place_id'."""
    def _emit(stage, message, places=0):
        if on_progress:
            on_progress({"stage": stage, "message": message,
                         "places_scraped": places})

    if maps_dataset_id:
        _emit("maps", f"Reusing dataset {maps_dataset_id}")
        raw_places = list(client.dataset(maps_dataset_id).iterate_items())
    else:
        searches = build_search_strings(categories, suburbs, max_searches)
        _emit("maps", f"Sweeping {len(searches)} searches")
        raw_places = run_maps_lookup(client, searches, per_search, country, chunk_size)

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
```
Then change `main` to delegate (keep CSV writing in `main`):
```python
    rows = collect_leads(
        client,
        categories=web_presence.parse_suburb_lines(Path(args.categories_file).read_text("utf-8")) if not args.maps_dataset_id else [],
        suburbs=web_presence.parse_suburb_lines(Path(args.suburbs_file).read_text("utf-8")) if not args.maps_dataset_id else [],
        per_search=args.per_search, max_searches=args.max_searches,
        min_reviews=args.min_reviews, country=args.country,
        chunk_size=args.chunk_size, limit=args.limit, fetch=args.fetch,
        maps_dataset_id=args.maps_dataset_id,
    )
    write_csv(rows, args.output)
    return 0
```
(Remove the now-duplicated dedupe/loop body from `main`. Keep `get_token`, `parse_args`, `write_csv` as-is.)

- [ ] **Step 4: Run all tests to verify pass + no regression**

Run: `.venv/bin/pytest tests/test_engine_no_website.py tests/test_scrape_no_website.py -v`
Expected: PASS (new test + existing `resolve_status`/`build_search_strings` tests still green).

- [ ] **Step 5: Commit**

```bash
git add scrape_no_website.py tests/test_engine_no_website.py
git commit -m "refactor: extract collect_leads core from scrape_no_website CLI"
```

### Task 3.2: Engine registry + no_website engine module

**Files:**
- Create: `app/engines/__init__.py`, `app/engines/registry.py`, `app/engines/no_website.py`
- Test: `tests/test_engine_no_website.py` (part 2)

**Interfaces:**
- Consumes: `scrape_no_website.collect_leads`, `app.normalize.lead_template`.
- Produces:
  - `registry.EngineMeta` dataclass: `key, name, description, how_it_works, icp_fit, cost_per_place, expected_yield, default_per_search, default_min_reviews`.
  - `registry.ENGINES: dict[str, EngineMeta]` containing key `"no_website"`.
  - `registry.get_engine(key) -> EngineMeta` (raises `KeyError` if unknown).
  - `no_website.run(params: dict, on_progress=None, client=None) -> list[dict]` returning **unified** lead dicts (via `lead_template`). `client=None` means build a real `ApifyClient`; tests pass a fake.
  - `no_website.PARAMS`: documents accepted `params` keys: `category: str` (required), `suburbs: list[str] | None`, `per_search: int`, `min_reviews: int`, `target: int`, `fetch: bool`, `maps_dataset_id: str | None`.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_engine_no_website.py`:
```python
from app.engines import registry
from app.engines import no_website

def test_registry_has_no_website():
    meta = registry.get_engine("no_website")
    assert meta.key == "no_website"
    assert meta.cost_per_place > 0
    assert 0 < meta.expected_yield <= 1

def test_no_website_run_returns_unified_leads(monkeypatch):
    items = [_place("No Site Cafe", "", pid="p1")]
    monkeypatch.setattr(no_website, "_default_suburbs", lambda: ["Footscray"])
    leads = no_website.run(
        {"category": "cafe", "per_search": 5, "min_reviews": 5,
         "target": 10, "fetch": False},
        client=_FakeClient(items))
    assert leads and leads[0]["engine"] == "no_website"
    assert leads[0]["business_name"] == "No Site Cafe"
    assert leads[0]["place_id"] == "p1"
    assert set(leads[0]["extra"]) >= {"lead_tag"}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_engine_no_website.py -v`
Expected: FAIL (`ModuleNotFoundError: app.engines`).

- [ ] **Step 3: Implement registry + engine**

Create `app/engines/__init__.py` (empty).
Create `app/engines/registry.py`:
```python
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
```
Create `app/engines/no_website.py`:
```python
"""Engine wrapper around scrape_no_website.collect_leads."""
from __future__ import annotations

import math
from pathlib import Path

import scrape_no_website as sw
import web_presence
from app.engines.registry import get_engine
from app.normalize import lead_template

PARAMS = {
    "category": "str (required) — the Google Maps category to sweep",
    "suburbs": "list[str] | None — defaults to suburbs_melbourne.txt",
    "per_search": "int — places per category x suburb search",
    "min_reviews": "int — min reviews to count as established",
    "target": "int — desired qualified leads (drives search breadth)",
    "fetch": "bool — fetch live sites to judge broken/not-mobile",
    "maps_dataset_id": "str | None — reuse an existing Maps dataset (free)",
}

_SUBURBS_FILE = Path(__file__).resolve().parent.parent.parent / "suburbs_melbourne.txt"


def _default_suburbs() -> list[str]:
    return web_presence.parse_suburb_lines(_SUBURBS_FILE.read_text("utf-8"))


def _searches_for_target(target: int, per_search: int, yield_: float, n_suburbs: int) -> int:
    """How many category x suburb searches to attempt for `target` leads."""
    places_needed = math.ceil(max(target, 1) / max(yield_, 0.01))
    return min(max(math.ceil(places_needed / max(per_search, 1)), 1), n_suburbs)


def run(params: dict, on_progress=None, client=None) -> list[dict]:
    meta = get_engine("no_website")
    if client is None:
        from apify_client import ApifyClient
        client = ApifyClient(sw.get_token())

    category = params["category"]
    suburbs = params.get("suburbs") or _default_suburbs()
    per_search = int(params.get("per_search", meta.default_per_search))
    min_reviews = int(params.get("min_reviews", meta.default_min_reviews))
    target = int(params.get("target", 25))
    fetch = bool(params.get("fetch", True))
    maps_dataset_id = params.get("maps_dataset_id")

    max_searches = _searches_for_target(target, per_search, meta.expected_yield, len(suburbs))

    rows = sw.collect_leads(
        client, categories=[category], suburbs=suburbs, per_search=per_search,
        max_searches=max_searches, min_reviews=min_reviews, country="au",
        chunk_size=200, limit=None, fetch=fetch, maps_dataset_id=maps_dataset_id,
        on_progress=on_progress)

    leads = []
    for r in rows:
        leads.append(lead_template(
            engine="no_website",
            business_name=r["business_name"], category=r["category"],
            suburb=r["suburb"], address=r["address"], phone=r["phone"],
            website=r["website"], web_status=r["web_status"],
            rating=r["rating"], reviews_count=r["reviews_count"],
            google_maps_url=r["google_maps_url"], place_id=r.get("place_id"),
            extra={"lead_tag": r.get("lead_tag", ""),
                   "google_search_url": r.get("google_search_url", "")},
        ))
    return leads
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_engine_no_website.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/engines tests/test_engine_no_website.py
git commit -m "feat: pluggable engine registry + no_website wrapper"
```

---

## Phase 4 — Cost estimator

### Task 4.1: estimate(engine_key, params)

**Files:**
- Create: `app/cost.py`
- Test: `tests/test_cost.py`

**Interfaces:**
- Consumes: `registry.get_engine`, `no_website._searches_for_target`, `no_website._default_suburbs`.
- Produces: `estimate(engine_key: str, params: dict) -> dict` →
  `{"places": int, "searches": int, "cost_low": float, "cost_high": float, "cost_expected": float}`.

- [ ] **Step 1: Write the failing test**

Create `tests/test_cost.py`:
```python
from app import cost

def test_estimate_scales_with_target():
    small = cost.estimate("no_website", {"category": "cafe", "target": 10,
                                         "per_search": 5, "suburbs": ["A", "B", "C", "D"]})
    big = cost.estimate("no_website", {"category": "cafe", "target": 40,
                                       "per_search": 5, "suburbs": ["A", "B", "C", "D"]})
    assert big["cost_expected"] >= small["cost_expected"]
    assert small["cost_low"] <= small["cost_expected"] <= small["cost_high"]
    assert small["places"] > 0

def test_estimate_unknown_engine_raises():
    import pytest
    with pytest.raises(KeyError):
        cost.estimate("nope", {})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_cost.py -v`
Expected: FAIL (`ModuleNotFoundError`).

- [ ] **Step 3: Implement `app/cost.py`**

```python
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_cost.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/cost.py tests/test_cost.py
git commit -m "feat: run cost estimator"
```

---

## Phase 5 — Persistence (store)

### Task 5.1: run + lead persistence and lead querying

**Files:**
- Create: `app/store.py`
- Test: `tests/test_store.py` (expand)

**Interfaces:**
- Consumes: `app.db`.
- Produces (all take a `conn`):
  - `create_run(conn, engine, params: dict, status, cost_estimate) -> int`
  - `update_run(conn, run_id, **fields) -> None` (whitelisted columns)
  - `get_run(conn, run_id) -> dict | None`
  - `list_runs(conn, limit=50) -> list[dict]`
  - `insert_leads(conn, run_id, engine, leads: list[dict]) -> int` (serializes `extra` to JSON)
  - `query_leads(conn, *, engine=None, category=None, web_status=None, suburb=None, q=None, sort="reviews_count", page=1, page_size=50) -> dict` → `{"items": [...], "total": int, "page": int, "page_size": int}` (each item has `extra` parsed back to dict)
  - `lead_stats(conn) -> dict` → `{"total": int, "by_engine": {engine: count}, "by_web_status": {...}}`

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_store.py`:
```python
import json
from app import db, store, normalize

def _conn(tmp_path):
    c = db.connect(str(tmp_path / "s.db")); db.init_db(c); return c

def test_create_and_get_run(tmp_path):
    c = _conn(tmp_path)
    rid = store.create_run(c, "no_website", {"category": "cafe"}, "running", 0.4)
    run = store.get_run(c, rid)
    assert run["engine"] == "no_website" and run["status"] == "running"
    assert run["cost_estimate"] == 0.4

def test_update_run_whitelist(tmp_path):
    c = _conn(tmp_path)
    rid = store.create_run(c, "no_website", {}, "running", 0.0)
    store.update_run(c, rid, status="done", leads_found=3, places_scraped=10)
    run = store.get_run(c, rid)
    assert run["status"] == "done" and run["leads_found"] == 3

def test_insert_and_query_leads(tmp_path):
    c = _conn(tmp_path)
    rid = store.create_run(c, "no_website", {}, "done", 0.0)
    leads = [
        normalize.lead_template(engine="no_website", business_name="Mr Baxter",
            category="Cafe", web_status="none", reviews_count=69, suburb="Footscray",
            extra={"lead_tag": "Hot"}),
        normalize.lead_template(engine="no_website", business_name="Nails Co",
            category="Nail salon", web_status="broken", reviews_count=10, suburb="Carlton"),
    ]
    n = store.insert_leads(c, rid, "no_website", leads)
    assert n == 2
    res = store.query_leads(c, web_status="none")
    assert res["total"] == 1 and res["items"][0]["business_name"] == "Mr Baxter"
    assert res["items"][0]["extra"] == {"lead_tag": "Hot"}
    res2 = store.query_leads(c, q="nail")
    assert res2["total"] == 1 and res2["items"][0]["business_name"] == "Nails Co"

def test_lead_stats(tmp_path):
    c = _conn(tmp_path)
    rid = store.create_run(c, "no_website", {}, "done", 0.0)
    store.insert_leads(c, rid, "no_website", [
        normalize.lead_template(engine="no_website", web_status="none"),
        normalize.lead_template(engine="no_website", web_status="broken"),
    ])
    stats = store.lead_stats(c)
    assert stats["total"] == 2
    assert stats["by_engine"]["no_website"] == 2
    assert stats["by_web_status"]["none"] == 1
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_store.py -v`
Expected: FAIL (`ModuleNotFoundError: app.store`).

- [ ] **Step 3: Implement `app/store.py`**

```python
"""Persistence: runs and leads."""
from __future__ import annotations

import json
import sqlite3

_RUN_UPDATABLE = {
    "status", "cost_estimate", "cost_actual", "apify_run_id",
    "places_scraped", "leads_found", "error", "started_at", "finished_at",
}
_SORTABLE = {"reviews_count", "rating", "business_name", "created_at"}


def create_run(conn, engine, params: dict, status: str, cost_estimate: float) -> int:
    cur = conn.execute(
        "INSERT INTO runs (engine, params, status, cost_estimate) VALUES (?,?,?,?)",
        (engine, json.dumps(params), status, cost_estimate))
    conn.commit()
    return cur.lastrowid


def update_run(conn, run_id: int, **fields) -> None:
    cols = {k: v for k, v in fields.items() if k in _RUN_UPDATABLE}
    if not cols:
        return
    sets = ", ".join(f"{k}=?" for k in cols)
    conn.execute(f"UPDATE runs SET {sets} WHERE id=?", (*cols.values(), run_id))
    conn.commit()


def _run_to_dict(row: sqlite3.Row) -> dict:
    d = dict(row)
    d["params"] = json.loads(d.get("params") or "{}")
    return d


def get_run(conn, run_id: int) -> dict | None:
    row = conn.execute("SELECT * FROM runs WHERE id=?", (run_id,)).fetchone()
    return _run_to_dict(row) if row else None


def list_runs(conn, limit: int = 50) -> list[dict]:
    rows = conn.execute(
        "SELECT * FROM runs ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
    return [_run_to_dict(r) for r in rows]


def insert_leads(conn, run_id: int, engine: str, leads: list[dict]) -> int:
    rows = [(
        run_id, engine, l.get("business_name", ""), l.get("category", ""),
        l.get("suburb", ""), l.get("address", ""), l.get("phone", ""),
        l.get("email", ""), l.get("website", ""), l.get("web_status", ""),
        l.get("rating"), l.get("reviews_count"), l.get("google_maps_url", ""),
        l.get("place_id"), json.dumps(l.get("extra") or {}),
    ) for l in leads]
    conn.executemany(
        """INSERT INTO leads (run_id, engine, business_name, category, suburb,
           address, phone, email, website, web_status, rating, reviews_count,
           google_maps_url, place_id, extra)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""", rows)
    conn.commit()
    return len(rows)


def _lead_to_dict(row: sqlite3.Row) -> dict:
    d = dict(row)
    d["extra"] = json.loads(d.get("extra") or "{}")
    return d


def query_leads(conn, *, engine=None, category=None, web_status=None,
                suburb=None, q=None, sort="reviews_count",
                page=1, page_size=50) -> dict:
    where, args = [], []
    for col, val in (("engine", engine), ("category", category),
                     ("web_status", web_status), ("suburb", suburb)):
        if val:
            where.append(f"{col}=?"); args.append(val)
    if q:
        where.append("business_name LIKE ?"); args.append(f"%{q}%")
    clause = ("WHERE " + " AND ".join(where)) if where else ""
    sort_col = sort if sort in _SORTABLE else "reviews_count"
    order = f"ORDER BY {sort_col} IS NULL, {sort_col} DESC" \
        if sort_col != "business_name" else "ORDER BY business_name ASC"
    total = conn.execute(f"SELECT COUNT(*) c FROM leads {clause}", args).fetchone()["c"]
    page = max(1, int(page)); page_size = max(1, min(int(page_size), 200))
    rows = conn.execute(
        f"SELECT * FROM leads {clause} {order} LIMIT ? OFFSET ?",
        (*args, page_size, (page - 1) * page_size)).fetchall()
    return {"items": [_lead_to_dict(r) for r in rows], "total": total,
            "page": page, "page_size": page_size}


def lead_stats(conn) -> dict:
    total = conn.execute("SELECT COUNT(*) c FROM leads").fetchone()["c"]
    by_engine = {r["engine"]: r["c"] for r in conn.execute(
        "SELECT engine, COUNT(*) c FROM leads GROUP BY engine")}
    by_status = {r["web_status"]: r["c"] for r in conn.execute(
        "SELECT web_status, COUNT(*) c FROM leads GROUP BY web_status")}
    return {"total": total, "by_engine": by_engine, "by_web_status": by_status}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_store.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/store.py tests/test_store.py
git commit -m "feat: run/lead persistence + lead querying & stats"
```

---

## Phase 6 — Apify client wrapper & worker

### Task 6.1: ApifyRunner wrapper

**Files:**
- Create: `app/apify.py`
- Test: covered indirectly by worker tests (no separate unit test — it's a thin pass-through over apify-client; mock at the engine boundary).

**Interfaces:**
- Produces: `make_client() -> ApifyClient` (uses `settings.apify_token`; raises `RuntimeError` with a clear message if missing).

- [ ] **Step 1: Implement `app/apify.py`**

```python
"""Apify client construction with a clear error when unconfigured."""
from __future__ import annotations

from app.config import settings


def make_client():
    if not settings.apify_token:
        raise RuntimeError(
            "APIFY_TOKEN is not set — add it to the environment to launch runs.")
    from apify_client import ApifyClient
    return ApifyClient(settings.apify_token)
```

- [ ] **Step 2: Commit**

```bash
git add app/apify.py
git commit -m "feat: apify client factory"
```

### Task 6.2: Worker run executor

**Files:**
- Create: `app/worker.py`
- Test: `tests/test_worker.py`

**Interfaces:**
- Consumes: `store`, `engines.registry`, `engines.no_website`, `apify.make_client`, `normalize.dedupe_leads`.
- Produces:
  - `execute_run(conn, run_id, *, client=None) -> None` — synchronous executor: sets `running`→`classifying`→`done`/`failed`, calls the engine, dedupes, inserts leads, updates counts. Engine resolved from the run's `engine`.
  - `ENGINE_RUNNERS: dict[str, callable]` mapping engine key → `run` function (pluggable).
  - `launch_run_async(run_id) -> None` — schedules `execute_run` on a thread with its own connection (used by the API).

- [ ] **Step 1: Write the failing test**

Create `tests/test_worker.py`:
```python
from app import db, store, worker

def _conn(tmp_path):
    c = db.connect(str(tmp_path / "w.db")); db.init_db(c); return c

def test_execute_run_success(tmp_path, monkeypatch):
    c = _conn(tmp_path)
    rid = store.create_run(c, "no_website", {"category": "cafe", "target": 5}, "running", 0.1)
    fake_leads = [
        {"engine": "no_website", "business_name": "A", "place_id": "p1",
         "web_status": "none", "extra": {}},
        {"engine": "no_website", "business_name": "B", "place_id": "p1",  # dup
         "web_status": "none", "extra": {}},
    ]
    monkeypatch.setitem(worker.ENGINE_RUNNERS, "no_website",
                        lambda params, on_progress=None, client=None: fake_leads)
    worker.execute_run(c, rid, client="ignored")
    run = store.get_run(c, rid)
    assert run["status"] == "done"
    assert run["leads_found"] == 1  # deduped
    assert store.query_leads(c)["total"] == 1

def test_execute_run_failure_records_error(tmp_path, monkeypatch):
    c = _conn(tmp_path)
    rid = store.create_run(c, "no_website", {"category": "cafe"}, "running", 0.1)
    def boom(params, on_progress=None, client=None):
        raise RuntimeError("apify down")
    monkeypatch.setitem(worker.ENGINE_RUNNERS, "no_website", boom)
    worker.execute_run(c, rid, client="ignored")
    run = store.get_run(c, rid)
    assert run["status"] == "failed" and "apify down" in run["error"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_worker.py -v`
Expected: FAIL (`ModuleNotFoundError: app.worker`).

- [ ] **Step 3: Implement `app/worker.py`**

```python
"""Background run executor: drives an engine and persists its leads."""
from __future__ import annotations

import threading

from app import db, store
from app.apify import make_client
from app.engines import no_website
from app.normalize import dedupe_leads

ENGINE_RUNNERS = {
    "no_website": no_website.run,
}


def execute_run(conn, run_id: int, *, client=None) -> None:
    run = store.get_run(conn, run_id)
    if not run:
        return
    runner = ENGINE_RUNNERS.get(run["engine"])
    if runner is None:
        store.update_run(conn, run_id, status="failed",
                         error=f"unknown engine {run['engine']}",
                         finished_at=_now(conn))
        return
    store.update_run(conn, run_id, status="running", started_at=_now(conn))
    try:
        scraped = {"n": 0}

        def on_progress(ev):
            scraped["n"] = ev.get("places_scraped", scraped["n"])
            store.update_run(conn, run_id, places_scraped=scraped["n"],
                             status="classifying" if ev.get("stage") == "classify" else "running")

        leads = runner(run["params"], on_progress=on_progress, client=client)
        leads = dedupe_leads(leads)
        store.insert_leads(conn, run_id, run["engine"], leads)
        store.update_run(conn, run_id, status="done", leads_found=len(leads),
                         places_scraped=scraped["n"], finished_at=_now(conn))
    except Exception as exc:  # noqa: BLE001 — surface any failure to the UI
        store.update_run(conn, run_id, status="failed", error=str(exc),
                         finished_at=_now(conn))


def _now(conn) -> str:
    return conn.execute("SELECT datetime('now') t").fetchone()["t"]


def launch_run_async(run_id: int) -> None:
    def _job():
        conn = db.connect()
        try:
            client = None
            try:
                client = make_client()
            except RuntimeError:
                client = None  # execute_run will fail clearly via the engine
            execute_run(conn, run_id, client=client)
        finally:
            conn.close()
    threading.Thread(target=_job, daemon=True).start()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_worker.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/worker.py tests/test_worker.py
git commit -m "feat: background run executor with dedupe + error capture"
```

---

## Phase 7 — Auth

### Task 7.1: password check + session dependency

**Files:**
- Create: `app/auth.py`
- Test: folded into `tests/test_api.py` (Phase 8) — auth has no logic worth a separate cycle beyond the API gate.

**Interfaces:**
- Consumes: `settings.app_password`.
- Produces:
  - `check_password(candidate: str) -> bool` — constant-time compare; if `APP_PASSWORD` unset, returns `True` (open mode) — but `main` logs a warning.
  - `require_auth(request)` — FastAPI dependency; raises `HTTPException(401)` if `request.session.get("authed")` is falsy AND a password is configured.

- [ ] **Step 1: Implement `app/auth.py`**

```python
"""Single shared-password auth via signed-cookie session."""
from __future__ import annotations

import hmac

from fastapi import HTTPException, Request

from app.config import settings


def password_required() -> bool:
    return bool(settings.app_password)


def check_password(candidate: str) -> bool:
    if not password_required():
        return True
    return hmac.compare_digest(candidate or "", settings.app_password)


def require_auth(request: Request) -> None:
    if not password_required():
        return
    if not request.session.get("authed"):
        raise HTTPException(status_code=401, detail="Not authenticated")
```

- [ ] **Step 2: Commit**

```bash
git add app/auth.py
git commit -m "feat: shared-password auth + session guard"
```

---

## Phase 8 — API routers & app assembly

### Task 8.1: routers + FastAPI app

**Files:**
- Create: `app/routers/__init__.py`, `app/routers/auth.py`, `app/routers/engines.py`, `app/routers/runs.py`, `app/routers/leads.py`, `app/main.py`
- Test: `tests/test_api.py`

**Interfaces:**
- Consumes: everything above.
- Produces an ASGI app `app.main.app` with routes from the spec's API surface. Routers use a `get_conn` dependency returning a per-request connection.

- [ ] **Step 1: Write the failing tests**

Create `tests/test_api.py`:
```python
import os
import pytest
from fastapi.testclient import TestClient

@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("DB_PATH", str(tmp_path / "api.db"))
    monkeypatch.setenv("APP_PASSWORD", "secret")
    monkeypatch.setenv("SESSION_SECRET", "test-secret")
    # reload config + modules that captured settings at import
    import importlib
    import app.config, app.db, app.engines.registry, app.cost, app.store, app.worker, app.main
    for m in (app.config, app.db, app.engines.registry, app.cost, app.store, app.worker, app.main):
        importlib.reload(m)
    return TestClient(app.main.app)

def test_requires_auth(client):
    assert client.get("/api/leads").status_code == 401

def test_login_then_engines(client):
    assert client.post("/api/auth/login", json={"password": "wrong"}).status_code == 401
    assert client.post("/api/auth/login", json={"password": "secret"}).status_code == 200
    r = client.get("/api/engines")
    assert r.status_code == 200
    assert any(e["key"] == "no_website" for e in r.json())

def test_estimate(client):
    client.post("/api/auth/login", json={"password": "secret"})
    r = client.post("/api/runs/estimate",
                    json={"engine": "no_website",
                          "params": {"category": "cafe", "target": 20}})
    assert r.status_code == 200
    body = r.json()
    assert body["places"] > 0 and body["cost_expected"] >= 0

def test_create_run_schedules_worker(client, monkeypatch):
    client.post("/api/auth/login", json={"password": "secret"})
    import app.routers.runs as runs_router
    called = {}
    monkeypatch.setattr(runs_router.worker, "launch_run_async",
                        lambda rid: called.setdefault("rid", rid))
    r = client.post("/api/runs",
                    json={"engine": "no_website",
                          "params": {"category": "cafe", "target": 20},
                          "confirmed_estimate": 0.4})
    assert r.status_code == 201
    rid = r.json()["run_id"]
    assert called["rid"] == rid
    assert client.get(f"/api/runs/{rid}").json()["engine"] == "no_website"

def test_leads_filter_and_export(client):
    client.post("/api/auth/login", json={"password": "secret"})
    # seed via store directly
    import app.db, app.store, app.normalize
    conn = app.db.connect()
    rid = app.store.create_run(conn, "no_website", {}, "imported", 0.0)
    app.store.insert_leads(conn, rid, "no_website", [
        app.normalize.lead_template(engine="no_website", business_name="Mr Baxter",
            category="Cafe", web_status="none", reviews_count=69)])
    r = client.get("/api/leads?web_status=none")
    assert r.json()["total"] == 1
    csv_resp = client.get("/api/leads/export.csv?web_status=none")
    assert csv_resp.status_code == 200
    assert "Mr Baxter" in csv_resp.text
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_api.py -v`
Expected: FAIL (`ModuleNotFoundError: app.main`).

- [ ] **Step 3: Implement routers**

Create `app/routers/__init__.py` (empty).

Create `app/routers/auth.py`:
```python
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app import auth

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginBody(BaseModel):
    password: str


@router.post("/login")
def login(body: LoginBody, request: Request):
    if not auth.check_password(body.password):
        raise HTTPException(status_code=401, detail="Wrong password")
    request.session["authed"] = True
    return {"ok": True}


@router.post("/logout")
def logout(request: Request):
    request.session.clear()
    return {"ok": True}


@router.get("/me")
def me(request: Request):
    return {"authed": bool(request.session.get("authed")) or not auth.password_required(),
            "password_required": auth.password_required()}
```

Create `app/routers/engines.py`:
```python
from dataclasses import asdict
from fastapi import APIRouter, Depends

from app.auth import require_auth
from app.engines.registry import ENGINES

router = APIRouter(prefix="/api/engines", tags=["engines"], dependencies=[Depends(require_auth)])


@router.get("")
def list_engines():
    return [asdict(m) for m in ENGINES.values()]
```

Create `app/routers/runs.py`:
```python
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app import cost, store, worker
from app.auth import require_auth
from app.db import connect
from app.engines.registry import ENGINES

router = APIRouter(prefix="/api/runs", tags=["runs"], dependencies=[Depends(require_auth)])


def get_conn():
    conn = connect()
    try:
        yield conn
    finally:
        conn.close()


class EstimateBody(BaseModel):
    engine: str
    params: dict


class CreateRunBody(BaseModel):
    engine: str
    params: dict
    confirmed_estimate: float


@router.post("/estimate")
def estimate(body: EstimateBody):
    if body.engine not in ENGINES:
        raise HTTPException(404, "Unknown engine")
    return cost.estimate(body.engine, body.params)


@router.post("", status_code=201)
def create_run(body: CreateRunBody, conn=Depends(get_conn)):
    if body.engine not in ENGINES:
        raise HTTPException(404, "Unknown engine")
    rid = store.create_run(conn, body.engine, body.params, "running",
                           body.confirmed_estimate)
    worker.launch_run_async(rid)
    return {"run_id": rid}


@router.get("")
def list_runs(conn=Depends(get_conn)):
    return store.list_runs(conn)


@router.get("/{run_id}")
def get_run(run_id: int, conn=Depends(get_conn)):
    run = store.get_run(conn, run_id)
    if not run:
        raise HTTPException(404, "No such run")
    return run
```

Create `app/routers/leads.py`:
```python
import csv
import io

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse

from app import store
from app.auth import require_auth
from app.db import connect

router = APIRouter(prefix="/api/leads", tags=["leads"], dependencies=[Depends(require_auth)])

_CSV_COLS = ["business_name", "category", "web_status", "rating", "reviews_count",
             "phone", "website", "suburb", "address", "google_maps_url"]


def get_conn():
    conn = connect()
    try:
        yield conn
    finally:
        conn.close()


def _filters(engine, category, web_status, suburb, q, sort):
    return dict(engine=engine, category=category, web_status=web_status,
                suburb=suburb, q=q, sort=sort)


@router.get("")
def list_leads(conn=Depends(get_conn), engine: str | None = None,
               category: str | None = None, web_status: str | None = None,
               suburb: str | None = None, q: str | None = None,
               sort: str = "reviews_count", page: int = 1, page_size: int = 50):
    return store.query_leads(conn, **_filters(engine, category, web_status, suburb, q, sort),
                             page=page, page_size=page_size)


@router.get("/stats")
def stats(conn=Depends(get_conn)):
    return store.lead_stats(conn)


@router.get("/export.csv")
def export_csv(conn=Depends(get_conn), engine: str | None = None,
               category: str | None = None, web_status: str | None = None,
               suburb: str | None = None, q: str | None = None,
               sort: str = "reviews_count"):
    res = store.query_leads(conn, **_filters(engine, category, web_status, suburb, q, sort),
                            page=1, page_size=200)
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=_CSV_COLS, extrasaction="ignore")
    writer.writeheader()
    for item in res["items"]:
        writer.writerow(item)
    buf.seek(0)
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=leads.csv"})
```

- [ ] **Step 4: Implement `app/main.py`**

```python
"""FastAPI app assembly: middleware, routers, static SPA, startup."""
from __future__ import annotations

import logging
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from starlette.middleware.sessions import SessionMiddleware

from app import auth, db, ingest
from app.config import settings
from app.routers import auth as auth_router
from app.routers import engines as engines_router
from app.routers import leads as leads_router
from app.routers import runs as runs_router

log = logging.getLogger("lead_gen")
app = FastAPI(title="Lead-Gen Dashboard")
app.add_middleware(SessionMiddleware, secret_key=settings.session_secret,
                   same_site="lax", https_only=False)

app.include_router(auth_router.router)
app.include_router(engines_router.router)
app.include_router(runs_router.router)
app.include_router(leads_router.router)


@app.on_event("startup")
def _startup():
    conn = db.connect()
    try:
        db.init_db(conn)
        ingest.ingest_existing(conn)
    finally:
        conn.close()
    if not auth.password_required():
        log.warning("APP_PASSWORD not set — dashboard is OPEN (no login).")


@app.get("/api/health")
def health():
    return {"ok": True}


# --- Static SPA (built React) -------------------------------------------------
_DIST = Path(__file__).resolve().parent.parent / "web" / "dist"
if _DIST.exists():
    app.mount("/assets", StaticFiles(directory=_DIST / "assets"), name="assets")

    @app.get("/{full_path:path}")
    def spa(full_path: str):
        candidate = _DIST / full_path
        if full_path and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(_DIST / "index.html")
```

(Note: `ingest.ingest_existing` is implemented in Phase 9; create a temporary no-op `app/ingest.py` with `def ingest_existing(conn): pass` now so imports resolve, then flesh it out in Phase 9.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `.venv/bin/pytest tests/test_api.py -v`
Expected: PASS (all five tests).

- [ ] **Step 6: Commit**

```bash
git add app/routers app/main.py app/ingest.py tests/test_api.py
git commit -m "feat: API routers + FastAPI app assembly + static SPA mount"
```

---

## Phase 9 — CSV ingest of existing output

### Task 9.1: import existing no-website CSV on first boot

**Files:**
- Modify: `app/ingest.py`
- Test: `tests/test_ingest.py`

**Interfaces:**
- Consumes: `store`, `normalize`.
- Produces: `ingest_existing(conn, output_dir="output") -> int` — if `leads` table is empty, read `melbourne_no_website_leads.csv` (if present), map rows → unified leads (engine `no_website`, parse `place_id` from `google_maps_url`), insert under one run with status `imported`. Returns number imported. No-op (returns 0) if leads already present.

- [ ] **Step 1: Write the failing test**

Create `tests/test_ingest.py`:
```python
from pathlib import Path
from app import db, ingest, store

CSV = ("business_name,category,web_status,lead_tag,rating,reviews_count,phone,"
       "website,suburb,address,google_maps_url,google_search_url\n"
       "Mr Baxter,Cafe,none,Hot,4.6,69,,,"
       "Footscray,\"1 X St, Footscray VIC\","
       "https://www.google.com/maps/search/?api=1&query=Mr&query_place_id=ChIJabc,"
       "https://www.google.com/search?q=Mr\n")

def test_ingest_imports_csv_once(tmp_path):
    out = tmp_path / "output"; out.mkdir()
    (out / "melbourne_no_website_leads.csv").write_text(CSV, encoding="utf-8")
    conn = db.connect(str(tmp_path / "i.db")); db.init_db(conn)
    n = ingest.ingest_existing(conn, output_dir=str(out))
    assert n == 1
    res = store.query_leads(conn)
    assert res["total"] == 1
    lead = res["items"][0]
    assert lead["business_name"] == "Mr Baxter"
    assert lead["place_id"] == "ChIJabc"
    # second call is a no-op (already populated)
    assert ingest.ingest_existing(conn, output_dir=str(out)) == 0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_ingest.py -v`
Expected: FAIL (no-op `ingest_existing` returns None / asserts fail).

- [ ] **Step 3: Implement `app/ingest.py`**

```python
"""One-time import of existing CSV output into SQLite."""
from __future__ import annotations

import csv
from pathlib import Path

from app import store
from app.normalize import lead_template, parse_place_id

_NO_WEBSITE_CSV = "melbourne_no_website_leads.csv"


def _to_num(v, cast):
    try:
        return cast(v)
    except (TypeError, ValueError):
        return None


def ingest_existing(conn, output_dir: str = "output") -> int:
    if conn.execute("SELECT COUNT(*) c FROM leads").fetchone()["c"] > 0:
        return 0
    path = Path(output_dir) / _NO_WEBSITE_CSV
    if not path.exists():
        return 0
    leads = []
    with path.open(encoding="utf-8") as f:
        for row in csv.DictReader(f):
            url = row.get("google_maps_url", "")
            leads.append(lead_template(
                engine="no_website",
                business_name=row.get("business_name", ""),
                category=row.get("category", ""),
                suburb=row.get("suburb", ""),
                address=row.get("address", ""),
                phone=row.get("phone", ""),
                website=row.get("website", ""),
                web_status=row.get("web_status", ""),
                rating=_to_num(row.get("rating"), float),
                reviews_count=_to_num(row.get("reviews_count"), int),
                google_maps_url=url,
                place_id=parse_place_id(url),
                extra={"lead_tag": row.get("lead_tag", ""),
                       "google_search_url": row.get("google_search_url", "")},
            ))
    if not leads:
        return 0
    rid = store.create_run(conn, "no_website",
                           {"source": _NO_WEBSITE_CSV}, "imported", 0.0)
    store.insert_leads(conn, rid, "no_website", leads)
    store.update_run(conn, rid, leads_found=len(leads))
    return len(leads)
```

- [ ] **Step 4: Run tests to verify they pass (and API tests still green)**

Run: `.venv/bin/pytest tests/test_ingest.py tests/test_api.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/ingest.py tests/test_ingest.py
git commit -m "feat: import existing no-website CSV on first boot"
```

### Task 9.2: Full backend regression

- [ ] **Step 1: Run the whole suite**

Run: `.venv/bin/pytest -q`
Expected: all tests pass (config, db/store, normalize, cost, engine, worker, api, ingest, plus pre-existing web_presence + scrape_no_website tests).

- [ ] **Step 2: Smoke-run the server**

Run: `APP_PASSWORD=dev .venv/bin/uvicorn app.main:app --port 8000 &` then `curl -s localhost:8000/api/health`
Expected: `{"ok":true}`. Then `curl -s -X POST localhost:8000/api/auth/login -H 'content-type: application/json' -d '{"password":"dev"}'` returns ok, and `curl` of `/api/leads` (with the returned cookie) returns the imported leads. Kill the server afterward.

- [ ] **Step 3: Commit (if any fixups were needed)**

```bash
git commit -am "test: backend regression green + server smoke" || true
```

---

## Phase 10 — Frontend scaffold

### Task 10.1: Vite + React + TS + Tailwind + Query + Router

**Files:**
- Create: `web/package.json`, `web/vite.config.ts`, `web/tsconfig.json`, `web/index.html`, `web/tailwind.config.js`, `web/postcss.config.js`, `web/src/main.tsx`, `web/src/index.css`, `web/src/App.tsx`, `web/src/api.ts`, `web/src/auth.tsx`

**Interfaces:**
- Produces a dev server (`npm run dev` in `web/`) proxying `/api` to `:8000`, and `npm run build` emitting `web/dist`.
- `api.ts` produces typed helpers: `getEngines()`, `getStats()`, `estimateRun(engine, params)`, `createRun(engine, params, confirmed)`, `listRuns()`, `getRun(id)`, `listLeads(filters)`, `login(pw)`, `getMe()`, `exportCsvUrl(filters)`.

- [ ] **Step 1: Scaffold the app**

Run:
```bash
cd web && npm create vite@latest . -- --template react-ts && npm install
npm install @tanstack/react-query react-router-dom
npm install -D tailwindcss@^3 postcss autoprefixer && npx tailwindcss init -p
```
Expected: `web/` populated, deps installed.

- [ ] **Step 2: Configure Tailwind**

`web/tailwind.config.js`:
```js
/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: { extend: {} },
  plugins: [],
}
```
`web/src/index.css` (top of file):
```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

- [ ] **Step 3: Vite proxy + relative base**

`web/vite.config.ts`:
```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "/",
  server: { proxy: { "/api": "http://localhost:8000" } },
});
```

- [ ] **Step 4: API client**

`web/src/api.ts`:
```ts
export type Engine = {
  key: string; name: string; description: string; how_it_works: string;
  icp_fit: string; cost_per_place: number; expected_yield: number;
};
export type Lead = {
  id: number; engine: string; business_name: string; category: string;
  suburb: string; address: string; phone: string; website: string;
  web_status: string; rating: number | null; reviews_count: number | null;
  google_maps_url: string; extra: Record<string, string>;
};
export type Run = {
  id: number; engine: string; status: string; cost_estimate: number | null;
  leads_found: number; places_scraped: number; error: string | null;
  params: Record<string, unknown>; created_at: string;
};
export type Estimate = {
  places: number; searches: number; cost_low: number;
  cost_expected: number; cost_high: number;
};

async function j<T>(r: Response): Promise<T> {
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || r.statusText);
  return r.json();
}
const opts = (method: string, body?: unknown): RequestInit => ({
  method, credentials: "include",
  headers: { "content-type": "application/json" },
  body: body ? JSON.stringify(body) : undefined,
});

export const getMe = () => fetch("/api/auth/me", { credentials: "include" }).then(j<{authed: boolean; password_required: boolean}>);
export const login = (password: string) => fetch("/api/auth/login", opts("POST", { password })).then(j<{ok: boolean}>);
export const getEngines = () => fetch("/api/engines", { credentials: "include" }).then(j<Engine[]>);
export const getStats = () => fetch("/api/leads/stats", { credentials: "include" }).then(j<{total: number; by_engine: Record<string, number>; by_web_status: Record<string, number>}>);
export const estimateRun = (engine: string, params: Record<string, unknown>) => fetch("/api/runs/estimate", opts("POST", { engine, params })).then(j<Estimate>);
export const createRun = (engine: string, params: Record<string, unknown>, confirmed_estimate: number) => fetch("/api/runs", opts("POST", { engine, params, confirmed_estimate })).then(j<{run_id: number}>);
export const listRuns = () => fetch("/api/runs", { credentials: "include" }).then(j<Run[]>);
export const getRun = (id: number) => fetch(`/api/runs/${id}`, { credentials: "include" }).then(j<Run>);
export function leadQuery(f: Record<string, string | undefined>): string {
  const p = new URLSearchParams();
  Object.entries(f).forEach(([k, v]) => { if (v) p.set(k, v); });
  return p.toString();
}
export const listLeads = (f: Record<string, string | undefined>) => fetch(`/api/leads?${leadQuery(f)}`, { credentials: "include" }).then(j<{items: Lead[]; total: number; page: number; page_size: number}>);
export const exportCsvUrl = (f: Record<string, string | undefined>) => `/api/leads/export.csv?${leadQuery(f)}`;
```

- [ ] **Step 5: Auth context + guard**

`web/src/auth.tsx`:
```tsx
import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { getMe } from "./api";

type AuthState = { authed: boolean; loading: boolean; setAuthed: (v: boolean) => void };
const Ctx = createContext<AuthState>({ authed: false, loading: true, setAuthed: () => {} });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authed, setAuthed] = useState(false);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    getMe().then((m) => setAuthed(m.authed)).catch(() => setAuthed(false)).finally(() => setLoading(false));
  }, []);
  return <Ctx.Provider value={{ authed, loading, setAuthed }}>{children}</Ctx.Provider>;
}
export const useAuth = () => useContext(Ctx);
```

- [ ] **Step 6: App shell + routing + query client**

`web/src/main.tsx`:
```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "./auth";
import App from "./App";
import "./index.css";

const qc = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false } } });
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
);
```

`web/src/App.tsx`:
```tsx
import { NavLink, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Runs from "./pages/Runs";
import Leads from "./pages/Leads";
import Engines from "./pages/Engines";

const tabs = [["/", "Dashboard"], ["/leads", "Leads"], ["/runs", "Runs"], ["/engines", "Engines"]] as const;

export default function App() {
  const { authed, loading } = useAuth();
  if (loading) return <div className="p-8 text-slate-500">Loading…</div>;
  if (!authed) return <Login />;
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b bg-white">
        <nav className="mx-auto flex max-w-6xl gap-1 px-4">
          <span className="py-4 pr-6 font-semibold">Lead-Gen</span>
          {tabs.map(([to, label]) => (
            <NavLink key={to} to={to} end={to === "/"}
              className={({ isActive }) =>
                `px-4 py-4 text-sm ${isActive ? "border-b-2 border-slate-900 font-medium" : "text-slate-500"}`}>
              {label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-6xl p-4">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/leads" element={<Leads />} />
          <Route path="/runs" element={<Runs />} />
          <Route path="/engines" element={<Engines />} />
        </Routes>
      </main>
    </div>
  );
}
```

- [ ] **Step 7: Verify build works (pages stubbed next task)**

Create placeholder pages so it compiles: `web/src/pages/{Login,Dashboard,Runs,Leads,Engines}.tsx`, each:
```tsx
export default function Page() { return <div>TODO</div>; }
```
Run: `cd web && npm run build`
Expected: build succeeds, emits `web/dist`.

- [ ] **Step 8: Commit**

```bash
git add web/package.json web/vite.config.ts web/tsconfig*.json web/index.html web/tailwind.config.js web/postcss.config.js web/src
echo "web/node_modules/" >> .gitignore; echo "web/dist/" >> .gitignore
git add .gitignore
git commit -m "feat: frontend scaffold (vite+react+ts+tailwind+query+router)"
```

---

## Phase 11 — Frontend pages

### Task 11.1: Login page

**Files:**
- Modify: `web/src/pages/Login.tsx`

**Interfaces:**
- Consumes: `api.login`, `useAuth`.

- [ ] **Step 1: Implement Login**

```tsx
import { useState } from "react";
import { login } from "../api";
import { useAuth } from "../auth";

export default function Login() {
  const { setAuthed } = useAuth();
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try { await login(pw); setAuthed(true); }
    catch { setErr("Wrong password"); }
  }
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <form onSubmit={submit} className="w-80 rounded-xl border bg-white p-6 shadow-sm">
        <h1 className="mb-4 text-lg font-semibold">Lead-Gen Dashboard</h1>
        <input type="password" value={pw} onChange={(e) => setPw(e.target.value)}
          placeholder="Password" autoFocus
          className="mb-3 w-full rounded-lg border px-3 py-2" />
        {err && <p className="mb-3 text-sm text-red-600">{err}</p>}
        <button className="w-full rounded-lg bg-slate-900 py-2 text-white">Sign in</button>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `cd web && npm run build`
Expected: success.

- [ ] **Step 3: Commit**

```bash
git add web/src/pages/Login.tsx && git commit -m "feat: login page"
```

### Task 11.2: Dashboard (stats + engine cards + New Run modal)

**Files:**
- Modify: `web/src/pages/Dashboard.tsx`
- Create: `web/src/components/StatCard.tsx`, `web/src/components/EngineCard.tsx`, `web/src/components/NewRunModal.tsx`

**Interfaces:**
- Consumes: `getStats`, `getEngines`, `estimateRun`, `createRun`.

- [ ] **Step 1: StatCard + EngineCard**

`web/src/components/StatCard.tsx`:
```tsx
export default function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border bg-white p-4">
      <div className="text-2xl font-semibold">{value}</div>
      <div className="text-sm text-slate-500">{label}</div>
    </div>
  );
}
```
`web/src/components/EngineCard.tsx`:
```tsx
import { Engine } from "../api";
export default function EngineCard({ engine, onRun }: { engine: Engine; onRun: () => void }) {
  return (
    <div className="rounded-xl border bg-white p-5">
      <h3 className="font-semibold">{engine.name}</h3>
      <p className="mt-1 text-sm text-slate-600">{engine.description}</p>
      <button onClick={onRun}
        className="mt-4 rounded-lg bg-slate-900 px-4 py-2 text-sm text-white">
        Run this engine
      </button>
    </div>
  );
}
```

- [ ] **Step 2: NewRunModal (category + target → estimate → confirm)**

`web/src/components/NewRunModal.tsx`:
```tsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Engine, Estimate, estimateRun, createRun } from "../api";

export default function NewRunModal({ engine, onClose }: { engine: Engine; onClose: () => void }) {
  const nav = useNavigate();
  const [category, setCategory] = useState("cafe");
  const [target, setTarget] = useState(25);
  const [est, setEst] = useState<Estimate | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function getEstimate() {
    setBusy(true); setErr("");
    try { setEst(await estimateRun(engine.key, { category, target })); }
    catch (e) { setErr(String(e)); }
    finally { setBusy(false); }
  }
  async function confirm() {
    if (!est) return;
    setBusy(true);
    try {
      const { run_id } = await createRun(engine.key, { category, target }, est.cost_expected);
      onClose(); nav(`/runs?focus=${run_id}`);
    } catch (e) { setErr(String(e)); setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg">
        <h2 className="text-lg font-semibold">{engine.name}</h2>
        <label className="mt-4 block text-sm">Category
          <input value={category} onChange={(e) => { setCategory(e.target.value); setEst(null); }}
            className="mt-1 w-full rounded-lg border px-3 py-2" />
        </label>
        <label className="mt-3 block text-sm">Target leads
          <input type="number" min={1} value={target}
            onChange={(e) => { setTarget(Number(e.target.value)); setEst(null); }}
            className="mt-1 w-full rounded-lg border px-3 py-2" />
        </label>
        {est && (
          <div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm">
            Scrapes ~<b>{est.places}</b> places across <b>{est.searches}</b> suburb searches.
            Estimated cost <b>${est.cost_low}–${est.cost_high}</b> (~${est.cost_expected}).
            <p className="mt-1 text-xs text-slate-500">Best-effort: may return slightly under target.</p>
          </div>
        )}
        {err && <p className="mt-3 text-sm text-red-600">{err}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm">Cancel</button>
          {!est
            ? <button disabled={busy} onClick={getEstimate}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white">Estimate cost</button>
            : <button disabled={busy} onClick={confirm}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm text-white">Confirm &amp; run</button>}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Dashboard page**

`web/src/pages/Dashboard.tsx`:
```tsx
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Engine, getEngines, getStats } from "../api";
import StatCard from "../components/StatCard";
import EngineCard from "../components/EngineCard";
import NewRunModal from "../components/NewRunModal";

export default function Dashboard() {
  const stats = useQuery({ queryKey: ["stats"], queryFn: getStats });
  const engines = useQuery({ queryKey: ["engines"], queryFn: getEngines });
  const [runEngine, setRunEngine] = useState<Engine | null>(null);
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Total leads" value={stats.data?.total ?? "…"} />
        <StatCard label="No website" value={stats.data?.by_web_status?.none ?? 0} />
        <StatCard label="Broken site" value={stats.data?.by_web_status?.broken ?? 0} />
        <StatCard label="Social only" value={stats.data?.by_web_status?.social_only ?? 0} />
      </div>
      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase text-slate-500">Lead engines</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {engines.data?.map((e) => (
            <EngineCard key={e.key} engine={e} onRun={() => setRunEngine(e)} />
          ))}
        </div>
      </div>
      {runEngine && <NewRunModal engine={runEngine} onClose={() => setRunEngine(null)} />}
    </div>
  );
}
```

- [ ] **Step 4: Verify build**

Run: `cd web && npm run build`
Expected: success.

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/Dashboard.tsx web/src/components
git commit -m "feat: dashboard with stats, engine cards, new-run modal"
```

### Task 11.3: Runs page (live polling)

**Files:**
- Modify: `web/src/pages/Runs.tsx`
- Create: `web/src/components/RunStatusBadge.tsx`

**Interfaces:**
- Consumes: `listRuns`. Polls every 2s while any run is active.

- [ ] **Step 1: RunStatusBadge**

```tsx
const COLORS: Record<string, string> = {
  running: "bg-blue-100 text-blue-700", classifying: "bg-indigo-100 text-indigo-700",
  done: "bg-emerald-100 text-emerald-700", failed: "bg-red-100 text-red-700",
  aborted: "bg-amber-100 text-amber-700", imported: "bg-slate-100 text-slate-600",
};
export default function RunStatusBadge({ status }: { status: string }) {
  return <span className={`rounded-full px-2 py-0.5 text-xs ${COLORS[status] ?? "bg-slate-100"}`}>{status}</span>;
}
```

- [ ] **Step 2: Runs page**

```tsx
import { useQuery } from "@tanstack/react-query";
import { listRuns } from "../api";
import RunStatusBadge from "../components/RunStatusBadge";

const ACTIVE = new Set(["running", "classifying"]);

export default function Runs() {
  const runs = useQuery({
    queryKey: ["runs"], queryFn: listRuns,
    refetchInterval: (q) => (q.state.data?.some((r) => ACTIVE.has(r.status)) ? 2000 : false),
  });
  return (
    <table className="w-full overflow-hidden rounded-xl border bg-white text-sm">
      <thead className="bg-slate-50 text-left text-slate-500">
        <tr><th className="p-3">#</th><th>Engine</th><th>Category</th><th>Status</th>
          <th>Leads</th><th>Places</th><th>Est. $</th><th>Created</th></tr>
      </thead>
      <tbody>
        {runs.data?.map((r) => (
          <tr key={r.id} className="border-t">
            <td className="p-3">{r.id}</td><td>{r.engine}</td>
            <td>{String((r.params as any)?.category ?? "—")}</td>
            <td><RunStatusBadge status={r.status} />{r.error && <span className="ml-2 text-xs text-red-600">{r.error}</span>}</td>
            <td>{r.leads_found}</td><td>{r.places_scraped}</td>
            <td>{r.cost_estimate != null ? `$${r.cost_estimate}` : "—"}</td>
            <td className="text-slate-500">{r.created_at}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 3: Verify build + commit**

Run: `cd web && npm run build` (expect success)
```bash
git add web/src/pages/Runs.tsx web/src/components/RunStatusBadge.tsx
git commit -m "feat: runs page with live polling"
```

### Task 11.4: Leads page (filters, search, sort, export, detail drawer)

**Files:**
- Modify: `web/src/pages/Leads.tsx`
- Create: `web/src/components/LeadDrawer.tsx`

**Interfaces:**
- Consumes: `listLeads`, `exportCsvUrl`, `getStats` (for category options optional).

- [ ] **Step 1: LeadDrawer**

```tsx
import { Lead } from "../api";
export default function LeadDrawer({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-10 flex justify-end bg-black/30" onClick={onClose}>
      <div className="h-full w-96 overflow-y-auto bg-white p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold">{lead.business_name}</h2>
        <p className="text-sm text-slate-500">{lead.category} · {lead.suburb}</p>
        <dl className="mt-4 space-y-2 text-sm">
          <div><dt className="text-slate-500">Web status</dt><dd>{lead.web_status} {lead.extra?.lead_tag && `· ${lead.extra.lead_tag}`}</dd></div>
          <div><dt className="text-slate-500">Rating</dt><dd>{lead.rating ?? "—"} ({lead.reviews_count ?? 0} reviews)</dd></div>
          <div><dt className="text-slate-500">Phone</dt><dd>{lead.phone || "—"}</dd></div>
          <div><dt className="text-slate-500">Website</dt><dd>{lead.website || "none"}</dd></div>
          <div><dt className="text-slate-500">Address</dt><dd>{lead.address}</dd></div>
        </dl>
        <div className="mt-4 flex gap-2">
          {lead.google_maps_url && <a href={lead.google_maps_url} target="_blank" className="rounded-lg border px-3 py-1.5 text-sm">Maps ↗</a>}
          {lead.extra?.google_search_url && <a href={lead.extra.google_search_url} target="_blank" className="rounded-lg border px-3 py-1.5 text-sm">Google ↗</a>}
        </div>
        <button onClick={onClose} className="mt-6 text-sm text-slate-500">Close</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Leads page**

```tsx
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Lead, listLeads, exportCsvUrl } from "../api";
import LeadDrawer from "../components/LeadDrawer";

const STATUSES = ["", "none", "social_only", "broken", "not_mobile", "no_https"];

export default function Leads() {
  const [filters, setFilters] = useState<Record<string, string>>({ sort: "reviews_count" });
  const [active, setActive] = useState<Lead | null>(null);
  const leads = useQuery({ queryKey: ["leads", filters], queryFn: () => listLeads(filters) });
  const set = (k: string, v: string) => setFilters((f) => ({ ...f, [k]: v }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input placeholder="Search name…" onChange={(e) => set("q", e.target.value)}
          className="rounded-lg border px-3 py-2 text-sm" />
        <select onChange={(e) => set("web_status", e.target.value)} className="rounded-lg border px-3 py-2 text-sm">
          {STATUSES.map((s) => <option key={s} value={s}>{s || "All statuses"}</option>)}
        </select>
        <input placeholder="Category" onChange={(e) => set("category", e.target.value)}
          className="rounded-lg border px-3 py-2 text-sm" />
        <input placeholder="Suburb" onChange={(e) => set("suburb", e.target.value)}
          className="rounded-lg border px-3 py-2 text-sm" />
        <select onChange={(e) => set("sort", e.target.value)} className="rounded-lg border px-3 py-2 text-sm">
          <option value="reviews_count">Most reviews</option>
          <option value="rating">Highest rating</option>
          <option value="business_name">Name A–Z</option>
        </select>
        <a href={exportCsvUrl(filters)} className="ml-auto rounded-lg bg-slate-900 px-3 py-2 text-sm text-white">Export CSV</a>
      </div>
      <div className="text-sm text-slate-500">{leads.data?.total ?? 0} leads</div>
      <table className="w-full overflow-hidden rounded-xl border bg-white text-sm">
        <thead className="bg-slate-50 text-left text-slate-500">
          <tr><th className="p-3">Business</th><th>Category</th><th>Status</th><th>Rating</th><th>Reviews</th><th>Suburb</th></tr>
        </thead>
        <tbody>
          {leads.data?.items.map((l) => (
            <tr key={l.id} onClick={() => setActive(l)} className="cursor-pointer border-t hover:bg-slate-50">
              <td className="p-3 font-medium">{l.business_name}</td>
              <td>{l.category}</td><td>{l.web_status}</td>
              <td>{l.rating ?? "—"}</td><td>{l.reviews_count ?? 0}</td><td>{l.suburb}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {active && <LeadDrawer lead={active} onClose={() => setActive(null)} />}
    </div>
  );
}
```

- [ ] **Step 3: Verify build + commit**

Run: `cd web && npm run build` (expect success)
```bash
git add web/src/pages/Leads.tsx web/src/components/LeadDrawer.tsx
git commit -m "feat: leads page with filters, search, sort, export, drawer"
```

### Task 11.5: Engines page

**Files:**
- Modify: `web/src/pages/Engines.tsx`

- [ ] **Step 1: Implement**

```tsx
import { useQuery } from "@tanstack/react-query";
import { getEngines } from "../api";

export default function Engines() {
  const engines = useQuery({ queryKey: ["engines"], queryFn: getEngines });
  return (
    <div className="space-y-4">
      {engines.data?.map((e) => (
        <div key={e.key} className="rounded-xl border bg-white p-6">
          <h2 className="text-lg font-semibold">{e.name}</h2>
          <p className="mt-1 text-slate-600">{e.description}</p>
          <h3 className="mt-4 text-sm font-semibold text-slate-500">How it works</h3>
          <p className="text-sm">{e.how_it_works}</p>
          <h3 className="mt-3 text-sm font-semibold text-slate-500">ICP fit</h3>
          <p className="text-sm">{e.icp_fit}</p>
          <p className="mt-3 text-xs text-slate-400">~${e.cost_per_place}/place · expected yield {Math.round(e.expected_yield * 100)}%</p>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Build full app + commit**

Run: `cd web && npm run build` (expect `web/dist` emitted)
```bash
git add web/src/pages/Engines.tsx && git commit -m "feat: engines explainer page"
```

---

## Phase 12 — Integration (serve SPA from FastAPI)

### Task 12.1: End-to-end local verification

- [ ] **Step 1: Build frontend, run backend**

Run:
```bash
cd web && npm run build && cd ..
APP_PASSWORD=dev .venv/bin/uvicorn app.main:app --port 8000
```
Open `http://localhost:8000`, sign in with `dev`.
Expected: dashboard shows the imported no-website leads count; Leads tab lists them, filter by `web_status=none` works, Export CSV downloads.

- [ ] **Step 2: Dry-run an estimate (no spend)**

In New Run modal, enter category `cafe`, target `20`, click **Estimate cost**.
Expected: a places count and `$` range render. (Do NOT confirm unless you want a real Apify charge.)

- [ ] **Step 3: Commit any fixups**

```bash
git commit -am "chore: e2e local verification fixups" || true
```

---

## Phase 13 — Deploy (Railway)

### Task 13.1: Deploy config

**Files:**
- Create: `Procfile`, `railway.json`, `.dockerignore` (optional), README deploy section.

- [ ] **Step 1: Procfile**

`Procfile`:
```
web: uvicorn app.main:app --host 0.0.0.0 --port $PORT
```

- [ ] **Step 2: railway.json (build frontend + install backend)**

`railway.json`:
```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "NIXPACKS",
    "buildCommand": "pip install -r requirements.txt && cd web && npm ci && npm run build"
  },
  "deploy": {
    "startCommand": "uvicorn app.main:app --host 0.0.0.0 --port $PORT",
    "restartPolicyType": "ON_FAILURE"
  }
}
```

- [ ] **Step 3: README deploy section**

Add to `README.md` a "Dashboard" section documenting: required env (`APIFY_TOKEN`, `APP_PASSWORD`, `SESSION_SECRET`, `DB_PATH=/data/leads.db`), the Railway volume mount at `/data`, and `npm run dev` + `uvicorn` for local development.

- [ ] **Step 4: Provision on Railway**

Use the Railway tooling (or dashboard) to: create a project + service from the repo, add a volume mounted at `/data`, set the env vars, and deploy. Verify the public URL serves the login page and `/api/health` returns ok.

- [ ] **Step 5: Commit**

```bash
git add Procfile railway.json README.md
git commit -m "feat: railway deploy config + dashboard docs"
```

---

## Self-Review

**Spec coverage:**
- Live scrape from UI → Phases 6, 8, 11.2. ✓
- Pluggable single-engine registry → Task 3.2. ✓
- Cost estimate + confirm → Task 4.1, 8.1, 11.2. ✓
- Best-effort target → `_searches_for_target` (Task 3.2), modal copy (11.2). ✓
- Unified lead store + ingest existing CSV → Phases 1, 5, 9. ✓
- Dashboard / Runs / Leads / Engines pages → Phase 11. ✓
- Auth (shared password) → Phase 7, 8. ✓
- Deploy (Railway, one service, SQLite volume) → Phase 13. ✓
- Testing (pytest transforms kept; new unit + API tests) → every backend task + Task 9.2. ✓

**Placeholder scan:** Frontend Task 10.1 Step 7 intentionally writes `TODO` stub pages that are each replaced by a named task in Phase 11 (Login 11.1, Dashboard 11.2, Runs 11.3, Leads 11.4, Engines 11.5). No `TODO` survives the plan. `app/ingest.py` no-op in Phase 8 is explicitly fleshed out in Phase 9. No other placeholders.

**Type consistency:** Unified lead keys match across `normalize.lead_template`, `store.insert_leads`, `ingest`, `no_website.run`, and the TS `Lead` type. Run status strings match across `worker`, `store`, `RunStatusBadge`. `estimate` keys (`places, searches, cost_low, cost_expected, cost_high`) match across `cost.py`, the API, and the TS `Estimate` type and modal.

**Note on git:** The repo is not currently a git repository. If left uninitialized, skip every `git ...` step; otherwise run `git init` first so the frequent-commit steps apply.
