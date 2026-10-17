import cytoscape, { type Core, type ElementDefinition } from 'cytoscape'
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import { fmtTime } from '../../../lib/format'
import type { Selection } from '../state'
import { HoverCard, type Hover } from './HoverCard'
import type { FlowModel, TracedPath } from './model'

export interface ViewHandle {
  fit: () => void
  zoom: (factor: number) => void
  reset: () => void
  focus: (id: string) => void
}

interface Props {
  model: FlowModel
  selection: Selection
  onSelect: (s: Selection) => void
  onExpandColumn: (col: number) => void
  path: TracedPath | null
  isolate: boolean
  labels: boolean
  visibleUntil: number | null
  reduced: boolean
}

function cssVar(name: string, fallback: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}

function defs(model: FlowModel): ElementDefinition[] {
  const top = Math.min(0, ...model.nodes.map((n) => n.y)) - 74
  const heads: ElementDefinition[] = model.columns.map((c) => ({
    group: 'nodes',
    data: { id: `col:${c.col}`, col: c.col, label: `${c.label.toUpperCase()}\n${c.shown === c.total ? `${c.total} wallet${c.total === 1 ? '' : 's'}` : `${c.shown} of ${c.total} shown`}` },
    position: { x: c.x, y: top },
    classes: 'colhead',
    selectable: false,
    grabbable: false,
  }))
  const nodes: ElementDefinition[] = model.nodes.map((n) => ({
    group: 'nodes',
    data: { id: n.id, label: n.title, col: n.col },
    position: { x: n.x, y: n.y },
    classes: [`k-${n.kind}`, n.flagged ? 'flagged' : ''].join(' '),
  }))
  const edges: ElementDefinition[] = model.edges.map((e) => ({
    group: 'edges',
    data: {
      id: e.id, source: e.source, target: e.target, label: e.amount, first: e.first ?? 0,
      w: e.edge ? 1.2 + Math.min(4.5, Math.log2(1 + e.edge.count)) : 1.2,
    },
    classes: [`e-${e.kind}`, e.back ? 'back' : 'fwd'].join(' '),
  }))
  return [...heads, ...nodes, ...edges]
}

