import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api, qs } from '../../lib/api'
import { useApi } from '../../lib/hooks'
import type { CrossChainLink, Evidence, FusionRelationship, Label, PrivacyGap, Score, Transfer } from '../../lib/types'
import { ORIGIN_LABEL, STATUS_LABEL, fmtAmount, fmtDuration, fmtTime, short } from '../../lib/format'
import { Addr, Copy, ErrorBox, ExtLink, Spinner, StatusPill } from '../../components/ui'
import { ScoreBreakdown } from './ScoresView'
import { filterParams, type Filter, type Selection } from './state'

interface Props {
  invId: string
  caseId: string | null
  filter: Filter
  selection: Selection
  onSelect: (s: Selection) => void
  onHide: (a: string) => void
  reviews: Record<string, string>
  onCaseChanged: (msg: string) => void
}

export default function Inspector(p: Props) {
  const s = p.selection
  if (!s) {
    return (
      <div className="p-4 text-sm text-dim">
        <p className="mb-2 font-medium text-ink">Inspector</p>
        Select a wallet, edge, matrix cell, evidence record or relationship to see its exact evidence, provenance and caveats.
      </div>
    )
  }
  return (
    <div className="space-y-3 p-3 text-sm">
      <div className="flex items-center justify-between">
        <p className="text-xs tracking-wide text-faint uppercase">{s.kind === 'transfers' ? 'Transactions' : s.kind}</p>
        <button className="text-xs text-dim hover:text-ink" onClick={() => p.onSelect(null)} aria-label="Close inspector">✕ close</button>
      </div>
      {s.kind === 'node' && <NodePanel {...p} address={s.address} />}
      {s.kind === 'edge' && <EdgePanel {...p} source={s.source} target={s.target} />}
      {s.kind === 'transfers' && <TransfersPanel {...p} ids={s.ids} title={s.title} />}
      {s.kind === 'evidence' && <EvidencePanel {...p} ev={s.evidence} />}
      {s.kind === 'relationship' && <RelationshipPanel {...p} rel={s.rel} />}
    </div>
  )
}

interface NodeDetail {
  address: string
  chain: string
  explorer_url: string
  meta: { labels?: Label[]; expansion_status?: string; note?: string; is_contract?: boolean | null; name?: string | null; discovered_hop?: number }
  metrics: Record<string, unknown> & { hop: { forward: number | null; backward: number | null; undirected: number | null }; totals: { symbol: string; in: string | null; out: string | null; recognised: boolean }[] }
  score: Score | null
  transfers: Transfer[]
  transfer_count: number
  evidence: Evidence[]
  crosschain: CrossChainLink[]
  privacy_gaps: PrivacyGap[]
  limitations: string[]
}

function CaseActions({ caseId, targetType, targetId, onCaseChanged, label }: { caseId: string | null; targetType: string; targetId: string; onCaseChanged: (m: string) => void; label?: string }) {
  const [note, setNote] = useState('')
  const [err, setErr] = useState<unknown>(null)
  if (!caseId) return null
  return (
    <div className="space-y-2 rounded-md border border-line p-2">
      <button className="tf-btn py-1 text-xs" onClick={() => api(`/api/cases/${caseId}/bookmarks`, { method: 'POST', json: { target_type: targetType, target_id: targetId, label: label ?? null } })
        .then(() => onCaseChanged('Bookmarked')).catch(setErr)}>☆ Bookmark</button>
      <form className="flex gap-1" onSubmit={(e) => { e.preventDefault(); if (!note.trim()) return; api(`/api/cases/${caseId}/notes`, { method: 'POST', json: { target_type: targetType, target_id: targetId, body: note } })
        .then(() => { setNote(''); onCaseChanged('Note saved to case') }).catch(setErr) }}>
        <label className="sr-only" htmlFor={`note-${targetId}`}>Note</label>
        <input id={`note-${targetId}`} className="tf-input py-1 text-xs" placeholder="Add note to case" value={note} onChange={(e) => setNote(e.target.value)} />
        <button className="tf-btn py-1 text-xs" disabled={!note.trim()}>Save</button>
      </form>
      <ErrorBox error={err} />
    </div>
  )
}

