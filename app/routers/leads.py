import csv
import io

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app import store
from app.auth import require_auth
from app.db import connect

router = APIRouter(prefix="/api/leads", tags=["leads"], dependencies=[Depends(require_auth)])

_CSV_COLS = ["business_name", "category", "web_status", "tier", "heat", "rating",
             "reviews_count", "phone", "website", "suburb", "address",
             "google_maps_url", "created_at"]


def get_conn():
    conn = connect()
    try:
        yield conn
    finally:
        conn.close()


def _filters(engine, status, category, web_status, industry, suburb, q,
             bucket, phone_only, run_id, sort):
    return dict(engine=engine, status=status, category=category,
                web_status=web_status, industry=industry, suburb=suburb, q=q,
                bucket=bucket, phone_only=phone_only, run_id=run_id, sort=sort)


@router.get("")
def list_leads(conn=Depends(get_conn), engine: str | None = None,
               status: str | None = None, category: str | None = None,
               web_status: str | None = None, industry: str | None = None,
               suburb: str | None = None, q: str | None = None,
               bucket: str | None = None, phone_only: bool = False,
               run_id: int | None = None, sort: str = "tier",
               page: int = 1, page_size: int = 50):
    return store.query_leads(
        conn, **_filters(engine, status, category, web_status, industry, suburb,
                         q, bucket, phone_only, run_id, sort),
        page=page, page_size=page_size)


@router.get("/stats")
def stats(conn=Depends(get_conn)):
    return store.lead_stats(conn)


@router.get("/facets")
def facets(conn=Depends(get_conn), engine: str | None = None):
    return store.lead_facets(conn, engine)


@router.get("/export.csv")
def export_csv(conn=Depends(get_conn), engine: str | None = None,
               status: str | None = None, category: str | None = None,
               web_status: str | None = None, industry: str | None = None,
               suburb: str | None = None, q: str | None = None,
               bucket: str | None = None, phone_only: bool = False,
               run_id: int | None = None, sort: str = "tier"):
    res = store.query_leads(
        conn, **_filters(engine, status, category, web_status, industry, suburb,
                         q, bucket, phone_only, run_id, sort),
        page=1, page_size=200)
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=_CSV_COLS, extrasaction="ignore")
    writer.writeheader()
    for item in res["items"]:
        writer.writerow(item)
    buf.seek(0)
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=leads.csv"})


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
