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
const ENT_TYPE: Record<string, string> = {
  wallet: 'Wallet', contract: 'Contract', document: 'Document', public_report: 'Public report', sanctions_entry: 'Sanctions entry',
  sanctions_notice: 'Sanctions notice', label: 'Source label', intel_indicator: 'Threat-intel indicator', bridge_event: 'Bridge event',
  transaction: 'Transaction', analyst_entity: 'Analyst entity',
}

export default function FusionView({ invId, filter, onSelect, reloadKey }: { invId: string; filter: Filter; onSelect: (s: Selection) => void; reloadKey: number }) {
  const { data, error, loading, reload } = useApi<FusionResponse>(`/api/investigations/${invId}/fusion${qs(filterParams(filter))}`, [reloadKey])
  const [statuses, setStatuses] = useState<string[]>([...STATUSES])
  const [types, setTypes] = useState<string[] | null>(null)
  const [minConf, setMinConf] = useState('weak')
  const [allTransfers, setAllTransfers] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const cy = useRef<Core | null>(null)
  const [hover, setHover] = useState<{ x: number; y: number; title: string; lines: string[] } | null>(null)

  const relTypes = useMemo(() => [...new Set((data?.relationships ?? []).map((r) => r.type))].sort(), [data])
  const activeTypes = types ?? relTypes

  const visible = useMemo(() => {
    if (!data) return { ents: [], rels: [] }
    const confRank = (c: string) => CONF.indexOf(c)
    let rels = data.relationships.filter((r) => statuses.includes(r.assertion_status) && activeTypes.includes(r.type) && confRank(r.confidence) <= confRank(minConf))
    if (!allTransfers) {
      const intelTouched = new Set<string>()
      for (const r of rels) if (r.type !== 'observed_transfer') { intelTouched.add(r.source); intelTouched.add(r.target) }
      // default view: only transfers between entities that public sources also talk about — the relationships that need explaining
      rels = rels.filter((r) => r.type !== 'observed_transfer' || (intelTouched.has(r.source) && intelTouched.has(r.target)))
    }
    const ids = new Set(rels.flatMap((r) => [r.source, r.target]))
    return { ents: data.entities.filter((e) => ids.has(e.id) || e.is_seed), rels }
  }, [data, statuses, activeTypes, minConf, allTransfers])

  useEffect(() => {
    if (!box.current || !data) return
    const v = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim()
    const colors: Record<string, string> = { verified_onchain: v('--signal'), external_assertion: v('--intel'), algorithmic_inference: v('--hypo'), analyst_hypothesis: v('--analyst') }
    const degree = new Map<string, number>()
    for (const r of visible.rels) for (const id of [r.source, r.target]) degree.set(id, (degree.get(id) ?? 0) + 1)
    const c = cytoscape({
      container: box.current,
      elements: [
        ...visible.ents.map((e) => ({ data: { id: e.id, type: e.type, seed: e.is_seed ? 1 : 0, label: entLabel(e) },
          classes: e.is_seed || (degree.get(e.id) ?? 0) >= 4 ? 'hub' : '' })),
        ...visible.rels.map((r) => ({ data: { id: r.id, source: r.source, target: r.target, status: r.assertion_status, color: colors[r.assertion_status] } })),
      ],
      style: [
        { selector: 'node', style: { label: '', 'font-size': 10, 'font-family': 'Inter, system-ui, sans-serif', color: v('--text'), 'text-wrap': 'wrap', 'text-max-width': '120px',
          'text-valign': 'bottom', 'text-margin-y': 4, 'min-zoomed-font-size': 6, 'text-background-color': v('--bg'), 'text-background-opacity': 0.85, 'text-background-padding': '2px',
          width: 16, height: 16, 'background-color': v('--panel-2'), 'border-width': 2, 'border-color': v('--line-strong'), 'transition-property': 'opacity', 'transition-duration': 180 } },
        { selector: 'node.hub, node.lbl', style: { label: 'data(label)' } },
        { selector: 'node[type = "wallet"]', style: { 'border-color': v('--signal') } },
        { selector: 'node[type = "contract"]', style: { shape: 'round-rectangle', 'border-color': v('--signal') } },
        { selector: 'node[seed = 1]', style: { shape: 'rectangle', 'background-color': v('--signal'), 'border-color': v('--bg'), width: 26, height: 26, 'font-weight': 'bold' } },
        { selector: 'node[type = "document"], node[type = "public_report"]', style: { shape: 'rectangle', width: 13, height: 17, 'background-color': v('--intel'), 'background-opacity': 0.3, 'border-color': v('--intel') } },
        { selector: 'node[type = "sanctions_entry"], node[type = "sanctions_notice"]', style: { shape: 'tag', 'background-color': v('--ember'), 'background-opacity': 0.3, 'border-color': v('--ember') } },
        { selector: 'node[type = "label"], node[type = "intel_indicator"]', style: { shape: 'barrel', 'border-color': v('--intel') } },
        { selector: 'node[type = "bridge_event"]', style: { shape: 'diamond', 'border-color': v('--signal-2') } },
        { selector: 'node[type = "transaction"]', style: { shape: 'vee', 'border-color': v('--signal-2'), width: 12, height: 12 } },
        { selector: 'node[type = "analyst_entity"]', style: { 'border-color': v('--analyst') } },
        { selector: 'edge', style: { width: 1.6, 'line-color': 'data(color)', 'target-arrow-color': 'data(color)', 'target-arrow-shape': 'triangle', 'arrow-scale': 0.8,
          'curve-style': 'bezier', opacity: 0.75, 'transition-property': 'opacity', 'transition-duration': 180 } },
        { selector: 'edge[status = "external_assertion"]', style: { 'line-style': 'dashed', 'line-dash-pattern': [6, 4] } },
        { selector: 'edge[status = "algorithmic_inference"]', style: { 'line-style': 'dotted', width: 2 } },
        { selector: 'edge[status = "analyst_hypothesis"]', style: { 'line-style': 'dashed', 'line-dash-pattern': [8, 3, 2, 3] } },
        { selector: '.faded', style: { opacity: 0.12 } },
        { selector: 'edge.focus', style: { opacity: 1, width: 2.6 } },
        { selector: ':selected', style: { 'underlay-color': v('--signal-2'), 'underlay-opacity': 0.3, 'underlay-padding': 6 } },
      ],
    })
    // synchronous layout: an animated cose layout keeps scheduling frames after a filter change rebuilds the graph
    const lay = c.layout({ name: 'cose', animate: false, nodeRepulsion: () => 14000, idealEdgeLength: () => 95 } as cytoscape.LayoutOptions)
    lay.run()
    const focus = (el: cytoscape.NodeSingular | cytoscape.EdgeSingular | null) => {
      c.batch(() => {
        c.elements().removeClass('faded focus lbl')
        if (!el) return
        const hood = el.isNode() ? (el as cytoscape.NodeSingular).closedNeighborhood() : el.union((el as cytoscape.EdgeSingular).connectedNodes())
        c.elements().not(hood).addClass('faded')
        hood.nodes().addClass('lbl')
        hood.edges().addClass('focus')
      })
    }
    c.on('mouseover', 'node', (e) => {
      focus(e.target)
      const n = e.target
      const pos = n.renderedPosition()
      setHover({ x: pos.x, y: pos.y, title: n.data('label') as string, lines: [ENT_TYPE[n.data('type') as string] ?? String(n.data('type')).replace(/_/g, ' '), `${n.degree(false)} connection(s)`] })
    })
    c.on('mouseover', 'edge', (e) => {
      focus(e.target)
      const rel = data.relationships.find((r) => r.id === e.target.id())
      const mid = e.target.renderedMidpoint()
      if (rel) setHover({ x: mid.x, y: mid.y, title: rel.type.replace(/_/g, ' '), lines: [STATUS_LABEL[rel.assertion_status], `confidence: ${rel.confidence}`, rel.method ? `why: ${rel.method}` : ''].filter(Boolean) })
    })
    c.on('mouseout', 'node, edge', () => { focus(null); setHover(null) })
    c.on('viewport', () => setHover(null))
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
      <div className="tf-toolbar items-start">
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
        <label className="flex items-center gap-1"><input type="checkbox" checked={allTransfers} onChange={(e) => setAllTransfers(e.target.checked)} /> All observed transfers (default: only between sourced entities)</label>
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
        <div className="m-2 border border-hypo/50 border-l-2 border-l-hypo bg-hypo/10 p-2 text-xs" role="note">
          <p className="font-semibold text-hypo">Competing / changing evidence ({data.conflicts.length})</p>
          <ul>{data.conflicts.slice(0, 5).map((c, i) => <li key={i}><span className="mono">{short(c.address)}</span>: {c.summary}</li>)}</ul>
        </div>
      )}
      <div className="tf-canvas relative h-[max(460px,calc(100vh-21rem))] shrink-0">
        <div ref={box} className="h-full w-full" role="img" aria-label={`Evidence fusion graph with ${visible.ents.length} entities and ${visible.rels.length} relationships. Use the relationship list below for keyboard access.`} />
        {hover && (
          <div className="pointer-events-none absolute z-20 max-w-[280px] border border-linestrong bg-elev/95 px-2.5 py-2 text-xs shadow-lg" style={{ left: hover.x + 14, top: hover.y + 14 }} role="tooltip">
            <p className="font-semibold whitespace-pre-line text-ink">{hover.title}</p>
            {hover.lines.map((l) => <p key={l} className="text-dim">{l}</p>)}
          </div>
        )}
        <p className="pointer-events-none absolute bottom-2 left-3 font-mono text-[10.5px] text-faint">Hover to reveal names and why things are connected · click for the full record</p>
      </div>
      <details className="border-t border-line px-3 py-2 text-xs">
        <summary className="cursor-pointer font-semibold text-dim hover:text-ink">Relationship list ({visible.rels.length}) — keyboard-accessible</summary>
        <ul className="mt-2 max-h-56 space-y-1 overflow-auto" aria-label="Fusion relationships">
          {visible.rels.slice(0, 300).map((r) => (
            <li key={r.id}>
              <button type="button" className="w-full px-1 text-left hover:bg-panel2" onClick={() => onSelect({ kind: 'relationship', rel: r })}>
                <span className={`tf-badge status-${r.assertion_status} mr-1`}>{r.type.replace(/_/g, ' ')}</span>
                <span className="mono">{relEnd(r.source)}</span> → <span className="mono">{relEnd(r.target)}</span>
                <span className="ml-1 text-faint">{r.confidence}</span>
              </button>
            </li>
          ))}
        </ul>
      </details>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-line bg-elev px-3 py-2 text-[11px] text-dim" role="group" aria-label="Legend">
        <span className="tf-kicker mr-1">Legend</span>
        {([['var(--signal)', undefined, 'Verified on-chain'], ['var(--intel)', '6 4', 'Source-reported'], ['var(--hypo)', '1 4', 'Algorithmic hypothesis'], ['var(--analyst)', '8 3 2 3', 'Analyst hypothesis']] as const).map(([c, d, l]) => (
          <span key={l} className="flex items-center gap-1.5"><svg viewBox="0 0 26 8" className="h-2 w-6" aria-hidden><line x1="1" y1="4" x2="25" y2="4" stroke={c} strokeWidth="2" strokeDasharray={d} strokeLinecap="round" /></svg>{l}</span>
        ))}
        <span className="mx-1 hidden h-3 w-px bg-linestrong sm:inline-block" aria-hidden />
        <span className="flex items-center gap-1.5"><svg viewBox="0 0 14 14" className="h-3.5 w-3.5" aria-hidden><rect x="2" y="2" width="10" height="10" fill="var(--panel-2)" stroke="var(--signal)" strokeWidth="1.6" rx="5" /></svg>Wallet</span>
        <span className="flex items-center gap-1.5"><svg viewBox="0 0 14 14" className="h-3.5 w-3.5" aria-hidden><rect x="3" y="1.5" width="8" height="11" fill="color-mix(in srgb, var(--intel) 30%, transparent)" stroke="var(--intel)" strokeWidth="1.6" /></svg>Report / document</span>
        <span className="flex items-center gap-1.5"><svg viewBox="0 0 14 14" className="h-3.5 w-3.5" aria-hidden><path d="M1.5 3h8l3 4-3 4h-8Z" fill="color-mix(in srgb, var(--ember) 30%, transparent)" stroke="var(--ember)" strokeWidth="1.6" /></svg>Sanctions entry</span>
        <span className="flex items-center gap-1.5"><svg viewBox="0 0 14 14" className="h-3.5 w-3.5" aria-hidden><path d="M7 1 13 7 7 13 1 7Z" fill="var(--panel-2)" stroke="var(--signal-2)" strokeWidth="1.6" /></svg>Bridge event</span>
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
