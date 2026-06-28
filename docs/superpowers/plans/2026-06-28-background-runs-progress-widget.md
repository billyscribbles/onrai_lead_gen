# Background runs + persistent progress widget — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a lead-generation run keep going in the background with an always-visible progress widget, so the user can navigate within the SPA (or refresh the browser) and the run survives, then click back into the full run state.

**Architecture:** Lift active-run ownership out of `GenerateSection` into a React context provider (`RunProvider`) mounted above the view switch. The provider owns the single poll loop, mirrors the run id to `localStorage`, and rehydrates/reconciles on mount. A floating `RunWidget` and the existing in-page progress both render from this one source. No backend changes.

**Tech Stack:** React 19, TypeScript, Vite, oxlint. FastAPI backend (unchanged). The run already executes in a detached daemon thread and is pollable via `GET /api/runs/{id}`; `GET /api/runs` lists recent runs.

## Global Constraints

- **No backend changes.** All endpoints already exist (`app/routers/runs.py`): `POST /api/runs`, `GET /api/runs`, `GET /api/runs/{id}`.
- **No JS/React test runner exists** in this repo. The automated gate for every frontend task is `npm run build` (`tsc -b && vite build` — typecheck + bundle) and `npm run lint` (oxlint), run from `web/`. There are no `*.test.ts` files to add; do not invent a test framework.
- **Poll cadence: 2000ms** (matches current behaviour).
- **Reuse existing CSS classes** (`gen__track`, `gen__fill`, `is-animated`, `mono`, `btn`) where possible; only add new classes for the widget shell.
- Work happens on branch `feat/background-runs-widget`. Final task merges to `main` and pushes (user authorized pushing to main when done).
- All commands run from `/Users/billyhuynh/Github/onrai_lead_gen/web` unless noted.

---

## File Structure

- `web/src/lib/api.ts` — **modify**: add `listRuns()`.
- `web/src/run/progress.ts` — **create**: pure helpers `progressFor()` (moved out of `GenerateSection`) and `runPhase()`.
- `web/src/run/RunProvider.tsx` — **create**: context, `RunProvider`, `useActiveRun()` hook. Owns run id, polled snapshot, poll loop, localStorage, `start`/`dismiss`.
- `web/src/components/RunWidget.tsx` — **create**: floating bottom-right progress widget.
- `web/src/index.css` — **modify**: add `.runwidget` styles + `.btn--sm`.
- `web/src/components/GenerateSection.tsx` — **modify**: drop local run/poll/phase state; consume `useActiveRun()`.
- `web/src/components/Dashboard.tsx` — **modify**: render `RunWidget`, add done→reload effect, dismiss on logout.
- `web/src/App.tsx` — **modify**: wrap `Dashboard` in `RunProvider`.

---

## Task 1: Add `listRuns()` to the API client

**Files:**
- Modify: `web/src/lib/api.ts` (after `getRun`, around line 108)

**Interfaces:**
- Consumes: existing `Run` interface, `json()` helper.
- Produces: `listRuns(): Promise<Run[]>` — used by `RunProvider` on mount.

- [ ] **Step 1: Add the function**

In `web/src/lib/api.ts`, immediately after the `getRun` function (currently ending at line 108), add:

