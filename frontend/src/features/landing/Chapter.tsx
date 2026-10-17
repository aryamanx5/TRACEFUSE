import { motion, useScroll, useTransform, type MotionValue } from 'framer-motion'
import { Fragment, useRef, type ReactNode } from 'react'
import { CHAPTERS, pad } from './chapters'

/**
 * One narrative chapter. The section is taller than the viewport; its content is pinned inside it, so the
 * text holds still while the scene behind keeps moving, then hands over to the next chapter.
 * `progress` (0 → section enters at the bottom, 1 → section has left at the top) drives local reveals.
 */
export function Chapter({
  index,
  reduced,
  layout,
  children,
  register,
}: {
  index: number
  reduced: boolean
  layout: string
  children: (progress: MotionValue<number>) => ReactNode
  register: (i: number, el: HTMLElement | null) => void
}) {
  const ch = CHAPTERS[index]
  const first = index === 0
  const last = index === CHAPTERS.length - 1
  const ref = useRef<HTMLElement | null>(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] })
  const opacity = useTransform(
    scrollYProgress,
    first ? [0.6, 0.8] : last ? [0.12, 0.32] : [0.12, 0.3, 0.66, 0.86],
    first ? [1, 0] : last ? [0, 1] : [0, 1, 1, 0],
  )
  const y = useTransform(scrollYProgress, [0, 0.4, 0.6, 1], [first ? 0 : 48, 0, 0, -48])

  return (
    <section
      ref={(el) => {
        ref.current = el
        register(index, el)
      }}
      id={ch.id}
      data-stage={index}
      aria-labelledby={`${ch.id}-title`}
      className="tfl-chapter"
      style={{ '--tfl-h': `${ch.height}` } as React.CSSProperties}
    >
      <motion.div className={`tfl-chapter-inner ${layout}`} style={reduced ? undefined : { opacity, y }}>
        <p className="tfl-kicker">
          <span className="tfl-kicker-num">{pad(index)}</span> {ch.label}
        </p>
        {children(scrollYProgress)}
      </motion.div>
    </section>
  )
}

/** Oversized editorial headline; each line rises out of its own mask, either on load or with scroll. */
export function Headline({
  as: Tag = 'h2',
  id,
  lines,
  progress,
  reduced,
  intro = false,
  className = '',
  before,
}: {
  as?: 'h1' | 'h2'
  id: string
  lines: string[]
  progress: MotionValue<number>
  reduced: boolean
  intro?: boolean
  className?: string
  before?: ReactNode
}) {
  return (
    <Tag id={id} className={`tfl-display ${className}`} tabIndex={-1}>
      {before}
      {lines.map((l, i) => (
        <Fragment key={l}>
          {(i > 0 || before) && ' '}
          <Line text={l} i={i} progress={progress} reduced={reduced} intro={intro} offset={before ? 1 : 0} />
        </Fragment>
      ))}
    </Tag>
  )
}

function Line({ text, i, progress, reduced, intro, offset }: {
  text: string; i: number; progress: MotionValue<number>; reduced: boolean; intro: boolean; offset: number
}) {
  const start = 0.14 + i * 0.05
  const y = useTransform(progress, [start, start + 0.14], ['105%', '0%'])
  if (reduced) return <span className="tfl-line"><span>{text}</span></span>
  if (intro)
    return (
      <span className="tfl-line">
        <motion.span
          initial={{ y: '105%' }}
          animate={{ y: '0%' }}
          transition={{ duration: 1.1, delay: 0.35 + (i + offset) * 0.22, ease: [0.16, 1, 0.3, 1] }}
        >
          {text}
        </motion.span>
      </span>
    )
  return (
    <span className="tfl-line">
      <motion.span style={{ y }}>{text}</motion.span>
    </span>
  )
}

/** A small block that rises in with scroll after the headline (or on load for the opening chapter). */
export function Reveal({ progress, at, reduced, intro, delay = 0, className, children, as = 'div' }: {
  progress: MotionValue<number>; at: number; reduced: boolean; intro?: boolean; delay?: number
  className?: string; children: ReactNode; as?: 'div' | 'p' | 'ul' | 'figure'
}) {
  const opacity = useTransform(progress, [at, at + 0.1], [0, 1])
  const y = useTransform(progress, [at, at + 0.12], [24, 0])
  const M = motion[as]
  if (reduced) return <M className={className}>{children}</M>
  if (intro)
    return (
      <M className={className} initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.9, delay, ease: [0.16, 1, 0.3, 1] }}>
        {children}
      </M>
    )
  return <M className={className} style={{ opacity, y }}>{children}</M>
}
