import { useEffect } from 'react'

/**
 * Eyes follow the pointer: one window listener, throttled to animation frames, writes each visible
 * character's gaze into CSS variables. Does nothing when motion is reduced or on touch-only devices.
 */
export function useCharacterGaze(enabled = true) {
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    let raf = 0
    let px = 0
    let py = 0
    const update = () => {
      raf = 0
      const vh = window.innerHeight
      for (const el of Array.from(document.querySelectorAll<HTMLElement>('.tfc'))) {
        const r = el.getBoundingClientRect()
        if (r.bottom < -50 || r.top > vh + 50) continue
        const dx = px - (r.left + r.width / 2)
        const dy = py - (r.top + r.height * 0.45)
        const d = Math.max(1, Math.hypot(dx, dy))
        const k = Math.min(1, d / 240)
        el.style.setProperty('--lx', ((dx / d) * k).toFixed(3))
        el.style.setProperty('--ly', ((dy / d) * k).toFixed(3))
      }
    }
    const onMove = (e: PointerEvent) => {
      px = e.clientX
      py = e.clientY
      if (!raf) raf = requestAnimationFrame(update)
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => {
      window.removeEventListener('pointermove', onMove)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [enabled])
}
