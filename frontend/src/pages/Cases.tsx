import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { useApi } from '../lib/hooks'
import type { CaseSummary } from '../lib/types'
import { Empty, ErrorBox, Spinner } from '../components/ui'
import { fmtTime } from '../lib/format'
import { PageHead } from '../components/brand'

export default function Cases() {
  const nav = useNavigate()
  const { data, error, loading, reload } = useApi<CaseSummary[]>('/api/cases')
  const [title, setTitle] = useState('')
  const [q, setQ] = useState('')
  const [err, setErr] = useState<unknown>(null)
  const filtered = (data ?? []).filter((c) => c.title.toLowerCase().includes(q.toLowerCase()))

  async function create(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    try {
      const c = await api<CaseSummary>('/api/cases', { method: 'POST', json: { title: title.trim() } })
      nav(`/app/cases/${c.id}`)
    } catch (e2) {
      setErr(e2)
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <PageHead mascot="docket" kicker="Saved investigations" title="Casebook" lede="Each case keeps its investigations, bookmarks, notes and evidence reviews together." />
      <form onSubmit={create} className="tf-frame flex flex-wrap items-end gap-2 p-3">
        <div className="min-w-60 flex-1">
          <label htmlFor="newcase" className="tf-label">New case</label>
          <input id="newcase" className="tf-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Case title" maxLength={200} />
        </div>
        <button className="tf-btn tf-btn-primary" disabled={!title.trim()}>Create case</button>
        <div className="min-w-48">
          <label htmlFor="search" className="tf-label">Search</label>
          <input id="search" className="tf-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by title" />
        </div>
      </form>
      <ErrorBox error={err ?? error} onRetry={reload} />
      {loading && <Spinner />}
      {data && filtered.length === 0 && <Empty title={q ? 'No matching cases' : 'No cases yet'} />}
      <div className="tf-frame overflow-x-auto">
        {filtered.length > 0 && (
          <table className="tf-table">
            <thead>
              <tr><th>Title</th><th>Origin</th><th>Review</th><th>Investigations</th><th>Notes</th><th>Bookmarks</th><th>Updated</th></tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id}>
                  <td><Link className="font-medium hover:text-signal2" to={`/app/cases/${c.id}`}>{c.title}</Link></td>
                  <td>{c.origin === 'historical_case' ? <span className="tf-badge text-hypo">historical</span> : <span className="tf-badge">live</span>}</td>
                  <td>{c.review_state.replace('_', ' ')}</td>
                  <td>{c.investigation_count}</td>
                  <td>{c.note_count}</td>
                  <td>{c.bookmark_count}</td>
                  <td className="whitespace-nowrap text-faint">{fmtTime(c.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
