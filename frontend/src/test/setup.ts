import '@testing-library/jest-dom/vitest'

// jsdom lacks these browser APIs used by layout code
class RO {
  observe() {}
  unobserve() {}
  disconnect() {}
}
Object.assign(globalThis, { ResizeObserver: globalThis.ResizeObserver ?? RO })
if (!window.matchMedia) {
  ;(window as unknown as { matchMedia: unknown }).matchMedia = (q: string) => ({
    matches: q.includes('reduce'),
    media: q,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    onchange: null,
    dispatchEvent: () => false,
  })
}
class IO {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return []
  }
}
Object.assign(globalThis, { IntersectionObserver: globalThis.IntersectionObserver ?? IO })
