/** Shape of the illustrative network in chapter 02 (wallets per hop) and when each hop appears. */
export const HOPS = [1, 3, 8, 17, 30]

/** Reveal point for hop h on the 0..1 chapter progress. */
export const hopAt = (h: number) => 0.1 + h * 0.15

export function webglOk() {
  try {
    const c = document.createElement('canvas')
    return !!(c.getContext('webgl2') ?? c.getContext('webgl'))
  } catch {
    return false
  }
}
