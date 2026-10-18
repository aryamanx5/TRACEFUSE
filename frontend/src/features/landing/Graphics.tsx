import { motion, useTransform, type MotionValue } from 'framer-motion'

/*
 * Fallback diagram for chapter 02 when WebGL is unavailable. Positions are hand-placed and illustrative:
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
      <rect x={SRC.x - 9} y={SRC.y - 9} width={18} height={18} fill="var(--tfl-teal)" />
      <rect x={SRC.x - 15} y={SRC.y - 15} width={30} height={30} fill="none" stroke="var(--tfl-teal)" strokeOpacity={0.4} />
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
        <rect x={b.x - r} y={b.y - r} width={r * 2} height={r * 2} fill="var(--tfl-bg)" stroke={stroke} strokeWidth={1.4} />
      </motion.g>
    </g>
  )
}
