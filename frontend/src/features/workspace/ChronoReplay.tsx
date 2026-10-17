import { useEffect, useMemo, useRef, useState } from 'react'
import { api, qs } from '../../lib/api'
import { fmtAmount, fmtTime } from '../../lib/format'
import type { GraphStats, TimelineResponse } from '../../lib/types'
import { filterParams, type Filter } from './state'

interface Props {
  invId: string
  timeline: TimelineResponse | null
  filter: Filter
  setFilter: (f: Filter) => void
  at: number | null
  setAt: (t: number | null) => void
  onSelectTransfer: (id: string) => void
}

const SPEEDS = [0.5, 1, 2, 4, 8]

/** Plays back real recorded transfers in order. The cursor drives graph visibility; figures come from the
 *  backend /snapshot endpoint for the chosen instant. */
export default function ChronoReplay({ invId, timeline, filter, setFilter, at, setAt, onSelectTransfer }: Props) {
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [snapState, setSnapState] = useState<{ at: number; stats: GraphStats; latest: string[] } | null>(null)
  const events = useMemo(() => timeline?.events ?? [], [timeline])
  const range = timeline?.range
  const idx = useMemo(() => (at === null ? events.length - 1 : events.findLastIndex((e) => e.ts <= at)), [at, events])
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!playing || events.length === 0) return
    timer.current = setInterval(() => {
      setAt((() => {
        const cur = at === null ? events[0].ts - 1 : at
        const next = events.find((e) => e.ts > cur)
        if (!next) {
          setPlaying(false)
          return null
        }
        return next.ts
      })())
    }, 900 / speed)
    return () => {
      if (timer.current) clearInterval(timer.current)
    }
  }, [playing, speed, at, events, setAt])

  useEffect(() => {
    if (at === null) return
    const t = setTimeout(() => {
      api<{ stats: GraphStats; latest: string[] }>(`/api/investigations/${invId}/snapshot${qs({ ...filterParams(filter), at: String(at) })}`)
        .then((r) => setSnapState({ at, ...r }))
        .catch(() => setSnapState(null))
    }, playing ? 400 : 120)
    return () => clearTimeout(t)
  }, [at, invId, filter, playing])
  // figures are shown only when they belong to the current cursor (derived, never stale)
  const snap = snapState && snapState.at === at ? snapState : null

  if (!timeline) return null
  const windowControls = (
    <fieldset className="flex flex-wrap items-end gap-2 text-xs">
      <legend className="tf-label">Analysis window (applies to every view)</legend>
      <label>From<input type="datetime-local" className="tf-input py-1" value={toLocal(filter.start)} onChange={(e) => setFilter({ ...filter, start: fromLocal(e.target.value) })} /></label>
      <label>To<input type="datetime-local" className="tf-input py-1" value={toLocal(filter.end)} onChange={(e) => setFilter({ ...filter, end: fromLocal(e.target.value) })} /></label>
      {at !== null && <button className="tf-btn py-1" onClick={() => { setFilter({ ...filter, end: at }); setAt(null) }}>Set window end = cursor</button>}
      {(filter.start !== null || filter.end !== null) && <button className="tf-btn py-1" onClick={() => setFilter({ ...filter, start: null, end: null })}>Clear window</button>}
    </fieldset>
  )
  if (!range) {
    return (
      <section className="tf-panel space-y-2 p-3 text-sm text-dim" aria-label="ChronoReplay timeline">
        <p>
          ChronoReplay: no timestamped transfers in the current filter.
          {timeline.missing_timestamps > 0 && ` ${timeline.missing_timestamps} record(s) lack timestamps and cannot be placed on the timeline.`}
        </p>
        {windowControls}
      </section>
    )
  }
  const maxCount = Math.max(1, ...timeline.buckets.map((b) => b.count))
  const cur = at ?? range.end
  const cursorPct = ((cur - range.start) / Math.max(range.end - range.start, 1)) * 100
  const current = idx >= 0 ? events[idx] : null

  return (
    <section className="tf-panel p-3" aria-label="ChronoReplay timeline">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-2 text-sm font-semibold tracking-wide text-dim uppercase">ChronoReplay</h2>
        <button className="tf-btn" onClick={() => { if (!playing && (at === null || idx >= events.length - 1)) setAt(events[0].ts - 1); setPlaying(!playing) }}
          aria-pressed={playing}>{playing ? '❚❚ Pause' : '▶ Play'}</button>
        <button className="tf-btn" onClick={() => setAt(idx > 0 ? events[idx - 1].ts : events[0].ts)} aria-label="Previous transfer">◀</button>
        <button className="tf-btn" onClick={() => setAt(events[Math.min(idx + 1, events.length - 1)].ts)} aria-label="Next transfer">▶|</button>
        <button className="tf-btn" onClick={() => { setPlaying(false); setAt(null) }} disabled={at === null}>Show all</button>
        <label className="ml-2 flex items-center gap-1 text-xs text-dim">Speed
          <select className="tf-select w-auto py-1" value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
            {SPEEDS.map((s) => <option key={s} value={s}>{s}×</option>)}
          </select>
        </label>
        <span className="ml-auto text-xs text-dim" aria-live="polite">
          {at === null ? 'All time in window' : <>Cursor <span className="mono text-ink">{fmtTime(at)}</span> · transfer {idx + 1}/{events.length}</>}
        </span>
      </div>
      {/* histogram + cursor; also a native range input for keyboard/AT users */}
      <div className="relative mt-3 h-14">
        <div className="absolute inset-0 flex items-end gap-px" aria-hidden>
          {timeline.buckets.map((b, i) => (
            <div key={i} className="flex-1 rounded-t-sm" style={{ height: `${(b.count / maxCount) * 100}%`, background: b.start <= cur ? 'var(--signal)' : 'var(--line-strong)', opacity: b.count ? 0.85 : 0.2 }} />
          ))}
        </div>
        {timeline.gaps.map((g, i) => (
          <div key={i} className="absolute top-0 bottom-0 border-x border-dashed border-hypo/50 bg-hypo/5"
            style={{ left: `${((g.start - range.start) / (range.end - range.start)) * 100}%`, width: `${((g.end - g.start) / (range.end - range.start)) * 100}%` }}
            title={`No recorded activity for ${Math.round(g.seconds / 3600)}h`} aria-hidden />
        ))}
        <div className="absolute top-0 bottom-0 w-0.5 bg-ink" style={{ left: `${cursorPct}%` }} aria-hidden />
      </div>
      <label htmlFor="replay-slider" className="sr-only">Replay time</label>
      <input id="replay-slider" type="range" className="w-full" min={0} max={events.length - 1} value={Math.max(idx, 0)}
        aria-valuetext={current ? fmtTime(current.ts) : ''} onChange={(e) => { setPlaying(false); setAt(events[Number(e.target.value)].ts) }} />
      <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-xs text-faint">
        <span>{fmtTime(range.start)}</span>
        <span>{timeline.gaps.length > 0 && `${timeline.gaps.length} gap(s) with no recorded activity (dashed)`} {timeline.missing_timestamps > 0 && ` · ${timeline.missing_timestamps} without timestamp`}</span>
        <span>{fmtTime(range.end)}</span>
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-[1fr_auto]">
        <div className="text-sm">
          {current && (
            <button className="w-full rounded-md border border-line p-2 text-left hover:border-signal" onClick={() => onSelectTransfer(current.id)}>
              <span className="text-xs text-faint">Latest revealed transfer · {current.kind}</span><br />
              <span className="mono">{current.from.slice(0, 10)}…</span> → <span className="mono">{current.to?.slice(0, 10)}…</span>{' '}
              <strong>{fmtAmount(current.amount)} {current.symbol}</strong> <span className="text-faint">{fmtTime(current.ts)}</span>
            </button>
          )}
          {snap && (
            <p className="mt-2 text-xs text-dim">
              As of cursor (server-computed): {snap.stats.transfers} transfers · {snap.stats.nodes} addresses · {snap.stats.edges} edges
              {snap.stats.assets.slice(0, 3).map((a) => ` · ${fmtAmount(a.amount, 2)} ${a.symbol}`).join('')}
            </p>
          )}
        </div>
{windowControls}
      </div>
    </section>
  )
}

function toLocal(ts: number | null): string {
  if (ts === null) return ''
  return new Date(ts * 1000).toISOString().slice(0, 16)
}
function fromLocal(v: string): number | null {
  if (!v) return null
  const t = Date.parse(v + ':00Z')
  return Number.isNaN(t) ? null : Math.floor(t / 1000)
}
