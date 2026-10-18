import { motion } from 'framer-motion'
import type { CSSProperties } from 'react'
import type { CharacterKind } from './cast'

/*
 * The Tracers — TRACEFUSE's original cartoon cast. Each one wears a colour of the evidence language,
 * so the mascots double as a memory aid for what the colours mean:
 *   hexo   mint    a wallet: something the ledger proves
 *   docket violet  a document: something a public source reports
 *   snoop  cyan    the lens: whatever you are looking at right now
 *   knot   amber   a tangle: a relationship nobody has confirmed yet
 *   archie ember   a bridge: value crossing to another chain
 *   blocky ink     a ledger block: the raw record
 * They are decoration only (aria-hidden) and never carry data. Eyes blink and follow the pointer;
 * with reduced motion they sit still.
 */

const O = '#0e0f10'
const W = 4

function Eye({ x, y, r = 9, delay = 0 }: { x: number; y: number; r?: number; delay?: number }) {
  return (
    <g className="tfc-eye" style={{ animationDelay: `${delay}s` }}>
      <ellipse cx={x} cy={y} rx={r} ry={r * 1.08} fill="#fff" stroke={O} strokeWidth={3} />
      <g className="tfc-pupil">
        <circle cx={x} cy={y + 0.5} r={r * 0.52} fill={O} />
        <circle cx={x - r * 0.18} cy={y - r * 0.2} r={r * 0.18} fill="#fff" />
      </g>
    </g>
  )
}

function Body({ kind, blink }: { kind: CharacterKind; blink: number }) {
  switch (kind) {
    case 'hexo':
      return (
        <g strokeLinejoin="round" strokeLinecap="round">
          <path d="M60 18v-9" stroke={O} strokeWidth={W} />
          <rect x="53" y="2" width="14" height="10" fill="#3fd0ff" stroke={O} strokeWidth={3} className="tfc-blip" />
          <path d="M27 62c-9 2-13 8-12 14M93 62c9 2 13 8 12 14" stroke={O} strokeWidth={W} fill="none" />
          <rect x="42" y="94" width="13" height="16" rx="5" fill="#2fbf94" stroke={O} strokeWidth={W} />
          <rect x="65" y="94" width="13" height="16" rx="5" fill="#2fbf94" stroke={O} strokeWidth={W} />
          <path d="M60 17 96 37v42L60 99 24 79V37Z" fill="#5ef2c2" stroke={O} strokeWidth={W} />
          <path d="M60 25 88 41v6L60 31 32 47v-6Z" fill="#b8ffe9" />
          <path d="M24 70 60 90l36-20" stroke="#2fbf94" strokeWidth={5} fill="none" />
          <Eye x={47} y={56} r={10} delay={blink} />
          <Eye x={73} y={56} r={10} delay={blink} />
          <path d="M53 73q7 6 14 0" stroke={O} strokeWidth={3.5} fill="none" />
          <ellipse cx="38" cy="70" rx="5" ry="3" fill="#ff86c0" opacity=".55" />
          <ellipse cx="82" cy="70" rx="5" ry="3" fill="#ff86c0" opacity=".55" />
        </g>
      )
    case 'docket':
      return (
        <g strokeLinejoin="round" strokeLinecap="round">
          <path d="M26 66c-10-2-15 4-15 11M94 60c8-5 14-3 16 3" stroke={O} strokeWidth={W} fill="none" />
          <circle cx="110" cy="66" r="7" fill="#ff7a3d" stroke={O} strokeWidth={3} />
          <path d="M28 14h48l18 18v66q-8 12-16 0-8 12-16 0-8 12-17 0-8 12-17 0Z" fill="#a99bff" stroke={O} strokeWidth={W} />
          <path d="M76 14v18h18" fill="#d9d2ff" stroke={O} strokeWidth={W} />
          <path d="M36 24h30" stroke="#d9d2ff" strokeWidth={4} />
          <Eye x={48} y={50} r={10} delay={blink} />
          <Eye x={72} y={50} r={10} delay={blink} />
          <ellipse cx="60" cy="70" rx="5" ry="6" fill={O} />
          <path d="M38 84h44" stroke="#7d6be0" strokeWidth={4} />
        </g>
      )
    case 'snoop':
      return (
        <g strokeLinejoin="round" strokeLinecap="round">
          <path d="m78 76 22 24" stroke={O} strokeWidth={17} />
          <path d="m78 76 22 24" stroke="#3fd0ff" strokeWidth={9} />
          <path d="M95 104l-6 8M103 98l8 6" stroke={O} strokeWidth={W} />
          <circle cx="52" cy="50" r="38" fill="#14313b" stroke={O} strokeWidth={W} />
          <circle cx="52" cy="50" r="33" fill="none" stroke="#3fd0ff" strokeWidth={8} />
          <path d="M28 36a28 28 0 0 1 14-14" stroke="#e6fbff" strokeWidth={5} fill="none" />
          <Eye x={52} y={52} r={15} delay={blink} />
          <path d="M40 30q12-6 24 0" stroke="#3fd0ff" strokeWidth={4} fill="none" className="tfc-brow" />
        </g>
      )
    case 'knot':
      return (
        <g strokeLinejoin="round" strokeLinecap="round">
          <path d="M82 84c14 4 22 12 18 22-3 7-12 6-12-1 0-6 9-8 14-4" stroke="#ffb03a" strokeWidth={5} strokeDasharray="2 8" fill="none" />
          <path d="M36 98v10M56 100v10" stroke={O} strokeWidth={W} />
          <circle cx="52" cy="62" r="38" fill="#ffb03a" stroke={O} strokeWidth={W} />
          <path d="M22 54q30-22 58 6M24 78q26 12 52-12M40 28q-6 30 18 66" stroke="#d98a1c" strokeWidth={4} fill="none" />
          <Eye x={40} y={58} r={9} delay={blink} />
          <Eye x={64} y={58} r={10} delay={blink} />
          <path d="M30 42l14 4M58 43l14-6" stroke={O} strokeWidth={3.5} />
          <path d="M44 78q8-4 16 0" stroke={O} strokeWidth={3.5} fill="none" />
          <text x="86" y="30" fontSize="30" fontWeight="900" fill="#ffb03a" stroke={O} strokeWidth={2.5} fontFamily="Archivo, sans-serif" className="tfc-q">?</text>
        </g>
      )
    case 'archie':
      return (
        <g strokeLinejoin="round" strokeLinecap="round">
          <path d="M4 112c10-6 18 4 28-1s18 4 28-1 18 4 28-1 18 4 28-1" stroke="#3fd0ff" strokeWidth={3.5} fill="none" />
          <path d="M12 102V56Q60 2 108 56v46H86V74Q60 46 34 74v28Z" fill="#ff7a3d" stroke={O} strokeWidth={W} />
          <path d="M22 58Q60 16 98 58" stroke="#ffb08a" strokeWidth={5} fill="none" />
          <rect x="8" y="98" width="30" height="10" rx="4" fill="#c4521f" stroke={O} strokeWidth={W} />
          <rect x="82" y="98" width="30" height="10" rx="4" fill="#c4521f" stroke={O} strokeWidth={W} />
          <rect x="6" y="44" width="16" height="12" fill="#5ef2c2" stroke={O} strokeWidth={3} />
          <rect x="98" y="44" width="16" height="12" fill="#a99bff" stroke={O} strokeWidth={3} />
          <Eye x={48} y={36} r={8.5} delay={blink} />
          <Eye x={72} y={36} r={8.5} delay={blink} />
          <path d="M54 52q6 5 12 0" stroke={O} strokeWidth={3.5} fill="none" />
        </g>
      )
    case 'blocky':
      return (
        <g strokeLinejoin="round" strokeLinecap="round">
          <path d="M40 104v8M78 106v6" stroke={O} strokeWidth={W} />
          <path d="M60 10 104 34v52L60 110 16 86V34Z" fill="#202224" stroke={O} strokeWidth={W} />
          <path d="M60 10 104 34 60 58 16 34Z" fill="#f1efe7" stroke={O} strokeWidth={W} />
          <path d="M60 58v52" stroke={O} strokeWidth={W} />
          <path d="M71 64v38M82 58v38M93 52v38M60 72l44-24M60 86l44-24" stroke="#ff7a3d" strokeWidth={1.6} opacity=".85" />
          <path d="M30 22 74 46M44 16l44 24" stroke="#cfccc3" strokeWidth={2} />
          <Eye x={30} y={62} r={8} delay={blink} />
          <Eye x={48} y={70} r={8} delay={blink} />
          <path d="M22 50l14 6M42 58l13 2" stroke="#5ef2c2" strokeWidth={3.5} />
          <path d="M33 84q6 3 12 0" stroke="#5ef2c2" strokeWidth={3} fill="none" />
        </g>
      )
  }
}