function NodePanel({ invId, caseId, filter, address, onSelect, onHide, onCaseChanged }: Props & { address: string }) {
  const { data, error, loading, reload } = useApi<NodeDetail>(`/api/investigations/${invId}/nodes/${address}${qs(filterParams(filter))}`)
  if (loading && !data) return <Spinner />
  if (error) return <ErrorBox error={error} onRetry={reload} />
  if (!data) return null
  const m = data.metrics
  return (
    <>
      <div>
        <p className="mono break-hash text-ink"><span data-testid="selected-address">{data.address}</span><Copy text={data.address} /></p>
        <p className="text-xs text-faint">{data.meta.is_contract ? 'Contract' : data.meta.is_contract === false ? 'Externally owned account' : 'Type unknown'} · {data.chain} · <ExtLink href={data.explorer_url}>explorer</ExtLink></p>
        <p className="text-xs text-faint">Expansion: {data.meta.expansion_status}{data.meta.note ? ` — ${data.meta.note}` : ''}</p>
      </div>
      {data.meta.labels && data.meta.labels.length > 0 && (
        <div>
          <p className="tf-label">Labels (source assertions)</p>
          <ul className="space-y-1">{data.meta.labels.map((l, i) => (
            <li key={i} className="text-xs"><span className="tf-badge status-external_assertion mr-1">{l.category ?? 'label'}</span>{l.label}
              <span className="text-faint"> — {l.source_url ? <ExtLink href={l.source_url}>{l.source}</ExtLink> : l.source}</span></li>))}
          </ul>
        </div>
      )}
      {m && (
        <div className="grid grid-cols-3 gap-1 text-xs">
          {[['hop fwd', m.hop.forward], ['hop back', m.hop.backward], ['hop any', m.hop.undirected], ['in', m.in_count], ['out', m.out_count], ['fan-in', m.fan_in],
            ['fan-out', m.fan_out], ['dwell', fmtDuration(m.median_dwell_seconds as number | null)], ['pass-thru', m.pass_through_ratio ?? '—'],
            ['pagerank', m.pagerank ?? '—'], ['between.', m.betweenness ?? '—'], ['tx/day', m.frequency_per_day ?? '—']].map(([k, v]) => (
            <div key={String(k)} className="rounded border border-line p-1"><p className="text-faint">{String(k)}</p><p className="mono">{v === null || v === undefined ? '—' : String(v)}</p></div>
          ))}
        </div>
      )}
      {m?.totals?.length > 0 && (
        <table className="tf-table"><thead><tr><th>Asset</th><th>In</th><th>Out</th></tr></thead>
          <tbody>{m.totals.slice(0, 6).map((t) => <tr key={t.symbol}><td>{t.symbol}{!t.recognised && <span className="text-hypo">*</span>}</td><td className="mono">{fmtAmount(t.in)}</td><td className="mono">{fmtAmount(t.out)}</td></tr>)}</tbody></table>
      )}
      {data.score && (
        <details open={data.score.category === 'candidate'}>
          <summary className="cursor-pointer font-medium">Heuristic score: {data.score.score.toFixed(1)} ({data.score.band}, {data.score.category})</summary>
          <ScoreBreakdown signals={data.score.signals} />
          {data.score.caps_applied.map((c) => <p key={c} className="text-xs text-hypo">{c}</p>)}
        </details>
      )}
      <div>
        <p className="tf-label">Evidence ({data.evidence.length})</p>
        <ul className="space-y-1">{data.evidence.map((e) => (
          <li key={e.id}><button className="text-left text-xs hover:text-signal2" onClick={() => onSelect({ kind: 'evidence', evidence: e })}>
            <span className={`tf-badge status-${e.assertion_status} mr-1`}>{e.kind.replace(/_/g, ' ')}</span>{e.title}</button></li>))}
          {data.evidence.length === 0 && <li className="text-xs text-faint">No external evidence for this address.</li>}
        </ul>
      </div>
      {data.privacy_gaps.length > 0 && <p className="rounded border border-intel/40 p-2 text-xs">{data.privacy_gaps[0].explanation}</p>}
      {data.limitations.length > 0 && <ul className="text-xs text-hypo">{data.limitations.map((l) => <li key={l}>⚠ {l}</li>)}</ul>}
      <div className="flex flex-wrap gap-2">
        <button className="tf-btn py-1 text-xs" onClick={() => onHide(data.address)}>Hide from graph</button>
        <Link className="tf-btn py-1 text-xs" to={`/app/new?seed=${data.address}${caseId ? `&case=${caseId}` : ''}`}>Investigate from here</Link>
      </div>
      <CaseActions caseId={caseId} targetType="address" targetId={data.address} onCaseChanged={onCaseChanged} label={data.meta.labels?.[0]?.label} />
      <div>
        <p className="tf-label">Transfers ({data.transfer_count}{data.transfer_count > data.transfers.length ? `, first ${data.transfers.length} shown` : ''})</p>
        <TransferTable transfers={data.transfers} perspective={data.address} onSelect={onSelect} />
      </div>
    </>
  )
}

