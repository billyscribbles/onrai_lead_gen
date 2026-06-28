from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app import cost, store, worker
from app.auth import require_auth
from app.db import connect
from app.engines.registry import ENGINES

router = APIRouter(prefix="/api/runs", tags=["runs"], dependencies=[Depends(require_auth)])


def get_conn():
    conn = connect()
    try:
        yield conn
    finally:
        conn.close()


class EstimateBody(BaseModel):
    engine: str
    params: dict


class CreateRunBody(BaseModel):
    engine: str
    params: dict
    confirmed_estimate: float


@router.post("/estimate")
def estimate(body: EstimateBody):
    if body.engine not in ENGINES:
        raise HTTPException(404, "Unknown engine")
    return cost.estimate(body.engine, body.params)


@router.post("", status_code=201)
def create_run(body: CreateRunBody, conn=Depends(get_conn)):
    if body.engine not in ENGINES:
        raise HTTPException(404, "Unknown engine")
    rid = store.create_run(conn, body.engine, body.params, "running",
                           body.confirmed_estimate)
    worker.launch_run_async(rid)
    return {"run_id": rid}


@router.get("")
def list_runs(conn=Depends(get_conn)):
    return store.list_runs(conn)


@router.get("/{run_id}")
def get_run(run_id: int, conn=Depends(get_conn)):
    run = store.get_run(conn, run_id)
    if not run:
        raise HTTPException(404, "No such run")
    return run
