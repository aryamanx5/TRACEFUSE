import { useState } from 'react'
import { api } from '../lib/api'
import { useApi } from '../lib/hooks'
import type { ChainInfo } from '../lib/types'
import { ErrorBox, ExtLink, Section, Spinner } from '../components/ui'
import { fmtTime } from '../lib/format'

interface ProvidersResp {
  offline_mode?: boolean
  credentials: Record<string, boolean>
  health: Record<string, { calls: number; cache_hits: number; errors: number; rate_limited: number; last_success_at: string | null; last_error_kind: string | null; last_error_message: string | null; rate_limit_remaining: string | null }>
  cache: Record<string, { entries: number; newest: string }>
  sources: Record<string, Record<string, unknown>>
}

export default function Status() {
  const prov = useApi<ProvidersResp>('/api/meta/providers')
  const chains = useApi<ChainInfo[]>('/api/meta/chains')
  const [checks, setChecks] = useState<{ source: string; ok: boolean; kind?: string; message?: string; ms?: number }[] | null>(null)
  const [checking, setChecking] = useState(false)
  const [err, setErr] = useState<unknown>(null)
  const [refreshing, setRefreshing] = useState(false)
  const ofac = prov.data?.sources.ofac as { sdn_dataset?: { publish_date: string; retrieved_at: string; sha256: string; address_count: number; source_url: string }; recent_action_sources?: { url: string; action_date: string; addresses: number }[] } | undefined

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <h1 className="text-2xl font-semibold">Sources &amp; health</h1>
      <ErrorBox error={prov.error ?? chains.error ?? err} onRetry={prov.reload} />
      {prov.data?.offline_mode && (
        <p role="status" className="rounded-md border border-hypo/50 bg-hypo/10 p-2 text-sm">
          Offline mode (TRACEFUSE_OFFLINE=1): live providers are disabled. Historical cases still replay recorded data.
        </p>
      )}
      <Section title="Credentials (presence only — values never leave the server)">
        {prov.loading && <Spinner />}
        <ul className="grid gap-2 sm:grid-cols-2">
          {Object.entries(prov.data?.credentials ?? {}).map(([k, v]) => (
            <li key={k} className="flex justify-between text-sm"><span className="mono">{k}</span><span className={`tf-badge ${v ? 'text-ok' : 'text-faint'}`}>{v ? 'configured' : 'unconfigured'}</span></li>
          ))}
        </ul>
      </Section>
      <Section title="Chains & providers">
        <table className="tf-table">
          <thead><tr><th>Chain</th><th>Providers</th><th>Status</th></tr></thead>
          <tbody>
            {chains.data?.map((c) => (
              <tr key={c.key}>
                <td>{c.name} <span className="text-faint">({c.chain_id})</span></td>
                <td className="space-y-0.5">
                  {c.providers.filter((p) => p.supports_chain).map((p) => (
                    <div key={p.provider} className="text-xs">
                      <span className={p.configured ? 'text-ok' : 'text-faint'}>{p.provider}</span>
                      {!p.configured && p.credential && <span className="text-faint"> — needs {p.credential}</span>}
                      {p.note && <span className="text-hypo"> — {p.note}</span>}
                    </div>
                  ))}
                </td>
                <td>{c.ready ? <span className="text-ok">ready</span> : <span className="text-danger">unconfigured</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
      <Section title="Live provider probe" actions={
        <button className="tf-btn" disabled={checking} onClick={async () => { setChecking(true); try { setChecks(await api('/api/meta/providers/check', { method: 'POST' })); await prov.reload() } catch (e) { setErr(e) } finally { setChecking(false) } }}>
          {checking ? 'Checking…' : 'Run live check'}
        </button>}>
        {!checks && <p className="text-sm text-dim">Sends one minimal request to each configured source.</p>}
        <ul className="space-y-1 text-sm">
          {checks?.map((c) => <li key={c.source}><span className={c.ok ? 'text-ok' : 'text-danger'}>{c.ok ? '●' : '●'}</span> <span className="mono">{c.source}</span> {c.ok ? `${c.ms ?? ''}${c.ms ? ' ms' : ''}` : `${c.kind}: ${c.message}`}</li>)}
        </ul>
      </Section>
      <Section title="Observed provider health (since server start)">
        <table className="tf-table">
          <thead><tr><th>Provider</th><th>Calls</th><th>Cache hits</th><th>Errors</th><th>Rate-limited</th><th>Remaining</th><th>Last success</th><th>Last error</th></tr></thead>
          <tbody>
            {Object.entries(prov.data?.health ?? {}).map(([k, h]) => (
              <tr key={k}><td>{k}</td><td>{h.calls}</td><td>{h.cache_hits}</td><td>{h.errors}</td><td>{h.rate_limited}</td><td>{h.rate_limit_remaining ?? '—'}</td>
                <td className="text-faint">{fmtTime(h.last_success_at)}</td><td className="text-danger">{h.last_error_kind ? `${h.last_error_kind}: ${h.last_error_message}` : ''}</td></tr>
            ))}
          </tbody>
        </table>
        {Object.keys(prov.data?.health ?? {}).length === 0 && <p className="text-sm text-dim">No provider calls yet in this server session.</p>}
      </Section>
      <Section title="OFAC dataset" actions={
        <button className="tf-btn" disabled={refreshing} onClick={async () => { setRefreshing(true); setErr(null); try { await api('/api/intel/ofac/refresh', { method: 'POST' }); await prov.reload() } catch (e) { setErr(e) } finally { setRefreshing(false) } }}>
          {refreshing ? 'Downloading official list…' : 'Refresh from Treasury'}
        </button>}>
        {ofac?.sdn_dataset ? (
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div><dt className="text-faint">Published</dt><dd>{ofac.sdn_dataset.publish_date}</dd></div>
            <div><dt className="text-faint">Retrieved</dt><dd>{fmtTime(ofac.sdn_dataset.retrieved_at)}</dd></div>
            <div><dt className="text-faint">Digital-currency identifiers</dt><dd>{ofac.sdn_dataset.address_count}</dd></div>
            <div><dt className="text-faint">SHA-256</dt><dd className="mono break-hash">{ofac.sdn_dataset.sha256}</dd></div>
            <div className="sm:col-span-2"><dt className="text-faint">Source</dt><dd className="break-hash">{ofac.sdn_dataset.source_url}</dd></div>
          </dl>
        ) : <p className="text-sm text-danger">No OFAC dataset imported.</p>}
        <h3 className="mt-3 text-sm font-semibold">Designation / removal notices</h3>
        <ul className="text-sm">{ofac?.recent_action_sources?.map((a) => <li key={a.url}><ExtLink href={a.url}>{a.action_date}</ExtLink> <span className="text-faint">· {a.addresses} identifiers</span></li>)}</ul>
      </Section>
    </div>
  )
}
