export const short = (a?: string | null, n = 6) => (a ? (a.length > 2 * n + 2 ? `${a.slice(0, n + 2)}…${a.slice(-n + 2)}` : a) : '—')

export function fmtTime(ts?: number | string | null): string {
  if (ts === null || ts === undefined || ts === '') return '—'
  const d = typeof ts === 'number' ? new Date(ts * 1000) : new Date(ts)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, 'Z').replace(/:00Z$/, 'Z')
}

export function fmtAmount(a?: string | null, maxFrac = 4): string {
  if (a === null || a === undefined) return 'n/a'
  // keep exact string semantics; only shorten the fractional part for display
  const [i, fRaw] = a.split('.')
  const f = fRaw?.replace(/0+$/, '')
  const intPart = i.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  if (!f) return intPart
  const frac = f.slice(0, maxFrac).replace(/0+$/, '')
  return frac ? `${intPart}.${frac}${f.length > maxFrac ? '…' : ''}` : `${intPart}${f.length > maxFrac ? '.…' : ''}`
}

export function fmtDuration(sec?: number | null): string {
  if (sec === null || sec === undefined) return '—'
  if (sec < 60) return `${Math.round(sec)}s`
  if (sec < 3600) return `${Math.round(sec / 60)}m`
  if (sec < 86400) return `${(sec / 3600).toFixed(1)}h`
  return `${(sec / 86400).toFixed(1)}d`
}

export const bandColor = (band?: string | null) =>
  band === 'high' ? 'var(--danger)' : band === 'elevated' ? 'var(--hypo)' : band === 'moderate' ? 'var(--intel)' : 'var(--text-faint)'

export const STATUS_LABEL: Record<string, string> = {
  verified_onchain: 'Verified on-chain',
  external_assertion: 'External assertion',
  algorithmic_inference: 'Algorithmic inference',
  analyst_hypothesis: 'Analyst hypothesis',
}

export const ORIGIN_LABEL: Record<string, string> = {
  live: 'Live',
  cached: 'Cached',
  historical_case: 'Historical case (recorded)',
}

export function safeHref(url?: string | null): string | undefined {
  if (!url) return undefined
  return /^https?:\/\//i.test(url) ? url : undefined
}

export function downloadName(url: string): string {
  return url.split('/').pop() ?? 'download'
}
