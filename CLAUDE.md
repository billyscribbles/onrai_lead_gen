# CLAUDE.md — lead_gen

## What we sell
**Website build + redesign only.** Nothing else (no SEO retainers, no ads, no
reputation/review services). Every lead must be judged against that one offer.

## Ideal customer profile (ICP)
The prospect we want is a **fully established local business that has a real
Google Business Profile but NO website.**

Reference example — **Mr Baxter Cafe**, West Footscray VIC (from a plain Google
search, *not* the ASIC list):

- **Established, with traction** — 4.6 stars, 69 Google reviews, set hours, price
  range, order pickup/delivery. This is a real, operating business, NOT a
  brand-new registration.
- **No website** — the Google knowledge panel shows an **"Add website"** prompt,
  i.e. Google holds no website URL for them. That's the pain we solve.
- **Already cares about presence** — active Facebook (220+ followers) and
  Instagram, plus third-party write-ups. They invest in being found; they just
  have no owned site. Warm, not cold.

So the buying signal is: **demonstrated demand + money coming in + an obvious hole
(no site) they clearly care about.** A redesign prospect is the same but with a
weak placeholder standing in for a site (Facebook page, Linktree, parked
Wix/GoDaddy, broken/non-mobile/no-HTTPS site).

### Highest-priority lead (the best of the best)
**Active on multiple social platforms + no website + has a phone.** This is the
strongest signal we can get: heavy social presence proves they care about being
found and already do their own marketing, the missing website is a glaring gap
they'll feel, and the phone makes outreach trivial. Rank these at the very top.

Reference example — **Lavish Barbers**, Melbourne CBD (4.8 stars, 1,493 reviews):
on Facebook, Instagram **and** TikTok, but **no website** (Google lists only their
Instagram), and a phone number on the listing. In our data this surfaces as
`web_status: social_only` **with a non-empty `phone`** — treat that combination as
a top-tier lead. (A bare `none` with no socials is still good, but social-heavy +
phone is hotter: they've already proven they'll invest in their presence.)

**User's stated preference: `social_only` is the best lead type.** Rank it above
`none`. Both are reliable because they come straight from Google's data with no
fetching.

### Reliability: trust `none`/`social_only`, be skeptical of `broken`/`not_mobile`
`none` and `social_only` need no site fetch, so they're stable and trustworthy.
The redesign buckets (`broken`, `not_mobile`) come from a bulk local `urllib`
fetch and are **unreliable** — the `broken` count swung from 8 to 55 across two
identical runs (false positives from timeouts/throttling when many sites are
fetched in sequence; the same sites fetch fine individually). Default to
`--no-fetch` for a clean, stable list. Only use Tier B if you'll manually verify
each redesign flag.

### Good vs. bad lead, at a glance
| Signal | Good prospect | Bad prospect |
|---|---|---|
| Website | none, or a placeholder/broken site | polished, working site |
| Reviews / rating | enough to prove they're a real going concern | n/a as a *negative*; low rating is NOT our pain |
| Age | **irrelevant** — established is fine, even preferred | — |
| Reachable | phone **or** social DM **or** order channel | no channel at all |

## Primary pipeline for this ICP: `scrape_no_website.py`
Built to serve the ICP directly. Google Maps `category × suburb` sweep → keep
established listings whose site is missing/social-only/broken/not-mobile (drops
healthy sites). No ASIC list, no phone gate. Pure logic in the unit-tested
`web_presence.py`; see `README.md` for flags. Reliable buckets: `none`,
`social_only` (no fetch). Lower-confidence: `broken`, `not_mobile` (from a plain
`urllib` fetch — JS/bot-blocking sites can be false-flagged; eyeball before
pitching). http-only URLs are fetched and judged, not auto-flagged.

## Dashboard + backend (`app/`, `web/`)
On top of the CLI there's a **No-Site Radar** web app: a FastAPI backend (`app/`)
that wraps the scraper as a pluggable "engine" (cost estimate → confirm → run →
SQLite), with password-gated session auth, and a React/Vite dashboard (`web/`) it
serves. The backend ingests `output/melbourne_no_website_leads.csv` into SQLite on
first boot. The same good-lead gates live here too (`app/engines/no_website.py`):
`social_only` / `none` are the reliable buckets, fetch defaults **off**.

Deployed on **Railway** (project `onrai_lead_gen`) via a multi-stage `Dockerfile`
(Node builds the SPA → Python serves API + SPA) + `railway.json`. Gotchas that bit
us: Railway does **not** shell-expand a `$PORT` in `railway.json`'s `startCommand`
(let the Dockerfile `CMD` bind it); SQLite needs a mounted volume + `DB_PATH` or it
resets each deploy; set `APP_PASSWORD` or the dashboard is public; `APIFY_TOKEN`
must be set for live runs. See `README.md` for the full deploy steps.

## How to work in this repo
The repo is now focused solely on the no-website goal. Earlier pipelines (a
real-estate low-rating scraper and an ASIC/ABN brand-new-business pipeline) have
been **removed** — don't reintroduce them.

- All pure logic lives in `web_presence.py` and is unit-tested (`pytest -q`):
  classification, lead tags, search URLs, suburb parsing, dedupe. No network.
- `scrape_no_website.py` is the Apify/HTTP/CSV orchestration + CLI (validated by
  real runs). See `README.md` for flags.
- Apify runs cost real money. The Google Places actor
  (`compass/crawler-google-places`) sometimes **hangs in its wind-down phase**
  after scraping — if a run sits at RUNNING long after the dataset item count has
  plateaued, abort it and re-classify the collected data for free with
  `--maps-dataset-id <ID>`.
