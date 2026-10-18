import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { qs } from '../../../lib/api'
import { fmtTime, short } from '../../../lib/format'
import { useApi, usePrefersReducedMotion } from '../../../lib/hooks'
import type { FusionResponse, GraphResponse } from '../../../lib/types'
import { Spinner } from '../../../components/ui'
import { filterParams, type Filter, type Selection } from '../state'
import { FlowGraph2D, type ViewHandle } from './FlowGraph2D'
import { FlowLegend } from './FlowLegend'
import { buildFlowModel, columnOf, neighbours, tracePath, type InferredLink } from './model'

const Network3D = lazy(() => import('./Network3D').then((m) => ({ default: m.Network3D })))

export type ViewMode = '2d' | '3d'

interface Props {
  invId: string
  graph: GraphResponse
  filter: Filter
  selection: Selection
  onSelect: (s: Selection) => void
  onHide: (address: string) => void
  visibleUntil: number | null
  mode: ViewMode
  onMode: (m: ViewMode) => void
}

function useNarrow() {
  const q = '(max-width: 767px)'
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(q).matches)
  useEffect(() => {
    if (!window.matchMedia) return
    const m = window.matchMedia(q)
    const on = () => setNarrow(m.matches)
    m.addEventListener?.('change', on)
    return () => m.removeEventListener?.('change', on)
  }, [])
  return narrow
}

