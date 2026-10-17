import { motion, useReducedMotion, useScroll, useSpring } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

/* Illustrative data only — positions for the explanatory network. Not an investigation. */
const SRC = { x: 120, y: 260 }
const HOP1 = [
  { x: 260, y: 120 }, { x: 280, y: 200 }, { x: 270, y: 290 }, { x: 290, y: 370 }, { x: 250, y: 440 },
]
const HOP2 = [
  { x: 400, y: 90, from: 0 }, { x: 410, y: 160, from: 1 }, { x: 420, y: 230, from: 1 }, { x: 410, y: 300, from: 2 },
  { x: 430, y: 360, from: 3 }, { x: 400, y: 430, from: 4 }, { x: 420, y: 480, from: 4 },
]
const DOCS = [
  { x: 640, y: 110, t: 'Public repository', k: 'mention' },
  { x: 650, y: 215, t: 'Sanctions notice', k: 'listing' },
  { x: 640, y: 320, t: 'Incident report', k: 'report' },
]
const FUSE = [
  { doc: 1, node: HOP2[1], kind: 'assert' },
  { doc: 0, node: HOP2[4], kind: 'assert' },
  { doc: 2, node: HOP1[0], kind: 'assert' },
]

const STAGES = [
  {
    key: 'signal',
    kicker: '01 · The signal',
    title: 'Every transaction leaves evidence.',
    body: 'TRACEFUSE connects real blockchain records with attributable public-source intelligence — and shows exactly why each connection exists.',
  },
  {
    key: 'fragment',
    kicker: '02 · Fragmentation',
    title: 'One exploit. Dozens of paths.',
    body: 'Stolen funds are split across fresh wallets, relayed within minutes and pushed toward bridges and mixers. Equal tranches and fast relays are patterns — not proof.',
  },
  {
    key: 'disconnected',
    kicker: '03 · Disconnected intelligence',
    title: 'Two worlds that rarely meet.',
    body: 'On-chain trails live in explorers. Clues live in repositories, sanctions notices and incident write-ups. Investigators stitch them together by hand.',
  },
  {
    key: 'fusion',
    kicker: '04 · Evidence fusion',
    title: 'Facts, claims and hypotheses — kept apart.',
    body: 'Verified transfers are solid. Source assertions are linked to their exact URL. Algorithmic inferences are labelled as such, with the evidence for and against.',
  },
  {
    key: 'room',
    kicker: '05 · The investigation room',
    title: 'Follow the money. Find the signal.',
    body: 'Trace wallets live, replay the timeline, inspect the transfer matrix, rank leads with an explainable score, and keep everything in a persistent casebook.',
  },
]

