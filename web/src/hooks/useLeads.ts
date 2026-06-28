import { useEffect, useState } from 'react'
import { loadLeads } from '../lib/leads'
import type { Lead } from '../types'

interface State {
  leads: Lead[]
  loading: boolean
  error: string | null
}

export function useLeads(): State {
  const [state, setState] = useState<State>({
    leads: [],
    loading: true,
    error: null,
  })

  useEffect(() => {
    let active = true
    loadLeads()
      .then((leads) => active && setState({ leads, loading: false, error: null }))
      .catch(
        (e: unknown) =>
          active &&
          setState({
            leads: [],
            loading: false,
            error: e instanceof Error ? e.message : 'Failed to load leads',
          }),
      )
    return () => {
      active = false
    }
  }, [])

  return state
}
