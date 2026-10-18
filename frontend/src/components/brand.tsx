import type { CSSProperties, ReactNode } from 'react'
import type { CharacterKind } from './cast'
import { Character } from './characters'

/*
 * TRACEFUSE brand primitives shared by the story and the Investigation Room: the wordmark, the two-tone
 * editorial headline and the "sigils" — small dimensional objects standing for the things an investigator
 * handles (a wallet, a piece of evidence, a lens, a link, a bridge, a ledger block). They are decoration:
 * always aria-hidden and never used to convey data.
 */

export type SigilKind = 'node' | 'shard' | 'lens' | 'link' | 'bridge' | 'cube'

const OUT = '#0e0f10'

export function Sigil({ kind, className = '', style }: { kind: SigilKind; className?: string; style?: CSSProperties }) {
  return (
    <svg viewBox="0 0 64 64" className={`tf-sigil ${className}`} style={style} aria-hidden focusable="false">
      {kind === 'node' && (
        <g strokeLinejoin="round">
          <ellipse cx="32" cy="34" rx="29" ry="9" fill="none" stroke="#3fd0ff" strokeWidth="2" strokeDasharray="5 4" transform="rotate(-16 32 34)" />
          <path d="M32 6 54 18v26L32 56 10 44V18Z" fill="#5ef2c2" stroke={OUT} strokeWidth="3" />
          <path d="M32 6 54 18 32 30 10 18Z" fill="#9ffbe0" stroke={OUT} strokeWidth="3" />
          <path d="M32 30v26" stroke={OUT} strokeWidth="3" />
          <rect x="18" y="30" width="8" height="8" fill={OUT} transform="skewY(28) translate(0 -14)" />
          <circle cx="44" cy="36" r="3" fill={OUT} />
        </g>
      )}
      {kind === 'shard' && (
        <g strokeLinejoin="round">
          <path d="M14 6h26l12 12v40H14Z" fill="#a99bff" stroke={OUT} strokeWidth="3" />
          <path d="M40 6v12h12" fill="#d6cfff" stroke={OUT} strokeWidth="3" />
          <path d="M21 26h22M21 33h22M21 40h14" stroke={OUT} strokeWidth="3" strokeLinecap="square" />
          <circle cx="44" cy="48" r="7" fill="#ff7a3d" stroke={OUT} strokeWidth="3" />
          <path d="m41 48 2 2 4-4" stroke={OUT} strokeWidth="2.4" fill="none" />
        </g>
      )}
      {kind === 'lens' && (
        <g strokeLinejoin="round">
          <path d="m40 40 16 16" stroke={OUT} strokeWidth="11" strokeLinecap="square" />
          <path d="m40 40 16 16" stroke="#3fd0ff" strokeWidth="5" strokeLinecap="square" />
          <circle cx="27" cy="27" r="19" fill="#0e0f10" stroke="#3fd0ff" strokeWidth="6" />
          <circle cx="27" cy="27" r="19" fill="none" stroke={OUT} strokeWidth="1.5" />
          <path d="M27 14v26M14 27h26" stroke="#5ef2c2" strokeWidth="2" />
          <circle cx="27" cy="27" r="5" fill="#5ef2c2" stroke={OUT} strokeWidth="2" />
          <path d="M16 20a13 13 0 0 1 7-7" stroke="#f1efe7" strokeWidth="3" fill="none" strokeLinecap="round" />
        </g>
      )}
      {kind === 'link' && (
        <g strokeLinejoin="round">
          <rect x="5" y="20" width="32" height="20" rx="10" fill="none" stroke={OUT} strokeWidth="11" transform="rotate(-30 21 30)" />
          <rect x="5" y="20" width="32" height="20" rx="10" fill="none" stroke="#ffb03a" strokeWidth="6" transform="rotate(-30 21 30)" />
          <rect x="27" y="24" width="32" height="20" rx="10" fill="none" stroke={OUT} strokeWidth="11" transform="rotate(-30 43 34)" />
          <rect x="27" y="24" width="32" height="20" rx="10" fill="none" stroke="#ffd27a" strokeWidth="6" transform="rotate(-30 43 34)" />
        </g>
      )}
      {kind === 'bridge' && (
        <g strokeLinejoin="round">
          <path d="M3 46c8-4 14 4 22 0s14 4 22 0 10 2 14 0" stroke="#3fd0ff" strokeWidth="3" fill="none" />
          <path d="M6 40V22h8c4 10 32 10 36 0h8v18h-8V30c-8 8-28 8-36 0v10Z" fill="#ff7a3d" stroke={OUT} strokeWidth="3" />
          <path d="M6 22h52" stroke={OUT} strokeWidth="3" />
          <rect x="3" y="14" width="14" height="8" fill="#5ef2c2" stroke={OUT} strokeWidth="3" />
          <rect x="47" y="14" width="14" height="8" fill="#a99bff" stroke={OUT} strokeWidth="3" />
        </g>
      )}
      {kind === 'cube' && (
        <g strokeLinejoin="round">
          <path d="M32 6 56 19v26L32 58 8 45V19Z" fill="#202224" stroke={OUT} strokeWidth="3" />
          <path d="M32 6 56 19 32 32 8 19Z" fill="#f1efe7" stroke={OUT} strokeWidth="3" />
          <path d="M32 32v26M8 19l24 13 24-13" stroke={OUT} strokeWidth="3" fill="none" />
          <path d="M14 26v20M20 29v20M26 32v20M8 32l24 13M8 39l24 13" stroke="#5ef2c2" strokeWidth="1.2" opacity=".8" />
          <path d="M38 32v20M44 29v20M50 26v20M56 32 32 45M56 39 32 52" stroke="#ff7a3d" strokeWidth="1.2" opacity=".85" />
        </g>
      )}
    </svg>
  )
}

