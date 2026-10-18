import { short } from '../../../lib/format'
import { KIND_LABEL, type FlowEdge, type FlowModel, type FlowNode } from './model'

export interface Hover {
  x: number
  y: number
  nodeId?: string
  edgeId?: string
}

/** Small preview shown while hovering a wallet or a transfer, in either view. */
export function HoverCard({ x, y, node, edge, model, when }: {
  x: number; y: number; node?: FlowNode; edge?: FlowEdge; model: FlowModel; when?: string
}) {
  return (
    <div className="pointer-events-none absolute z-20 max-w-[260px] border border-linestrong border-l-2 border-l-signal2 bg-elev/95 px-2.5 py-2 text-xs shadow-lg"
      style={{ left: x + 14, top: y + 14 }} role="tooltip">
      {node && node.kind === 'more' && (
        <>
          <p className="font-medium text-ink">{node.title}</p>
          <p className="text-dim">Not drawn to keep the view readable. Click to show this column in full.</p>
        </>
      )}
      {node && node.kind !== 'more' && (
        <>
          <p className="font-medium text-ink">{node.title}</p>
          <p className="mono text-dim">{short(node.id, 6)}</p>
          <p className="mt-1 text-dim">{KIND_LABEL[node.kind]}{node.flagged && node.kind !== 'flagged' ? ' · flagged by a public source' : ''}</p>
          {node.node && (
            <p className="text-faint">
              {model.columns.find((c) => c.col === node.col)?.label} · {node.node.in_count} in / {node.node.out_count} out
            </p>
          )}
          <p className="mt-1 text-faint">Click to inspect</p>
        </>
      )}
      {edge && (
        <>
          <p className="font-medium text-ink">
            {edge.kind === 'inferred' ? 'Unverified pattern' : edge.kind === 'zero' ? 'Contract call (no value)' : 'Verified transaction'}
          </p>
          <p className="mono text-dim">{short(edge.source, 4)} → {short(edge.target, 4)}</p>
          {edge.amount && <p className="text-ink">{edge.amount}</p>}
          {edge.edge && <p className="text-faint">{edge.edge.count} transfer{edge.edge.count === 1 ? '' : 's'}{when ? ` · first ${when}` : ''}</p>}
          {edge.note && <p className="text-dim">{edge.note}</p>}
        </>
      )}
    </div>
  )
}
