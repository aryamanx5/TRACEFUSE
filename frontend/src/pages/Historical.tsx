import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { useApi } from '../lib/hooks'
import { ErrorBox, ExtLink, Section, Spinner } from '../components/ui'
import { fmtTime } from '../lib/format'
import { PageHead } from '../components/brand'

interface HistCase {
  key: string
  title: string
  summary: string
  has_dataset: boolean
  time_range: { start: string; end: string }
  collection_method: string
  known_gaps: string[]
  sources: { title: string; publisher: string; url: string; published: string; summary: string }[]
  dataset?: { interactions: number; recorded_at?: string; providers?: string }
}

export default function Historical() {
  const nav = useNavigate()
  const { data, error, loading, reload } = useApi<HistCase[]>('/api/historical-cases')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<unknown>(null)

  async function open(key: string) {
    setBusy(true)
    setErr(null)
    try {
      const r = await api<{ investigation: { id: string } }>(`/api/historical-cases/${key}/open`, { method: 'POST' })
      nav(`/app/investigations/${r.investigation.id}`)
    } catch (e) {
      setErr(e)
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <PageHead mascot="blocky" kicker="Recorded real incident" title="Historical case" lede="A genuine, documented incident. Real public API responses were recorded once and are replayed through the same adapters, analysis and reporting code as live investigations — clearly labelled as historical." />
      {loading && <Spinner />}
      <ErrorBox error={error ?? err} onRetry={reload} />
      {data?.map((c) => (
        <Section key={c.key} title={c.title}>
          <p className="mb-3">{c.summary}</p>
          <dl className="mb-3 grid gap-2 text-sm sm:grid-cols-2">
            <div><dt className="text-faint">Time range</dt><dd>{fmtTime(c.time_range.start)} → {fmtTime(c.time_range.end)}</dd></div>
            <div><dt className="text-faint">Dataset</dt><dd>{c.has_dataset ? `${c.dataset?.interactions} recorded responses · ${c.dataset?.providers ?? ''} · recorded ${fmtTime(c.dataset?.recorded_at)}` : 'not collected'}</dd></div>
          </dl>
          <details className="mb-3 text-sm">
            <summary className="cursor-pointer text-dim">How it was collected &amp; known gaps</summary>
            <p className="mt-2">{c.collection_method}</p>
            <ul className="mt-2 list-disc pl-5 text-dim">{c.known_gaps.map((g) => <li key={g}>{g}</li>)}</ul>
          </details>
          <h3 className="mb-1 text-sm font-semibold">Attributable sources</h3>
          <ul className="mb-4 space-y-1 text-sm">
            {c.sources.map((s) => (
              <li key={s.url}><ExtLink href={s.url}>{s.title}</ExtLink> <span className="text-faint">— {s.publisher}, {s.published.slice(0, 10)}</span></li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <button className="tf-btn tf-btn-primary" disabled={!c.has_dataset || busy} onClick={() => void open(c.key)}>
              {busy ? 'Opening…' : 'Open case in workspace'}
            </button>
            <Link className="tf-btn" to="/app/challenge">Take the investigator challenge</Link>
          </div>
        </Section>
      ))}
    </div>
  )
}
