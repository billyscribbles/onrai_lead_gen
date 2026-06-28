# Force-kill a running lead generation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user force-kill an in-flight lead generation run — stopping the Apify scrape (so billing stops), discarding partial results, and flipping the UI to a neutral "Run stopped" state — behind an "Are you sure?" confirmation modal.

**Architecture:** The run executes in a background daemon thread (`app/worker.py`). To truly abort we switch the Maps actor from the blocking `.call()` to `.start()`+poll so we learn the Apify run id mid-flight and can call `run.abort()`. A per-run `threading.Event` registry signals the worker; an `RunAborted` exception unwinds the run cleanly (no leads saved) and records `status="aborted"`. A `POST /api/runs/{id}/abort` endpoint signals the worker and best-effort aborts Apify directly (covering dead-thread runs). The frontend adds a Stop button (floating run bar + Generate view) gated by a reusable `ConfirmDialog`.

**Tech Stack:** Python 3 / FastAPI / SQLite / apify-client 3.0.4 (backend); React + TypeScript + Vite (frontend). Backend tests: pytest. Frontend verification: `tsc -b` (via `npm run build`) + `oxlint` (via `npm run lint`) — no JS test runner in this repo.

## Global Constraints

- **Clean discard:** a killed run saves **zero** leads. `RunAborted` must propagate out of `collect_leads` before `store.insert_leads` is ever called.
- **CLI/test back-compat:** new scraper hooks `should_abort` and `on_run_start` default to `None`; the CLI path (`scrape_no_website.main`) must behave identically apart from `.call()` → `.start()`+poll.
- **Apify client shape:** `.start(run_input=...)` and `client.run(id).get()` return **dicts** (`run["id"]`, `run["status"]`, `run["defaultDatasetId"]`); only the old `.call()` path used attribute access. Verified methods on apify-client 3.0.4: `actor.start`, `run(id).get`, `run(id).abort`.
- **Terminal Apify statuses:** `SUCCEEDED`, `FAILED`, `TIMED-OUT`, `ABORTED`. Only `SUCCEEDED` is acceptable (mirrors existing `_check_run`).
- **No native browser dialogs:** use the React `ConfirmDialog`, never `window.confirm`/`alert`.
- **Run status `aborted`** already exists in the frontend `Run['status']` union and in `RunProvider`'s `TERMINAL` set — do not redefine them.
- Run backend tests with the repo venv: `.venv/bin/python -m pytest`. Frontend commands run in `web/`.

---

### Task 1: Scraper abort plumbing

**Files:**
- Modify: `scrape_no_website.py` (add `RunAborted`, `import time`; rewrite `run_maps_lookup`; add hooks + abort checks to `collect_leads`)
- Test: `tests/test_scrape_no_website.py` (append)

**Interfaces:**
- Produces:
  - `class RunAborted(Exception)`
  - `run_maps_lookup(client, search_strings, per_search, country, chunk_size, should_abort=None, on_run_start=None) -> list[dict]`
  - `collect_leads(..., should_abort=None, on_run_start=None)` — new trailing kwargs; existing signature otherwise unchanged.
  - `should_abort` is `Callable[[], bool] | None`; `on_run_start` is `Callable[[str], None] | None` receiving the Apify run id.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_scrape_no_website.py`:

```python
# --- abort plumbing ---------------------------------------------------------

import pytest
from scrape_no_website import RunAborted, collect_leads, run_maps_lookup


class _FakeActor:
    def __init__(self, run):
        self._run = run

    def start(self, run_input=None):
        return self._run


class _FakeDataset:
    def __init__(self, items):
        self._items = items

    def iterate_items(self):
        return iter(self._items)


class _OneShotRunClient:
    """Returns SUCCEEDED on the first .get() so the poll loop never sleeps."""
    def get(self):
        return {"status": "SUCCEEDED", "id": "R1", "defaultDatasetId": "DS1"}

    def abort(self):
        raise AssertionError("abort() should not be called on the happy path")


class _HappyClient:
    def actor(self, name):
        return _FakeActor({"id": "R1"})

    def run(self, run_id):
        return _OneShotRunClient()

    def dataset(self, ds_id):
        return _FakeDataset([{"placeId": "p1"}])


def test_run_maps_lookup_starts_polls_and_returns_items():
    captured = {}
    places = run_maps_lookup(
        _HappyClient(), ["cafe Footscray VIC"], 5, "au", 200,
        on_run_start=lambda rid: captured.__setitem__("rid", rid))
    assert captured["rid"] == "R1"
    assert places == [{"placeId": "p1"}]


