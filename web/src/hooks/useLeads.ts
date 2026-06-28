import { useCallback, useEffect, useState } from 'react'
import { loadLeads } from '../lib/leads'
import type { Lead } from '../types'

interface State {
  leads: Lead[]
  loading: boolean
  error: string | null
  reload: () => void
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

  return { leads, loading, error, reload }
}
