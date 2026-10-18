import { useApi } from '../../lib/hooks'
import type { CrossChainLink, PrivacyGap } from '../../lib/types'
import { fmtTime, short } from '../../lib/format'
import { Empty, ErrorBox, ExtLink, Spinner } from '../../components/ui'
import type { Selection } from './state'

/** Small schematic of one movement: source chain → bridge → destination, drawn in the style of its status. */
function BridgeGlyph({ status, from, to }: { status: string; from: string; to: string }) {
  const stroke = status === 'confirmed' ? 'var(--signal)' : status === 'derived' ? 'var(--signal-2)' : status === 'candidate' ? 'var(--hypo)' : 'var(--text-faint)'
  const dash = status === 'confirmed' ? undefined : status === 'derived' ? '6 4' : status === 'candidate' ? '1.5 4' : '2 6'
  return (
    <svg viewBox="0 0 220 56" className="h-14 w-[220px] shrink-0" aria-hidden>
      <rect x="4" y="30" width="44" height="18" fill="var(--panel-2)" stroke="var(--signal)" strokeWidth="1.5" />
      <text x="26" y="42.5" textAnchor="middle" fontSize="8.5" fill="var(--text-dim)" fontFamily="JetBrains Mono, monospace">{from.slice(0, 8)}</text>
      <rect x="172" y="30" width="44" height="18" fill="var(--panel-2)" stroke={status === 'unresolved' ? 'var(--line-strong)' : 'var(--intel)'} strokeWidth="1.5" strokeDasharray={status === 'unresolved' ? '3 3' : undefined} />
      <text x="194" y="42.5" textAnchor="middle" fontSize="8.5" fill="var(--text-dim)" fontFamily="JetBrains Mono, monospace">{to.slice(0, 8)}</text>
      {status === 'unresolved' ? (
        <>
          <path d="M48 32 C70 4 95 4 104 10" fill="none" stroke={stroke} strokeWidth="2" strokeDasharray={dash} />
          <path d="M120 10 C130 4 152 4 172 32" fill="none" stroke={stroke} strokeWidth="2" strokeDasharray={dash} opacity=".5" />
          <text x="112" y="16" textAnchor="middle" fontSize="12" fontWeight="700" fill="var(--text-faint)">?</text>
        </>
      ) : <path d="M48 32 C80 -2 140 -2 172 32" fill="none" stroke={stroke} strokeWidth="2.5" strokeDasharray={dash} strokeLinecap="round" />}
      <path d="M106 8l4-4 4 4-4 4Z" fill={stroke} />
    </svg>
  )
}

const STATUS_STYLE: Record<string, string> = {
  confirmed: 'text-signal', derived: 'text-signal2', candidate: 'text-hypo', unresolved: 'text-faint',
}

export default function CrossChainView({ invId, onSelect }: { invId: string; onSelect: (s: Selection) => void }) {
  const { data, error, loading, reload } = useApi<{ links: CrossChainLink[]; privacy_gaps: PrivacyGap[] }>(`/api/investigations/${invId}/crosschain`)
  if (loading && !data) return <div className="p-4"><Spinner /></div>
  return (
    <div className="space-y-5 overflow-auto p-3">
      <ErrorBox error={error} onRetry={reload} />
      <p className="border border-line bg-elev p-2.5 text-xs text-dim">
        <strong className="text-signal">confirmed</strong> = deterministic link from documented bridge events with the destination tx fetched ·{' '}
        <strong className="text-signal2">derived</strong> = deterministic hash computed, destination not fetched ·{' '}
        <strong className="text-hypo">candidate</strong> = heuristic match (never a confirmed transfer) · <strong>unresolved</strong> = no defensible link.
      </p>
      <section>
        <h3 className="tf-display mb-3"><span className="tf-thin text-[20px] text-signal2">Across blockchains</span> <span className="tf-heavy text-[20px]">Bridge movements ({data?.links.length ?? 0})</span></h3>
        {data && data.links.length === 0 && <Empty title="No value-bearing transfers into known bridge contracts in scope" />}
        <div className="space-y-2">
          {data?.links.map((l) => (
            <article key={l.source_tx} className="tf-frame p-3 text-sm">
              <div className="flex flex-wrap items-center gap-3">
                <BridgeGlyph status={l.status} from={l.source_chain} to={l.destination_chain ?? 'unknown'} />
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                <span className={`tf-badge ${STATUS_STYLE[l.status]}`}>{l.status}</span>
                <span className="font-medium">{l.bridge_label}</span>
                <span className="text-faint">{fmtTime(l.source_timestamp)}</span>
                <button className="mono text-signal2" onClick={() => onSelect({ kind: 'node', address: l.sender })}>{short(l.sender)}</button>
                <span className="text-faint">→ {l.destination_chain ?? 'unknown destination'}</span>
                </div>
              </div>
              <p className="mono mt-1 text-xs text-dim">source tx {l.source_tx}</p>
              {l.method && <p className="mt-1 text-xs"><span className="text-faint">Method:</span> {l.method}</p>}
              {l.links.length > 0 && (
                <ul className="mt-2 space-y-1 text-xs">
                  {l.links.map((lk, i) => (
                    <li key={i} className="border border-line bg-elev p-2">
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
        <h3 className="tf-display mb-3"><span className="tf-thin text-[20px] text-ember">Where the trail</span> <span className="tf-heavy text-[20px]">Goes dark ({data?.privacy_gaps.length ?? 0})</span></h3>
        {data && data.privacy_gaps.length === 0 && <Empty title="No deposits into labelled mixers in scope" />}
        {data?.privacy_gaps.map((g) => (
          <article key={g.address} className="mb-2 border border-ember/40 border-l-2 border-l-ember bg-elev p-3 text-sm">
            <p><span className="tf-badge text-faint">unresolved</span> <strong>{g.label}</strong> <span className="mono text-xs">{g.address}</span></p>
            <p className="mt-1 text-xs">{g.deposits} deposit(s) from {g.senders.length} traced address(es): {g.senders.map((s) => (
              <button key={s} className="mono mr-1 text-signal2" onClick={() => onSelect({ kind: 'node', address: s })}>{short(s)}</button>))}</p>
            <p className="mt-1 text-xs text-dim">{g.explanation}</p>
            <button className="tf-btn mt-2 text-xs" onClick={() => onSelect({ kind: 'transfers', ids: g.transfer_ids, title: `Deposits into ${g.label}` })}>View deposit transfers</button>
          </article>
        ))}
      </section>
    </div>
  )
}