def test_run_maps_lookup_aborts_apify_run_when_requested():
    aborted = []

    class _RunningRunClient:
        def get(self):
            return {"status": "RUNNING", "id": "R1", "defaultDatasetId": "DS1"}

        def abort(self):
            aborted.append("R1")

    class _Client:
        def actor(self, name):
            return _FakeActor({"id": "R1"})

        def run(self, run_id):
            return _RunningRunClient()

        def dataset(self, ds_id):
            raise AssertionError("dataset() must not be read after an abort")

    with pytest.raises(RunAborted):
        run_maps_lookup(_Client(), ["x VIC"], 5, "au", 200,
                        should_abort=lambda: True)
    assert aborted == ["R1"]


def test_collect_leads_aborts_immediately_without_touching_client():
    class _NoCallClient:
        def actor(self, *a, **k):
            raise AssertionError("actor() must not be called once aborted")

        def dataset(self, *a, **k):
            raise AssertionError("dataset() must not be called once aborted")

    with pytest.raises(RunAborted):
        collect_leads(
            _NoCallClient(), categories=["cafe"], suburbs=["Footscray"],
            per_search=5, max_searches=1, min_reviews=5, country="au",
            chunk_size=200, limit=None, fetch=False, maps_dataset_id="DS-1",
            should_abort=lambda: True)
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_scrape_no_website.py -k "abort or starts_polls" -v`
Expected: FAIL — `ImportError: cannot import name 'RunAborted'` (and `collect_leads`/`run_maps_lookup` lacking the new kwargs).

- [ ] **Step 3: Add `RunAborted`, the time import, and the dict-aware run helpers**

In `scrape_no_website.py`, add `import time` to the stdlib imports near the top (alongside `import sys`). After the `MAPS_ACTOR = ...` line (around line 50) add:

```python
class RunAborted(Exception):
    """Raised when a caller force-aborts an in-flight run."""


_POLL_INTERVAL = 2.0  # seconds between Apify run status polls
_TERMINAL_RUN_STATUSES = {"SUCCEEDED", "FAILED", "TIMED-OUT", "ABORTED"}


def _wait_for_run(client, run_id, should_abort=None):
    """Block until an Apify run finishes; abort it if should_abort() turns true.

    Returns the terminal run dict. Raises RunAborted after asking Apify to abort
    the run, so the caller never pays for or reads a half-finished scrape."""
    run_client = client.run(run_id)
    while True:
        if should_abort is not None and should_abort():
            run_client.abort()
            raise RunAborted(f"Apify run {run_id} aborted by user")
        run = run_client.get()
        if run.get("status") in _TERMINAL_RUN_STATUSES:
            return run
        time.sleep(_POLL_INTERVAL)


def _check_run_dict(run, label):
    """Exit clearly if a polled Apify run dict did not succeed."""
    status = run.get("status")
    if status != "SUCCEEDED":
        sys.exit(f"ERROR: {label} run did not succeed "
                 f"(status={status}, runId={run.get('id')}).")
```

- [ ] **Step 4: Rewrite `run_maps_lookup` to start+poll**

Replace the body of `run_maps_lookup` (currently lines ~130-149) with:

```python
def run_maps_lookup(client, search_strings, per_search, country, chunk_size,
                    should_abort=None, on_run_start=None):
    """Look up every search string on Google Maps; return all place items.

    Uses .start()+poll (not the blocking .call()) so a caller can force-abort
    the in-flight Apify run via ``should_abort``. ``on_run_start`` receives each
    Apify run id as soon as it is known, so callers can persist it for abort."""
    places = []
    for start in range(0, len(search_strings), chunk_size):
        chunk = search_strings[start:start + chunk_size]
        run_input = {
            "searchStringsArray": chunk,
            "maxCrawledPlacesPerSearch": per_search,
            "language": "en",
            "countryCode": country,
        }
        print(f"[maps] Searching {len(chunk)} queries "
              f"({start + 1}-{start + len(chunk)} of {len(search_strings)}), "
              f"<= {per_search} places each...")
        started = client.actor(MAPS_ACTOR).start(run_input=run_input)
        run_id = started["id"]
        if on_run_start is not None:
            on_run_start(run_id)
        run = _wait_for_run(client, run_id, should_abort)
        _check_run_dict(run, "Google Maps lookup")
        dataset_id = run["defaultDatasetId"]
        items = list(client.dataset(dataset_id).iterate_items())
        print(f"[maps]   -> {len(items)} listings (dataset {dataset_id})")
        places.extend(items)
    return places