export default function Landing() {
  const reduced = useReducedMotion() ?? false
  const [stage, setStage] = useState(0)
  const refs = useRef<(HTMLElement | null)[]>([])
  const container = useRef<HTMLDivElement>(null)
  const { scrollYProgress } = useScroll({ target: container, offset: ['start start', 'end end'] })
  const progress = useSpring(scrollYProgress, { stiffness: 120, damping: 30, mass: 0.3 })

  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) setStage(Number((e.target as HTMLElement).dataset.stage))
        }
      },
      { rootMargin: '-45% 0px -45% 0px' },
    )
    refs.current.forEach((r) => r && io.observe(r))
    return () => io.disconnect()
  }, [])

  return (
    <div className="min-h-full bg-bg text-ink">
      <a href="#story" className="skip-link tf-btn">Skip to content</a>
      <header className="fixed inset-x-0 top-0 z-30 border-b border-line/60 bg-bg/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Link to="/" className="flex items-center gap-2 font-semibold tracking-wide" aria-label="TRACEFUSE home">
            <img src="/favicon.svg" alt="" className="h-6 w-6" />
            TRACEFUSE
            <span className="hidden text-xs font-normal text-faint sm:inline">The Intelligence Fusion Lab</span>
          </Link>
          <nav className="flex items-center gap-2 text-sm">
            <Link className="hidden px-2 text-dim hover:text-ink sm:inline" to="/app/challenge">Challenge</Link>
            <Link className="hidden px-2 text-dim hover:text-ink sm:inline" to="/app/cases">Casebook</Link>
            <Link className="tf-btn tf-btn-primary" to="/app">Open Investigation Room</Link>
          </nav>
        </div>
        {!reduced && (
          <motion.div
            aria-hidden
            className="h-0.5 origin-left bg-gradient-to-r from-signal via-signal2 to-intel"
            style={{ scaleX: progress }}
          />
        )}
      </header>

      <main id="story" ref={container} className="relative mx-auto max-w-6xl px-4 pt-20">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
          {/* narrative column */}
          <div>
            {STAGES.map((s, i) => (
              <section
                key={s.key}
                ref={(el) => {
                  refs.current[i] = el
                }}
                data-stage={i}
                aria-labelledby={`stage-${s.key}`}
                className="flex min-h-[85vh] flex-col justify-center py-10 md:min-h-[100vh]"
              >
                <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-signal">{s.kicker}</p>
                <h2 id={`stage-${s.key}`} className="mb-4 text-3xl font-semibold leading-tight md:text-5xl">
                  {i === 0 ? (
                    <>
                      <span className="bg-gradient-to-r from-signal to-intel bg-clip-text text-transparent">TRACEFUSE</span>
                      <br />
                      {s.title}
                    </>
                  ) : (
                    s.title
                  )}
                </h2>
                <p className="max-w-md text-base text-dim md:text-lg">{s.body}</p>
                {/* small-screen illustration (sticky panel is hidden on mobile) */}
                <div className="mt-6 md:hidden" aria-hidden>
                  <StoryGraphic stage={i} reduced />
                </div>
                {i === STAGES.length - 1 && (
                  <div className="mt-8 flex flex-wrap gap-3">
                    <Link to="/app/new" className="tf-btn tf-btn-primary px-5 py-2.5 text-base">Start an Investigation</Link>
                    <Link to="/app/historical" className="tf-btn px-5 py-2.5 text-base">Explore the Ronin case</Link>
                  </div>
                )}
              </section>
            ))}
          </div>
          {/* sticky illustration */}
          <div className="relative hidden md:block">
            <div className="sticky top-20 flex h-[calc(100vh-6rem)] flex-col justify-center">
              <div className="tf-panel relative overflow-hidden p-3" style={{ boxShadow: 'var(--shadow)' }}>
                <StoryGraphic stage={stage} reduced={reduced} />
                <p className="mt-2 text-center text-[11px] text-faint">Illustrative network — not a live investigation</p>
              </div>
              <ol className="mt-4 flex justify-center gap-2" aria-label="Story progress">
                {STAGES.map((s, i) => (
                  <li key={s.key}>
                    <button
                      type="button"
                      aria-label={`Go to stage ${i + 1}: ${s.kicker}`}
                      aria-current={stage === i ? 'step' : undefined}
                      onClick={() => refs.current[i]?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' })}
                      className="h-2 rounded-full transition-all"
                      style={{ width: stage === i ? 28 : 8, background: stage === i ? 'var(--signal)' : 'var(--line-strong)' }}
                    />
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </div>
      </main>

      <footer className="border-t border-line px-4 py-8 text-center text-xs text-faint">
        TRACEFUSE ranks leads with an explainable heuristic — never a probability, never an identity claim.
      </footer>
    </div>
  )
}

function StoryGraphic({ stage, reduced }: { stage: number; reduced: boolean }) {
  const t = reduced ? { duration: 0 } : { duration: 0.8, ease: [0.22, 1, 0.36, 1] as const }
  const show = (min: number) => (stage >= min ? 1 : 0)
  const fused = stage >= 3
  const room = stage >= 4
  return (
    <svg viewBox="0 0 760 520" className="h-auto w-full" role="img" aria-label="Illustration of a transaction network connected to public sources">
      <defs>
        <radialGradient id="glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="var(--signal)" stopOpacity="0.55" />
          <stop offset="100%" stopColor="var(--signal)" stopOpacity="0" />
        </radialGradient>
      </defs>
      {/* region labels for stage 3 */}
      <motion.g initial={false} animate={{ opacity: stage === 2 ? 1 : 0 }} transition={t}>
        <rect x="70" y="40" width="420" height="470" rx="16" fill="none" stroke="var(--line-strong)" strokeDasharray="4 6" />
        <text x="90" y="66" fill="var(--text-faint)" fontSize="13">ON-CHAIN TRAILS</text>
        <rect x="560" y="60" width="180" height="420" rx="16" fill="none" stroke="var(--line-strong)" strokeDasharray="4 6" />
        <text x="580" y="86" fill="var(--text-faint)" fontSize="13">PUBLIC SOURCES</text>
      </motion.g>

      {/* hop-1 edges */}
      {HOP1.map((n, i) => (
        <motion.line key={`e1-${i}`} x1={SRC.x} y1={SRC.y} x2={n.x} y2={n.y} stroke="var(--signal)" strokeWidth={1.8}
          initial={false} animate={{ pathLength: show(1), opacity: show(1) }} transition={{ ...t, delay: reduced ? 0 : i * 0.06 }} />
      ))}
      {/* hop-2 edges */}
      {HOP2.map((n, i) => (
        <motion.line key={`e2-${i}`} x1={HOP1[n.from].x} y1={HOP1[n.from].y} x2={n.x} y2={n.y} stroke="var(--signal-2)"
          strokeWidth={1.2} initial={false} animate={{ pathLength: show(1), opacity: show(1) * 0.85 }}
          transition={{ ...t, delay: reduced ? 0 : 0.3 + i * 0.05 }} />
      ))}
      {/* fusion links: dashed = source assertion */}
      {FUSE.map((f, i) => (
        <motion.path key={`f-${i}`} d={`M${DOCS[f.doc].x - 70},${DOCS[f.doc].y} C ${(DOCS[f.doc].x + f.node.x) / 2},${DOCS[f.doc].y} ${(DOCS[f.doc].x + f.node.x) / 2},${f.node.y} ${f.node.x + 8},${f.node.y}`}
          fill="none" stroke="var(--intel)" strokeWidth={1.6} strokeDasharray="6 5"
          initial={false} animate={{ pathLength: fused ? 1 : 0, opacity: fused ? 1 : 0 }} transition={{ ...t, delay: reduced ? 0 : i * 0.15 }} />
      ))}
      {/* inferred link: dotted amber */}
      <motion.path d={`M${HOP2[2].x},${HOP2[2].y} Q 470,265 ${HOP2[3].x},${HOP2[3].y}`} fill="none" stroke="var(--hypo)"
        strokeWidth={1.6} strokeDasharray="2 5" initial={false} animate={{ opacity: fused ? 1 : 0 }} transition={t} />

      {/* source node */}
      <circle cx={SRC.x} cy={SRC.y} r={46} fill="url(#glow)" />
      <motion.circle cx={SRC.x} cy={SRC.y} r={14} fill="var(--signal)" initial={false}
        animate={reduced ? {} : { scale: stage === 0 ? [1, 1.18, 1] : 1 }}
        transition={reduced ? undefined : { duration: 2.2, repeat: stage === 0 ? Infinity : 0 }} />
      <text x={SRC.x} y={SRC.y + 36} textAnchor="middle" fontSize="12" fill="var(--text-dim)">exploit source</text>

      {HOP1.map((n, i) => (
        <motion.circle key={`n1-${i}`} cx={n.x} cy={n.y} r={8} fill="var(--panel-2)" stroke="var(--signal)" strokeWidth={2}
          initial={false} animate={{ opacity: show(1), scale: show(1) }} transition={{ ...t, delay: reduced ? 0 : 0.1 + i * 0.06 }} />
      ))}
      {HOP2.map((n, i) => (
        <motion.circle key={`n2-${i}`} cx={n.x} cy={n.y} r={6} fill="var(--panel-2)" stroke="var(--signal-2)" strokeWidth={1.6}
          initial={false} animate={{ opacity: show(1), scale: show(1) }} transition={{ ...t, delay: reduced ? 0 : 0.4 + i * 0.05 }} />
      ))}

      {/* documents */}
      {DOCS.map((d, i) => (
        <motion.g key={`d-${i}`} initial={false} animate={{ opacity: show(2), x: stage >= 2 ? 0 : 30 }} transition={{ ...t, delay: reduced ? 0 : i * 0.1 }}>
          <rect x={d.x - 70} y={d.y - 26} width={150} height={52} rx={8} fill="var(--panel-2)" stroke="var(--intel)" strokeWidth={1.2} />
          <rect x={d.x - 58} y={d.y - 12} width={18} height={24} rx={3} fill="none" stroke="var(--intel)" />
          <text x={d.x - 32} y={d.y + 4} fontSize="12" fill="var(--text)">{d.t}</text>
        </motion.g>
      ))}

      {/* stage 5 mini tools */}
      <motion.g initial={false} animate={{ opacity: room ? 1 : 0 }} transition={t}>
        <g transform="translate(600,478)">
          {Array.from({ length: 5 }).map((_, r) =>
            Array.from({ length: 5 }).map((__, c) => (
              <rect key={`${r}-${c}`} x={c * 14} y={r * 14 - 70} width={12} height={12} rx={2}
                fill="var(--signal)" opacity={((r * 7 + c * 3) % 5) / 6 + 0.08} />
            )),
          )}
          <text x={0} y={-78} fontSize="11" fill="var(--text-faint)">MATRIX</text>
        </g>
        <g transform="translate(80,490)">
          <rect width={420} height={6} rx={3} fill="var(--line-strong)" />
          <motion.rect height={6} rx={3} fill="var(--signal)" initial={false} animate={{ width: room ? 260 : 0 }} transition={t} />
          <circle cx={260} cy={3} r={7} fill="var(--bg)" stroke="var(--signal)" strokeWidth={2} />
          <text x={0} y={-8} fontSize="11" fill="var(--text-faint)">CHRONOREPLAY</text>
        </g>
      </motion.g>

      {/* legend */}
      <motion.g initial={false} animate={{ opacity: fused ? 1 : 0 }} transition={t} fontSize="11">
        <line x1="80" y1="18" x2="105" y2="18" stroke="var(--signal)" strokeWidth={2} />
        <text x="110" y="22" fill="var(--text-dim)">verified transfer</text>
        <line x1="225" y1="18" x2="250" y2="18" stroke="var(--intel)" strokeWidth={2} strokeDasharray="6 5" />
        <text x="255" y="22" fill="var(--text-dim)">source assertion</text>
        <line x1="370" y1="18" x2="395" y2="18" stroke="var(--hypo)" strokeWidth={2} strokeDasharray="2 5" />
        <text x="400" y="22" fill="var(--text-dim)">inference</text>
      </motion.g>
    </svg>
  )
}
