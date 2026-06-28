import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { abortRun, createRun, getRun, listRuns, type GenParams, type Run } from '../lib/api'

const STORAGE_KEY = 'onrai.activeRunId'
const POLL_MS = 2000
/** No change in listings-seen or progress for this long ⇒ flag the run as stalled. */
const STALL_MS = 45000
const TERMINAL: ReadonlySet<Run['status']> = new Set(['done', 'failed', 'aborted'])

interface LogEntry {
  t: number
  msg: string
}

/** Parse SQLite's UTC "YYYY-MM-DD HH:MM:SS" (no zone) into epoch ms. */
function utcMs(s: string | null | undefined): number | null {
  if (!s) return null
  const ms = Date.parse(s.replace(' ', 'T') + 'Z')
  return Number.isFinite(ms) ? ms : null
}

interface ActiveRun {
  runId: number | null
  run: Run | null
  error: string
  aborting: boolean
  /** Rolling activity feed: every distinct progress message the poller saw. */
  log: LogEntry[]
  /** True while running but no new listings/progress for STALL_MS — "taking long". */
  stalled: boolean
  /** Wall-clock ms since the run started (frozen at finish for terminal runs). */
  elapsedMs: number
  start: (params: GenParams, confirmedEstimate: number) => Promise<void>
  abort: () => Promise<void>
  dismiss: () => void
}

const Ctx = createContext<ActiveRun | null>(null)

/** Active-run state for any descendant. Throws if used outside RunProvider. */
export function useActiveRun(): ActiveRun {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useActiveRun must be used within RunProvider')
  return ctx
}

export function RunProvider({ children }: { children: ReactNode }) {
  const [runId, setRunId] = useState<number | null>(null)
  const [run, setRun] = useState<Run | null>(null)
  const [error, setError] = useState('')
  const [aborting, setAborting] = useState(false)
  const [log, setLog] = useState<LogEntry[]>([])
  const [nowTs, setNowTs] = useState(() => Date.now())
  const poll = useRef<ReturnType<typeof setInterval> | null>(null)
  const starting = useRef(false)
  const polledId = useRef<number | null>(null)
  // Change-tracking for stall detection + the activity log.
  const lastChangeRef = useRef<number>(Date.now())
  const lastSeenRef = useRef<number>(-1)
  const lastMsgRef = useRef<string>('')

  const resetTracking = useCallback(() => {
    lastChangeRef.current = Date.now()
    lastSeenRef.current = -1
    lastMsgRef.current = ''
    setLog([])
  }, [])

  const stopPoll = useCallback(() => {
    if (poll.current) {
      clearInterval(poll.current)
      poll.current = null
    }
    polledId.current = null
  }, [])

  // Begin (or restart) polling a given run id. Fires once immediately so the
  // UI does not wait a full interval for the first snapshot.
  const track = useCallback(
    (id: number) => {
      stopPoll()
      polledId.current = id
      const tick = async () => {
        try {
          const r = await getRun(id)
          if (polledId.current !== id) return
          setRun(r)
          // Track real progress: listings-seen climbing or a new message means
          // the run is alive. Stamp the change time + append distinct messages.
          const seen = r.places_scraped || 0
          const msg = (r.progress || '').trim()
          let changed = false
          if (seen !== lastSeenRef.current) {
            lastSeenRef.current = seen
            changed = true
          }
          if (msg && msg !== lastMsgRef.current) {
            lastMsgRef.current = msg
            changed = true
            setLog((prev) => [...prev, { t: Date.now(), msg }])
          }
          if (changed) lastChangeRef.current = Date.now()
          if (TERMINAL.has(r.status)) {
            stopPoll()
            setAborting(false)
            if (r.status === 'failed') setError(r.error || 'Run failed')
          }
        } catch (e) {
          if (polledId.current !== id) return
          stopPoll()
          setError(e instanceof Error ? e.message : 'Lost the run')
        }
      }
      poll.current = setInterval(tick, POLL_MS)
      void tick()
    },
    [stopPoll],
  )

  const start = useCallback(
    async (params: GenParams, confirmedEstimate: number) => {
      if (starting.current || runId != null) return
      starting.current = true
      setError('')
      setRun(null)
      resetTracking()
      try {
        const { run_id } = await createRun(params, confirmedEstimate)
        localStorage.setItem(STORAGE_KEY, String(run_id))
        setRunId(run_id)
        track(run_id)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not start the run')
      } finally {
        starting.current = false
      }
    },
    [track, runId, resetTracking],
  )

  const abort = useCallback(async () => {
    if (runId == null) return
    setAborting(true)
    try {
      const r = await abortRun(runId)
      setRun(r)
      if (TERMINAL.has(r.status)) stopPoll()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not stop the run')
    } finally {
      setAborting(false)
    }
  }, [runId, stopPoll])

  const dismiss = useCallback(() => {
    stopPoll()
    localStorage.removeItem(STORAGE_KEY)
    setRunId(null)
    setRun(null)
    setError('')
    setAborting(false)
    resetTracking()
  }, [stopPoll, resetTracking])

  // Tick once a second while a run is live, so the elapsed timer advances and
  // the stall flag flips even when the 2s poll itself returns nothing new.
  const isLive = runId != null && (run == null || !TERMINAL.has(run.status))
  useEffect(() => {
    if (!isLive) return
    const id = setInterval(() => setNowTs(Date.now()), 1000)
    return () => clearInterval(id)
  }, [isLive])

  const startMs = utcMs(run?.started_at) ?? utcMs(run?.created_at)
  const endMs =
    run && TERMINAL.has(run.status) ? utcMs(run.finished_at) ?? nowTs : nowTs
  const elapsedMs = startMs != null ? Math.max(0, endMs - startMs) : 0
  const stalled = isLive && run != null && nowTs - lastChangeRef.current > STALL_MS

  // On mount: resume a persisted run; otherwise adopt any in-flight run the
  // server still reports (covers a refresh after localStorage was cleared).
  useEffect(() => {
    let cancelled = false
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      const id = Number(stored)
      if (Number.isFinite(id)) {
        setRunId(id)
        track(id)
      } else {
        localStorage.removeItem(STORAGE_KEY)
      }
      return () => {
        cancelled = true
        stopPoll()
      }
    }
    listRuns()
      .then((runs) => {
        if (cancelled) return
        const live = runs.find(
          (r) => r.status === 'running' || r.status === 'classifying',
        )
        if (live) {
          localStorage.setItem(STORAGE_KEY, String(live.id))
          setRunId(live.id)
          setRun(live)
          track(live.id)
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
      stopPoll()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <Ctx.Provider
      value={{ runId, run, error, aborting, log, stalled, elapsedMs,
               start, abort, dismiss }}
    >
      {children}
    </Ctx.Provider>
  )
}