```

- [ ] **Step 5: Thread abort checks through `collect_leads`**

In `collect_leads` (signature ~line 200), add the two trailing kwargs and abort checks. New signature line:

```python
def collect_leads(client, *, categories, suburbs, per_search, max_searches,
                  min_reviews, country, chunk_size, limit, fetch,
                  maps_dataset_id=None, skip_pairs=None, on_searched=None,
                  on_progress=None, fetch_fn=fetch_site,
                  should_abort=None, on_run_start=None):
```

Immediately after the `def _emit(...)` helper inside `collect_leads`, add:

```python
    def _check_abort():
        if should_abort is not None and should_abort():
            raise RunAborted("run aborted by user")

    _check_abort()  # bail before touching Apify if an abort is already pending
```

In the `else:` branch that calls `run_maps_lookup`, pass the hooks through:

```python
        raw_places = run_maps_lookup(client, searches, per_search, country,
                                     chunk_size, should_abort=should_abort,
                                     on_run_start=on_run_start)
```

After the `places.sort(...)` / `_emit("classify", ...)` lines and at the top of the per-place loop, add abort checks:

```python
    _check_abort()
    places = web_presence.dedupe_by_place_id(raw_places)
    places.sort(key=lambda p: p.get("reviewsCount") or 0, reverse=True)
    _emit("classify", f"{len(places)} unique listings", len(places))

    rows = []
    fetch_budget = limit if limit is not None else len(places)
    for place in places:
        _check_abort()
        if not web_presence.is_real_listing(place, min_reviews):
            continue
        # ... unchanged ...
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_scrape_no_website.py -v`
Expected: PASS (the three new tests plus all pre-existing `resolve_status`/`build_*` tests).

- [ ] **Step 7: Commit**

```bash
git add scrape_no_website.py tests/test_scrape_no_website.py
git commit -m "feat(scraper): force-abort hooks via .start()+poll on the Maps actor"
```

---

### Task 2: Worker abort registry + clean unwind

**Files:**
- Modify: `app/worker.py` (registry, `execute_run` abort handling, `launch_run_async` lifecycle)
- Modify: `app/engines/no_website.py` (pass hooks through)
- Test: `tests/test_worker.py` (create)

**Interfaces:**
- Consumes: `scrape_no_website.RunAborted`; `collect_leads(..., should_abort=, on_run_start=)` from Task 1.
- Produces:
  - `worker._ABORTS: dict[int, threading.Event]`
  - `worker.request_abort(run_id: int) -> bool` (True iff a live event was found and set)
  - `no_website.run(params, on_progress=None, client=None, conn=None, should_abort=None, on_run_start=None)`
  - `execute_run` records `status="aborted"` (not `failed`) on `RunAborted`, saving no leads.

- [ ] **Step 1: Write the failing test**

Create `tests/test_worker.py`:

```python
"""Worker run-lifecycle tests: an aborted run records 'aborted', saves nothing."""
from app import db, store, worker
from scrape_no_website import RunAborted


def _conn(tmp_path):
    conn = db.connect(str(tmp_path / "runs.db"))
    db.init_db(conn)
    return conn


def test_execute_run_records_aborted_not_failed(tmp_path, monkeypatch):
    conn = _conn(tmp_path)
    rid = store.create_run(conn, "no_website", {}, "running", 0.0)

    def fake_runner(params, on_progress=None, client=None, conn=None,
                    should_abort=None, on_run_start=None):
        raise RunAborted("stop")

    monkeypatch.setitem(worker.ENGINE_RUNNERS, "no_website", fake_runner)

    worker.execute_run(conn, rid, client=object())

    run = store.get_run(conn, rid)
    assert run["status"] == "aborted"
    assert store.all_leads(conn, "no_website") == []


def test_request_abort_false_when_no_live_event(tmp_path):
    assert worker.request_abort(123456) is False
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_worker.py -v`
Expected: FAIL — `AttributeError: module 'app.worker' has no attribute 'request_abort'` (and the abort path would currently record `failed`).

- [ ] **Step 3: Add the registry and abort-aware `execute_run`**

In `app/worker.py`, update the imports and add the registry near the top:

```python
from app import db, store
from app.apify import make_client
from app.engines import no_website
from app.normalize import dedupe_leads
from scrape_no_website import RunAborted

