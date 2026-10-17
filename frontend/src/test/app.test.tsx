import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mockFetch } from './mockFetch'
import Landing from '../pages/Landing'
import NewInvestigation from '../pages/NewInvestigation'
import Cases from '../pages/Cases'
import CaseDetail from '../pages/CaseDetail'
import Challenge from '../pages/Challenge'
import ChronoReplay from '../features/workspace/ChronoReplay'
import MatrixView from '../features/workspace/MatrixView'
import FilterBar from '../features/workspace/FilterBar'
import { ErrorBox } from '../components/ui'
import { ApiError } from '../lib/api'
import { fmtAmount, safeHref, short } from '../lib/format'
import { DEFAULT_FILTER } from '../features/workspace/state'
import type { TimelineResponse } from '../lib/types'

const RONIN = '0x098B716B8Aaf21512996dC57EB0615e2383E2f96'
const chains = [
  { key: 'ethereum', chain_id: 1, name: 'Ethereum Mainnet', native_symbol: 'ETH', ready: true, keyless_live_verified: true, providers: [] },
  { key: 'base', chain_id: 8453, name: 'Base Mainnet', native_symbol: 'ETH', ready: false, keyless_live_verified: false, providers: [] },
]

afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
})

function at(path: string, el: React.ReactNode, route = '*') {
  return render(<MemoryRouter initialEntries={[path]}><Routes><Route path={route} element={el} /><Route path="*" element={<p>navigated</p>} /></Routes></MemoryRouter>)
}

describe('landing page', () => {
  it('renders all five chapters with real destinations', () => {
    at('/', <Landing />, '/')
    expect(screen.getByRole('heading', { level: 1, name: /TRACEFUSE Follow the money\. Find the signal\./ })).toBeInTheDocument()
    for (const h of ['One exploit. Hundreds of paths.', 'The clues exist. They don’t connect.', 'Connect the evidence. Not just the dots.', 'Every connection needs a reason.'])
      expect(screen.getByRole('heading', { level: 2, name: h })).toBeInTheDocument()
    for (const id of ['signal', 'fragmentation', 'disconnected', 'fusion', 'enter']) expect(document.getElementById(id)).not.toBeNull()
    expect(screen.getByRole('link', { name: 'Explore the investigation' })).toHaveAttribute('href', '/app')
    expect(screen.getByRole('link', { name: 'Enter Investigation Room' })).toHaveAttribute('href', '/app')
    for (const l of screen.getAllByRole('link', { name: 'Investigation Room' })) expect(l).toHaveAttribute('href', '/app')
    expect(screen.getByRole('button', { name: 'Replay the story' })).toBeInTheDocument()
    expect(screen.getByText(/Illustrative branching path — not live transaction data/)).toBeInTheDocument()
    expect(screen.getByText('Illustrative diagram.')).toBeInTheDocument()
  })
  it('respects reduced motion: poster only, no scrubbed video', () => {
    // setup.ts matchMedia reports prefers-reduced-motion: reduce
    const { container } = at('/', <Landing />, '/')
    expect(container.querySelector('video')).toBeNull()
    expect(container.querySelector('img.tfl-media')).toHaveAttribute('src', '/media/tracefuse-hero-poster.jpg')
  })
})

describe('intake', () => {
  it('validates input and submits a bounded config', async () => {
    const { calls } = mockFetch([
      { match: /\/api\/meta\/chains/, body: chains },
      { match: /\/api\/cases$/, body: [] },
      { match: /\/api\/validate/, method: 'POST', body: (_u: string, init?: RequestInit) => {
        const seed = JSON.parse(String(init?.body)).seed as string
        return seed.length === 42 ? { valid: true, kind: 'address', chain_ready: true } : { valid: false, error: 'Hex value has 4 digits' }
      } },
      { match: /\/api\/investigations$/, method: 'POST', status: 202, body: { id: 'inv_1' } },
    ])
    const user = userEvent.setup()
    at('/app/new', <NewInvestigation />, '/app/new')
    const input = await screen.findByLabelText(/Seed/)
    await user.type(input, '0x1234')
    expect(await screen.findByText(/Hex value has 4 digits/, {}, { timeout: 2000 })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start investigation' })).toBeDisabled()
    await user.clear(input)
    await user.type(input, RONIN)
    expect(await screen.findByText(/Valid address/, {}, { timeout: 2000 })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Base Mainnet \(unconfigured\)/ })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Start investigation' }))
    await screen.findByText('navigated')
    const post = calls.find((c) => c.url.endsWith('/api/investigations'))!
    const body = JSON.parse(String(post.init?.body))
    expect(body.config.seed).toBe(RONIN)
    expect(body.config.max_hops).toBe(2)
    expect(body.config.osint.ofac).toBe(true)
  })
})

