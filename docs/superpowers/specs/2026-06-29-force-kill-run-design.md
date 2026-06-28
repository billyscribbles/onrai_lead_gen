# Force-kill a running lead generation

**Date:** 2026-06-29
**Status:** Approved design, pre-implementation

## Goal

Let the user force-kill an in-flight lead generation run. A **Stop** control
appears while a run is in flight (on the floating run bar and in the Generate
view). Clicking it opens an **"Are you sure?"** confirmation modal. On confirm
the run is genuinely aborted: the Apify scrape is stopped (so billing stops),
the worker abandons the run, **no leads from the killed run are saved** (clean
discard), and the UI flips to a neutral **"Run stopped"** state.

## Constraints / context

- A run executes in a background daemon thread (`app/worker.py`
  `launch_run_async` → `execute_run`). The expensive, long-blocking step is
  `client.actor(MAPS_ACTOR).call(run_input=...)` inside
  `scrape_no_website.run_maps_lookup`, which blocks until Apify finishes and
  only returns the Apify run id *after* completion.
- To truly abort we must learn the Apify run id mid-flight: switch
  `.call()` → `.start()` (returns the run immediately) and poll
  `client.run(id).get()` so we can call `client.run(id).abort()` on demand.
- Verified against installed `apify-client` 3.0.4: `actor.start()`,
  `run(id).get()`, and `run(id).abort()` all exist. **Shape wrinkle:**
  `.call()` returns a run *object* (attribute access, used by `_check_run`);
  `.start()` and `.get()` return *dicts* (`run["id"]`, `run["status"]`,
  `run["defaultDatasetId"]`). The new poll path is dict-aware.
- The `runs.apify_run_id` column already exists (`app/db.py`) and is already in
  `store._RUN_UPDATABLE`. Status `aborted` is already a known terminal status
  in the frontend `Run` union and in `RunProvider`'s `TERMINAL` set.
- Pure logic stays unit-tested; CLI and existing tests must be unaffected — new
  hooks default to `None`.

## Backend changes

### 1. Cancellation registry — `app/worker.py`
- Module-level `_ABORTS: dict[int, threading.Event]`.
- `launch_run_async(run_id)` creates `_ABORTS[run_id] = Event()` before
  spawning the thread and deletes it in a `finally`.
- `request_abort(run_id) -> bool` sets the event if present, returns whether one
  was found (lets the endpoint detect an orphaned/dead-thread run).

### 2. Abort hooks in the scraper — `scrape_no_website.py`
- New exception `class RunAborted(Exception)`.
- `collect_leads(..., should_abort=None, on_run_start=None)` — both default
  `None` (CLI/tests unaffected). Check `should_abort()` (when provided):
  - between maps chunks,
  - before the classify loop,
  - periodically inside the classify loop (cheap, e.g. every iteration or every
    N places); raise `RunAborted` when it returns truthy.
- `run_maps_lookup(client, searches, per_search, country, chunk_size,
  should_abort=None, on_run_start=None)`:
  - `run = client.actor(MAPS_ACTOR).start(run_input=run_input)`.
  - `if on_run_start: on_run_start(run["id"])`.
  - Poll loop: `client.run(run["id"]).get()` every ~2 s. Each tick:
    - if `should_abort and should_abort()` → `client.run(run["id"]).abort()`,
      raise `RunAborted`.
    - if status terminal → break.
  - Dict-aware success check (mirrors `_check_run` but for the `.get()` dict):
    require `status == "SUCCEEDED"`, else `sys.exit(...)` as today.
  - Read items via `client.dataset(run["defaultDatasetId"]).iterate_items()`.
- When `should_abort`/`on_run_start` are `None` (CLI path), behaviour is
  unchanged apart from `.call()` → `.start()`+poll. Keep the existing
  `_check_run`/object path working, or unify on the dict path — implementation
  detail for the plan, but the CLI must keep behaving identically.

### 3. Worker wiring — `app/worker.py` + `app/engines/no_website.py`
- `no_website.run(params, on_progress=None, client=None, conn=None,
  should_abort=None, on_run_start=None)` passes the two hooks straight into
  `sw.collect_leads`.
