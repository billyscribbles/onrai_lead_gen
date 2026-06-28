# Server-side pagination for the leads sheet

**Date:** 2026-06-29
**Status:** Approved, ready for implementation plan

## Problem

The leads table keeps growing. Today the frontend fetches **all** leads in one
request (`GET /api/leads?page_size=500`) and does everything in memory:

- tiering (`tierFor` / `heatFor` in `web/src/lib/leads.ts`)
- the `hot` and `newest` sorts (`sortLeads`, `applySort` in `Dashboard.tsx`)
- every filter — status/bucket/industry/suburb/phone/search (`Dashboard.tsx` `visible`)
- the StatStrip counts and FilterRail counts (`counts`, `StatStrip.tsx`)
- the industry and suburb dropdown options (`industries`, `suburbs` memos)

That breaks down as the dataset grows: every byte crosses the wire and lives in
the browser. We move pagination, filtering, sorting, and facet computation to the
backend so the client only ever holds one page.

The DB already stores everything required. **No schema change.**

## Decisions (locked)

- **Server-side pagination**, not client-side paging or virtualization.
- **Numbered Prev/Next pager** (50 per page), not infinite scroll.
- **Facets are global** — the StatStrip/FilterRail counts and the
  industry/suburb dropdowns reflect the whole pool, not the active filters. This
  preserves today's behaviour and keeps facets to one cheap query set.
- **Run-scoped "new" view fetches a single large page** (`page_size=500`,
  `sort=newest`, `run_id=<id>`) — a single run targets at most a few hundred
  leads, so no pager is needed there.
- **The industry-group regex is duplicated** in TypeScript and Python. Accepted:
  sharing one definition needs a build step this repo doesn't have. Each copy
  carries a comment pointing at the other.

## Backend changes

### 1. `app/industry.py` (new)

Port `web/src/lib/industry.ts` verbatim:

- `GROUPS`: ordered list of `(label, compiled regex)`. Order matters — specific
  groups (food, beauty) before the broad "Retail & shops" catch-all.
- `industry_group(category: str) -> str` — first matching group label, else
  `"Other"`. Empty/blank category → `"Other"`.
- `industry_options(categories: Iterable[str]) -> list[str]` — distinct groups
  present, in canonical `GROUPS` order, `"Other"` last.

Header comment notes the TS counterpart is the mirror and they must stay in sync.

### 2. `app/db.py`

In `connect()`, after creating the connection, register the function so it's
usable in `WHERE` and `GROUP BY`:

```python
from app.industry import industry_group
conn.create_function("industry_group", 1, industry_group, deterministic=True)
```

### 3. `app/store.py` — `query_leads` gains filters + real sorts

Extend the signature (all new params optional, defaults preserve current behaviour):

```python
def query_leads(conn, *, engine=None, status=None, web_status=None,
                industry=None, suburb=None, q=None, bucket=None,
                phone_only=False, run_id=None, sort="reviews_count",
                page=1, page_size=50) -> dict:
```

WHERE construction:

- `engine` → `engine=?` (unchanged)
- `status`:
  - `"top"` → `web_status='social_only' AND TRIM(COALESCE(phone,'')) != ''`
  - `"all"` / `None` → no clause
  - any other value → treated as a `web_status` (e.g. `social_only`, `none`,
    `broken`, `not_mobile`)
  - `web_status` param kept for direct callers / `export.csv` back-compat; if
    both given, `status` wins.
- `industry` → `industry_group(category)=?`
- `suburb` → `suburb=?` (unchanged, exact match)
- `phone_only` truthy → `TRIM(COALESCE(phone,'')) != ''`
- `run_id` → `run_id=?`
- `bucket`:
  - `"active"` → `user_status != 'archived'`
  - `"favourites"` → `user_status = 'favourite'`
  - `"archived"` → `user_status = 'archived'`
  - `None` → no clause
- `q` → `(business_name LIKE ? OR category LIKE ? OR suburb LIKE ?)` with the
  `%q%` arg repeated three times (today: business_name only).

ORDER BY:

- `sort == "hot"` →
  ```sql
  ORDER BY
    CASE
      WHEN web_status='social_only' AND TRIM(COALESCE(phone,''))!='' THEN 1
      WHEN web_status='social_only'                                  THEN 2
      WHEN web_status='none' AND TRIM(COALESCE(phone,''))!=''        THEN 3
      WHEN web_status='none'                                         THEN 4
      ELSE 5
    END ASC,
    reviews_count IS NULL, reviews_count DESC,
    rating IS NULL, rating DESC
  ```
  (mirrors `sortLeads`: tier asc, reviews desc, rating desc)
- `sort == "newest"` → `created_at DESC,` then the same tier/reviews/rating
  tie-breakers (the original heat tie-break is approximated by tier+reviews —
  faithful enough for same-second batches).
- otherwise → existing single-column behaviour (`reviews_count`, `rating`,
  `business_name`, `created_at`) for `export.csv` back-compat.

