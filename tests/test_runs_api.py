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
