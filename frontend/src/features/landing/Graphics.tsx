import { motion, useTransform, type MotionValue } from 'framer-motion'

/*
 * Explanatory diagrams for the landing story. Positions are hand-placed and illustrative:
 * nothing here is read from an investigation, and each figure says so in its caption.
 */

type P = { x: number; y: number }
const SRC: P = { x: 22, y: 110 }
const HOP1: P[] = [{ x: 150, y: 42 }, { x: 150, y: 110 }, { x: 150, y: 178 }]
const HOP2: (P & { from: number })[] = [
  { x: 285, y: 16, from: 0 }, { x: 285, y: 60, from: 0 }, { x: 285, y: 96, from: 1 },
  { x: 285, y: 132, from: 1 }, { x: 285, y: 168, from: 2 }, { x: 285, y: 204, from: 2 },
]
const HOP3: (P & { from: number })[] = [
  { x: 414, y: 8, from: 0 }, { x: 414, y: 44, from: 1 }, { x: 414, y: 76, from: 1 }, { x: 414, y: 116, from: 3 },
  { x: 414, y: 150, from: 4 }, { x: 414, y: 186, from: 5 }, { x: 414, y: 214, from: 5 },
]

/** Chapter 02 — one source wallet fanning out into many downstream wallets, drawn as the visitor scrolls. */
export function FlowGraphic({ progress, reduced }: { progress: MotionValue<number>; reduced: boolean }) {
  const edges: { a: P; b: P; at: number; depth: number }[] = [
    ...HOP1.map((b, j) => ({ a: SRC, b, at: 0.2 + j * 0.015, depth: 1 })),
    ...HOP2.map((b, j) => ({ a: HOP1[b.from], b, at: 0.28 + j * 0.012, depth: 2 })),
    ...HOP3.map((b, j) => ({ a: HOP2[b.from], b, at: 0.36 + j * 0.01, depth: 3 })),
  ]
  return (
    <svg viewBox="0 0 440 222" className="tfl-graphic" aria-hidden focusable="false">
      {edges.map((e, i) => (
        <Edge key={i} {...e} progress={progress} reduced={reduced} />
      ))}
      <circle cx={SRC.x} cy={SRC.y} r={9} fill="var(--tfl-teal)" />
      <circle cx={SRC.x} cy={SRC.y} r={16} fill="none" stroke="var(--tfl-teal)" strokeOpacity={0.4} />
      <text x={SRC.x - 6} y={SRC.y + 34} className="tfl-svg-label">source wallet</text>
    </svg>
  )
}

function Edge({ a, b, at, depth, progress, reduced }: {
  a: P; b: P; at: number; depth: number; progress: MotionValue<number>; reduced: boolean
}) {
  const len = useTransform(progress, [at, at + 0.07], [0, 1])
  const show = useTransform(progress, [at + 0.05, at + 0.08], [0, 1])
  const r = depth === 1 ? 6 : depth === 2 ? 4.5 : 3.5
  const tip = b.x - r - 2
  const ang = Math.atan2(b.y - a.y, b.x - a.x)
  const ax = tip - Math.cos(ang) * 7
  const ay = b.y - Math.sin(ang) * 7
  const nx = Math.sin(ang) * 3.5
  const ny = -Math.cos(ang) * 3.5
  const d = `M${a.x + (depth === 1 ? 10 : 5)},${a.y + (b.y - a.y) * 0.04} C${(a.x + b.x) / 2},${a.y} ${(a.x + b.x) / 2},${b.y} ${tip - 4},${b.y}`
  const stroke = depth === 1 ? 'var(--tfl-teal)' : 'var(--tfl-steel)'
  return (
    <g>
      <motion.path d={d} fill="none" stroke={stroke} strokeWidth={depth === 1 ? 1.6 : 1.1} style={reduced ? undefined : { pathLength: len }} />
      <motion.g style={reduced ? undefined : { opacity: show }}>
        <polygon points={`${tip},${b.y} ${ax + nx},${ay + ny} ${ax - nx},${ay - ny}`} fill={stroke} />
        <circle cx={b.x} cy={b.y} r={r} fill="var(--tfl-bg)" stroke={stroke} strokeWidth={1.4} />
      </motion.g>
    </g>
  )
}

