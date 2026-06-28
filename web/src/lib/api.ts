/**
 * Backend API client. The Vite dev server proxies /api -> FastAPI (:8000),
 * and in production FastAPI serves this SPA from the same origin, so all
 * calls are same-origin and credentials ride along for the session cookie.
 */

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
}

const ENGINE = 'no_website'

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
