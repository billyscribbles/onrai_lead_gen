# Lead-Gen Dashboard — Design

**Date:** 2026-06-28
**Status:** Approved (build authorized)

## Problem
The lead-gen pipelines are CLI scripts that dump CSVs into `output/`. There's no
way to *see* what each pipeline does, browse the leads they found, or generate
more without remembering terminal flags. We want a deployed website that:

- Stores all leads and run outputs in one place.
- Explains what each lead engine does and how to generate more.
- Acts as a dashboard: pick an engine, enter a **category + target lead count**,
  see a **cost estimate**, confirm, and watch it find leads live.

## Decisions (locked)
- **Behavior:** live scrape triggered from the UI (real Apify runs, async).
- **Engines:** the repo now contains only the `no_website` finder (the other two
  pipelines were removed). Build the dashboard around that single engine, but
  keep a **pluggable engine registry** so more engines drop in later with no
  rework.
- **Hosting:** deployed website (Railway), one service.
- **Cost control:** cost estimate shown + explicit confirm before each run (no
  hard cap; the confirmed estimate is the de-facto spend ceiling).
- **Target leads:** best-effort within the confirmed budget — may return slightly
  under target rather than auto-relaunching to chase an exact number.
- **Auth:** single shared password (signed-cookie session). Gates Apify spend.
- **Stack:** FastAPI + SQLite + in-process async worker (reuses existing Python
  pipelines); React (Vite + Tailwind) SPA served as static files by FastAPI.

## Architecture
```
React SPA (Vite + Tailwind)  ──HTTP/JSON──>  FastAPI (single Railway service)
                                              ├─ /api/engines, /runs, /leads, /auth
                                              ├─ in-process background worker (asyncio task)
                                              ├─ engine layer → wraps the 3 scrapers
                                              │                 (reuses pipeline.py, web_presence.py,
                                              │                  maps_match.py UNTOUCHED)
                                              ├─ Apify client → launch actor, poll
                                              └─ SQLite on Railway volume (/data)
```
Apify performs the heavy scraping in its own cloud. Our worker launches the
actor, polls for completion, then runs the light local steps (web_presence
site-fetches, email enrichment) and writes normalized leads to SQLite. Because
the worker is in-process, Railway (long-lived process, not serverless) is the
right host; jobs survive between requests.

## Components

### Backend (`app/`)
- `app/main.py` — FastAPI app, mounts API routers + static React build, auth
  middleware.
- `app/db.py` — SQLite connection/session, schema init, migrations-lite.
- `app/models.py` — `Run` and `Lead` table definitions; `engines` is code config.
- `app/engines/` — engine registry + one wrapper per pipeline:
  - `registry.py` — `ENGINES: dict[str, EngineMeta]` (key, name, description,
    how_it_works, icp_fit, cost_per_place, default params, yield constant). Today
    it holds exactly one entry, `no_website`; adding an engine = adding a module +
    a registry entry, no other code changes.
  - `no_website.py` — exposes `run(params, on_progress) -> list[LeadDict]`. Core
    logic is extracted from `scrape_no_website.py` into a shared callable that both
    this wrapper and the original CLI use, so the CLI keeps working.
- `app/normalize.py` — map each engine's raw row → unified `Lead` shape; parse
  `place_id` from the Google Maps URL for dedupe.
- `app/cost.py` — `estimate(engine, params) -> {places, cost_low, cost_high}`.
- `app/worker.py` — background run executor: state machine
  `awaiting_confirm → running → classifying → done|failed|aborted`; updates `Run`
  and writes `Lead`s; reports progress.
- `app/apify.py` — thin Apify client (launch actor, poll status, fetch dataset);
  reuses existing token loading from `scrape_leads.get_token`.
- `app/ingest.py` — one-time import of the existing CSV(s) in `output/`
  (`melbourne_no_website_leads.csv`) into SQLite as an `imported` run so the
  dashboard isn't empty on first boot.
- `app/auth.py` — password check + signed-cookie session.
- `app/routers/` — `engines.py`, `runs.py`, `leads.py`, `auth.py`.

