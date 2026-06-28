import { LogOut, Plus, Rows, Search, Signal } from './Icons'

export type View = 'leads' | 'generate'
export type StatusFilter = 'all' | 'top' | 'social_only' | 'none'
export type SortKey = 'hot' | 'reviews' | 'rating' | 'name'
export type LeadBucket = 'active' | 'favourites' | 'archived'

export interface Filters {
  query: string
  status: StatusFilter
  category: string
  suburb: string
  phoneOnly: boolean
  sort: SortKey
  bucket: LeadBucket
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
  counts: Record<StatusFilter, number>
  onChange: (next: Partial<Filters>) => void
  view: View
  onNavigate: (view: View) => void
  /** When set (a password is configured), render a sign-out button. */
  onLogout?: () => void
}

export function FilterRail({
  filters,
  counts,
  onChange,
  view,
  onNavigate,
  onLogout,
}: Props) {
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

      <nav className="rail__group" aria-label="Workspace">
        <button
          type="button"
          className={`rail__item ${view === 'leads' ? 'is-active' : ''}`}
          onClick={() => onNavigate('leads')}
          aria-pressed={view === 'leads'}
        >
          <span className="rail__item-lbl"><Rows /> Lead sheet</span>
        </button>
        <button
          type="button"
          className={`rail__item rail__item--cta ${view === 'generate' ? 'is-active' : ''}`}
          onClick={() => onNavigate('generate')}
          aria-pressed={view === 'generate'}
        >
          <span className="rail__item-lbl"><Plus /> Generate leads</span>
        </button>
      </nav>

      {view === 'generate' ? (
        <p className="rail__foot">
          Set an industry, lead count and the criteria that make a good
          prospect, then generate. New leads are saved and appear on the{' '}
          <strong>lead sheet</strong>.
        </p>
      ) : (
        <>
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
        </>
      )}

      {onLogout && (
        <button type="button" className="rail__logout" onClick={onLogout}>
          <LogOut /> Sign out
        </button>
      )}
    </aside>
  )
}
