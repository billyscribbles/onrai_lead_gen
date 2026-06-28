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
const TERMINAL: ReadonlySet<Run['status']> = new Set(['done', 'failed', 'aborted'])

interface ActiveRun {
  runId: number | null
  run: Run | null
  error: string
  aborting: boolean
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
  const poll = useRef<ReturnType<typeof setInterval> | null>(null)
  const starting = useRef(false)
  const polledId = useRef<number | null>(null)

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
    [track, runId],
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
  }, [stopPoll])

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
    <Ctx.Provider value={{ runId, run, error, aborting, start, abort, dismiss }}>
      {children}
    </Ctx.Provider>
  )
}
