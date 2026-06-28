import { useEffect, useRef, useState } from 'react'
import { createRun, estimateRun, getRun, type Estimate, type Run } from '../lib/api'

type Phase = 'form' | 'estimated' | 'running' | 'done' | 'error'

interface Props {
  onClose: () => void
  onDone: () => void
}

export function GenerateModal({ onClose, onDone }: Props) {
  const [category, setCategory] = useState('cafe')
  const [target, setTarget] = useState(25)
  const [phase, setPhase] = useState<Phase>('form')
  const [estimate, setEstimate] = useState<Estimate | null>(null)
  const [run, setRun] = useState<Run | null>(null)
  const [error, setError] = useState('')
  const poll = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => () => { if (poll.current) clearInterval(poll.current) }, [])

  const resetEstimate = () => {
    setEstimate(null)
    if (phase === 'estimated') setPhase('form')
  }

  async function onEstimate() {
    setError('')
    try {
      const est = await estimateRun(category.trim(), target)
      setEstimate(est)
      setPhase('estimated')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Estimate failed')
    }
  }

  async function onConfirm() {
    if (!estimate) return
    setError('')
    setPhase('running')
    try {
      const { run_id } = await createRun(category.trim(), target, estimate.cost_expected)
      poll.current = setInterval(async () => {
        try {
          const r = await getRun(run_id)
          setRun(r)
          if (r.status === 'done') {
            if (poll.current) clearInterval(poll.current)
            setPhase('done')
            onDone()
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
      setError(e instanceof Error ? e.message : 'Could not start run')
      setPhase('error')
    }
  }

  const busy = phase === 'running'

  return (
    <div className="modal" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="modal__card" onClick={(e) => e.stopPropagation()}>
        <header className="modal__head">
          <div>
            <p className="modal__eyebrow">No-website finder</p>
            <h2 className="modal__title">Generate leads</h2>
          </div>
          <button type="button" className="modal__x" onClick={onClose} aria-label="Close">×</button>
        </header>

        <label className="modal__field">
          <span>Category</span>
          <input
            value={category}
            onChange={(e) => { setCategory(e.target.value); resetEstimate() }}
            placeholder="e.g. cafe, barber, plumber"
            disabled={busy}
          />
        </label>

        <label className="modal__field">
          <span>Target leads</span>
          <input
            type="number"
            min={1}
            value={target}
            onChange={(e) => { setTarget(Number(e.target.value)); resetEstimate() }}
            disabled={busy}
          />
        </label>

        {estimate && (phase === 'estimated' || phase === 'running') && (
          <div className="modal__note">
            Sweeps ~<strong>{estimate.places}</strong> places across{' '}
            <strong>{estimate.searches}</strong> suburb searches · est.{' '}
            <strong>${estimate.cost_low}–${estimate.cost_high}</strong> (~${estimate.cost_expected}).
            <span className="modal__hint">Best-effort — may return slightly under target.</span>
          </div>
        )}

        {phase === 'running' && (
          <div className="modal__note modal__note--live">
            Running… {run?.status === 'classifying' ? 'classifying sites' : 'scraping Google Maps'}
            {run?.places_scraped ? ` · ${run.places_scraped} places seen` : ''}
          </div>
        )}

        {phase === 'done' && run && (
          <div className="modal__note modal__note--ok">
            Done — found <strong>{run.leads_found}</strong> leads. They're in the sheet.
          </div>
        )}

        {error && <p className="modal__error">{error}</p>}

        <div className="modal__actions">
          <button type="button" className="btn" onClick={onClose}>
            {phase === 'done' ? 'Close' : 'Cancel'}
          </button>
          {phase === 'form' && (
            <button type="button" className="btn btn--primary"
              onClick={onEstimate} disabled={!category.trim()}>
              Estimate cost
            </button>
          )}
          {phase === 'estimated' && (
            <button type="button" className="btn btn--primary" onClick={onConfirm}>
              Confirm &amp; run
            </button>
          )}
          {phase === 'running' && (
            <button type="button" className="btn btn--primary" disabled>Running…</button>
          )}
          {phase === 'error' && (
            <button type="button" className="btn btn--primary" onClick={() => setPhase('form')}>
              Try again
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
