/** Stable chapter identifiers — used for section ids, nav anchors and the chapter index rail. */
export const CHAPTERS = [
  { id: 'signal', label: 'The signal' },
  { id: 'fragmentation', label: 'Fragmentation' },
  { id: 'disconnected', label: 'Disconnected intelligence' },
  { id: 'fusion', label: 'Evidence fusion' },
  { id: 'capabilities', label: 'What it enables' },
  { id: 'enter', label: 'Enter the investigation' },
] as const

export type ChapterId = (typeof CHAPTERS)[number]['id']

export const HERO_VIDEO = '/media/tracefuse-hero.mp4'
export const HERO_POSTER = '/media/tracefuse-hero-poster.jpg'
export const WORKSPACE_SHOT = '/media/tracefuse-workspace.jpg'

export const pad = (i: number) => String(i + 1).padStart(2, '0')