describe('casebook', () => {
  it('lists, creates and filters cases', async () => {
    const { calls } = mockFetch([
      { match: /\/api\/cases$/, method: 'GET', body: [{ id: 'c1', title: 'Ronin', description: '', origin: 'historical_case', review_state: 'open', ui_state: {}, created_at: '2026-01-01', updated_at: '2026-01-01', investigation_count: 1, note_count: 0, bookmark_count: 2 }] },
      { match: /\/api\/cases$/, method: 'POST', status: 201, body: { id: 'c2', title: 'New' } },
    ])
    const user = userEvent.setup()
    at('/app/cases', <Cases />, '/app/cases')
    expect(await screen.findByRole('link', { name: 'Ronin' })).toBeInTheDocument()
    await user.type(screen.getByLabelText('Search'), 'zzz')
    expect(screen.getByText('No matching cases')).toBeInTheDocument()
    await user.type(screen.getByLabelText('New case'), 'New')
    await user.click(screen.getByRole('button', { name: 'Create case' }))
    await screen.findByText('navigated')
    expect(calls.some((c) => c.init?.method === 'POST')).toBe(true)
  })

  it('renames a case, adds a note and deletes with confirmation', async () => {
    let title = 'Old title'
    const notes: { id: string; target_type: string; target_id: null; body: string; created_at: string; updated_at: string }[] = []
    const detail = () => ({ id: 'c1', title, description: 'd', origin: 'live', review_state: 'open', ui_state: {}, created_at: '2026-01-01', updated_at: '2026-01-02',
      investigations: [], notes, bookmarks: [], reviews: [], decisions: [], hypotheses: [] })
    const { calls } = mockFetch([
      { match: /\/api\/cases\/c1$/, method: 'GET', body: () => detail() },
      { match: /\/api\/cases\/c1$/, method: 'PATCH', body: (_u: string, i?: RequestInit) => { title = JSON.parse(String(i?.body)).title; return detail() } },
      { match: /\/api\/cases\/c1\/notes$/, method: 'POST', status: 201, body: (_u: string, i?: RequestInit) => { notes.push({ id: 'n1', target_type: 'case', target_id: null, body: JSON.parse(String(i?.body)).body, created_at: '', updated_at: '' }); return notes[0] } },
      { match: /\/api\/cases\/c1$/, method: 'DELETE', status: 204, body: undefined },
    ])
    const user = userEvent.setup()
    at('/app/cases/c1', <CaseDetail />, '/app/cases/:id')
    await screen.findByRole('heading', { name: 'Old title' })
    await user.click(screen.getByRole('button', { name: 'Rename / edit' }))
    const t = screen.getByLabelText('Title')
    await user.clear(t)
    await user.type(t, 'New title')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('heading', { name: 'New title' })).toBeInTheDocument()
    await user.type(screen.getByLabelText('New note'), 'follow the 500 ETH tranches')
    await user.click(screen.getByRole('button', { name: 'Add' }))
    expect(await screen.findByText('follow the 500 ETH tranches')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Delete case…' }))
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Delete case' }))
    await screen.findByText('navigated')
    expect(calls.some((c) => c.init?.method === 'DELETE')).toBe(true)
  })
})

