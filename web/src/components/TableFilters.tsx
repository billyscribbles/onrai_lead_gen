import type { Filters, LeadBucket } from './FilterRail'
import { Search } from './Icons'

const BUCKETS: { key: LeadBucket; label: string }[] = [
  { key: 'active', label: 'Active' },
  { key: 'favourites', label: 'Favourites' },
  { key: 'archived', label: 'Archived' },
]

interface Props {
  filters: Filters
  industries: string[]
  suburbs: string[]
  onChange: (next: Partial<Filters>) => void
}

/** Horizontal Search + Industry + Suburb filter row sitting directly above the lead sheet. */
export function TableFilters({ filters, industries, suburbs, onChange }: Props) {
  const active = filters.query || filters.category || filters.suburb

  return (
    <div className="tablebar" role="group" aria-label="Table filters">
      <div className="tablebar__buckets" role="group" aria-label="Lead bucket">
        {BUCKETS.map((b) => (
          <button
            key={b.key}
            type="button"
            className={`bucket ${filters.bucket === b.key ? 'is-active' : ''}`}
            onClick={() => onChange({ bucket: b.key })}
            aria-pressed={filters.bucket === b.key}
          >
            {b.label}
          </button>
        ))}
      </div>
      <label className="tablebar__field tablebar__field--search">
        <span className="tablebar__label">Search</span>
        <div className="tablebar__search">
          <Search className="tablebar__search-icon" />
          <input
            type="search"
            placeholder="Name, suburb or category"
            value={filters.query}
            onChange={(e) => onChange({ query: e.target.value })}
            aria-label="Search leads"
          />
        </div>
      </label>

      <label className="tablebar__field">
        <span className="tablebar__label">Industry</span>
        <div className="tablebar__select">
          <select
            value={filters.category}
            onChange={(e) => onChange({ category: e.target.value })}
            aria-label="Filter by industry"
          >
            <option value="">All industries</option>
            {industries.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      </label>

      <label className="tablebar__field">
        <span className="tablebar__label">Suburb</span>
        <div className="tablebar__select">
          <select
            value={filters.suburb}
            onChange={(e) => onChange({ suburb: e.target.value })}
            aria-label="Filter by suburb"
          >
            <option value="">All suburbs</option>
            {suburbs.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </label>

      {active && (
        <button
          type="button"
          className="tablebar__clear"
          onClick={() => onChange({ query: '', category: '', suburb: '' })}
        >
          Clear
        </button>
      )}
    </div>
  )
}
