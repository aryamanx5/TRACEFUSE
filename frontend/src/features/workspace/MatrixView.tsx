import { useMemo, useState } from 'react'
import { qs } from '../../lib/api'
import { useApi } from '../../lib/hooks'
import type { AssetTotal, MatrixCell, MatrixResponse } from '../../lib/types'
import { fmtAmount, short } from '../../lib/format'
import { Empty, ErrorBox, Spinner } from '../../components/ui'
import { filterParams, type Filter, type Selection } from './state'

interface Props {
  invId: string
  filter: Filter
  assets: AssetTotal[]
  selection: Selection
  onSelect: (s: Selection) => void
}

export default function MatrixView({ invId, filter, assets, selection, onSelect }: Props) {
  const [measure, setMeasure] = useState<'count' | 'value'>('count')
  const [asset, setAsset] = useState<string>('native')
  const [limit, setLimit] = useState(40)
  const [order, setOrder] = useState<'volume' | 'hop' | 'community' | 'address'>('hop')
  const [q, setQ] = useState('')
  const [hover, setHover] = useState<MatrixCell | null>(null)
  const path = `/api/investigations/${invId}/matrix${qs({ ...filterParams(filter), measure, asset: measure === 'value' ? asset : undefined, limit, order })}`
  const { data, error, loading, reload } = useApi<MatrixResponse>(path)
  const cellMap = useMemo(() => new Map((data?.cells ?? []).map((c) => [`${c.row}:${c.col}`, c])), [data])
  const selAddr = selection?.kind === 'node' ? selection.address : null
  const qi = q.trim().toLowerCase()

  const intensity = (v: number) => {
    if (!data || !v) return 0
    if (data.scale === 'log') return Math.log(1 + v) / Math.log(1 + data.max)
    return v / data.max
  }
  const n = data?.labels.length ?? 0
  const cell = n > 50 ? 12 : n > 25 ? 16 : 22

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-line p-2 text-xs">
        <label className="flex items-center gap-1">Measure
          <select className="tf-select w-auto py-1" value={measure} onChange={(e) => setMeasure(e.target.value as 'count')}>
            <option value="count">Transfer count</option><option value="value">Transferred value</option>
          </select>
        </label>
        {measure === 'value' && (
          <label className="flex items-center gap-1">Asset
            <select className="tf-select w-auto py-1" value={asset} onChange={(e) => setAsset(e.target.value)}>
              {assets.map((a) => <option key={a.asset_key} value={a.asset_key}>{a.symbol}{a.recognised ? '' : ' (non-canonical)'}</option>)}
            </select>
          </label>
        )}
        <label className="flex items-center gap-1">Order
          <select className="tf-select w-auto py-1" value={order} onChange={(e) => setOrder(e.target.value as 'hop')}>
            <option value="hop">Hop distance</option><option value="volume">Activity</option><option value="community">Community</option><option value="address">Address</option>
          </select>
        </label>
        <label className="flex items-center gap-1">Size
          <select className="tf-select w-auto py-1" value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
            {[20, 40, 60, 100, 150].map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1"><span className="sr-only">Highlight address</span>
          <input className="tf-input w-40 py-1" placeholder="Highlight address" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        {data?.truncated.is_truncated && (
          <span className="text-hypo">Showing top {data.truncated.shown} of {data.truncated.total_nodes} addresses by activity (seeds always included)</span>
        )}
      </div>
      {loading && !data && <div className="p-4"><Spinner /></div>}
      <ErrorBox error={error} onRetry={reload} />
      {data && data.cells.length === 0 && <div className="p-4"><Empty title="No transfers in this window">Widen the time window or clear filters.</Empty></div>}
      {data && data.cells.length > 0 && (
        <div className="flex min-h-0 flex-1 gap-3 p-2">
          <div className="min-w-0 flex-1 overflow-auto" role="grid" aria-label={`Directed transfer matrix: rows send to columns (${measure})`}>
            <table className="border-separate" style={{ borderSpacing: 1 }}>
              <thead>
                <tr>
                  <th className="sticky top-0 left-0 z-20 bg-panel text-[10px] font-normal text-faint">from ↓ / to →</th>
                  {data.labels.map((l, c) => (
                    <th key={l} scope="col" className="sticky top-0 z-10 bg-panel p-0 align-bottom">
                      <div className="mono origin-bottom-left translate-x-2 -rotate-60 text-[9px] whitespace-nowrap"
                        style={{ height: 70, width: cell, color: l === selAddr || (qi && l.includes(qi)) ? 'var(--signal)' : 'var(--text-faint)' }}
                        title={l}>{short(l, 4)}</div>
                      <span className="sr-only">column {c + 1}: {l}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.labels.map((rowAddr, r) => (
                  <tr key={rowAddr}>
                    <th scope="row" className="mono sticky left-0 z-10 bg-panel pr-2 text-right text-[9px] font-normal whitespace-nowrap"
                      style={{ color: rowAddr === selAddr || (qi && rowAddr.includes(qi)) ? 'var(--signal)' : 'var(--text-faint)' }}>
                      <button type="button" onClick={() => onSelect({ kind: 'node', address: rowAddr })} title={rowAddr}>{short(rowAddr, 4)}</button>
                    </th>
                    {data.labels.map((colAddr, c) => {
                      const m = cellMap.get(`${r}:${c}`)
                      const v = m ? intensity(m.value) : 0
                      const hl = rowAddr === selAddr || colAddr === selAddr || (!!qi && (rowAddr.includes(qi) || colAddr.includes(qi)))
                      return (
                        <td key={colAddr} className="p-0">
                          {m ? (
                            <button type="button" aria-label={`${short(rowAddr)} to ${short(colAddr)}: ${m.count} transfer(s)${m.amount ? `, ${m.amount} ${data.symbol}` : ''}`}
                              onMouseEnter={() => setHover(m)} onFocus={() => setHover(m)}
                              onClick={() => onSelect({ kind: 'transfers', ids: m.transfer_ids, title: `${short(rowAddr)} → ${short(colAddr)}` })}
                              className="block rounded-[2px] outline-offset-0"
                              style={{ width: cell, height: cell, background: `color-mix(in srgb, var(--signal) ${Math.round(15 + v * 85)}%, var(--panel-2))`,
                                boxShadow: hl ? 'inset 0 0 0 1px var(--intel)' : undefined }} />
                          ) : (
                            <div style={{ width: cell, height: cell, background: hl ? 'color-mix(in srgb, var(--intel) 10%, var(--bg-elev))' : 'var(--bg-elev)' }} className="rounded-[2px]" aria-hidden />
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <aside className="w-52 shrink-0 space-y-3 text-xs">
            <div>
              <p className="tf-label">Legend ({data.scale} scale)</p>
              <div className="h-3 rounded" style={{ background: 'linear-gradient(90deg, color-mix(in srgb, var(--signal) 15%, var(--panel-2)), var(--signal))' }} />
              <div className="mt-1 flex justify-between text-faint">
                <span>{measure === 'count' ? data.min_nonzero : fmtAmount(String(data.min_nonzero), 2)}</span>
                <span>{measure === 'count' ? data.max : `${fmtAmount(String(data.max), 2)} ${data.symbol ?? ''}`}</span>
              </div>
              <p className="mt-1 text-faint">{data.legend}</p>
            </div>
            {hover && (
              <div className="rounded-md border border-line p-2" aria-live="polite">
                <p className="mono">{short(data.labels[hover.row])} → {short(data.labels[hover.col])}</p>
                <p>{hover.count} transfer(s)</p>
                {hover.amount && <p>{fmtAmount(hover.amount)} {data.symbol}</p>}
                <p className="text-faint">Click to open the underlying transactions.</p>
              </div>
            )}
            {measure === 'value' && <p className="text-faint">Values are exact per-asset sums; assets are never added together.</p>}
          </aside>
        </div>
      )}
    </div>
  )
}
