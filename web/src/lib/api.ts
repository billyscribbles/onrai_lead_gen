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
  cost_actual: number | null
  leads_found: number
  places_scraped: number
  progress: string | null
  error: string | null
  params: Record<string, unknown>
  created_at: string
  started_at: string | null
  finished_at: string | null
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
  /** ICP tier (1 = hottest) computed server-side; null for legacy rows. */
  tier: number | null
  /** 0–100 signal/heat computed server-side; null for legacy rows. */
  heat: number | null
  extra: Record<string, string>
  user_status: string
  /** The run that produced this lead (null for legacy/CSV-ingested rows). */
  run_id: number | null
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