ENGINE_RUNNERS = {
    "no_website": no_website.run,
}

_ABORTS: dict[int, threading.Event] = {}


def request_abort(run_id: int) -> bool:
    """Signal a live worker thread to abort. Returns False if none is running."""
    event = _ABORTS.get(run_id)
    if event is None:
        return False
    event.set()
    return True
```

Replace `execute_run` with the abort-aware version:

```python
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
    event = _ABORTS.get(run_id)
    should_abort = event.is_set if event is not None else None

    def on_run_start(apify_run_id):
        store.update_run(conn, run_id, apify_run_id=apify_run_id)

    try:
        scraped = {"n": 0}

        def on_progress(ev):
            scraped["n"] = ev.get("places_scraped", scraped["n"])
            store.update_run(conn, run_id, places_scraped=scraped["n"],
                             progress=ev.get("message", ""),
                             status="classifying" if ev.get("stage") == "classify" else "running")

        leads = runner(run["params"], on_progress=on_progress, client=client,
                       conn=conn, should_abort=should_abort,
                       on_run_start=on_run_start)
        leads = dedupe_leads(leads)
        store.insert_leads(conn, run_id, run["engine"], leads)
        store.update_run(conn, run_id, status="done", leads_found=len(leads),
                         places_scraped=scraped["n"], finished_at=_now(conn))
    except RunAborted:
        store.update_run(conn, run_id, status="aborted", finished_at=_now(conn))
    except Exception as exc:  # noqa: BLE001 — surface any failure to the UI
        store.update_run(conn, run_id, status="failed", error=str(exc),
                         finished_at=_now(conn))
```

- [ ] **Step 4: Register and clean up the event in `launch_run_async`**

Replace `launch_run_async`:

```python
def launch_run_async(run_id: int) -> None:
    _ABORTS[run_id] = threading.Event()

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
            _ABORTS.pop(run_id, None)

    threading.Thread(target=_job, daemon=True).start()
```

- [ ] **Step 5: Pass the hooks through the engine**

In `app/engines/no_website.py`, update `run`'s signature and the `collect_leads` call:

```python
def run(params: dict, on_progress=None, client=None, conn=None,
        should_abort=None, on_run_start=None) -> list[dict]:
```

```python
    rows = sw.collect_leads(
        client, categories=[category], suburbs=suburbs, per_search=per_search,
        max_searches=max_searches, min_reviews=min_reviews, country="au",
        chunk_size=200, limit=None, fetch=fetch, maps_dataset_id=maps_dataset_id,
        skip_pairs=skip, on_searched=swept.extend, on_progress=on_progress,
        should_abort=should_abort, on_run_start=on_run_start)
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_worker.py -v`
Expected: PASS (both tests).

- [ ] **Step 7: Commit**

```bash
git add app/worker.py app/engines/no_website.py tests/test_worker.py
git commit -m "feat(worker): abort registry + record aborted runs without saving leads"
```

---

### Task 3: Abort endpoint

**Files:**
- Modify: `app/routers/runs.py` (add `POST /api/runs/{run_id}/abort`)
- Test: `tests/test_runs_api.py` (create)

**Interfaces:**
- Consumes: `worker.request_abort`; `app.apify.make_client`; `store.get_run`/`update_run`.
- Produces: `POST /api/runs/{run_id}/abort` → 404 unknown; returns the run unchanged when already terminal; otherwise signals the worker, best-effort aborts Apify by stored `apify_run_id`, sets `status="aborted"` + `finished_at`, and returns the updated run dict.

- [ ] **Step 1: Write the failing tests**

Create `tests/test_runs_api.py`:

```python
"""Integration tests for POST /api/runs/{id}/abort."""
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app import db, store
from app.auth import require_auth
from app.routers import runs as runs_router


@pytest.fixture()
def client(tmp_path):
    conn = db.connect(str(tmp_path / "runs.db"))
    db.init_db(conn)
    app = FastAPI()
    app.include_router(runs_router.router)
    app.dependency_overrides[runs_router.get_conn] = lambda: conn
    app.dependency_overrides[require_auth] = lambda: None
    with TestClient(app) as c:
        yield c, conn


def test_abort_unknown_run_404(client):
    c, _ = client
    assert c.post("/api/runs/999999/abort").status_code == 404


