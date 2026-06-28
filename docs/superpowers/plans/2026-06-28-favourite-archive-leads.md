# Favourite / Archive Leads Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the operator mark each lead as `favourite` (keep working) or `archived` (done, hidden from the default view), persisted server-side in SQLite.

**Architecture:** A single `user_status` column on the `leads` table holds one of three mutually-exclusive states (`normal` / `favourite` / `archived`). A new `PATCH /api/leads/{id}` endpoint sets it. The React dashboard threads the real DB id through, adds a filter-bucket selector (Active / Favourites / Archived) and star + archive toggles on each row and in the drawer, updating optimistically.

**Tech Stack:** Python 3 / FastAPI / SQLite (backend, `pytest`); React 19 + TypeScript + Vite (frontend, no test runner — verified with `npm run build`).

## Global Constraints

- State values are exactly `'normal' | 'favourite' | 'archived'` — verbatim, lowercase. `'normal'` is the default.
- States are **mutually exclusive**: one column, never two flags.
- Re-scrape upsert (`store.insert_leads`) must **never** reset `user_status`.
- Backend: follow existing patterns — inline `_SCHEMA` + ad-hoc `_migrate()` in `app/db.py`; pure/testable logic in `app/store.py`; thin routers.
- Frontend: same-origin `fetch` with `credentials: 'include'`; inline stroke icons in `Icons.tsx` (no new deps); existing CSS tokens (`--amber`, `--muted`, `--line`, `--surface`).
- Each backend task is TDD (`pytest -q`). Frontend tasks verify with `cd web && npm run build` (runs `tsc -b`).

---

### Task 1: `user_status` column + `store.set_lead_status`

**Files:**
- Modify: `app/db.py` (`_SCHEMA` leads table ~line 27-46; `_migrate` ~line 83-93)
- Modify: `app/store.py` (add `set_lead_status`; `_lead_to_dict` already passes the column through via `dict(row)`)
- Test: `tests/test_store.py`

**Interfaces:**
- Produces: `store.set_lead_status(conn, lead_id: int, status: str) -> dict | None` — updates the row's `user_status`, returns the updated lead dict (same shape as `_lead_to_dict`) or `None` if no lead with that id exists. Raises `ValueError` if `status` not in `{'normal','favourite','archived'}`.
- Produces: every lead dict from `query_leads` / `all_leads` / `set_lead_status` now carries a `user_status` key.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_store.py`:

```python
# --- user_status: favourite / archive --------------------------------------

import pytest


def test_new_lead_defaults_to_normal_status(tmp_path):
    conn = _db(tmp_path)
    r = store.create_run(conn, "no_website", {}, "done", 0.0)
    store.insert_leads(conn, r, "no_website", [_lead()])
    assert store.all_leads(conn, "no_website")[0]["user_status"] == "normal"


def test_set_lead_status_updates_and_returns_lead(tmp_path):
    conn = _db(tmp_path)
    r = store.create_run(conn, "no_website", {}, "done", 0.0)
    store.insert_leads(conn, r, "no_website", [_lead()])
    lead_id = store.all_leads(conn, "no_website")[0]["id"]

    updated = store.set_lead_status(conn, lead_id, "favourite")
    assert updated["user_status"] == "favourite"
    assert store.all_leads(conn, "no_website")[0]["user_status"] == "favourite"


def test_set_lead_status_rejects_unknown_value(tmp_path):
    conn = _db(tmp_path)
    r = store.create_run(conn, "no_website", {}, "done", 0.0)
    store.insert_leads(conn, r, "no_website", [_lead()])
    lead_id = store.all_leads(conn, "no_website")[0]["id"]
    with pytest.raises(ValueError):
        store.set_lead_status(conn, lead_id, "starred")


def test_set_lead_status_returns_none_for_missing_lead(tmp_path):
    conn = _db(tmp_path)
    assert store.set_lead_status(conn, 999, "favourite") is None


