import { motion, useTransform } from 'framer-motion'
import { useRef } from 'react'
import { Link } from 'react-router-dom'
import { Character } from '../../components/characters'
import { HERO_POSTER, HERO_VIDEO } from './chapters'
import { useChapterProgress } from './hooks'
import { MaskLine, Reveal } from './parts'
import { useScrubVideo } from './useScrubVideo'

/**
 * 01 — The opening. The operations-room footage fills the screen and is scrubbed by scroll (the camera
 * pushes in towards the monitor); the manifesto slab lifts away and the scene darkens into the next chapter.
 */
export function Hero({ reduced, narrow, videoEnabled, onNext }: { reduced: boolean; narrow: boolean; videoEnabled: boolean; onNext: () => void }) {
  const ref = useRef<HTMLElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const p = useChapterProgress(ref, { reduced, narrow, still: 0 })
  const { videoRef, state } = useScrubVideo({ src: HERO_VIDEO, progress: p, enabled: videoEnabled, stage })

  const mediaScale = useTransform(p, [0, 1], [1.02, 1.14])
  const slabY = useTransform(p, [0, 1], ['0vh', '-16vh'])
  const slabOpacity = useTransform(p, [0.5, 0.85], [1, 0])
  const veil = useTransform(p, [0.55, 1], [0, 0.92])
  const s1 = useTransform(p, [0, 1], ['0vh', '-30vh'])
  const s2 = useTransform(p, [0, 1], ['0vh', '-44vh'])
  const s3 = useTransform(p, [0, 1], ['0vh', '-22vh'])
  const s4 = useTransform(p, [0, 1], ['0vh', '-38vh'])
  const still = reduced || narrow

  return (
    <section ref={ref} id="signal" data-stage={0} data-media={state} aria-labelledby="signal-title" className="tfl-hero tfl-chapter">
      <div className="tfl-pin-stage tfl-hero-stage">
        <div ref={stage} className="tfl-hero-media" aria-hidden>
          <motion.div className="tfl-hero-zoom" style={still ? undefined : { scale: mediaScale }}>
            <img className="tfl-media" src={HERO_POSTER} alt="" width={1280} height={720} fetchPriority="high" decoding="async" />
            {videoEnabled && (
              <video ref={videoRef} className="tfl-media tfl-video" muted playsInline preload="auto" disablePictureInPicture
                disableRemotePlayback tabIndex={-1} />
            )}
          </motion.div>
          <div className="tfl-hero-scrim" />
          <div className="tfl-hero-scan" />
          <motion.div className="tfl-hero-veil" style={still ? { opacity: 0 } : { opacity: veil }} />
        </div>

        <motion.div className="tfl-hero-body" style={still ? undefined : { y: slabY, opacity: slabOpacity }}>
          <div className="tfl-hero-slabwrap">
            <motion.span className="tfl-hero-sigil tfl-hs-1" style={still ? undefined : { y: s1 }} aria-hidden><Character kind="hexo" size={128} pop={!reduced} delay={1.3} /></motion.span>
            <motion.span className="tfl-hero-sigil tfl-hs-2" style={still ? undefined : { y: s2 }} aria-hidden><Character kind="docket" size={112} pop={!reduced} delay={1.45} idle="sway" /></motion.span>
            <motion.span className="tfl-hero-sigil tfl-hs-3" style={still ? undefined : { y: s3 }} aria-hidden><Character kind="snoop" size={104} pop={!reduced} delay={1.6} /></motion.span>
            <motion.span className="tfl-hero-sigil tfl-hs-4" style={still ? undefined : { y: s4 }} aria-hidden><Character kind="knot" size={100} pop={!reduced} delay={1.75} idle="sway" /></motion.span>
            <h1 id="signal-title" className="tfl-hero-title" tabIndex={-1}>
              <MaskLine reduced={reduced} intro className="tfl-hero-brand">TRACEFUSE</MaskLine>{' '}
              <MaskLine reduced={reduced} intro i={1} className="tfl-hero-thin">Follow the money.</MaskLine>{' '}
              <motion.span className="tfl-hero-slab" initial={reduced ? false : { scale: 1.35, rotate: -4, opacity: 0 }} animate={{ scale: 1, rotate: 0, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 320, damping: 16, delay: 0.75 }}>
                <MaskLine reduced={reduced} intro i={2} className="tfl-hero-heavy">Find the signal.</MaskLine>
              </motion.span>
            </h1>
          </div>
          <Reveal reduced={reduced} delay={1.05} className="tfl-hero-foot">
            <p className="tfl-lede">Blockchain forensics and open-source intelligence, connected through evidence.</p>
            <div className="tfl-actions">
              <Link to="/app" className="tfl-btn tfl-btn-primary">Enter the investigation</Link>
              <a href="#fragmentation" className="tfl-btn tfl-btn-quiet" onClick={(e) => { e.preventDefault(); onNext() }}>See how it works</a>
            </div>
          </Reveal>
        </motion.div>

        <div className="tfl-hero-meta" aria-hidden>
          <span>On-chain</span><i /><span>Open source</span><i /><span>Evidence</span>
        </div>
        <p className="tfl-scrollcue" aria-hidden><span />Scroll</p>
      </div>
    </section>
  )
}