`total` is the `COUNT(*)` over the same WHERE; `page`/`page_size` clamping
unchanged (page_size capped at 500). Response shape unchanged:
`{items, total, page, page_size}`.

### 4. `app/store.py` — `lead_facets(conn, engine=None)` (new)

Global pool stats for the UI chrome. Respects `engine` only (not the active
refine filters). Returns:

```python
{
  "total": int,
  "top": int,            # web_status='social_only' AND phone present
  "social_only": int,
  "none": int,
  "reachable": int,      # TRIM(phone)!='' OR website LIKE 'http%'
  "industries": [str],   # industry_options order
  "suburbs": [str],      # distinct, sorted, non-empty
}
```

`industries` via `SELECT DISTINCT industry_group(category) ...` then ordered by
`industry_options`, or computed directly in Python from distinct categories —
either is fine as long as the order matches the canonical group order.

### 5. `app/routers/leads.py`

- `list_leads`: add query params `status`, `industry`, `bucket`, `phone_only:
  bool = False`, `run_id: int | None = None`; pass through to `query_leads`.
  Keep `web_status` for back-compat.
- New `GET /api/leads/facets` → `store.lead_facets(conn, engine)`.
- `export.csv`: thread the same new filters through so an export matches what's
  on screen.

## Frontend changes

### 6. `web/src/lib/api.ts`

- `fetchLeads(params: LeadQuery): Promise<{items: ApiLead[]; total: number; page: number; page_size: number}>`
  builds the query string from `{page, page_size, sort, status, bucket,
  industry, suburb, q, phone_only, run_id}`, omitting empty values.
- `fetchFacets(): Promise<Facets>` → `GET /api/leads/facets`.
- `LeadQuery` and `Facets` types added.

### 7. `web/src/lib/leads.ts`

- `loadLeads(params): Promise<{leads: Lead[]; total: number}>` — pass params to
  `fetchLeads`, map items via existing `toLead`/`apiLeadToRaw`, return server
  order (no `sortLeads`).
- `toLead`, `tierFor`, `heatFor`, `socialOf` stay — still used for per-row
  badge/heat rendering.
- `sortLeads` removed (or kept only if still referenced elsewhere — verify).

### 8. `web/src/hooks/useLeads.ts`

Param-driven. State: `leads` (current page), `total`, `page`, `facets`,
`loading`, `error`.

- Accepts the active `filters` and `page` (e.g. `useLeads(filters, page)`), maps
  them to a `LeadQuery`, and refetches the page whenever they change.
- Search input is debounced (~300ms) before triggering a fetch; any filter
  change resets `page` to 1 (page reset owned by `Dashboard`).
- `facets` fetched on mount and on `reload()` (after a run finishes / status
  change), independent of the page query.
- `setLeadStatus` stays optimistic in-place; an archived row lingers on the
  current page until the next fetch. `reload()` refetches page + facets.

### 9. `web/src/components/Dashboard.tsx`

- Remove the in-memory `visible`, `counts`, `industries`, `suburbs` memos.
- Add `page` state; reset to 1 on any `update(...)` filter change.
- `StatStrip` and `FilterRail` counts read from `facets`.
- `TableFilters` dropdowns read `facets.industries` / `facets.suburbs`.
- The leads list renders the fetched page directly; rank is offset-based
  `(page - 1) * page_size + i + 1`.
- Render `<Pager>` below the sheet (hidden when `total <= page_size`).
- **'new' view**: fetch with `{run_id: finishedRun.id, sort: 'newest',
  page_size: 500}` (its own fetch, no pager). Replaces the
  `leads.filter(l => l.runId === ...)` derivation.

### 10. `web/src/components/Pager.tsx` (new)

Props: `page`, `pageSize`, `total`, `onPage(next)`. Renders Prev / "Page X of N"
/ Next, with Prev disabled on page 1 and Next disabled on the last page. Styled
to match the existing sheet chrome.

### 11. `web/src/components/StatStrip.tsx`

Take a facets-metrics object (`{total, top, social_only, none, reachable}`)
instead of `leads: Lead[]`; drop the internal `metrics()` derivation. Click
behaviour (status toggles, phoneOnly) unchanged.

## Tests (`pytest -q`)

- `app/industry.py`: `industry_group` for representative categories across every
  group + `"Other"` + blank; catch-all ordering (e.g. "Coffee shop" → Food, not
  Retail); `industry_options` ordering with `"Other"` last.
- `query_leads`: each new filter (`status='top'`, `bucket`, `industry`,
  `phone_only`, `run_id`, multi-field `q`), both sort orders (`hot`, `newest`),
  and that `total` reflects the filtered count while `items` honour
  `page`/`page_size`.
- `lead_facets`: counts (`top`, `social_only`, `none`, `reachable`) and that
  `industries`/`suburbs` are the distinct, correctly ordered sets.

Use an in-memory / temp SQLite DB seeded with a handful of leads, mirroring the
existing pure-logic test style. No network.

## Out of scope

- No schema/migration changes.
- No change to run generation, auth, or the Apify engine.
- Facets remain global; making them track the active filters is a future option,
  not part of this work.
