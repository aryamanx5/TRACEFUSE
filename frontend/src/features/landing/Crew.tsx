import { motion } from 'framer-motion'
import { CAST } from '../../components/cast'
import { Character } from '../../components/characters'
import { MaskLine, Reveal } from './parts'

/**
 * "Meet the crew": the cast lined up on a lit stage. Each character wears one colour of the evidence
 * language, so this doubles as the colour legend used everywhere in the Investigation Room.
 */
export function Crew({ reduced }: { reduced: boolean }) {
  return (
    <section className="tfl-crew" aria-labelledby="crew-title">
      <div className="tfl-crew-head">
        <p className="tf-kicker">The colour code</p>
        <h2 id="crew-title" className="tf-display tfl-h2 tfl-center">
          <MaskLine reduced={reduced} className="tf-thin">Every colour</MaskLine>{' '}
          <MaskLine reduced={reduced} i={1} className="tf-heavy tfl-mint">has a job.</MaskLine>
        </h2>
        <Reveal reduced={reduced} as="p" className="tfl-body tfl-center" delay={0.15}>
          Meet the crew. You will find their colours on every line and node in the Investigation Room.
        </Reveal>
      </div>
      <ul className="tfl-crew-stage">
        {CAST.map((c, i) => (
          <motion.li key={c.kind} className="tfl-crew-member" style={{ '--tone': c.color } as React.CSSProperties}
            initial={reduced ? undefined : { y: 80, opacity: 0 }} whileInView={reduced ? undefined : { y: 0, opacity: 1 }}
            viewport={{ once: true, margin: '0px 0px -10% 0px' }} transition={{ type: 'spring', stiffness: 220, damping: 14, delay: 0.1 + i * 0.09 }}>
            <Character kind={c.kind} size={150} idle={i % 2 ? 'sway' : 'bob'} delay={i * 0.4} flip={i >= 3} />
            <span className="tfl-crew-plinth" aria-hidden />
            <span className="tfl-crew-name">{c.name}</span>
            <span className="tfl-crew-role"><i aria-hidden />{c.role}</span>
          </motion.li>
        ))}
      </ul>
    </section>
  )
}

/** A tilted ticker band between chapters. */
export function Ticker({ words, tone = 'mint', reverse = false }: { words: string[]; tone?: 'mint' | 'ember' | 'violet'; reverse?: boolean }) {
  const row = [...words, ...words, ...words]
  return (
    <div className={`tfl-ticker tfl-ticker-${tone} ${reverse ? 'tfl-ticker-rev' : ''}`} aria-hidden>
      <div className="tfl-ticker-track">
        {[0, 1].map((k) => (
          <span key={k} className="tfl-ticker-run">
            {row.map((w, i) => <span key={i}>{w}<b>✦</b></span>)}
          </span>
        ))}
      </div>
    </div>
  )
}