function EdgePanel({ invId, caseId, filter, source, target, onSelect, onCaseChanged }: Props & { source: string; target: string }) {
  const { data, error, loading } = useApi<{ edge: { totals: { symbol: string; amount: string | null; count: number }[]; count: number } | null; transfers: Transfer[] }>(
    `/api/investigations/${invId}/edges/${source}/${target}${qs(filterParams(filter))}`)
  if (loading && !data) return <Spinner />
  if (error) return <ErrorBox error={error} />
  return (
    <>
      <p className="text-xs"><Addr a={source} onClick={() => onSelect({ kind: 'node', address: source })} /> → <Addr a={target} onClick={() => onSelect({ kind: 'node', address: target })} /></p>
      <StatusPill status="verified_onchain" />
      <p className="text-xs text-dim">Observed transfers from provider records. Direction is sender → recipient.</p>
      {data?.edge && <ul className="text-xs">{data.edge.totals.map((t) => <li key={t.symbol}><span className="mono">{fmtAmount(t.amount)}</span> {t.symbol} in {t.count} transfer(s)</li>)}</ul>}
      <CaseActions caseId={caseId} targetType="edge" targetId={`${source}->${target}`} onCaseChanged={onCaseChanged} />
      <TransferTable transfers={data?.transfers ?? []} onSelect={onSelect} />
    </>
  )
}

function TransfersPanel({ invId, ids, title, onSelect }: Props & { ids: string[]; title: string }) {
  const { data, error, loading } = useApi<{ total: number; items: Transfer[] }>(`/api/investigations/${invId}/transfers${qs({ ids: ids.slice(0, 500) })}`)
  return (
    <>
      <p className="font-medium">{title}</p>
      <p className="text-xs text-faint">{ids.length} underlying transfer(s){ids.length > 500 ? ' (first 500 loaded)' : ''}</p>
      {loading && <Spinner />}
      <ErrorBox error={error} />
      <TransferTable transfers={data?.items ?? []} onSelect={onSelect} />
    </>
  )
}

