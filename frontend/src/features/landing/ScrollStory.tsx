import { useScroll } from 'framer-motion'
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Chapter, Headline, Reveal } from './Chapter'
import { CHAPTERS, HERO_POSTER, HERO_VIDEO, pad } from './chapters'
import { FlowGraphic, FusionGraphic, FusionLegend } from './Graphics'
import { useScrubVideo } from './useScrubVideo'

export type StoryHandle = { goTo: (id: string) => void; replay: () => void }

/**
 * The pinned cinematic sequence: a full-viewport scene whose footage is scrubbed by scroll position,
 * with five chapters of typography travelling over it.
 */
export const ScrollStory = forwardRef<StoryHandle, { reduced: boolean; videoEnabled: boolean }>(
  function ScrollStory({ reduced, videoEnabled }, handle) {
    const container = useRef<HTMLDivElement>(null)
    const stage = useRef<HTMLDivElement>(null)
    const sections = useRef<(HTMLElement | null)[]>([])
    const [active, setActive] = useState(0)
    const { scrollYProgress } = useScroll({ target: container, offset: ['start start', 'end end'] })
    const { videoRef, state } = useScrubVideo({ src: HERO_VIDEO, progress: scrollYProgress, enabled: videoEnabled, stage })

    useEffect(() => {
      const io = new IntersectionObserver(
        (entries) => {
          for (const e of entries) if (e.isIntersecting) setActive(Number((e.target as HTMLElement).dataset.stage))
        },
        { rootMargin: '-50% 0px -50% 0px' },
      )
      sections.current.forEach((s) => s && io.observe(s))
      return () => io.disconnect()
    }, [])

    const goTo = (id: string) => {
      const i = CHAPTERS.findIndex((c) => c.id === id)
      const el = sections.current[i]
      if (!el) return
      // Land where the chapter's text is fully settled (its pinned stretch), not at the section's edge.
      const settle = i === 0 ? 0 : el.offsetHeight > window.innerHeight ? (el.offsetHeight - window.innerHeight) * 0.5 : 0
      window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY + settle, behavior: reduced ? 'auto' : 'smooth' })
      el.querySelector<HTMLElement>('.tfl-display')?.focus({ preventScroll: true })
    }
    useImperativeHandle(handle, () => ({ goTo, replay: () => goTo('signal') }))

    const register = (i: number, el: HTMLElement | null) => {
      sections.current[i] = el
    }

    return (
      <div ref={container} className="tfl-story" data-chapter={active} data-media={state}>
        <div ref={stage} className="tfl-stage" aria-hidden>
          <img className="tfl-media" src={HERO_POSTER} alt="" width={1280} height={720} fetchPriority="high" decoding="async" />
          {videoEnabled && (
            <video ref={videoRef} className="tfl-media tfl-video" muted playsInline preload="auto" disablePictureInPicture
              disableRemotePlayback tabIndex={-1} />
          )}
          <div className="tfl-scrim" />
          <div className="tfl-spot" />
          <div className="tfl-dim" />
        </div>


        <div className="tfl-chapters">
          <Chapter index={0} reduced={reduced} layout="tfl-l-hero" register={register}>
            {(p) => (
              <>
                <Headline as="h1" id="signal-title" lines={['Follow the money.', 'Find the signal.']} progress={p}
                  reduced={reduced} intro className="tfl-display-xl"
                  before={<span className="tfl-line tfl-brandline"><BrandLine reduced={reduced} /></span>} />
                <Reveal progress={p} at={0} reduced={reduced} intro delay={1.05} className="tfl-hero-foot">
                  <p className="tfl-lede">Blockchain forensics and open-source intelligence, connected through evidence.</p>
                  <div className="tfl-actions">
                    <Link to="/app" className="tfl-btn tfl-btn-primary">Explore the investigation</Link>
                    <a href="#fragmentation" className="tfl-btn tfl-btn-quiet" onClick={(e) => { e.preventDefault(); goTo('fragmentation') }}>
                      Discover how it works
                    </a>
                  </div>
                </Reveal>
                <p className="tfl-scrollcue" aria-hidden><span />Scroll to move through the case</p>
              </>
            )}
          </Chapter>

          <Chapter index={1} reduced={reduced} layout="tfl-l-split" register={register}>
            {(p) => (
              <>
                <Headline id="fragmentation-title" lines={['One exploit.', 'Hundreds of paths.']} progress={p} reduced={reduced} />
                <Reveal progress={p} at={0.26} reduced={reduced} as="p" className="tfl-body">
                  Stolen funds rarely sit still. They are split across fresh wallets, relayed within minutes and pushed
                  toward bridges and mixers. Every hop is another thread to follow.
                </Reveal>
                <Reveal progress={p} at={0.2} reduced={reduced} as="figure" className="tfl-figure tfl-figure-flow">
                  <FlowGraphic progress={p} reduced={reduced} />
                  <figcaption>Illustrative branching path — not live transaction data.</figcaption>
                </Reveal>
              </>
            )}
          </Chapter>

          <Chapter index={2} reduced={reduced} layout="tfl-l-columns" register={register}>
            {(p) => (
              <>
                <Headline id="disconnected-title" lines={['The clues exist.', 'They don’t connect.']} progress={p} reduced={reduced} />
                <div className="tfl-sources">
                  <Reveal progress={p} at={0.24} reduced={reduced} className="tfl-source">
                    <h3>Blockchain ledger</h3>
                    <dl className="tfl-ledger">
                      <div><dt>Transaction</dt><dd className="tfl-mono">0xc28fad5e…67d0b7</dd></div>
                      <div><dt>Amount</dt><dd className="tfl-mono">173,600 ETH</dd></div>
                      <div><dt>From → to</dt><dd className="tfl-mono">Ronin Bridge V1 → 0x098B…2f96</dd></div>
                      <div><dt>Block</dt><dd className="tfl-mono">14442835 · 2022-03-23</dd></div>
                      <div><dt>Next</dt><dd>Split across new wallets</dd></div>
                    </dl>
                  </Reveal>
                  <div className="tfl-gap" aria-hidden><span /><span /></div>
                  <Reveal progress={p} at={0.3} reduced={reduced} className="tfl-source">
                    <h3>Open-source intelligence</h3>
                    <dl className="tfl-ledger">
                      <div><dt>Sanctions</dt><dd>OFAC, 14 Apr 2022: address added to the Lazarus Group entry</dd></div>
                      <div><dt>Public report</dt><dd>Incident write-up describing the validator-key compromise</dd></div>
                      <div><dt>Risk feed</dt><dd>Address flagged as sanctioned and linked to theft</dd></div>
                      <div><dt>Repositories</dt><dd>Code and issue trackers, searched for the address</dd></div>
                    </dl>
                  </Reveal>
                </div>
                <Reveal progress={p} at={0.34} reduced={reduced} as="p" className="tfl-note">
                  Public record from the Ronin Bridge case, March 2022, shown the way it is usually found: in separate places.
                </Reveal>
              </>
            )}
          </Chapter>

          <Chapter index={3} reduced={reduced} layout="tfl-l-fusion" register={register}>
            {(p) => (
              <>
                <Reveal progress={p} at={0.16} reduced={reduced} as="figure" className="tfl-figure tfl-figure-fusion">
                  <FusionGraphic progress={p} reduced={reduced} />
                  <figcaption>
                    <FusionLegend />
                    <span>Illustrative diagram.</span>
                  </figcaption>
                </Reveal>
                <div className="tfl-fusion-text">
                  <Headline id="fusion-title" lines={['Connect the evidence.', 'Not just the dots.']} progress={p} reduced={reduced} />
                  <Reveal progress={p} at={0.28} reduced={reduced} as="p" className="tfl-body">
                    TRACEFUSE ties each transfer to the public source that mentions it, and keeps three kinds of connection
                    apart: what the ledger proves, what a source asserts, and what an algorithm only suggests.
                  </Reveal>
                </div>
              </>
            )}
          </Chapter>

          <Chapter index={4} reduced={reduced} layout="tfl-l-enter" register={register}>
            {(p) => (
              <>
                <Headline id="enter-title" lines={['Every connection', 'needs a reason.']} progress={p} reduced={reduced} />
                <div className="tfl-enter-foot">
                  <Reveal progress={p} at={0.24} reduced={reduced} as="ul" className="tfl-caps">
                    <li><strong>Trace</strong> cryptocurrency movements, hop by hop.</li>
                    <li><strong>Connect</strong> on-chain activity with public intelligence.</li>
                    <li><strong>Inspect</strong> explainable leads and the evidence behind them.</li>
                    <li><strong>Investigate</strong> relationships with interactive graph and timeline tools.</li>
                  </Reveal>
                  <Reveal progress={p} at={0.3} reduced={reduced} className="tfl-enter-cta">
                    <div className="tfl-actions">
                      <Link to="/app" className="tfl-btn tfl-btn-primary">Enter Investigation Room</Link>
                      <button type="button" className="tfl-btn tfl-btn-quiet" onClick={() => goTo('signal')}>Replay the story</button>
                    </div>
                    <p className="tfl-note">Leads are ranked by an explainable heuristic score — never a probability, never an identity claim.</p>
                  </Reveal>
                </div>
              </>
            )}
          </Chapter>
        </div>

        <div className="tfl-index-rail">
        <ol className="tfl-index" aria-label="Chapters">
          {CHAPTERS.map((c, i) => (
            <li key={c.id}>
              <button type="button" onClick={() => goTo(c.id)} aria-current={active === i ? 'step' : undefined}
                aria-label={`${pad(i)} ${c.label}`}>
                <span className="tfl-index-tick" />
                <span className="tfl-index-num">{pad(i)}</span>
              </button>
            </li>
          ))}
        </ol>
        </div>
      </div>
    )
  },
)

function BrandLine({ reduced }: { reduced: boolean }) {
  return reduced ? <span>TRACEFUSE</span> : <span className="tfl-brand-in">TRACEFUSE</span>
}
