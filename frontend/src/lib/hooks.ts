import { useCallback, useEffect, useRef, useState } from 'react'
import { api, apiUrl } from './api'
import type { Investigation, ProgressEvent } from './types'

interface ApiState<T> {
  key: string | null // request key the state belongs to
  data: T | null
  error: unknown
}

/** Fetch `path`; state is keyed by request so no synchronous resets are needed inside effects.
 *  `loading` is derived: the latest settled request differs from the current one. */
export function useApi<T>(path: string | null, deps: unknown[] = []) {
  const [nonce, setNonce] = useState(0)
  const key = path ? `${path}|${JSON.stringify(deps)}|${nonce}` : null
  const [state, setState] = useState<ApiState<T>>({ key: null, data: null, error: null })
  const fetchedBy = useRef<string | null>(null) // key already satisfied by reload(); skip the duplicate fetch

  useEffect(() => {
    if (!key || !path || fetchedBy.current === key) return
    let alive = true
    api<T>(path).then(
      (d) => alive && setState({ key, data: d, error: null }),
      (e) => alive && setState((s) => ({ key, data: s.data, error: e })),
    )
    return () => {
      alive = false
    }
  }, [key, path])

  /** Re-fetch now; resolves once the fresh data is in state (usable with await from event handlers). */
  const reload = useCallback(async () => {
    if (!path) return
    const next = `${path}|${JSON.stringify(deps)}|${nonce + 1}`
    fetchedBy.current = next
    try {
      const d = await api<T>(path)
      setState({ key: next, data: d, error: null })
    } catch (e) {
      setState((s) => ({ key: next, data: s.data, error: e }))
    }
    setNonce((n) => n + 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, nonce, JSON.stringify(deps)])

  const settled = state.key === key
  return { data: state.data, error: settled ? state.error : null, loading: !!key && !settled, reload }
}

const TERMINAL = new Set(['completed', 'partial', 'failed', 'cancelled'])

/** Investigation record + real backend progress via SSE (falls back to polling the persisted event log). */
export function useInvestigation(id: string | undefined) {
  const [invState, setInv] = useState<Investigation | null>(null)
  const [evState, setEvState] = useState<{ id: string | undefined; list: ProgressEvent[] }>({ id: undefined, list: [] })
  const [error, setError] = useState<unknown>(null)
  const lastSeq = useRef(0)

  const refresh = useCallback(async () => {
    if (!id) return
    try {
      setInv(await api<Investigation>(`/api/investigations/${id}`))
    } catch (e) {
      setError(e)
    }
  }, [id])

  useEffect(() => {
    if (!id) return
    lastSeq.current = 0
    let alive = true
    api<Investigation>(`/api/investigations/${id}`).then((r) => alive && setInv(r), (e) => alive && setError(e))
    let es: EventSource | null = null
    let poll: ReturnType<typeof setInterval> | null = null
    const push = (ev: ProgressEvent) => {
      if (ev.seq <= lastSeq.current) return
      lastSeq.current = ev.seq
      setEvState((prev) => ({ id, list: prev.id === id ? [...prev.list, ev] : [ev] }))
      if (ev.stage === 'lifecycle') void refresh() // terminal/cancel events change the record
    }
    const startPolling = () => {
      poll = setInterval(async () => {
        try {
          const evs = await api<ProgressEvent[]>(`/api/investigations/${id}/events.json?after=${lastSeq.current}`)
          evs.forEach(push)
          const r = await api<Investigation>(`/api/investigations/${id}`)
          setInv(r)
          if (TERMINAL.has(r.status) && !r.running && poll) clearInterval(poll)
        } catch (e) {
          setError(e)
        }
      }, 1500)
    }
    if (typeof EventSource !== 'undefined') {
      es = new EventSource(apiUrl(`/api/investigations/${id}/events`))
      es.addEventListener('progress', (m) => {
        try {
          push(JSON.parse((m as MessageEvent).data))
        } catch {
          /* ignore malformed */
        }
      })
      es.addEventListener('end', () => {
        es?.close()
        void refresh()
      })
      es.onerror = () => {
        es?.close()
        if (!poll) startPolling()
      }
    } else {
      startPolling()
    }
    return () => {
      alive = false
      es?.close()
      if (poll) clearInterval(poll)
    }
  }, [id, refresh])

  const inv = invState && invState.id === id ? invState : null
  const events = evState.id === id ? evState.list : []
  return { inv, events, error, refresh }
}

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

export function usePrefersReducedMotion(): boolean {
  const [r, setR] = useState(() => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    const m = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    const h = () => setR(m.matches)
    m?.addEventListener?.('change', h)
    return () => m?.removeEventListener?.('change', h)
  }, [])
  return !!r
}
