import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLeads } from '../hooks/useLeads'
import { logout } from '../lib/api'
import { loadLeads } from '../lib/leads'
import type { Lead } from '../types'
import { FilterRail, type Filters } from './FilterRail'
import { StatStrip } from './StatStrip'
import { LeadRow } from './LeadRow'
import { LeadDrawer } from './LeadDrawer'
import { GenerateSection } from './GenerateSection'
import { RunWidget } from './RunWidget'
import { useActiveRun } from '../run/RunProvider'
import { TableFilters } from './TableFilters'
import { Pager } from './Pager'
import { Menu, Signal } from './Icons'

const DEFAULT_FILTERS: Filters = {
  query: '',
  status: 'all',
  category: '',
  suburb: '',
  phoneOnly: false,
  sort: 'hot',
  bucket: 'active',
}

const PAGE_SIZE = 50
const AUTH_ERROR = 'Not authenticated'

export function Dashboard({
  canLogout,
  onSignedOut,
}: {
  canLogout: boolean
  onSignedOut: () => void
}) {
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS)
  const [page, setPage] = useState(1)
  const { leads, total, facets, loading, error, reload, setLeadStatus } =
    useLeads(filters, page, PAGE_SIZE)
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

  const [active, setActive] = useState<Lead | null>(null)
  const [view, setView] = useState<'leads' | 'generate' | 'new'>('leads')
  // Mobile only: the slide-in nav drawer. Hidden entirely on desktop via CSS.
  const [navOpen, setNavOpen] = useState(false)

  // Navigating to a view from the slide-in nav should also close it.
  const navigate = useCallback((next: 'leads' | 'generate' | 'new') => {
    setView(next)
    setNavOpen(false)
  }, [])

  // The "New leads" view is tied to a finished run: it shows just that run's
  // results, fetched directly (run_id filter, newest first). A single run targets
  // at most a few hundred leads, so one large page covers it without a pager.
  const finishedRun = run && run.status === 'done' ? run : null
  const [runLeads, setRunLeads] = useState<Lead[]>([])
  useEffect(() => {
    if (!finishedRun) {
      setRunLeads([])
      return
    }
    let cancelled = false
    loadLeads({ run_id: finishedRun.id, sort: 'newest', page_size: 500 })
      .then(({ leads: next }) => { if (!cancelled) setRunLeads(next) })
      .catch(() => { if (!cancelled) setRunLeads([]) })
    return () => { cancelled = true }
  }, [finishedRun])

  // If the New leads view is open but its run goes away (dismissed, or a new run
  // starts), fall back to the full lead sheet rather than showing a dead view.
  useEffect(() => {
    if (view === 'new' && !finishedRun) setView('leads')
  }, [view, finishedRun])

  // A lapsed session surfaces as a 401 "Not authenticated" — bounce to login.
  useEffect(() => {
    if (error === AUTH_ERROR) onSignedOut()
  }, [error, onSignedOut])

  // Clear the cookie, then drop back to the login screen even if the request
  // hiccups — the local session is over regardless.
  const handleLogout = useCallback(() => {
    dismissRun()
    logout().finally(onSignedOut)
  }, [dismissRun, onSignedOut])

  // Filter chrome (counts, dropdowns) comes from the global facets, not the page.
  const counts = useMemo(
    () => ({
      all: facets?.total ?? 0,
      top: facets?.top ?? 0,
      social_only: facets?.social_only ?? 0,
      none: facets?.none ?? 0,
    }),
    [facets],
  )
  const industries = facets?.industries ?? []
  const suburbs = facets?.suburbs ?? []

  // Any filter change starts over at page 1.
  const update = (next: Partial<Filters>) => {
    setFilters((f) => ({ ...f, ...next }))
    setPage(1)
  }

  return (
    <div className={`app ${navOpen ? 'app--nav-open' : ''}`}>
      <header className="topbar">
        <span className="topbar__brand">
          <span className="brand__mark" aria-hidden="true">
            <Signal />
          </span>
          <strong>ONRAI STUDIO</strong>
        </span>
        <button
          type="button"
          className="topbar__menu"
          onClick={() => setNavOpen(true)}
          aria-label="Open menu"
          aria-expanded={navOpen}
        >
          <Menu />
        </button>
      </header>

      <div
        className={`nav-scrim ${navOpen ? 'is-open' : ''}`}
        onClick={() => setNavOpen(false)}
        aria-hidden="true"
      />

      <FilterRail
        filters={filters}
        counts={counts}
        onChange={update}
        view={view}
        onNavigate={navigate}
        newLeads={finishedRun ? { count: runLeads.length } : undefined}
        onLogout={canLogout ? handleLogout : undefined}
        open={navOpen}
        onClose={() => setNavOpen(false)}
      />

      <main className="desk">
        <header className="desk__head">
          <div>
            <p className="desk__eyebrow">
              {view === 'generate'
                ? 'Onrai Studio · lead finder'
                : view === 'new'
                  ? 'Onrai Studio · just generated'
                  : 'Onrai Studio · no-website prospects'}
            </p>
            <h1 className="desk__title">
              {view === 'generate'
                ? 'Generate new leads'
                : view === 'new'
                  ? `${runLeads.length} new ${runLeads.length === 1 ? 'lead' : 'leads'} from this run`
                  : loading
                    ? 'Loading the dial sheet…'
                    : error
                      ? 'Could not load leads'
                      : `${total} ${total === 1 ? 'lead' : 'leads'} ready to work`}
            </h1>
          </div>
        </header>

        {view === 'generate' && (
          <GenerateSection
            onViewLeads={() => setView('new')}
          />
        )}

        {view === 'new' && (
          <section className="newleads">
            <div className="newleads__bar">
              <p className="newleads__sub">
                Fresh from your latest run — already saved to the lead sheet.
              </p>
              <div className="newleads__actions">
                <button
                  type="button"
                  className="btn"
                  onClick={() => setView('generate')}
                >
                  Generate more
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setView('leads')}
                >
                  Go to all leads →
                </button>
              </div>
            </div>

            {runLeads.length === 0 ? (
              <p className="sheet__empty">
                This run didn't find any leads. Try widening the criteria or a
                different suburb, then generate again.
              </p>
            ) : (
              <section className="sheet" aria-label="New leads">
                <div className="sheet__head">
                  <span>#</span>
                  <span>Business</span>
                  <span>Tier</span>
                  <span>Traction</span>
                  <span>Reach</span>
                  <span>Heat</span>
                  <span>Generated</span>
                  <span className="sheet__head-act">Quick actions</span>
                </div>
                {runLeads.map((lead, i) => (
                  <LeadRow
                    key={lead.id}
                    lead={lead}
                    rank={i + 1}
                    onSelect={setActive}
                    onSetStatus={setLeadStatus}
                  />
                ))}
              </section>
            )}
          </section>
        )}

        {view === 'leads' && !loading && !error && facets && (
          <StatStrip
            metrics={{
              total: facets.total,
              top: facets.top,
              social_only: facets.social_only,
              none: facets.none,
              reachable: facets.reachable,
            }}
            filters={filters}
            onChange={update}
          />
        )}

        {view === 'leads' && error && (
          <div className="panel panel--error">
            <p>{error}</p>
            <p className="panel__hint">
              {error === AUTH_ERROR
                ? 'Your session expired — taking you back to sign in…'
                : 'The backend could not return leads. Check the API is running, then retry.'}
            </p>
            {error !== AUTH_ERROR && (
              <button className="btn" type="button" onClick={reload}>
                Retry
              </button>
            )}
          </div>
        )}

        {view === 'leads' && loading && (
          <div className="sheet" aria-busy="true">
            {Array.from({ length: 6 }).map((_, i) => (
              <div className="row row--skeleton" key={i} />
            ))}
          </div>
        )}

        {view === 'leads' && !loading && !error && (
          <TableFilters
            filters={filters}
            industries={industries}
            suburbs={suburbs}
            onChange={update}
          />
        )}

        {view === 'leads' && !loading && !error && (
          <section className="sheet" aria-label="Leads">
            <div className="sheet__head">
              <span>#</span>
              <span>Business</span>
              <span>Tier</span>
              <span>Traction</span>
              <span>Reach</span>
              <span>Heat</span>
              <span>Generated</span>
              <span className="sheet__head-act">Quick actions</span>
            </div>

            {leads.length === 0 ? (
              <p className="sheet__empty">
                No leads match these filters. Try widening the tier or clearing
                the search.
              </p>
            ) : (
              leads.map((lead, i) => (
                <LeadRow
                  key={lead.id}
                  lead={lead}
                  rank={(page - 1) * PAGE_SIZE + i + 1}
                  onSelect={setActive}
                  onSetStatus={setLeadStatus}
                />
              ))
            )}
          </section>
        )}

        {view === 'leads' && !loading && !error && (
          <Pager page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />
        )}
      </main>

      {view !== 'generate' && (
        <RunWidget onView={() => setView('generate')} />
      )}

      <LeadDrawer
        lead={active ? leads.find((l) => l.dbId === active.dbId) ?? active : null}
        onClose={() => setActive(null)}
        onSetStatus={setLeadStatus}
      />
    </div>
  )
}