/** One character. `pop` springs it in when it scrolls into view; it then idles (bob) and reacts to hover. */
export function Character({ kind, size = 96, className = '', style, pop = false, delay = 0, idle = 'bob', flip = false }: {
  kind: CharacterKind; size?: number; className?: string; style?: CSSProperties; pop?: boolean; delay?: number
  idle?: 'bob' | 'sway' | 'none'; flip?: boolean
}) {
  const blink = -((kind.length * 1.7 + delay * 3) % 5)
  const svg = (
    <svg viewBox="0 0 120 120" className={`tfc-svg ${idle !== 'none' ? `tfc-${idle}` : ''}`} style={{ animationDelay: `${-delay * 1.3}s` }} aria-hidden focusable="false">
      <ellipse cx="60" cy="116" rx="30" ry="4" fill="#000" opacity=".35" className="tfc-shadow" />
      <g style={flip ? { transform: 'scaleX(-1)', transformOrigin: '60px 60px' } : undefined}><Body kind={kind} blink={blink} /></g>
    </svg>
  )
  if (!pop) return <span className={`tfc tfc-${kind} ${className}`} style={{ width: size, ...style }} aria-hidden>{svg}</span>
  return (
    <motion.span className={`tfc tfc-${kind} ${className}`} style={{ width: size, ...style }} aria-hidden
      initial={{ scale: 0.3, rotate: -24, y: 30, opacity: 0 }} whileInView={{ scale: 1, rotate: 0, y: 0, opacity: 1 }}
      viewport={{ once: true, margin: '0px 0px -6% 0px' }} transition={{ type: 'spring', stiffness: 260, damping: 13, delay }}>
      {svg}
    </motion.span>
  )
}