```ts
/** Most-recent runs (newest first, max 50). Used to re-attach to an in-flight
 *  run after a refresh when no run id is stored locally. */
export function listRuns(): Promise<Run[]> {
  return fetch('/api/runs', { credentials: 'include' }).then(json<Run[]>)
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `npm run build && npm run lint`
Expected: build succeeds (no type errors), lint reports no new errors.

- [ ] **Step 3: Commit**

```bash
git add web/src/lib/api.ts
git commit -m "feat(web): add listRuns API client for run reconciliation"
```

---

## Task 2: Shared run helpers (`progress.ts`)

Move `progressFor()` out of `GenerateSection` into a shared module and add `runPhase()`, the single source of truth for deriving UI phase from run state. Update `GenerateSection` to import `progressFor` so the build stays green and there is no duplicate.

**Files:**
- Create: `web/src/run/progress.ts`
- Modify: `web/src/components/GenerateSection.tsx` (remove local `progressFor`, import it; lines 1-9 imports and 48-65 the function)

**Interfaces:**
- Consumes: `Run` from `../lib/api`.
- Produces:
  - `progressFor(run: Run | null): { pct: number; label: string }`
  - `runPhase(runId: number | null, run: Run | null, error: string): RunPhase`
  - `type RunPhase = 'config' | 'running' | 'done' | 'error'`

- [ ] **Step 1: Create the helpers file**

Create `web/src/run/progress.ts`:

```ts
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
```

- [ ] **Step 2: Remove the duplicate from `GenerateSection` and import it**

In `web/src/components/GenerateSection.tsx`, delete the local `progressFor` function (currently lines 48-65, the block from the `/** Phase weight … */` comment through its closing `}`).

Then add an import. Change the import block at the top so it reads:

```ts
import { useEffect, useState } from 'react'
import {
  estimateRun,
  type Estimate,
  type GenParams,
  type Run,
} from '../lib/api'
import { progressFor } from '../run/progress'
```

(Note: `useRef`, `createRun`, and `getRun` are removed from imports — they are no longer used after this task removes nothing else, but `progressFor` is now imported. `Run` and `useRef`/`createRun`/`getRun` are still referenced by the not-yet-refactored body, so keep `useRef`, `createRun`, `getRun`, and `Run` in the imports for now — they are removed in Task 6. Only add the `progressFor` import and delete the local function in this task.)

Concretely for this task, leave the existing import lines as-is and **only**:
1. Delete the local `progressFor` function body (lines 48-65).
2. Add this one line after the existing `} from '../lib/api'` import:

```ts
import { progressFor } from '../run/progress'
```

- [ ] **Step 3: Typecheck + lint**

Run: `npm run build && npm run lint`
Expected: build succeeds; no unused-import errors (the body still uses `useRef`, `createRun`, `getRun`, `Run`).

- [ ] **Step 4: Commit**

```bash
git add web/src/run/progress.ts web/src/components/GenerateSection.tsx
git commit -m "refactor(web): extract progressFor + runPhase into run/progress"
```

---

## Task 3: `RunProvider` context + `useActiveRun` hook

The single owner of active-run state and the poll loop. Not yet mounted anywhere; building it in isolation keeps the diff reviewable.

**Files:**
- Create: `web/src/run/RunProvider.tsx`

**Interfaces:**
- Consumes: `createRun`, `getRun`, `listRuns`, `GenParams`, `Run` from `../lib/api`.
- Produces:
  - `RunProvider({ children }): JSX.Element`
  - `useActiveRun(): { runId: number | null; run: Run | null; error: string; start: (params: GenParams, confirmedEstimate: number) => Promise<void>; dismiss: () => void }`

- [ ] **Step 1: Create the provider**

Create `web/src/run/RunProvider.tsx`:

```tsx
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createRun, getRun, listRuns, type GenParams, type Run } from '../lib/api'

const STORAGE_KEY = 'onrai.activeRunId'
const POLL_MS = 2000
const TERMINAL: ReadonlySet<Run['status']> = new Set(['done', 'failed', 'aborted'])

interface ActiveRun {
  runId: number | null
  run: Run | null
  error: string
  start: (params: GenParams, confirmedEstimate: number) => Promise<void>
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
  const poll = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopPoll = useCallback(() => {
    if (poll.current) {
      clearInterval(poll.current)
      poll.current = null
    }
  }, [])

