# Design: "New leads" view

**Date:** 2026-06-29
**Status:** Approved (pre-implementation)

## Problem

When a lead-generation run completes, the "View leads →" button on the Generate
section's done screen calls `setView('leads')`, dropping the user into the **full**
leads sheet. The run's fresh results are mixed in with every other lead and
subject to whatever filters were already set, so there is no clean "here is what I
just found" moment.

## Goal

After a run finishes, "View leads →" should open a focused, in-app view showing
**only that run's leads**.

## Decisions (from brainstorming)

- **Tab type:** in-app view — a third item in the left `FilterRail`
  (Generate · Leads · **New leads**). No router, no real browser tab.
- **Scope:** just the tracked run's leads (not an accumulating "unseen" inbox).
- **Lifecycle:** tied to the tracked run.
  - Appears when a run reaches `status === 'done'`.
  - Survives refresh — the run id is already persisted by `RunProvider`
    (`localStorage` key `onrai.activeRunId`) and re-attached on load.
  - Replaced by the new run's results when a new run starts.
  - Disappears when the run is dismissed (`dismiss()` from `useActiveRun`).

## Data — no backend change required

`/api/leads` already returns `run_id` for every row: `store.query_leads` does
`SELECT *` and `_lead_to_dict` does `dict(row)`, so `run_id` is already in the JSON
payload. It is simply not surfaced in the frontend types yet.

Frontend changes only:

1. `web/src/lib/api.ts` — add `run_id: number | null` to the `ApiLead` interface.
2. `web/src/types.ts` — add `runId: number | null` to the `Lead` interface.
3. `web/src/lib/leads.ts` — thread `item.run_id` through `toLead` into the mapped
   `Lead`. (`run_id` is a real column, not part of `extra`, so it is passed as a
   dedicated argument rather than via `apiLeadToRaw`, which is string-only.)

The leads list is already fetched with `page_size=500`, so the newest run's leads
are present in the loaded set; the "new leads" filter is a pure client-side
`leads.filter(l => l.runId === run.id)`.

## Components & flow

### `Dashboard.tsx`
- Widen view state: `const [view, setView] = useState<'leads' | 'generate' | 'new'>('leads')`.
- `run` is already available from `useActiveRun()`.
- Derive `runLeads = useMemo(() => run ? leads.filter(l => l.runId === run.id) : [], [leads, run])`.
- A finished run is one with `run?.status === 'done'`. Use this to decide whether
  the "New leads" rail item and view are available.
- `GenerateSection`'s `onViewLeads` now routes to `'new'`:
  `<GenerateSection onViewLeads={() => setView('new')} />`.
- Render the `'new'` view (when `view === 'new'`):
  - A header strip: `"{runLeads.length} new leads · {category} · {n} suburbs"`
    plus **Generate more** (→ `setView('generate')`) and **Go to all leads**
    (→ `setView('leads')`) buttons.
  - Reuse the existing `.sheet` table markup + `LeadRow` (same columns, same
    `onSelect` → `LeadDrawer`, same `onSetStatus` quick actions).
  - Sort newest-then-hottest (reuse `applySort(runLeads, 'newest')`).
  - Empty state when `runLeads.length === 0` (run found nothing): a friendly
    "This run didn't find any leads" message with a **Generate more** button.
  - No `FilterRail` status filters and no `TableFilters` here — it is a fixed,
    focused list.
- Header (`desk__head`) eyebrow/title: add a `'new'` branch
  (e.g. eyebrow "Onrai Studio · just generated", title
  "{n} new leads from this run").

### `FilterRail.tsx`
- Accept the widened view union for `view` / `onNavigate`.
- Accept a way to show the third item conditionally — pass `newCount?: number`
  (or `showNew: boolean` + count). Render the **New leads** nav item only when a
  finished run is tracked, with a count badge, and active-highlight it when
  `view === 'new'` consistent with the existing items.

### `GenerateSection.tsx`
- No internal change beyond what `onViewLeads` does at the call site; the button
  label "View leads →" stays. (Optionally relabel to "View new leads →" — minor,
  decide during implementation.)

## Edge cases

- **Refresh on `'new'` with a tracked done-run:** `RunProvider` re-attaches the
  run, `runLeads` recomputes, the view stays valid.
- **Run dismissed (or never present) while `view === 'new'`:** the New leads item
  is hidden; guard the `'new'` render so that if there is no finished run, it
  falls back to the `'leads'` view (e.g. an effect: if `view === 'new'` and no
  finished run, `setView('leads')`).
- **New run starts while viewing `'new'`:** the run is no longer `done`, so the
  New leads view is hidden until the new run finishes, at which point it
  repopulates with the new run's leads (different `run.id`).
- **Run found 0 leads:** New leads item still appears (run is `done`); the view
  shows the empty state.

## Out of scope (YAGNI)

- No client-side router or real browser tab / shareable URL.
- No backend `run_id` query param — client-side filter on the already-loaded set
  is sufficient.
- No "mark as seen" / cross-run accumulating inbox.
- No pagination changes.

## Files touched

- `web/src/lib/api.ts` — `ApiLead.run_id`.
- `web/src/types.ts` — `Lead.runId`.
- `web/src/lib/leads.ts` — map `run_id` → `runId`.
- `web/src/components/Dashboard.tsx` — `'new'` view, `runLeads`, routing, render.
- `web/src/components/FilterRail.tsx` — conditional New leads nav item + badge.
- `web/src/index.css` — styling for the new header strip / badge (reusing
  existing `.sheet` / `.btn` classes where possible).
