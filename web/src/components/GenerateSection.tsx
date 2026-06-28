import { useEffect, useState } from 'react'
import { estimateRun, type Estimate, type GenParams } from '../lib/api'
import { useActiveRun } from '../run/RunProvider'
import { progressFor, runPhase } from '../run/progress'
import { ConfirmDialog } from './ConfirmDialog'

interface Props {
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

export function GenerateSection({ onViewLeads }: Props) {
  const [industry, setIndustry] = useState('cafe')
  const [custom, setCustom] = useState('')
  const [suburbs, setSuburbs] = useState<string[]>(ALL_SUBURBS)
  const [target, setTarget] = useState<number | ''>(25)
  const [noWebsite, setNoWebsite] = useState(true)
  const [socialOnly, setSocialOnly] = useState(false)
  const [phoneRequired, setPhoneRequired] = useState(true)
  const [established, setEstablished] = useState(true)
  const [minReviews, setMinReviews] = useState<number | ''>(5)

  const [estimate, setEstimate] = useState<Estimate | null>(null)
  const [estimating, setEstimating] = useState(false)

  const { runId, run, error, start, dismiss, abort, aborting } = useActiveRun()
  const phase = runPhase(runId, run, error)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const category = (industry === CUSTOM ? custom : industry).trim()

  function toggleSuburb(name: string) {
    setSuburbs((prev) =>
      prev.includes(name) ? prev.filter((s) => s !== name) : [...prev, name])
  }

  function buildParams(): GenParams {
    return {
      category,
      suburbs,
      target: target === '' ? 1 : target,
      no_website: noWebsite,
      social_only: socialOnly,
      phone_required: phoneRequired,
      min_reviews: established ? (minReviews === '' ? 0 : minReviews) : 0,
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

  async function onGenerate() {
    if (!category || !estimate) return
    await start(buildParams(), estimate.cost_expected)
  }

  function reset() {
    dismiss()
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
              onChange={(e) =>
                setTarget(e.target.value === '' ? '' : Math.min(500, Number(e.target.value)))}
              onBlur={() =>
                setTarget((t) => (t === '' || t < 1 ? 1 : t))}
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
                  onChange={(e) =>
                    setMinReviews(e.target.value === '' ? '' : Math.max(0, Number(e.target.value)))}
                  onBlur={() =>
                    setMinReviews((m) => (m === '' ? 0 : m))}
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
          <div className="gen__go-group">
            <button type="button" className="btn btn--primary gen__go" disabled>
              Generating…
            </button>
            <button
              type="button"
              className="btn btn--danger"
              onClick={() => setConfirmOpen(true)}
              disabled={aborting}
            >
              {aborting ? 'Stopping…' : 'Stop'}
            </button>
          </div>
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

      {phase === 'aborted' && (
        <div className="gen__result">
          <p>Run stopped. No leads from this run were saved.</p>
          <button type="button" className="btn" onClick={reset}>
            Start over
          </button>
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title="Stop this run?"
        message="Apify scraping will be aborted and no leads from this run will be saved."
        confirmLabel="Stop run"
        danger
        onConfirm={() => {
          setConfirmOpen(false)
          void abort()
        }}
        onCancel={() => setConfirmOpen(false)}
      />
    </section>
  )
}
