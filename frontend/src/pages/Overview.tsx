import { Link } from 'react-router-dom'
import { useApi } from '../lib/hooks'
import type { CaseSummary, ChainInfo } from '../lib/types'
import { Empty, ErrorBox, Section, Spinner } from '../components/ui'
import { fmtTime } from '../lib/format'

export default function Overview() {
  const cases = useApi<CaseSummary[]>('/api/cases')
  const chains = useApi<ChainInfo[]>('/api/meta/chains')
  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Investigation Room</h1>
          <p className="text-dim">Trace real on-chain activity, fuse it with sourced intelligence, and keep every finding explainable.</p>
        </div>
        <div className="flex gap-2">
          <Link to="/app/new" className="tf-btn tf-btn-primary">New investigation</Link>
          <Link to="/app/historical" className="tf-btn">Open historical case</Link>
        </div>
      </header>
      <div className="grid gap-4 md:grid-cols-3">
        <div className="md:col-span-2">
          <Section title="Recent cases" actions={<Link className="text-sm text-signal2" to="/app/cases">All cases →</Link>}>
            {cases.loading && <Spinner />}
            <ErrorBox error={cases.error} onRetry={cases.reload} />
            {cases.data && cases.data.length === 0 && (
              <Empty title="No cases yet">Start an investigation or open the historical Ronin case.</Empty>
            )}
            <ul className="divide-y divide-line">
              {cases.data?.slice(0, 8).map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <Link to={`/app/cases/${c.id}`} className="font-medium hover:text-signal2">{c.title}</Link>
                    <p className="text-xs text-faint">
                      {c.origin === 'historical_case' ? 'Historical (recorded) · ' : 'Live · '}
                      {c.investigation_count ?? 0} investigation(s) · updated {fmtTime(c.updated_at)}
                    </p>
                  </div>
                  <span className="tf-badge">{c.review_state.replace('_', ' ')}</span>
                </li>
              ))}
            </ul>
          </Section>
        </div>
        <Section title="Chain readiness" actions={<Link className="text-sm text-signal2" to="/app/status">Details →</Link>}>
          {chains.loading && <Spinner />}
          <ErrorBox error={chains.error} onRetry={chains.reload} />
          <ul className="space-y-2 text-sm">
            {chains.data?.map((c) => (
              <li key={c.key} className="flex items-center justify-between">
                <span>{c.name}</span>
                <span className={`tf-badge ${c.ready ? 'text-ok' : 'text-danger'}`}>
                  {c.ready ? (c.keyless_live_verified ? 'ready · keyless' : 'configured') : 'unconfigured'}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      </div>
    </div>
  )
}
