import { useCallback, useEffect, useState } from 'react'
import { loadLeads } from '../lib/leads'
import { patchLeadStatus } from '../lib/api'
import type { Lead, UserStatus } from '../types'

interface State {
  leads: Lead[]
  loading: boolean
  error: string | null
  reload: () => void
  setLeadStatus: (dbId: number, status: UserStatus) => void
}

export function useLeads(): State {
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(() => {
    setLoading(true)
    loadLeads()
      .then((next) => {
        setLeads(next)
        setError(null)
      })
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : 'Failed to load leads'),
      )
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  const setLeadStatus = useCallback((dbId: number, status: UserStatus) => {
    let prev: UserStatus | undefined
    setLeads((cur) =>
      cur.map((l) => {
        if (l.dbId !== dbId) return l
        prev = l.userStatus
        return { ...l, userStatus: status }
      }),
    )
    patchLeadStatus(dbId, status).catch((e: unknown) => {
      // Roll back the optimistic change and surface the failure.
      setLeads((cur) =>
        cur.map((l) =>
          l.dbId === dbId && prev !== undefined
            ? { ...l, userStatus: prev }
            : l,
        ),
      )
      setError(e instanceof Error ? e.message : 'Failed to update lead')
    })
  }, [])

  return { leads, loading, error, reload, setLeadStatus }
}
