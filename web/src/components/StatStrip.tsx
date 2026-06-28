import type { Lead } from '../types'
import type { Filters, StatusFilter } from './FilterRail'

function metrics(leads: Lead[]) {
  const topTier = leads.filter((l) => l.tier === 1).length
  const noWeb = leads.filter((l) => l.webStatus === 'none').length
  const social = leads.filter((l) => l.webStatus === 'social_only').length
  const reachable = leads.filter((l) => l.hasPhone || l.social).length
  return { total: leads.length, topTier, noWeb, social, reachable }
}

type StatItem = {
  label: string
  value: string
  tone: string
  hint?: string
  /** Clicking filters the sheet to this signal tier (toggles back to "all"). */
  status?: StatusFilter
  /** Clicking toggles the phone-only refine filter. */
  toggle?: 'phoneOnly'
}

export function StatStrip({
  leads,
  filters,
  onChange,
}: {
  leads: Lead[]
  filters: Filters
  onChange: (next: Partial<Filters>) => void
}) {
  const m = metrics(leads)
  const items: StatItem[] = [
    { label: 'Live leads', value: String(m.total), tone: 'ink', status: 'all' },
    {
      label: 'Top tier',
      value: String(m.topTier),
      tone: 'signal',
      hint: 'social + phone',
      status: 'top',
    },
    { label: 'Social only', value: String(m.social), tone: 'teal', status: 'social_only' },
    { label: 'No website', value: String(m.noWeb), tone: 'ink', status: 'none' },
    { label: 'Reachable now', value: String(m.reachable), tone: 'ink', toggle: 'phoneOnly' },
  ]

  const isActive = (it: StatItem) =>
    it.toggle === 'phoneOnly'
      ? filters.phoneOnly
      : it.status !== undefined && filters.status === it.status

  const handle = (it: StatItem) => {
    if (it.toggle === 'phoneOnly') {
      onChange({ phoneOnly: !filters.phoneOnly })
      return
    }
    if (it.status === undefined) return
    // Clicking the active tier clears back to "all"; "all" is never a toggle-off.
    const next = filters.status === it.status && it.status !== 'all' ? 'all' : it.status
    onChange({ status: next })
  }

  return (
    <div className="stat-strip">
      {items.map((it) => {
        const active = isActive(it)
        return (
          <button
            type="button"
            className={`stat stat--${it.tone} ${active ? 'is-active' : ''}`}
            key={it.label}
            onClick={() => handle(it)}
            aria-pressed={active}
          >
            <span className="stat__label">{it.label}</span>
            <span className="stat__value">
              {it.value}
              {it.hint && <span className="stat__hint">{it.hint}</span>}
            </span>
          </button>
        )
      })}
    </div>
  )
}
