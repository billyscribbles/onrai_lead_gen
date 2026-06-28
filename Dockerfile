# syntax=docker/dockerfile:1
# Multi-stage: Node builds the React dashboard, Python serves the API + built SPA.

# ---- Stage 1: build the React dashboard (emits web/dist) --------------------
FROM node:20-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# ---- Stage 2: Python runtime serving FastAPI + the built SPA ----------------
FROM python:3.12-slim AS app
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    DB_PATH=/data/leads.db

WORKDIR /app
COPY requirements.txt ./
RUN pip install -r requirements.txt

# Backend, pure logic, scraper, and config/seed data.
COPY app/ ./app/
COPY scrape_no_website.py web_presence.py ./
COPY suburbs_melbourne.txt melbourne_categories.txt ./
COPY output/melbourne_no_website_leads.csv ./output/melbourne_no_website_leads.csv

# Built SPA from stage 1 — main.py mounts this at "/" when it exists.
COPY --from=web /web/dist ./web/dist

# Railway injects $PORT; fall back to 8000 for local `docker run`.
EXPOSE 8000
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
