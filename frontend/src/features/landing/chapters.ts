/** Stable chapter identifiers — used for section ids, nav anchors and the chapter index. */
export const CHAPTERS = [
  { id: 'signal', label: 'The signal', height: 140 },
  { id: 'fragmentation', label: 'Fragmentation', height: 150 },
  { id: 'disconnected', label: 'Disconnected intelligence', height: 160 },
  { id: 'fusion', label: 'Evidence fusion', height: 150 },
  { id: 'enter', label: 'Enter the investigation', height: 130 },
] as const

export type ChapterId = (typeof CHAPTERS)[number]['id']

export const HERO_VIDEO = '/media/tracefuse-hero.mp4'
export const HERO_POSTER = '/media/tracefuse-hero-poster.jpg'

export const pad = (i: number) => String(i + 1).padStart(2, '0')
