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

export type RunStage =
  | 'starting'
  | 'sweeping'
  | 'finalizing'
  | 'classifying'
  | 'done'
  | 'ended'

/** Phase weight → an honest progress-bar fill, a status line, and the stage. */
export function progressFor(
  run: Run | null,
): { pct: number; label: string; stage: RunStage } {
  if (!run) return { pct: 6, label: 'Starting the run…', stage: 'starting' }
  const msg = run.progress || ''
  switch (run.status) {
    case 'running': {
      const seen = run.places_scraped || 0
      // The watchdog emits this when it winds the actor down early but keeps the
      // data — show it as a distinct "finalizing" step, not a stalled sweep.
      if (/wound down early/i.test(msg)) {
        return { pct: 74, label: msg, stage: 'finalizing' }
      }
      // Climb with listings actually seen so the bar reflects real progress,
      // capped below the classify phase.
      return {
        pct: Math.min(72, 18 + seen * 3),
        label: msg || 'Sweeping Google Maps…',
        stage: 'sweeping',
      }
    }
    case 'classifying':
      return { pct: 84, label: msg || 'Classifying listings…', stage: 'classifying' }
    case 'done':
      return { pct: 100, label: msg || 'Done', stage: 'done' }
    default:
      return { pct: 100, label: msg || run.status, stage: 'ended' }
  }
}

/** "1m 12s" style elapsed formatting for the detail panel. */
export function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return `${m}m ${String(s % 60).padStart(2, '0')}s`
}
