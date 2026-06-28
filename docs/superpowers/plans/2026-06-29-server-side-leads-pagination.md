# Server-side Leads Pagination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move leads filtering, tiering, sorting, faceting, and pagination from the in-memory React client to the FastAPI/SQLite backend, with a numbered Prev/Next pager, so the dashboard only ever loads one page.

**Architecture:** The backend's `query_leads` becomes the single owner of filters + the `hot`/`newest` sorts; a new `lead_facets` provides global pool counts and dropdown options; a ported `industry_group` SQLite function powers industry filtering/faceting. The React side becomes param-driven: `useLeads(filters, page)` fetches one page + facets, and a `Pager` walks pages.

**Tech Stack:** Python 3 / FastAPI / SQLite (stdlib `sqlite3`), pytest. React 19 / TypeScript / Vite, oxlint. No new dependencies.

## Global Constraints

- **No schema/migration changes.** The `leads` table already has every column needed.
- **Engine is always `no_website`** for this app (`ENGINE` in `web/src/lib/api.ts`).
- **Reliable buckets are `social_only` and `none`** (per CLAUDE.md); `social_only` ranks above `none`. The tier ordering below encodes this and must not change.
- **Facets are global** — counts and dropdown options reflect the whole pool for the engine, NOT the active refine filters.
- **The industry-group regex is duplicated** TS↔Python on purpose; each copy carries a comment pointing at the other and they must stay in sync.
- **Backend tests:** `pytest -q` from repo root (root `conftest.py` makes the package importable). No network in tests — use a throwaway SQLite DB via `db.connect(str(tmp_path / "leads.db"))` + `db.init_db(conn)`.
- **Frontend gate:** `cd web && npm run build` (runs `tsc -b` typecheck + vite build) and `npm run lint` (oxlint). There is no frontend unit-test runner; frontend tasks are gated on a clean typecheck + lint plus the stated manual smoke check.

---

### Task 1: `app/industry.py` — port the industry grouping to Python

**Files:**
- Create: `app/industry.py`
- Test: `tests/test_industry.py`

**Interfaces:**
- Produces:
  - `industry_group(category: str) -> str` — first matching group label, else `"Other"`; blank → `"Other"`.
  - `industry_options(categories: Iterable[str]) -> list[str]` — distinct groups present, in canonical `GROUPS` order, `"Other"` last.
  - `GROUP_LABELS: list[str]` — canonical order of the eight group labels (no `"Other"`).

- [ ] **Step 1: Write the failing test**

Create `tests/test_industry.py`:

```python
"""Pure-logic tests for the Python industry grouping (mirror of industry.ts)."""

from app.industry import industry_group, industry_options


def test_food_group():
    assert industry_group("Coffee shop") == "Food & drink"
    assert industry_group("Italian restaurant") == "Food & drink"


def test_beauty_before_retail_catchall():
    # "Barber shop" must land in Beauty, not be swallowed by the "shop" catch-all.
    assert industry_group("Barber shop") == "Beauty & grooming"


def test_retail_catchall():
    assert industry_group("Gift store") == "Retail & shops"


def test_blank_and_unknown_are_other():
    assert industry_group("") == "Other"
    assert industry_group("   ") == "Other"
    assert industry_group("Wizarding supplies") == "Other"


def test_options_ordered_with_other_last():
    opts = industry_options(["Gift store", "Cafe", "Wizarding supplies", "Barber"])
    assert opts == ["Food & drink", "Beauty & grooming", "Retail & shops", "Other"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_industry.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.industry'`

- [ ] **Step 3: Write the implementation**

Create `app/industry.py` (regex patterns copied verbatim from `web/src/lib/industry.ts` — keep order identical):

```python
"""Bundle granular Google Maps categories into a few industry groups.

MIRROR of web/src/lib/industry.ts — the two MUST stay in sync. The frontend copy
renders the dropdown; this copy powers the server-side `industry` filter and the
facet options (registered as the SQLite `industry_group` function in app/db.py).

Order matters: the first group whose pattern matches wins, so specific groups
(food, beauty) come before the broad "Retail & shops" catch-all.
"""
from __future__ import annotations

import re
from typing import Iterable

_GROUPS: list[tuple[str, re.Pattern]] = [
    ("Food & drink", re.compile(
        r"\b(restaurant|cafe|café|coffee|bakery|bakehouse|takeaway|take ?away|"
        r"pizz|eatery|diner|bistro|brasserie|grill|brunch|dessert|patisser|deli|"
        r"caterer|catering|juice|smoothie|sushi|ramen|noodle|bbq|steakhouse|gelato|"
        r"ice cream|brewery|wine bar|\bbar\b|\bpub\b|tavern|food)", re.I)),
    ("Beauty & grooming", re.compile(
        r"\b(salon|barber|hairdress|hair|nail|beauty|lash|brow|wax|makeup|make ?up|"
        r"tanning|cosmetic|aesthetic|\bspa\b)", re.I)),
    ("Health & wellness", re.compile(
        r"\b(dentist|dental|doctor|clinic|physio|chiro|massage|wellness|gym|fitness|"
        r"yoga|pilates|medical|pharmacy|chemist|optometr|optician|podiatr|psycholog|"
        r"therap|osteo|acupunctur|health)", re.I)),
    ("Pets", re.compile(
        r"\b(veterin|\bvet\b|pet|dog|\bcat\b|grooming|kennel|cattery|aquarium)", re.I)),
    ("Automotive", re.compile(
        r"\b(mechanic|auto|\bcar\b|car wash|vehicle|tyre|tire|panel beat|detailing|"
        r"smash repair|automotive)", re.I)),
    ("Trades & home services", re.compile(
        r"\b(plumb|electric|builder|building|carpentr|carpenter|landscap|garden|"
        r"painter|painting|roof|handyman|cleaning|cleaner|removal|locksmith|"
        r"contractor|renovat|tiler|tiling|glazier|fencing|paving|concret|"
        r"air ?conditioning|hvac|pest control|flooring|plaster|waterproof|solar|"
        r"joinery|cabinet)", re.I)),
    ("Professional services", re.compile(
        r"\b(lawyer|solicitor|attorney|accountant|accounting|bookkeep|consult|"
        r"real estate|realtor|estate agent|insurance|financ|mortgage|broker|"
        r"marketing|advertis|photograph|architect|surveyor|recruit|migration agent|"
        r"notary)", re.I)),
    ("Retail & shops", re.compile(
        r"\b(shop|store|boutique|florist|jewell|clothing|apparel|grocer|supermarket|"
        r"market|butcher|gift|furniture|homeware|nursery|bookshop|bookstore|optic|"
        r"tobacc|liquor|cellar)", re.I)),
]

_OTHER = "Other"
GROUP_LABELS: list[str] = [label for label, _ in _GROUPS]


def industry_group(category: str) -> str:
    """Map one raw category to its bundled industry group."""
    c = (category or "").strip().lower()
    if not c:
        return _OTHER
    for label, pattern in _GROUPS:
        if pattern.search(c):
            return label
    return _OTHER


def industry_options(categories: Iterable[str]) -> list[str]:
    """Distinct groups present, in canonical order, with 'Other' last."""
    present = {industry_group(c) for c in categories}
    ordered = [g for g in GROUP_LABELS if g in present]
    if _OTHER in present:
        ordered.append(_OTHER)
    return ordered
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_industry.py -q`
Expected: PASS (5 passed)

