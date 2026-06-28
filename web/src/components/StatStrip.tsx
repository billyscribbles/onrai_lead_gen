import type { Lead } from '../types'
import { compact } from '../lib/format'

function metrics(leads: Lead[]) {
  const topTier = leads.filter((l) => l.tier === 1).length
  const noWeb = leads.filter((l) => l.webStatus === 'none').length
  const social = leads.filter((l) => l.webStatus === 'social_only').length
  const reachable = leads.filter((l) => l.hasPhone || l.social).length
  const reviews = leads.reduce((s, l) => s + l.reviews, 0)
  return { total: leads.length, topTier, noWeb, social, reachable, reviews }
}

export function StatStrip({ leads }: { leads: Lead[] }) {
  const m = metrics(leads)
  const items = [
    { label: 'Live leads', value: String(m.total), tone: 'ink' },
    { label: 'Top tier', value: String(m.topTier), tone: 'signal', hint: 'social + phone' },
    { label: 'Social only', value: String(m.social), tone: 'teal' },
    { label: 'No website', value: String(m.noWeb), tone: 'ink' },
    { label: 'Reachable now', value: String(m.reachable), tone: 'ink' },
    { label: 'Reviews in play', value: compact(m.reviews), tone: 'ink' },
  ]

  return (
    <dl className="stat-strip">
      {items.map((it) => (
        <div className={`stat stat--${it.tone}`} key={it.label}>
          <dt>{it.label}</dt>
          <dd>
            {it.value}
            {it.hint && <span className="stat__hint">{it.hint}</span>}
          </dd>
        </div>
      ))}
    </dl>
  )
}
