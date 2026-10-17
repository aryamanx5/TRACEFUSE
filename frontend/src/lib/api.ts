// Typed client for the TRACEFUSE backend. All provider credentials stay server-side.

export class ApiError extends Error {
  status: number
  detail: unknown
  constructor(status: number, detail: unknown) {
    const msg =
      typeof detail === 'string'
        ? detail
        : detail && typeof detail === 'object' && 'message' in (detail as Record<string, unknown>)
          ? String((detail as Record<string, unknown>).message)
          : `HTTP ${status}`
    super(msg)
    this.status = status
    this.detail = detail
  }
  get kind(): string | undefined {
    const d = this.detail as Record<string, unknown> | undefined
    return d && typeof d === 'object' && 'kind' in d ? String(d.kind) : undefined
  }
}

const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? ''

export async function api<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json', ...(init?.headers as Record<string, string>) }
  let body = init?.body
  if (init?.json !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(init.json)
  }
  let res: Response
  try {
    res = await fetch(BASE + path, { ...init, headers, body })
  } catch {
    throw new ApiError(0, 'Backend unreachable — is the API server running? (offline)')
  }
  if (res.status === 204) return undefined as T
  const text = await res.text()
  const data = text ? safeJson(text) : null
  if (!res.ok) {
    const detail = data && typeof data === 'object' && 'detail' in data ? (data as { detail: unknown }).detail : data
    throw new ApiError(res.status, detail ?? res.statusText)
  }
  return data as T
}

function safeJson(t: string): unknown {
  try {
    return JSON.parse(t)
  } catch {
    return t
  }
}

export function qs(params: Record<string, string | number | boolean | undefined | null | string[]>): string {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)) continue
    sp.set(k, Array.isArray(v) ? v.join(',') : String(v))
  }
  const s = sp.toString()
  return s ? `?${s}` : ''
}

export const apiUrl = (path: string) => BASE + path

export function sessionId(): string {
  try {
    let s = localStorage.getItem('tf-session')
    if (!s) {
      s = crypto.randomUUID()
      localStorage.setItem('tf-session', s)
    }
    return s
  } catch {
    return 'anonymous-session'
  }
}
