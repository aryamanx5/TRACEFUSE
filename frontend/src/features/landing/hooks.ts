import { useMotionValue, useScroll } from 'framer-motion'
import { useEffect, useState, type RefObject } from 'react'

/** Phones and small tablets read the story as a normal scrolling page: nothing is pinned. */
export function useNarrow(q = '(max-width: 767px)') {
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(q).matches)
  useEffect(() => {
    if (!window.matchMedia) return
    const m = window.matchMedia(q)
    const on = () => setNarrow(m.matches)
    m.addEventListener?.('change', on)
    return () => m.removeEventListener?.('change', on)
  }, [q])
  return narrow
}

/**
 * Scroll progress for one chapter. Pinned (desktop): 0 when the chapter reaches the top, 1 when its pinned
 * stretch ends. Flowing (phones): 0 as it enters at the bottom, 1 as it leaves at the top.
 * With reduced motion every chapter is shown in its final, fully explained state.
 */
export function useChapterProgress(ref: RefObject<HTMLElement | null>, { reduced, narrow, still = 1 }: { reduced: boolean; narrow: boolean; still?: number }) {
  const { scrollYProgress } = useScroll({ target: ref, offset: narrow ? ['start 0.85', 'end 0.6'] : ['start start', 'end end'] })
  const fixed = useMotionValue(still)
  return reduced ? fixed : scrollYProgress
}
