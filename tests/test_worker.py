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