/** A sigil placed absolutely inside a positioned parent, gently bobbing (animation stops for reduced motion). */
export function FloatingSigil({ kind, x, y, size = 56, r = 0, delay = 0, className = '' }: {
  kind: SigilKind; x: string; y: string; size?: number; r?: number; delay?: number; className?: string
}) {
  return (
    <span className={`pointer-events-none absolute ${className}`} style={{ left: x, top: y, width: size }} aria-hidden>
      <span className="tf-float block" style={{ '--r': `${r}deg`, animationDelay: `${delay}s` } as CSSProperties}>
        <Sigil kind={kind} />
      </span>
    </span>
  )
}

/** Wordmark: heavy, slightly expanded caps in a notched slab. */
export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <span className={`tf-wordmark ${className}`}>
      <svg viewBox="0 0 32 32" className="tf-wordmark-glyph" aria-hidden focusable="false">
        <path d="M8 16h6m0 0 6-7m-6 7 6 7m-6-7h10" stroke="currentColor" strokeWidth="2.4" fill="none" strokeLinecap="square" />
        <rect x="4" y="12.5" width="7" height="7" fill="currentColor" />
        <rect x="19" y="6" width="4.5" height="4.5" fill="var(--intel)" />
        <rect x="19" y="21.5" width="4.5" height="4.5" fill="var(--ember)" />
        <rect x="23.5" y="13.8" width="4.5" height="4.5" fill="var(--text)" />
      </svg>
      TRACEFUSE
    </span>
  )
}

/** Two-tone editorial heading: a condensed lead line and a heavy statement line. */
export function TwoTone({ thin, heavy, as: Tag = 'h2', id, className = '', thinClass = '', heavyClass = '', tabIndex }: {
  thin: ReactNode; heavy: ReactNode; as?: 'h1' | 'h2' | 'h3'; id?: string; className?: string; thinClass?: string; heavyClass?: string; tabIndex?: number
}) {
  return (
    <Tag id={id} className={`tf-display ${className}`} tabIndex={tabIndex}>
      <span className={`tf-thin ${thinClass}`}>{thin}</span> <span className={`tf-heavy ${heavyClass}`}>{heavy}</span>
    </Tag>
  )
}

/** Page heading used across the app: a small mono kicker, a heavy display title and an optional one-line lede. */
export function PageHead({ kicker, title, lede, actions, mascot }: { kicker: string; title: string; lede?: ReactNode; actions?: ReactNode; mascot?: CharacterKind }) {
  return (
    <header className="tf-pagehead">
      {mascot && <span className="tf-pagehead-mascot" aria-hidden><Character kind={mascot} size={84} pop /></span>}
      <div className="min-w-0">
        <p className="tf-kicker"><span className="tf-kicker-dot" aria-hidden />{kicker}</p>
        <h1 className="tf-pagehead-title">{title}</h1>
        {lede && <p className="tf-pagehead-lede">{lede}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}