describe('challenge', () => {
  it('checks answers server-side and reveals explanation only when solved', async () => {
    const base = { id: 'ch', title: 'Ghost Attack', intro: 'intro', case_key: 'ronin-2022', total: 1 }
    const cp = { id: 'c1', title: 'The breach', prompt: 'Which tx?', type: 'tx_hash', choices: null, hints_available: 1, hints: [], attempts: 0, explanation: null, evidence: null }
    mockFetch([
      { match: /\/api\/challenges\/ch$/, body: { ...base, solved: 0, checkpoints: [{ ...cp, solved: false }] } },
      { match: /answer$/, method: 'POST', body: (_u: string, i?: RequestInit) => {
        const ok = JSON.parse(String(i?.body)).answer === '0xabc'
        return { correct: ok, challenge: { ...base, solved: ok ? 1 : 0, checkpoints: [{ ...cp, solved: ok, attempts: 1, explanation: ok ? 'Because evidence.' : null }] } }
      } },
    ])
    const user = userEvent.setup()
    at('/app/challenge/ch', <Challenge />, '/app/challenge/:id')
    await screen.findByText('Which tx?')
    await user.type(screen.getByLabelText('Answer'), '0xwrong')
    await user.click(screen.getByRole('button', { name: 'Check' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/Not quite/)
    await user.clear(screen.getByLabelText('Answer'))
    await user.type(screen.getByLabelText('Answer'), '0xabc')
    await user.click(screen.getByRole('button', { name: 'Check' }))
    expect(await screen.findByText('Because evidence.')).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100')
  })
})

const timeline: TimelineResponse = {
  events: [
    { id: 't1', ts: 100, time: '', tx_hash: '0x1', from: '0xa', to: '0xb', amount: '5', symbol: 'ETH', asset_key: 'native', kind: 'native', explorer_url: '' },
    { id: 't2', ts: 200, time: '', tx_hash: '0x2', from: '0xb', to: '0xc', amount: '4', symbol: 'ETH', asset_key: 'native', kind: 'native', explorer_url: '' },
    { id: 't3', ts: 300, time: '', tx_hash: '0x3', from: '0xc', to: '0xd', amount: '3', symbol: 'ETH', asset_key: 'native', kind: 'native', explorer_url: '' },
  ],
  buckets: [{ start: 100, end: 200, count: 1 }, { start: 200, end: 300, count: 2 }],
  gaps: [],
  missing_timestamps: 1,
  range: { start: 100, end: 300, start_iso: '', end_iso: '' },
}

describe('ChronoReplay', () => {
  it('steps through real events, queries the backend snapshot and sets the analysis window', async () => {
    const { calls } = mockFetch([{ match: /snapshot/, body: { stats: { transfers: 1, nodes: 2, edges: 1, assets: [] }, latest: ['t1'] } }])
    let atVal: number | null = null
    let filter = DEFAULT_FILTER
    const user = userEvent.setup()
    const r = render(<ChronoReplay invId="i" timeline={timeline} filter={filter} setFilter={(f) => { filter = f }} at={atVal} setAt={(t) => { atVal = t }} onSelectTransfer={() => undefined} />)
    expect(screen.getByText(/1 without timestamp/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Next transfer' }))
    expect(atVal).toBe(300)
    atVal = 200
    r.rerender(<ChronoReplay invId="i" timeline={timeline} filter={filter} setFilter={(f) => { filter = f }} at={200} setAt={(t) => { atVal = t }} onSelectTransfer={() => undefined} />)
    expect(screen.getByText(/transfer 2\/3/)).toBeInTheDocument()
    await waitFor(() => expect(calls.some((c) => c.url.includes('snapshot') && c.url.includes('at=200'))).toBe(true))
    expect(await screen.findByText(/At this moment \(calculated by the server\): 1 transfers/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Analyse up to this moment' }))
    expect(filter.end).toBe(200)
    await user.click(screen.getByRole('button', { name: /Play/ }))
    expect(screen.getByRole('button', { name: /Pause/ })).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('Matrix Mode', () => {
  it('renders cells and drills down to underlying transfers', async () => {
    mockFetch([{ match: /matrix/, body: { measure: 'count', asset_key: null, symbol: null, labels: ['0xaaaa000000000000000000000000000000000001', '0xbbbb000000000000000000000000000000000002'],
      cells: [{ row: 0, col: 1, count: 3, raw: null, amount: null, value: 3, transfer_ids: ['a', 'b', 'c'] }], max: 3, min_nonzero: 3, scale: 'linear', legend: 'legend text',
      truncated: { total_nodes: 2, shown: 2, limit: 40, is_truncated: false } } }])
    const onSelect = vi.fn()
    const user = userEvent.setup()
    render(<MatrixView invId="i" filter={DEFAULT_FILTER} assets={[]} selection={null} onSelect={onSelect} />)
    const cell = await screen.findByRole('button', { name: /3 transfer/ })
    await user.click(cell)
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ kind: 'transfers', ids: ['a', 'b', 'c'] }))
    expect(screen.getByText('legend text')).toBeInTheDocument()
  })
  it('shows an honest empty state', async () => {
    mockFetch([{ match: /matrix/, body: { measure: 'count', labels: [], cells: [], max: 0, min_nonzero: 0, scale: 'linear', legend: '', truncated: { total_nodes: 0, shown: 0, limit: 40, is_truncated: false } } }])
    render(<MatrixView invId="i" filter={DEFAULT_FILTER} assets={[]} selection={null} onSelect={() => undefined} />)
    expect(await screen.findByText('No transfers in this window')).toBeInTheDocument()
  })
})

describe('filters and states', () => {
  it('restores hidden nodes from the filter bar', async () => {
    let f = { ...DEFAULT_FILTER, hide: ['0x1111111111111111111111111111111111111111'] }
    const user = userEvent.setup()
    render(<FilterBar filter={f} setFilter={(n) => { f = n }} assets={[{ asset_key: 'native', symbol: 'ETH', recognised: true, raw: '1', amount: '1', count: 1 }]} />)
    await user.click(screen.getByText('Filters'))
    await user.click(screen.getByRole('button', { name: /Show 0x1+ in views again/ }))
    expect(f.hide).toEqual([])
  })
  it('names offline, rate-limited and unconfigured errors honestly', () => {
    const { rerender } = render(<ErrorBox error={new ApiError(0, 'Backend unreachable')} />)
    expect(screen.getByText('Offline')).toBeInTheDocument()
    rerender(<ErrorBox error={new ApiError(429, { kind: 'rate_limited', message: 'HTTP 429' })} />)
    expect(screen.getByText('Rate limited by provider')).toBeInTheDocument()
    rerender(<ErrorBox error={new ApiError(409, { kind: 'unconfigured', message: 'ALCHEMY_API_KEY is not set' })} />)
    expect(screen.getByText('Not configured')).toBeInTheDocument()
  })
  it('formats exact amounts and blocks unsafe links', () => {
    expect(fmtAmount('173600')).toBe('173,600')
    expect(fmtAmount('1.05690000')).toBe('1.0569')
    expect(safeHref('javascript:alert(1)')).toBeUndefined()
    expect(short(RONIN)).toBe('0x098B71…2f96')
  })
})
