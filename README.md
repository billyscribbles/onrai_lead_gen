# Melbourne no-website lead finder

Finds **established Melbourne businesses that have a Google Business Profile but no
usable website** — prime prospects for a **website build/redesign** pitch. Think a
busy cafe or barber with thousands of reviews whose Google panel still says "Add
website", or whose only "website" is an Instagram page.

It searches Google Maps directly (via [Apify](https://apify.com)), so leads can be
long-established — newness is not required. The single best lead type is
`social_only`: a business active on social media with **no website**, which has
already proven it invests in being found.

## Setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Set your Apify token (either way works):

```bash
export APIFY_TOKEN=your_token        # add to ~/.zshrc to persist
# or: cp .env.example .env           # then paste your token into .env
```

Get a token at https://console.apify.com/account/integrations

## Usage

```bash
# Reliable run (recommended): no-site + social-only leads, no flaky site fetching
python scrape_no_website.py --no-fetch --max-searches 20 --per-search 5

# Re-classify an earlier Maps run for FREE (no new Apify spend)
python scrape_no_website.py --maps-dataset-id <DATASET_ID> --no-fetch

# Include redesign detection (broken / not-mobile sites) — see caveat below
python scrape_no_website.py --max-searches 20 --per-search 5 --limit 80
```

It sweeps a grid of `category × suburb` searches (`melbourne_categories.txt` ×
`suburbs_melbourne.txt`), dedupes, keeps only established listings (≥ `--min-reviews`
reviews, a real business — not a locality centroid), and classifies each one's web
presence:

| `web_status` | `lead_tag` | Meaning | Reliable? |
|------|------|---------|-----------|
| `social_only` | Hot — no website, strong social | "website" is a Facebook/Instagram/Linktree page | ✅ (no fetch) |
| `none` | Hot — no website | no website on Google at all | ✅ (no fetch) |
| `broken` | Redesign — site not loading | real site didn't load | ⚠️ flaky |
| `not_mobile` | Redesign — not mobile-friendly | site loaded, no mobile viewport | ⚠️ flaky |
| `healthy` | — | loads fine, mobile-ready | dropped |

> **Reliability caveat.** `social_only` and `none` come straight from Google's data
> and are trustworthy. The redesign buckets (`broken`/`not_mobile`) come from a bulk
> local HTTP fetch (`urllib`, no JS) and are **unstable** — sites that block bots,
> render via JavaScript, or simply time out under a rapid sweep get false-flagged
> (the `broken` count has swung 8 → 55 between identical runs). Use `--no-fetch`
> unless you'll eyeball each redesign flag. http-only URLs are fetched and judged,
> so a site Google lists as `http://` that actually serves a fine `https://` page is
> correctly dropped.

Output: `output/melbourne_no_website_leads.csv`, most-reviewed (most-established)
first. Two click-to-open research links per lead: `google_maps_url` (the listing)
and `google_search_url` (a Google search of the name → opens its knowledge panel).
Phone is captured when present but **never required** (Mr Baxter, the canonical
lead, had no phone on Google).

### Flags

| Flag | Default | Purpose |
|------|---------|---------|
| `--categories-file` | `melbourne_categories.txt` | Categories to sweep |
| `--suburbs-file` | `suburbs_melbourne.txt` | Suburbs to sweep |
| `--per-search` | `5` | Max places per `category × suburb` search (cost dial) |
| `--max-searches` | (all) | Cap number of searches (cost dial) |
| `--min-reviews` | `5` | Min reviews to count as "established" |
| `--limit` | (all) | Cap live-site fetches (Tier B) |
| `--no-fetch` | off | Skip Tier B; keep only the reliable no-site/social leads |
| `--maps-dataset-id` | (none) | Reuse a Maps dataset (no new cost) |
| `--output` | `output/melbourne_no_website_leads.csv` | CSV path |

## Cost (Apify free tier)

~$0.005 per place scraped. A capped test (`--max-searches 20 --per-search 5`) is
~100 places ≈ **$0.50**. Re-classifying an existing dataset with `--maps-dataset-id`
is **free**. If the Google Places actor hangs in its wind-down phase (status stays
RUNNING after the dataset item count plateaus), abort it and re-classify the
collected data for free with `--maps-dataset-id <ID>`.

## Architecture

- `web_presence.py` — all pure, unit-tested logic (web-presence classification,
  lead tags, search URLs, suburb parsing, dedupe). No network.
- `scrape_no_website.py` — Apify/HTTP/CSV orchestration + CLI.
- `melbourne_categories.txt`, `suburbs_melbourne.txt` — editable sweep inputs.
- `app/` — FastAPI backend wrapping the scraper as an "engine": runs (with cost
  estimate + confirm), SQLite persistence, password-gated session auth, and it
  serves the built dashboard. See [Dashboard](#dashboard-web-app).
- `web/` — React + Vite dashboard SPA. See [`web/README.md`](web/README.md).

```bash
pytest -q          # unit tests for web_presence.py and scrape_no_website.py
```

## Dashboard (web app)

A browser dashboard (**No-Site Radar**) sits on top of the same scraper: browse,
filter, sort, and export leads, and launch new scrape runs from a button (with a
cost estimate you confirm before any Apify spend). It's a FastAPI backend (`app/`)
serving a React SPA (`web/`); the backend ingests `output/melbourne_no_website_leads.csv`
into SQLite on first boot so the dashboard isn't empty.

Run both halves together from the repo root:

```bash
yarn setup        # one-time: venv + pip install + npm install (web/)
yarn dev          # uvicorn (:8000) + vite (:5173) together
```

Environment variables (see `.env.example`):

| Var | Purpose |
|-----|---------|
| `APIFY_TOKEN` | Required for live scrape runs (the dashboard loads seed leads without it). |
| `APP_PASSWORD` | Shared login password. **If unset, the dashboard is OPEN to anyone with the URL.** |
| `SESSION_SECRET` | Signs the session cookie. Use a long random value in production. |
| `DB_PATH` | SQLite location (default `output/leads.db`); point at a mounted volume in production. |

## Deploy (Railway)

The repo ships a multi-stage `Dockerfile` (Node builds `web/dist` → Python serves
the API + SPA) and a `railway.json` (Dockerfile builder, `/api/health` healthcheck).

1. Create a project and a service, then deploy (e.g. `railway up`, or via the
   dashboard / MCP). Railway builds the `Dockerfile` and binds `$PORT` automatically
   (the container `CMD` expands it — do **not** add a `startCommand` with a literal
   `$PORT` to `railway.json`, Railway won't shell-expand it).
2. Set service variables: `APIFY_TOKEN`, `APP_PASSWORD`, `SESSION_SECRET`.
3. Attach a **volume** (e.g. mounted at `/data`) and set `DB_PATH=/data/leads.db`
   so scraped leads survive redeploys (SQLite on the container filesystem is
   ephemeral and resets on every deploy).