def test_abort_terminal_run_is_noop(client):
    c, conn = client
    rid = store.create_run(conn, "no_website", {}, "done", 0.0)
    resp = c.post(f"/api/runs/{rid}/abort")
    assert resp.status_code == 200
    assert resp.json()["status"] == "done"


def test_abort_running_run_aborts_apify_and_marks_aborted(client, monkeypatch):
    c, conn = client
    rid = store.create_run(conn, "no_website", {}, "running", 0.0)
    store.update_run(conn, rid, apify_run_id="APIFY-1")

    aborted = []

    class _FakeRunClient:
        def __init__(self, run_id):
            self.run_id = run_id

        def abort(self):
            aborted.append(self.run_id)

    class _FakeClient:
        def run(self, run_id):
            return _FakeRunClient(run_id)

    monkeypatch.setattr("app.apify.make_client", lambda: _FakeClient())

    resp = c.post(f"/api/runs/{rid}/abort")
    assert resp.status_code == 200
    assert resp.json()["status"] == "aborted"
    assert aborted == ["APIFY-1"]
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_runs_api.py -v`
Expected: FAIL — `405 Method Not Allowed` / 404 routing because the abort route does not exist yet.

- [ ] **Step 3: Add the endpoint**

In `app/routers/runs.py`, add (after `get_run`, reusing the existing `worker`/`store` imports):

```python
_TERMINAL = {"done", "failed", "aborted"}


@router.post("/{run_id}/abort")
def abort_run(run_id: int, conn=Depends(get_conn)):
    run = store.get_run(conn, run_id)
    if not run:
        raise HTTPException(404, "No such run")
    if run["status"] in _TERMINAL:
        return run  # idempotent: nothing to stop

    worker.request_abort(run_id)

    apify_run_id = run.get("apify_run_id")
    if apify_run_id:
        try:
            from app.apify import make_client
            make_client().run(apify_run_id).abort()
        except Exception:  # noqa: BLE001 — best-effort; DB state is the source of truth
            pass

    now = conn.execute("SELECT datetime('now') t").fetchone()["t"]
    store.update_run(conn, run_id, status="aborted", finished_at=now)
    return store.get_run(conn, run_id)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_runs_api.py -v`
Expected: PASS (all three).

- [ ] **Step 5: Run the full backend suite (regression)**

Run: `.venv/bin/python -m pytest -q`
Expected: PASS — all tests green.

- [ ] **Step 6: Commit**

```bash
git add app/routers/runs.py tests/test_runs_api.py
git commit -m "feat(api): POST /api/runs/{id}/abort to force-kill a run"
```

---

### Task 4: Frontend run-state abort wiring

**Files:**
- Modify: `web/src/lib/api.ts` (add `abortRun`)
- Modify: `web/src/run/RunProvider.tsx` (add `aborting`, `abort`)
- Modify: `web/src/run/progress.ts` (add `aborted` phase)

**Interfaces:**
- Produces:
  - `abortRun(id: number): Promise<Run>` in `api.ts`
  - `ActiveRun` context gains `aborting: boolean` and `abort: () => Promise<void>`
  - `RunPhase` gains `'aborted'`; `runPhase(...)` returns `'aborted'` for `status === 'aborted'`.

- [ ] **Step 1: Add the API client function**

In `web/src/lib/api.ts`, after `getRun`:

```typescript
/** Force-kill a run. Returns the run in its final (aborted) state. */
export function abortRun(id: number): Promise<Run> {
  return post(`/api/runs/${id}/abort`, {}).then(json<Run>)
}
```

- [ ] **Step 2: Add the `aborted` phase to `progress.ts`**

In `web/src/run/progress.ts`, change the type and `runPhase`:

```typescript
export type RunPhase = 'config' | 'running' | 'done' | 'error' | 'aborted'
```

In `runPhase`, replace the failed/aborted line:

```typescript
  if (run.status === 'done') return 'done'
  if (run.status === 'aborted') return 'aborted'
  if (run.status === 'failed') return 'error'
  return 'running' // running | classifying | awaiting_confirm | imported
