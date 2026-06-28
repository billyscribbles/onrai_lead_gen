import type { Run } from '../lib/api'

export type RunPhase = 'config' | 'running' | 'done' | 'error' | 'aborted'

/**
 * Derive the UI phase from active-run state.
 * - no run id            → config (show the form)
 * - run id, no snapshot  → running (started, first poll not back yet)
 * - terminal statuses    → done / error
 */
export function runPhase(
  runId: number | null,
  run: Run | null,
  error: string,
): RunPhase {
  if (error) return 'error'
  if (runId == null) return 'config'
  if (!run) return 'running'
  if (run.status === 'done') return 'done'
  if (run.status === 'aborted') return 'aborted'
  if (run.status === 'failed') return 'error'
  return 'running' // running | classifying | awaiting_confirm | imported
}

/** Phase weight → a believable progress-bar fill + a status line that reports
 * real counts (listings scraped while sweeping, then "found X / Y" while
 * classifying) instead of a vague phase name. */
export function progressFor(run: Run | null): { pct: number; label: string } {
  if (!run) return { pct: 8, label: 'Starting the run…' }
  const found = run.leads_found || 0
  const total = run.places_scraped || 0
  switch (run.status) {
    case 'running': {
      // Climb with listings actually seen so the bar reflects real progress,
      // capped below the classify phase.
      const label = total
        ? `Scanning Google Maps — ${total} listings`
        : run.progress || 'Sweeping Google Maps…'
      return { pct: Math.min(70, 20 + total * 2), label }
    }
    case 'classifying':
      // Bar leads the way to 100 as qualified leads accumulate against the total.
      return {
        pct: total ? 75 + Math.min(24, Math.round((found / total) * 24)) : 78,
        label: total ? `Found ${found} / ${total}` : run.progress || 'Classifying listings…',
      }
    case 'done':
      return { pct: 100, label: total ? `Found ${found} / ${total}` : 'Done' }
    default:
      return { pct: 100, label: run.progress || run.status }
  }
}
