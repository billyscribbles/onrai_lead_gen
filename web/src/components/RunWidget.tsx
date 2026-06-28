import { useActiveRun } from '../run/RunProvider'
import { progressFor, runPhase } from '../run/progress'

/**
 * Floating, always-visible progress card for a background run. Renders nothing
 * when no run is active. `onView` jumps the user to the Generate view.
 */
export function RunWidget({ onView }: { onView: () => void }) {
  const { runId, run, error, dismiss } = useActiveRun()
  const phase = runPhase(runId, run, error)

  if (phase === 'config') return null

  const prog = progressFor(run)
  const busy = phase === 'running'

  return (
    <div className="runwidget" role="status" aria-live="polite">
      <div className="runwidget__head">
        <span className="runwidget__label">
          {phase === 'error' ? error || 'Run failed' : prog.label}
        </span>
        {!busy && (
          <button
            type="button"
            className="runwidget__x"
            onClick={dismiss}
            aria-label="Dismiss"
          >
            ×
          </button>
        )}
      </div>

      {phase !== 'error' && (
        <>
          <div className="runwidget__meta">
            <span className="mono">{prog.pct}%</span>
            {run?.places_scraped ? (
              <span className="runwidget__sub mono">{run.places_scraped} seen</span>
            ) : null}
          </div>
          <div className="gen__track">
            <div
              className={`gen__fill ${busy ? 'is-animated' : ''}`}
              style={{ width: `${prog.pct}%` }}
            />
          </div>
        </>
      )}

      <div className="runwidget__actions">
        <button type="button" className="btn btn--sm" onClick={onView}>
          View
        </button>
      </div>
    </div>
  )
}