- [ ] **Step 5: Commit**

```bash
git add app/industry.py tests/test_industry.py
git commit -m "feat(app): port industry grouping to Python for server-side faceting"
```

---

### Task 2: Register `industry_group` as a SQLite function

**Files:**
- Modify: `app/db.py` (the `connect()` function, lines 63-69)
- Test: `tests/test_industry.py` (append)

**Interfaces:**
- Consumes: `industry_group` from Task 1.
- Produces: every connection from `db.connect()` can use `industry_group(category)` in SQL (`WHERE` / `GROUP BY`).

- [ ] **Step 1: Write the failing test**

Append to `tests/test_industry.py`:

```python
from app import db


def test_industry_group_registered_as_sql_function(tmp_path):
    conn = db.connect(str(tmp_path / "leads.db"))
    db.init_db(conn)
    row = conn.execute(
        "SELECT industry_group(?) AS g", ("Coffee shop",)).fetchone()
    assert row["g"] == "Food & drink"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_industry.py::test_industry_group_registered_as_sql_function -q`
Expected: FAIL — `sqlite3.OperationalError: no such function: industry_group`

- [ ] **Step 3: Implement**

In `app/db.py`, add the import near the top (with the other `from app import ...`):

```python
from app.industry import industry_group
```

Then in `connect()`, register the function before returning. Replace:

```python
    conn = sqlite3.connect(path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn
```

with:

```python
    conn = sqlite3.connect(path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    # Lets SQL filter/group by industry bucket (see app/industry.py).
    conn.create_function("industry_group", 1, industry_group, deterministic=True)
    return conn
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_industry.py -q`
Expected: PASS (6 passed)

- [ ] **Step 5: Commit**

```bash
git add app/db.py tests/test_industry.py
git commit -m "feat(app): register industry_group SQLite function on every connection"
```

---

### Task 3: `query_leads` — new filters + real sorts

**Files:**
- Modify: `app/store.py` (`query_leads`, lines 140-160; `_SORTABLE` stays at line 14)
- Test: `tests/test_leads_query.py` (create)

**Interfaces:**
- Consumes: the registered `industry_group` function (Task 2).
- Produces:
  ```python
  query_leads(conn, *, engine=None, status=None, web_status=None, industry=None,
              suburb=None, q=None, bucket=None, phone_only=False, run_id=None,
              sort="reviews_count", page=1, page_size=50) -> dict
  ```
  Returns `{"items": [lead_dict], "total": int, "page": int, "page_size": int}`.
  - `status`: `"top"` → `web_status='social_only' AND phone present`; `"all"`/`None` → ignored; any other value → treated as a `web_status`.
  - `bucket`: `"active"` → not archived; `"favourites"`/`"archived"` → exact; `None` → ignored.
  - `sort`: `"hot"` → tier asc, reviews desc, rating desc; `"newest"` → created_at desc then same tie-breakers; else single-column (existing behaviour).

- [ ] **Step 1: Write the failing tests**

Create `tests/test_leads_query.py`:

```python
"""query_leads filtering, sorting, and pagination against a throwaway DB."""

from app import db, store


def _db(tmp_path):
    conn = db.connect(str(tmp_path / "leads.db"))
    db.init_db(conn)
    return conn


def _seed(conn):
    run_id = store.create_run(conn, "no_website", {}, "done", 0.0)
    leads = [
        # social_only + phone -> tier 1 ("top")
        dict(business_name="Lavish Barbers", category="Barber shop",
             suburb="Melbourne", phone="0400000001", website="instagram.com/lav",
             web_status="social_only", rating=4.8, reviews_count=1493),
        # social_only, no phone -> tier 2
        dict(business_name="Glow Salon", category="Beauty salon",
             suburb="Richmond", phone="", website="instagram.com/glow",
             web_status="social_only", rating=4.5, reviews_count=200),
        # none + phone -> tier 3
        dict(business_name="Mr Baxter Cafe", category="Cafe",
             suburb="West Footscray", phone="0400000003", website="",
             web_status="none", rating=4.6, reviews_count=69),
        # none, no phone -> tier 4
        dict(business_name="Quiet Books", category="Bookshop",
             suburb="Richmond", phone="", website="",
             web_status="none", rating=4.0, reviews_count=10),
    ]
    full = [dict(address="", email="", google_maps_url="", extra={},
                 place_id=f"PID-{i}", **l) for i, l in enumerate(leads)]
    store.insert_leads(conn, run_id, "no_website", full)
    return run_id


def test_status_top_only_returns_tier1(tmp_path):
    conn = _db(tmp_path); _seed(conn)
    res = store.query_leads(conn, engine="no_website", status="top")
    names = [i["business_name"] for i in res["items"]]
    assert names == ["Lavish Barbers"]
    assert res["total"] == 1


def test_status_passthrough_web_status(tmp_path):
    conn = _db(tmp_path); _seed(conn)
    res = store.query_leads(conn, engine="no_website", status="none")
    assert {i["business_name"] for i in res["items"]} == {"Mr Baxter Cafe", "Quiet Books"}


def test_phone_only(tmp_path):
    conn = _db(tmp_path); _seed(conn)
    res = store.query_leads(conn, engine="no_website", phone_only=True)
    assert {i["business_name"] for i in res["items"]} == {"Lavish Barbers", "Mr Baxter Cafe"}


def test_industry_filter(tmp_path):
    conn = _db(tmp_path); _seed(conn)
    res = store.query_leads(conn, engine="no_website", industry="Food & drink")
    assert [i["business_name"] for i in res["items"]] == ["Mr Baxter Cafe"]


def test_search_matches_category_and_suburb(tmp_path):
    conn = _db(tmp_path); _seed(conn)
    # "Richmond" matches by suburb, not by business_name.
    res = store.query_leads(conn, engine="no_website", q="Richmond")
    assert {i["business_name"] for i in res["items"]} == {"Glow Salon", "Quiet Books"}


def test_bucket_archived_and_active(tmp_path):
    conn = _db(tmp_path); _seed(conn)
    lead_id = store.query_leads(conn, engine="no_website", q="Quiet")["items"][0]["id"]
    store.set_lead_status(conn, lead_id, "archived")
    active = store.query_leads(conn, engine="no_website", bucket="active")
    assert "Quiet Books" not in {i["business_name"] for i in active["items"]}
    archived = store.query_leads(conn, engine="no_website", bucket="archived")
    assert [i["business_name"] for i in archived["items"]] == ["Quiet Books"]


def test_run_id_filter(tmp_path):
    conn = _db(tmp_path); run_id = _seed(conn)
    res = store.query_leads(conn, engine="no_website", run_id=run_id)
    assert res["total"] == 4
    assert store.query_leads(conn, engine="no_website", run_id=run_id + 999)["total"] == 0


def test_sort_hot_tier_order(tmp_path):
    conn = _db(tmp_path); _seed(conn)
    res = store.query_leads(conn, engine="no_website", sort="hot")
    assert [i["business_name"] for i in res["items"]] == [
        "Lavish Barbers", "Glow Salon", "Mr Baxter Cafe", "Quiet Books"]


def test_pagination_total_vs_items(tmp_path):
    conn = _db(tmp_path); _seed(conn)
    res = store.query_leads(conn, engine="no_website", sort="hot", page=1, page_size=2)
    assert res["total"] == 4
    assert [i["business_name"] for i in res["items"]] == ["Lavish Barbers", "Glow Salon"]
    res2 = store.query_leads(conn, engine="no_website", sort="hot", page=2, page_size=2)
    assert [i["business_name"] for i in res2["items"]] == ["Mr Baxter Cafe", "Quiet Books"]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_leads_query.py -q`
Expected: FAIL — `TypeError: query_leads() got an unexpected keyword argument 'status'`

- [ ] **Step 3: Implement**

Replace `query_leads` in `app/store.py` (lines 140-160) with:

```python
def query_leads(conn, *, engine=None, status=None, web_status=None,
                industry=None, suburb=None, q=None, bucket=None,
                phone_only=False, run_id=None, sort="reviews_count",
                page=1, page_size=50) -> dict:
    where, args = [], []
    if engine:
        where.append("engine=?"); args.append(engine)
    if run_id is not None:
        where.append("run_id=?"); args.append(run_id)

    # status: "top" is a derived tier; "all"/None is a no-op; anything else is a
    # web_status value. An explicit web_status= arg is the back-compat fallback.
    if status == "top":
        where.append("web_status='social_only' AND TRIM(COALESCE(phone,''))!=''")
    elif status and status != "all":
        where.append("web_status=?"); args.append(status)
    elif web_status:
        where.append("web_status=?"); args.append(web_status)

    if industry:
        where.append("industry_group(category)=?"); args.append(industry)
    if suburb:
        where.append("suburb=?"); args.append(suburb)
    if phone_only:
        where.append("TRIM(COALESCE(phone,''))!=''")
    if bucket == "active":
        where.append("user_status!='archived'")
    elif bucket in ("favourites", "archived"):
        where.append("user_status=?")
        args.append("favourite" if bucket == "favourites" else "archived")
    if q:
        where.append("(business_name LIKE ? OR category LIKE ? OR suburb LIKE ?)")
        args += [f"%{q}%", f"%{q}%", f"%{q}%"]

    clause = ("WHERE " + " AND ".join(where)) if where else ""

    # tier ranking mirrors web/src/lib/leads.ts: social_only+phone, social_only,
    # none+phone, none, then redesign buckets. Within a tier: reviews then rating.
    tier_case = (
        "CASE"
        " WHEN web_status='social_only' AND TRIM(COALESCE(phone,''))!='' THEN 1"
        " WHEN web_status='social_only' THEN 2"
        " WHEN web_status='none' AND TRIM(COALESCE(phone,''))!='' THEN 3"
        " WHEN web_status='none' THEN 4"
        " ELSE 5 END")
    tie = "reviews_count IS NULL, reviews_count DESC, rating IS NULL, rating DESC"
    if sort == "hot":
        order = f"ORDER BY {tier_case} ASC, {tie}"
    elif sort == "newest":
        order = f"ORDER BY created_at DESC, {tier_case} ASC, {tie}"
    else:
        sort_col = sort if sort in _SORTABLE else "reviews_count"
        order = f"ORDER BY {sort_col} IS NULL, {sort_col} DESC" \
            if sort_col != "business_name" else "ORDER BY business_name ASC"

    total = conn.execute(f"SELECT COUNT(*) c FROM leads {clause}", args).fetchone()["c"]
    page = max(1, int(page)); page_size = max(1, min(int(page_size), 500))
    rows = conn.execute(
        f"SELECT * FROM leads {clause} {order} LIMIT ? OFFSET ?",
        (*args, page_size, (page - 1) * page_size)).fetchall()
    return {"items": [_lead_to_dict(r) for r in rows], "total": total,
            "page": page, "page_size": page_size}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_leads_query.py -q`
