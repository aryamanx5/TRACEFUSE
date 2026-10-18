import { motion, useReducedMotion, useScroll, useSpring } from 'framer-motion'
import { useCallback, useEffect, useState } from 'react'
import '../features/landing/landing.css'
import { useCharacterGaze } from '../components/useCharacterGaze'
import { Capabilities } from '../features/landing/Capabilities'
import { CHAPTERS } from '../features/landing/chapters'
import { Enter, Footer, Manifesto } from '../features/landing/Finale'
import { Hero } from '../features/landing/Hero'
import { ChapterRail, LandingNav } from '../features/landing/LandingNav'
import { useNarrow } from '../features/landing/hooks'
import { Disconnected, Fragmentation, Fusion } from '../features/landing/Story'
import { Crew, Ticker } from '../features/landing/Crew'

/** Respect Data Saver: keep the poster, skip the 4–5 MB scrub clip. */
function saveData() {
  const c = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
  return Boolean(c?.saveData)
}

/**
 * The TRACEFUSE story: a cinematic opening, three pinned chapters that explain the problem with dimensional
 * artwork, an editorial capability spread, a statement of principle and the product reveal.
 */
export default function Landing() {
  const reduced = useReducedMotion() ?? false
  const narrow = useNarrow()
  const [active, setActive] = useState(0)
  useCharacterGaze(!reduced)
  const { scrollYProgress } = useScroll()
  const progress = useSpring(scrollYProgress, { stiffness: 140, damping: 30 })

  useEffect(() => {
    const els = CHAPTERS.map((c) => document.getElementById(c.id)).filter(Boolean) as HTMLElement[]
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive(Number((e.target as HTMLElement).dataset.stage))
      },
      { rootMargin: '-50% 0px -50% 0px' },
    )
    els.forEach((s) => io.observe(s))
    return () => io.disconnect()
  }, [])

  const goTo = useCallback((id: string) => {
    const el = document.getElementById(id)
    if (!el) return
    const i = CHAPTERS.findIndex((c) => c.id === id)
    // pinned chapters: land in the middle of their pinned stretch, where the scene is fully composed
    const pinned = el.classList.contains('tfl-pin') && !narrow
    const settle = pinned ? Math.max(0, el.offsetHeight - window.innerHeight) * 0.55 : 0
    window.scrollTo({ top: i === 0 ? 0 : el.getBoundingClientRect().top + window.scrollY + settle, behavior: reduced ? 'auto' : 'smooth' })
    el.querySelector<HTMLElement>('h1, h2')?.focus({ preventScroll: true })
  }, [narrow, reduced])

  return (
    <div className="tfl">
      <a href="#signal-title" className="tfl-skip">Skip to content</a>
      <motion.div className="tfl-progress" style={{ scaleX: reduced ? scrollYProgress : progress }} aria-hidden />
      <LandingNav onAnchor={goTo} />
      <ChapterRail active={active} onGo={goTo} />
      <main id="story">
        <Hero reduced={reduced} narrow={narrow} videoEnabled={!reduced && !saveData()} onNext={() => goTo('fragmentation')} />
        <Ticker words={['Follow the money', 'Find the signal', 'Hop by hop', 'Source by source']} />
        <Fragmentation reduced={reduced} narrow={narrow} />
        <Disconnected reduced={reduced} narrow={narrow} />
        <Fusion reduced={reduced} narrow={narrow} />
        <Crew reduced={reduced} />
        <Ticker words={['Proven by the ledger', 'Asserted by a source', 'Suggested by an algorithm']} tone="ember" reverse />
        <Capabilities reduced={reduced} />
        <Manifesto reduced={reduced} />
        <Enter reduced={reduced} onReplay={() => goTo('signal')} />
      </main>
      <Footer />
    </div>
  )
}
