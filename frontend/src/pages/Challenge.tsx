import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, sessionId } from '../lib/api'
import { useApi } from '../lib/hooks'
import type { ChallengeView } from '../lib/types'
import { ErrorBox, ExtLink, Section, Spinner } from '../components/ui'

export default function Challenge() {
  const { id } = useParams()
  const nav = useNavigate()
  const list = useApi<{ id: string; title: string; case_key: string; checkpoints: number }[]>('/api/challenges')
  useEffect(() => {
    if (!id && list.data?.length) nav(`/app/challenge/${list.data[0].id}`, { replace: true })
  }, [id, list.data, nav])
  if (!id) return list.error ? <ErrorBox error={list.error} /> : <Spinner />
  return <ChallengeRun id={id} />
}

function ChallengeRun({ id }: { id: string }) {
  const headers = { 'X-Session-Id': sessionId() }
  const [view, setView] = useState<ChallengeView | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [feedback, setFeedback] = useState<Record<string, 'correct' | 'wrong'>>({})
  const [openingCase, setOpeningCase] = useState(false)
  const nav = useNavigate()

  useEffect(() => {
    api<ChallengeView>(`/api/challenges/${id}`, { headers }).then(setView).catch(setError)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  async function submit(cp: string) {
    const answer = (answers[cp] ?? '').trim()
    if (!answer) return
    try {
      const r = await api<{ correct: boolean; challenge: ChallengeView }>(`/api/challenges/${id}/checkpoints/${cp}/answer`, { method: 'POST', headers, json: { answer } })
      setView(r.challenge)
      setFeedback({ ...feedback, [cp]: r.correct ? 'correct' : 'wrong' })
    } catch (e) {
      setError(e)
    }
  }
  async function hint(cp: string) {
    try {
      setView(await api<ChallengeView>(`/api/challenges/${id}/checkpoints/${cp}/hint`, { method: 'POST', headers }))
    } catch (e) {
      setError(e)
    }
  }
  async function reset() {
    setView(await api<ChallengeView>(`/api/challenges/${id}/reset`, { method: 'POST', headers }))
    setFeedback({})
    setAnswers({})
  }
  async function openCase() {
    if (!view) return
    setOpeningCase(true)
    try {
      const r = await api<{ investigation: { id: string } }>(`/api/historical-cases/${view.case_key}/open`, { method: 'POST' })
      nav(`/app/investigations/${r.investigation.id}`)
    } catch (e) {
      setError(e)
      setOpeningCase(false)
    }
  }

  if (error) return <ErrorBox error={error} />
  if (!view) return <Spinner />
  const pct = Math.round((view.solved / view.total) * 100)
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{view.title}</h1>
          <p className="max-w-2xl text-dim">{view.intro}</p>
        </div>
        <div className="flex gap-2">
          <button className="tf-btn tf-btn-primary" onClick={() => void openCase()} disabled={openingCase}>{openingCase ? 'Opening…' : 'Open the case workspace'}</button>
          <button className="tf-btn" onClick={() => void reset()}>Reset progress</button>
        </div>
      </header>
      <div>
        <div className="mb-1 flex justify-between text-sm"><span>Progress</span><span>{view.solved}/{view.total} checkpoints</span></div>
        <div className="h-2 overflow-hidden rounded-full bg-panel2" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Challenge progress">
          <div className="h-full bg-gradient-to-r from-signal to-intel" style={{ width: `${pct}%` }} />
        </div>
      </div>
      {view.checkpoints.map((cp, i) => (
        <Section key={cp.id} title={`${i + 1}. ${cp.title}${cp.solved ? ' ✓' : ''}`}>
          <p className="mb-3">{cp.prompt}</p>
          {!cp.solved && (
            <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); void submit(cp.id) }}>
              {cp.type === 'choice' && cp.choices ? (
                <fieldset className="w-full space-y-1">
                  <legend className="sr-only">{cp.title}: choose one answer</legend>
                  {cp.choices.map((c) => (
                    <label key={c} className="flex items-center gap-2 text-sm">
                      <input type="radio" name={cp.id} value={c} checked={answers[cp.id] === c} onChange={() => setAnswers({ ...answers, [cp.id]: c })} />
                      {c}
                    </label>
                  ))}
                </fieldset>
              ) : (
                <>
                  <label htmlFor={`a-${cp.id}`} className="sr-only">Answer</label>
                  <input id={`a-${cp.id}`} className="tf-input mono flex-1" value={answers[cp.id] ?? ''} maxLength={300}
                    onChange={(e) => setAnswers({ ...answers, [cp.id]: e.target.value })} placeholder={cp.type === 'number' ? 'number' : cp.type === 'tx_hash' ? '0x… (64 hex)' : cp.type === 'address' ? '0x… (40 hex)' : 'answer'} />
                </>
              )}
              <button className="tf-btn tf-btn-primary">Check</button>
              <button type="button" className="tf-btn" onClick={() => void hint(cp.id)} disabled={cp.hints.length >= cp.hints_available}>
                Hint ({cp.hints.length}/{cp.hints_available})
              </button>
            </form>
          )}
          {feedback[cp.id] === 'wrong' && !cp.solved && <p role="alert" className="mt-2 text-sm text-danger">Not quite — inspect the evidence and try again ({cp.attempts} attempt{cp.attempts === 1 ? '' : 's'}).</p>}
          {cp.hints.length > 0 && <ul className="mt-2 list-disc pl-5 text-sm text-dim">{cp.hints.map((h) => <li key={h}>{h}</li>)}</ul>}
          {cp.solved && (
            <div className="mt-2 rounded-md border border-ok/40 bg-ok/10 p-3 text-sm">
              <p className="font-medium text-ok">Correct.</p>
              <p>{cp.explanation}</p>
              {cp.evidence && cp.evidence.length > 0 && <ul className="mt-1">{cp.evidence.map((u) => <li key={u}><ExtLink href={u}>{u}</ExtLink></li>)}</ul>}
            </div>
          )}
        </Section>
      ))}
      <p className="text-xs text-faint">Answers are checked server-side against prepared, sourced labels for this case. <Link to="/app/historical" className="text-signal2">About the dataset</Link></p>
    </div>
  )
}