/** Layered left-to-right fund-flow tree (Cytoscape, preset positions from the shared model). */
export const FlowGraph2D = forwardRef<ViewHandle, Props>(function FlowGraph2D(p, ref) {
  const box = useRef<HTMLDivElement>(null)
  const cy = useRef<Core | null>(null)
  const layoutVersion = useRef(0)
  const prevAt = useRef<number | null>(null)
  const [hover, setHover] = useState<Hover | null>(null)
  const latest = useRef(p)
  useLayoutEffect(() => {
    latest.current = p
  })

  /** Fit everything; if that makes wallets unreadably small, fit the story around the start instead. */
  const fitView = (c: Core, animate: boolean) => {
    let eles = c.elements()
    const zoomFor = (e: cytoscape.CollectionReturnValue) => {
      const bb = e.boundingBox()
      return Math.min((c.width() - 96) / Math.max(bb.w, 1), (c.height() - 96) / Math.max(bb.h, 1))
    }
    if (zoomFor(eles) < 0.7) {
      const core = c.nodes().filter((n) => { const col = Number(n.data('col') ?? 99); return col >= -1 && col <= 2 })
      if (core.nonempty()) eles = core.union(core.edgesWith(core))
    }
    const level = Math.max(0.3, Math.min(1.25, zoomFor(eles)))
    const bb = eles.boundingBox()
    const pan = { x: c.width() / 2 - (bb.x1 + bb.w / 2) * level, y: c.height() / 2 - (bb.y1 + bb.h / 2) * level }
    if (animate && !latest.current.reduced) c.animate({ zoom: level, pan }, { duration: 350, easing: 'ease-out-cubic' })
    else c.viewport({ zoom: level, pan })
  }

  // mount once
  useEffect(() => {
    if (!box.current) return
    const signal = cssVar('--signal', '#2dd4bf')
    const signal2 = cssVar('--signal-2', '#22d3ee')
    const hypo = cssVar('--hypo', '#f59e0b')
    const text = cssVar('--text', '#e6edf7')
    const dim = cssVar('--text-dim', '#9fb0c8')
    const faint = cssVar('--text-faint', '#8a9bb6')
    const panel = cssVar('--panel-2', '#142038')
    const bg = cssVar('--bg', '#070b14')
    const line = cssVar('--line-strong', '#2c3d5e')
    const c = cytoscape({
      container: box.current,
      minZoom: 0.04,
      maxZoom: 3.5,
      boxSelectionEnabled: false,
      style: [
        { selector: 'node', style: {
          width: 14, height: 14, 'background-color': panel, 'border-width': 1.6, 'border-color': signal, 'border-opacity': 0.75,
          label: '', color: dim, 'font-size': 11, 'font-family': 'Inter, system-ui, sans-serif', 'text-valign': 'bottom', 'text-margin-y': 5,
          'text-background-color': bg, 'text-background-opacity': 0.75, 'text-background-padding': '2px', 'text-max-width': '130px', 'text-wrap': 'ellipsis',
          'transition-property': 'opacity, border-color, background-color, width, height', 'transition-duration': 220,
        } },
        { selector: 'node.showlabel', style: { label: 'data(label)' } },
        { selector: 'node.k-seed', style: {
          width: 36, height: 36, 'background-color': signal, 'border-color': signal2, 'border-width': 3, label: 'data(label)', color: text,
          'font-size': 12, 'font-weight': 'bold', 'underlay-color': signal, 'underlay-opacity': 0.22, 'underlay-padding': 12, 'underlay-shape': 'ellipse',
        } },
        { selector: 'node.k-contract', style: { shape: 'round-rectangle' } },
        { selector: 'node.k-bridge', style: { shape: 'diamond', width: 22, height: 22, 'border-color': signal2, 'border-width': 2.5, label: 'data(label)', color: text } },
        { selector: 'node.k-exchange', style: { shape: 'hexagon', width: 22, height: 22, 'border-color': signal2, 'border-width': 2.5, label: 'data(label)', color: text } },
        { selector: 'node.k-mixer', style: { shape: 'octagon', width: 24, height: 24, 'border-color': hypo, 'border-width': 3, 'border-style': 'double', label: 'data(label)', color: text } },
        { selector: 'node.flagged', style: { 'border-color': hypo, 'border-width': 3, 'background-color': hypo, 'background-opacity': 0.28, label: 'data(label)', color: text } },
        { selector: 'node.k-seed.flagged', style: { 'background-color': signal, 'background-opacity': 1, 'border-color': hypo } },
        { selector: 'node.k-more', style: {
          shape: 'round-rectangle', width: 150, height: 26, 'background-color': bg, 'border-style': 'dashed', 'border-color': line, 'border-width': 1.4,
          label: 'data(label)', 'text-valign': 'center', 'text-margin-y': 0, color: faint, 'font-size': 10, 'text-background-opacity': 0,
        } },
        { selector: 'node.colhead', style: {
          shape: 'rectangle', width: 1, height: 1, 'background-opacity': 0, 'border-width': 0, label: 'data(label)', 'text-valign': 'center',
          'text-wrap': 'wrap', 'text-max-width': '220px', color: faint, 'font-size': 10, 'font-weight': 'bold', 'text-background-opacity': 0, events: 'no',
        } },
        { selector: 'edge', style: {
          width: 'data(w)', 'line-color': signal, 'line-opacity': 0.5, 'target-arrow-shape': 'triangle', 'target-arrow-color': signal, 'arrow-scale': 0.75,
          'curve-style': 'taxi', 'taxi-direction': 'rightward', 'taxi-turn': '45%', 'taxi-turn-min-distance': 12,
          'font-size': 9, color: text, 'text-background-color': bg, 'text-background-opacity': 0.85, 'text-background-padding': '2px',
          'transition-property': 'opacity, line-color, width, line-opacity', 'transition-duration': 220,
        } },
        { selector: 'edge.back', style: { 'curve-style': 'unbundled-bezier', 'control-point-distances': [40], 'control-point-weights': [0.5] } },
        { selector: 'edge.e-zero', style: { 'line-style': 'dashed', 'line-color': line, 'target-arrow-color': line, 'line-opacity': 0.8 } },
        { selector: 'edge.e-more', style: { 'line-style': 'dashed', 'line-color': line, 'target-arrow-color': line, 'line-opacity': 0.7, width: 1.2 } },
        { selector: 'edge.e-inferred', style: {
          'curve-style': 'unbundled-bezier', 'control-point-distances': [-30], 'line-style': 'dotted', 'line-color': hypo, 'line-opacity': 0.75,
          'target-arrow-shape': 'none', width: 1.6,
        } },
        { selector: 'edge.hl, edge:selected', style: { label: 'data(label)', 'line-opacity': 1, 'line-color': signal2, 'target-arrow-color': signal2 } },
        { selector: 'edge.onpath', style: { 'line-opacity': 1, 'line-color': signal2, 'target-arrow-color': signal2, width: 4, label: 'data(label)', 'z-index': 9 } },
        { selector: 'node.onpath', style: { 'border-color': signal2, 'border-width': 3, label: 'data(label)', color: text, 'z-index': 9 } },
        { selector: 'node.sel', style: { 'underlay-color': signal2, 'underlay-opacity': 0.35, 'underlay-padding': 9, 'underlay-shape': 'ellipse', label: 'data(label)', color: text, 'z-index': 10 } },
        { selector: '.dim', style: { opacity: 0.13 } },
        { selector: 'edge.future', style: { 'line-opacity': 0.07, 'target-arrow-shape': 'none', label: '' } },
        { selector: 'node.future', style: { opacity: 0.2 } },
        { selector: 'edge.fresh', style: { 'line-color': signal2, 'line-opacity': 1, width: 5 } },
        { selector: 'node.fresh', style: { 'underlay-color': signal2, 'underlay-opacity': 0.45, 'underlay-padding': 10 } },
      ],
    })
    c.on('tap', 'node', (e) => {
      const n = e.target
      if (n.hasClass('colhead')) return
      if (n.hasClass('k-more')) latest.current.onExpandColumn(Number(n.data('col')))
      else latest.current.onSelect({ kind: 'node', address: n.id() })
    })
    c.on('tap', 'edge', (e) => {
      const ed = e.target
      if (ed.hasClass('e-more')) return
      if (ed.hasClass('e-inferred')) {
        const rel = latest.current.model.edges.find((x) => x.id === ed.id())?.rel
        if (rel) latest.current.onSelect({ kind: 'relationship', rel })
        return
      }
      latest.current.onSelect({ kind: 'edge', source: ed.data('source'), target: ed.data('target') })
    })
    c.on('tap', (e) => {
      if (e.target === c) latest.current.onSelect(null)
    })
    c.on('mouseover', 'node', (e) => {
      const n = e.target
      if (n.hasClass('colhead')) return
      const pos = n.renderedPosition()
      setHover({ x: pos.x, y: pos.y, nodeId: n.id() })
      if (box.current) box.current.style.cursor = 'pointer'
    })
    c.on('mouseover', 'edge', (e) => {
      const ed = e.target
      if (ed.hasClass('e-more')) return
      const mid = ed.renderedMidpoint()
      setHover({ x: mid.x, y: mid.y, edgeId: ed.id() })
    })
    c.on('mouseout', 'node, edge', () => {
      setHover(null)
      if (box.current) box.current.style.cursor = ''
    })
    c.on('viewport drag', () => setHover(null))
    cy.current = c
    return () => {
      c.stop()
      c.destroy()
      cy.current = null
    }
  }, [])

  // structure: diff elements in place, move nodes to their model positions, keep the viewport
  useEffect(() => {
    const c = cy.current
    if (!c) return
    const next = defs(p.model)
    const ids = new Set(next.map((d) => d.data.id as string))
    const first = c.elements().empty()
    c.batch(() => {
      c.elements().filter((el) => !ids.has(el.id())).remove()
      for (const d of next) {
        const el = c.getElementById(d.data.id as string)
        if (el.empty()) c.add(d)
        else {
          el.data(d.data)
          el.classes(d.classes as string)
          if (el.isNode() && !p.reduced && !first) el.animate({ position: d.position! }, { duration: 380, easing: 'ease-in-out-cubic' })
          else if (el.isNode()) el.position(d.position!)
        }
      }
    })
    layoutVersion.current += 1
    box.current?.setAttribute('data-layout-version', String(layoutVersion.current))
    if (first) fitView(c, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.model])

  // highlight: selection, traced path, isolation, labels
  useEffect(() => {
    const c = cy.current
    if (!c) return
    const sel = p.selection?.kind === 'node' ? p.selection.address : null
    const pathNodes = new Set(p.path?.nodes ?? [])
    const pathEdges = new Set(p.path?.edges ?? [])
    c.batch(() => {
      c.elements().removeClass('sel hl onpath dim showlabel')
      c.nodes().forEach((n) => {
        if (n.hasClass('colhead')) return
        if (p.labels || n.hasClass('k-more')) n.addClass('showlabel')
      })
      if (sel) {
        const n = c.getElementById(sel)
        if (n.nonempty()) {
          n.addClass('sel showlabel')
          n.connectedEdges().addClass('hl')
          n.neighborhood('node').addClass('showlabel')
        }
      }
      if (p.selection?.kind === 'edge') c.getElementById(`${p.selection.source}->${p.selection.target}`).addClass('hl')
      pathNodes.forEach((id) => c.getElementById(id).addClass('onpath showlabel'))
      pathEdges.forEach((id) => c.getElementById(id).addClass('onpath'))
      if (p.isolate && (pathNodes.size || sel)) {
        const keepN = new Set([...pathNodes, ...(sel ? [sel] : [])])
        if (!pathNodes.size && sel) c.getElementById(sel).neighborhood('node').forEach((n) => { keepN.add(n.id()) })
        c.nodes().forEach((n) => { if (!n.hasClass('colhead') && !keepN.has(n.id())) n.addClass('dim') })
        c.edges().forEach((e) => {
          const on = pathEdges.size ? pathEdges.has(e.id()) : keepN.has(e.data('source')) && keepN.has(e.data('target'))
          if (!on) e.addClass('dim')
        })
      }
    })
  }, [p.selection, p.path, p.isolate, p.labels, p.model])

  // ChronoReplay: ghost the future, pulse what was just revealed — classes only, positions never change
  useEffect(() => {
    const c = cy.current
    if (!c) return
    const at = p.visibleUntil
    const prev = prevAt.current
    prevAt.current = at
    const fresh: cytoscape.CollectionReturnValue = c.collection()
    c.batch(() => {
      c.elements().removeClass('future')
      if (at === null) return
      c.edges('.e-transfer, .e-zero').forEach((e) => {
        const f = e.data('first') as number
        if (f > at) e.addClass('future')
        else if (prev !== null && f > prev && at > prev) fresh.merge(e).merge(e.target())
      })
      c.nodes().forEach((n) => {
        if (n.hasClass('k-seed') || n.hasClass('colhead') || n.hasClass('k-more')) return
        const live = n.connectedEdges('.e-transfer, .e-zero').not('.future')
        if (live.empty()) n.addClass('future')
      })
    })
    if (fresh.nonempty() && !p.reduced) {
      fresh.addClass('fresh')
      const t = setTimeout(() => fresh.removeClass('fresh'), 650)
      return () => clearTimeout(t)
    }
  }, [p.visibleUntil, p.model, p.reduced])

  useImperativeHandle(ref, () => ({
    fit: () => cy.current && fitView(cy.current, true),
    zoom: (f) => {
      const c = cy.current
      if (!c) return
      c.zoom({ level: c.zoom() * f, renderedPosition: { x: c.width() / 2, y: c.height() / 2 } })
    },
    reset: () => {
      const c = cy.current
      if (!c) return
      for (const d of defs(latest.current.model)) if (d.position) c.getElementById(d.data.id as string).position(d.position)
      fitView(c, true)
    },
    focus: (id) => {
      const c = cy.current
      const n = c?.getElementById(id)
      if (!c || !n || n.empty()) return
      const eles = n.closedNeighborhood()
      if (latest.current.reduced) c.fit(eles, 80)
      else c.animate({ fit: { eles, padding: 80 } }, { duration: 420, easing: 'ease-in-out-cubic' })
      if (c.zoom() > 1.6) c.zoom(1.6)
    },
  }))

  const hoverNode = hover?.nodeId ? p.model.byId.get(hover.nodeId) : undefined
  const hoverEdge = hover?.edgeId ? p.model.edges.find((e) => e.id === hover.edgeId) : undefined
  return (
    <div className="relative h-full min-h-[460px] w-full">
      <div ref={box} className="h-full w-full" data-testid="flow-2d" role="img"
        aria-label={`Fund flow from the starting wallet: ${p.model.shownWallets} of ${p.model.totalWallets} wallets drawn in hop columns. Use the wallet list for keyboard access.`} />
      {hover && (hoverNode || hoverEdge) && (
        <HoverCard x={hover.x} y={hover.y} node={hoverNode} edge={hoverEdge} model={p.model}
          when={hoverEdge?.first ? fmtTime(hoverEdge.first) : undefined} />
      )}
    </div>
  )
})
