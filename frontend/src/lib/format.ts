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
  verified_onchain: 'Verified transaction',
  external_assertion: 'Source-reported information',
  algorithmic_inference: 'Unverified hypothesis',
  analyst_hypothesis: 'Analyst hypothesis',
}

/** One-line explanations for the evidence statuses (shown as tooltips). */
export const STATUS_HELP: Record<string, string> = {
  verified_onchain: 'Recorded on the blockchain and retrieved from a provider: an observed fact.',
  external_assertion: 'Stated by an outside source (sanctions list, explorer label, report). Shown with its source; not proof by itself.',
  algorithmic_inference: 'A pattern detected by TRACEFUSE. Unconfirmed: treat as a lead, not a finding.',
  analyst_hypothesis: 'Recorded by an analyst in this case. Unconfirmed until supported by evidence.',
}

/** Plain-language description of how far a wallet was followed. */
export const EXPANSION_LABEL: Record<string, string> = {
  seed: 'Starting wallet',
  expanded: 'Followed: its transfers were traced',
  not_expanded: 'Not followed further (outside the hop or branch limits)',
  branch_pruned: 'Partly followed: branch limit reached',
  terminal_service: 'Stopped at a service (exchange, bridge or mixer)',
  depth_limit: 'Stopped at the hop limit',
  provider_error: 'Data provider error: may be incomplete',
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
