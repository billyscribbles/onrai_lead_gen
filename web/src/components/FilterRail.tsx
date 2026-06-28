import { Search, Signal } from './Icons'

export type StatusFilter = 'all' | 'top' | 'social_only' | 'none'
export type SortKey = 'hot' | 'reviews' | 'rating' | 'name'

export interface Filters {
  query: string
  status: StatusFilter
  category: string
  phoneOnly: boolean
  sort: SortKey
}

const STATUS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'All leads' },
  { key: 'top', label: 'Top tier' },
  { key: 'social_only', label: 'Social only' },
  { key: 'none', label: 'No website' },
]

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'hot', label: 'Hottest first' },
  { key: 'reviews', label: 'Most reviews' },
  { key: 'rating', label: 'Highest rated' },
  { key: 'name', label: 'A–Z' },
]

interface Props {
  filters: Filters
  categories: string[]
  counts: Record<StatusFilter, number>
  onChange: (next: Partial<Filters>) => void
}

export function FilterRail({ filters, categories, counts, onChange }: Props) {
  return (
    <aside className="rail">
      <div className="brand">
        <span className="brand__mark" aria-hidden="true">
          <Signal />
        </span>
        <span className="brand__text">
          <strong>ONRAI STUDIO</strong>
          <small>Lead Radar · Melbourne</small>
        </span>
      </div>

      <div className="rail__search">
        <Search className="rail__search-icon" />
        <input
          type="search"
          placeholder="Search name, suburb, category"
          value={filters.query}
          onChange={(e) => onChange({ query: e.target.value })}
          aria-label="Search leads"
        />
      </div>

      <nav className="rail__group" aria-label="Status">
        <p className="rail__label">Signal tier</p>
        {STATUS.map((s) => (
          <button
            key={s.key}
            type="button"
            className={`rail__item ${filters.status === s.key ? 'is-active' : ''}`}
            onClick={() => onChange({ status: s.key })}
            aria-pressed={filters.status === s.key}
          >
            <span>{s.label}</span>
            <span className="rail__count">{counts[s.key]}</span>
          </button>
        ))}
      </nav>

      <div className="rail__group">
        <p className="rail__label">Category</p>
        <div className="rail__select">
          <select
            value={filters.category}
            onChange={(e) => onChange({ category: e.target.value })}
            aria-label="Filter by category"
          >
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="rail__group">
        <p className="rail__label">Refine</p>
        <label className="rail__check">
          <input
            type="checkbox"
            checked={filters.phoneOnly}
            onChange={(e) => onChange({ phoneOnly: e.target.checked })}
          />
          <span>Has a phone number</span>
        </label>
      </div>

      <div className="rail__group">
        <p className="rail__label">Sort</p>
        <div className="rail__select">
          <select
            value={filters.sort}
            onChange={(e) => onChange({ sort: e.target.value as SortKey })}
            aria-label="Sort leads"
          >
            {SORTS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <p className="rail__foot">
        Built for one offer: <strong>website build &amp; redesign</strong>. Hottest
        leads are established businesses with social proof and no site.
      </p>
    </aside>
  )
}