```

- [ ] **Step 3: Add `aborting` + `abort` to `RunProvider`**

In `web/src/run/RunProvider.tsx`:

Update the import:

```typescript
import { abortRun, createRun, getRun, listRuns, type GenParams, type Run } from '../lib/api'
```

Extend the interface:

```typescript
interface ActiveRun {
  runId: number | null
  run: Run | null
  error: string
  aborting: boolean
  start: (params: GenParams, confirmedEstimate: number) => Promise<void>
  abort: () => Promise<void>
  dismiss: () => void
}
```

Add state below the existing `useState` hooks:

```typescript
  const [aborting, setAborting] = useState(false)
```

In `track`'s `tick`, reset `aborting` when a run reaches a terminal state — change the terminal block to:

```typescript
          if (TERMINAL.has(r.status)) {
            stopPoll()
            setAborting(false)
            if (r.status === 'failed') setError(r.error || 'Run failed')
          }
```

(Note: `aborted` is terminal but is **not** treated as an error — the bar shows a neutral "Run stopped".)

Add the `abort` callback after `start`:

```typescript
  const abort = useCallback(async () => {
    if (runId == null) return
    setAborting(true)
    try {
      const r = await abortRun(runId)
      setRun(r)
      if (TERMINAL.has(r.status)) stopPoll()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not stop the run')
    } finally {
      setAborting(false)
    }
  }, [runId, stopPoll])
```

In `dismiss`, also clear `aborting`:

```typescript
  const dismiss = useCallback(() => {
    stopPoll()
    localStorage.removeItem(STORAGE_KEY)
    setRunId(null)
    setRun(null)
    setError('')
    setAborting(false)
  }, [stopPoll])
```

Update the provider value:

```typescript
    <Ctx.Provider value={{ runId, run, error, aborting, start, abort, dismiss }}>
```

- [ ] **Step 4: Verify it builds and lints**

Run: `cd web && npm run build && npm run lint`
Expected: build succeeds (no TS errors), lint clean. (Unused-symbol warnings are expected to disappear once Task 6 consumes `abort`/`aborting`; if `npm run build` fails *only* on "declared but never read" for those, proceed — Task 6 resolves it. It should not, since they are returned in the context object.)

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/api.ts web/src/run/RunProvider.tsx web/src/run/progress.ts
git commit -m "feat(web): abort() + aborting state and aborted run phase"
```

---

### Task 5: Reusable confirmation dialog

**Files:**
- Create: `web/src/components/ConfirmDialog.tsx`
- Modify: `web/src/index.css` (append `.modal*` and `.btn--danger` styles)

**Interfaces:**
- Produces: `ConfirmDialog` React component with props `{ open: boolean; title: string; message: string; confirmLabel: string; cancelLabel?: string; danger?: boolean; onConfirm: () => void; onCancel: () => void }`. Renders nothing when `open` is false. Esc and backdrop-click call `onCancel`; Cancel button is autofocused.

- [ ] **Step 1: Create the component**

Create `web/src/components/ConfirmDialog.tsx`:

```tsx
import { useEffect, useRef } from 'react'

interface Props {
  open: boolean
  title: string
  message: string
  confirmLabel: string
  cancelLabel?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

/**
 * Accessible confirmation modal. Used for destructive actions like force-killing
 * a run. No native window.confirm/alert (those block the page and the browser
 * automation extension). Esc / backdrop-click cancel; Cancel is autofocused.
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel = 'Cancel',
  danger = false,
  onConfirm,
  onCancel,
}: Props) {
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    cancelRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onCancel])

  if (!open) return null

  return (
    <div className="modal__backdrop" onClick={onCancel}>
      <div
        className="modal__card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="modal-title" className="modal__title">
          {title}
        </h2>
        <p className="modal__body">{message}</p>
        <div className="modal__actions">
          <button ref={cancelRef} type="button" className="btn" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`btn ${danger ? 'btn--danger' : 'btn--primary'}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Add styles**

Append to `web/src/index.css`:

```css
/* ============================ Modal ============================= */
.modal__backdrop {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(24, 24, 27, 0.32);
  animation: modal-fade 0.16s ease;
}

@keyframes modal-fade {
  from { opacity: 0; }
  to { opacity: 1; }
}

.modal__card {
  width: min(420px, calc(100vw - 40px));
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 14px;
  box-shadow: var(--shadow-lg);
  padding: 22px;
}

.modal__title {
  margin: 0 0 8px;
  font-size: 16px;
  font-weight: 650;
  color: var(--ink);
}

.modal__body {
  margin: 0 0 18px;
  font-size: 13.5px;
  line-height: 1.5;
  color: var(--ink-soft);
}

.modal__actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.btn--danger {
  border-color: #e2b3a6;
  background: #fff;
  color: #b42318;
}

.btn--danger:hover {
  border-color: #d98a76;
  background: #fdf3f0;
}
```

