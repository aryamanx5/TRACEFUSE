import { useEffect, useMemo, useRef, useState } from 'react'
import { api, qs } from '../../lib/api'
import { fmtAmount, fmtTime, short } from '../../lib/format'
import type { GraphStats, TimelineResponse } from '../../lib/types'
import { buildMilestones } from './milestones'
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

/** Plays back real recorded transfers in time order. The cursor only changes what is revealed in the views —
 *  never their layout or camera. Figures for the cursor instant come from the backend /snapshot endpoint.
 *  Every row has a fixed height so playback never moves the page. */
export default function ChronoReplay({ invId, timeline, filter, setFilter, at, setAt, onSelectTransfer }: Props) {
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [mode, setMode] = useState<'transfers' | 'milestones'>('transfers')
  const [snapState, setSnapState] = useState<{ at: number; stats: GraphStats } | null>(null)
  const events = useMemo(() => timeline?.events ?? [], [timeline])
  const stops = useMemo(() => buildMilestones(timeline), [timeline])
  const range = timeline?.range
  const idx = useMemo(() => (at === null ? events.length - 1 : events.findLastIndex((e) => e.ts <= at)), [at, events])
  const mIdx = useMemo(() => (at === null ? -1 : stops.findLastIndex((m) => m.ts <= at)), [at, stops])

  // one timer per play session; the current cursor is read from a ref, so ticks do not re-arm effects
  const atRef = useRef(at)
  useEffect(() => {
    atRef.current = at
  }, [at])
  useEffect(() => {
    if (!playing || events.length === 0) return
    const seq = mode === 'milestones' ? stops.map((m) => m.ts) : events.map((e) => e.ts)
    const timer = setInterval(() => {
      const cur = atRef.current === null ? events[0].ts - 1 : atRef.current
      const next = seq.find((t) => t > cur)
      if (next === undefined) {
        setPlaying(false)
        setAt(null)
        return
      }
      setAt(next)
    }, (mode === 'milestones' ? 1600 : 900) / speed)
    return () => clearInterval(timer)
  }, [playing, speed, events, stops, mode, setAt])

  useEffect(() => {
    if (at === null) return
    const t = setTimeout(() => {
      api<{ stats: GraphStats }>(`/api/investigations/${invId}/snapshot${qs({ ...filterParams(filter), at: String(at) })}`)
        .then((r) => setSnapState({ at, stats: r.stats }))
        .catch(() => setSnapState(null))
    }, playing ? 400 : 120)
    return () => clearTimeout(t)
  }, [at, invId, filter, playing])
  // figures are shown only for the instant they were computed for (derived, never stale)
  const snap = snapState && snapState.at === at ? snapState : null

  if (!timeline) return null
  const windowed = filter.start !== null || filter.end !== null
  const windowControls = (
    <details className="relative" open={windowed || undefined}>
      <summary className="tf-btn cursor-pointer list-none" title="Only transfers inside this window are analysed, in every view">
        Time window{windowed ? ' · on' : ''} ▾
      </summary>
      <fieldset className="tf-menu right-0 flex w-[min(40rem,86vw)] flex-wrap items-end gap-2 text-xs">
        <legend className="sr-only">Time window (filters every view)</legend>
        <label className="flex flex-col text-faint">From
          <input type="datetime-local" className="tf-input w-[11.5rem] py-0.5" value={toLocal(filter.start)} onChange={(e) => setFilter({ ...filter, start: fromLocal(e.target.value) })} /></label>
        <label className="flex flex-col text-faint">To
          <input type="datetime-local" className="tf-input w-[11.5rem] py-0.5" value={toLocal(filter.end)} onChange={(e) => setFilter({ ...filter, end: fromLocal(e.target.value) })} /></label>
        <button className="tf-btn" disabled={at === null} onClick={() => { if (at === null) return; setFilter({ ...filter, end: at }); setAt(null) }}
          title="Set the end of the time window to the replay position">Analyse up to this moment</button>
        <button className="tf-btn" disabled={!windowed} onClick={() => setFilter({ ...filter, start: null, end: null })}>Clear window</button>
      </fieldset>
    </details>
  )
  if (!range) {
    return (
      <section className="tf-replay flex flex-wrap items-center justify-between gap-3 text-sm text-dim" aria-label="ChronoReplay timeline">
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
  const pct = (t: number) => ((t - range.start) / Math.max(range.end - range.start, 1)) * 100
  const current = idx >= 0 ? events[idx] : null
  const ms = mode === 'milestones'
  const play = () => {
    if (!playing && (at === null || idx >= events.length - 1)) setAt(events[0].ts - 1)
    setPlaying(!playing)
  }
  const step = (dir: 1 | -1) => {
    setPlaying(false)
    if (ms && stops.length) {
      const i = dir > 0 ? Math.min(mIdx + 1, stops.length - 1) : Math.max(mIdx - 1, 0)
      setAt(stops[i].ts)
    } else setAt(dir > 0 ? events[Math.min(idx + 1, events.length - 1)].ts : idx > 0 ? events[idx - 1].ts : events[0].ts)
  }
  const stop = ms && mIdx >= 0 ? stops[mIdx] : null

  return (
    <section className="tf-replay" aria-label="ChronoReplay timeline">
      <div className="flex h-8 items-center gap-1.5">
        <h2 className="tf-section-title mr-2" title="Replays the recorded transfers in the order they happened">ChronoReplay</h2>
        <button className="tf-btn tf-btn-primary w-[5.75rem] justify-center" onClick={play} aria-pressed={playing}>{playing ? '❚❚ Pause' : '▶ Play'}</button>
        <button className="tf-btn" onClick={() => step(-1)} aria-label={ms ? 'Previous milestone' : 'Previous transfer'}>◀</button>
        <button className="tf-btn" onClick={() => step(1)} aria-label={ms ? 'Next milestone' : 'Next transfer'}>▶|</button>
        <button className="tf-btn" onClick={() => { setPlaying(false); setAt(null) }} disabled={at === null}>Show all</button>
        <label className="ml-1 flex items-center gap-1 text-xs text-dim">Speed
          <select className="tf-select w-auto py-0.5" value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
            {SPEEDS.map((s) => <option key={s} value={s}>{s}×</option>)}
          </select>
        </label>
        <div className="tf-seg ml-2 text-xs" role="group" aria-label="Replay pace">
          <button type="button" aria-pressed={!ms} onClick={() => setMode('transfers')} title="Step through every recorded transfer">Every transfer</button>
          <button type="button" aria-pressed={ms} onClick={() => setMode('milestones')} disabled={stops.length < 2}
            title="Quick replay: jump between key moments of the real record (nothing is removed)">Milestones</button>
        </div>
        <span className="ml-auto truncate pl-2 text-right text-xs text-dim tabular-nums" aria-live="polite">
          {at === null ? `All ${events.length} transfers in the window` : <>Replaying to <span className="mono text-ink">{fmtTime(at)}</span> · transfer {idx + 1}/{events.length}</>}
        </span>
      </div>
      {/* activity histogram + cursor; the native range input underneath serves keyboard and AT users */}
      <div className="relative mt-1.5 h-8">
        <div className="absolute inset-0 flex items-end gap-px" aria-hidden>
          {timeline.buckets.map((b, i) => (
            <div key={i} className="flex-1" style={{ height: `${Math.max(4, (b.count / maxCount) * 100)}%`, background: b.start <= cur ? 'var(--signal)' : 'var(--line-strong)', opacity: b.count ? 0.9 : 0.15 }} />
          ))}
        </div>
        {timeline.gaps.map((g, i) => (
          <div key={i} className="absolute top-0 bottom-0 border-x border-dashed border-hypo/50 bg-hypo/5"
            style={{ left: `${pct(g.start)}%`, width: `${pct(g.end) - pct(g.start)}%` }}
            title={`Quiet period: no recorded activity for ${Math.round(g.seconds / 3600)}h`} aria-hidden />
        ))}
        {ms && stops.map((m, i) => (
          <span key={m.eventId} className="absolute -top-1 h-2.5 w-2.5 -translate-x-1/2 rotate-45 border border-bg"
            style={{ left: `${pct(m.ts)}%`, background: i <= mIdx ? 'var(--signal-2)' : 'var(--text-faint)' }} title={m.label} aria-hidden />
        ))}
        <div className="absolute -top-1 -bottom-1 w-0.5 bg-ink shadow-[0_0_0_3px_rgb(0_0_0/0.4)]" style={{ left: `${pct(cur)}%` }} aria-hidden />
      </div>
      <label htmlFor="replay-slider" className="sr-only">Replay time</label>
      <input id="replay-slider" type="range" className="block h-4 w-full" min={0} max={events.length - 1} value={Math.max(idx, 0)}
        aria-valuetext={current ? fmtTime(current.ts) : ''} onChange={(e) => { setPlaying(false); setAt(events[Number(e.target.value)].ts) }} />
      <div className="flex h-4 items-center justify-between gap-2 text-[11px] text-faint tabular-nums">
        <span>{fmtTime(range.start)}</span>
        <span className="truncate">
          {timeline.gaps.length > 0 && `${timeline.gaps.length} quiet period${timeline.gaps.length === 1 ? '' : 's'} (dashed)`}
          {timeline.missing_timestamps > 0 && ` · ${timeline.missing_timestamps} without timestamp`}
        </span>
        <span>{fmtTime(range.end)}</span>
      </div>
      <div className="mt-1.5 flex h-[2.6rem] items-center justify-between gap-x-3">
        <div className="min-w-0 flex-1 text-xs">
          {current && at !== null ? (
            <button className="block max-w-full truncate border border-line bg-elev px-2 py-0.5 text-left hover:border-signal2" onClick={() => onSelectTransfer(current.id)}
              title="Open this transaction in the Inspector">
              {stop ? <span className="text-signal2">◆ {stop.label} · </span> : <span className="text-faint">Latest transfer · </span>}
              <span className="mono">{short(current.from, 4)}</span> → <span className="mono">{short(current.to, 4)}</span>{' '}
              <strong>{fmtAmount(current.amount)} {current.symbol}</strong> <span className="text-faint">{fmtTime(current.ts)}</span>
            </button>
          ) : <p className="py-0.5 text-faint">Press Play to watch the funds move — or choose Milestones for a quick tour of the key moments.</p>}
          <p className="mt-0.5 truncate text-dim tabular-nums">
            {at === null ? ' ' : snap
              ? <>At this moment (calculated by the server): {snap.stats.transfers} transfers · {snap.stats.nodes} wallets{snap.stats.assets.slice(0, 3).map((a) => ` · ${fmtAmount(a.amount, 2)} ${a.symbol}`).join('')}</>
              : 'Calculating figures for this moment…'}
          </p>
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
