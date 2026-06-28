import { useEffect, useRef, useState } from 'react'
import {
  createRun,
  estimateRun,
  getRun,
  type Estimate,
  type GenParams,
  type Run,
} from '../lib/api'

interface Props {
  /** Refresh the leads sheet after a successful run. */
  onReload: () => void
  /** Jump back to the leads view. */
  onViewLeads: () => void
}

/** Seeded industry suggestions. The user can still type a custom one. */
const INDUSTRY_GROUPS: { label: string; items: string[] }[] = [
  { label: 'Hospitality', items: ['cafe', 'restaurant', 'bar', 'bakery', 'takeaway'] },
  { label: 'Beauty & grooming', items: ['barber', 'hair salon', 'nail salon', 'beautician', 'tattoo studio'] },
  { label: 'Trades', items: ['plumber', 'electrician', 'builder', 'landscaper', 'painter'] },
  { label: 'Auto', items: ['mechanic', 'car detailing', 'auto electrician', 'tyre shop'] },
  { label: 'Retail & wholesale', items: ['clothing store', 'boutique', 'wholesaler', 'homewares'] },
  { label: 'Health & fitness', items: ['dentist', 'physio', 'gym', 'chiropractor', 'massage'] },
  { label: 'Professional services', items: ['real estate agent', 'accountant', 'lawyer', 'mortgage broker', 'marketing agency'] },
]

/**
 * Suburb scope for the sweep, grouped by region (mirrors suburbs_melbourne.txt).
 * Selected suburbs ride to the backend as `suburbs`; empty falls back server-side.
 */
const SUBURB_GROUPS: { label: string; items: string[] }[] = [
  { label: 'Inner / CBD', items: ['Melbourne CBD', 'Carlton', 'Fitzroy', 'Richmond', 'South Yarra', 'St Kilda', 'Footscray'] },
  { label: 'Inner east', items: ['Hawthorn', 'Camberwell', 'Box Hill'] },
  { label: 'Outer east / SE', items: ['Doncaster', 'Ringwood', 'Glen Waverley', 'Clayton', 'Dandenong', 'Springvale', 'Berwick', 'Pakenham', 'Frankston'] },
  { label: 'South', items: ['Brighton', 'Cheltenham'] },
  { label: 'North', items: ['Brunswick', 'Coburg', 'Preston', 'Reservoir', 'Epping', 'Craigieburn'] },
  { label: 'West / NW', items: ['Sunshine', 'Werribee', 'Point Cook', 'Melton', 'Essendon'] },
]

const ALL_SUBURBS = SUBURB_GROUPS.flatMap((g) => g.items)

const CUSTOM = '__custom__'

type Phase = 'config' | 'running' | 'done' | 'error'

/** Phase weight → a believable progress-bar fill + a default status line. */
function progressFor(run: Run | null): { pct: number; label: string } {
  if (!run) return { pct: 8, label: 'Starting the run…' }
  switch (run.status) {
    case 'running':
      return { pct: 38, label: run.progress || 'Sweeping Google Maps…' }
    case 'classifying':
      return { pct: 78, label: run.progress || 'Classifying listings…' }
    case 'done':
      return { pct: 100, label: 'Done' }
    default:
      return { pct: 100, label: run.progress || run.status }
  }
}