/** Fund-flow workbench: one model, two views (2D tree / 3D network), shared tools and selection. */
export default function FlowWorkbench({ invId, graph, filter, selection, onSelect, onHide, visibleUntil, mode, onMode }: Props) {
  const reduced = usePrefersReducedMotion()
  const narrow = useNarrow()
  const [full, setFull] = useState(false)
  const [revealed, setRevealed] = useState<Set<string>>(() => new Set())
  const [traceTo, setTraceTo] = useState<string | null>(null)
  const [isolate, setIsolate] = useState(false)
  const [labels, setLabels] = useState(true)
  const [particles, setParticles] = useState(true)
  const [inferredOn, setInferredOn] = useState(false)
  const [search, setSearch] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [unavailable3d, setUnavailable3d] = useState<string | null>(null)
  const view = useRef<ViewHandle>(null)
  const pendingFocus = useRef<string | null>(null)

  const fusion = useApi<FusionResponse>(inferredOn ? `/api/investigations/${invId}/fusion${qs(filterParams(filter))}` : null)
  const inferred = useMemo<InferredLink[]>(() => (fusion.data?.relationships ?? [])
    .filter((r) => r.assertion_status === 'algorithmic_inference' && r.source.startsWith('wallet:') && r.target.startsWith('wallet:'))
    .map((r) => ({
      source: r.source.split(':').pop()!, target: r.target.split(':').pop()!, rel: r,
      note: r.type === 'coordinated_split' ? 'Possible coordinated split: similar-sized transfers in a short window' : r.type.replace(/_/g, ' '),
    })), [fusion.data])

  const sel = selection?.kind === 'node' ? selection.address : null
  const seed = useMemo(() => graph.nodes.find((n) => n.is_seed)?.id ?? graph.seeds[0] ?? null, [graph])
  const path = useMemo(() => (traceTo ? tracePath(graph, seed, traceTo) : null), [graph, seed, traceTo])
  // a wallet selected anywhere (ranking, evidence, wallet list…) and the traced route are always drawn
  const drawn = useMemo(() => {
    const extra = [...(sel && graph.nodes.some((n) => n.id === sel) ? [sel] : []), ...(path?.nodes ?? [])]
    return extra.every((i) => revealed.has(i)) ? revealed : new Set([...revealed, ...extra])
  }, [revealed, sel, path, graph])
  const model = useMemo(() => buildFlowModel(graph, { full, revealed: drawn, inferred, showInferred: inferredOn }), [graph, full, drawn, inferred, inferredOn])
  const effectiveMode: ViewMode = narrow || unavailable3d ? '2d' : mode

  const reveal = useCallback((ids: string[]) => {
    setRevealed((r) => {
      if (ids.every((i) => r.has(i))) return r
      const n = new Set(r)
      ids.forEach((i) => n.add(i))
      return n
    })
  }, [])

  // focus once a searched wallet has been drawn
  useEffect(() => {
    const id = pendingFocus.current
    if (id && model.byId.has(id)) {
      pendingFocus.current = null
      requestAnimationFrame(() => view.current?.focus(id))
    }
  }, [model])

  const find = (e: React.FormEvent) => {
    e.preventDefault()
    const q = search.trim().toLowerCase()
    if (!q) return
    const hits = graph.nodes.filter((n) => n.id.includes(q) || n.labels.some((l) => l.label.toLowerCase().includes(q)) || (n.name ?? '').toLowerCase().includes(q))
    if (!hits.length) {
      setMsg('No wallet in this investigation matches that address or label.')
      return
    }
    const hit = hits.find((n) => n.id === q) ?? hits[0]
    setMsg(hits.length > 1 ? `${hits.length} matches — showing ${short(hit.id, 4)}` : null)
    pendingFocus.current = hit.id
    reveal([hit.id])
    onSelect({ kind: 'node', address: hit.id })
    if (model.byId.has(hit.id)) {
      pendingFocus.current = null
      view.current?.focus(hit.id)
    }
  }
  const expandColumn = (col: number) => reveal(graph.nodes.filter((n) => columnOf(n) === col).map((n) => n.id))
  const expandOne = () => sel && reveal(neighbours(graph, sel))
  const expandDownstream = (id: string) => reveal(graph.edges.filter((e) => e.source === id).map((e) => e.target))
  const toggleFull = () => {
    setFull((f) => !f)
    requestAnimationFrame(() => requestAnimationFrame(() => view.current?.fit()))
  }
  const trace = () => {
    if (!sel) return
    setTraceTo(sel)
    setIsolate(true)
  }
  const resetLayout = () => {
    setRevealed(new Set())
    setTraceTo(null)
    setIsolate(false)
    requestAnimationFrame(() => requestAnimationFrame(() => view.current?.reset()))
  }

  const tracedLabel = path ? model.byId.get(path.nodes.at(-1)!)?.title ?? short(path.nodes.at(-1)!, 4) : null
  const viewProps = {
    model, selection, onSelect, onExpandColumn: expandColumn, path, isolate, labels, visibleUntil, reduced,
  }

  return (
    <div className="flex h-full flex-col">
      {/* toolbar: view switch · find · camera · selection tools · display */}
      <div className="tf-toolbar" role="toolbar" aria-label="Fund-flow tools">
        <div className="tf-seg" role="group" aria-label="View">
          <button type="button" aria-pressed={effectiveMode === '2d'} onClick={() => onMode('2d')}>2D Fund flow</button>
          <button type="button" aria-pressed={effectiveMode === '3d'} onClick={() => onMode('3d')} disabled={narrow || !!unavailable3d}
            title={narrow ? '3D needs a wider screen — the 2D fund flow shows the same data' : unavailable3d ?? 'Same investigation, as an interactive 3D network'}>3D Network</button>
        </div>
        <form onSubmit={find} className="tf-toolgroup" role="search">
          <label htmlFor="gsearch" className="sr-only">Search graph</label>
          <input id="gsearch" className="tf-input w-44 py-1 text-xs" placeholder="Find address or label" value={search} onChange={(e) => setSearch(e.target.value)} />
          <button className="tf-btn">Find</button>
        </form>
        <div className="tf-toolgroup" role="group" aria-label="Camera">
          <button type="button" className="tf-btn" onClick={() => view.current?.fit()} title="Fit everything in view">Fit</button>
          <button type="button" className="tf-btn" aria-label="Zoom in" onClick={() => view.current?.zoom(1.3)}>＋</button>
          <button type="button" className="tf-btn" aria-label="Zoom out" onClick={() => view.current?.zoom(1 / 1.3)}>－</button>
          <button type="button" className="tf-btn" onClick={resetLayout} title="Back to the simplified view, original positions and camera">
            {effectiveMode === '3d' ? 'Reset camera' : 'Reset layout'}
          </button>
        </div>
        <div className="tf-toolgroup" role="group" aria-label="Selected wallet">
          <button type="button" className="tf-btn" disabled={!sel} onClick={trace} title="Highlight the route of transfers between the starting wallet and the selected wallet">Trace path</button>
          <button type="button" className="tf-btn" disabled={!sel && !path} aria-pressed={isolate} onClick={() => setIsolate((v) => !v)} title="Dim everything not on the route / around the selection">Isolate</button>
          <button type="button" className="tf-btn" disabled={!sel} onClick={expandOne} title="Draw every wallet that sent to or received from the selected wallet">Expand one hop</button>
          <button type="button" className="tf-btn" disabled={!sel} onClick={() => sel && view.current?.focus(sel)}>Focus</button>
          <button type="button" className="tf-btn" disabled={!sel} onClick={() => sel && onHide(sel)}>Hide</button>
        </div>
        <div className="tf-toolgroup">
        <button type="button" className="tf-btn" aria-pressed={full} onClick={toggleFull}>{full ? 'Simplified view' : 'Show full graph'}</button>
        <details className="relative">
          <summary className="tf-btn cursor-pointer list-none">Display ▾</summary>
          <div className="tf-menu right-0 w-64 space-y-1.5">
            <label className="flex items-center gap-2"><input type="checkbox" checked={labels} onChange={(e) => setLabels(e.target.checked)} /> Wallet labels</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={particles} disabled={reduced} onChange={(e) => setParticles(e.target.checked)} /> Moving transfer particles (3D){reduced ? ' — off: reduced motion' : ''}</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={inferredOn} onChange={(e) => setInferredOn(e.target.checked)} /> Unverified patterns (dotted)</label>
          </div>
        </details>
        </div>
        <span className="tf-num ml-auto text-[11px] text-faint" data-testid="flow-count">{model.shownWallets} of {model.totalWallets} wallets drawn</span>
      </div>

      {/* status of what is (and is not) on screen — fixed height so nothing below jumps */}
      <div className="tf-statusline" aria-live="polite">
        {!full && model.hiddenWallets > 0 ? (
          <span>
            <strong className="text-ink">Simplified view</strong>: the starting wallet, flagged and service wallets, the largest flows and the routes between them.
            {' '}{model.hiddenWallets} smaller wallets are grouped into “+ more”.
          </span>
        ) : <span><strong className="text-ink">Full graph</strong>: every wallet in this investigation is drawn.</span>}
        {path && (
          <span className="text-signal2">
            Route to {tracedLabel}: {path.edges.length} transfer{path.edges.length === 1 ? '' : 's'}{path.direction === 'upstream' ? ' into the starting wallet' : path.direction === 'linked' ? ' (connected, not one direction)' : ' from the starting wallet'}
            <button type="button" className="ml-2 underline" onClick={() => { setTraceTo(null); setIsolate(false) }}>Clear route</button>
          </span>
        )}
        {traceTo && !path && <span className="text-hypo">No route of observed transfers connects this wallet to the starting wallet.</span>}
        {visibleUntil !== null && <span>Replay: transfers after {fmtTime(visibleUntil)} are faded.</span>}
        {msg && <span role="status" className="text-hypo">{msg}</span>}
        {unavailable3d && <span className="text-hypo">{unavailable3d}</span>}
      </div>

      <div className="relative h-[max(480px,calc(100vh-15rem))] shrink-0" key={effectiveMode}>
        <div className="tf-fade-in absolute inset-0">
          {effectiveMode === '2d' ? (
            <FlowGraph2D ref={view} {...viewProps} />
          ) : (
            <Suspense fallback={<div className="p-4"><Spinner label="Loading 3D view" /></div>}>
              <Network3D ref={view} {...viewProps} particles={particles && !reduced} onExpandDownstream={expandDownstream}
                onUnavailable={(m) => { setUnavailable3d(m); onMode('2d') }} />
            </Suspense>
          )}
        </div>
      </div>

      <FlowLegend inferred={inferredOn} />

      <details className="border-t border-line px-3 py-2 text-xs">
        <summary className="cursor-pointer font-semibold text-dim hover:text-ink">Wallet list ({graph.nodes.length}) — keyboard-accessible</summary>
        <ul className="mt-2 max-h-56 space-y-0.5 overflow-auto" aria-label="Wallets in graph">
          {[...graph.nodes]
            .sort((a, b) => Number(b.is_seed) - Number(a.is_seed) || (b.score ?? -1) - (a.score ?? -1) || a.id.localeCompare(b.id))
            .slice(0, 400)
            .map((n) => (
              <li key={n.id}>
                <button type="button" aria-pressed={sel === n.id} onClick={() => onSelect({ kind: 'node', address: n.id })}
                  className={`w-full border-l-2 px-2 py-0.5 text-left hover:bg-panel2 ${sel === n.id ? 'border-signal2 bg-panel2' : 'border-transparent'}`}>
                  <span className="mono">{short(n.id, 6)}</span>
                  {n.is_seed && <span className="tf-badge ml-1">starting wallet</span>}
                  {n.labels[0] && <span className="ml-1 text-dim">{n.labels[0].label}</span>}
                  <span className="ml-1 text-faint">· {n.in_count} in / {n.out_count} out{n.score !== null ? ` · lead score ${n.score.toFixed(1)}` : ''}</span>
                </button>
              </li>
            ))}
        </ul>
      </details>
      <p className="px-3 pb-2 text-[11px] text-faint">{graph.caveat}</p>
    </div>
  )
}
