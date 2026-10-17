import { useApi } from '../../lib/hooks'
import type { CrossChainLink, PrivacyGap } from '../../lib/types'
import { fmtTime, short } from '../../lib/format'
import { Empty, ErrorBox, ExtLink, Spinner } from '../../components/ui'
import type { Selection } from './state'

const STATUS_STYLE: Record<string, string> = {
  confirmed: 'text-signal', derived: 'text-signal2', candidate: 'text-hypo', unresolved: 'text-faint',
}

export default function CrossChainView({ invId, onSelect }: { invId: string; onSelect: (s: Selection) => void }) {
  const { data, error, loading, reload } = useApi<{ links: CrossChainLink[]; privacy_gaps: PrivacyGap[] }>(`/api/investigations/${invId}/crosschain`)
  if (loading && !data) return <div className="p-4"><Spinner /></div>
  return (
    <div className="space-y-4 overflow-auto p-2">
      <ErrorBox error={error} onRetry={reload} />
      <p className="text-xs text-dim">
        <strong className="text-signal">confirmed</strong> = deterministic link from documented bridge events with the destination tx fetched ·{' '}
        <strong className="text-signal2">derived</strong> = deterministic hash computed, destination not fetched ·{' '}
        <strong className="text-hypo">candidate</strong> = heuristic match (never a confirmed transfer) · <strong>unresolved</strong> = no defensible link.
      </p>
      <section>
        <h3 className="mb-2 font-semibold">Bridge interactions ({data?.links.length ?? 0})</h3>
        {data && data.links.length === 0 && <Empty title="No value-bearing transfers into known bridge contracts in scope" />}
        <div className="space-y-2">
          {data?.links.map((l) => (
            <article key={l.source_tx} className="rounded-lg border border-line p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`tf-badge ${STATUS_STYLE[l.status]}`}>{l.status}</span>
                <span className="font-medium">{l.bridge_label}</span>
                <span className="text-faint">{fmtTime(l.source_timestamp)}</span>
                <button className="mono text-signal2" onClick={() => onSelect({ kind: 'node', address: l.sender })}>{short(l.sender)}</button>
                <span className="text-faint">→ {l.destination_chain ?? 'unknown destination'}</span>
              </div>
              <p className="mono mt-1 text-xs text-dim">source tx {l.source_tx}</p>
              {l.method && <p className="mt-1 text-xs"><span className="text-faint">Method:</span> {l.method}</p>}
              {l.links.length > 0 && (
                <ul className="mt-2 space-y-1 text-xs">
                  {l.links.map((lk, i) => (
                    <li key={i} className="rounded border border-line p-2">
                      <span className={`tf-badge ${STATUS_STYLE[String(lk.status)]}`}>{String(lk.status)}</span>{' '}
                      {String(lk.destination_chain)}: <ExtLink href={lk.destination_explorer_url as string}>{short(String(lk.destination_tx), 10)}</ExtLink>
                      {lk.recipient ? <> · recipient <span className="mono">{short(String(lk.recipient))}</span></> : null}
                      {lk.amount ? <> · amount {String(lk.amount)} {String(lk.asset ?? '')}</> : null}
                      {lk.delay_seconds !== undefined && <> · delay {Math.round(Number(lk.delay_seconds) / 60)} min</>}
                      {lk.relative_amount_difference !== undefined && <> · Δamount {(Number(lk.relative_amount_difference) * 100).toFixed(2)}%</>}
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-2 grid gap-2 text-xs md:grid-cols-2">
                <div><p className="font-medium text-ok">Evidence for</p><ul className="list-disc pl-4 text-dim">{l.evidence_for.map((x) => <li key={x}>{x}</li>)}{l.evidence_for.length === 0 && <li>none</li>}</ul></div>
                <div><p className="font-medium text-hypo">Evidence against / gaps</p><ul className="list-disc pl-4 text-dim">{l.evidence_against.map((x) => <li key={x}>{x}</li>)}{l.evidence_against.length === 0 && <li>none</li>}</ul></div>
              </div>
              {l.uncertainty && <p className="mt-1 text-xs text-faint">{l.uncertainty}</p>}
            </article>
          ))}
        </div>
      </section>
      <section>
        <h3 className="mb-2 font-semibold">Privacy-protocol blind spots ({data?.privacy_gaps.length ?? 0})</h3>
        {data && data.privacy_gaps.length === 0 && <Empty title="No deposits into labelled mixers in scope" />}
        {data?.privacy_gaps.map((g) => (
          <article key={g.address} className="mb-2 rounded-lg border border-intel/40 p-3 text-sm">
            <p><span className="tf-badge text-faint">unresolved</span> <strong>{g.label}</strong> <span className="mono text-xs">{g.address}</span></p>
            <p className="mt-1 text-xs">{g.deposits} deposit(s) from {g.senders.length} traced address(es): {g.senders.map((s) => (
              <button key={s} className="mono mr-1 text-signal2" onClick={() => onSelect({ kind: 'node', address: s })}>{short(s)}</button>))}</p>
            <p className="mt-1 text-xs text-dim">{g.explanation}</p>
            <button className="tf-btn mt-2 py-1 text-xs" onClick={() => onSelect({ kind: 'transfers', ids: g.transfer_ids, title: `Deposits into ${g.label}` })}>View deposit transfers</button>
          </article>
        ))}
      </section>
    </div>
  )
}