const LEDGER: (P & { t: string })[] = [
  { x: 40, y: 56, t: 'wallet A' }, { x: 185, y: 56, t: 'wallet B' }, { x: 330, y: 56, t: 'wallet C' }, { x: 475, y: 56, t: 'wallet D' },
]
const SOURCES: (P & { t: string })[] = [
  { x: 70, y: 190, t: 'Sanctions list' }, { x: 262, y: 190, t: 'Incident report' }, { x: 450, y: 190, t: 'Repository post' },
]
const LINKS: { s: number; n: number; kind: 'assert' | 'hypo'; at: number }[] = [
  { s: 0, n: 0, kind: 'assert', at: 0.32 },
  { s: 1, n: 1, kind: 'assert', at: 0.36 },
  { s: 2, n: 3, kind: 'hypo', at: 0.44 },
]

/** Chapter 04 — the three kinds of connection, revealed in order: ledger fact, cited assertion, hypothesis. */
export function FusionGraphic({ progress, reduced }: { progress: MotionValue<number>; reduced: boolean }) {
  return (
    <svg viewBox="0 0 520 222" className="tfl-graphic" aria-hidden focusable="false">
      {LEDGER.slice(1).map((n, i) => (
        <Link key={`v${i}`} d={`M${LEDGER[i].x + 9},${n.y} L${n.x - 12},${n.y}`} kind="verified" at={0.18 + i * 0.04} progress={progress} reduced={reduced} arrow={{ x: n.x - 10, y: n.y }} />
      ))}
      {LINKS.map((l, i) => {
        const s = SOURCES[l.s]
        const n = LEDGER[l.n]
        return (
          <Link key={`l${i}`} d={`M${s.x},${s.y - 18} C${s.x},${(s.y + n.y) / 2} ${n.x},${(s.y + n.y) / 2} ${n.x},${n.y + 12}`}
            kind={l.kind} at={l.at} progress={progress} reduced={reduced} />
        )
      })}
      {LEDGER.map((n) => (
        <g key={n.t}>
          <circle cx={n.x} cy={n.y} r={8} fill="var(--tfl-bg)" stroke="var(--tfl-teal)" strokeWidth={1.8} />
          <text x={n.x} y={n.y - 18} textAnchor="middle" className="tfl-svg-label">{n.t}</text>
        </g>
      ))}
      {SOURCES.map((s) => (
        <g key={s.t}>
          <rect x={s.x - 62} y={s.y - 17} width={124} height={34} fill="var(--tfl-panel)" />
          <text x={s.x} y={s.y + 4} textAnchor="middle" className="tfl-svg-label tfl-svg-ink">{s.t}</text>
        </g>
      ))}
    </svg>
  )
}

function Link({ d, kind, at, progress, reduced, arrow }: {
  d: string; kind: 'verified' | 'assert' | 'hypo'; at: number; progress: MotionValue<number>; reduced: boolean; arrow?: P
}) {
  const opacity = useTransform(progress, [at, at + 0.06], [0, 1])
  const stroke = kind === 'verified' ? 'var(--tfl-teal)' : kind === 'assert' ? 'var(--tfl-ink)' : 'var(--tfl-rust)'
  const dash = kind === 'verified' ? undefined : kind === 'assert' ? '7 5' : '2 5'
  return (
    <motion.g style={reduced ? undefined : { opacity }}>
      <path d={d} fill="none" stroke={stroke} strokeWidth={kind === 'verified' ? 2 : 1.6} strokeDasharray={dash} strokeLinecap="round" />
      {arrow && <polygon points={`${arrow.x},${arrow.y} ${arrow.x - 8},${arrow.y - 4.5} ${arrow.x - 8},${arrow.y + 4.5}`} fill={stroke} />}
    </motion.g>
  )
}

/** Legend for the fusion diagram — real text, so it is read out and stays legible without the drawing. */
export function FusionLegend() {
  return (
    <ul className="tfl-legend">
      <li><svg viewBox="0 0 28 6" aria-hidden><line x1="0" y1="3" x2="28" y2="3" stroke="var(--tfl-teal)" strokeWidth="2" /></svg>Verified on-chain transfer</li>
      <li><svg viewBox="0 0 28 6" aria-hidden><line x1="0" y1="3" x2="28" y2="3" stroke="var(--tfl-ink)" strokeWidth="1.6" strokeDasharray="7 5" /></svg>Assertion, cited to its source</li>
      <li><svg viewBox="0 0 28 6" aria-hidden><line x1="1" y1="3" x2="28" y2="3" stroke="var(--tfl-rust)" strokeWidth="1.6" strokeDasharray="2 5" strokeLinecap="round" /></svg>Hypothesis, not yet confirmed</li>
    </ul>
  )
}