- `execute_run(conn, run_id, *, client=None)`:
  - `event = _ABORTS.get(run_id)`; `should_abort = event.is_set if event else None`.
  - `on_run_start = lambda rid: store.update_run(conn, run_id, apify_run_id=rid)`.
  - Pass both into `runner(...)`.
  - Catch `RunAborted` **before** the generic `except Exception`: write
    `status="aborted"`, `finished_at=_now(conn)` (do **not** insert leads).
  - Generic `except Exception` still → `status="failed"`.
  - Clean-discard guarantee: `RunAborted` propagates out of `collect_leads`
    before `insert_leads` is ever reached.

### 4. Abort endpoint — `app/routers/runs.py`
- `POST /api/runs/{run_id}/abort` (under the same `require_auth` dependency):
  1. `run = store.get_run(conn, run_id)`; 404 if missing.
  2. If `run["status"]` is terminal (`done`/`failed`/`aborted`) → return the run
     unchanged (idempotent no-op).
  3. `worker.request_abort(run_id)` to signal a live worker.
  4. Best-effort Apify abort: if `run["apify_run_id"]`, build a client
     (`apify.make_client()`) and `client.run(apify_run_id).abort()`, swallowing
     errors (covers the orphaned-thread case where no event exists).
  5. `store.update_run(conn, run_id, status="aborted", finished_at=...)` so the
     UI flips immediately and dead-thread runs are still resolved. (Worker's own
     `RunAborted` handler writing `aborted` again is harmless/idempotent.)
  6. Return the updated run.

## Frontend changes

### 5. `web/src/lib/api.ts`
- `abortRun(id: number): Promise<Run>` → `POST /api/runs/${id}/abort`.

### 6. `web/src/run/RunProvider.tsx`
- Context `ActiveRun` gains `aborting: boolean` and `abort: () => Promise<void>`.
- `abort()`: guard on `runId`; set `aborting = true`; `await abortRun(runId)`.
  The existing poll loop already treats `aborted` as terminal, so it stops on
  the next tick. Reset `aborting` when the run reaches a terminal state and in
  `dismiss()`.

### 7. `web/src/run/progress.ts`
- Add `'aborted'` to `RunPhase`. In `runPhase`, `status === 'aborted'` →
  `'aborted'` (instead of folding into `'error'`). `progressFor` for the
  aborted/default case shows a neutral "Run stopped" label.

### 8. `web/src/components/ConfirmDialog.tsx` (new, reusable)
- Props: `{ open, title, message, confirmLabel, cancelLabel?, danger?, onConfirm,
  onCancel }`.
- Fixed overlay backdrop + centered card. Autofocus the Cancel button; Esc and
  backdrop-click call `onCancel`. **No native `confirm()`/`alert()`** (avoids
  blocking browser dialogs).
- New `.modal*` styles in `web/src/index.css` (no existing modal styles to
  reuse), matching the existing button/`gen__` visual language.

### 9. Stop controls — `RunWidget.tsx` and `GenerateSection.tsx`
- Both render a danger **Stop** button while the run is busy (running/
  classifying). Each owns local `confirmOpen` state and a `ConfirmDialog`
  instance; both call the shared `abort()` from context.
- Modal copy: title "Stop this run?", message "Apify scraping will be aborted
  and no leads from this run will be saved." Confirm label "Stop run" (danger).
- While `aborting`, the Stop button shows "Stopping…" and is disabled.
- `RunWidget` renders a neutral "Run stopped" bar for the `aborted` phase
  (distinct from the red error variant).

## Testing (`pytest -q`)

- **Worker:** a fake runner that raises `RunAborted` → `execute_run` records
  `status="aborted"` (not `failed`) and does not insert leads.
- **Endpoint:** `POST /api/runs/{id}/abort` → 404 for unknown id; idempotent
  (returns unchanged) for an already-terminal run; for a running run with
  `apify_run_id` set, calls `client.run(id).abort()` (mock client) and writes
  `status="aborted"`.
- **Scraper:** `collect_leads(..., should_abort=lambda: True, ...)` raises
  `RunAborted` and never iterates the dataset (mock client asserts no
  `iterate_items`).
- **Regression:** existing `collect_leads`/CLI tests still pass with the
  `.call()` → `.start()`+poll change (mock client updated to the new shape).

## Out of scope / non-goals

- Keeping partial leads from a killed run (explicitly discarded — clean stop).
- Pausing/resuming runs.
- Aborting anything other than the Maps actor run (only one Apify run per run).
