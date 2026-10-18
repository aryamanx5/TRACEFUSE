import { motion, type MotionValue } from 'framer-motion'
import type { ReactNode } from 'react'

/** Rises into view once, the first time it is scrolled to (or immediately with reduced motion). */
export function Reveal({ children, className, delay = 0, reduced, as = 'div', y = 28 }: {
  children: ReactNode; className?: string; delay?: number; reduced: boolean; as?: 'div' | 'p' | 'ul' | 'figure' | 'li' | 'article'; y?: number
}) {
  const M = motion[as]
  if (reduced) return <M className={className}>{children}</M>
  return (
    <M className={className} initial={{ opacity: 0, y }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '0px 0px -12% 0px' }}
      transition={{ duration: 0.9, delay, ease: [0.16, 1, 0.3, 1] }}>
      {children}
    </M>
  )
}

/** One display line rising out of its own mask — on load (intro) or when scrolled into view.
 *  The mask (not the clipped text) is observed, so the trigger works while the text is still hidden. */
export function MaskLine({ children, i = 0, reduced, intro = false, className = '' }: {
  children: ReactNode; i?: number; reduced: boolean; intro?: boolean; className?: string
}) {
  if (reduced) return <span className={`tfl-line ${className}`}><span>{children}</span></span>
  const t = { duration: 1.05, delay: (intro ? 0.3 : 0.05) + i * 0.16, ease: [0.16, 1, 0.3, 1] as const }
  const variants = { hide: { y: '108%', skewY: 7 }, show: { y: '0%', skewY: 0, transition: t } }
  return (
    <motion.span className={`tfl-line ${className}`} initial="hide" {...(intro ? { animate: 'show' } : { whileInView: 'show', viewport: { once: true, margin: '0px 0px -8% 0px' } })}>
      <motion.span variants={variants}>{children}</motion.span>
    </motion.span>
  )
}

/** Small chapter label: index number, hairline, name. */
export function ChapterLabel({ n, children }: { n: string; children: ReactNode }) {
  return (
    <p className="tfl-chlabel">
      <span className="tfl-chlabel-n">{n}</span>
      <span className="tfl-chlabel-rule" aria-hidden />
      {children}
    </p>
  )
}

export type Progress = MotionValue<number>
