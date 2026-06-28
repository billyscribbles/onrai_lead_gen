"""Background run executor: drives an engine and persists its leads."""
from __future__ import annotations

import threading

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


def _now(conn) -> str:
    return conn.execute("SELECT datetime('now') t").fetchone()["t"]


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
