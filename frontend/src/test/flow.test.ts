import { describe, expect, it } from 'vitest'
import { buildFlowModel, tracePath } from '../features/workspace/flow/model'
import type { GraphEdge, GraphNode, GraphResponse } from '../lib/types'

const node = (id: string, fwd: number | null, back: number | null, extra: Partial<GraphNode> = {}): GraphNode => ({
  id, address: id, is_seed: fwd === 0 && back === 0, is_contract: false, name: null, labels: [], expansion_status: fwd === 0 && back === 0 ? 'seed' : 'not_expanded',
  hop: { forward: fwd, backward: back, undirected: fwd ?? back }, in_count: 1, out_count: 1, fan_in: 1, fan_out: 1, community: null, component: 0,
  pagerank: null, score: null, band: 'low', category: null, evidence_count: 0, ...extra,
})
const edge = (s: string, t: string, amount = '1', first = 100): GraphEdge => ({
  id: `${s}->${t}`, source: s, target: t, count: 1, transfer_ids: [`${s}${t}`], tx_hashes: ['0x1'], kinds: ['native'], value_bearing: true, self_transfer: false,
  totals: [{ asset_key: 'native', symbol: 'ETH', recognised: true, raw: amount, amount, count: 1 }], first_ts: first, last_ts: first,
})

// S = start; A,B first hop; C,D,E second hop; X sent funds in; L0..L19 small first-hop leaves; Z unconnected to S directionally
const leaves = Array.from({ length: 20 }, (_, i) => `L${i}`)
const graph: GraphResponse = {
  nodes: [
    node('S', 0, 0), node('A', 1, null, { expansion_status: 'expanded' }), node('B', 1, null),
    node('C', 2, null), node('D', 2, null, { labels: [{ label: 'Bad actor', category: 'sanctioned', source: 'test' }] }), node('E', 2, null),
    node('X', null, 1), ...leaves.map((l) => node(l, 1, null)),
  ],
  edges: [
    edge('S', 'A', '500', 10), edge('S', 'B', '300', 20), edge('A', 'C', '100', 30), edge('A', 'D', '400', 40), edge('B', 'E', '50', 50), edge('X', 'S', '9', 5),
    ...leaves.map((l, i) => edge('S', l, '0.01', 60 + i)),
  ],
  stats: { nodes: 0, edges: 0, transfers: 0, value_bearing_transfers: 0, components: 1, density: 0, first_ts: null, last_ts: null, missing_timestamps: 0, assets: [] },
  seeds: ['S'], components: [], caveat: '',
}

describe('fund-flow model', () => {
  it('lays out hop columns left to right with the starting wallet at the origin', () => {
    const m = buildFlowModel(graph, { full: true, revealed: new Set() })
    const at = (id: string) => m.byId.get(id)!
    expect(at('S')).toMatchObject({ kind: 'seed', col: 0, x: 0, y: 0 })
    expect(at('S').p3).toEqual([0, 0, 0])
    expect(at('X').x).toBeLessThan(0) // funds coming in sit left of the start
    expect(at('A').x).toBeGreaterThan(0)
    expect(at('C').x).toBeGreaterThan(at('A').x)
    expect(at('D')).toMatchObject({ kind: 'flagged', flagged: true })
    expect(m.columns.map((c) => c.label)).toEqual(['Funds coming in', 'Starting wallet', 'First transfers', 'Downstream · hop 2'])
    // no two wallets share a position in the same column
    for (const c of [-1, 0, 1, 2]) {
      const ys = m.nodes.filter((n) => n.col === c).map((n) => n.y)
      expect(new Set(ys).size).toBe(ys.length)
    }
  })

  it('simplified view keeps the story and says what it left out', () => {
    const m = buildFlowModel(graph, { full: false, revealed: new Set() })
    for (const id of ['S', 'A', 'B', 'D']) expect(m.byId.has(id)).toBe(true)
    // the flagged wallet's route back to the start is drawn
    expect(m.edges.some((e) => e.source === 'A' && e.target === 'D')).toBe(true)
    const more = m.byId.get('more:1')!
    expect(more.kind).toBe('more')
    expect(more.hiddenCount).toBe(m.columns.find((c) => c.col === 1)!.total - m.columns.find((c) => c.col === 1)!.shown)
    expect(m.hiddenWallets).toBe(m.totalWallets - m.shownWallets)
    expect(m.hiddenWallets).toBeGreaterThan(0)
    const full = buildFlowModel(graph, { full: true, revealed: new Set() })
    expect(full.hiddenWallets).toBe(0)
    expect(full.nodes.some((n) => n.kind === 'more')).toBe(false)
  })

  it('is deterministic: rebuilding (e.g. on a replay tick) never moves a wallet', () => {
    const a = buildFlowModel(graph, { full: false, revealed: new Set() })
    const b = buildFlowModel(graph, { full: false, revealed: new Set() })
    for (const n of a.nodes) expect(b.byId.get(n.id)).toMatchObject({ x: n.x, y: n.y, p3: n.p3 })
    // revealing a hidden wallet keeps the start fixed
    const hidden = leaves.find((l) => !a.byId.has(l))!
    const c = buildFlowModel(graph, { full: false, revealed: new Set([hidden]) })
    expect(c.byId.has(hidden)).toBe(true)
    expect(c.byId.get('S')).toMatchObject({ x: 0, y: 0 })
  })

  it('traces the route of transfers from the start, in either direction', () => {
    expect(tracePath(graph, 'S', 'D')).toEqual({ nodes: ['S', 'A', 'D'], edges: ['S->A', 'A->D'], direction: 'downstream' })
    expect(tracePath(graph, 'S', 'X')).toEqual({ nodes: ['X', 'S'], edges: ['X->S'], direction: 'upstream' })
    expect(tracePath(graph, 'S', 'nope')).toBeNull()
  })
})