export function TransferTable({ transfers, perspective, onSelect }: { transfers: Transfer[]; perspective?: string; onSelect: (s: Selection) => void }) {
  if (!transfers.length) return <p className="text-xs text-faint">No transfers in the current filter.</p>
  return (
    <div className="max-h-96 overflow-auto rounded border border-line">
      <table className="tf-table">
        <thead><tr><th>Time (UTC)</th><th>{perspective ? 'Dir · counterparty' : 'From → To'}</th><th>Amount</th><th>Tx</th></tr></thead>
        <tbody>
          {transfers.map((t) => {
            const out = perspective && t.from_address === perspective
            const cp = perspective ? (out ? t.to_address : t.from_address) : null
            return (
              <tr key={t.id} className={t.success ? '' : 'opacity-60'}>
                <td className="text-[11px] whitespace-nowrap">{fmtTime(t.timestamp).slice(0, 19)}{t.timestamp_quality === 'missing' && <span className="text-hypo"> (no ts)</span>}</td>
                <td className="text-[11px]">
                  {perspective ? (<>{out ? '→ out' : '← in'} <Addr a={cp} n={4} onClick={() => cp && onSelect({ kind: 'node', address: cp })} /></>)
                    : (<><Addr a={t.from_address} n={4} onClick={() => onSelect({ kind: 'node', address: t.from_address })} /> → <Addr a={t.to_address} n={4} onClick={() => t.to_address && onSelect({ kind: 'node', address: t.to_address })} /></>)}
                  <span className="ml-1 text-faint">{t.kind}</span>
                </td>
                <td className="mono text-[11px] whitespace-nowrap" title={`raw ${t.raw_amount}, decimals ${t.asset.decimals}`}>
                  {fmtAmount(t.amount)} {t.asset.symbol}{!t.asset.recognised && <span className="text-hypo" title="Not in canonical token registry">*</span>}
                  {!t.success && <span className="text-danger"> failed</span>}
                </td>
                <td className="text-[11px]"><ExtLink href={t.explorer_url}>{short(t.tx_hash, 4)}</ExtLink>
                  <span className="block text-faint" title={`${t.provenance.provider} · ${t.provenance.endpoint} · retrieved ${t.provenance.retrieved_at}`}>{ORIGIN_LABEL[t.provenance.data_origin]}</span></td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function EvidencePanel({ caseId, ev, onSelect, reviews, onCaseChanged }: Props & { ev: Evidence }) {
  const [state, setState] = useState(reviews[ev.id] ?? 'unreviewed')
  const [err, setErr] = useState<unknown>(null)
  const attrs = ev.attributes ?? {}
  return (
    <>
      <p className="font-medium">{ev.title}</p>
      <div className="flex flex-wrap gap-1"><StatusPill status={ev.assertion_status} /><span className="tf-badge">{ev.kind.replace(/_/g, ' ')}</span><span className="tf-badge">confidence: {ev.confidence}</span>
        <span className="tf-badge">{ORIGIN_LABEL[ev.data_origin] ?? ev.data_origin}</span></div>
      <dl className="space-y-1 text-xs">
        <Row k="Source">{ev.source} {ev.source_url && <ExtLink href={ev.source_url}>open original</ExtLink>}</Row>
        {ev.subject_address && <Row k="Subject"><Addr a={ev.subject_address} onClick={() => onSelect({ kind: 'node', address: ev.subject_address! })} /></Row>}
        {ev.subject_tx && <Row k="Transaction"><span className="mono break-hash">{ev.subject_tx}</span></Row>}
        {ev.match_criteria && <Row k="Match">{ev.match_criteria}{ev.match_location ? ` · ${ev.match_location}` : ''}</Row>}
        {ev.query && <Row k="Query"><span className="mono">{ev.query}</span></Row>}
        <Row k="Published">{fmtTime(ev.published_at)}</Row>
        <Row k="Collected">{fmtTime(ev.collected_at)}</Row>
        {ev.source_item_id && <Row k="Item"><span className="mono break-hash">{ev.source_item_id}</span></Row>}
      </dl>
      {ev.snippet && (
        <blockquote className="rounded border-l-2 border-intel bg-elev p-2 text-xs whitespace-pre-wrap">{ev.snippet}</blockquote>
      )}
      {Array.isArray(attrs.context_terms) && (attrs.context_terms as string[]).length > 0 && <p className="text-xs">Context terms: {(attrs.context_terms as string[]).join(', ')}</p>}
      {Array.isArray(attrs.co_mentioned_indicators) && (attrs.co_mentioned_indicators as string[]).length > 0 && (
        <p className="text-xs">Co-mentioned: {(attrs.co_mentioned_indicators as string[]).slice(0, 8).map((a) => <span key={a} className="mono mr-1">{short(a, 4)}</span>)}</p>)}
      {ev.caveats.length > 0 && <ul className="text-xs text-hypo">{ev.caveats.map((c) => <li key={c}>⚠ {c}</li>)}</ul>}
      {caseId && (
        <div className="flex items-center gap-2">
          <label htmlFor={`rv-${ev.id}`} className="text-xs text-dim">Review</label>
          <select id={`rv-${ev.id}`} className="tf-select w-auto py-1 text-xs" value={state}
            onChange={(e) => { const v = e.target.value; setState(v); api(`/api/cases/${caseId}/reviews/${ev.id}`, { method: 'PUT', json: { state: v } }).then(() => onCaseChanged(`Evidence marked ${v}`)).catch(setErr) }}>
            {['unreviewed', 'reviewed', 'accepted', 'disputed', 'rejected'].map((x) => <option key={x}>{x}</option>)}
          </select>
        </div>
      )}
      <ErrorBox error={err} />
      <CaseActions caseId={caseId} targetType="evidence" targetId={ev.id} onCaseChanged={onCaseChanged} label={ev.title.slice(0, 120)} />
    </>
  )
}

function RelationshipPanel({ caseId, rel, onSelect, onCaseChanged }: Props & { rel: FusionRelationship }) {
  const [rationale, setRationale] = useState('')
  const [relation, setRelation] = useState('possibly same operator')
  const [err, setErr] = useState<unknown>(null)
  const ev = rel.evidence as Record<string, unknown>
  const goto = (id: string) => id.startsWith('wallet:') ? <Addr a={id.split(':')[2]} onClick={() => onSelect({ kind: 'node', address: id.split(':')[2] })} /> : <span className="mono break-hash">{id}</span>
  return (
    <>
      <p className="font-medium">{rel.type.replace(/_/g, ' ')}</p>
      <div className="flex flex-wrap gap-1"><StatusPill status={rel.assertion_status} /><span className="tf-badge">confidence: {rel.confidence}</span></div>
      <p className="text-xs">{goto(rel.source)} → {goto(rel.target)}</p>
      <p className="text-xs text-dim">{STATUS_LABEL[rel.assertion_status]} · method: {rel.method ?? '—'}</p>
      <dl className="space-y-1 text-xs">
        {Object.entries(ev).filter(([, v]) => v !== null && v !== undefined && v !== '').slice(0, 14).map(([k, v]) => (
          <Row key={k} k={k}>{k === 'url' ? <ExtLink href={String(v)}>{String(v)}</ExtLink>
            : k === 'tx_hashes' && Array.isArray(v) ? (v as string[]).slice(0, 10).map((h) => <span key={h} className="mono mr-1 block break-hash">{h}</span>)
              : typeof v === 'object' ? <pre className="max-h-40 overflow-auto text-[10px] whitespace-pre-wrap">{JSON.stringify(v, null, 1).slice(0, 1500)}</pre>
                : <span className="break-hash whitespace-pre-wrap">{String(v).slice(0, 600)}</span>}</Row>
        ))}
      </dl>
      {rel.caveats.filter(Boolean).length > 0 && <ul className="text-xs text-hypo">{rel.caveats.filter(Boolean).map((c) => <li key={c!}>⚠ {c}</li>)}</ul>}
      {caseId && (
        <form className="space-y-1 rounded-md border border-analyst/40 p-2" onSubmit={(e) => { e.preventDefault(); if (!rationale.trim()) return
          api(`/api/cases/${caseId}/hypotheses`, { method: 'POST', json: { source_entity: rel.source, target_entity: rel.target, relation, rationale } })
            .then(() => { setRationale(''); onCaseChanged('Analyst hypothesis added (shown in fusion graph)') }).catch(setErr) }}>
          <p className="text-xs font-medium text-analyst">Record analyst hypothesis about these entities</p>
          <label className="sr-only" htmlFor="hyp-rel">Relation</label>
          <input id="hyp-rel" className="tf-input py-1 text-xs" value={relation} onChange={(e) => setRelation(e.target.value)} maxLength={120} />
          <label className="sr-only" htmlFor="hyp-why">Rationale</label>
          <textarea id="hyp-why" className="tf-textarea text-xs" rows={2} placeholder="Rationale (required)" value={rationale} onChange={(e) => setRationale(e.target.value)} />
          <button className="tf-btn py-1 text-xs" disabled={!rationale.trim()}>Add hypothesis</button>
          <ErrorBox error={err} />
        </form>
      )}
    </>
  )
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return <div className="grid grid-cols-[90px_1fr] gap-2"><dt className="text-faint">{k}</dt><dd className="min-w-0">{children}</dd></div>
}
