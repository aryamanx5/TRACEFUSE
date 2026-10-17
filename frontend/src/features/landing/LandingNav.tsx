import { Link } from 'react-router-dom'

const ANCHORS = [
  { href: '#fragmentation', label: 'The trail' },
  { href: '#fusion', label: 'Evidence' },
  { href: '#enter', label: 'Capabilities' },
]

export function LandingNav({ onAnchor }: { onAnchor: (id: string) => void }) {
  return (
    <header className="tfl-nav">
      <a href="#signal" className="tfl-wordmark" onClick={(e) => { e.preventDefault(); onAnchor('signal') }}>
        TRACEFUSE
      </a>
      <nav aria-label="Story" className="tfl-nav-links">
        {ANCHORS.map((a) => (
          <a key={a.href} href={a.href} onClick={(e) => { e.preventDefault(); onAnchor(a.href.slice(1)) }}>
            {a.label}
          </a>
        ))}
      </nav>
      <Link to="/app" className="tfl-nav-cta">Investigation Room</Link>
    </header>
  )
}
