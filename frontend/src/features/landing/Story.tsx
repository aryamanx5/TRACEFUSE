import { motion, useMotionValueEvent, useTransform, type MotionValue } from 'framer-motion'
import { Suspense, lazy, useCallback, useRef, useState, type ReactNode } from 'react'
import type { CharacterKind } from '../../components/cast'
import { Character } from '../../components/characters'
import { HOPS, hopAt, webglOk } from './fragment'
import { FlowGraphic } from './Graphics'
import { useChapterProgress } from './hooks'
import { ChapterLabel, MaskLine, Reveal } from './parts'

const FragmentScene = lazy(() => import('./FragmentScene'))

type ChapterProps = { reduced: boolean; narrow: boolean }

/* ------------------------------------------------------------------------------------------------
   02 — Fragmentation: a dimensional network that keeps splitting while the chapter is pinned
   ------------------------------------------------------------------------------------------------ */
export function Fragmentation({ reduced, narrow }: ChapterProps) {
  const ref = useRef<HTMLElement>(null)
  const p = useChapterProgress(ref, { reduced, narrow })
  const [noGl, setNoGl] = useState(() => typeof document !== 'undefined' && !webglOk())
  const onFail = useCallback(() => setNoGl(true), [])
  const [hop, setHop] = useState(reduced ? HOPS.length - 1 : -1)
  useMotionValueEvent(p, 'change', (v) => {
    const h = HOPS.reduce((acc, _, i) => (v >= hopAt(i) ? i : acc), -1)
    if (h !== hop) setHop(h)
  })
  const total = HOPS.slice(0, hop + 1).reduce((a, b) => a + b, 0)

  return (
    <section ref={ref} id="fragmentation" data-stage={1} aria-labelledby="fragmentation-title" className="tfl-chapter tfl-pin tfl-frag" style={{ '--pin': 3.2 } as React.CSSProperties}>
      <div className="tfl-pin-stage">
        <div className="tfl-frag-art" aria-hidden>
          <span className="tfl-frag-word">Split</span>
          {noGl ? (
            <div className="tfl-frag-fallback"><FlowGraphic progress={p} reduced={reduced} /></div>
          ) : (
            <Suspense fallback={null}><FragmentScene progress={p} reduced={reduced} onFail={onFail} /></Suspense>
          )}
        </div>
        <div className="tfl-frag-copy">
          <ChapterLabel n="02">Fragmentation</ChapterLabel>
          <h2 id="fragmentation-title" className="tf-display tfl-h2" tabIndex={-1}>
            <MaskLine reduced={reduced} className="tf-thin">One exploit.</MaskLine>{' '}
            <MaskLine reduced={reduced} i={1} className="tf-heavy tfl-mint">Hundreds of paths.</MaskLine>
          </h2>
          <Reveal reduced={reduced} as="p" className="tfl-body" delay={0.2}>
            Stolen funds rarely sit still. They are split across fresh wallets, relayed within minutes and pushed toward
            bridges and mixers. Every hop is another thread to follow.
          </Reveal>
        </div>
        <figure className="tfl-hops">
          <ol aria-label="Illustrative wallets per hop">
            {HOPS.map((n, i) => (
              <li key={i} data-on={i <= hop || undefined}>
                <span className="tfl-hops-k">Hop {i}</span>
                <span className="tfl-hops-bar" aria-hidden><span style={{ width: `${(n / HOPS[HOPS.length - 1]) * 100}%` }} /></span>
                <span className="tfl-hops-n">{n} {n === 1 ? 'wallet' : 'wallets'}</span>
              </li>
            ))}
          </ol>
          <span className="tfl-hops-mascot" aria-hidden><Character kind="snoop" size={86} pop={!reduced} delay={0.2} flip /></span>
          <p className="tfl-hops-total" aria-hidden><strong>{total || 1}</strong> wallets so far</p>
          <figcaption>Illustrative branching path — not live transaction data.</figcaption>
        </figure>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------------------------------------
   03 — Disconnected intelligence: four real public clues, scattered, then drawn towards each other
   ------------------------------------------------------------------------------------------------ */
type Clue = { key: string; tag: string; sigil: CharacterKind; tone: string; title: string; body: ReactNode; from: [number, number, number]; to: [number, number] }
const CLUES: Clue[] = [
  {
    key: 'ledger', tag: 'Blockchain transaction', sigil: 'blocky', tone: 'mint', title: 'Ledger',
    body: (
      <dl className="tfl-clue-dl">
        <div><dt>Transaction</dt><dd className="tfl-mono">0xc28fad5e…67d0b7</dd></div>
        <div><dt>Amount</dt><dd className="tfl-mono">173,600 ETH</dd></div>
        <div><dt>From → to</dt><dd className="tfl-mono">Ronin Bridge V1 → 0x098B…2f96</dd></div>
        <div><dt>Block</dt><dd className="tfl-mono">14442835 · 2022-03-23</dd></div>
      </dl>
    ),
    from: [-16, -14, -9], to: [25, 27],
  },
  {
    key: 'report', tag: 'Public report', sigil: 'docket', tone: 'violet', title: 'Incident write-up',
    body: <p>Describes a validator-key compromise and forged withdrawals from the bridge.</p>,
    from: [12, -22, 7], to: [75, 27],
  },
  {
    key: 'repo', tag: 'Developer repositories', sigil: 'snoop', tone: 'ink', title: 'Code & issues',
    body: <p>Issue trackers and commits, searched for the address. Mentions are leads, not proof.</p>,
    from: [-10, 20, 6], to: [25, 75],
  },
  {
    key: 'indicator', tag: 'Known wallet indicator', sigil: 'knot', tone: 'ember', title: 'Sanctions list',
    body: <p>OFAC, 14 Apr 2022: the receiving address added to the Lazarus Group entry. Risk feeds flag it as theft-linked.</p>,
    from: [8, 14, -8], to: [75, 75],
  },
]

export function Disconnected({ reduced, narrow }: ChapterProps) {
  const ref = useRef<HTMLElement>(null)
  const p = useChapterProgress(ref, { reduced, narrow })
  const k = useTransform(p, [0.12, 0.62], [0, 1])
  const lines = useTransform(p, [0.58, 0.82], [0, 1])
  const knot = useTransform(p, [0.74, 0.86], [0, 1])
  const after = useTransform(p, [0.8, 0.92], [0, 1])

  return (
    <section ref={ref} id="disconnected" data-stage={2} aria-labelledby="disconnected-title" className="tfl-chapter tfl-pin tfl-disc" style={{ '--pin': 2.8 } as React.CSSProperties}>
      <div className="tfl-pin-stage">
        <div className="tfl-disc-copy">
          <ChapterLabel n="03">Disconnected intelligence</ChapterLabel>
          <h2 id="disconnected-title" className="tf-display tfl-h2" tabIndex={-1}>
            <MaskLine reduced={reduced} className="tf-thin">The clues exist.</MaskLine>{' '}
            <MaskLine reduced={reduced} i={1} className="tf-heavy tfl-amber">They don’t connect.</MaskLine>
          </h2>
          <Reveal reduced={reduced} as="p" className="tfl-note" delay={0.2}>
            Public record from the Ronin Bridge case, March 2022 — found the way it usually is: in four separate places.
          </Reveal>
          <motion.p className="tfl-disc-after" style={narrow || reduced ? undefined : { opacity: after }}>
            <span className="tfl-dash" aria-hidden /> Possible relationships — not yet established
          </motion.p>
        </div>
        <div className="tfl-collage">
          <svg className="tfl-collage-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden focusable="false">
            <motion.g style={narrow || reduced ? undefined : { opacity: lines }}>
              {CLUES.map((c) => <line key={c.key} x1={c.to[0]} y1={c.to[1]} x2={50} y2={51} vectorEffect="non-scaling-stroke" />)}
            </motion.g>
          </svg>
          <motion.span className="tfl-knot" style={narrow || reduced ? undefined : { scale: knot, opacity: knot }} aria-hidden>?</motion.span>
          {CLUES.map((c, i) => <ClueCard key={c.key} c={c} i={i} k={k} still={narrow || reduced} />)}
        </div>
      </div>
    </section>
  )
}

function ClueCard({ c, i, k, still }: { c: Clue; i: number; k: MotionValue<number>; still: boolean }) {
  const x = useTransform(k, [0, 1], [`${c.from[0]}%`, '0%'])
  const y = useTransform(k, [0, 1], [`${c.from[1]}%`, '0%'])
  const rotate = useTransform(k, [0, 1], [c.from[2], 0])
  return (
    <motion.article className={`tfl-clue tfl-tone-${c.tone}`} data-pos={i}
      style={still ? undefined : { x, y, rotate }}>
      <span className="tfl-clue-sigil" aria-hidden><Character kind={c.sigil} size={78} pop={!still} delay={0.15 + i * 0.1} idle={i % 2 ? 'sway' : 'bob'} /></span>
      <p className="tfl-clue-tag">{c.tag}</p>
      <h3>{c.title}</h3>
      {c.body}
    </motion.article>
  )
}

/* ------------------------------------------------------------------------------------------------
   04 — Evidence fusion: three planes (sources · ledger · hypotheses) pull apart and get wired together
   ------------------------------------------------------------------------------------------------ */
const WALLETS: [number, number][] = [[14, 50], [40, 26], [40, 74], [68, 18], [68, 50], [88, 80]]
const TRANSFERS: [number, number][] = [[0, 1], [0, 2], [1, 3], [1, 4], [2, 5]]
const DOCS: { at: [number, number]; to: number; label: string }[] = [
  { at: [14, 50], to: 0, label: 'Sanctions entry' },
  { at: [68, 18], to: 3, label: 'Incident report' },
  { at: [88, 80], to: 5, label: 'Repository post' },
]
const HYPO: [number, number][] = [[3, 4], [4, 5]]

export function Fusion({ reduced, narrow }: ChapterProps) {
  const ref = useRef<HTMLElement>(null)
  const p = useChapterProgress(ref, { reduced, narrow })
  const gap = useTransform(p, [0.08, 0.5], [6, 96])
  const gapNeg = useTransform(gap, (g) => -g)
  const beams = useTransform(p, [0.42, 0.62], [0, 1])
  const turn = useTransform(p, [0, 1], [-46, -34])
  const still = reduced

  return (
    <section ref={ref} id="fusion" data-stage={3} aria-labelledby="fusion-title" className="tfl-chapter tfl-pin tfl-fusion" style={{ '--pin': 2.8 } as React.CSSProperties}>
      <div className="tfl-pin-stage">
        <figure className="tfl-iso-fig">
          <div className="tfl-iso">
            <motion.div className="tfl-iso-world" style={still ? { rotateX: 58, rotateZ: -38 } : { rotateX: 58, rotateZ: turn }}>
              <motion.div className="tfl-plane tfl-plane-src" style={{ z: still ? 96 : gap }}>
                <span className="tfl-plane-name">Sources</span>
                <svg viewBox="0 0 100 100" aria-hidden focusable="false">
                  {DOCS.map((d) => (
                    <g key={d.label} transform={`translate(${d.at[0] - 6} ${d.at[1] - 8})`}>
                      <path d="M0 0h9l3 3v13H0Z" fill="#a99bff" stroke="#0e0f10" strokeWidth=".8" />
                      <path d="M2.5 6h7M2.5 9h7M2.5 12h4" stroke="#0e0f10" strokeWidth=".9" />
                    </g>
                  ))}
                </svg>
              </motion.div>
              <div className="tfl-plane tfl-plane-ledger">
                <span className="tfl-plane-name">Ledger</span>
                <svg viewBox="0 0 100 100" aria-hidden focusable="false">
                  <defs>
                    <marker id="tfl-arrow" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="5" markerHeight="5" orient="auto">
                      <path d="M0 0 6 3 0 6Z" fill="#5ef2c2" />
                    </marker>
                  </defs>
                  {TRANSFERS.map(([a, b]) => (
                    <line key={`${a}-${b}`} x1={WALLETS[a][0]} y1={WALLETS[a][1]} x2={WALLETS[b][0] - (WALLETS[b][0] - WALLETS[a][0]) * 0.12}
                      y2={WALLETS[b][1] - (WALLETS[b][1] - WALLETS[a][1]) * 0.12} stroke="#5ef2c2" strokeWidth="1.3" markerEnd="url(#tfl-arrow)" />
                  ))}
                  {WALLETS.map(([x, y], i) => (
                    <rect key={i} x={x - (i ? 3 : 4.5)} y={y - (i ? 3 : 4.5)} width={i ? 6 : 9} height={i ? 6 : 9}
                      fill={i ? '#202224' : '#5ef2c2'} stroke="#5ef2c2" strokeWidth="1.2" />
                  ))}
                </svg>
              </div>
              <motion.div className="tfl-plane tfl-plane-hypo" style={{ z: still ? -96 : gapNeg }}>
                <span className="tfl-plane-name">Hypotheses</span>
                <svg viewBox="0 0 100 100" aria-hidden focusable="false">
                  {HYPO.map(([a, b]) => (
                    <path key={`${a}-${b}`} d={`M${WALLETS[a][0]} ${WALLETS[a][1]} Q ${(WALLETS[a][0] + WALLETS[b][0]) / 2 + 14} ${(WALLETS[a][1] + WALLETS[b][1]) / 2} ${WALLETS[b][0]} ${WALLETS[b][1]}`}
                      fill="none" stroke="#ffb03a" strokeWidth="1.4" strokeDasharray="1 2.6" strokeLinecap="round" />
                  ))}
                  {[3, 4, 5].map((i) => <circle key={i} cx={WALLETS[i][0]} cy={WALLETS[i][1]} r="2.6" fill="none" stroke="#ffb03a" strokeWidth="1" />)}
                </svg>
              </motion.div>
              {/* beams: sources cite wallets (violet, dashed); hypotheses hang below the wallets they concern (amber, dotted) */}
              {DOCS.map((d) => (
                <motion.div key={d.label} className="tfl-beam tfl-beam-src" style={{ left: `${WALLETS[d.to][0]}%`, top: `${WALLETS[d.to][1]}%`, height: still ? 96 : gap, opacity: still ? 1 : beams }} />
              ))}
              {[3, 4, 5].map((i) => (
                <motion.div key={i} className="tfl-beam tfl-beam-hypo" style={{ left: `${WALLETS[i][0]}%`, top: `${WALLETS[i][1]}%`, height: still ? 96 : gap, opacity: still ? 1 : beams }} />
              ))}
            </motion.div>
          </div>
          <span className="tfl-iso-mascot tfl-iso-m1" aria-hidden><Character kind="docket" size={96} pop={!reduced} delay={0.3} idle="sway" /></span>
          <span className="tfl-iso-mascot tfl-iso-m2" aria-hidden><Character kind="hexo" size={92} pop={!reduced} delay={0.45} /></span>
          <figcaption>Illustrative diagram.</figcaption>
        </figure>
        <div className="tfl-fusion-copy">
          <ChapterLabel n="04">Evidence fusion</ChapterLabel>
          <h2 id="fusion-title" className="tf-display tfl-h2" tabIndex={-1}>
            <MaskLine reduced={reduced} className="tf-thin">Connect the evidence.</MaskLine>{' '}
            <MaskLine reduced={reduced} i={1} className="tf-heavy">Not just the dots.</MaskLine>
          </h2>
          <Reveal reduced={reduced} as="p" className="tfl-body" delay={0.15}>
            TRACEFUSE ties each transfer to the public source that mentions it — and never lets the three kinds of
            connection blur together.
          </Reveal>
          <Reveal reduced={reduced} delay={0.25}>
            <ul className="tfl-legend">
              <li><svg viewBox="0 0 34 8" aria-hidden><line x1="0" y1="4" x2="34" y2="4" stroke="#5ef2c2" strokeWidth="2.5" /></svg><span><strong>Proven</strong> by the ledger — a recorded transfer</span></li>
              <li><svg viewBox="0 0 34 8" aria-hidden><line x1="0" y1="4" x2="34" y2="4" stroke="#a99bff" strokeWidth="2" strokeDasharray="7 4" /></svg><span><strong>Asserted</strong> by a source — cited, not proven</span></li>
              <li><svg viewBox="0 0 34 8" aria-hidden><line x1="1" y1="4" x2="34" y2="4" stroke="#ffb03a" strokeWidth="2" strokeDasharray="1 4" strokeLinecap="round" /></svg><span><strong>Suggested</strong> by an algorithm — a hypothesis</span></li>
            </ul>
          </Reveal>
        </div>
      </div>
    </section>
  )
}
