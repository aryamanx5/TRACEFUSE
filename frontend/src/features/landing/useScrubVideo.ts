import type { MotionValue } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'

export type MediaState = 'poster' | 'loading' | 'ready' | 'failed'

/**
 * Maps a 0..1 scroll progress value onto a video's real playback position.
 *
 * - The file is fetched once (as a blob, so every later seek is local) after the first paint; the poster
 *   stays on screen until the first frame has actually been decoded.
 * - Seeks are driven by one requestAnimationFrame loop that eases towards the target time and never issues a
 *   new seek while the previous one is still in flight. The loop sleeps when the target is reached or the
 *   stage is off screen, so nothing runs while the visitor reads the rest of the page.
 * - The video never plays on its own: scroll is the only clock.
 */
export function useScrubVideo({
  src,
  progress,
  enabled,
  stage,
}: {
  src: string
  progress: MotionValue<number>
  enabled: boolean
  stage: React.RefObject<HTMLElement | null>
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [state, setState] = useState<MediaState>(enabled ? 'loading' : 'poster')

  useEffect(() => {
    const video = videoRef.current
    if (!enabled || !video) {
      setState('poster')
      return
    }
    setState('loading')
    let disposed = false
    let objectUrl: string | null = null
    let raf = 0
    let visible = true
    let shown = 0 // eased playback position (seconds)
    const ctrl = new AbortController()

    const duration = () => (Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0)
    const target = () => Math.min(Math.max(progress.get(), 0), 1) * Math.max(duration() - 0.04, 0)

    const tick = () => {
      raf = 0
      if (disposed || !visible || !duration()) return
      const t = target()
      shown += (t - shown) * 0.22
      if (Math.abs(t - shown) < 0.004) shown = t
      if (!video.seeking && Math.abs(video.currentTime - shown) > 1 / 90) video.currentTime = shown
      if (shown !== t || video.seeking) raf = requestAnimationFrame(tick)
    }
    const wake = () => {
      if (!raf && !disposed) raf = requestAnimationFrame(tick)
    }

    const onMeta = () => {
      shown = target()
      video.currentTime = shown
    }
    const onSeeked = () => {
      if (!disposed) setState((s) => (s === 'failed' ? s : 'ready'))
      wake()
    }
    const onError = () => !disposed && setState('failed')
    const onPlay = () => video.pause() // scroll is the only clock
    video.addEventListener('loadedmetadata', onMeta)
    video.addEventListener('seeked', onSeeked)
    video.addEventListener('error', onError)
    video.addEventListener('play', onPlay)
    const unsub = progress.on('change', wake)

    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting
      if (visible) wake()
    })
    if (stage.current) io.observe(stage.current)

    // Start the download after the poster has had a chance to paint.
    const start = () => {
      fetch(src, { signal: ctrl.signal })
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`)
          return r.blob()
        })
        .then((blob) => {
          if (disposed) return
          objectUrl = URL.createObjectURL(blob)
          video.src = objectUrl
          video.load()
        })
        .catch((err: unknown) => {
          if (disposed || (err instanceof DOMException && err.name === 'AbortError')) return
          // Fall back to letting the browser stream it with range requests; `error` handles a real failure.
          video.src = src
          video.load()
        })
    }
    const ric = (window as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback
    const idle = ric ? ric(start, { timeout: 1200 }) : window.setTimeout(start, 300)

    return () => {
      disposed = true
      ctrl.abort()
      const cic = (window as { cancelIdleCallback?: (h: number) => void }).cancelIdleCallback
      if (ric && cic) cic(idle)
      else window.clearTimeout(idle)
      if (raf) cancelAnimationFrame(raf)
      unsub()
      io.disconnect()
      video.removeEventListener('loadedmetadata', onMeta)
      video.removeEventListener('seeked', onSeeked)
      video.removeEventListener('error', onError)
      video.removeEventListener('play', onPlay)
      video.removeAttribute('src')
      video.load()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [src, progress, enabled, stage])

  return { videoRef, state }
}
