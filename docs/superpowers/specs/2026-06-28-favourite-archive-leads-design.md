# Favourite / Archive leads — design

**Date:** 2026-06-28
**Status:** Approved (pending spec review)

## Goal
Let the user mark leads they want to keep working on (**favourite**) and leads
they're done with (**archived**, hidden from the default view). State persists
server-side so it survives device switches and re-scrapes.

## Decisions
- **Persistence:** server-side, SQLite.
- **List view:** archived hidden by default; filter chips switch the view.
- **Controls:** star + archive on both the lead row and the lead drawer.
- **States are mutually exclusive:** a lead is in exactly one of
  `normal` / `favourite` / `archived` → modelled as a single column, not two
  booleans.

## 1. Data model
Add one column to the `leads` table:

```
user_status TEXT DEFAULT 'normal'   -- 'normal' | 'favourite' | 'archived'
```

- Added via the existing ad-hoc migration in `app/db.py` `_migrate()`
  (`PRAGMA table_info` → `ALTER TABLE leads ADD COLUMN user_status TEXT DEFAULT 'normal'`).
  Existing rows backfill to `'normal'`.
- **Re-scrape preservation:** the upsert in `app/store.py` `insert_leads`
  (`ON CONFLICT(engine, dedup_key) DO UPDATE SET ...`) lists explicit columns and
  does **not** include `user_status`, and the INSERT column list does not include
  it either. So re-running a scrape never resets a lead's favourite/archive state
  — verified against the current upsert. A regression test locks this in.

## 2. Backend API
One new write endpoint (the API is otherwise GET-only):

```
PATCH /api/leads/{id}
body: { "user_status": "favourite" | "archived" | "normal" }
```

- Gated by `require_auth`, in `app/routers/leads.py`.
- Validates `user_status` against the three allowed values; returns **400** on
  anything else and **404** if the lead id doesn't exist.
- Returns the updated lead (or `{ "ok": true }`).
- Backed by new `store.set_lead_status(conn, lead_id, status)`.
- `query_leads` already does `SELECT *`; ensure `user_status` flows through
  `_lead_to_dict` and the `ApiLead` response so the frontend receives it.
- **No server-side filtering** by `user_status` — the frontend fetches up to 500
  leads and filters client-side, so view-switching stays in the UI.

## 3. Frontend
**Carry the real DB id.** `web/src/lib/leads.ts` currently discards `item.id`
and synthesizes `Lead.id = "${business_name}-${index}"`. Add `dbId: number` and
`userStatus: 'normal' | 'favourite' | 'archived'` to the `Lead` type
(`web/src/types.ts`) and populate them in the `ApiLead → Lead` transform. PATCH
uses `dbId`.

**Filter chips** (segmented control) in the existing filter row in
`Dashboard.tsx`:
- **Active** (default) — `normal` + `favourite`; archived hidden.
- **Favourites** — only `favourite`.
- **Archived** — only `archived`.

Applied in the existing client-side `visible` filtering. Favourites are **not**
pinned — they keep the hottest-first order within the Active view, shown with a
star marker.

**Controls** — a star toggle and an archive toggle on both `LeadRow.tsx` and
`LeadDrawer.tsx`:
- Star on a `normal`/`archived` lead → `favourite`; star on a `favourite` → `normal`.
- Archive on a `normal`/`favourite` lead → `archived`; un-archive → `normal`.
- Mutual exclusivity falls out of the single field automatically (favouriting an
  archived lead un-archives it, etc.).

**Update flow** — optimistic:
1. Flip the lead's `userStatus` in local state immediately (via the `useLeads`
   hook, which gains a `setLeadStatus` mutator).
2. Fire `patchLeadStatus(dbId, status)` — new function in `web/src/lib/api.ts`
   (`PATCH`, `credentials: 'include'`).
3. On failure, roll back the local change and surface the existing error UI.

## 4. Testing
- **Backend (`pytest`):**
  - `set_lead_status` rejects invalid status values.
  - Upsert preserves `user_status` across a re-ingest of the same lead (the
    star-protection regression test).
- **Frontend:** no test infra in `web/` today; verification is TypeScript
  compile + manual click-through (repo pattern is "validated by real runs").

## Out of scope (YAGNI)
- No notes/tags/sales-pipeline status — just the three states.
- No bulk actions.
- No server-side pagination/filtering changes.
- No favourites-pinned-to-top ordering.

## Files touched
- `app/db.py` — migration for `user_status`.
- `app/store.py` — `set_lead_status`, ensure `user_status` in `_lead_to_dict`.
- `app/routers/leads.py` — `PATCH /api/leads/{id}`.
- `web/src/types.ts` — `Lead.dbId`, `Lead.userStatus`.
- `web/src/lib/leads.ts` — carry id + status through the transform.
- `web/src/lib/api.ts` — `patchLeadStatus`.
- `web/src/hooks/useLeads.ts` — `setLeadStatus` mutator (optimistic + rollback).
- `web/src/components/Dashboard.tsx` — filter chips + view filtering.
- `web/src/components/LeadRow.tsx` — star/archive controls.
- `web/src/components/LeadDrawer.tsx` — star/archive controls.
- Tests under the existing `pytest` suite.
