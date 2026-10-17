import { vi } from 'vitest'

type Handler = (url: string, init?: RequestInit) => unknown | Promise<unknown>
export interface Route { match: RegExp; method?: string; status?: number; body: unknown | Handler }

export function mockFetch(routes: Route[]) {
  const calls: { url: string; init?: RequestInit }[] = []
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, init })
    const r = routes.find((x) => x.match.test(url) && (!x.method || x.method === (init?.method ?? 'GET')))
    if (!r) return new Response(JSON.stringify({ detail: `unmocked ${url}` }), { status: 404 })
    const body = typeof r.body === 'function' ? await (r.body as Handler)(url, init) : r.body
    return new Response(body === undefined ? null : JSON.stringify(body), { status: r.status ?? 200, headers: { 'content-type': 'application/json' } })
  })
  vi.stubGlobal('fetch', fn)
  return { fn, calls }
}
