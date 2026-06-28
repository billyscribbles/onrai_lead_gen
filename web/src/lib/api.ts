/**
 * Backend API client. The Vite dev server proxies /api -> FastAPI (:8000),
 * and in production FastAPI serves this SPA from the same origin, so all
 * calls are same-origin and credentials ride along for the session cookie.
 */
import type { UserStatus } from '../types'

export interface Estimate {
  places: number
  searches: number
  cost_low: number
  cost_expected: number
  cost_high: number
}

export interface Run {
  id: number
  engine: string
  status: 'awaiting_confirm' | 'running' | 'classifying' | 'done' | 'failed' | 'aborted' | 'imported'
  cost_estimate: number | null
  leads_found: number
  places_scraped: number
  progress: string | null
  error: string | null
  params: Record<string, unknown>
  created_at: string
}

/** The good-lead criteria + scope the Generate section sends to the backend. */
export interface GenParams {
  category: string
  suburbs: string[]
  target: number
  no_website: boolean
  social_only: boolean
  phone_required: boolean
  min_reviews: number
}

/** Raw lead row as returned by GET /api/leads. */
export interface ApiLead {
  id: number
  engine: string
  business_name: string
  category: string
  suburb: string
  address: string
  phone: string
  email: string
  website: string
  web_status: string
  rating: number | null
  reviews_count: number | null
  google_maps_url: string
  place_id: string | null
  extra: Record<string, string>
  user_status: string
  /** When this lead was first saved (SQLite UTC "YYYY-MM-DD HH:MM:SS"). */
  created_at: string
}

const ENGINE = 'no_website'

/** Auth state from GET /api/auth/me. */
export interface AuthStatus {
  authed: boolean
  password_required: boolean
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}))
    throw new Error((detail as { detail?: string }).detail || `${res.status} ${res.statusText}`)
  }
  return res.json() as Promise<T>
}

const post = (path: string, body: unknown): Promise<Response> =>
  fetch(path, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

export function fetchLeads(): Promise<{ items: ApiLead[]; total: number }> {
  return fetch('/api/leads?page_size=500&sort=reviews_count', {
    credentials: 'include',
  }).then(json<{ items: ApiLead[]; total: number }>)
}

export function patchLeadStatus(
  id: number,
  status: UserStatus,
): Promise<ApiLead> {
  return fetch(`/api/leads/${id}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ user_status: status }),
  }).then(json<ApiLead>)
}

export function estimateRun(params: GenParams): Promise<Estimate> {
  return post('/api/runs/estimate', {
    engine: ENGINE,
    params,
  }).then(json<Estimate>)
}

export function createRun(
  params: GenParams,
  confirmedEstimate: number,
): Promise<{ run_id: number }> {
  return post('/api/runs', {
    engine: ENGINE,
    params,
    confirmed_estimate: confirmedEstimate,
  }).then(json<{ run_id: number }>)
}

export function getRun(id: number): Promise<Run> {
  return fetch(`/api/runs/${id}`, { credentials: 'include' }).then(json<Run>)
}

/** Force-kill a run. Returns the run in its final (aborted) state. */
export function abortRun(id: number): Promise<Run> {
  return post(`/api/runs/${id}/abort`, {}).then(json<Run>)
}

/** Most-recent runs (newest first, max 50). Used to re-attach to an in-flight
 *  run after a refresh when no run id is stored locally. */
export function listRuns(): Promise<Run[]> {
  return fetch('/api/runs', { credentials: 'include' }).then(json<Run[]>)
}

/** Whether a login is required and whether this session is already authed. */
export function getAuthStatus(): Promise<AuthStatus> {
  return fetch('/api/auth/me', { credentials: 'include' }).then(json<AuthStatus>)
}

/** Exchange the shared password for a session cookie. Throws on wrong password. */
export function login(password: string): Promise<{ ok: boolean }> {
  return post('/api/auth/login', { password }).then(json<{ ok: boolean }>)
}

/** Clear the session cookie on the backend. */
export function logout(): Promise<{ ok: boolean }> {
  return post('/api/auth/logout', {}).then(json<{ ok: boolean }>)
}