  // Begin (or restart) polling a given run id. Fires once immediately so the
  // UI does not wait a full interval for the first snapshot.
  const track = useCallback(
    (id: number) => {
      stopPoll()
      const tick = async () => {
        try {
          const r = await getRun(id)
          setRun(r)
          if (TERMINAL.has(r.status)) {
            stopPoll()
            if (r.status !== 'done') setError(r.error || `Run ${r.status}`)
          }
        } catch (e) {
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
      setError('')
      setRun(null)
      try {
        const { run_id } = await createRun(params, confirmedEstimate)
        localStorage.setItem(STORAGE_KEY, String(run_id))
        setRunId(run_id)
        track(run_id)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not start the run')
      }
    },
    [track],
  )

  const dismiss = useCallback(() => {
    stopPoll()
    localStorage.removeItem(STORAGE_KEY)
    setRunId(null)
    setRun(null)
    setError('')
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
    <Ctx.Provider value={{ runId, run, error, start, dismiss }}>
      {children}
    </Ctx.Provider>
  )
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `npm run build && npm run lint`
Expected: build succeeds; lint clean. (The provider is unused so far — that is fine; it is exported.)

- [ ] **Step 3: Commit**

```bash
git add web/src/run/RunProvider.tsx
git commit -m "feat(web): add RunProvider owning background run state + poll loop"
```

---

## Task 4: `RunWidget` floating component + styles

Standalone component, not yet rendered. Reads the context and self-hides when there is no active run.

**Files:**
- Create: `web/src/components/RunWidget.tsx`
- Modify: `web/src/index.css` (append at end of file, before the final media query block is fine — append at very end)

**Interfaces:**
- Consumes: `useActiveRun` from `../run/RunProvider`; `progressFor`, `runPhase` from `../run/progress`.
- Produces: `RunWidget({ onView }: { onView: () => void }): JSX.Element | null`.

- [ ] **Step 1: Create the component**

Create `web/src/components/RunWidget.tsx`:

```tsx
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
```

- [ ] **Step 2: Append styles**

Append to the very end of `web/src/index.css`:

```css
/* =========================================================================
   Floating background-run widget
   ========================================================================= */
.runwidget {
  position: fixed;
  right: 20px;
  bottom: 20px;
  z-index: 50;
  width: 280px;
  display: flex;
  flex-direction: column;
  gap: 9px;
  padding: 14px 16px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  box-shadow: var(--shadow-lg);
}

.runwidget__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 13px;
  font-weight: 550;
  color: var(--ink-soft);
}

.runwidget__label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.runwidget__x {
  flex: none;
  border: none;
  background: none;
  cursor: pointer;
  font-size: 18px;
  line-height: 1;
  color: var(--muted-2);
  padding: 0 2px;
}

.runwidget__x:hover {
  color: var(--ink);
}

.runwidget__meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  color: var(--muted);
}

.runwidget__actions {
  display: flex;
  justify-content: flex-end;
}

.btn--sm {
  padding: 5px 12px;
  font-size: 12.5px;
}
```

- [ ] **Step 3: Typecheck + lint**

Run: `npm run build && npm run lint`
Expected: build succeeds; lint clean. (Component unused so far — exported, fine.)

- [ ] **Step 4: Commit**

```bash
git add web/src/components/RunWidget.tsx web/src/index.css
git commit -m "feat(web): add floating RunWidget for background run progress"
```

---

## Task 5: Mount the provider (App)

**Files:**
- Modify: `web/src/App.tsx` (line 40, the authed return)

**Interfaces:**
- Consumes: `RunProvider` from `./run/RunProvider`.
- Produces: `Dashboard` now rendered inside `RunProvider`, so `useActiveRun()` is available to it and its descendants.

- [ ] **Step 1: Wrap Dashboard**

In `web/src/App.tsx`, add the import after line 4:

```ts
import { RunProvider } from './run/RunProvider'
```

Replace the final return (line 40) with:

```tsx
  return (
    <RunProvider>
      <Dashboard canLogout={passwordRequired} onSignedOut={onSignedOut} />
    </RunProvider>
  )
```

- [ ] **Step 2: Typecheck + lint**

Run: `npm run build && npm run lint`
Expected: build succeeds; lint clean. (App still works; `useActiveRun` not yet consumed by Dashboard — added next task.)

- [ ] **Step 3: Commit**

```bash
git add web/src/App.tsx
git commit -m "feat(web): mount RunProvider above the dashboard"
```

---

## Task 6: Refactor `GenerateSection` to consume the context

Remove `GenerateSection`'s private run/poll/phase ownership; it now starts runs through the context and renders from the shared snapshot. (Requires the provider mounted — done in Task 5.)

**Files:**
- Modify: `web/src/components/GenerateSection.tsx`

**Interfaces:**
- Consumes: `useActiveRun` from `../run/RunProvider`; `runPhase`, `progressFor` from `../run/progress`.
- Produces: `GenerateSection({ onViewLeads }: { onViewLeads: () => void })` — the `onReload` prop is removed (leads refresh now lives in Dashboard).

- [ ] **Step 1: Update imports**

At the top of `web/src/components/GenerateSection.tsx`, replace the import block (lines 1-9 plus the `progressFor` import added in Task 2) with:

```ts
import { useEffect, useState } from 'react'
import { estimateRun, type Estimate, type GenParams } from '../lib/api'
import { useActiveRun } from '../run/RunProvider'
import { progressFor, runPhase } from '../run/progress'
```

- [ ] **Step 2: Update the Props interface**

Replace the `Props` interface (lines 11-16) with:

```ts
interface Props {
  /** Jump back to the leads view. */
  onViewLeads: () => void
}
```

- [ ] **Step 3: Swap local run state for the context**

In the component, change the signature and the run-state declarations. Replace:

```ts
export function GenerateSection({ onReload, onViewLeads }: Props) {
```

with:

```ts
export function GenerateSection({ onViewLeads }: Props) {
```

Then **delete** these local declarations (currently lines 81-84):

```ts
  const [phase, setPhase] = useState<Phase>('config')
  const [run, setRun] = useState<Run | null>(null)
  const [error, setError] = useState('')
  const poll = useRef<ReturnType<typeof setInterval> | null>(null)
```

and replace them with:

```ts
  const { runId, run, error, start, dismiss } = useActiveRun()
  const phase = runPhase(runId, run, error)
```

Also delete the now-unused local `type Phase = ...` declaration (currently line 46).

- [ ] **Step 4: Delete the poll-cleanup effect**

Delete this line (currently line 123):

```ts
  useEffect(() => () => { if (poll.current) clearInterval(poll.current) }, [])
```

- [ ] **Step 5: Replace `onGenerate` and `reset`**

Replace the entire `onGenerate` function (currently lines 125-155) with:

```ts
  async function onGenerate() {
    if (!category || !estimate) return
    await start(buildParams(), estimate.cost_expected)
  }
```

Replace the `reset` function (currently lines 157-161) with:

```ts
  function reset() {
    dismiss()
  }
```

- [ ] **Step 6: Typecheck + lint**

Run: `npm run build && npm run lint`
Expected: build succeeds (no unused `useRef`/`createRun`/`getRun`/`Run`/`Phase`/`setRun`/`setPhase`/`setError` references remain); lint clean.

If the build reports unused symbols, remove them — the only state setters that should remain are `setIndustry`, `setCustom`, `setSuburbs`, `setTarget`, `setNoWebsite`, `setSocialOnly`, `setPhoneRequired`, `setEstablished`, `setMinReviews`, `setEstimate`, `setEstimating`.

- [ ] **Step 7: Commit**

```bash
git add web/src/components/GenerateSection.tsx
git commit -m "refactor(web): GenerateSection reads run state from RunProvider"
```

---

## Task 7: Wire Dashboard — render widget, reload on done, dismiss on logout

**Files:**
- Modify: `web/src/components/Dashboard.tsx`

**Interfaces:**
- Consumes: `useActiveRun` from `../run/RunProvider`; `RunWidget` from `./RunWidget`.
- Produces: leads sheet auto-refreshes when a run completes regardless of current view; widget rendered on every non-generate view.

- [ ] **Step 1: Add imports**

In `web/src/components/Dashboard.tsx`, add after the existing component imports (after line 16):

```ts
import { RunWidget } from './RunWidget'
import { useActiveRun } from '../run/RunProvider'
```

Also ensure `useRef` is imported from React. Change line 1:

```ts
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
```

- [ ] **Step 2: Consume the context + add the done→reload effect**

Inside the `Dashboard` component, after the existing `const { leads, loading, error, reload } = useLeads()` (line 51), add:

```ts
  const { run, dismiss: dismissRun } = useActiveRun()
  const reloadedFor = useRef<number | null>(null)

  // When a background run finishes, refresh the leads sheet once — no matter
  // which view the user is currently on.
  useEffect(() => {
    if (run && run.status === 'done' && reloadedFor.current !== run.id) {
      reloadedFor.current = run.id
      reload()
    }
  }, [run, reload])
```

- [ ] **Step 3: Clear the run on logout**

Replace the `handleLogout` callback (currently lines 63-65) with:

```ts
  const handleLogout = useCallback(() => {
    dismissRun()
    logout().finally(onSignedOut)
  }, [dismissRun, onSignedOut])
```

- [ ] **Step 4: Drop the `onReload` prop from GenerateSection usage**

Replace the `GenerateSection` render (currently lines 137-142) with:

```tsx
        {view === 'generate' && (
          <GenerateSection onViewLeads={() => setView('leads')} />
        )}
```

- [ ] **Step 5: Render the widget on non-generate views**

Immediately before the closing `</main>` (currently line 210), or right after it inside the outer `<div className="app">`, add:

```tsx
      {view !== 'generate' && (
        <RunWidget onView={() => setView('generate')} />
      )}
```

Place it as a sibling of `<main>` inside `<div className="app">`, just before `<LeadDrawer ... />` (line 212).

- [ ] **Step 6: Typecheck + lint**

Run: `npm run build && npm run lint`
Expected: build succeeds; lint clean.

- [ ] **Step 7: Commit**

```bash
git add web/src/components/Dashboard.tsx
git commit -m "feat(web): render RunWidget + auto-reload leads on run completion"
```

---

## Task 8: Manual verification + land on main

No automated frontend tests exist, so verify in a running app, then merge and push.

**Files:** none (verification + git).

- [ ] **Step 1: Start backend + frontend**

From repo root, start the API (per README, e.g. `uvicorn app.main:app --reload` with `APIFY_TOKEN` set for a live run), and in `web/` run `npm run dev`. Open the dashboard and sign in.

- [ ] **Step 2: Verify the flow**

Confirm each:
1. Start a run on the Generate view → in-page progress climbs; the floating widget does **not** show on the Generate view.
2. Switch to the leads view → the floating widget appears bottom-right with live progress and "N seen".
3. Refresh the browser → the widget re-attaches to the still-running run (rehydrated from localStorage).
4. Let the run finish → widget shows Done 100% with a **Dismiss** (×) and **View**; the leads sheet refreshes automatically.
5. Click **Dismiss** → widget disappears; returning to Generate shows the config form; starting a new run works.
6. Click **Sign out** mid-run → widget/run handle is cleared.

If any step fails, fix the relevant component and re-run `npm run build && npm run lint` before continuing. Do not claim success without observing these behaviours.

- [ ] **Step 3: Final build gate**

Run from `web/`: `npm run build && npm run lint`
Expected: both clean.

- [ ] **Step 4: Merge to main and push**

```bash
cd /Users/billyhuynh/Github/onrai_lead_gen
git checkout main
git merge --no-ff feat/background-runs-widget -m "feat: background runs with persistent progress widget"
git push origin main
```

Expected: fast/clean merge, push succeeds.

---

## Self-Review notes

- **Spec coverage:** context provider (Tasks 3,5), localStorage refresh-survival + `listRuns` reconcile (Tasks 1,3), floating widget visible on other views with View+Dismiss (Tasks 4,7), in-page progress unchanged source (Tasks 2,6), done→reload anywhere (Task 7), logout clears run (Task 7), abort explicitly out of scope (not implemented). All covered.
- **Known limitation** (server restart leaves a row stuck at `running`) is documented in the spec and intentionally not handled here.
- **Type consistency:** `runPhase(runId, run, error)`, `progressFor(run)`, `useActiveRun()` shape, and `RunWidget({ onView })` / `GenerateSection({ onViewLeads })` signatures are used identically across tasks.
