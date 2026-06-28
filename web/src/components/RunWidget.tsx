import { useEffect, useState } from 'react'
import { useActiveRun } from '../run/RunProvider'
import { progressFor, runPhase } from '../run/progress'
import { ConfirmDialog } from './ConfirmDialog'

/** How long the green success bar lingers before it hides itself. */
const DONE_DISMISS_MS = 6000

/**
 * Floating, long-and-thin progress bar for a background run. Pinned to the
 * bottom-centre of the viewport so it persists across views. Renders nothing
 * when no run is active. On success it flips to a green "done" state and
 * auto-dismisses after a few seconds. `onView` jumps to the Generate view.
 */
export function RunWidget({ onView }: { onView: () => void }) {
  const { runId, run, error, dismiss, abort, aborting, stalled } = useActiveRun()
  const phase = runPhase(runId, run, error)
  const [confirmOpen, setConfirmOpen] = useState(false)
  // Hides just the floating bar without forgetting the run, so the "New leads"
  // tab survives. Reset whenever a new run starts so the bar comes back.
  const [hidden, setHidden] = useState(false)
  useEffect(() => {
    setHidden(false)
  }, [runId])

  // Once finished, let the success bar breathe for a moment, then hide it — but
  // keep the run state alive so the "New leads" tab stays until the next run.
  useEffect(() => {
    if (phase !== 'done') return
    const t = setTimeout(() => setHidden(true), DONE_DISMISS_MS)
    return () => clearTimeout(t)
  }, [phase])

  if (phase === 'config' || hidden) return null

  const prog = progressFor(run)
  const busy = phase === 'running'
  const done = phase === 'done'
  const isError = phase === 'error'
  const isAborted = phase === 'aborted'

  const found = run?.leads_found ?? 0
  const label = isError
    ? error || 'Run failed'
    : isAborted
      ? 'Run stopped'
      : done
        ? `Found ${found} ${found === 1 ? 'lead' : 'leads'} — saved`
        : prog.label

  return (
    <>
      <div
        className={`runbar ${done ? 'runbar--done' : ''} ${isError ? 'runbar--error' : ''} ${isAborted ? 'runbar--stopped' : ''}`}
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

          {busy && stalled && (
            <span className="runbar__stalled" title="The Maps actor is winding down; it will auto-finalize and keep what it found.">
              taking longer than usual…
            </span>
          )}

          {busy && <span className="runbar__pct mono">{prog.pct}%</span>}

          {busy && (
            <button
              type="button"
              className="runbar__stop"
              onClick={() => setConfirmOpen(true)}
              disabled={aborting}
            >
              {aborting ? 'Stopping…' : 'Stop'}
            </button>
          )}

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

        {!isError && !isAborted && (
          <div className="gen__track runbar__track">
            <div
              className={`gen__fill ${busy ? 'is-animated' : ''}`}
              style={{ width: `${prog.pct}%` }}
            />
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Stop this run?"
        message="Apify scraping will be aborted and no leads from this run will be saved."
        confirmLabel="Stop run"
        danger
        onConfirm={() => {
          setConfirmOpen(false)
          // Stop the run and clear the bar — user starts fresh from the scope form.
          void abort()
          dismiss()
        }}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  )
}
