import { useEffect, useState } from 'react'
import { api, qs } from '../../lib/api'
import type { Score, Signal } from '../../lib/types'
import { bandColor, short } from '../../lib/format'
import { ErrorBox, Spinner } from '../../components/ui'
import { filterParams, type Filter, type Selection } from './state'

interface Spec {
  version: string
  signals: Record<string, { label: string; weight: number }>
  formula: string
  behaviour_cap: number
}

export default function ScoresView({ invId, filter, onSelect, selection }: { invId: string; filter: Filter; onSelect: (s: Selection) => void; selection: Selection }) {
  const [spec, setSpec] = useState<Spec | null>(null)
  const [scores, setScores] = useState<Score[] | null>(null)
  const [weights, setWeights] = useState<Record<string, number>>({})
  const [disabled, setDisabled] = useState<string[]>([])
  const [showInfra, setShowInfra] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [loading, setLoading] = useState(false)
  const fq = qs(filterParams(filter))

  async function run(w = weights, d = disabled) {
    setLoading(true)
    setError(null)
    try {
      const r = await api<{ spec: Spec; scores: Score[] }>(`/api/investigations/${invId}/scores${fq}`, { method: 'POST', json: { weights: w, disabled: d } })
      setSpec(r.spec)
      setScores(r.scores)
      if (Object.keys(w).length === 0) setWeights(Object.fromEntries(Object.entries(r.spec.signals).map(([k, v]) => [k, v.weight])))
    } catch (e) {
      setError(e)
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    void run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invId, fq])

  const sel = selection?.kind === 'node' ? selection.address : null
  const rows = (scores ?? []).filter((s) => showInfra || s.category === 'candidate')
  return (
    <div className="grid h-full gap-3 p-3 2xl:grid-cols-[minmax(0,1fr)_290px]">
      <div className="min-w-0 overflow-auto">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="tf-display"><span className="tf-thin text-[20px] text-hypo">Priority</span> <span className="tf-heavy text-[22px]">Leads</span></h3>
            <p className="mt-1 max-w-[62ch] text-xs text-dim">Wallets ranked by a heuristic suspicion score (0–100) built from the signals shown. <strong className="text-ink">Not a probability</strong>, uncalibrated, never an identity claim.</p>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <label className="flex items-center gap-1"><input type="checkbox" checked={showInfra} onChange={(e) => setShowInfra(e.target.checked)} /> Show seed &amp; infrastructure</label>
            {loading && <Spinner label="Scoring" />}
          </div>
        </div>
        {spec && <p className="mono mb-2 truncate text-[10.5px] text-faint" title={spec.formula}>{spec.formula}</p>}
        <ErrorBox error={error} onRetry={() => void run()} />
        <table className="tf-table">
          <thead><tr><th>#</th><th>Address</th><th>Score</th><th>Top signals</th><th>Coverage</th><th><span className="sr-only">Explanation</span></th></tr></thead>
          <tbody>
            {rows.slice(0, 200).map((s) => (
              <FragmentRow key={s.address} s={s} sel={sel === s.address} expanded={expanded === s.address}
                onToggle={() => setExpanded(expanded === s.address ? null : s.address)} onSelect={() => onSelect({ kind: 'node', address: s.address })} />
            ))}
          </tbody>
        </table>
        {scores && rows.length === 0 && <p className="p-4 text-sm text-dim">No candidate addresses in the current filter.</p>}
      </div>
      <aside className="space-y-2 border-t border-line pt-3 text-xs 2xl:border-t-0 2xl:border-l 2xl:pt-0 2xl:pl-3" aria-label="Signals and weights">
        <h3 className="tf-section-title">Signals &amp; weights</h3>
        <p className="text-faint">Toggle signals or change weights and re-evaluate. The same inputs always yield the same ranking.</p>
        <div className="grid gap-2 sm:grid-cols-2 2xl:grid-cols-1">
        {spec && Object.entries(spec.signals).map(([k, v]) => (
          <div key={k} className="border border-line bg-elev p-2">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={!disabled.includes(k)} onChange={() => setDisabled(disabled.includes(k) ? disabled.filter((x) => x !== k) : [...disabled, k])} />
              <span>{v.label}</span>
            </label>
            <label className="mt-1 flex items-center gap-2 text-faint">w
              <input type="range" min={0} max={0.5} step={0.01} value={weights[k] ?? v.weight} disabled={disabled.includes(k)}
                onChange={(e) => setWeights({ ...weights, [k]: Number(e.target.value) })} className="flex-1" aria-label={`Weight for ${v.label}`} />
              <span className="mono w-8 text-right">{(weights[k] ?? v.weight).toFixed(2)}</span>
            </label>
          </div>
        ))}
        </div>
        <div className="flex gap-2">
          <button className="tf-btn tf-btn-primary" onClick={() => void run(weights, disabled)}>Re-evaluate</button>
          <button className="tf-btn" onClick={() => { setDisabled([]); setWeights({}); void run({}, []) }}>Defaults</button>
        </div>
        {spec && <p className="text-faint">Behaviour-only cap: without sanctions, threat-intel, seed-flow or contextual mentions, scores cannot exceed {spec.behaviour_cap}. Version {spec.version}.</p>}
      </aside>
    </div>
  )
}

