import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../lib/api'
import { useApi, useDebounced } from '../lib/hooks'
import type { CaseSummary, ChainInfo, Investigation } from '../lib/types'
import { ErrorBox } from '../components/ui'
import { PageHead } from '../components/brand'

interface Validation {
  valid: boolean
  kind?: string
  error?: string
  warning?: string | null
  chain_ready?: boolean
}

const DRAFT_KEY = 'tf-intake-draft'

export default function NewInvestigation() {
  const nav = useNavigate()
  const [params] = useSearchParams()
  const chains = useApi<ChainInfo[]>('/api/meta/chains')
  const cases = useApi<CaseSummary[]>('/api/cases')
  const draft = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem(DRAFT_KEY) ?? '{}') as Record<string, unknown>
    } catch {
      return {}
    }
  }, [])
  const [seed, setSeed] = useState<string>((params.get('seed') ?? (draft.seed as string)) || '')
  const [chain, setChain] = useState<string>((draft.chain as string) || 'ethereum')
  const [direction, setDirection] = useState<'forward' | 'backward' | 'both'>((draft.direction as 'forward') || 'forward')
  const [hops, setHops] = useState<number>((draft.hops as number) || 2)
  const [branching, setBranching] = useState<number>((draft.branching as number) || 6)
  const [perAddress, setPerAddress] = useState<number>((draft.perAddress as number) || 1000)
  const [start, setStart] = useState<string>((draft.start as string) || '')
  const [end, setEnd] = useState<string>((draft.end as string) || '')
  const [tokens, setTokens] = useState(true)
  const [internal, setInternal] = useState(true)
  const [osint, setOsint] = useState({ ofac: true, goplus: true, github: true, blockscout_labels: true })
  const [cross, setCross] = useState(true)
  const [caseId, setCaseId] = useState<string>(params.get('case') ?? '')
  const [caseTitle, setCaseTitle] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [validationState, setValidationState] = useState<{ key: string; v: Validation } | null>(null)
  const dSeed = useDebounced(seed.trim(), 350)

  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ seed, chain, direction, hops, branching, perAddress, start, end }))
    } catch {
      /* storage unavailable */
    }
  }, [seed, chain, direction, hops, branching, perAddress, start, end])

  useEffect(() => {
    if (!dSeed) return
    let alive = true
    api<Validation>('/api/validate', { method: 'POST', json: { seed: dSeed, chain } })
      .then((v) => alive && setValidationState({ key: `${dSeed}|${chain}`, v }))
      .catch((e) => alive && setError(e))
    return () => {
      alive = false
    }
  }, [dSeed, chain])
  // only show a verdict for the exact input currently typed (derived — no reset needed)
  const validation = validationState && validationState.key === `${seed.trim()}|${chain}` ? validationState.v : null

  const windowError = start && end && new Date(start) >= new Date(end) ? 'Start must be before end.' : null
  const canSubmit = !!validation?.valid && !windowError && !submitting

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setSubmitting(true)
    setError(null)
    try {
      const inv = await api<Investigation>('/api/investigations', {
        method: 'POST',
        json: {
          case_id: caseId || null,
          case_title: caseTitle || null,
          config: {
            seed: seed.trim(),
            chain,
            direction,
            max_hops: hops,
            max_branching: branching,
            max_transfers_per_address: perAddress,
            time_start: start ? new Date(start + 'Z').toISOString() : null,
            time_end: end ? new Date(end + 'Z').toISOString() : null,
            include_tokens: tokens,
            include_internal: internal,
            osint,
            crosschain: { enabled: cross, target_chains: chains.data?.filter((c) => c.key !== chain && c.ready).map((c) => c.key) ?? [] },
          },
        },
      })
      try {
        localStorage.removeItem(DRAFT_KEY)
      } catch {
        /* ignore */
      }
      nav(`/app/investigations/${inv.id}`)
    } catch (err) {
      setError(err)
      setSubmitting(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-5"><PageHead mascot="hexo" kicker="Start a trace" title="New investigation" lede="Enter a wallet address or transaction hash. The trace is bounded on the server, and every record keeps its provider provenance." /></div>
      <form onSubmit={submit} className="tf-frame space-y-5 p-5" noValidate>
        <div>
          <label htmlFor="seed" className="tf-label">Seed — address (0x + 40 hex) or transaction hash (0x + 64 hex)</label>
          <input id="seed" className="tf-input mono" value={seed} onChange={(e) => setSeed(e.target.value)} autoComplete="off"
            spellCheck={false} placeholder="0x098B716B8Aaf21512996dC57EB0615e2383E2f96" aria-describedby="seed-help" aria-invalid={validation?.valid === false} />
          <p id="seed-help" className="mt-1 text-xs" aria-live="polite">
            {validation?.valid && <span className="text-ok">✓ Valid {validation.kind === 'tx_hash' ? 'transaction hash' : 'address'}</span>}
            {validation?.valid === false && <span className="text-danger">{validation.error}</span>}
            {validation?.warning && <span className="block text-hypo">{validation.warning}</span>}
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label htmlFor="chain" className="tf-label">Chain</label>
            <select id="chain" className="tf-select" value={chain} onChange={(e) => setChain(e.target.value)}>
              {chains.data?.map((c) => (
                <option key={c.key} value={c.key} disabled={!c.ready}>
                  {c.name}{c.ready ? '' : ' (unconfigured)'}
                </option>
              )) ?? <option value="ethereum">Ethereum Mainnet</option>}
            </select>
          </div>
          <div>
            <label htmlFor="direction" className="tf-label">Direction</label>
            <select id="direction" className="tf-select" value={direction} onChange={(e) => setDirection(e.target.value as 'forward')}>
              <option value="forward">Forward (where funds went)</option>
              <option value="backward">Backward (where funds came from)</option>
              <option value="both">Both</option>
            </select>
          </div>
          <div>
            <label htmlFor="hops" className="tf-label">Hop depth: {hops}</label>
            <input id="hops" type="range" min={1} max={4} value={hops} onChange={(e) => setHops(Number(e.target.value))} className="w-full" />
          </div>
          <div>
            <label htmlFor="branch" className="tf-label">Branches per address: {branching}</label>
            <input id="branch" type="range" min={1} max={20} value={branching} onChange={(e) => setBranching(Number(e.target.value))} className="w-full" />
          </div>
          <div>
            <label htmlFor="cap" className="tf-label">Records per address</label>
            <select id="cap" className="tf-select" value={perAddress} onChange={(e) => setPerAddress(Number(e.target.value))}>
              {[250, 500, 1000, 2000, 5000].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
        </div>
        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="tf-label">Time window (UTC, optional)</legend>
          <div>
            <label htmlFor="start" className="tf-label">From</label>
            <input id="start" type="datetime-local" className="tf-input" value={start} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div>
            <label htmlFor="end" className="tf-label">To</label>
            <input id="end" type="datetime-local" className="tf-input" value={end} onChange={(e) => setEnd(e.target.value)} />
          </div>
          {windowError && <p className="text-sm text-danger sm:col-span-2" role="alert">{windowError}</p>}
        </fieldset>
        <fieldset className="grid gap-2 sm:grid-cols-2">
          <legend className="tf-label">Data &amp; enrichment</legend>
          <Check label="ERC-20 token transfers" v={tokens} set={setTokens} />
          <Check label="Internal (trace) value transfers" v={internal} set={setInternal} />
          <Check label="OFAC SDN matching (local official dataset)" v={osint.ofac} set={(v) => setOsint({ ...osint, ofac: v })} />
          <Check label="Explorer labels (Blockscout metadata)" v={osint.blockscout_labels} set={(v) => setOsint({ ...osint, blockscout_labels: v })} />
          <Check label="GoPlus malicious-address flags" v={osint.goplus} set={(v) => setOsint({ ...osint, goplus: v })} />
          <Check label="GitHub public mentions (rate-limited)" v={osint.github} set={(v) => setOsint({ ...osint, github: v })} />
          <Check label="Cross-chain bridge tracing" v={cross} set={setCross} />
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="case" className="tf-label">Attach to case</label>
            <select id="case" className="tf-select" value={caseId} onChange={(e) => setCaseId(e.target.value)}>
              <option value="">Create a new case</option>
              {cases.data?.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
          </div>
          {!caseId && (
            <div>
              <label htmlFor="ctitle" className="tf-label">New case title (optional)</label>
              <input id="ctitle" className="tf-input" value={caseTitle} onChange={(e) => setCaseTitle(e.target.value)} maxLength={200} />
            </div>
          )}
        </div>
        <ErrorBox error={error} />
        <div className="flex items-center justify-end gap-2">
          <button type="submit" className="tf-btn tf-btn-primary" disabled={!canSubmit}>
            {submitting ? 'Starting…' : 'Start investigation'}
          </button>
        </div>
      </form>
    </div>
  )
}

function Check({ label, v, set }: { label: string; v: boolean; set: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={v} onChange={(e) => set(e.target.checked)} className="accent-[var(--signal)]" />
      {label}
    </label>
  )
}
