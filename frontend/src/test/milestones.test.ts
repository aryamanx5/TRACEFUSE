import { buildMilestones } from '../features/workspace/milestones'
import type { TimelineEvent, TimelineResponse } from '../lib/types'

const ev = (id: string, ts: number, amount: string, symbol = 'ETH'): TimelineEvent => ({
  id, ts, time: new Date(ts * 1000).toISOString(), tx_hash: `0x${id}`, from: '0xa', to: '0xb', amount, symbol,
  asset_key: symbol === 'ETH' ? 'native' : symbol, kind: 'native', explorer_url: '',
})

describe('ChronoReplay milestones', () => {
  const events = [ev('a', 100, '1'), ev('b', 200, '500'), ev('c', 210, '2'), ev('d', 5000, '3'), ev('e', 5100, '4')]
  const tl: TimelineResponse = {
    events,
    buckets: [{ start: 0, end: 1000, count: 3 }, { start: 1000, end: 4000, count: 0 }, { start: 4000, end: 6000, count: 2 }],
    gaps: [{ start: 210, end: 5000, seconds: 4790 }],
    missing_timestamps: 0,
    range: { start: 100, end: 5100, start_iso: '', end_iso: '' },
  }

  it('picks only real events, in time order, starting and ending with the record', () => {
    const ms = buildMilestones(tl)
    const ids = new Set(events.map((e) => e.id))
    expect(ms.every((m) => ids.has(m.eventId))).toBe(true)
    expect(ms.map((m) => m.ts)).toEqual([...ms.map((m) => m.ts)].sort((a, b) => a - b))
    expect(ms[0]).toMatchObject({ eventId: 'a', label: 'First recorded transfer' })
    expect(ms.at(-1)).toMatchObject({ eventId: 'e', label: 'Last recorded transfer' })
    expect(ms.find((m) => m.eventId === 'b')?.label).toMatch(/Largest ETH transfer · 500 ETH/)
    expect(ms.find((m) => m.eventId === 'd')?.label).toMatch(/Busiest period · 2 transfers|Activity resumes after 1h quiet/) // one stop per event, first reason wins
  })

  it('is empty without events and never exceeds the cap', () => {
    expect(buildMilestones(null)).toEqual([])
    expect(buildMilestones({ ...tl, events: [] })).toEqual([])
    const many = Array.from({ length: 60 }, (_, i) => ev(`x${i}`, i * 10, String(i)))
    const big = { ...tl, events: many, gaps: Array.from({ length: 4 }, (_, i) => ({ start: i * 100, end: i * 100 + 50, seconds: 7200 })) }
    expect(buildMilestones(big, 5).length).toBeLessThanOrEqual(5)
  })
})
