import { useEffect, useId, useRef, type ReactNode } from 'react'
import type { AssertionStatus } from '../lib/types'
import { STATUS_LABEL, safeHref, short } from '../lib/format'
import { ApiError } from '../lib/api'

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-2 text-dim">
      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-signal border-t-transparent" aria-hidden />
      <span className="text-xs">{label}…</span>
    </span>
  )
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  if (!error) return null
  const e = error as ApiError
  const kind = e instanceof ApiError ? e.kind : undefined
  const title =
    e instanceof ApiError && e.status === 0
      ? 'Offline'
      : kind === 'rate_limited'
        ? 'Rate limited by provider'
        : kind === 'offline'
          ? 'Live providers offline'
          : kind === 'unconfigured'
          ? 'Not configured'
          : e instanceof ApiError && e.status === 404
            ? 'Not found'
            : 'Something went wrong'
  return (
    <div role="alert" className="rounded-lg border border-danger/50 bg-danger/10 p-3 text-sm">
      <p className="font-semibold text-danger">{title}</p>
      <p className="text-dim">{e?.message ?? String(error)}</p>
      {onRetry && (
        <button type="button" className="tf-btn mt-2" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  )
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-line p-8 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="text-sm text-dim">{children}</div>}
    </div>
  )
}

export function StatusPill({ status }: { status: AssertionStatus }) {
  return <span className={`tf-badge status-${status}`}>{STATUS_LABEL[status] ?? status}</span>
}

export function Addr({ a, n = 6, onClick }: { a?: string | null; n?: number; onClick?: () => void }) {
  if (!a) return <span className="text-faint">—</span>
  const content = <span className="mono" title={a}>{short(a, n)}</span>
  return onClick ? (
    <button type="button" className="text-signal2 hover:underline" onClick={onClick} title={a}>
      {content}
    </button>
  ) : (
    content
  )
}

export function ExtLink({ href, children }: { href?: string | null; children: ReactNode }) {
  const safe = safeHref(href)
  if (!safe) return <span>{children}</span>
  return (
    <a href={safe} target="_blank" rel="noopener noreferrer" className="text-signal2 hover:underline">
      {children}
      <span className="sr-only"> (opens in a new tab)</span>
      <span aria-hidden> ↗</span>
    </a>
  )
}

export function Copy({ text }: { text: string }) {
  return (
    <button
      type="button"
      className="ml-1 text-xs text-faint hover:text-ink"
      aria-label="Copy to clipboard"
      onClick={() => void navigator.clipboard?.writeText(text)}
    >
      ⧉
    </button>
  )
}

export function Section({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  const id = useId()
  return (
    <section className="tf-panel p-4" aria-labelledby={id}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 id={id} className="text-sm font-semibold tracking-wide text-dim uppercase">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  )
}

/** Modal dialog: native showModal() gives focus containment, Escape-to-close and an inert background;
 *  focus returns to the element that opened it. */
export function Dialog({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useEffect(() => {
    const d = ref.current
    if (!open || !d) return
    const opener = document.activeElement as HTMLElement | null
    if (typeof d.showModal === 'function') d.showModal()
    else d.setAttribute('open', '') // environments without <dialog> support (e.g. jsdom)
    return () => {
      if (typeof d.close === 'function' && d.open) d.close()
      opener?.focus?.()
    }
  }, [open])
  if (!open) return null
  return (
    <dialog ref={ref} onCancel={(e) => { e.preventDefault(); onClose() }} aria-labelledby={titleId}
      className="m-auto max-w-lg rounded-xl border border-line bg-panel p-0 text-ink backdrop:bg-black/60">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 id={titleId} className="font-semibold">{title}</h2>
        <button type="button" className="text-dim hover:text-ink" onClick={onClose} aria-label="Close dialog">✕</button>
      </div>
      <div className="p-4">{children}</div>
    </dialog>
  )
}

export function Toast({ message, onDone }: { message: string | null; onDone: () => void }) {
  useEffect(() => {
    if (!message) return
    const t = setTimeout(onDone, 3200)
    return () => clearTimeout(t)
  }, [message, onDone])
  if (!message) return null
  return (
    <div role="status" aria-live="polite" className="fixed bottom-4 right-4 z-50 rounded-lg border border-signal/40 bg-panel px-4 py-2 text-sm shadow-lg">
      {message}
    </div>
  )
}

/** WAI-ARIA tabs: one tab stop (roving tabindex); Arrow/Home/End move selection and focus. */
export function Tabs<T extends string>({ tabs, value, onChange, label }: { tabs: { id: T; label: string; count?: number }[]; value: T; onChange: (t: T) => void; label: string }) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({})
  const go = (i: number) => {
    const t = tabs[(i + tabs.length) % tabs.length]
    onChange(t.id)
    refs.current[t.id]?.focus()
  }
  return (
    <div role="tablist" aria-label={label} className="flex flex-wrap gap-1 border-b border-line">
      {tabs.map((t) => (
        <button
          key={t.id}
          ref={(el) => {
            refs.current[t.id] = el
          }}
          role="tab"
          type="button"
          id={`tab-${t.id}`}
          aria-selected={value === t.id}
          aria-controls={`panel-${t.id}`}
          tabIndex={value === t.id ? 0 : -1}
          onClick={() => onChange(t.id)}
          onKeyDown={(e) => {
            const i = tabs.findIndex((x) => x.id === value)
            const keys: Record<string, number> = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }
            if (e.key in keys) {
              e.preventDefault()
              go(keys[e.key])
            }
          }}
          className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${value === t.id ? 'border-signal text-ink' : 'border-transparent text-dim hover:text-ink'}`}
        >
          {t.label}
          {t.count !== undefined && <span className="ml-1.5 text-xs text-faint">{t.count}</span>}
        </button>
      ))}
    </div>
  )
}
