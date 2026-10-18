import { useMemo, useState } from 'react'
import { useApi } from '../../lib/hooks'
import type { Evidence, SourceStatus } from '../../lib/types'
import { fmtTime, short } from '../../lib/format'
import { ErrorBox, ExtLink, Spinner } from '../../components/ui'
import type { Selection } from './state'

const GROUPS: { id: 'all' | 'facts' | 'claims' | 'hypotheses'; label: string; hint: string; statuses: readonly string[] | null; tone: string }[] = [
  { id: 'all', label: 'All findings', hint: 'Every record collected for this investigation', statuses: null, tone: 'var(--text)' },
  { id: 'facts', label: 'Transaction facts', hint: 'Proven by the ledger', statuses: ['verified_onchain'], tone: 'var(--signal)' },
  { id: 'claims', label: 'Source claims', hint: 'Reported by sanctions lists, feeds, reports, repositories', statuses: ['external_assertion'], tone: 'var(--intel)' },
  { id: 'hypotheses', label: 'Hypotheses', hint: 'Suggested by an algorithm or an analyst — unconfirmed', statuses: ['algorithmic_inference', 'analyst_hypothesis'], tone: 'var(--hypo)' },
]

export default function EvidenceView({ invId, onSelect, reviews }: { invId: string; onSelect: (s: Selection) => void; reviews: Record<string, string> }) {
  const { data, error, loading, reload } = useApi<{ items: Evidence[]; source_status: SourceStatus[] }>(`/api/investigations/${invId}/evidence`)
  const [kind, setKind] = useState('')
  const [source, setSource] = useState('')
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<'kind' | 'confidence' | 'date'>('kind')
  const [group, setGroup] = useState<(typeof GROUPS)[number]['id']>('all')
  const items = useMemo(() => {
    const confRank = ['confirmed', 'strong', 'moderate', 'weak', 'unverified']
    const inGroup = GROUPS.find((g) => g.id === group)!.statuses
    let xs = (data?.items ?? []).filter((e) => (!inGroup || inGroup.includes(e.assertion_status)) && (!kind || e.kind === kind) && (!source || e.source === source) &&
      (!q || `${e.title} ${e.subject_address} ${e.snippet}`.toLowerCase().includes(q.toLowerCase())))
    xs = [...xs].sort((a, b) => sort === 'confidence' ? confRank.indexOf(a.confidence) - confRank.indexOf(b.confidence)
      : sort === 'date' ? (b.published_at ?? '').localeCompare(a.published_at ?? '') : a.kind.localeCompare(b.kind))
    return xs
  }, [data, kind, source, q, sort, group])
  const kinds = [...new Set((data?.items ?? []).map((e) => e.kind))].sort()
  const sources = [...new Set((data?.items ?? []).map((e) => e.source))].sort()

  return (
    <div className="flex h-full flex-col gap-3 p-3">
      {loading && !data && <Spinner />}
      <ErrorBox error={error} onRetry={reload} />
      {data && (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4" role="group" aria-label="Findings by kind">
          {GROUPS.map((g) => {
            const n = g.statuses ? data.items.filter((e) => g.statuses!.includes(e.assertion_status)).length : data.items.length
            return (
              <button key={g.id} type="button" aria-pressed={group === g.id} onClick={() => setGroup(g.id)}
                className={`border p-2.5 text-left transition-colors ${group === g.id ? 'border-signal2 bg-signal2/10' : 'border-line bg-elev hover:border-linestrong'}`}>
                <span className="flex items-center justify-between gap-2">
                  <span className="text-[12px] font-semibold" style={{ color: g.tone }}>{g.label}</span>
                  <span className="font-display text-xl leading-none font-black">{n}</span>
                </span>
                <span className="mt-1 block text-[11px] text-dim">{g.hint}</span>
              </button>
            )
          })}
        </div>
      )}
      {data && (
        <details className="text-xs">
          <summary className="cursor-pointer font-semibold text-dim hover:text-ink">Sources queried ({data.source_status.length}) — status and coverage</summary>
          <div className="mt-2 flex flex-wrap gap-2" aria-label="Source status">
            {data.source_status.map((s) => (
              <span key={s.source} className={`tf-badge ${s.state === 'ok' ? 'text-ok' : s.state === 'disabled' ? 'text-faint' : 'text-hypo'}`} title={s.message ?? ''}>
                {s.source}: {s.state} · {s.results}/{s.queried}{s.from_cache ? ` · ${s.from_cache} cached` : ''}{s.message ? ` · ${s.message}` : ''}
              </span>
            ))}
          </div>
        </details>
      )}
      <div className="flex flex-wrap gap-2 text-xs">
        <select className="tf-select w-auto py-1" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Evidence kind">
          <option value="">All kinds</option>{kinds.map((k) => <option key={k}>{k}</option>)}
        </select>
        <select className="tf-select w-auto py-1" value={source} onChange={(e) => setSource(e.target.value)} aria-label="Source">
          <option value="">All sources</option>{sources.map((k) => <option key={k}>{k}</option>)}
        </select>
        <select className="tf-select w-auto py-1" value={sort} onChange={(e) => setSort(e.target.value as 'kind')} aria-label="Sort by">
          <option value="kind">Sort: kind</option><option value="confidence">Sort: confidence</option><option value="date">Sort: published date</option>
        </select>
        <input className="tf-input w-48 py-1" placeholder="Search evidence" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search evidence" />
        <span className="ml-auto self-center text-faint">{items.length} record(s)</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto border border-line">
        <table className="tf-table">
          <thead><tr><th>Kind</th><th>Subject</th><th>Source</th><th>Context</th><th>Dates</th><th>Confidence</th><th>Review</th></tr></thead>
          <tbody>
            {items.map((e) => (
              <tr key={e.id} className="cursor-pointer" onClick={() => onSelect({ kind: 'evidence', evidence: e })}>
                <td>
                  <button type="button" className={`tf-badge status-${e.assertion_status}`} aria-label={`Inspect ${e.kind.replace(/_/g, ' ')}: ${e.title}`}
                    onClick={(ev) => { ev.stopPropagation(); onSelect({ kind: 'evidence', evidence: e }) }}>{e.kind.replace(/_/g, ' ')}</button>
                </td>
                <td className="mono">{short(e.subject_address ?? e.subject_tx)}</td>
                <td><ExtLink href={e.source_url}>{e.title.slice(0, 70)}</ExtLink><br /><span className="text-[11px] text-faint">{e.source}</span></td>
                <td className="max-w-md text-[11px] text-dim">{(e.snippet ?? '').slice(0, 180)}</td>
                <td className="text-[11px] whitespace-nowrap text-faint">pub {fmtTime(e.published_at).slice(0, 10)}<br />got {fmtTime(e.collected_at).slice(0, 10)}</td>
                <td>{e.confidence}</td>
                <td>{reviews[e.id] ? <span className="tf-badge">{reviews[e.id]}</span> : <span className="text-faint">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
