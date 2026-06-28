import type { Filters } from './FilterRail'

interface Props {
  filters: Filters
  industries: string[]
  suburbs: string[]
  onChange: (next: Partial<Filters>) => void
}

/** Horizontal Industry + Suburb filter row sitting directly above the lead sheet. */
export function TableFilters({ filters, industries, suburbs, onChange }: Props) {
  const active = filters.category || filters.suburb

  return (
    <div className="tablebar" role="group" aria-label="Table filters">
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
          onClick={() => onChange({ category: '', suburb: '' })}
        >
          Clear
        </button>
      )}
    </div>
  )
}
