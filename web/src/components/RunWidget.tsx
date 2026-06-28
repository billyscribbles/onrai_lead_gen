import { useEffect } from 'react'
import { useActiveRun } from '../run/RunProvider'
import { progressFor, runPhase } from '../run/progress'

/** How long the green success bar lingers before it dismisses itself. */
const DONE_DISMISS_MS = 6000

/**
 * Floating, long-and-thin progress bar for a background run. Pinned to the
 * bottom-centre of the viewport so it persists across views. Renders nothing
 * when no run is active. On success it flips to a green "done" state and
 * auto-dismisses after a few seconds. `onView` jumps to the Generate view.
 */
export function RunWidget({ onView }: { onView: () => void }) {
  const { runId, run, error, dismiss } = useActiveRun()
  const phase = runPhase(runId, run, error)

  // Once finished, let the success bar breathe for a moment, then clear it.
  useEffect(() => {
    if (phase !== 'done') return
    const t = setTimeout(dismiss, DONE_DISMISS_MS)
    return () => clearTimeout(t)
  }, [phase, dismiss])

  if (phase === 'config') return null

  const prog = progressFor(run)
  const busy = phase === 'running'
  const done = phase === 'done'
  const isError = phase === 'error'

  const found = run?.leads_found ?? 0
  const label = isError
    ? error || 'Run failed'
    : done
      ? `Found ${found} ${found === 1 ? 'lead' : 'leads'} — saved`
      : prog.label

  return (
    <div
      className={`runbar ${done ? 'runbar--done' : ''} ${isError ? 'runbar--error' : ''}`}
      role="status"
      aria-live="polite"
    >
      <div className="runbar__row">
        <span className="runbar__label">
          {done && (
            <span className="runbar__check" aria-hidden="true">
              ✓
            </span>
          )}
          {label}
        </span>

        {busy && <span className="runbar__pct mono">{prog.pct}%</span>}

        <button type="button" className="runbar__view" onClick={onView}>
          View
        </button>

        {!busy && (
          <button
            type="button"
            className="runbar__x"
            onClick={dismiss}
            aria-label="Dismiss"
          >
            ×
          </button>
        )}
      </div>

      {!isError && (
        <div className="gen__track runbar__track">
          <div
            className={`gen__fill ${busy ? 'is-animated' : ''}`}
            style={{ width: `${prog.pct}%` }}
          />
        </div>
      )}
    </div>
  )
}
