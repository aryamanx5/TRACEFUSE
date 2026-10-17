import { useReducedMotion } from 'framer-motion'
import { useRef } from 'react'
import { Link } from 'react-router-dom'
import '../features/landing/landing.css'
import { LandingNav } from '../features/landing/LandingNav'
import { ScrollStory, type StoryHandle } from '../features/landing/ScrollStory'

/** Respect Data Saver: keep the poster, skip the 4–5 MB scrub clip. */
function saveData() {
  const c = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
  return Boolean(c?.saveData)
}

export default function Landing() {
  const reduced = useReducedMotion() ?? false
  const story = useRef<StoryHandle>(null)

  return (
    <div className="tfl">
      <a href="#signal-title" className="tfl-skip">Skip to content</a>
      <LandingNav onAnchor={(id) => story.current?.goTo(id)} />
      <main id="story">
        <ScrollStory ref={story} reduced={reduced} videoEnabled={!reduced && !saveData()} />
      </main>
      <footer className="tfl-footer">
        <p className="tfl-footer-mark" aria-hidden>TRACEFUSE</p>
        <div className="tfl-footer-row">
          <nav aria-label="Workspace">
            <Link to="/app">Investigation Room</Link>
            <Link to="/app/new">New investigation</Link>
            <Link to="/app/historical">Ronin case</Link>
            <Link to="/app/cases">Casebook</Link>
            <Link to="/app/status">Sources &amp; health</Link>
          </nav>
          <p>
            Scene footage is generated imagery, used as illustration. Diagrams on this page are illustrative; case facts
            come from the public Ronin Bridge record.
          </p>
        </div>
      </footer>
    </div>
  )
}
