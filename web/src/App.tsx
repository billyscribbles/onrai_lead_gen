import { useMemo, useState } from 'react'
import { useLeads } from './hooks/useLeads'
import { sortLeads } from './lib/leads'
import type { Lead } from './types'
import {
  FilterRail,
  type Filters,
  type StatusFilter,
} from './components/FilterRail'
import { StatStrip } from './components/StatStrip'
import { LeadRow } from './components/LeadRow'
import { LeadDrawer } from './components/LeadDrawer'

const DEFAULT_FILTERS: Filters = {
  query: '',
  status: 'all',
  category: '',
  phoneOnly: false,
  sort: 'hot',
}

function matchesStatus(lead: Lead, status: StatusFilter): boolean {
  if (status === 'all') return true
  if (status === 'top') return lead.tier === 1
  return lead.webStatus === status
}

function applySort(leads: Lead[], sort: Filters['sort']): Lead[] {
  if (sort === 'hot') return sortLeads(leads)
  const copy = [...leads]
  if (sort === 'reviews') return copy.sort((a, b) => b.reviews - a.reviews)
  if (sort === 'rating')
    return copy.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0) || b.reviews - a.reviews)
  return copy.sort((a, b) => a.name.localeCompare(b.name))
}

export default function App() {
  const { leads, loading, error } = useLeads()
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS)
  const [active, setActive] = useState<Lead | null>(null)

  const categories = useMemo(
    () => [...new Set(leads.map((l) => l.category).filter(Boolean))].sort(),
    [leads],
  )

  const counts = useMemo(
    () => ({
      all: leads.length,
      top: leads.filter((l) => l.tier === 1).length,
      social_only: leads.filter((l) => l.webStatus === 'social_only').length,
      none: leads.filter((l) => l.webStatus === 'none').length,
    }),
    [leads],
  )

  const visible = useMemo(() => {
    const q = filters.query.trim().toLowerCase()
    const filtered = leads.filter((l) => {
      if (!matchesStatus(l, filters.status)) return false
      if (filters.category && l.category !== filters.category) return false
      if (filters.phoneOnly && !l.hasPhone) return false
      if (q) {
        const hay = `${l.name} ${l.category} ${l.suburb}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
    return applySort(filtered, filters.sort)
  }, [leads, filters])

  const update = (next: Partial<Filters>) =>
    setFilters((f) => ({ ...f, ...next }))

  return (
    <div className="app">
      <FilterRail
        filters={filters}
        categories={categories}
        counts={counts}
        onChange={update}
      />

      <main className="desk">
        <header className="desk__head">
          <div>
            <p className="desk__eyebrow">Melbourne · no-website prospects</p>
            <h1 className="desk__title">
              {loading
                ? 'Loading the dial sheet…'
                : error
                  ? 'Could not load leads'
                  : `${visible.length} ${visible.length === 1 ? 'lead' : 'leads'} ready to work`}
            </h1>
          </div>
        </header>

        {!loading && !error && <StatStrip leads={leads} />}

        {error && (
          <div className="panel panel--error">
            <p>{error}</p>
            <p className="panel__hint">
              Drop a fresh CSV at <code>web/public/leads.csv</code> and reload.
            </p>
          </div>
        )}

        {loading && (
          <div className="sheet" aria-busy="true">
            {Array.from({ length: 6 }).map((_, i) => (
              <div className="row row--skeleton" key={i} />
            ))}
          </div>
        )}

        {!loading && !error && (
          <section className="sheet" aria-label="Leads">
            <div className="sheet__head">
              <span>#</span>
              <span>Business</span>
              <span>Tier</span>
              <span>Traction</span>
              <span>Reach</span>
              <span>Heat</span>
              <span className="sheet__head-act">Quick actions</span>
            </div>

            {visible.length === 0 ? (
              <p className="sheet__empty">
                No leads match these filters. Try widening the tier or clearing
                the search.
              </p>
            ) : (
              visible.map((lead, i) => (
                <LeadRow
                  key={lead.id}
                  lead={lead}
                  rank={i + 1}
                  onSelect={setActive}
                />
              ))
            )}
          </section>
        )}
      </main>

      <LeadDrawer lead={active} onClose={() => setActive(null)} />
    </div>
  )
}