def test_upsert_preserves_user_status(tmp_path):
    # Re-scraping the same business must NOT wipe a star/archive.
    conn = _db(tmp_path)
    r1 = store.create_run(conn, "no_website", {}, "done", 0.0)
    store.insert_leads(conn, r1, "no_website", [_lead(reviews_count=69)])
    lead_id = store.all_leads(conn, "no_website")[0]["id"]
    store.set_lead_status(conn, lead_id, "favourite")

    r2 = store.create_run(conn, "no_website", {}, "done", 0.0)
    store.insert_leads(conn, r2, "no_website", [_lead(reviews_count=80)])  # re-scrape

    refreshed = store.all_leads(conn, "no_website")[0]
    assert refreshed["reviews_count"] == 80          # data refreshed
    assert refreshed["user_status"] == "favourite"   # status preserved
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_store.py -k "user_status or upsert_preserves" -v`
Expected: FAIL — `set_lead_status` doesn't exist / `KeyError: 'user_status'`.

- [ ] **Step 3: Add the column to the schema**

In `app/db.py`, in the `leads` table inside `_SCHEMA`, add the column right after `extra TEXT NOT NULL DEFAULT '{}',` (line ~44):

```python
    extra TEXT NOT NULL DEFAULT '{}',
    user_status TEXT NOT NULL DEFAULT 'normal',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
```

- [ ] **Step 4: Add the migration for existing DBs**

In `app/db.py` `_migrate()`, after the `dedup_key` block and before `_backfill_dedup_keys(conn)` (i.e. inside the function, using the already-fetched `lead_cols`), add:

```python
    if "user_status" not in lead_cols:
        conn.execute(
            "ALTER TABLE leads ADD COLUMN user_status TEXT NOT NULL "
            "DEFAULT 'normal'")
```

- [ ] **Step 5: Add `set_lead_status` to the store**

In `app/store.py`, after `_lead_to_dict` (line ~117) add:

```python
_USER_STATUSES = {"normal", "favourite", "archived"}


def set_lead_status(conn, lead_id: int, status: str) -> dict | None:
    """Set a lead's user_status (normal/favourite/archived).

    Returns the updated lead dict, or None if no lead has that id.
    Raises ValueError for an unknown status.
    """
    if status not in _USER_STATUSES:
        raise ValueError(f"invalid user_status: {status!r}")
    cur = conn.execute(
        "UPDATE leads SET user_status=? WHERE id=?", (status, lead_id))
    conn.commit()
    if cur.rowcount == 0:
        return None
    row = conn.execute("SELECT * FROM leads WHERE id=?", (lead_id,)).fetchone()
    return _lead_to_dict(row) if row else None
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pytest tests/test_store.py -v`
Expected: PASS (all existing + new tests). The upsert-preservation test passes because `insert_leads`' `ON CONFLICT DO UPDATE SET` does not list `user_status`.

- [ ] **Step 7: Commit**

```bash
git add app/db.py app/store.py tests/test_store.py
git commit -m "feat(app): user_status column + set_lead_status store fn

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `PATCH /api/leads/{id}` endpoint

**Files:**
- Modify: `app/routers/leads.py`

**Interfaces:**
- Consumes: `store.set_lead_status` (Task 1).
- Produces: `PATCH /api/leads/{lead_id}` with JSON body `{"user_status": "favourite"|"archived"|"normal"}`. Returns the updated lead JSON on success; `400` for an invalid status; `404` if the lead doesn't exist. Auth-gated like the rest of the router.

- [ ] **Step 1: Add the request model and route**

In `app/routers/leads.py`, update the imports at the top:

```python
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
```

(Keep the existing `from fastapi.responses import StreamingResponse` and other imports.)

Then add, after the `export_csv` route (end of file):

