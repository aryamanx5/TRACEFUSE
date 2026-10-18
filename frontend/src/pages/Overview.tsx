import { Link } from 'react-router-dom'
import { useApi } from '../lib/hooks'
import type { CaseSummary, ChainInfo } from '../lib/types'
import { Empty, ErrorBox, Section, Spinner } from '../components/ui'
import { PageHead } from '../components/brand'
import type { CharacterKind } from '../components/cast'
import { Character } from '../components/characters'
import { fmtTime } from '../lib/format'

const DOORS: { to: string; sigil: CharacterKind; thin: string; heavy: string; text: string; tone: string }[] = [
  { to: '/app/new', sigil: 'hexo', thin: 'Start from', heavy: 'A wallet or tx', text: 'Paste an address or transaction hash and trace it live across supported chains.', tone: 'var(--signal)' },
  { to: '/app/historical', sigil: 'blocky', thin: 'Replay', heavy: 'The Ronin case', text: 'The 2022 Ronin Bridge exploit, from recorded real provider responses.', tone: 'var(--ember)' },
  { to: '/app/challenge', sigil: 'knot', thin: 'Test yourself', heavy: 'Ghost Attack', text: 'Find the laundering route in a recorded case; answers are checked by the server.', tone: 'var(--intel)' },
]

export default function Overview() {
  const cases = useApi<CaseSummary[]>('/api/cases')
  const chains = useApi<ChainInfo[]>('/api/meta/chains')
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHead mascot="snoop" kicker="Forensics × open-source intelligence" title="Investigation Room"
        lede="Trace real on-chain activity, connect it with sourced public intelligence, and keep every finding explainable."
        actions={<>
          <Link to="/app/new" className="tf-btn tf-btn-primary">New investigation</Link>
          <Link to="/app/historical" className="tf-btn">Open historical case</Link>
        </>} />

      <ul className="grid gap-4 md:grid-cols-3" aria-label="Ways to begin">
        {DOORS.map((d, i) => (
          <li key={d.to}>
            <Link to={d.to} className="tf-door group" style={{ '--tone': d.tone } as React.CSSProperties} data-index={String(i + 1).padStart(2, '0')}>
              <span className="tf-door-sigil" aria-hidden><Character kind={d.sigil} size={76} pop delay={0.1 + i * 0.12} /></span>
              <span className="tf-display block">
                <span className="tf-thin text-[22px]" style={{ color: d.tone }}>{d.thin}</span>
                <span className="tf-heavy text-[24px]">{d.heavy}</span>
              </span>
              <span className="mt-2 block text-sm text-dim">{d.text}</span>
              <span className="tf-door-go" aria-hidden>→</span>
            </Link>
          </li>
        ))}
      </ul>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Section title="Recent cases" actions={<Link className="text-sm text-signal2" to="/app/cases">All cases →</Link>}>
            {cases.loading && <Spinner />}
            <ErrorBox error={cases.error} onRetry={cases.reload} />
            {cases.data && cases.data.length === 0 && (
              <Empty title="No cases yet">Start an investigation or open the historical Ronin case.</Empty>
            )}
            <ul className="divide-y divide-line">
              {cases.data?.slice(0, 8).map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <Link to={`/app/cases/${c.id}`} className="font-semibold hover:text-signal">{c.title}</Link>
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
              <li key={c.key} className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <span className="inline-block h-2 w-2" style={{ background: c.ready ? 'var(--ok)' : 'var(--danger)' }} aria-hidden />{c.name}
                </span>
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