function FragmentRow({ s, sel, expanded, onToggle, onSelect }: { s: Score; sel: boolean; expanded: boolean; onToggle: () => void; onSelect: () => void }) {
  const top = [...s.signals].filter((x) => x.contribution > 0).sort((a, b) => b.contribution - a.contribution).slice(0, 3)
  return (
    <>
      <tr className={sel ? 'bg-signal2/10 shadow-[inset_2px_0_0_var(--signal-2)]' : undefined}>
        <td className="align-middle">{s.rank ? <span className="font-display text-xl leading-none font-black">{String(s.rank).padStart(2, '0')}</span>
          : <span className="text-faint">{s.category === 'seed' ? 'seed' : 'infra'}</span>}</td>
        <td>
          {s.labels.filter(Boolean).slice(0, 1).map((l) => <span key={l} className="block max-w-[200px] truncate text-[11px] text-dim" title={l!}>{l}</span>)}
          <button className="mono whitespace-nowrap text-signal2 hover:underline" onClick={onSelect} title={s.address}>{short(s.address)}</button>
        </td>
        <td>
          <div className="flex items-center gap-2">
            <div className="tf-meter w-20" aria-hidden><span style={{ width: `${s.score}%`, background: bandColor(s.band) }} /></div>
            <span className="mono text-[13px] font-semibold" style={{ color: bandColor(s.band) }}>{s.score.toFixed(1)}</span>
            <span className="tf-badge text-[10px]">{s.band}</span>
          </div>
        </td>
        <td className="text-[11px]">{top.length ? <span className="flex flex-wrap gap-1">{top.map((t) => <span key={t.key} className="border border-line bg-elev px-1.5 py-px whitespace-nowrap">{t.label.split('(')[0].trim()}</span>)}</span> : '—'}</td>
        <td className="text-[11px]">{Math.round(s.coverage * 100)}%</td>
        <td><button className="text-xs text-signal2" aria-expanded={expanded} aria-label={`${expanded ? 'Hide' : 'Explain'} score for ${s.address}`} onClick={onToggle}>{expanded ? 'Hide' : 'Explain'}</button></td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={6} className="border-l-2 border-l-hypo bg-elev">
            <ScoreBreakdown signals={s.signals} />
            {s.caps_applied.map((c) => <p key={c} className="mt-1 text-xs text-hypo">{c}</p>)}
            <ul className="mt-1 text-xs text-faint">{s.limitations.map((l) => <li key={l}>• {l}</li>)}</ul>
          </td>
        </tr>
      )}
    </>
  )
}

export function ScoreBreakdown({ signals }: { signals: Signal[] }) {
  const max = Math.max(0.0001, ...signals.map((x) => x.weight))
  return (
    <table className="w-full text-xs">
      <thead><tr className="text-faint [&>th]:px-1.5 [&>th]:py-1 [&>th]:font-mono [&>th]:text-[10px] [&>th]:font-medium [&>th]:tracking-wider [&>th]:uppercase"><th className="text-left">Signal</th><th>Value</th><th>Weight</th><th className="text-left">Contribution</th><th className="text-left">Supporting facts / missing inputs</th></tr></thead>
      <tbody>
        {signals.map((x) => (
          <tr key={x.key} className={x.enabled ? '' : 'opacity-50'}>
            <td className="py-1 pr-2 pl-1.5">{x.label}</td>
            <td className="mono px-1.5 text-center">{x.value.toFixed(2)}</td>
            <td className="mono px-1.5 text-center">{x.weight.toFixed(2)}</td>
            <td className="pr-2"><div className="tf-meter w-24"><span style={{ width: `${(x.contribution / max) * 100}%` }} /></div></td>
            <td className="text-dim">{x.facts.join('; ') || (x.available ? '—' : <span className="text-hypo">{x.missing_reason}</span>)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