```python
class StatusUpdate(BaseModel):
    user_status: str


@router.patch("/{lead_id}")
def update_lead_status(lead_id: int, body: StatusUpdate, conn=Depends(get_conn)):
    try:
        lead = store.set_lead_status(conn, lead_id, body.user_status)
    except ValueError:
        raise HTTPException(status_code=400, detail="invalid user_status")
    if lead is None:
        raise HTTPException(status_code=404, detail="lead not found")
    return lead
```

- [ ] **Step 2: Verify it wires up (import check)**

Run: `python -c "from app.main import app; print([r.path for r in app.routes if getattr(r, 'path', '').startswith('/api/leads')])"`
Expected: output includes `/api/leads/{lead_id}` alongside the existing `/api/leads` routes (no import errors).

- [ ] **Step 3: Manual endpoint smoke test (with the server running)**

Start the API (`uvicorn app.main:app --port 8000`, with `APP_PASSWORD` unset for local), then in another shell — assumes at least one lead with id `1` exists:

```bash
curl -s -X PATCH localhost:8000/api/leads/1 \
  -H 'content-type: application/json' -d '{"user_status":"favourite"}'
# Expect: JSON of the lead with "user_status":"favourite"

curl -s -o /dev/null -w '%{http_code}\n' -X PATCH localhost:8000/api/leads/1 \
  -H 'content-type: application/json' -d '{"user_status":"bogus"}'
# Expect: 400

curl -s -o /dev/null -w '%{http_code}\n' -X PATCH localhost:8000/api/leads/999999 \
  -H 'content-type: application/json' -d '{"user_status":"normal"}'
# Expect: 404
```