### Data model (SQLite)
- **`runs`**: `id, engine, params(JSON), status, cost_estimate, cost_actual,
  apify_run_id, places_scraped, leads_found, created_at, started_at,
  finished_at, error`.
- **`leads`**: `id, run_id(fk), engine, business_name, category, suburb, address,
  phone, email, website, web_status, rating, reviews_count, google_maps_url,
  place_id, extra(JSON), created_at`. Engine-specific fields (abn,
  match_confidence, contact_name, trading_names…) live in `extra`. Dedupe on
  `place_id` within scope (keep newest).
- **`engines`**: static code config, not a DB table.

### Frontend (`web/`)
React + Vite + Tailwind + a small data layer (TanStack Query for polling).
Pages:
- **Dashboard** — stat cards (total leads, leads by engine, recent runs) + an
  engine card per registered engine (one today: no-website) with name, one-line
  description, **Run** button.
- **New Run** (modal) — engine select, category input, target count, options →
  **Estimate** → shows projected places + `$` range → **Confirm & run**.
- **Runs** — table, live-polling status/progress/counts/cost, **Abort** button.
- **Leads** — filters (engine, category, web_status, suburb, rating) + text
  search + sort + **Export CSV**; row opens a detail drawer (Maps link, contact).
- **Engines** — long-form description of each pipeline and its ICP fit.

### API surface
```
POST /api/auth/login            {password} -> session cookie
GET  /api/engines               -> registry metadata
POST /api/runs/estimate         {engine, params} -> {places, cost_low, cost_high}
POST /api/runs                  {engine, params, confirmed_estimate} -> {run_id}
GET  /api/runs                  -> list (newest first)
GET  /api/runs/{id}             -> run detail (for polling)
POST /api/runs/{id}/abort       -> abort a running job
GET  /api/leads?engine&category&web_status&suburb&q&sort&page -> page of leads
GET  /api/leads/export.csv?<same filters>  -> CSV download
```

## Run lifecycle
1. User picks engine + category + target count.
2. `POST /runs/estimate`: `places_needed ≈ target ÷ engine.yield`; cost =
   `places_needed × cost_per_place` (+ enrichment where relevant). Returns a
   low/high range.
3. User confirms → `POST /runs` creates a `Run` (status `running`) and schedules
   the worker. The confirmed estimate is the spend ceiling (`max-results`).
4. Worker: launch Apify actor → poll → on dataset ready, normalize + classify
   (web_presence fetch / enrichment) → dedupe → write `Lead`s → status `done`.
5. Frontend polls `GET /runs/{id}` for live status and final counts.

## Error handling
- Apify launch/poll failure → `Run.status=failed`, `error` populated, surfaced in
  UI; no partial leads committed for that run unless the dataset was fetched.
- Apify wind-down hang (known issue) → worker aborts the actor once the dataset
  item count plateaus past the budget and classifies what was collected.
- Auth: unauthenticated `/api/*` (except login) → 401; SPA redirects to login.
- Missing `APIFY_TOKEN` → estimate works, run start returns a clear error.

## Testing
- Keep existing `pytest` transform tests green.
- New unit tests: cost estimator; lead normalization + `place_id` parse + dedupe;
  each engine wrapper with the Apify client mocked; CSV ingest.
- API tests via FastAPI `TestClient` (auth gate, estimate, run create with mocked
  worker, leads filter/sort/export).
- Frontend: minimal — component smoke tests optional; rely on manual + API tests.

## Deploy
- Railway, one service + persistent volume mounted at `/data` for SQLite.
- Build: `vite build` → FastAPI serves `web/dist`.
- Env: `APIFY_TOKEN`, `APP_PASSWORD`, `DB_PATH=/data/leads.db`.
- First boot runs CSV ingest if the DB is empty.

## Out of scope (YAGNI)
- Multi-user accounts / roles. Single shared password only.
- Auto-relaunch to hit an exact lead count.
- Editing/CRM features on leads (status, notes) — could be a later milestone.
- Real-time websockets — polling is sufficient.
