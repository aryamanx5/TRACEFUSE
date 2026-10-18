import { NavLink, Outlet, Link, useLocation } from 'react-router-dom'
import { Wordmark } from './brand'
import { useCharacterGaze } from './useCharacterGaze'

const NAV = [
  { to: '/app', label: 'Overview', end: true },
  { to: '/app/new', label: 'New investigation' },
  { to: '/app/cases', label: 'Casebook' },
  { to: '/app/historical', label: 'Historical case' },
  { to: '/app/challenge', label: 'Challenge' },
  { to: '/app/status', label: 'Sources & health' },
]

/** Application frame: a compact title strip (wordmark + boxed navigation) over a full-width working area. */
export default function AppShell() {
  const { pathname } = useLocation()
  const workspace = pathname.startsWith('/app/investigations/')
  useCharacterGaze()
  return (
    <div className="tf-app">
      <a href="#main" className="skip-link tf-btn">Skip to main content</a>
      <header className="tf-topbar">
        <Link to="/" className="tf-topbar-mark" aria-label="TRACEFUSE — back to the story"><Wordmark /></Link>
        <nav aria-label="Primary" className="tf-topbar-nav">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className="tf-navpill">{n.label}</NavLink>
          ))}
        </nav>
        <p className="tf-topbar-meta" aria-hidden>Forensics <span>×</span> OSINT</p>
      </header>
      <main id="main" tabIndex={-1} className={`tf-main ${workspace ? 'tf-main-wide' : ''}`}>
        <div key={workspace ? 'ws' : pathname} className="tf-route">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