- [ ] **Step 3: Verify it builds and lints**

Run: `cd web && npm run build && npm run lint`
Expected: build succeeds, lint clean. (`ConfirmDialog` is unused until Task 6; an unused-import warning would only appear at a call site, not here, so the build passes.)

- [ ] **Step 4: Commit**

```bash
git add web/src/components/ConfirmDialog.tsx web/src/index.css
git commit -m "feat(web): reusable ConfirmDialog modal + danger button styles"
```

---

### Task 6: Stop controls in the run bar and Generate view

**Files:**
- Modify: `web/src/components/RunWidget.tsx`
- Modify: `web/src/components/GenerateSection.tsx`
- Modify: `web/src/index.css` (append `.runbar__stop`, `.runbar--stopped`, `.gen__go-group`)

**Interfaces:**
- Consumes: `useActiveRun().abort`, `useActiveRun().aborting` (Task 4); `ConfirmDialog` (Task 5); `RunPhase` `'aborted'` (Task 4).

- [ ] **Step 1: Add the Stop button + neutral aborted bar to `RunWidget`**

In `web/src/components/RunWidget.tsx`:

Update imports:

```tsx
import { useEffect, useState } from 'react'
import { useActiveRun } from '../run/RunProvider'
import { progressFor, runPhase } from '../run/progress'
import { ConfirmDialog } from './ConfirmDialog'
```

Update the destructure and add local confirm state:

```tsx
  const { runId, run, error, dismiss, abort, aborting } = useActiveRun()
  const phase = runPhase(runId, run, error)
  const [confirmOpen, setConfirmOpen] = useState(false)
```

Update the derived flags and label:

```tsx
  const prog = progressFor(run)
  const busy = phase === 'running'
  const done = phase === 'done'
  const isError = phase === 'error'
  const isAborted = phase === 'aborted'

  const found = run?.leads_found ?? 0
  const label = isError
    ? error || 'Run failed'
    : isAborted
      ? 'Run stopped'
      : done
        ? `Found ${found} ${found === 1 ? 'lead' : 'leads'} — saved`
        : prog.label
```

Replace the outer `return (...)` so the bar is wrapped in a fragment with the dialog, the className includes the stopped variant, a Stop button shows while busy, and the track hides when aborted:

```tsx
  return (
    <>
      <div
        className={`runbar ${done ? 'runbar--done' : ''} ${isError ? 'runbar--error' : ''} ${isAborted ? 'runbar--stopped' : ''}`}
        role="status"
        aria-live="polite"
      >
        <div className="runbar__row">
          <span className="runbar__label">
            {done && (
              <span className="runbar__check" aria-hidden="true">
                ✓
              </span>
            )}
            {label}
          </span>

          {busy && <span className="runbar__pct mono">{prog.pct}%</span>}

          {busy && (
            <button
              type="button"
              className="runbar__stop"
              onClick={() => setConfirmOpen(true)}
              disabled={aborting}
            >
              {aborting ? 'Stopping…' : 'Stop'}
            </button>
          )}

          <button type="button" className="runbar__view" onClick={onView}>
            View
          </button>

          {!busy && (
            <button
              type="button"
              className="runbar__x"
              onClick={dismiss}
              aria-label="Dismiss"
            >
              ×
            </button>
          )}
        </div>

        {!isError && !isAborted && (
          <div className="gen__track runbar__track">
            <div
              className={`gen__fill ${busy ? 'is-animated' : ''}`}
              style={{ width: `${prog.pct}%` }}
            />
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Stop this run?"
        message="Apify scraping will be aborted and no leads from this run will be saved."
        confirmLabel="Stop run"
        danger
        onConfirm={() => {
          setConfirmOpen(false)
          void abort()
        }}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  )
```

- [ ] **Step 2: Add the Stop button + aborted result to `GenerateSection`**

In `web/src/components/GenerateSection.tsx`:

Add the import:

```tsx
import { ConfirmDialog } from './ConfirmDialog'
```

Update the destructure to pull in `abort`/`aborting`, and add local confirm state (place the `useState` near the other hooks):

```tsx
  const { runId, run, error, start, dismiss, abort, aborting } = useActiveRun()
  const phase = runPhase(runId, run, error)
  const [confirmOpen, setConfirmOpen] = useState(false)
```

