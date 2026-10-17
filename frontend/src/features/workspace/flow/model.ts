import type { FusionRelationship, GraphEdge, GraphNode, GraphResponse } from '../../../lib/types'
import { fmtAmount, short } from '../../../lib/format'

/*
 * One deterministic fund-flow model shared by the 2D tree and the 3D network.
 * Columns are hop distances from the starting wallet (negative = wallets that sent funds in), so both
 * views show the same wallets, the same edges and the same structure. Positions depend only on the
 * graph and on what the analyst chose to reveal — never on the replay cursor — so playback cannot
 * move anything.
 */

export type NodeKind = 'seed' | 'mixer' | 'bridge' | 'exchange' | 'flagged' | 'contract' | 'wallet' | 'more'
export type EdgeKind = 'transfer' | 'zero' | 'inferred' | 'more'

export interface FlowNode {
  id: string
  kind: NodeKind
  flagged: boolean
  col: number
  x: number
  y: number
  p3: [number, number, number]
  title: string
  short: string
  importance: number
  node: GraphNode | null
  /** for `more` placeholders: how many wallets in this column are not drawn */
  hiddenCount: number
}

export interface FlowEdge {
  id: string
  source: string
  target: string
  kind: EdgeKind
  back: boolean
  edge: GraphEdge | null
  amount: string
  first: number | null
  /** for inferred links: plain-language description and the backend relationship */
  note?: string
  rel?: FusionRelationship
}

export interface FlowColumn {
  col: number
  x: number
  x3: number
  label: string
  shown: number
  total: number
}

export interface FlowModel {
  nodes: FlowNode[]
  edges: FlowEdge[]
  byId: Map<string, FlowNode>
  columns: FlowColumn[]
  seed: string | null
  shownWallets: number
  totalWallets: number
  hiddenWallets: number
  full: boolean
}

export interface InferredLink {
  source: string
  target: string
  note: string
  rel: FusionRelationship
}

const SERVICE = ['mixer', 'bridge', 'exchange', 'dex'] as const
const RISK = ['sanctioned', 'exploit', 'exploiter', 'blocked', 'phishing', 'hack', 'heist', 'stolen']
const NOTABLE_STATUS = ['seed', 'expanded', 'terminal_service', 'provider_error', 'depth_limit']

export function classify(n: GraphNode): { kind: NodeKind; flagged: boolean; title: string | null } {
  const service = n.labels.find((l) => (SERVICE as readonly string[]).includes(l.category ?? ''))
  const flagged = n.labels.some((l) => RISK.includes(l.category ?? ''))
  const named = n.labels.find((l) => l.category === 'name')?.label ?? service?.label ?? n.name ?? null
  let kind: NodeKind = 'wallet'
  if (n.is_seed) kind = 'seed'
  else if (service?.category === 'mixer') kind = 'mixer'
  else if (service?.category === 'bridge') kind = 'bridge'
  else if (service) kind = 'exchange'
  else if (flagged) kind = 'flagged'
  else if (n.is_contract) kind = 'contract'
  return { kind, flagged, title: named }
}

export function columnOf(n: GraphNode): number {
  if (n.is_seed) return 0
  const f = n.hop.forward
  const b = n.hop.backward
  if (f !== null && f > 0) return f
  if (b !== null && b > 0) return -b
  return Math.max(1, n.hop.undirected ?? 1)
}

export function columnLabel(col: number, maxCol: number): string {
  if (col === 0) return 'Starting wallet'
  if (col === 1) return 'First transfers'
  if (col > 1) return col === maxCol ? `Downstream · hop ${col}` : `Intermediate · hop ${col}`
  if (col === -1) return 'Funds coming in'
  return `Earlier sources · ${-col} hops back`
}

const ETHISH = new Set(['ETH', 'WETH'])
function ethValue(e: GraphEdge): number {
  let v = 0
  for (const t of e.totals) if (ETHISH.has(t.symbol) && t.amount) v += Number.parseFloat(t.amount) || 0
  return v
}

export function edgeAmount(e: GraphEdge): string {
  const t = e.totals[0]
  if (!t) return ''
  return `${fmtAmount(t.amount, 2)} ${t.symbol}${e.totals.length > 1 ? ` +${e.totals.length - 1}` : ''}`
}

interface BuildOpts {
  full: boolean
  revealed: ReadonlySet<string>
  inferred?: InferredLink[]
  showInferred?: boolean
}

const GOLDEN = Math.PI * (3 - Math.sqrt(5))

