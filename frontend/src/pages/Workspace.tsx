import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, apiUrl, qs } from '../lib/api'
import { useApi, useInvestigation } from '../lib/hooks'
import type { CaseDetail, GraphResponse, Investigation, ProgressEvent, TimelineResponse } from '../lib/types'
import { fmtTime, ORIGIN_LABEL, short } from '../lib/format'
import { ErrorBox, Spinner, Tabs, Toast } from '../components/ui'
import ProgressPanel from '../features/workspace/ProgressPanel'
import FilterBar from '../features/workspace/FilterBar'
import FlowWorkbench, { type ViewMode } from '../features/workspace/flow/FlowWorkbench'
import MatrixView from '../features/workspace/MatrixView'
import FusionView from '../features/workspace/FusionView'
import ScoresView from '../features/workspace/ScoresView'
import EvidenceView from '../features/workspace/EvidenceView'
import CrossChainView from '../features/workspace/CrossChainView'
import MetricsView from '../features/workspace/MetricsView'
import ChronoReplay from '../features/workspace/ChronoReplay'
import Inspector from '../features/workspace/Inspector'
import { DEFAULT_FILTER, filterParams, type Filter, type Selection, type TabId } from '../features/workspace/state'

const TERMINAL = ['completed', 'partial', 'failed', 'cancelled']

interface PersistedUi {
  investigation_id?: string
  tab?: TabId
  filter?: Filter
  selected?: string | null
  view?: ViewMode
}

export default function Workspace() {
  const { id } = useParams()
  const { inv, events, error, refresh } = useInvestigation(id)
  const caseId = inv?.case_id ?? null
  const caseData = useApi<CaseDetail>(caseId ? `/api/cases/${caseId}` : null)
  if (error && !inv) return <ErrorBox error={error} />
  if (!inv || !id) return <Spinner label="Loading investigation" />
  if (caseId && !caseData.data && !caseData.error) return <Spinner label="Loading case" />
  const ui = (caseData.data?.ui_state ?? {}) as PersistedUi
  // Mount the body only once persisted UI state is known, so it initialises (not resets) local state.
  return <WorkspaceBody key={id} id={id} inv={inv} events={events} refresh={refresh} caseId={caseId} caseData={caseData}
    initial={ui.investigation_id === id ? ui : null} />
}

interface BodyProps {
  id: string
  inv: Investigation
  events: ProgressEvent[]
  refresh: () => Promise<void>
  caseId: string | null
  caseData: ReturnType<typeof useApi<CaseDetail>>
  initial: PersistedUi | null
}

