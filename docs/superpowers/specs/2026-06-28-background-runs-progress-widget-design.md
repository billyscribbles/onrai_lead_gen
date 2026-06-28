# Background runs with a persistent progress widget

**Date:** 2026-06-28
**Status:** Approved (design)

## Goal

Let the user click "Generate leads", then navigate away within the app (or
refresh the browser) while the run keeps going, with a always-visible UI showing
live progress. Clicking back returns them to the full run state. This enables
multitasking in the dashboard while a scrape is in flight.

## Background / current state

The backend already supports background runs end-to-end:

- `POST /api/runs` creates a run row in SQLite and fires a **detached daemon
  thread** (`app/worker.py:launch_run_async`) that runs the engine off-request
  and writes progress straight into the `runs` table.
- Run state (`status`, `places_scraped`, `progress`, `leads_found`, `error`, …)
  is durably persisted in the `runs` table (`app/db.py`) and pollable by id via
  `GET /api/runs/{id}`.
- `GET /api/runs` (list, most recent 50) exists but is **unused by the UI**.

Everything that breaks "click away and come back" is in the frontend:

- `run_id`, the `run` object, the poll interval, and `phase` all live **inside
  `GenerateSection`** (`web/src/components/GenerateSection.tsx:81-84`).
- Dashboard unmounts `GenerateSection` when switching to the leads view
  (`web/src/components/Dashboard.tsx:137`); the poll interval is cleared on
  unmount (`GenerateSection.tsx:123`).
- `run_id` is never persisted, so the handle to a live run is lost on navigation
  or refresh even though the server keeps working.
- There is no global store/context/router — the app uses only `useState`.

**No backend changes are required.**

## Approach

Lift active-run ownership out of the view into a small **run context provider**
mounted above the view switch. Considered and rejected:

- Stash `run_id` in `localStorage` and rebuild state in `GenerateSection` on
  return — can't show a widget on *other* views.
- A global state library (Zustand/Redux) — overkill; the app uses only
  `useState`.

The context provider is the smallest thing that satisfies: visible on every view
+ survives in-app navigation + survives browser refresh.

## Components

### 1. `web/src/lib/api.ts`
Add `listRuns(): Promise<Run[]>` → `GET /api/runs`. (Endpoint already exists.)

### 2. New `web/src/run/RunProvider.tsx` (context + `useActiveRun()` hook)
The single owner of active-run state:

- `runId: number | null`, mirrored to `localStorage` (gives refresh-survival).
- `run: Run | null` — latest polled snapshot.
- **one** poll interval (2000ms, same cadence as today), living here so it is
  never torn down by navigation.
- `start(params, confirmedEstimate)` → `createRun` → set + persist `runId` →
  begin polling.
- `dismiss()` → clear `runId` / `run` / `localStorage` (used to close the widget
  after a terminal status, and on logout).
- On mount: rehydrate `runId` from `localStorage` and resume polling. If none,
  call `listRuns()` once and adopt the most recent `running`/`classifying` run
  (covers refresh when localStorage was cleared).
- Polling stops on any terminal status (`done` / `failed` / `aborted`).

Status union and `Run` type are reused from `api.ts` (no changes).

### 3. New `web/src/components/RunWidget.tsx`
Floating mini-widget pinned bottom-right. Reads `useActiveRun()`:

- Reuses the existing `progressFor(run)` logic for the bar fill + label.
- Shows "N listings seen" when `places_scraped > 0`.
- **[View]** → jumps to the Generate view (`onView` prop).
- **[Dismiss]** → only shown once the run is terminal; calls `ctx.dismiss()`.

`progressFor()` currently lives in `GenerateSection.tsx`. Move it to a shared
module (e.g. alongside `RunProvider`) so both the widget and the section import
it.

Rendered by Dashboard on every view **except** the Generate view (where the full
in-page progress already shows — avoids a duplicate indicator).

### 4. `web/src/components/GenerateSection.tsx`
- Keep all config + estimate state local (industry, suburbs, target, criteria,
  estimate) — unchanged.
- Remove its private `run` / `phase` / `poll` ownership.
- Read run state from `useActiveRun()`; call `ctx.start()` from `onGenerate`.
- Its existing running / done / error UI now renders off the context's `run`.
- Derive the local "phase" notion from context state (config when no active run,
  running/done/error from `run.status`).

### 5. `web/src/components/Dashboard.tsx` (and/or `App.tsx`)
- Wrap the tree in `<RunProvider>` (placed so both `GenerateSection` and
  `RunWidget` are descendants).
- Render `<RunWidget onView={() => setView('generate')} />` outside the
  `view === 'generate'` block.
- Move the "on done → `reload()` leads" effect here: watch
  `run.status === 'done'` and call the existing `useLeads().reload`, so the leads
  sheet refreshes regardless of which view the user is on.
- On logout, call `ctx.dismiss()` to clear any persisted run.

## Data flow

```
GenerateSection "Generate"
  → ctx.start(params, estimate)
    → createRun (POST /api/runs)  → { run_id }
    → persist runId to localStorage
    → poll GET /api/runs/{id} every 2s → ctx.run updated
        → in-page progress AND RunWidget both re-render from ctx.run
    → on terminal status: stop polling
        → Dashboard effect sees status==='done' → reload() leads
```

Navigating away/back or refreshing the browser never touches the run; the widget
and the section simply re-bind to the live context (rehydrated from localStorage
/ reconciled via `listRuns()` on mount).

## Error handling

- Poll returns 404 / network loss → stop polling, mark error, surface it in the
  widget with a Dismiss action.
- **Known limitation (out of scope):** a Railway redeploy kills the daemon
  thread mid-run, leaving the DB row stuck at `running`; the widget would then
  poll a run that never completes. This is the pre-existing daemon-thread caveat
  already documented in `CLAUDE.md`, not introduced by this work. Noted, not
  fixed here.

## Testing

The repo's automated tests are `pytest` for the pure Python logic
(`web_presence.py`); there is **no JS/React test harness** configured (Vite app,
no test runner). No automated frontend tests will be added or claimed.

Manual verification steps:

1. Start a run; confirm in-page progress climbs.
2. Switch to the leads view → the floating widget appears with live progress.
3. Refresh the browser → the widget re-attaches to the still-running run.
4. Let the run finish → leads sheet refreshes; widget offers **Dismiss**.
5. Dismiss → widget disappears; starting a new run works again.
6. Logout → any persisted run handle is cleared.

## Explicitly out of scope

**Abort button.** No abort endpoint exists today. Real abort means a new
`POST /api/runs/{id}/abort` that aborts the Apify run (we store `apify_run_id`)
and flips status. The widget exposes **[View] + [Dismiss]**, not abort. Can be
added later as a separate piece.