Replace the `{busy && (...)}` button block in `gen__bar`:

```tsx
        {busy && (
          <div className="gen__go-group">
            <button type="button" className="btn btn--primary gen__go" disabled>
              Generating…
            </button>
            <button
              type="button"
              className="btn btn--danger"
              onClick={() => setConfirmOpen(true)}
              disabled={aborting}
            >
              {aborting ? 'Stopping…' : 'Stop'}
            </button>
          </div>
        )}
```

Add an aborted result block after the `phase === 'error'` block:

```tsx
      {phase === 'aborted' && (
        <div className="gen__result">
          <p>Run stopped. No leads from this run were saved.</p>
          <button type="button" className="btn" onClick={reset}>
            Start over
          </button>
        </div>
      )}
```

Add the dialog just before the closing `</section>`:

```tsx
      <ConfirmDialog
        open={confirmOpen}
        title="Stop this run?"
        message="Apify scraping will be aborted and no leads from this run will be saved."
        confirmLabel="Stop run"
        danger
        onConfirm={() => {
          setConfirmOpen(false)
          void abort()
        }}
        onCancel={() => setConfirmOpen(false)}
      />
    </section>
```

- [ ] **Step 3: Add the remaining styles**

Append to `web/src/index.css`:

```css
.runbar__stop {
  flex: none;
  border: 1px solid #e2b3a6;
  background: #fff;
  border-radius: 8px;
  padding: 4px 12px;
  font-size: 12.5px;
  font-weight: 550;
  color: #b42318;
  cursor: pointer;
}

.runbar__stop:hover {
  border-color: #d98a76;
  background: #fdf3f0;
}

.runbar__stop:disabled {
  opacity: 0.6;
  cursor: default;
}

.runbar--stopped {
  border-color: var(--muted-2);
  background: var(--paper-alt);
}

.runbar--stopped .runbar__label {
  color: var(--ink-soft);
}

.gen__go-group {
  display: inline-flex;
  gap: 8px;
  align-items: center;
}
```

- [ ] **Step 4: Verify it builds and lints**

Run: `cd web && npm run build && npm run lint`
Expected: build succeeds (no TS errors, no unused-symbol errors now that `abort`/`aborting`/`ConfirmDialog` are consumed), lint clean.

- [ ] **Step 5: Manual smoke test**

With the backend running (`APIFY_TOKEN` set) and `cd web && npm run dev`:
1. Start a generation; confirm the floating bar shows a **Stop** button while running.
2. Click **Stop** → the modal appears; click **Cancel** → it dismisses, run continues.
3. Click **Stop** → **Stop run** → button shows "Stopping…", then the bar flips to a neutral "Run stopped"; verify in the DB/leads view that **no** new leads were saved for that run, and (if Apify is reachable) the actor run shows ABORTED in the Apify console.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/RunWidget.tsx web/src/components/GenerateSection.tsx web/src/index.css
git commit -m "feat(web): Stop button + confirm modal on run bar and Generate view"
```

---

## Self-Review notes

- **Spec coverage:** registry/`request_abort` (T2) ✓; `.start()`+poll + `on_run_start` (T1) ✓; `should_abort` checks at top/between-chunks/classify-loop (T1) ✓; `RunAborted` → `aborted` not `failed`, no leads saved (T2) ✓; endpoint 404 / idempotent / best-effort Apify abort / orphan handling (T3) ✓; `abortRun` (T4) ✓; `aborting`+`abort` context (T4) ✓; `aborted` phase + neutral bar (T4/T6) ✓; `ConfirmDialog`, no native dialog (T5) ✓; Stop in both run bar and Generate view (T6) ✓; clean-discard non-goal honored ✓; all three backend test groups present (T1/T2/T3) ✓.
- **Type consistency:** `should_abort`/`on_run_start` names identical across `collect_leads`, `run_maps_lookup`, `no_website.run`, `execute_run`. `abortRun`, `abort`, `aborting`, `confirmOpen`, `RunPhase 'aborted'`, `runbar--stopped` consistent across frontend tasks.
- **Note on `.call()` removal:** after T1, `_check_run` (object-shape) is unused — its only caller was the `run_maps_lookup` line T1 replaces. The repo has no Python linter in CI (only `oxlint` for `web/`), so an unused helper is harmless. Leaving it in place is fine and keeps the diff focused; deleting it is optional and out of scope.
