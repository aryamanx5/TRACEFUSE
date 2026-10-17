import cytoscape, { type Core } from 'cytoscape'
import { useEffect, useMemo, useRef, useState } from 'react'
import { qs } from '../../lib/api'
import { useApi } from '../../lib/hooks'
import type { FusionResponse } from '../../lib/types'
import { STATUS_LABEL, short } from '../../lib/format'
import { ErrorBox, Spinner } from '../../components/ui'
import { filterParams, type Filter, type Selection } from './state'

const STATUSES = ['verified_onchain', 'external_assertion', 'algorithmic_inference', 'analyst_hypothesis'] as const
const CONF = ['confirmed', 'strong', 'moderate', 'weak', 'unverified']

export default function FusionView({ invId, filter, onSelect, reloadKey }: { invId: string; filter: Filter; onSelect: (s: Selection) => void; reloadKey: number }) {
  const { data, error, loading, reload } = useApi<FusionResponse>(`/api/investigations/${invId}/fusion${qs(filterParams(filter))}`, [reloadKey])
  const [statuses, setStatuses] = useState<string[]>([...STATUSES])
  const [types, setTypes] = useState<string[] | null>(null)
  const [minConf, setMinConf] = useState('weak')
  const [allTransfers, setAllTransfers] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const cy = useRef<Core | null>(null)

  const relTypes = useMemo(() => [...new Set((data?.relationships ?? []).map((r) => r.type))].sort(), [data])
  const activeTypes = types ?? relTypes

  const visible = useMemo(() => {
    if (!data) return { ents: [], rels: [] }
    const confRank = (c: string) => CONF.indexOf(c)
    let rels = data.relationships.filter((r) => statuses.includes(r.assertion_status) && activeTypes.includes(r.type) && confRank(r.confidence) <= confRank(minConf))
    if (!allTransfers) {
      const intelTouched = new Set<string>()
      for (const r of rels) if (r.type !== 'observed_transfer') { intelTouched.add(r.source); intelTouched.add(r.target) }
      rels = rels.filter((r) => r.type !== 'observed_transfer' || intelTouched.has(r.source) || intelTouched.has(r.target))
    }
    const ids = new Set(rels.flatMap((r) => [r.source, r.target]))
    return { ents: data.entities.filter((e) => ids.has(e.id) || e.is_seed), rels }
  }, [data, statuses, activeTypes, minConf, allTransfers])

  useEffect(() => {
    if (!box.current || !data) return
    const v = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim()
    const colors: Record<string, string> = { verified_onchain: v('--signal'), external_assertion: v('--intel'), algorithmic_inference: v('--hypo'), analyst_hypothesis: v('--analyst') }
    const c = cytoscape({
      container: box.current,
      elements: [
        ...visible.ents.map((e) => ({ data: { id: e.id, type: e.type, seed: e.is_seed ? 1 : 0, label: entLabel(e) } })),
        ...visible.rels.map((r) => ({ data: { id: r.id, source: r.source, target: r.target, status: r.assertion_status, color: colors[r.assertion_status] } })),
      ],
      style: [
        { selector: 'node', style: { label: 'data(label)', 'font-size': 8, color: v('--text'), 'text-wrap': 'wrap', 'text-max-width': '110px', 'text-valign': 'bottom', 'text-margin-y': 3,
          width: 20, height: 20, 'background-color': v('--panel-2'), 'border-width': 2, 'border-color': v('--line-strong') } },
        { selector: 'node[type = "wallet"], node[type = "contract"]', style: { 'border-color': v('--signal') } },
        { selector: 'node[type = "contract"]', style: { shape: 'round-rectangle' } },
        { selector: 'node[seed = 1]', style: { 'background-color': v('--signal'), width: 28, height: 28 } },
        { selector: 'node[type = "document"], node[type = "public_report"]', style: { shape: 'rectangle', 'border-color': v('--intel') } },
        { selector: 'node[type = "sanctions_entry"], node[type = "sanctions_notice"]', style: { shape: 'tag', 'border-color': v('--danger') } },
        { selector: 'node[type = "label"], node[type = "intel_indicator"]', style: { shape: 'barrel', 'border-color': v('--intel') } },
        { selector: 'node[type = "bridge_event"]', style: { shape: 'diamond', 'border-color': v('--signal-2') } },
        { selector: 'node[type = "transaction"]', style: { shape: 'vee', 'border-color': v('--signal-2') } },
        { selector: 'node[type = "analyst_entity"]', style: { 'border-color': v('--analyst') } },
        { selector: 'edge', style: { width: 1.6, 'line-color': 'data(color)', 'target-arrow-color': 'data(color)', 'target-arrow-shape': 'triangle', 'curve-style': 'bezier', opacity: 0.8 } },
        { selector: 'edge[status = "external_assertion"]', style: { 'line-style': 'dashed' } },
        { selector: 'edge[status = "algorithmic_inference"]', style: { 'line-style': 'dotted', width: 2 } },
        { selector: 'edge[status = "analyst_hypothesis"]', style: { 'line-style': 'dashed', 'line-dash-pattern': [8, 3, 2, 3] } },
        { selector: ':selected', style: { 'overlay-color': v('--signal'), 'overlay-opacity': 0.25 } },
      ],
    })
    // synchronous layout: an animated cose layout keeps scheduling frames after a filter change rebuilds the graph
    const lay = c.layout({ name: 'cose', animate: false, nodeRepulsion: () => 12000, idealEdgeLength: () => 90 } as cytoscape.LayoutOptions)
    lay.run()
    c.on('tap', 'edge', (e) => {
      const rel = data.relationships.find((r) => r.id === e.target.id())
      if (rel) onSelect({ kind: 'relationship', rel })
    })
    c.on('tap', 'node', (e) => {
      const id = e.target.id() as string
      if (id.startsWith('wallet:')) onSelect({ kind: 'node', address: id.split(':')[2] })
      else {
        const rel = data.relationships.find((r) => r.source === id || r.target === id)
        if (rel) onSelect({ kind: 'relationship', rel })
      }
    })
    cy.current = c
    return () => {
      lay.stop()
      c.stop()
      c.destroy()
      cy.current = null
    }
  }, [visible, data, onSelect])

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-start gap-4 border-b border-line p-2 text-xs">
        <fieldset className="flex flex-wrap gap-2">
          <legend className="sr-only">Assertion status</legend>
          {STATUSES.map((s) => (
            <label key={s} className={`tf-badge status-${s} cursor-pointer`}>
              <input type="checkbox" className="mr-1" checked={statuses.includes(s)} onChange={() => setStatuses(statuses.includes(s) ? statuses.filter((x) => x !== s) : [...statuses, s])} />
              {STATUS_LABEL[s]}
            </label>
          ))}
        </fieldset>
        <label className="flex items-center gap-1">Min confidence
          <select className="tf-select w-auto py-1" value={minConf} onChange={(e) => setMinConf(e.target.value)}>
            {CONF.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1"><input type="checkbox" checked={allTransfers} onChange={(e) => setAllTransfers(e.target.checked)} /> All observed transfers</label>
        <details>
          <summary className="cursor-pointer">Relationship types ({activeTypes.length}/{relTypes.length})</summary>
          <div className="mt-1 grid grid-cols-2 gap-1">
            {relTypes.map((t) => (
              <label key={t} className="flex items-center gap-1"><input type="checkbox" checked={activeTypes.includes(t)}
                onChange={() => setTypes(activeTypes.includes(t) ? activeTypes.filter((x) => x !== t) : [...activeTypes, t])} />{t}</label>
            ))}
          </div>
        </details>
        <span className="ml-auto text-faint">{visible.ents.length} entities · {visible.rels.length} relationships</span>
      </div>
      {loading && !data && <div className="p-4"><Spinner /></div>}
      <ErrorBox error={error} onRetry={reload} />
      {data && data.conflicts.length > 0 && (
        <div className="m-2 rounded-md border border-hypo/50 bg-hypo/10 p-2 text-xs" role="note">
          <p className="font-semibold text-hypo">Competing / changing evidence ({data.conflicts.length})</p>
          <ul>{data.conflicts.slice(0, 5).map((c, i) => <li key={i}><span className="mono">{short(c.address)}</span>: {c.summary}</li>)}</ul>
        </div>
      )}
      <div ref={box} className="min-h-[420px] flex-1" role="application" aria-label="Evidence fusion graph. Select relationships to inspect their evidence." />
      <details className="border-t border-line p-2 text-xs">
        <summary className="cursor-pointer font-medium">Relationship list ({visible.rels.length}) — keyboard-accessible</summary>
        <ul className="mt-2 max-h-56 space-y-1 overflow-auto" aria-label="Fusion relationships">
          {visible.rels.slice(0, 300).map((r) => (
            <li key={r.id}>
              <button type="button" className="w-full rounded px-1 text-left hover:bg-panel2" onClick={() => onSelect({ kind: 'relationship', rel: r })}>
                <span className={`tf-badge status-${r.assertion_status} mr-1`}>{r.type.replace(/_/g, ' ')}</span>
                <span className="mono">{relEnd(r.source)}</span> → <span className="mono">{relEnd(r.target)}</span>
                <span className="ml-1 text-faint">{r.confidence}</span>
              </button>
            </li>
          ))}
        </ul>
      </details>
      <div className="flex flex-wrap gap-3 border-t border-line p-2 text-[11px] text-dim">
        <span style={{ color: 'var(--signal)' }}>━ verified on-chain</span>
        <span style={{ color: 'var(--intel)' }}>┅ external assertion</span>
        <span style={{ color: 'var(--hypo)' }}>⋯ algorithmic inference</span>
        <span style={{ color: 'var(--analyst)' }}>-·- analyst hypothesis</span>
        <span>▭ document · ⌂ sanctions · ◆ bridge event</span>
      </div>
    </div>
  )
}

function relEnd(id: string): string {
  const parts = id.split(':')
  const last = parts[parts.length - 1]
  return /^0x[0-9a-f]{40,64}$/.test(last) ? short(last, 4) : id.length > 32 ? `${id.slice(0, 30)}…` : id
}

function entLabel(e: { type: string; address?: string; title?: string; labels?: (string | null)[]; tx_hash?: string }): string {
  if (e.address) return `${e.labels?.[0] ? `${e.labels[0].slice(0, 20)}\n` : ''}${short(e.address, 4)}`
  if (e.tx_hash) return `tx ${short(e.tx_hash, 4)}`
  return (e.title ?? e.type).slice(0, 40)
}
