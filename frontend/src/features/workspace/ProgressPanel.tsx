import type { Investigation, ProgressEvent } from '../../lib/types'
import { fmtTime } from '../../lib/format'

const STAGES = ['validate', 'resolve_window', 'resolve_seed', 'acquire', 'normalize', 'osint', 'crosschain', 'score', 'lifecycle']
const LABELS: Record<string, string> = {
  validate: 'Validation & provider selection',
  resolve_window: 'Time window → block range',
  resolve_seed: 'Seed transaction',
  acquire: 'On-chain acquisition',
  normalize: 'Normalisation & storage',
  osint: 'OSINT enrichment',
  crosschain: 'Cross-chain tracing',
  score: 'Metrics & scoring',
  lifecycle: 'Completion',
}

export default function ProgressPanel({ inv, events, onCancel }: { inv: Investigation; events: ProgressEvent[]; onCancel: () => void }) {
  const byStage = new Map<string, ProgressEvent[]>()
  for (const e of events) byStage.set(e.stage, [...(byStage.get(e.stage) ?? []), e])
  const running = inv.status === 'running' || inv.status === 'queued'
  const seen = STAGES.filter((s) => byStage.has(s) || (s !== 'resolve_window' && s !== 'resolve_seed'))
  return (
    <div className="tf-panel p-4" aria-live="polite">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold">Backend progress</h2>
        {running && <button className="tf-btn tf-btn-danger" onClick={onCancel}>Cancel investigation</button>}
      </div>
      <ol className="space-y-2">
        {seen.map((s) => {
          const evs = byStage.get(s) ?? []
          const last = evs[evs.length - 1]
          const state = !last ? 'pending' : last.status
          const color = state === 'completed' ? 'var(--ok)' : state === 'failed' ? 'var(--danger)' : state === 'warning' ? 'var(--hypo)' : state === 'pending' ? 'var(--line-strong)' : 'var(--signal)'
          return (
            <li key={s} className="flex gap-3">
              <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} aria-hidden />
              <div className="min-w-0">
                <p className="text-sm font-medium">{LABELS[s]} <span className="text-xs text-faint">{state}</span></p>
                {evs.slice(-4).map((e) => (
                  <p key={e.seq} className={`text-xs ${e.status === 'warning' || e.status === 'failed' ? 'text-hypo' : 'text-dim'}`}>
                    <span className="text-faint">{fmtTime(e.ts).slice(11)}</span> {e.message}
                  </p>
                ))}
              </div>
            </li>
          )
        })}
      </ol>
      {!running && events.length === 0 && <p className="text-sm text-dim">No progress events recorded.</p>}
    </div>
  )
}
