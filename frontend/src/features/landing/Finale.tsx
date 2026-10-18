import { motion, useScroll, useTransform } from 'framer-motion'
import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Wordmark } from '../../components/brand'
import { Character } from '../../components/characters'
import { HERO_POSTER, WORKSPACE_SHOT } from './chapters'
import { ChapterLabel, MaskLine, Reveal } from './parts'

/** Interstitial: speed lines rushing to a single statement of principle. */
export function Manifesto({ reduced }: { reduced: boolean }) {
  return (
    <section className="tfl-manifesto" aria-labelledby="manifesto-title">
      <div className="tfl-speed" aria-hidden />
      <div className="tfl-manifesto-box">
        <span className="tfl-mf-mascot tfl-mf-1" aria-hidden><Character kind="knot" size={100} pop={!reduced} idle="sway" /></span>
        <span className="tfl-mf-mascot tfl-mf-2" aria-hidden><Character kind="hexo" size={92} pop={!reduced} delay={0.15} flip /></span>
        <p className="tf-kicker">Principle</p>
        <h2 id="manifesto-title" className="tf-display tfl-h2">
          <MaskLine reduced={reduced} className="tf-thin">Every connection</MaskLine>{' '}
          <MaskLine reduced={reduced} i={1} className="tf-heavy tfl-mint">needs a reason.</MaskLine>
        </h2>
        <Reveal reduced={reduced} as="p" className="tfl-body" delay={0.2}>
          Leads are ranked by an explainable heuristic score — never a probability, never an identity claim. Each link
          says whether the ledger proves it, a source asserts it, or an algorithm only suggests it.
        </Reveal>
      </div>
    </section>
  )
}

/** 06 — The product reveal: the real workspace tilts up into view, then the doors. */
export function Enter({ reduced, onReplay }: { reduced: boolean; onReplay: () => void }) {
  const fig = useRef<HTMLDivElement>(null)
  const { scrollYProgress } = useScroll({ target: fig, offset: ['start end', 'center 0.55'] })
  const rotateX = useTransform(scrollYProgress, [0, 1], [26, 0])
  const scale = useTransform(scrollYProgress, [0, 1], [0.88, 1])
  const [shot, setShot] = useState(WORKSPACE_SHOT)

  return (
    <section id="enter" data-stage={5} aria-labelledby="enter-title" className="tfl-chapter tfl-enter">
      <div className="tfl-enter-head">
        <ChapterLabel n="06">Enter the investigation</ChapterLabel>
        <h2 id="enter-title" className="tf-display tfl-h2 tfl-center tfl-enter-title" tabIndex={-1}>
          <MaskLine reduced={reduced} className="tf-thin">Welcome to the</MaskLine>{' '}
          <MaskLine reduced={reduced} i={1} className="tf-heavy">Investigation Room</MaskLine>
        </h2>
      </div>
      <div ref={fig} className="tfl-reveal">
        <span className="tfl-rv-mascot tfl-rv-1" aria-hidden><Character kind="snoop" size={110} pop={!reduced} /></span>
        <span className="tfl-rv-mascot tfl-rv-2" aria-hidden><Character kind="archie" size={116} pop={!reduced} delay={0.15} idle="sway" /></span>
        <span className="tfl-rv-mascot tfl-rv-3" aria-hidden><Character kind="docket" size={96} pop={!reduced} delay={0.3} flip /></span>
        <motion.figure className="tfl-reveal-frame" style={reduced ? undefined : { rotateX, scale }}>
          <img src={shot} alt="The TRACEFUSE Investigation Room showing the Ronin Bridge case: a fund-flow graph branching right from the starting wallet, with the Inspector beside it."
            loading="lazy" decoding="async" width={1600} height={1000} onError={() => setShot(HERO_POSTER)} />
          <figcaption>Ronin Bridge case, replayed from recorded provider responses.</figcaption>
        </motion.figure>
      </div>
      <div className="tfl-enter-foot">
        <Reveal reduced={reduced} className="tfl-actions tfl-actions-center">
          <Link to="/app" className="tfl-btn tfl-btn-primary tfl-btn-xl">Enter the investigation</Link>
          <Link to="/app/historical" className="tfl-btn tfl-btn-quiet">Explore the Ronin case</Link>
          <Link to="/app/new" className="tfl-btn tfl-btn-quiet">Start an investigation</Link>
        </Reveal>
        <button type="button" className="tfl-replay" onClick={onReplay}>Replay the story</button>
      </div>
    </section>
  )
}

export function Footer() {
  return (
    <footer className="tfl-footer">
      <div className="tfl-footer-mark" aria-hidden>
        <span>TRACEFUSE</span>
        <span className="tfl-ft-mascot" style={{ left: '9%', top: '-14%' }}><Character kind="hexo" size={84} pop /></span>
        <span className="tfl-ft-mascot" style={{ left: '34%', top: '38%' }}><Character kind="knot" size={70} pop delay={0.1} idle="sway" /></span>
        <span className="tfl-ft-mascot" style={{ left: '57%', top: '-10%' }}><Character kind="snoop" size={76} pop delay={0.2} /></span>
        <span className="tfl-ft-mascot" style={{ left: '79%', top: '30%' }}><Character kind="docket" size={72} pop delay={0.3} flip /></span>
        <span className="tfl-ft-mascot" style={{ left: '90%', top: '-20%' }}><Character kind="archie" size={70} pop delay={0.4} /></span>
      </div>
      <div className="tfl-footer-grid">
        <nav aria-label="Workspace" className="tfl-footer-nav">
          <p className="tf-kicker">Workspace</p>
          <Link to="/app">Investigation Room</Link>
          <Link to="/app/new">New investigation</Link>
          <Link to="/app/historical">Ronin case</Link>
          <Link to="/app/cases">Casebook</Link>
          <Link to="/app/challenge">Challenge</Link>
          <Link to="/app/status">Sources &amp; health</Link>
        </nav>
        <div className="tfl-footer-about">
          <Wordmark />
          <p>Open-source blockchain forensics and OSINT. On-chain data from public explorers and node providers; public intelligence from sanctions lists, risk feeds and code repositories — every item kept with its source.</p>
          <p className="tfl-footer-fine">
            Scene footage is generated imagery. Diagrams on this page are illustrative; case facts come from the public
            Ronin Bridge record. Scores are heuristics, not probabilities; no identity is attributed automatically.
          </p>
        </div>
      </div>
      <div className="tfl-footer-base">
        <span>TRACEFUSE · Ghost Attacks</span>
        <span>Follow the money. Find the signal.</span>
      </div>
    </footer>
  )
}
