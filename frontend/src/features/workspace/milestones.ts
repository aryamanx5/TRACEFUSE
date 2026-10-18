import { fmtAmount } from '../../lib/format'
import type { TimelineResponse } from '../../lib/types'

export interface Milestone {
  ts: number
  label: string
  eventId: string
}

/**
 * A short, honest summary of a recorded timeline for the quick replay: moments picked from the real events
 * (first and last transfer, the largest transfer of the busiest assets, the start of the busiest periods and
 * the first activity after each quiet period). Nothing is removed or invented — playing a milestone reveals
 * every recorded transfer up to that moment, exactly like the transfer-by-transfer replay.
 */
export function buildMilestones(t: TimelineResponse | null, max = 12): Milestone[] {
  const ev = t?.events ?? []
  if (!t || ev.length === 0) return []
  const picked = new Map<string, Milestone>()
  const add = (i: number, label: string) => {
    const e = ev[i]
    if (!e || picked.has(e.id)) return
    picked.set(e.id, { ts: e.ts, label, eventId: e.id })
  }
  add(0, 'First recorded transfer')

  // largest single transfer for the most active assets (amounts compared numerically for ranking only)
  const byAsset = new Map<string, number[]>()
  ev.forEach((e, i) => { if (e.amount) byAsset.set(e.asset_key, [...(byAsset.get(e.asset_key) ?? []), i]) })
  ;[...byAsset.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 3).forEach(([, idx]) => {
    const top = idx.reduce((best, i) => (Number(ev[i].amount) > Number(ev[best].amount) ? i : best), idx[0])
    add(top, `Largest ${ev[top].symbol} transfer · ${fmtAmount(ev[top].amount, 2)} ${ev[top].symbol}`)
  })

  // the busiest periods of the histogram
  ;[...t.buckets].filter((b) => b.count > 0).sort((a, b) => b.count - a.count).slice(0, 3).forEach((b) => {
    const i = ev.findIndex((e) => e.ts >= b.start && e.ts <= b.end)
    if (i >= 0) add(i, `Busiest period · ${b.count} transfers`)
  })

  // activity resuming after a quiet period
  for (const g of t.gaps.slice(0, 4)) {
    const i = ev.findIndex((e) => e.ts >= g.end)
    if (i >= 0) add(i, `Activity resumes after ${Math.round(g.seconds / 3600)}h quiet`)
  }
  add(ev.length - 1, 'Last recorded transfer')

  let out = [...picked.values()].sort((a, b) => a.ts - b.ts)
  if (out.length > max) {
    const inner = out.slice(1, -1)
    const step = inner.length / (max - 2)
    out = [out[0], ...Array.from({ length: max - 2 }, (_, k) => inner[Math.floor(k * step)]), out[out.length - 1]]
  }
  // milestones that share an instant collapse into one stop
  return out.filter((m, i) => i === 0 || m.ts !== out[i - 1].ts)
}