function WorkspaceBody({ id, inv, events, refresh, caseId, caseData, initial }: BodyProps) {
  const done = TERMINAL.includes(inv.status) && !inv.running
  const [tab, setTab] = useState<TabId>(() => initial?.tab ?? 'graph')
  const [filter, setFilter] = useState<Filter>(() => ({ ...DEFAULT_FILTER, ...(initial?.filter ?? {}) }))
  const [selection, setSelection] = useState<Selection>(() => (initial?.selected ? { kind: 'node', address: initial.selected } : null))
  const [at, setAt] = useState<number | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [fusionKey, setFusionKey] = useState(0)
  const [view, setView] = useState<ViewMode>(() => initial?.view ?? '2d')

  // persist UI state to the case (debounced; skips the initial render, which only reflects stored state)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const firstRender = useRef(true)
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    if (!caseId) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      void api(`/api/cases/${caseId}`, { method: 'PATCH', json: { ui_state: { investigation_id: id, tab, filter, view, selected: selection?.kind === 'node' ? selection.address : null } } }).catch(() => undefined)
    }, 800)
  }, [tab, filter, selection, caseId, id, view])

  const fq = qs(filterParams(filter))
  const graph = useApi<GraphResponse>(done ? `/api/investigations/${id}/graph${fq}` : null)
  const tlFilter = useMemo(() => ({ ...filter }), [filter])
  const timeline = useApi<TimelineResponse>(done ? `/api/investigations/${id}/timeline${qs(filterParams(tlFilter))}` : null)
  const unfilteredAssets = useApi<GraphResponse>(done ? `/api/investigations/${id}/graph` : null)
  const assets = unfilteredAssets.data?.stats.assets ?? graph.data?.stats.assets ?? []
  const reviews = useMemo(() => Object.fromEntries((caseData.data?.reviews ?? []).map((r) => [r.evidence_id, r.state])), [caseData.data])

  const onSelect = useCallback((s: Selection) => setSelection(s), [])
  const onHide = useCallback((a: string) => {
    setFilter((f) => ({ ...f, hide: [...new Set([...f.hide, a])] }))
    setSelection(null)
    setToast(`Hidden ${short(a)} — restore it under Filters`)
  }, [])
  const onCaseChanged = useCallback((m: string) => {
    setToast(m)
    void caseData.reload()
    setFusionKey((k) => k + 1)
  }, [caseData])

  return (
    <div className="flex flex-col gap-3">
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <p className="text-xs text-faint">
            {caseId && <><Link to={`/app/cases/${caseId}`} className="text-signal2 hover:underline">{caseData.data?.title ?? 'Case'}</Link> · </>}
            Investigation {inv.id}
          </p>
          <h1 className="flex flex-wrap items-baseline gap-x-2 text-lg">
            <span className="font-semibold">{inv.seed_kind === 'tx_hash' ? 'Transaction' : 'Wallet'}</span>
            <span className="mono break-all text-base text-dim">{inv.seed_value}</span>
          </h1>
        </div>
        {done && inv.status !== 'failed' && (
          <details className="relative" aria-label="Exports">
            <summary className="tf-btn cursor-pointer list-none">Export ▾</summary>
            <div className="absolute right-0 z-30 mt-1 flex w-52 flex-col gap-1 rounded-md border border-linestrong bg-elev p-2 shadow-lg">
              <a className="tf-btn" href={apiUrl(`/api/investigations/${inv.id}/report.html`)} target="_blank" rel="noopener noreferrer">View report</a>
              <a className="tf-btn" href={apiUrl(`/api/investigations/${inv.id}/report.html?download=true`)}>HTML</a>
              <a className="tf-btn" href={apiUrl(`/api/investigations/${inv.id}/report.json`)}>JSON</a>
              <a className="tf-btn" href={apiUrl(`/api/investigations/${inv.id}/export/transfers.csv`)}>Transfers CSV</a>
              <a className="tf-btn" href={apiUrl(`/api/investigations/${inv.id}/export/scores.csv`)}>Scores CSV</a>
              <a className="tf-btn" href={apiUrl(`/api/investigations/${inv.id}/export/evidence.csv`)}>Evidence CSV</a>
            </div>
          </details>
        )}
      </header>
      <StatusStrip inv={inv} historical={inv.data_origin === 'historical_case'} />

      {inv.status === 'failed' && <ErrorBox error={new Error(inv.error ?? 'Investigation failed')} onRetry={inv.data_origin === 'live' ? () => void api(`/api/investigations/${inv.id}/retry`, { method: 'POST' }).then((r) => { window.location.assign(`/app/investigations/${(r as { id: string }).id}`) }) : undefined} />}

      {(!done || inv.status === 'failed') && <ProgressPanel inv={inv} events={events} onCancel={() => void api(`/api/investigations/${inv.id}/cancel`, { method: 'POST' }).then(refresh)} />}

      {done && inv.status !== 'failed' && (
        <>
          <FilterBar filter={filter} setFilter={setFilter} assets={assets} />
          <ChronoReplay invId={inv.id} timeline={timeline.data} filter={filter} setFilter={setFilter} at={at} setAt={setAt}
            onSelectTransfer={(tid) => setSelection({ kind: 'transfers', ids: [tid], title: 'Replay transfer' })} />
          <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="tf-panel flex min-h-[calc(100vh-15rem)] flex-col overflow-hidden">
              <Tabs label="Analysis views" value={tab} onChange={setTab} tabs={[
                { id: 'graph', label: 'Fund flow', count: graph.data?.nodes.length },
                { id: 'matrix', label: 'Transfer matrix' },
                { id: 'fusion', label: 'Evidence fusion' },
                { id: 'scores', label: 'Lead ranking' },
                { id: 'evidence', label: 'Evidence' },
                { id: 'crosschain', label: 'Cross-chain' },
                { id: 'metrics', label: 'Flow patterns' },
              ]} />
              <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="min-h-0 flex-1">
                {tab === 'graph' && (graph.error ? <ErrorBox error={graph.error} onRetry={graph.reload} /> : graph.data ? (
                  graph.data.stats.transfers > 0 ? <FlowWorkbench invId={inv.id} graph={graph.data} filter={filter} selection={selection} onSelect={onSelect}
                    onHide={onHide} visibleUntil={at} mode={view} onMode={setView} />
                    : <p className="p-4 text-dim">No transfers match the current filter.</p>) : <div className="p-4"><Spinner label="Loading fund flow" /></div>)}
                {tab === 'matrix' && <MatrixView invId={inv.id} filter={filter} assets={assets} selection={selection} onSelect={onSelect} />}
                {tab === 'fusion' && <FusionView invId={inv.id} filter={filter} onSelect={onSelect} reloadKey={fusionKey} />}
                {tab === 'scores' && <ScoresView invId={inv.id} filter={filter} onSelect={onSelect} selection={selection} />}
                {tab === 'evidence' && <EvidenceView invId={inv.id} onSelect={onSelect} reviews={reviews} />}
                {tab === 'crosschain' && <CrossChainView invId={inv.id} onSelect={onSelect} />}
                {tab === 'metrics' && <MetricsView invId={inv.id} filter={filter} assets={assets} timeline={timeline.data} onSelect={onSelect} />}
              </div>
            </div>
            <aside className="tf-panel max-h-[calc(100vh-2rem)] overflow-auto xl:sticky xl:top-4" aria-label="Inspector">
              <Inspector invId={inv.id} caseId={caseId} filter={filter} selection={selection} onSelect={onSelect} onHide={onHide} reviews={reviews} onCaseChanged={onCaseChanged} />
            </aside>
          </div>
        </>
      )}
      <p className="sr-only" aria-live="polite">{announce(selection)}</p>
      <Toast message={toast} onDone={() => setToast(null)} />
    </div>
  )
}

