import { Link } from 'react-router-dom'
import { Wordmark } from '../../components/brand'
import { CHAPTERS, pad } from './chapters'

const ANCHORS = [
  { id: 'fragmentation', label: 'The trail' },
  { id: 'fusion', label: 'Evidence' },
  { id: 'capabilities', label: 'Capabilities' },
]

export function LandingNav({ onAnchor }: { onAnchor: (id: string) => void }) {
  return (
    <header className="tfl-nav">
      <div className="tfl-nav-cluster">
        <a href="#signal" className="tfl-nav-mark" aria-label="TRACEFUSE — back to the start" onClick={(e) => { e.preventDefault(); onAnchor('signal') }}>
          <Wordmark />
        </a>
        <nav aria-label="Story" className="tfl-nav-links">
          {ANCHORS.map((a) => (
            <a key={a.id} href={`#${a.id}`} onClick={(e) => { e.preventDefault(); onAnchor(a.id) }}>{a.label}</a>
          ))}
        </nav>
      </div>
      <Link to="/app" className="tfl-nav-cta">Investigation Room</Link>
    </header>
  )
}

/** Chapter index: a vertical rail of numbered ticks; the current chapter is marked. */
export function ChapterRail({ active, onGo }: { active: number; onGo: (id: string) => void }) {
  return (
    <nav aria-label="Chapter index">
    <ol className="tfl-rail" aria-label="Chapters" data-quiet={active === 0 || undefined}>
      {CHAPTERS.map((c, i) => (
        <li key={c.id}>
          <button type="button" onClick={() => onGo(c.id)} aria-current={active === i ? 'step' : undefined} aria-label={`${pad(i)} ${c.label}`}>
            <span className="tfl-rail-num">{pad(i)}</span>
            <span className="tfl-rail-tick" />
          </button>
        </li>
      ))}
    </ol>
    </nav>
  )
}
