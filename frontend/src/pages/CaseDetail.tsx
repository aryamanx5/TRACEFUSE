import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, apiUrl } from '../lib/api'
import { useApi } from '../lib/hooks'
import type { CaseDetail as CaseT } from '../lib/types'
import { Dialog, ErrorBox, Section, Spinner, Toast } from '../components/ui'
import { fmtTime, short } from '../lib/format'

export default function CaseDetail() {
  const { id } = useParams()
  const nav = useNavigate()
  const { data: c, error, loading, reload } = useApi<CaseT>(id ? `/api/cases/${id}` : null)
  const [toast, setToast] = useState<string | null>(null)
  const [err, setErr] = useState<unknown>(null)
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState('')
  const [desc, setDesc] = useState('')
  const [note, setNote] = useState('')
  const [decision, setDecision] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)

  async function act(fn: () => Promise<unknown>, msg: string) {
    setErr(null)
    try {
      await fn()
      setToast(msg)
      await reload()
    } catch (e) {
      setErr(e)
    }
  }

  if (loading && !c) return <Spinner />
  if (error) return <ErrorBox error={error} onRetry={reload} />
  if (!c) return null
  const latest = c.investigations[0]

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {editing ? (
            <form
              className="space-y-2"
              onSubmit={(e) => {
                e.preventDefault()
                void act(() => api(`/api/cases/${c.id}`, { method: 'PATCH', json: { title, description: desc } }), 'Case saved').then(() => setEditing(false))
              }}
            >
              <label className="tf-label" htmlFor="ct">Title</label>
              <input id="ct" className="tf-input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required />
              <label className="tf-label" htmlFor="cd">Description</label>
              <textarea id="cd" className="tf-textarea" rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} />
              <div className="flex gap-2"><button className="tf-btn tf-btn-primary">Save</button><button type="button" className="tf-btn" onClick={() => setEditing(false)}>Cancel</button></div>
            </form>
          ) : (
            <>
              <h1 className="text-2xl font-semibold">{c.title}</h1>
              <p className="max-w-2xl text-dim">{c.description || 'No description.'}</p>
              <p className="mt-1 text-xs text-faint">
                {c.origin === 'historical_case' ? 'Historical case — recorded public data, replayed' : 'Live case'} · created {fmtTime(c.created_at)} · updated {fmtTime(c.updated_at)}
              </p>
            </>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {!editing && <button className="tf-btn" onClick={() => { setTitle(c.title); setDesc(c.description); setEditing(true) }}>Rename / edit</button>}
          <label className="sr-only" htmlFor="rs">Review state</label>
          <select id="rs" className="tf-select w-auto" value={c.review_state}
            onChange={(e) => void act(() => api(`/api/cases/${c.id}`, { method: 'PATCH', json: { review_state: e.target.value } }), 'Review state updated')}>
            <option value="open">Open</option><option value="in_review">In review</option><option value="closed">Closed</option>
          </select>
          {latest && <a className="tf-btn" href={apiUrl(`/api/cases/${c.id}/report.html?download=true`)}>Download case report</a>}
          <button className="tf-btn tf-btn-danger" onClick={() => setConfirmDelete(true)}>Delete case…</button>
        </div>
      </header>
      <ErrorBox error={err} />

      <Section title="Investigations" actions={<Link className="tf-btn" to={`/app/new?case=${c.id}`}>Add investigation</Link>}>
        {c.investigations.length === 0 ? <p className="text-dim">No investigations yet.</p> : (
          <table className="tf-table">
            <thead><tr><th>Seed</th><th>Chain</th><th>Status</th><th>Origin</th><th>Created</th><th /></tr></thead>
            <tbody>
              {c.investigations.map((i) => (
                <tr key={i.id}>
                  <td className="mono">{short(i.seed_value, 8)}</td><td>{i.chain}</td><td>{i.status}</td>
                  <td>{i.data_origin === 'historical_case' ? 'historical' : 'live'}</td><td className="text-faint">{fmtTime(i.created_at)}</td>
                  <td><Link className="text-signal2" to={`/app/investigations/${i.id}`}>Open workspace →</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <div className="grid gap-4 md:grid-cols-2">
        <Section title={`Notes (${c.notes.length})`}>
          <form className="mb-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (note.trim()) void act(() => api(`/api/cases/${c.id}/notes`, { method: 'POST', json: { target_type: 'case', body: note } }), 'Note added').then(() => setNote('')) }}>
            <label htmlFor="note" className="sr-only">New note</label>
            <input id="note" className="tf-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a case note" maxLength={10000} />
            <button className="tf-btn" disabled={!note.trim()}>Add</button>
          </form>
          <ul className="space-y-2">
            {c.notes.map((n) => (
              <li key={n.id} className="rounded-md border border-line p-2 text-sm">
                <p className="text-xs text-faint">{n.target_type}{n.target_id ? ` · ${short(n.target_id, 8)}` : ''} · {fmtTime(n.updated_at)}</p>
                <p className="whitespace-pre-wrap">{n.body}</p>
                <button className="mt-1 text-xs text-danger hover:underline" aria-label="Delete note" onClick={() => void act(() => api(`/api/cases/${c.id}/notes/${n.id}`, { method: 'DELETE' }), 'Note deleted')}>Delete</button>
              </li>
            ))}
          </ul>
        </Section>
        <Section title={`Bookmarks (${c.bookmarks.length})`}>
          {c.bookmarks.length === 0 && <p className="text-sm text-dim">Bookmark wallets, edges or evidence from the workspace inspector.</p>}
          <ul className="space-y-1 text-sm">
            {c.bookmarks.map((b) => (
              <li key={b.id} className="flex items-center justify-between gap-2">
                <span><span className="tf-badge mr-2">{b.target_type}</span><span className="mono">{short(b.target_id, 10)}</span> {b.label && <span className="text-dim">— {b.label}</span>}</span>
                <button className="text-xs text-danger hover:underline" aria-label={`Remove bookmark ${b.target_id}`} onClick={() => void act(() => api(`/api/cases/${c.id}/bookmarks/${b.id}`, { method: 'DELETE' }), 'Bookmark removed')}>Remove</button>
              </li>
            ))}
          </ul>
        </Section>
        <Section title={`Decisions (${c.decisions.length})`}>
          <form className="mb-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (decision.trim()) void act(() => api(`/api/cases/${c.id}/decisions`, { method: 'POST', json: { body: decision } }), 'Decision recorded').then(() => setDecision('')) }}>
            <label htmlFor="dec" className="sr-only">New decision</label>
            <input id="dec" className="tf-input" value={decision} onChange={(e) => setDecision(e.target.value)} placeholder="Record an investigative decision" />
            <button className="tf-btn" disabled={!decision.trim()}>Record</button>
          </form>
          <ul className="space-y-1 text-sm">{c.decisions.map((d) => <li key={d.id}>• {d.body} <span className="text-xs text-faint">{fmtTime(d.created_at)}</span></li>)}</ul>
        </Section>
        <Section title={`Evidence reviews & hypotheses`}>
          <ul className="space-y-1 text-sm">
            {c.reviews.map((r) => <li key={r.evidence_id}><span className="tf-badge mr-2">{r.state}</span><span className="mono">{r.evidence_id}</span> {r.note}</li>)}
            {c.hypotheses.map((h) => <li key={h.id}><span className="tf-badge status-analyst_hypothesis mr-2">hypothesis</span>{short(h.source_entity, 10)} → {short(h.target_entity, 10)}: {h.relation} — <span className="text-dim">{h.rationale}</span></li>)}
            {c.reviews.length + c.hypotheses.length === 0 && <li className="text-dim">Mark evidence reviewed or add analyst hypotheses from the workspace.</li>}
          </ul>
        </Section>
      </div>

      <Dialog open={confirmDelete} title="Delete case?" onClose={() => setConfirmDelete(false)}>
        <p className="mb-4 text-sm text-dim">This permanently deletes the case, its investigations, notes, bookmarks and reviews from this TRACEFUSE database.</p>
        <div className="flex justify-end gap-2">
          <button className="tf-btn" onClick={() => setConfirmDelete(false)}>Cancel</button>
          <button className="tf-btn tf-btn-danger" onClick={() => void api(`/api/cases/${c.id}`, { method: 'DELETE' }).then(() => nav('/app/cases')).catch(setErr)}>Delete case</button>
        </div>
      </Dialog>
      <Toast message={toast} onDone={() => setToast(null)} />
    </div>
  )
}
