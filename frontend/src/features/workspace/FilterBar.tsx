import type { AssetTotal } from '../../lib/types'
import { short } from '../../lib/format'
import type { Filter } from './state'

const KINDS = ['native', 'internal', 'erc20', 'erc721']

export default function FilterBar({ filter, setFilter, assets }: { filter: Filter; setFilter: (f: Filter) => void; assets: AssetTotal[] }) {
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v])
  return (
    <details className="tf-panel px-3 py-2 text-sm">
      <summary className="cursor-pointer select-none font-medium">
        Filters
        <span className="ml-2 text-xs text-faint">
          {[filter.assets.length && `${filter.assets.length} asset(s)`, filter.kinds.length && `${filter.kinds.length} kind(s)`,
            filter.hide.length && `${filter.hide.length} hidden`, filter.minAmount && `≥ ${filter.minAmount}`, filter.includeZero && 'incl. zero-value calls',
            !filter.includeUnrecognised && 'canonical tokens only'].filter(Boolean).join(' · ') || 'none'}
        </span>
      </summary>
      <div className="mt-3 grid gap-4 md:grid-cols-4">
        <fieldset>
          <legend className="tf-label">Assets</legend>
          <div className="max-h-32 space-y-1 overflow-auto">
            {assets.slice(0, 30).map((a) => (
              <label key={a.asset_key} className="flex items-center gap-2">
                <input type="checkbox" checked={filter.assets.includes(a.asset_key)} onChange={() => setFilter({ ...filter, assets: toggle(filter.assets, a.asset_key) })} />
                {a.symbol} {!a.recognised && <span className="text-[10px] text-hypo">non-canonical</span>}
                <span className="text-xs text-faint">({a.count})</span>
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="tf-label">Transfer kinds</legend>
          {KINDS.map((k) => (
            <label key={k} className="flex items-center gap-2">
              <input type="checkbox" checked={filter.kinds.includes(k)} onChange={() => setFilter({ ...filter, kinds: toggle(filter.kinds, k) })} /> {k}
            </label>
          ))}
        </fieldset>
        <div className="space-y-2">
          <label className="flex items-center gap-2"><input type="checkbox" checked={filter.includeZero} onChange={(e) => setFilter({ ...filter, includeZero: e.target.checked })} /> Show zero-value contract calls</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={!filter.includeUnrecognised} onChange={(e) => setFilter({ ...filter, includeUnrecognised: !e.target.checked })} /> Canonical tokens only (hide possible spam)</label>
          <div>
            <label htmlFor="minamt" className="tf-label">Minimum amount (asset units)</label>
            <input id="minamt" className="tf-input" inputMode="decimal" value={filter.minAmount} onChange={(e) => setFilter({ ...filter, minAmount: e.target.value.replace(/[^0-9.]/g, '') })} />
          </div>
        </div>
        <div>
          <p className="tf-label">Hidden addresses</p>
          {filter.hide.length === 0 && <p className="text-xs text-faint">Hide nodes from the graph inspector.</p>}
          <ul className="space-y-1">
            {filter.hide.map((h) => (
              <li key={h} className="flex items-center justify-between gap-2"><span className="mono">{short(h)}</span>
                <button className="text-xs text-signal2" onClick={() => setFilter({ ...filter, hide: filter.hide.filter((x) => x !== h) })}>show</button></li>
            ))}
          </ul>
          <button className="tf-btn mt-2" onClick={() => setFilter({ ...filter, assets: [], kinds: [], hide: [], minAmount: '', includeZero: false, includeUnrecognised: true })}>Reset filters</button>
        </div>
      </div>
    </details>
  )
}
