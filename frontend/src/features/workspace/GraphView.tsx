import cytoscape, { type Core, type ElementDefinition } from 'cytoscape'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { GraphResponse } from '../../lib/types'
import { fmtAmount, short } from '../../lib/format'
import { usePrefersReducedMotion } from '../../lib/hooks'
import type { Selection } from './state'

type Layout = 'concentric' | 'breadthfirst' | 'cose' | 'circle'

interface Props {
  graph: GraphResponse
  selection: Selection
  onSelect: (s: Selection) => void
  visibleUntil: number | null
  onHide: (addr: string) => void
}

function cssVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#2dd4bf'
}

export default function GraphView({ graph, selection, onSelect, visibleUntil, onHide }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const cy = useRef<Core | null>(null)
  const running = useRef<cytoscape.Layouts | null>(null)
  const reduced = usePrefersReducedMotion()
  const [layout, setLayout] = useState<Layout>('concentric')
  const [labels, setLabels] = useState(true)
  const [hideLeaves, setHideLeaves] = useState(true)
  const [search, setSearch] = useState('')
  const [searchMsg, setSearchMsg] = useState<string | null>(null)

  const elements = useMemo<ElementDefinition[]>(() => {
    const degree = new Map<string, number>()
    for (const e of graph.edges) {
      degree.set(e.source, (degree.get(e.source) ?? 0) + 1)
      degree.set(e.target, (degree.get(e.target) ?? 0) + 1)
    }
    const keep = (id: string) => {
      if (!hideLeaves) return true
      const n = graph.nodes.find((x) => x.id === id)
      return !!n && (n.is_seed || (degree.get(id) ?? 0) > 1 || n.expansion_status !== 'not_expanded' || (n.score ?? 0) >= 20)
    }
    const nodes: ElementDefinition[] = graph.nodes.filter((n) => keep(n.id)).map((n) => {
      const service = n.labels.find((l) => ['bridge', 'mixer', 'exchange', 'dex'].includes(l.category ?? ''))
      const risk = n.labels.some((l) => ['sanctioned', 'exploit', 'exploiter', 'blocked'].includes(l.category ?? ''))
      const name = n.labels.find((l) => l.category === 'name')?.label ?? service?.label ?? n.name
      return {
        data: {
          id: n.id,
          label: name ? `${name.slice(0, 22)}\n${short(n.id, 4)}` : short(n.id, 5),
          size: 18 + Math.min(34, Math.log2(1 + n.in_count + n.out_count) * 5),
          seed: n.is_seed ? 1 : 0,
          contract: n.is_contract ? 1 : 0,
          service: service ? service.category : '',
          risk: risk ? 1 : 0,
          band: n.band ?? 'low',
          hop: n.hop.undirected ?? 9,
          status: n.expansion_status,
        },
      }
    })
    const ids = new Set(nodes.map((n) => n.data.id as string))
    const edges: ElementDefinition[] = graph.edges
      .filter((e) => ids.has(e.source) && ids.has(e.target))
      .map((e) => ({
        data: {
          id: e.id,
          source: e.source,
          target: e.target,
          w: 1 + Math.min(7, Math.log2(1 + e.count) * 1.6),
          label: e.totals[0] ? `${fmtAmount(e.totals[0].amount, 2)} ${e.totals[0].symbol}${e.totals.length > 1 ? ' +' : ''}` : '',
          zero: e.value_bearing ? 0 : 1,
          first: e.first_ts ?? 0,
        },
      }))
    return [...nodes, ...edges]
  }, [graph, hideLeaves])

  // init / rebuild
  useEffect(() => {
    if (!box.current) return
    const signal = cssVar('--signal')
    const intel = cssVar('--intel')
    const hypo = cssVar('--hypo')
    const danger = cssVar('--danger')
    const text = cssVar('--text')
    const panel = cssVar('--panel-2')
    const line = cssVar('--line-strong')
    const c = cytoscape({
      container: box.current,
      elements,
      wheelSensitivity: 0.25,
      minZoom: 0.05,
      maxZoom: 4,
      style: [
        { selector: 'node', style: { width: 'data(size)', height: 'data(size)', 'background-color': panel, 'border-width': 2, 'border-color': line,
          label: labels ? 'data(label)' : '', color: text, 'font-size': 8, 'text-wrap': 'wrap', 'text-valign': 'bottom', 'text-margin-y': 3, 'text-outline-width': 0 } },
        { selector: 'node[contract = 1]', style: { shape: 'round-rectangle' } },
        { selector: 'node[band = "moderate"]', style: { 'border-color': intel } },
        { selector: 'node[band = "elevated"]', style: { 'border-color': hypo, 'border-width': 3 } },
        { selector: 'node[band = "high"]', style: { 'border-color': danger, 'border-width': 4 } },
        { selector: 'node[risk = 1]', style: { 'background-color': danger, 'background-opacity': 0.35 } },
        { selector: 'node[service = "mixer"]', style: { shape: 'octagon', 'border-color': intel, 'border-style': 'double', 'border-width': 4 } },
        { selector: 'node[service = "bridge"]', style: { shape: 'diamond', 'border-color': intel } },
        { selector: 'node[service = "exchange"], node[service = "dex"]', style: { shape: 'hexagon', 'border-color': intel } },
        { selector: 'node[seed = 1]', style: { 'background-color': signal, 'border-color': signal, 'border-width': 4 } },
        { selector: 'edge', style: { width: 'data(w)', 'line-color': signal, 'target-arrow-color': signal, 'target-arrow-shape': 'triangle',
          'curve-style': 'bezier', opacity: 0.7, 'arrow-scale': 0.8, label: '', 'font-size': 7, color: text } },
        { selector: 'edge[zero = 1]', style: { 'line-style': 'dashed', 'line-color': line, 'target-arrow-color': line } },
        { selector: 'edge:selected, edge.hl', style: { label: 'data(label)', opacity: 1, 'line-color': cssVar('--signal-2'), 'target-arrow-color': cssVar('--signal-2') } },
        { selector: 'node:selected', style: { 'overlay-color': signal, 'overlay-opacity': 0.25, 'overlay-padding': 6 } },
        { selector: '.faded', style: { opacity: 0.12 } },
        { selector: '.future', style: { display: 'none' } },
      ],
    })
    running.current = c.layout(layoutOpts(layout, reduced))
    running.current.run()
    c.on('tap', 'node', (e) => onSelect({ kind: 'node', address: e.target.id() }))
    c.on('tap', 'edge', (e) => onSelect({ kind: 'edge', source: e.target.data('source'), target: e.target.data('target') }))
    c.on('tap', (e) => {
      if (e.target === c) onSelect(null)
    })
    cy.current = c
    return () => {
      running.current?.stop()  // stop animated layouts before destroying, or cytoscape dereferences a null renderer
      running.current = null
      c.stop()
      c.destroy()
      cy.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elements, labels])

  const firstLayout = useRef(true)
  useEffect(() => {
    if (firstLayout.current) {
      firstLayout.current = false
      return
    }
    if (!cy.current) return
    running.current?.stop()
    running.current = cy.current.layout(layoutOpts(layout, reduced))
    running.current.run()
  }, [layout, reduced])

  // ChronoReplay: hide edges whose first observed transfer is after the cursor, and nodes they alone introduce
  useEffect(() => {
    const c = cy.current
    if (!c) return
    c.batch(() => {
      c.elements().removeClass('future')
      if (visibleUntil === null) return
      c.edges().forEach((e) => {
        if ((e.data('first') as number) > visibleUntil) e.addClass('future')
      })
      c.nodes().forEach((n) => {
        if (n.data('seed')) return
        if (n.connectedEdges().not('.future').length === 0) n.addClass('future')
      })
    })
  }, [visibleUntil, elements])

  // selection highlight + focus
  useEffect(() => {
    const c = cy.current
    if (!c) return
    c.batch(() => {
      c.elements().removeClass('faded hl').unselect()
      if (selection?.kind === 'node') {
        const n = c.getElementById(selection.address)
        if (n.nonempty()) {
          n.select()
          const nb = n.closedNeighborhood()
          c.elements().not(nb).addClass('faded')
          nb.edges().addClass('hl')
        }
      } else if (selection?.kind === 'edge') {
        const e = c.getElementById(`${selection.source}->${selection.target}`)
        e.select()
      }
    })
  }, [selection, elements])

  function doSearch(e: React.FormEvent) {
    e.preventDefault()
    const q = search.trim().toLowerCase()
    if (!q || !cy.current) return
    const hit = cy.current.nodes().filter((n) => n.id().includes(q) || String(n.data('label')).toLowerCase().includes(q))
    if (hit.empty()) {
      // the wallet may exist but be decluttered away: search the full graph data, not only rendered nodes
      const hidden = graph.nodes.find((n) => n.id.includes(q) || n.labels.some((l) => l.label.toLowerCase().includes(q)))
      if (hidden) {
        setHideLeaves(false)
        setSearchMsg('Found among hidden leaf nodes — leaves are now shown.')
        onSelect({ kind: 'node', address: hidden.id })
        return
      }
      setSearchMsg('No matching address or label in this graph.')
      return
    }
    setSearchMsg(hit.length > 1 ? `${hit.length} matches — showing first` : null)
    const n = hit[0]
    cy.current.animate({ center: { eles: n }, zoom: 1.6 }, { duration: reduced ? 0 : 300 })
    onSelect({ kind: 'node', address: n.id() })
  }

  const sel = selection?.kind === 'node' ? selection.address : null
  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-line p-2 text-xs">
        <form onSubmit={doSearch} className="flex items-center gap-1" role="search">
          <label htmlFor="gsearch" className="sr-only">Search graph</label>
          <input id="gsearch" className="tf-input w-48 py-1" placeholder="Search address / label" value={search} onChange={(e) => setSearch(e.target.value)} />
          <button className="tf-btn py-1">Find</button>
        </form>
        <label className="flex items-center gap-1">Layout
          <select className="tf-select w-auto py-1" value={layout} onChange={(e) => setLayout(e.target.value as Layout)}>
            <option value="concentric">Hop rings</option><option value="breadthfirst">Flow tree</option><option value="cose">Force</option><option value="circle">Circle</option>
          </select>
        </label>
        <button className="tf-btn py-1" onClick={() => cy.current?.fit(undefined, 30)}>Fit</button>
        <button className="tf-btn py-1" aria-label="Zoom in" onClick={() => cy.current?.zoom({ level: (cy.current.zoom() ?? 1) * 1.3, renderedPosition: { x: (box.current?.clientWidth ?? 0) / 2, y: (box.current?.clientHeight ?? 0) / 2 } })}>＋</button>
        <button className="tf-btn py-1" aria-label="Zoom out" onClick={() => cy.current?.zoom({ level: (cy.current.zoom() ?? 1) / 1.3, renderedPosition: { x: (box.current?.clientWidth ?? 0) / 2, y: (box.current?.clientHeight ?? 0) / 2 } })}>－</button>
        <label className="flex items-center gap-1"><input type="checkbox" checked={labels} onChange={(e) => setLabels(e.target.checked)} /> Labels</label>
        <label className="flex items-center gap-1"><input type="checkbox" checked={hideLeaves} onChange={(e) => setHideLeaves(e.target.checked)} /> Hide unexpanded leaves</label>
        {sel && (
          <>
            <button className="tf-btn py-1" onClick={() => { const n = cy.current?.getElementById(sel); if (n) cy.current?.animate({ fit: { eles: n.closedNeighborhood(), padding: 40 } }, { duration: reduced ? 0 : 300 }) }}>Focus neighbourhood</button>
            <button className="tf-btn py-1" onClick={() => onHide(sel)}>Hide node</button>
          </>
        )}
        <span className="ml-auto text-faint">{graph.nodes.length} nodes · {graph.edges.length} edges</span>
      </div>
      {searchMsg && <p role="status" className="px-2 pt-1 text-xs text-hypo">{searchMsg}</p>}
      <div ref={box} className="min-h-[420px] flex-1" role="img" aria-label={`Wallet transfer graph with ${graph.nodes.length} addresses and ${graph.edges.length} directed edges. Use the wallet list below for keyboard access.`} />
      <details className="border-t border-line p-2 text-xs">
        <summary className="cursor-pointer font-medium">Wallet list ({graph.nodes.length}) — keyboard-accessible</summary>
        <ul className="mt-2 max-h-56 space-y-0.5 overflow-auto" aria-label="Wallets in graph">
          {[...graph.nodes]
            .sort((a, b) => Number(b.is_seed) - Number(a.is_seed) || (b.score ?? -1) - (a.score ?? -1) || a.id.localeCompare(b.id))
            .slice(0, 400)
            .map((n) => (
              <li key={n.id}>
                <button type="button" aria-pressed={sel === n.id} onClick={() => onSelect({ kind: 'node', address: n.id })}
                  className={`w-full rounded px-1 text-left hover:bg-panel2 ${sel === n.id ? 'bg-panel2' : ''}`}>
                  <span className="mono">{short(n.id, 6)}</span>
                  {n.is_seed && <span className="tf-badge ml-1">seed</span>}
                  {n.labels[0] && <span className="ml-1 text-dim">{n.labels[0].label}</span>}
                  <span className="ml-1 text-faint">· {n.in_count} in / {n.out_count} out{n.score !== null ? ` · score ${n.score.toFixed(1)}` : ''}</span>
                </button>
              </li>
            ))}
        </ul>
      </details>
      <div className="flex flex-wrap gap-3 border-t border-line p-2 text-[11px] text-dim" aria-label="Legend">
        <span><span className="inline-block h-2.5 w-2.5 rounded-full bg-signal" /> seed</span>
        <span>◆ bridge · ⬢ exchange/DEX · ⯃ mixer (source labels)</span>
        <span>▢ contract</span>
        <span><span className="inline-block h-2.5 w-2.5 rounded-full bg-danger/50" /> source-reported risk label</span>
        <span>border = heuristic band (violet moderate, amber elevated, red high)</span>
        <span>— observed transfer · ┄ zero-value call</span>
      </div>
      <p className="px-2 pb-2 text-[11px] text-faint">{graph.caveat}</p>
    </div>
  )
}

function layoutOpts(l: Layout, reduced: boolean): cytoscape.LayoutOptions {
  const animate = !reduced
  if (l === 'concentric')
    return { name: 'concentric', concentric: (n: cytoscape.NodeSingular) => 10 - Math.min(9, Number(n.data('hop'))), levelWidth: () => 1, minNodeSpacing: 18, animate, animationDuration: 400 } as cytoscape.LayoutOptions
  if (l === 'breadthfirst')
    return { name: 'breadthfirst', directed: true, roots: 'node[seed = 1]', spacingFactor: 1.1, animate, animationDuration: 400 } as cytoscape.LayoutOptions
  if (l === 'circle') return { name: 'circle', animate, animationDuration: 400 }
  return { name: 'cose', animate: false, nodeRepulsion: () => 9000, idealEdgeLength: () => 80, randomize: false } as cytoscape.LayoutOptions
}