export function GenerateSection({ onReload, onViewLeads }: Props) {
  const [industry, setIndustry] = useState('cafe')
  const [custom, setCustom] = useState('')
  const [suburbs, setSuburbs] = useState<string[]>(ALL_SUBURBS)
  const [target, setTarget] = useState(25)
  const [noWebsite, setNoWebsite] = useState(true)
  const [socialOnly, setSocialOnly] = useState(false)
  const [phoneRequired, setPhoneRequired] = useState(true)
  const [established, setEstablished] = useState(true)
  const [minReviews, setMinReviews] = useState(5)

  const [estimate, setEstimate] = useState<Estimate | null>(null)
  const [estimating, setEstimating] = useState(false)

  const [phase, setPhase] = useState<Phase>('config')
  const [run, setRun] = useState<Run | null>(null)
  const [error, setError] = useState('')
  const poll = useRef<ReturnType<typeof setInterval> | null>(null)

  const category = (industry === CUSTOM ? custom : industry).trim()

  function toggleSuburb(name: string) {
    setSuburbs((prev) =>
      prev.includes(name) ? prev.filter((s) => s !== name) : [...prev, name])
  }

  function buildParams(): GenParams {
    return {
      category,
      suburbs,
      target,
      no_website: noWebsite,
      social_only: socialOnly,
      phone_required: phoneRequired,
      min_reviews: established ? minReviews : 0,
    }
  }

  // Live cost estimate, debounced, whenever scope changes (config phase only).
  useEffect(() => {
    if (phase !== 'config' || !category || suburbs.length === 0) {
      setEstimate(null)
      return
    }
    let cancelled = false
    setEstimating(true)
    const t = setTimeout(() => {
      estimateRun(buildParams())
        .then((est) => { if (!cancelled) setEstimate(est) })
        .catch(() => { if (!cancelled) setEstimate(null) })
        .finally(() => { if (!cancelled) setEstimating(false) })
    }, 400)
    return () => { cancelled = true; clearTimeout(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, target, phase, suburbs.length])

  useEffect(() => () => { if (poll.current) clearInterval(poll.current) }, [])

  async function onGenerate() {
    if (!category || !estimate) return
    setError('')
    setRun(null)
    setPhase('running')
    try {
      const { run_id } = await createRun(buildParams(), estimate.cost_expected)
      poll.current = setInterval(async () => {
        try {
          const r = await getRun(run_id)
          setRun(r)
          if (r.status === 'done') {
            if (poll.current) clearInterval(poll.current)
            setPhase('done')
            onReload()
          } else if (r.status === 'failed' || r.status === 'aborted') {
            if (poll.current) clearInterval(poll.current)
            setError(r.error || `Run ${r.status}`)
            setPhase('error')
          }
        } catch (e) {
          if (poll.current) clearInterval(poll.current)
          setError(e instanceof Error ? e.message : 'Lost the run')
          setPhase('error')
        }
      }, 2000)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start the run')
      setPhase('error')
    }
  }

  function reset() {
    setPhase('config')
    setRun(null)
    setError('')
  }

  const prog = progressFor(run)
  const busy = phase === 'running'

  return (
    <section className="gen" aria-label="Generate leads">
      <div className="gen__grid">
        {/* ---------------- Scope ---------------- */}
        <div className="gen__card">
          <h2 className="gen__card-title">Scope</h2>

          <label className="gen__field">
            <span>Industry</span>
            <div className="gen__select">
              <select
                value={industry}
                onChange={(e) => setIndustry(e.target.value)}
                disabled={busy}
                aria-label="Industry"
              >
                {INDUSTRY_GROUPS.map((g) => (
                  <optgroup key={g.label} label={g.label}>
                    {g.items.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </optgroup>
                ))}
                <option value={CUSTOM}>Custom…</option>
              </select>
            </div>
          </label>

          {industry === CUSTOM && (
            <label className="gen__field">
              <span>Custom industry</span>
              <input
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                placeholder="e.g. florist, mechanic, pet groomer"
                disabled={busy}
                autoFocus
              />
            </label>
          )}

          <div className="gen__field">
            <div className="gen__suburbs-head">
              <span>Suburbs &amp; cities</span>
              <div className="gen__suburbs-actions">
                <button
                  type="button"
                  onClick={() => setSuburbs(ALL_SUBURBS)}
                  disabled={busy || suburbs.length === ALL_SUBURBS.length}
                >
                  All
                </button>
                <button
                  type="button"
                  onClick={() => setSuburbs([])}
                  disabled={busy || suburbs.length === 0}
                >
                  Clear
                </button>
              </div>
            </div>
            <div className="gen__suburbs">
              {SUBURB_GROUPS.map((g) => (
                <fieldset key={g.label} className="gen__suburb-group" disabled={busy}>
                  <legend>{g.label}</legend>
                  {g.items.map((s) => (
                    <label key={s} className="gen__suburb">
                      <input
                        type="checkbox"
                        checked={suburbs.includes(s)}
                        onChange={() => toggleSuburb(s)}
                      />
                      <span>{s}</span>
                    </label>
                  ))}
                </fieldset>
              ))}
            </div>
            <small className="gen__hint">
              {suburbs.length === 0
                ? 'Pick at least one suburb to sweep.'
                : `Sweeping ${suburbs.length} of ${ALL_SUBURBS.length} suburbs across Victoria.`}
            </small>
          </div>

          <label className="gen__field">
            <span>Number of leads</span>
            <input
              type="number"
              min={1}
              max={500}
              value={target}
              onChange={(e) => setTarget(Math.max(1, Number(e.target.value) || 1))}
              disabled={busy}
            />
            <small className="gen__hint">
              Best-effort target — drives how many of the selected suburbs we sweep.
            </small>
          </label>
        </div>

        {/* ---------------- Good-lead criteria ---------------- */}
        <div className="gen__card">
          <h2 className="gen__card-title">What makes a good lead</h2>

          <label className="gen__check gen__check--locked">
            <input type="checkbox" checked disabled readOnly />
            <span>
              On Google Maps
              <small>Always on — Google Maps is our only source.</small>
            </span>
          </label>

          <label className="gen__check">
            <input
              type="checkbox"
              checked={noWebsite}
              onChange={(e) => setNoWebsite(e.target.checked)}
              disabled={busy}
            />
            <span>
              No usable website
              <small>Keeps only “no site” and “social-only” businesses.</small>
            </span>
          </label>

          <label className="gen__check">
            <input
              type="checkbox"
              checked={socialOnly}
              onChange={(e) => setSocialOnly(e.target.checked)}
              disabled={busy}
            />
            <span>
              Strong social presence
              <small>
                Only businesses whose lone web link is a social profile
                (Instagram/Facebook/Linktree). Google lists one link per
                business, so we can’t require both platforms.
              </small>
            </span>
          </label>

          <label className="gen__check">
            <input
              type="checkbox"
              checked={phoneRequired}
              onChange={(e) => setPhoneRequired(e.target.checked)}
              disabled={busy}
            />
            <span>
              Has a phone number
              <small>Makes outreach trivial — recommended.</small>
            </span>
          </label>

          <label className="gen__check">
            <input
              type="checkbox"
              checked={established}
              onChange={(e) => setEstablished(e.target.checked)}
              disabled={busy}
            />
            <span>
              Established business
              <span className="gen__inline">
                min
                <input
                  type="number"
                  min={0}
                  value={minReviews}
                  onChange={(e) => setMinReviews(Math.max(0, Number(e.target.value) || 0))}
                  disabled={busy || !established}
                  aria-label="Minimum reviews"
                />
                Google reviews
              </span>
            </span>
          </label>
        </div>
      </div>

      {/* ---------------- Estimate + action ---------------- */}
      <div className="gen__bar">
        <div className="gen__estimate">
          {!category ? (
            <span className="gen__est-muted">Pick an industry to estimate cost.</span>
          ) : suburbs.length === 0 ? (
            <span className="gen__est-muted">Pick at least one suburb to estimate cost.</span>
          ) : estimating && !estimate ? (
            <span className="gen__est-muted">Estimating…</span>
          ) : estimate ? (
            <>
              Sweeps ~<strong>{estimate.places}</strong> places across{' '}
              <strong>{estimate.searches}</strong> suburb searches ·{' '}
              <strong className="mono">${estimate.cost_low}–${estimate.cost_high}</strong>{' '}
              <span className="gen__est-muted">(~${estimate.cost_expected} expected)</span>
            </>
          ) : (
            <span className="gen__est-muted">Couldn’t estimate — check the backend.</span>
          )}
        </div>

        {phase === 'config' && (
          <button
            type="button"
            className="btn btn--primary gen__go"
            onClick={onGenerate}
            disabled={!category || !estimate}
          >
            Generate leads
          </button>
        )}
        {busy && (
          <button type="button" className="btn btn--primary gen__go" disabled>
            Generating…
          </button>
        )}
      </div>

      {/* ---------------- Live progress ---------------- */}
      {(phase === 'running' || phase === 'done') && (
        <div className="gen__progress" aria-live="polite">
          <div className="gen__progress-head">
            <span>{prog.label}</span>
            <span className="mono">{prog.pct}%</span>
          </div>
          <div className="gen__track">
            <div
              className={`gen__fill ${busy ? 'is-animated' : ''}`}
              style={{ width: `${prog.pct}%` }}
            />
          </div>
          {run?.places_scraped ? (
            <p className="gen__progress-sub mono">{run.places_scraped} listings seen</p>
          ) : null}
        </div>
      )}

      {phase === 'done' && run && (
        <div className="gen__result gen__result--ok">
          <p>
            Found <strong>{run.leads_found}</strong>{' '}
            {run.leads_found === 1 ? 'lead' : 'leads'} for{' '}
            <strong>{category}</strong> — saved to the database.
          </p>
          <div className="gen__result-actions">
            <button type="button" className="btn btn--primary" onClick={onViewLeads}>
              View leads →
            </button>
            <button type="button" className="btn" onClick={reset}>
              Generate more
            </button>
          </div>
        </div>
      )}

      {phase === 'error' && (
        <div className="gen__result gen__result--err">
          <p>{error || 'Something went wrong.'}</p>
          <button type="button" className="btn" onClick={reset}>Try again</button>
        </div>
      )}
    </section>
  )
}
