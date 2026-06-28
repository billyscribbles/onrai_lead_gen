# No-Site Radar — dashboard (frontend)

React + TypeScript + Vite SPA for the **No-Site Radar** lead dashboard. It browses,
filters, and exports the leads found by `scrape_no_website.py`, and can kick off new
scrape runs (with a cost estimate + confirm step) against the FastAPI backend in
[`../app`](../app).

## Dev

The Vite dev server proxies `/api` → FastAPI on `:8000`, so run both together from
the **repo root**:

```bash
yarn dev          # concurrently: uvicorn (:8000) + vite (:5173)
# or just the frontend:
npm run dev       # from this web/ directory
```

## Build

```bash
npm run build     # tsc -b && vite build  → emits web/dist/
```

In production the FastAPI app serves `web/dist/` from the same origin (see
`app/main.py`), so all API calls are same-origin and the session cookie rides along.
The Docker build (repo-root `Dockerfile`) runs this build in a Node stage and copies
`dist/` into the Python image — you don't commit `dist/`.

## Layout

- `src/App.tsx` — top-level dashboard shell
- `src/components/` — `FilterRail`, `LeadRow`, `LeadDrawer`, `StatStrip`, `GenerateSection`
- `src/hooks/useLeads.ts` — lead fetching/state
- `src/lib/` — `api.ts` (backend client), `csv.ts`, `leads.ts`, `format.ts`
- `src/types.ts` — shared types

See the [repo README](../README.md) for the scraper, the data model, and Railway
deployment.