export function buildFlowModel(graph: GraphResponse, opts: BuildOpts): FlowModel {
  const nodes = graph.nodes
  const byNode = new Map(nodes.map((n) => [n.id, n]))
  const seed = nodes.find((n) => n.is_seed)?.id ?? graph.seeds[0] ?? null

  // adjacency and per-node value/count (used only to decide what to draw first, never shown as a claim)
  const out = new Map<string, GraphEdge[]>()
  const inc = new Map<string, GraphEdge[]>()
  const val = new Map<string, number>()
  for (const e of graph.edges) {
    if (!out.has(e.source)) out.set(e.source, [])
    if (!inc.has(e.target)) inc.set(e.target, [])
    out.get(e.source)!.push(e)
    inc.get(e.target)!.push(e)
    const v = ethValue(e)
    val.set(e.source, (val.get(e.source) ?? 0) + v)
    val.set(e.target, (val.get(e.target) ?? 0) + v)
  }

  const meta = new Map<string, { kind: NodeKind; flagged: boolean; title: string | null; col: number; imp: number }>()
  for (const n of nodes) {
    const c = classify(n)
    const special = c.kind !== 'wallet' && c.kind !== 'contract' ? 1000 : 0
    const imp = special + (c.flagged ? 600 : 0) + (NOTABLE_STATUS.includes(n.expansion_status) ? 400 : 0) + (n.band && n.band !== 'low' ? 200 : 0)
      + (n.score ?? 0) * 4 + Math.log10(1 + (val.get(n.id) ?? 0)) * 25 + Math.log2(1 + n.in_count + n.out_count) * 4
    meta.set(n.id, { ...c, col: columnOf(n), imp })
  }

  // ---- what to draw -------------------------------------------------------------------------------
  const keep = new Set<string>()
  if (opts.full) nodes.forEach((n) => keep.add(n.id))
  else {
    if (seed) keep.add(seed)
    const byCol = new Map<number, GraphNode[]>()
    for (const n of nodes) {
      const m = meta.get(n.id)!
      if (m.kind !== 'wallet' && m.kind !== 'contract') keep.add(n.id)
      if (m.flagged || (n.band && n.band !== 'low') || NOTABLE_STATUS.includes(n.expansion_status)) keep.add(n.id)
      if (opts.revealed.has(n.id)) keep.add(n.id)
      if (!byCol.has(m.col)) byCol.set(m.col, [])
      byCol.get(m.col)!.push(n)
    }
    for (const [col, list] of byCol) {
      const k = Math.abs(col) === 1 ? (col > 0 ? 10 : 6) : 5
      list.sort((a, b) => meta.get(b.id)!.imp - meta.get(a.id)!.imp).slice(0, k).forEach((n) => keep.add(n.id))
    }
    // every drawn wallet stays connected to the start: add the wallets on its route back to the seed
    for (const id of [...keep]) for (const p of routeToSeed(id, meta, out, inc)) keep.add(p)
  }

  // ---- 2D rows: centre-out by importance next to the start, barycentre further away -----------------
  const cols = new Map<number, string[]>()
  for (const id of keep) {
    const c = meta.get(id)!.col
    if (!cols.has(c)) cols.set(c, [])
    cols.get(c)!.push(id)
  }
  const full = opts.full
  const gap = full ? 30 : 50
  const colGap = full ? 210 : 235
  const y = new Map<string, number>()
  const order = [...cols.keys()].sort((a, b) => Math.abs(a) - Math.abs(b) || b - a)
  const maxCol = Math.max(0, ...cols.keys())
  for (const c of order) {
    const ids = cols.get(c)!
    if (c === 0) {
      ids.forEach((id) => y.set(id, 0))
      continue
    }
    const inner = c > 0 ? c - 1 : c + 1
    const want = (id: string) => {
      const nb = [...(inc.get(id) ?? []).map((e) => e.source), ...(out.get(id) ?? []).map((e) => e.target)]
        .filter((o) => meta.get(o)?.col === inner && y.has(o))
      return nb.length ? nb.reduce((s, o) => s + y.get(o)!, 0) / nb.length : 0
    }
    if (Math.abs(c) === 1) {
      const sorted = [...ids].sort((a, b) => meta.get(b)!.imp - meta.get(a)!.imp || a.localeCompare(b))
      sorted.forEach((id, i) => y.set(id, (i % 2 === 0 ? 1 : -1) * Math.ceil(i / 2) * gap))
    } else {
      const desired = ids.map((id) => ({ id, d: want(id), imp: meta.get(id)!.imp }))
        .sort((a, b) => a.d - b.d || b.imp - a.imp || a.id.localeCompare(b.id))
      const ys: number[] = []
      desired.forEach((o, i) => ys.push(i === 0 ? o.d : Math.max(o.d, ys[i - 1] + gap)))
      const shift = desired.reduce((s, o) => s + o.d, 0) / desired.length - ys.reduce((s, v) => s + v, 0) / ys.length
      desired.forEach((o, i) => y.set(o.id, ys[i] + shift))
    }
  }

  // ---- 3D: each column is a disc in the y/z plane; branches keep their angle as they move downstream ---
  const angle = new Map<string, { t: number; r: number }>()
  const p3 = new Map<string, [number, number, number]>()
  const X3 = 56
  for (const c of order) {
    const ids = cols.get(c)!
    if (c === 0) {
      ids.forEach((id) => { angle.set(id, { t: 0, r: 0 }); p3.set(id, [0, 0, 0]) })
      continue
    }
    if (Math.abs(c) === 1) {
      const sorted = [...ids].sort((a, b) => meta.get(b)!.imp - meta.get(a)!.imp || a.localeCompare(b))
      const R = 16 + 7.5 * Math.sqrt(sorted.length)
      sorted.forEach((id, i) => {
        const r = R * Math.sqrt((i + 0.6) / sorted.length)
        const t = i * GOLDEN
        angle.set(id, { t, r })
      })
    } else {
      const inner = c > 0 ? c - 1 : c + 1
      const groups = new Map<string, string[]>()
      for (const id of ids) {
        const nb = [...(inc.get(id) ?? []).map((e) => e.source), ...(out.get(id) ?? []).map((e) => e.target)]
          .filter((o) => meta.get(o)?.col === inner && angle.has(o))
          .sort((a, b) => meta.get(b)!.imp - meta.get(a)!.imp)
        const parent = nb[0] ?? '_'
        if (!groups.has(parent)) groups.set(parent, [])
        groups.get(parent)!.push(id)
      }
      for (const [parent, kids] of groups) {
        const base = angle.get(parent) ?? { t: 0, r: 0 }
        kids.sort((a, b) => meta.get(b)!.imp - meta.get(a)!.imp || a.localeCompare(b))
        kids.forEach((id, j) => {
          const spread = (j - (kids.length - 1) / 2) * Math.min(0.5, 2.4 / kids.length)
          angle.set(id, { t: base.t + spread, r: base.r + 14 + (j % 3) * 4 })
        })
      }
    }
    for (const id of ids) {
      const a = angle.get(id)!
      p3.set(id, [c * X3, Math.sin(a.t) * a.r, Math.cos(a.t) * a.r])
    }
  }

  // ---- assemble ------------------------------------------------------------------------------------
  const flowNodes: FlowNode[] = []
  for (const id of keep) {
    const n = byNode.get(id)!
    const m = meta.get(id)!
    flowNodes.push({
      id, kind: m.kind, flagged: m.flagged, col: m.col, x: m.col * colGap, y: y.get(id) ?? 0, p3: p3.get(id) ?? [m.col * X3, 0, 0],
      title: m.title ?? short(id, 4), short: short(id, 4), importance: m.imp, node: n, hiddenCount: 0,
    })
  }
  const columns: FlowColumn[] = []
  const allByCol = new Map<number, number>()
  for (const n of nodes) allByCol.set(meta.get(n.id)!.col, (allByCol.get(meta.get(n.id)!.col) ?? 0) + 1)
  for (const [c, total] of [...allByCol].sort((a, b) => a[0] - b[0])) {
    const shown = cols.get(c)?.length ?? 0
    columns.push({ col: c, x: c * colGap, x3: c * X3, label: columnLabel(c, maxCol), shown, total })
  }

  const flowEdges: FlowEdge[] = []
  for (const e of graph.edges) {
    if (!keep.has(e.source) || !keep.has(e.target)) continue
    const back = meta.get(e.target)!.col <= meta.get(e.source)!.col
    flowEdges.push({ id: e.id, source: e.source, target: e.target, kind: e.value_bearing ? 'transfer' : 'zero', back, edge: e, amount: edgeAmount(e), first: e.first_ts })
  }

  // placeholders for wallets that are not drawn, so an incomplete view is never mistaken for the whole
  for (const col of columns) {
    const hidden = col.total - col.shown
    if (hidden <= 0 || !seed) continue
    const ys = (cols.get(col.col) ?? []).map((id) => y.get(id) ?? 0)
    const bottom = ys.length ? Math.max(...ys) + gap * 1.3 : 0
    const disc = Math.max(10, ...(cols.get(col.col) ?? []).map((id) => angle.get(id)?.r ?? 0))
    const id = `more:${col.col}`
    flowNodes.push({
      id, kind: 'more', flagged: false, col: col.col, x: col.x, y: bottom, p3: [col.x3, -disc - 8, 0],
      title: `+${hidden} more ${col.col < 0 ? 'senders' : 'wallets'}`, short: '', importance: -1, node: null, hiddenCount: hidden,
    })
    if (Math.abs(col.col) === 1)
      flowEdges.push({ id: `${id}:edge`, source: col.col > 0 ? seed : id, target: col.col > 0 ? id : seed, kind: 'more', back: false, edge: null, amount: '', first: null })
  }

  if (opts.showInferred && opts.inferred) {
    for (const l of opts.inferred) {
      if (!keep.has(l.source) || !keep.has(l.target)) continue
      flowEdges.push({ id: `inf:${l.source}->${l.target}`, source: l.source, target: l.target, kind: 'inferred', back: true, edge: null, amount: '', first: null, note: l.note, rel: l.rel })
    }
  }

  return {
    nodes: flowNodes, edges: flowEdges, byId: new Map(flowNodes.map((n) => [n.id, n])), columns, seed,
    shownWallets: keep.size, totalWallets: nodes.length, hiddenWallets: nodes.length - keep.size, full,
  }
}