Expected: PASS (9 passed)

- [ ] **Step 5: Run the full suite to check nothing regressed**

Run: `pytest -q`
Expected: PASS (the existing `test_leads_api.py` / `test_store.py` still green — `query_leads` keeps the old keyword names `engine`/`suburb`/`q`/`sort`/`page`/`page_size`).

- [ ] **Step 6: Commit**

```bash
git add app/store.py tests/test_leads_query.py
git commit -m "feat(app): query_leads gains status/bucket/industry/phone/run filters + hot/newest sorts"
```

---

### Task 4: `lead_facets` — global pool counts + dropdown options

**Files:**
- Modify: `app/store.py` (add `lead_facets` after `query_leads`)
- Test: `tests/test_leads_query.py` (append)

**Interfaces:**
- Consumes: `industry_group` SQL function (Task 2), `industry_options` (Task 1, import at top of `store.py`).
- Produces:
  ```python
  lead_facets(conn, engine=None) -> dict
  # {"total": int, "top": int, "social_only": int, "none": int,
  #  "reachable": int, "industries": [str], "suburbs": [str]}
  ```
  Counts are global for the engine (ignore refine filters). `reachable` = phone present OR website looks like a URL. `industries` in `industry_options` order; `suburbs` distinct non-empty, sorted.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_leads_query.py`:

```python
def test_lead_facets(tmp_path):
    conn = _db(tmp_path); _seed(conn)
    f = store.lead_facets(conn, "no_website")
    assert f["total"] == 4
    assert f["top"] == 1            # Lavish Barbers (social_only + phone)
    assert f["social_only"] == 2
    assert f["none"] == 2
    # reachable: Lavish (phone+site), Glow (site), Baxter (phone) = 3; Quiet has neither.
    assert f["reachable"] == 3
    assert f["industries"] == ["Food & drink", "Beauty & grooming", "Retail & shops"]
    assert f["suburbs"] == ["Melbourne", "Richmond", "West Footscray"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_leads_query.py::test_lead_facets -q`
Expected: FAIL — `AttributeError: module 'app.store' has no attribute 'lead_facets'`

- [ ] **Step 3: Implement**

At the top of `app/store.py`, extend the existing import:

```python
from app import normalize
from app.industry import industry_options
```

Add after `query_leads`:

```python
def lead_facets(conn, engine=None) -> dict:
    """Global pool stats for the dashboard chrome (counts + dropdown options).

    Intentionally ignores the active refine filters: the StatStrip and filter
    counts describe the whole pool, not the current page's filter selection.
    """
    where = "WHERE engine=?" if engine else ""
    args = (engine,) if engine else ()

    def scalar(expr):
        return conn.execute(
            f"SELECT COUNT(*) c FROM leads {where} {'AND' if where else 'WHERE'} {expr}",
            args).fetchone()["c"]

    total = conn.execute(
        f"SELECT COUNT(*) c FROM leads {where}", args).fetchone()["c"]
    top = scalar("web_status='social_only' AND TRIM(COALESCE(phone,''))!=''")
    social_only = scalar("web_status='social_only'")
    none = scalar("web_status='none'")
    reachable = scalar(
        "TRIM(COALESCE(phone,''))!='' OR COALESCE(website,'') LIKE 'http%' "
        "OR COALESCE(website,'') LIKE '%instagram%' "
        "OR COALESCE(website,'') LIKE '%facebook%' OR COALESCE(website,'') LIKE '%tiktok%'")
    cats = [r["category"] for r in conn.execute(
        f"SELECT DISTINCT category FROM leads {where}", args)]
    subs = sorted({r["suburb"] for r in conn.execute(
        f"SELECT DISTINCT suburb FROM leads {where}", args) if r["suburb"]})
    return {"total": total, "top": top, "social_only": social_only,
            "none": none, "reachable": reachable,
            "industries": industry_options(cats), "suburbs": subs}
```

Note on `reachable`: the frontend treats any social/URL website as "reachable". Seed websites are bare `instagram.com/...` (no `http`), so the LIKE list above covers them; keep it aligned with `socialOf` in `web/src/lib/leads.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_leads_query.py::test_lead_facets -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/store.py tests/test_leads_query.py
git commit -m "feat(app): lead_facets for global pool counts and dropdown options"
```

---

### Task 5: Router — pass new filters through + `/facets` endpoint

**Files:**
- Modify: `app/routers/leads.py` (`_filters`, `list_leads`, add `facets`, thread into `export_csv`)
- Test: `tests/test_leads_api.py` (append)

**Interfaces:**
- Consumes: `store.query_leads` (Task 3), `store.lead_facets` (Task 4).
- Produces:
  - `GET /api/leads` accepts `status, web_status, industry, suburb, q, bucket, phone_only, run_id, sort, page, page_size`.
  - `GET /api/leads/facets` → `store.lead_facets(conn, engine)`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_leads_api.py` (the existing `client` fixture seeds one `none`+phone lead named "Test Cafe"):

```python
def test_list_leads_status_top_excludes_non_tier1(client):
    c, _ = client
    resp = c.get("/api/leads", params={"status": "top"})
    assert resp.status_code == 200
    assert resp.json()["total"] == 0  # the seeded lead is 'none', not tier 1


def test_list_leads_pagination_shape(client):
    c, _ = client
    body = c.get("/api/leads", params={"page": 1, "page_size": 10}).json()
    assert set(body) == {"items", "total", "page", "page_size"}
    assert body["page"] == 1 and body["page_size"] == 10


def test_facets_endpoint(client):
    c, _ = client
    body = c.get("/api/leads/facets", params={"engine": "no_website"}).json()
    assert body["total"] == 1
    assert body["none"] == 1
    assert "Food & drink" in body["industries"]   # "Cafe"
    assert body["suburbs"] == ["Footscray"]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_leads_api.py -q`
Expected: FAIL — `/api/leads/facets` returns 404 / `status` param ignored.

- [ ] **Step 3: Implement**

Replace `_filters` and `list_leads` and add the facets route in `app/routers/leads.py`:

```python
def _filters(engine, status, web_status, industry, suburb, q, bucket,
             phone_only, run_id, sort):
    return dict(engine=engine, status=status, web_status=web_status,
                industry=industry, suburb=suburb, q=q, bucket=bucket,
                phone_only=phone_only, run_id=run_id, sort=sort)


@router.get("")
def list_leads(conn=Depends(get_conn), engine: str | None = None,
               status: str | None = None, web_status: str | None = None,
               industry: str | None = None, suburb: str | None = None,
               q: str | None = None, bucket: str | None = None,
               phone_only: bool = False, run_id: int | None = None,
               sort: str = "reviews_count", page: int = 1, page_size: int = 50):
    return store.query_leads(
        conn, **_filters(engine, status, web_status, industry, suburb, q,
                         bucket, phone_only, run_id, sort),
        page=page, page_size=page_size)


@router.get("/facets")
def facets(conn=Depends(get_conn), engine: str | None = None):
    return store.lead_facets(conn, engine)
```

Update `export_csv` to accept and thread the same filters (so an export matches the screen). Replace its signature + the `query_leads` call:

```python
@router.get("/export.csv")
def export_csv(conn=Depends(get_conn), engine: str | None = None,
               status: str | None = None, web_status: str | None = None,
               industry: str | None = None, suburb: str | None = None,
               q: str | None = None, bucket: str | None = None,
               phone_only: bool = False, run_id: int | None = None,
               sort: str = "reviews_count"):
    res = store.query_leads(
        conn, **_filters(engine, status, web_status, industry, suburb, q,
                         bucket, phone_only, run_id, sort),
        page=1, page_size=200)
```

(The body that writes the CSV is unchanged.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_leads_api.py -q`
Expected: PASS (existing PATCH tests + 3 new ones).

- [ ] **Step 5: Run full suite**

Run: `pytest -q`
Expected: PASS (all green).

- [ ] **Step 6: Commit**

```bash
git add app/routers/leads.py tests/test_leads_api.py
git commit -m "feat(api): leads list takes new filters + add /api/leads/facets"
```

---

### Task 6: Frontend API client — `fetchLeads(params)` + `fetchFacets`

**Files:**
- Modify: `web/src/lib/api.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface LeadQuery {
    page?: number; page_size?: number; sort?: 'hot' | 'newest'
    status?: string; bucket?: string; industry?: string; suburb?: string
    q?: string; phone_only?: boolean; run_id?: number
  }
  export interface Facets {
    total: number; top: number; social_only: number; none: number
    reachable: number; industries: string[]; suburbs: string[]
  }
  export function fetchLeads(params: LeadQuery):
    Promise<{ items: ApiLead[]; total: number; page: number; page_size: number }>
  export function fetchFacets(): Promise<Facets>
  ```

- [ ] **Step 1: Implement**

In `web/src/lib/api.ts`, replace the existing `fetchLeads` (lines 88-92) with the param-driven version and add `fetchFacets` + the types:

```ts
/** Filters/paging accepted by GET /api/leads. Empty values are omitted. */
export interface LeadQuery {
  page?: number
  page_size?: number
  sort?: 'hot' | 'newest'
  status?: string
  bucket?: string
  industry?: string
  suburb?: string
  q?: string
  phone_only?: boolean
  run_id?: number
}

/** Global pool stats from GET /api/leads/facets. */
export interface Facets {
  total: number
  top: number
  social_only: number
  none: number
  reachable: number
  industries: string[]
  suburbs: string[]
}

function leadQueryString(params: LeadQuery): string {
  const sp = new URLSearchParams({ engine: ENGINE })
  if (params.page) sp.set('page', String(params.page))
  if (params.page_size) sp.set('page_size', String(params.page_size))
  if (params.sort) sp.set('sort', params.sort)
  if (params.status && params.status !== 'all') sp.set('status', params.status)
  if (params.bucket) sp.set('bucket', params.bucket)
  if (params.industry) sp.set('industry', params.industry)
  if (params.suburb) sp.set('suburb', params.suburb)
  if (params.q?.trim()) sp.set('q', params.q.trim())
  if (params.phone_only) sp.set('phone_only', 'true')
  if (params.run_id != null) sp.set('run_id', String(params.run_id))
  return sp.toString()
}

export function fetchLeads(
  params: LeadQuery,
): Promise<{ items: ApiLead[]; total: number; page: number; page_size: number }> {
  return fetch(`/api/leads?${leadQueryString(params)}`, {
    credentials: 'include',
  }).then(json<{ items: ApiLead[]; total: number; page: number; page_size: number }>)
}

export function fetchFacets(): Promise<Facets> {
  return fetch(`/api/leads/facets?engine=${ENGINE}`, {
    credentials: 'include',
  }).then(json<Facets>)
}
```

- [ ] **Step 2: Typecheck**

Run: `cd web && npm run build`
Expected: will FAIL in `web/src/lib/leads.ts` because `loadLeads` calls `fetchLeads()` with no args — that's fixed in Task 7. Confirm the only errors are in `leads.ts` (the `api.ts` types themselves compile).

- [ ] **Step 3: Commit**

```bash
git add web/src/lib/api.ts
git commit -m "feat(web): param-driven fetchLeads + fetchFacets API client"
```

---

### Task 7: Frontend `loadLeads(params)` — pass through, server order

**Files:**
- Modify: `web/src/lib/leads.ts`

**Interfaces:**
- Consumes: `fetchLeads(params: LeadQuery)` (Task 6).
- Produces: `loadLeads(params: LeadQuery): Promise<{ leads: Lead[]; total: number }>`. Server order preserved (no `sortLeads`). `toLead` and helpers unchanged.

- [ ] **Step 1: Implement**

In `web/src/lib/leads.ts`, change the import and replace `loadLeads` (lines 107-114). Update the import line:

```ts
import { fetchLeads, type ApiLead, type LeadQuery } from './api'
```

Replace `loadLeads`:

```ts
/** Fetch one page from the backend + classify. Server owns filter/sort/paging. */
export async function loadLeads(
  params: LeadQuery,
): Promise<{ leads: Lead[]; total: number }> {
  const { items, total } = await fetchLeads(params)
  const leads = items.map((item, i) =>
    toLead(apiLeadToRaw(item), i, item.id, normalizeStatus(item.user_status),
           item.created_at, item.run_id ?? null),
  )
  return { leads, total }
}
```

Leave `sortLeads` exported (still imported by `Dashboard.tsx` until Task 11 removes that use). After Task 11, if `sortLeads` is unused, delete it; oxlint in the Task 11 gate will flag it.

- [ ] **Step 2: Typecheck**

Run: `cd web && npm run build`
Expected: will FAIL in `web/src/hooks/useLeads.ts` / `Dashboard.tsx` (they still expect the old `loadLeads()` returning `Lead[]`) — fixed in Tasks 8 & 11. Confirm `leads.ts` itself compiles (no errors pointing inside `leads.ts`).

- [ ] **Step 3: Commit**

```bash
git add web/src/lib/leads.ts
git commit -m "feat(web): loadLeads takes a query and returns one server-ordered page"
```

---

### Task 8: `useLeads(filters, page)` — param-driven page + facets

**Files:**
- Modify: `web/src/hooks/useLeads.ts`

**Interfaces:**
- Consumes: `loadLeads` (Task 7), `fetchFacets` (Task 6), `patchLeadStatus`, the `Filters` type from `../components/FilterRail`.
- Produces:
  ```ts
  useLeads(filters: Filters, page: number, pageSize: number): {
    leads: Lead[]; total: number; facets: Facets | null
    loading: boolean; error: string | null
    reload: () => void
    setLeadStatus: (dbId: number, status: UserStatus) => void
  }
  ```
  Maps `filters` → `LeadQuery`, refetches the page when `filters`/`page` change (query debounced ~300ms). Facets fetched on mount + on `reload`.

- [ ] **Step 1: Implement**

Replace `web/src/hooks/useLeads.ts` entirely:

```ts
import { useCallback, useEffect, useRef, useState } from 'react'
import { loadLeads } from '../lib/leads'
import { fetchFacets, patchLeadStatus, type Facets, type LeadQuery } from '../lib/api'
import type { Filters } from '../components/FilterRail'
import type { Lead, UserStatus } from '../types'

interface State {
  leads: Lead[]
  total: number
  facets: Facets | null
  loading: boolean
  error: string | null
  reload: () => void
  setLeadStatus: (dbId: number, status: UserStatus) => void
}

/** Translate the UI filter state into the backend query params. */
function toQuery(filters: Filters, page: number, pageSize: number): LeadQuery {
  return {
    page,
    page_size: pageSize,
    sort: filters.sort,
    status: filters.status,
    bucket: filters.bucket,
    industry: filters.category || undefined,
    suburb: filters.suburb || undefined,
    q: filters.query || undefined,
    phone_only: filters.phoneOnly || undefined,
  }
}

export function useLeads(filters: Filters, page: number, pageSize: number): State {
  const [leads, setLeads] = useState<Lead[]>([])
  const [total, setTotal] = useState(0)
  const [facets, setFacets] = useState<Facets | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Bumped by reload() to force a refetch without changing filters/page.
  const [nonce, setNonce] = useState(0)

  const reload = useCallback(() => setNonce((n) => n + 1), [])

  // Fetch the current page. Debounced so typing in the search box doesn't fire a
  // request per keystroke. filters is a new object each render, so depend on its
  // fields, not its identity.
  const { query, status, category, suburb, phoneOnly, sort, bucket } = filters
  useEffect(() => {
    const q: LeadQuery = toQuery(
      { query, status, category, suburb, phoneOnly, sort, bucket }, page, pageSize)
    let cancelled = false
    const t = setTimeout(() => {
      setLoading(true)
      loadLeads(q)
        .then(({ leads: next, total: tot }) => {
          if (cancelled) return
          setLeads(next); setTotal(tot); setError(null)
        })
        .catch((e: unknown) => {
          if (cancelled) return
          setError(e instanceof Error ? e.message : 'Failed to load leads')
        })
        .finally(() => { if (!cancelled) setLoading(false) })
    }, 300)
    return () => { cancelled = true; clearTimeout(t) }
  }, [query, status, category, suburb, phoneOnly, sort, bucket, page, pageSize, nonce])

  // Facets are global; refetch only on mount and explicit reload.
  useEffect(() => {
    let cancelled = false
    fetchFacets()
      .then((f) => { if (!cancelled) setFacets(f) })
      .catch(() => { /* facets are chrome; ignore transient errors */ })
    return () => { cancelled = true }
  }, [nonce])

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
      setLeads((cur) =>
        cur.map((l) =>
          l.dbId === dbId && prev !== undefined ? { ...l, userStatus: prev } : l,
        ),
      )
      setError(e instanceof Error ? e.message : 'Failed to update lead')
    })
  }, [])

  return { leads, total, facets, loading, error, reload, setLeadStatus }
}
```

- [ ] **Step 2: Typecheck**

Run: `cd web && npm run build`
Expected: FAIL only in `Dashboard.tsx` (it still calls `useLeads()` with no args and references removed memos) — fixed in Task 11. Confirm no errors inside `useLeads.ts`.

- [ ] **Step 3: Commit**

```bash
git add web/src/hooks/useLeads.ts
git commit -m "feat(web): param-driven useLeads with debounced page fetch + facets"
```

---

### Task 9: `Pager` component

**Files:**
- Create: `web/src/components/Pager.tsx`
- Modify: `web/src/index.css` (append pager styles)

**Interfaces:**
- Produces: `Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (next: number) => void })`. Renders nothing when `total <= pageSize`.

- [ ] **Step 1: Implement the component**

Create `web/src/components/Pager.tsx`:

```tsx
interface Props {
  page: number
  pageSize: number
  total: number
  onPage: (next: number) => void
}