function announce(s: Selection): string {
  if (!s) return ''
  if (s.kind === 'node') return `Inspector shows wallet ${s.address}`
  if (s.kind === 'edge') return `Inspector shows transfers from ${s.source} to ${s.target}`
  if (s.kind === 'transfers') return `Inspector shows ${s.ids.length} transfer(s): ${s.title}`
  if (s.kind === 'evidence') return `Inspector shows evidence: ${s.evidence.title}`
  return `Inspector shows relationship: ${s.rel.type.replace(/_/g, ' ')}`
}

function StatusStrip({ inv, historical }: { inv: Investigation; historical: boolean }) {
  const dir = inv.config.direction === 'forward' ? 'Following funds out' : inv.config.direction === 'backward' ? 'Following funds in' : 'Following funds both ways'
  const state = inv.status === 'completed' ? 'Analysis complete' : inv.status === 'partial' ? 'Partial result' : inv.status === 'failed' ? 'Failed' : inv.status === 'cancelled' ? 'Cancelled' : 'Analysing…'
  const tone = inv.status === 'completed' ? 'bg-ok' : inv.status === 'partial' ? 'bg-hypo' : inv.status === 'failed' ? 'bg-danger' : 'bg-signal'
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-line bg-panel px-3 py-1.5 text-xs" role="group" aria-label="Investigation status">
      <span className="flex items-center gap-1.5"><span className={`inline-block h-2 w-2 rounded-full ${tone}`} aria-hidden /><strong>{state}</strong>
        </span>
      {inv.warnings.length > 0 && (
        <details className="relative">
          <summary className="cursor-pointer text-hypo">{inv.warnings.length} warning{inv.warnings.length === 1 ? '' : 's'} ▾</summary>
          <ul className="absolute left-0 z-30 mt-1 w-[min(36rem,80vw)] list-disc space-y-1 rounded-md border border-hypo/40 bg-elev p-3 pl-6 text-dim shadow-lg">
            {inv.warnings.map((w) => <li key={w}>{w}</li>)}
          </ul>
        </details>
      )}
      <span><span className="text-faint">Chain</span> {inv.chain}</span>
      <span title={historical ? 'Recorded real provider responses replayed through the live pipeline — not a live query' : undefined}>
        <span className="text-faint">Data</span> {historical ? <><span className="text-hypo">Historical case (recorded)</span><span className="text-dim"> — recorded real provider responses, replayed</span></> : ORIGIN_LABEL[inv.data_origin] ?? inv.data_origin}
        {inv.provider && <span className="text-faint"> via {inv.provider}</span>}
      </span>
      <span><span className="text-faint">Scope</span> {dir} · up to {inv.config.max_hops} hops · {inv.config.max_branching} branches per wallet</span>
      {inv.finished_at && <span><span className="text-faint">Finished</span> {fmtTime(inv.finished_at)}</span>}
    </div>
  )
}
