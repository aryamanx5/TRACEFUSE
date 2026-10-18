import { useState } from 'react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { qs } from '../../lib/api'
import { useApi } from '../../lib/hooks'
import type { AssetTotal, GraphStats, TimelineResponse } from '../../lib/types'
import { fmtAmount, fmtDuration, fmtTime, short } from '../../lib/format'
import { ErrorBox, Spinner } from '../../components/ui'
import { filterParams, type Filter, type Selection } from './state'

const TIP = { background: 'var(--bg-elev)', border: '1px solid var(--line-strong)', borderRadius: 0, fontSize: 12 }

interface MetricsResp {
  stats: GraphStats
  split_sets: { sender: string; symbol: string; size: number; recipients: string[]; amount_low: string; amount_high: string; transfer_ids: string[]; method: string }[]
  fan_out_bursts: { sender: string; recipients: string[]; start_ts: number; window_seconds: number; transfer_ids: string[] }[]
  relay_links: { node: string; delay_seconds: number; forwarded_ratio: number; in_transfer: string; out_transfers: string[] }[]
  temporal_deltas: { count: number; median_seconds?: number; min_seconds?: number; max_seconds?: number }
  amount_distribution: { asset_key: string; bins: { from: string; to: string; count: number }[]; count: number; min?: string; max?: string; median?: string } | null
  catalog: Record<string, { unit: string; description: string; requires: string; limitations: string }>
  disclaimer: string
}

