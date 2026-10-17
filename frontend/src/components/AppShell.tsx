import { NavLink, Outlet, Link } from 'react-router-dom'

const NAV = [
  { to: '/app', label: 'Overview', end: true },
  { to: '/app/new', label: 'New investigation' },
  { to: '/app/cases', label: 'Casebook' },
  { to: '/app/historical', label: 'Historical case' },
  { to: '/app/challenge', label: 'Challenge' },
  { to: '/app/status', label: 'Sources & health' },
]

export default function AppShell() {
  return (
    <div className="flex min-h-full flex-col md:flex-row">
      <a href="#main" className="skip-link tf-btn">Skip to main content</a>
      <aside aria-label="Application sidebar" className="border-b border-line bg-elev md:w-56 md:shrink-0 md:border-r md:border-b-0">
        <div className="flex items-center justify-between px-4 py-3 md:block">
          <Link to="/" className="flex items-center gap-2 font-semibold tracking-wide">
            <img src="/favicon.svg" alt="" className="h-6 w-6" /> TRACEFUSE
          </Link>
          <p className="hidden text-[11px] text-faint md:block">Follow the money. Find the signal.</p>
        </div>
        <nav aria-label="Primary" className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-col md:pb-4">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                `whitespace-nowrap rounded-md px-3 py-2 text-sm ${isActive ? 'bg-panel2 text-ink' : 'text-dim hover:bg-panel hover:text-ink'}`
              }
            >
              {n.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <main id="main" tabIndex={-1} className="min-w-0 flex-1 p-3 outline-none md:p-5">
        <Outlet />
      </main>
    </div>
  )
}
