import { useCallback, useEffect, useState } from 'react'
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
  // fields rather than its identity.
  const { query, status, category, suburb, phoneOnly, sort, bucket } = filters
  useEffect(() => {
    const q = toQuery(
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

  // Facets are global; refetch only on mount and on explicit reload.
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
      // Roll back the optimistic change and surface the failure.
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