export default function MetricsView({ invId, filter, assets, timeline, onSelect }: { invId: string; filter: Filter; assets: AssetTotal[]; timeline: TimelineResponse | null; onSelect: (s: Selection) => void }) {
  const [asset, setAsset] = useState('native')
  const { data, error, loading, reload } = useApi<MetricsResp>(`/api/investigations/${invId}/metrics${qs({ ...filterParams(filter), asset })}`)
  if (loading && !data) return <div className="p-4"><Spinner /></div>
  if (error) return <ErrorBox error={error} onRetry={reload} />
  if (!data) return null
  const s = data.stats
  const act = (timeline?.buckets ?? []).map((b) => ({ t: fmtTime(b.start).slice(0, 16), count: b.count }))
  return (
    <div className="space-y-5 overflow-auto p-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h3 className="tf-display"><span className="tf-thin text-[20px] text-intel">Activity</span> <span className="tf-heavy text-[22px]">Statistics</span></h3>
        <p className="max-w-[70ch] text-xs text-faint">{data.disclaimer}</p>
      </div>
      <div className="grid grid-cols-2 gap-px border border-line bg-line md:grid-cols-5">
        {[['Addresses', s.nodes], ['Directed edges', s.edges], ['Transfers', s.transfers], ['Value-bearing', s.value_bearing_transfers],
          ['Components', s.components], ['Density', s.density.toFixed(4)], ['First', fmtTime(s.first_ts).slice(0, 16)], ['Last', fmtTime(s.last_ts).slice(0, 16)],
          ['Median gap', fmtDuration(data.temporal_deltas.median_seconds)], ['Missing timestamps', s.missing_timestamps]].map(([k, v]) => (
          <div key={String(k)} className="bg-panel px-3 py-2.5"><p className="tf-kicker">{k}</p><p className="mt-1 font-display text-[22px] leading-none font-extrabold tabular-nums">{v}</p></div>
        ))}
      </div>
      <section>
        <h3 className="tf-section-title mb-2">Totals per asset <span className="tracking-normal normal-case text-faint">— exact; different assets are never added together</span></h3>
        <table className="tf-table"><thead><tr><th>Asset</th><th>Transfers</th><th>Sum of transfers</th><th>Canonical</th></tr></thead>
          <tbody>{s.assets.slice(0, 15).map((a) => <tr key={a.asset_key}><td>{a.symbol}</td><td>{a.count}</td><td className="mono">{fmtAmount(a.amount)}</td><td>{a.recognised ? 'yes' : <span className="text-hypo">no — possible spam</span>}</td></tr>)}</tbody></table>
      </section>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="tf-frame p-3">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="tf-section-title">Transfer sizes <span className="tracking-normal normal-case text-faint">— count per amount range</span></h3>
            <select className="tf-select w-auto py-1 text-xs" value={asset} onChange={(e) => setAsset(e.target.value)} aria-label="Asset for distribution">
              {assets.map((a) => <option key={a.asset_key} value={a.asset_key}>{a.symbol}</option>)}
            </select>
          </div>
          {data.amount_distribution && data.amount_distribution.count > 0 ? (
            <>
              <div className="h-48" role="img" aria-label={`Histogram of ${data.amount_distribution.count} transfer amounts`}>
                <ResponsiveContainer><BarChart data={data.amount_distribution.bins.map((b) => ({ bin: `${b.from}–${b.to}`, count: b.count }))}>
                  <CartesianGrid stroke="var(--line)" vertical={false} /><XAxis dataKey="bin" tick={{ fontSize: 10, fill: 'var(--text-faint)' }} stroke="var(--line-strong)" />
                  <YAxis tick={{ fontSize: 10, fill: 'var(--text-faint)' }} allowDecimals={false} stroke="var(--line-strong)" label={{ value: 'transfers', angle: -90, position: 'insideLeft', fill: 'var(--text-faint)', fontSize: 10 }} />
                  <Tooltip cursor={{ fill: 'var(--panel-3)' }} contentStyle={TIP} labelStyle={{ color: 'var(--text)' }} formatter={(v) => [`${v} transfers`, 'Count']} />
                  <Bar dataKey="count" fill="var(--signal)" radius={0} animationDuration={500} /></BarChart></ResponsiveContainer>
              </div>
              <p className="text-xs text-faint">min {fmtAmount(data.amount_distribution.min)} · median {fmtAmount(data.amount_distribution.median)} · max {fmtAmount(data.amount_distribution.max)}</p>
            </>
          ) : <p className="text-sm text-dim">No value-bearing transfers of this asset in the filter.</p>}
        </section>
        <section className="tf-frame p-3">
          <h3 className="tf-section-title mb-2">Activity over time <span className="tracking-normal normal-case text-faint">— transfers per period (UTC)</span></h3>
          {act.length ? (
            <div className="h-48" role="img" aria-label="Transfers over time">
              <ResponsiveContainer><BarChart data={act}><CartesianGrid stroke="var(--line)" vertical={false} />
                <XAxis dataKey="t" tick={{ fontSize: 9, fill: 'var(--text-faint)' }} minTickGap={40} stroke="var(--line-strong)" />
                <YAxis tick={{ fontSize: 10, fill: 'var(--text-faint)' }} allowDecimals={false} stroke="var(--line-strong)" label={{ value: 'transfers', angle: -90, position: 'insideLeft', fill: 'var(--text-faint)', fontSize: 10 }} />
                <Tooltip cursor={{ fill: 'var(--panel-3)' }} contentStyle={TIP} labelStyle={{ color: 'var(--text)' }} formatter={(v) => [`${v} transfers`, 'Count']} />
                <Bar dataKey="count" fill="var(--intel)" animationDuration={500} /></BarChart></ResponsiveContainer>
            </div>
          ) : <p className="text-sm text-dim">No timestamped activity.</p>}
        </section>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <PatternList title={`Near-equal splits (${data.split_sets.length})`} hint="Algorithmic pattern — not proof of intent.">
          {data.split_sets.map((x, i) => (
            <li key={i}><button className="text-left hover:text-signal2" onClick={() => onSelect({ kind: 'transfers', ids: x.transfer_ids, title: `Split by ${short(x.sender)}` })}>
              <span className="mono">{short(x.sender)}</span> → {x.size}× ≈{fmtAmount(x.amount_low, 2)} {x.symbol} to {x.recipients.length} wallets</button></li>
          ))}
        </PatternList>
        <PatternList title={`Fan-out bursts (${data.fan_out_bursts.length})`} hint="≥3 distinct recipients within 1 hour.">
          {data.fan_out_bursts.map((x, i) => (
            <li key={i}><button className="text-left hover:text-signal2" onClick={() => onSelect({ kind: 'transfers', ids: x.transfer_ids, title: `Burst from ${short(x.sender)}` })}>
              <span className="mono">{short(x.sender)}</span> → {x.recipients.length} recipients at {fmtTime(x.start_ts).slice(0, 16)}</button></li>
          ))}
        </PatternList>
        <PatternList title={`Relay links (${data.relay_links.length})`} hint="Forwarded ≥90% of a receipt within 6h.">
          {data.relay_links.slice(0, 60).map((x, i) => (
            <li key={i}><button className="text-left hover:text-signal2" onClick={() => onSelect({ kind: 'transfers', ids: [x.in_transfer, ...x.out_transfers], title: `Relay via ${short(x.node)}` })}>
              <span className="mono">{short(x.node)}</span> forwarded {(x.forwarded_ratio * 100).toFixed(0)}% after {fmtDuration(x.delay_seconds)}</button></li>
          ))}
        </PatternList>
      </div>
      <details className="border border-line p-3 text-xs">
        <summary className="cursor-pointer font-semibold text-dim hover:text-ink">Metric definitions, units &amp; limitations</summary>
        <table className="tf-table mt-2"><thead><tr><th>Metric</th><th>Unit</th><th>Description</th><th>Requires</th><th>Limitations</th></tr></thead>
          <tbody>{Object.entries(data.catalog).map(([k, v]) => <tr key={k}><td className="mono">{k}</td><td>{v.unit}</td><td>{v.description}</td><td>{v.requires}</td><td className="text-dim">{v.limitations}</td></tr>)}</tbody></table>
      </details>
    </div>
  )
}

function PatternList({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="tf-frame p-3 text-xs">
      <h3 className="tf-section-title">{title}</h3>
      <p className="mt-1 mb-2 text-faint">{hint}</p>
      <ul className="max-h-56 space-y-1 overflow-auto">{children}</ul>
    </section>
  )
}
