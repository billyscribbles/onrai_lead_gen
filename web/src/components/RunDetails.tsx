import { useActiveRun } from '../run/RunProvider'
import { formatElapsed, progressFor, type RunStage } from '../run/progress'

const STAGE_LABEL: Record<RunStage, string> = {
  starting: 'Starting',
  sweeping: 'Sweeping Google Maps',
  finalizing: 'Finalizing',
  classifying: 'Classifying listings',
  done: 'Done',
  ended: 'Finished',
}

/**
 * Expandable "See details" panel for a live or finished run. Surfaces the
 * feedback the loading bar can't fit: elapsed time, current phase, live counts,
 * the rolling activity log, and a stuck warning when the run goes quiet (the
 * Maps actor's wind-down hang). The backend watchdog auto-finalizes a stalled
 * run, so the warning resolves itself — the copy tells the user that.
 */
export function RunDetails({ open = false }: { open?: boolean }) {
  const { run, log, stalled, elapsedMs } = useActiveRun()
  if (!run) return null

  const prog = progressFor(run)
  const isRunning = run.status === 'running' || run.status === 'classifying'
  const cost =
    run.cost_actual != null
      ? `$${run.cost_actual.toFixed(3)} spent` +
        (run.cost_estimate != null ? ` (est $${run.cost_estimate.toFixed(3)})` : '')
      : run.cost_estimate != null
        ? `est $${run.cost_estimate.toFixed(3)}`
        : '—'

  return (
    <details className="rundetail" open={open}>
      <summary className="rundetail__summary">See details</summary>

      {stalled && isRunning && (
        <p className="rundetail__warn" role="status">
          This run is taking longer than usual. The Google Maps actor sometimes
          winds down slowly — it will auto-finalize and keep what it found, or you
          can Stop now.
        </p>
      )}

      <dl className="rundetail__stats">
        <div>
          <dt>Phase</dt>
          <dd>{STAGE_LABEL[prog.stage]}</dd>
        </div>
        <div>
          <dt>Elapsed</dt>
          <dd className="mono">{formatElapsed(elapsedMs)}</dd>
        </div>
        <div>
          <dt>Listings seen</dt>
          <dd className="mono">{run.places_scraped ?? 0}</dd>
        </div>
        <div>
          <dt>Leads found</dt>
          <dd className="mono">{run.leads_found ?? 0}</dd>
        </div>
        <div>
          <dt>Cost</dt>
          <dd className="mono">{cost}</dd>
        </div>
      </dl>

      {log.length > 0 && (
        <ul className="rundetail__log">
          {[...log].reverse().map((e, i) => (
            <li key={`${e.t}-${i}`}>
              <span className="rundetail__log-time mono">
                {formatElapsed(Math.max(0, e.t - log[0].t))}
              </span>
              <span className="rundetail__log-msg">{e.msg}</span>
            </li>
          ))}
        </ul>
      )}
    </details>
  )
}
