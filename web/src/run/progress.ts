import type { Run } from '../lib/api'

export type RunPhase = 'config' | 'running' | 'done' | 'error'

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
  if (run.status === 'failed' || run.status === 'aborted') return 'error'
  return 'running' // running | classifying | awaiting_confirm | imported
}

/** Phase weight → a believable progress-bar fill + a default status line. */
export function progressFor(run: Run | null): { pct: number; label: string } {
  if (!run) return { pct: 8, label: 'Starting the run…' }
  switch (run.status) {
    case 'running': {
      // Climb with listings actually seen so the bar reflects real progress,
      // capped below the classify phase.
      const seen = run.places_scraped || 0
      return { pct: Math.min(70, 20 + seen * 4), label: run.progress || 'Sweeping Google Maps…' }
    }
    case 'classifying':
      return { pct: 78, label: run.progress || 'Classifying listings…' }
    case 'done':
      return { pct: 100, label: 'Done' }
    default:
      return { pct: 100, label: run.progress || run.status }
  }
}