/** Numbered Prev/Next pager. Hidden when everything fits on one page. */
export function Pager({ page, pageSize, total, onPage }: Props) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  if (total <= pageSize) return null
  return (
    <nav className="pager" aria-label="Pagination">
      <button
        type="button"
        className="btn pager__btn"
        onClick={() => onPage(page - 1)}
        disabled={page <= 1}
      >
        ◀ Prev
      </button>
      <span className="pager__status">
        Page {page} of {pages}
      </span>
      <button
        type="button"
        className="btn pager__btn"
        onClick={() => onPage(page + 1)}
        disabled={page >= pages}
      >
        Next ▶
      </button>
    </nav>
  )
}
```

- [ ] **Step 2: Add styles**

Append to `web/src/index.css`:

```css
.pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  margin: 20px 0 8px;
}
.pager__status {
  font-size: 13px;
  color: var(--ink-soft, #667);
  min-width: 120px;
  text-align: center;
}
.pager__btn[disabled] {
  opacity: 0.4;
  cursor: not-allowed;
}
```

(If `--ink-soft` isn't a defined token, use an existing muted-text variable from `index.css`; check the `:root` block and match the surrounding convention.)

- [ ] **Step 3: Typecheck + lint**

Run: `cd web && npm run build && npm run lint`
Expected: PASS (component is self-contained; not yet imported).

- [ ] **Step 4: Commit**

```bash
git add web/src/components/Pager.tsx web/src/index.css
git commit -m "feat(web): Pager component (Prev/Next + page X of N)"
```

---

### Task 10: `StatStrip` reads facet metrics

**Files:**
- Modify: `web/src/components/StatStrip.tsx`

**Interfaces:**
- Produces: `StatStrip({ metrics, filters, onChange })` where `metrics: { total: number; top: number; social_only: number; none: number; reachable: number }`. Click behaviour unchanged.

- [ ] **Step 1: Implement**

In `web/src/components/StatStrip.tsx`, remove the `metrics()` helper and the `leads` prop; take a `metrics` object instead. Replace the top of the file through the `const m = metrics(leads)` line:

```tsx
import type { Filters, StatusFilter } from './FilterRail'

export interface StatMetrics {
  total: number
  top: number
  social_only: number
  none: number
  reachable: number
}

type StatItem = {
  label: string
  value: string
  tone: string
  hint?: string
  status?: StatusFilter
  toggle?: 'phoneOnly'
}

export function StatStrip({
  metrics: m,
  filters,
  onChange,
}: {
  metrics: StatMetrics
  filters: Filters
  onChange: (next: Partial<Filters>) => void
}) {
  const items: StatItem[] = [
    { label: 'Live leads', value: String(m.total), tone: 'ink', status: 'all' },
    {
      label: 'Top tier',
      value: String(m.top),
      tone: 'signal',
      hint: 'social + phone',
      status: 'top',
    },
    { label: 'Social only', value: String(m.social_only), tone: 'teal', status: 'social_only' },
    { label: 'No website', value: String(m.none), tone: 'ink', status: 'none' },
    { label: 'Reachable now', value: String(m.reachable), tone: 'ink', toggle: 'phoneOnly' },
  ]
```

(The rest of the component — `isActive`, `handle`, the returned JSX — is unchanged. The unused `Lead` import is removed.)

- [ ] **Step 2: Typecheck**

Run: `cd web && npm run build`
Expected: FAIL only in `Dashboard.tsx` (still passes `leads={leads}`) — fixed in Task 11. Confirm no errors inside `StatStrip.tsx`.

- [ ] **Step 3: Commit**

```bash
git add web/src/components/StatStrip.tsx
git commit -m "feat(web): StatStrip reads facet metrics instead of the full lead array"
```

---

### Task 11: Wire `Dashboard` to server paging + facets

**Files:**
- Modify: `web/src/components/Dashboard.tsx`
- Modify: `web/src/lib/leads.ts` (delete now-unused `sortLeads` if lint flags it)

**Interfaces:**
- Consumes: `useLeads(filters, page, pageSize)` (Task 8), `Pager` (Task 9), `StatStrip` with `metrics` (Task 10), `fetchLeads` for the run view (Task 6), `loadLeads` for the run view (Task 7).

- [ ] **Step 1: Rewrite the data wiring**

Edit `web/src/components/Dashboard.tsx`:

1. Update imports — drop `sortLeads`, add `Pager`, `loadLeads`, `StatMetrics`:

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLeads } from '../hooks/useLeads'
import { logout } from '../lib/api'
import { loadLeads } from '../lib/leads'
import { dateMs } from '../lib/format'
import type { Lead } from '../types'
import {
  FilterRail,
  type Filters,
  type StatusFilter,
} from './FilterRail'
import { StatStrip } from './StatStrip'
import { LeadRow } from './LeadRow'
import { LeadDrawer } from './LeadDrawer'
import { GenerateSection } from './GenerateSection'
import { RunWidget } from './RunWidget'
import { useActiveRun } from '../run/RunProvider'
import { TableFilters } from './TableFilters'
import { Pager } from './Pager'
```

(Remove the now-unused `LeadBucket` type import, `industryGroup`, `industryOptions`, and `sortLeads`. `applySort`/`matchesStatus`/`matchesBucket` helpers are deleted — the server filters/sorts now.)

2. Add the page-size constant near `DEFAULT_FILTERS`:

```tsx
const PAGE_SIZE = 50
```

3. Replace the hook call + the in-memory derivations. Swap:

```tsx
  const { leads, loading, error, reload, setLeadStatus } = useLeads()
```

for:

```tsx
  const [page, setPage] = useState(1)
  const { leads, total, facets, loading, error, reload, setLeadStatus } =
    useLeads(filters, page, PAGE_SIZE)
```

Move the existing `const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS)` line **above** the `useLeads` call (it must be declared first).

4. Delete the `industries`, `suburbs`, `counts`, and `visible` memos (lines ~106-141). Replace with facet-derived chrome:

```tsx
  const counts = useMemo(
    () => ({
      all: facets?.total ?? 0,
      top: facets?.top ?? 0,
      social_only: facets?.social_only ?? 0,
      none: facets?.none ?? 0,
    }),
    [facets],
  )
  const industries = facets?.industries ?? []
  const suburbs = facets?.suburbs ?? []
```

5. Change `update` to reset the page on any filter change:

```tsx
  const update = (next: Partial<Filters>) => {
    setFilters((f) => ({ ...f, ...next }))
    setPage(1)
  }
```

- [ ] **Step 2: Rewire the run-scoped "new" view**

The run view no longer filters the in-memory array. Replace the `runLeads` memo (lines ~83-86) with a small fetch-on-demand state:

```tsx
  const finishedRun = run && run.status === 'done' ? run : null
  const [runLeads, setRunLeads] = useState<Lead[]>([])
  useEffect(() => {
    if (!finishedRun) { setRunLeads([]); return }
    let cancelled = false
    loadLeads({ run_id: finishedRun.id, sort: 'newest', page_size: 500 })
      .then(({ leads }) => { if (!cancelled) setRunLeads(leads) })
      .catch(() => { if (!cancelled) setRunLeads([]) })
    return () => { cancelled = true }
  }, [finishedRun])
```

In the `'new'` view JSX, replace `applySort(runLeads, 'newest').map(...)` with `runLeads.map(...)` (already newest-first from the server).

- [ ] **Step 3: Render the page + pager + facet-fed chrome**

- `StatStrip`: change `<StatStrip leads={leads} ...>` to:

```tsx
        {view === 'leads' && !loading && !error && facets && (
          <StatStrip
            metrics={{
              total: facets.total,
              top: facets.top,
              social_only: facets.social_only,
              none: facets.none,
              reachable: facets.reachable,
            }}
            filters={filters}
            onChange={update}
          />
        )}
```

- The leads list now renders `leads` (the fetched page) instead of `visible`, with offset-based rank, and a `Pager` underneath. Replace the `view === 'leads'` sheet block's list + add the pager:

```tsx
            {leads.length === 0 ? (
              <p className="sheet__empty">
                No leads match these filters. Try widening the tier or clearing
                the search.
              </p>
            ) : (
              leads.map((lead, i) => (
                <LeadRow
                  key={lead.id}
                  lead={lead}
                  rank={(page - 1) * PAGE_SIZE + i + 1}
                  onSelect={setActive}
                  onSetStatus={setLeadStatus}
                />
              ))
            )}
          </section>
        )}

        {view === 'leads' && !loading && !error && (
          <Pager page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />
        )}
```

- The header count that read `visible.length` now reads `total`:

```tsx
                      : `${total} ${total === 1 ? 'lead' : 'leads'} ready to work`}
```

- `FilterRail`'s `newLeads={finishedRun ? { count: runLeads.length } : undefined}` still works (runLeads is now the fetched array).
- The `LeadDrawer` `lead={active ? leads.find((l) => l.dbId === active.dbId) ?? active : null}` still works against the current page.

- [ ] **Step 4: Typecheck + lint**

Run: `cd web && npm run build && npm run lint`
Expected: PASS. If oxlint flags `sortLeads` as unused in `web/src/lib/leads.ts`, delete that function and re-run.

- [ ] **Step 5: Manual smoke test**

Start the backend + frontend (per `README.md`, e.g. `uvicorn app.main:app --reload` and `cd web && npm run dev`), log in, then verify:
- The lead sheet shows 50 rows and a "Page 1 of N" pager; Prev disabled.
- Next advances the page; ranks continue (#51…); Prev re-enabled.
- Signal-tier filters (All/Top/Social/No website), the phone toggle, industry + suburb dropdowns, search box, and the Hottest/Newest sort all change the result set and reset to page 1.
- StatStrip numbers match the whole pool (not the current page).
- Generate a run (or use an existing finished run) → "New leads" view lists that run's leads, newest first.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/Dashboard.tsx web/src/lib/leads.ts
git commit -m "feat(web): server-side paged lead sheet with Pager + facet-fed chrome"
```

---

## Self-Review notes (for the implementer)

- **Spec coverage:** Task 1 (`industry.py`), Task 2 (SQL function), Task 3 (`query_leads` filters/sorts), Task 4 (`lead_facets`), Task 5 (router + `/facets` + export), Tasks 6-11 (api client, loadLeads, useLeads, Pager, StatStrip, Dashboard). All spec sections map to a task.
- **Type consistency:** `LeadQuery`/`Facets` defined in Task 6 are consumed unchanged in Tasks 7-8 & 11; `StatMetrics` (Task 10) matches the object Dashboard builds (Task 11); `counts` keeps the `Record<StatusFilter, number>` shape `{all, top, social_only, none}` FilterRail already expects (no FilterRail change needed).
- **Back-compat:** `query_leads` keeps `engine/suburb/q/sort/page/page_size` kwargs, so existing `export.csv` and tests keep working; `web_status` retained as a fallback.
- **Watch-outs:** in `useLeads`, depend on individual `filters` fields (not the object identity) to avoid a refetch loop; the run view fetch is a separate `loadLeads` call, not the paged hook.