/** Wallets on one route between `id` and the seed, walking hop distance down one column at a time. */
function routeToSeed(
  id: string,
  meta: Map<string, { col: number; imp: number }>,
  out: Map<string, GraphEdge[]>,
  inc: Map<string, GraphEdge[]>,
): string[] {
  const route: string[] = []
  let cur = id
  for (let guard = 0; guard < 12; guard++) {
    const c = meta.get(cur)?.col ?? 0
    if (c === 0) break
    const next = c > 0
      ? (inc.get(cur) ?? []).map((e) => e.source).filter((s) => meta.get(s)?.col === c - 1)
      : (out.get(cur) ?? []).map((e) => e.target).filter((t) => meta.get(t)?.col === c + 1)
    if (!next.length) break
    cur = next.sort((a, b) => (meta.get(b)?.imp ?? 0) - (meta.get(a)?.imp ?? 0))[0]
    route.push(cur)
  }
  return route
}

export interface TracedPath {
  nodes: string[]
  edges: string[]
  /** 'downstream' = seed → … → target; 'upstream' = target → … → seed; 'linked' = connected ignoring direction */
  direction: 'downstream' | 'upstream' | 'linked'
}

/** Shortest route between the starting wallet and `target` over observed transfers. */
export function tracePath(graph: GraphResponse, seed: string | null, target: string): TracedPath | null {
  if (!seed || !graph.nodes.some((n) => n.id === target)) return null
  if (seed === target) return { nodes: [seed], edges: [], direction: 'downstream' }
  const fwd = new Map<string, GraphEdge[]>()
  const rev = new Map<string, GraphEdge[]>()
  for (const e of graph.edges) {
    if (!fwd.has(e.source)) fwd.set(e.source, [])
    if (!rev.has(e.target)) rev.set(e.target, [])
    fwd.get(e.source)!.push(e)
    rev.get(e.target)!.push(e)
  }
  const bfs = (step: (id: string) => [string, GraphEdge][]) => {
    const prev = new Map<string, [string, GraphEdge]>()
    const seen = new Set([seed])
    const q = [seed]
    while (q.length) {
      const cur = q.shift()!
      if (cur === target) break
      for (const [nx, e] of step(cur)) {
        if (seen.has(nx)) continue
        seen.add(nx)
        prev.set(nx, [cur, e])
        q.push(nx)
      }
    }
    if (!prev.has(target)) return null
    const ns = [target]
    const es: string[] = []
    let cur = target
    while (cur !== seed) {
      const [p, e] = prev.get(cur)!
      es.push(e.id)
      ns.push(p)
      cur = p
    }
    return { nodes: ns.reverse(), edges: es.reverse() }
  }
  const down = bfs((id) => (fwd.get(id) ?? []).map((e) => [e.target, e]))
  if (down) return { ...down, direction: 'downstream' }
  const up = bfs((id) => (rev.get(id) ?? []).map((e) => [e.source, e]))
  if (up) return { nodes: [...up.nodes].reverse(), edges: [...up.edges].reverse(), direction: 'upstream' }
  const any = bfs((id) => [...(fwd.get(id) ?? []).map((e) => [e.target, e] as [string, GraphEdge]), ...(rev.get(id) ?? []).map((e) => [e.source, e] as [string, GraphEdge])])
  return any ? { ...any, direction: 'linked' } : null
}

/** Neighbours of `id` in the full graph (used by "Expand one hop"). */
export function neighbours(graph: GraphResponse, id: string): string[] {
  const s = new Set<string>()
  for (const e of graph.edges) {
    if (e.source === id) s.add(e.target)
    if (e.target === id) s.add(e.source)
  }
  return [...s]
}

export const KIND_LABEL: Record<NodeKind, string> = {
  seed: 'Starting wallet',
  mixer: 'Mixer (source-reported)',
  bridge: 'Bridge (source-reported)',
  exchange: 'Exchange / DEX (source-reported)',
  flagged: 'Flagged by a public source',
  contract: 'Contract',
  wallet: 'Wallet',
  more: 'Wallets not drawn',
}