(If running locally isn't convenient, the route-presence check in Step 2 plus the Task 1 store tests cover the logic; note in the commit that the curl check was deferred.)

- [ ] **Step 4: Commit**

```bash
git add app/routers/leads.py
git commit -m "feat(app): PATCH /api/leads/{id} to set favourite/archive status

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Frontend — carry DB id + userStatus, add API client fn

**Files:**
- Modify: `web/src/types.ts`
- Modify: `web/src/lib/api.ts`
- Modify: `web/src/lib/leads.ts`

**Interfaces:**
- Produces: `UserStatus` type = `'normal' | 'favourite' | 'archived'`.
- Produces: `Lead.dbId: number` and `Lead.userStatus: UserStatus`.
- Produces: `ApiLead.user_status: string` (field returned by the backend).
- Produces: `patchLeadStatus(id: number, status: UserStatus): Promise<ApiLead>` in `api.ts`.

- [ ] **Step 1: Add the `UserStatus` type and extend `Lead`**

In `web/src/types.ts`, after the `WebStatus` type (line 1) add:

```typescript
export type UserStatus = 'normal' | 'favourite' | 'archived'
```

Then inside `interface Lead`, after `id: string` (line 28) add:

```typescript
  /** Real SQLite primary key — needed to PATCH this lead. */
  dbId: number
  userStatus: UserStatus
```

- [ ] **Step 2: Add `user_status` to `ApiLead` and the patch client fn**

In `web/src/lib/api.ts`, inside `interface ApiLead`, after `extra: Record<string, string>` (line 55) add:

```typescript
  user_status: string
```

Then after `fetchLeads()` (line 86) add:

```typescript
import type { UserStatus } from '../types'

export function patchLeadStatus(
  id: number,
  status: UserStatus,
): Promise<ApiLead> {
  return fetch(`/api/leads/${id}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ user_status: status }),
  }).then(json<ApiLead>)
}
```

Note: move the `import type { UserStatus } from '../types'` to the top of the file with the other imports (api.ts currently has no top imports — add it as the first line).

- [ ] **Step 3: Thread id + status through the transform**

In `web/src/lib/leads.ts`:

Change the imports (line 1-2) to:

```typescript
import { fetchLeads, type ApiLead } from './api'
import type { Lead, RawLead, SocialPlatform, UserStatus } from '../types'
```

Change the `toLead` signature (line 49) and its return object to accept and set the new fields:

```typescript
function toLead(
  raw: Record<string, string>,
  index: number,
  dbId: number,
  userStatus: UserStatus,
): Lead {
```

In the returned object (after `id: \`${r.business_name}-${index}\`,` line 57) add:

```typescript
    dbId,
    userStatus,
```

Update `loadLeads` (line 97-101) to pass them from the API item:

```typescript
export async function loadLeads(): Promise<Lead[]> {
  const { items } = await fetchLeads()
  const leads = items.map((item, i) =>
    toLead(apiLeadToRaw(item), i, item.id, normalizeStatus(item.user_status)),
  )
  return sortLeads(leads)
}

function normalizeStatus(s: string | undefined): UserStatus {
  return s === 'favourite' || s === 'archived' ? s : 'normal'
}
```

- [ ] **Step 4: Verify it compiles**

Run: `cd web && npm run build`
Expected: build succeeds (TypeScript happy). If it reports `dbId`/`userStatus` missing anywhere, you haven't wired a consumer yet — that's Tasks 4-6; for now only `leads.ts`/`api.ts`/`types.ts` changed and they're self-consistent.

- [ ] **Step 5: Commit**

```bash
git add web/src/types.ts web/src/lib/api.ts web/src/lib/leads.ts
git commit -m "feat(web): carry lead dbId + userStatus, add patchLeadStatus client

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Frontend — optimistic `setLeadStatus` in `useLeads`

**Files:**
- Modify: `web/src/hooks/useLeads.ts`

**Interfaces:**
- Consumes: `patchLeadStatus` (Task 3).
- Produces: `useLeads()` return value gains `setLeadStatus: (dbId: number, status: UserStatus) => void` — optimistically updates local state, calls the API, and rolls back on failure (setting `error`).

- [ ] **Step 1: Implement the mutator**

Replace the contents of `web/src/hooks/useLeads.ts` with:

```typescript
import { useCallback, useEffect, useState } from 'react'
import { loadLeads } from '../lib/leads'
import { patchLeadStatus } from '../lib/api'
import type { Lead, UserStatus } from '../types'

interface State {
  leads: Lead[]
  loading: boolean
  error: string | null
  reload: () => void
  setLeadStatus: (dbId: number, status: UserStatus) => void
}

export function useLeads(): State {
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(() => {
    setLoading(true)
    loadLeads()
      .then((next) => {
        setLeads(next)
        setError(null)
      })
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : 'Failed to load leads'),
      )
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  const setLeadStatus = useCallback((dbId: number, status: UserStatus) => {
    let prev: UserStatus | undefined
    setLeads((cur) =>
      cur.map((l) => {
        if (l.dbId !== dbId) return l
        prev = l.userStatus
        return { ...l, userStatus: status }
      }),
    )
    patchLeadStatus(dbId, status).catch((e: unknown) => {
      // Roll back the optimistic change and surface the failure.
      setLeads((cur) =>
        cur.map((l) =>
          l.dbId === dbId && prev !== undefined
            ? { ...l, userStatus: prev }
            : l,
        ),
      )
      setError(e instanceof Error ? e.message : 'Failed to update lead')
    })
  }, [])

  return { leads, loading, error, reload, setLeadStatus }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd web && npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add web/src/hooks/useLeads.ts
git commit -m "feat(web): optimistic setLeadStatus mutator in useLeads

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Frontend — Active / Favourites / Archived bucket filter

**Files:**
- Modify: `web/src/components/FilterRail.tsx` (the `Filters` type lives here)
- Modify: `web/src/components/TableFilters.tsx` (render the bucket chips)
- Modify: `web/src/components/Dashboard.tsx` (default + apply the bucket)
- Modify: `web/src/index.css` (chip styles)

**Interfaces:**
- Produces: `LeadBucket` type = `'active' | 'favourites' | 'archived'`, exported from `FilterRail.tsx`.
- Produces: `Filters.bucket: LeadBucket` (added to the existing `Filters` interface).
- Produces: `Dashboard` filters out archived leads unless the bucket selects them.

- [ ] **Step 1: Extend the `Filters` type**

In `web/src/components/FilterRail.tsx`, after `export type SortKey = ...` (line 5) add:

```typescript
export type LeadBucket = 'active' | 'favourites' | 'archived'
```

Inside `interface Filters` (after `sort: SortKey`, line 13) add:

```typescript
  bucket: LeadBucket
```

- [ ] **Step 2: Default the new field**

In `web/src/components/Dashboard.tsx`, in `DEFAULT_FILTERS` (line 18-25) add `bucket: 'active',`:

```typescript
const DEFAULT_FILTERS: Filters = {
  query: '',
  status: 'all',
  category: '',
  suburb: '',
  phoneOnly: false,
  sort: 'hot',
  bucket: 'active',
}
```

- [ ] **Step 3: Apply the bucket in `visible`**

In `web/src/components/Dashboard.tsx`, add a helper next to `matchesStatus` (after line 33):

```typescript
function matchesBucket(lead: Lead, bucket: Filters['bucket']): boolean {
  if (bucket === 'favourites') return lead.userStatus === 'favourite'
  if (bucket === 'archived') return lead.userStatus === 'archived'
  return lead.userStatus !== 'archived' // 'active': normal + favourite
}
```

Then in the `visible` filter (inside `leads.filter`, after the `matchesStatus` guard, line 90) add as the first check:

```typescript
      if (!matchesBucket(l, filters.bucket)) return false
```

- [ ] **Step 4: Render the bucket chips**

In `web/src/components/TableFilters.tsx`, import the type and add a counts-free segmented control. Change the import line 1 to:

```typescript
import type { Filters, LeadBucket } from './FilterRail'
```

Add this constant above the component (after the imports):

```typescript
const BUCKETS: { key: LeadBucket; label: string }[] = [
  { key: 'active', label: 'Active' },
  { key: 'favourites', label: 'Favourites' },
  { key: 'archived', label: 'Archived' },
]
```

Then inside the returned `<div className="tablebar" ...>`, as the **first** child (before the Search `<label>`, line 17), add:

```tsx
      <div className="tablebar__buckets" role="group" aria-label="Lead bucket">
        {BUCKETS.map((b) => (
          <button
            key={b.key}
            type="button"
            className={`bucket ${filters.bucket === b.key ? 'is-active' : ''}`}
            onClick={() => onChange({ bucket: b.key })}
            aria-pressed={filters.bucket === b.key}
          >
            {b.label}
          </button>
        ))}
      </div>
```

- [ ] **Step 5: Add chip styles**

Append to `web/src/index.css`:

```css
/* Lead bucket chips (Active / Favourites / Archived) */
.tablebar__buckets {
  display: inline-flex;
  gap: 4px;
  padding: 3px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--paper-alt);
}
.bucket {
  border: 0;
  background: transparent;
  color: var(--muted);
  padding: 5px 12px;
  border-radius: 7px;
  font-size: 0.82rem;
  font-weight: 600;
  transition: all 0.13s;
}
.bucket:hover {
  color: var(--ink);
}
.bucket.is-active {
  background: var(--surface);
  color: var(--ink);
  box-shadow: 0 1px 2px rgba(24, 24, 27, 0.08);
}
```

- [ ] **Step 6: Verify it compiles**

Run: `cd web && npm run build`
Expected: build succeeds.

- [ ] **Step 7: Commit**

```bash
git add web/src/components/FilterRail.tsx web/src/components/TableFilters.tsx web/src/components/Dashboard.tsx web/src/index.css
git commit -m "feat(web): Active/Favourites/Archived bucket filter on lead sheet

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Frontend — star + archive toggles on row and drawer

**Files:**
- Modify: `web/src/components/Icons.tsx` (add `Archive` icon)
- Modify: `web/src/components/LeadRow.tsx`
- Modify: `web/src/components/LeadDrawer.tsx`
- Modify: `web/src/components/Dashboard.tsx` (pass `setLeadStatus` down)
- Modify: `web/src/index.css` (active-state icon styling)

**Interfaces:**
- Consumes: `useLeads().setLeadStatus` (Task 4), `Lead.userStatus`/`Lead.dbId` (Task 3).
- Produces: `LeadRow` and `LeadDrawer` accept `onSetStatus: (dbId: number, status: UserStatus) => void`.

- [ ] **Step 1: Add the `Archive` icon**

In `web/src/components/Icons.tsx`, after the `Close` icon (line ~60) add:

```tsx
export const Archive = ({ className }: P) => (
  <svg {...base} className={className} aria-hidden="true">
    <rect x="3" y="4" width="18" height="4" rx="1" />
    <path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8" />
    <path d="M10 12h4" />
  </svg>
)
```

- [ ] **Step 2: Add the toggles to `LeadRow`**

In `web/src/components/LeadRow.tsx`:

Change the imports (line 1-3) to:

```typescript
import type { Lead, UserStatus } from '../types'
import { compact, platformLabel, telHref } from '../lib/format'
import { Archive, MapPin, Phone, Search, SocialIcon, Star } from './Icons'
```

Change the `Props` interface (line 5-9) to add the callback:

```typescript
interface Props {
  lead: Lead
  rank: number
  onSelect: (lead: Lead) => void
  onSetStatus: (dbId: number, status: UserStatus) => void
}
```

Change the destructure (line 11) to `export function LeadRow({ lead, rank, onSelect, onSetStatus }: Props) {`.

In the `<div className="row__actions" ...>` block (line 73), add these two buttons as the **first** children (before the phone `<a>`):

```tsx
        <button
          type="button"
          className={`iconbtn ${lead.userStatus === 'favourite' ? 'is-fav' : ''}`}
          title={lead.userStatus === 'favourite' ? 'Unfavourite' : 'Favourite'}
          aria-pressed={lead.userStatus === 'favourite'}
          aria-label="Favourite lead"
          onClick={() =>
            onSetStatus(
              lead.dbId,
              lead.userStatus === 'favourite' ? 'normal' : 'favourite',
            )
          }
        >
          <Star />
        </button>
        <button
          type="button"
          className={`iconbtn ${lead.userStatus === 'archived' ? 'is-arch' : ''}`}
          title={lead.userStatus === 'archived' ? 'Unarchive' : 'Archive'}
          aria-pressed={lead.userStatus === 'archived'}
          aria-label="Archive lead"
          onClick={() =>
            onSetStatus(
              lead.dbId,
              lead.userStatus === 'archived' ? 'normal' : 'archived',
            )
          }
        >
          <Archive />
        </button>
```

(The wrapping `row__actions` div already calls `e.stopPropagation()`, so these clicks won't open the drawer.)

- [ ] **Step 3: Pass the callback from `Dashboard` to `LeadRow`**

In `web/src/components/Dashboard.tsx`:

Pull `setLeadStatus` from the hook (line 51):

```typescript
  const { leads, loading, error, reload, setLeadStatus } = useLeads()
```

In the `visible.map(...)` render (line 199-206), add the prop:

```tsx
                <LeadRow
                  key={lead.id}
                  lead={lead}
                  rank={i + 1}
                  onSelect={setActive}
                  onSetStatus={setLeadStatus}
                />
```

- [ ] **Step 4: Add the toggles to `LeadDrawer` and wire `active` to live state**

In `web/src/components/LeadDrawer.tsx`:

Change imports (line 1-3) to:

```typescript
import type { Lead, UserStatus } from '../types'
import { compact, platformLabel, telHref } from '../lib/format'
import { Archive, Close, MapPin, Phone, Search, SocialIcon, Star } from './Icons'
```

Change `Props` (line 5-8) to:

```typescript
interface Props {
  lead: Lead | null
  onClose: () => void
  onSetStatus: (dbId: number, status: UserStatus) => void
}
```

Change the destructure (line 10) to `export function LeadDrawer({ lead, onClose, onSetStatus }: Props) {`.

Inside the `{lead && (...)}` block, right after the close button (after line 28), add a status toolbar:

```tsx
            <div className="drawer__status">
              <button
                type="button"
                className={`iconbtn ${lead.userStatus === 'favourite' ? 'is-fav' : ''}`}
                aria-pressed={lead.userStatus === 'favourite'}
                onClick={() =>
                  onSetStatus(
                    lead.dbId,
                    lead.userStatus === 'favourite' ? 'normal' : 'favourite',
                  )
                }
              >
                <Star /> {lead.userStatus === 'favourite' ? 'Favourited' : 'Favourite'}
              </button>
              <button
                type="button"
                className={`iconbtn ${lead.userStatus === 'archived' ? 'is-arch' : ''}`}
                aria-pressed={lead.userStatus === 'archived'}
                onClick={() =>
                  onSetStatus(
                    lead.dbId,
                    lead.userStatus === 'archived' ? 'normal' : 'archived',
                  )
                }
              >
                <Archive /> {lead.userStatus === 'archived' ? 'Archived' : 'Archive'}
              </button>
            </div>
```

Now wire the drawer to receive `onSetStatus` and keep showing the live lead. In `web/src/components/Dashboard.tsx`, the drawer renders the `active` snapshot, which goes stale after a status change. Replace the drawer render (line 212) with a version that re-reads the live lead by `dbId`:

```tsx
      <LeadDrawer
        lead={active ? leads.find((l) => l.dbId === active.dbId) ?? active : null}
        onClose={() => setActive(null)}
        onSetStatus={setLeadStatus}
      />
```

- [ ] **Step 5: Add active-state icon styles**

Append to `web/src/index.css`:

```css
/* Favourite / archive toggle states */
.iconbtn.is-fav {
  color: var(--amber);
  border-color: var(--amber);
  background: var(--amber-soft);
}
.iconbtn.is-arch {
  color: var(--ink);
  border-color: var(--muted-2);
  background: var(--paper-alt);
}
/* Drawer status toolbar: buttons sit inline with a label, so let them size to content */
.drawer__status {
  display: flex;
  gap: 8px;
  margin: 4px 0 14px;
}
.drawer__status .iconbtn {
  width: auto;
  gap: 6px;
  padding: 0 12px;
  font-size: 0.84rem;
  font-weight: 600;
}
```

- [ ] **Step 6: Verify it compiles**

Run: `cd web && npm run build`
Expected: build succeeds with no TypeScript errors.

- [ ] **Step 7: Manual click-through (with backend + `npm run dev`)**

1. Star a lead in a row → it gets the amber state; switch the bucket to **Favourites** → it appears there.
2. Archive a lead → it vanishes from **Active**; switch to **Archived** → it's there; unarchive → back in Active.
3. Open the drawer, toggle favourite/archive → row reflects it; favouriting an archived lead moves it out of Archived (mutual exclusivity).
4. Reload the page → states persist (server-backed).

- [ ] **Step 8: Commit**

```bash
git add web/src/components/Icons.tsx web/src/components/LeadRow.tsx web/src/components/LeadDrawer.tsx web/src/components/Dashboard.tsx web/src/index.css
git commit -m "feat(web): star + archive toggles on lead row and drawer

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Notes for the implementer

- **No frontend test runner** exists (`web/package.json` has no `test` script). The compile check `npm run build` (which runs `tsc -b`) is the automated gate; the Task 6 click-through is the behavioural check.
- **Auth in dev:** leave `APP_PASSWORD` unset locally so `require_auth` is a no-op and the PATCH/curl checks work without a session cookie.
- **CSV export** (`/api/leads/export.csv`) uses a fixed `_CSV_COLS` whitelist that does not include `user_status`; leave it as-is (out of scope).
