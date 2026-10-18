/** The Tracers cast: one character per colour of the evidence language (see characters.tsx). */
export type CharacterKind = 'hexo' | 'docket' | 'snoop' | 'knot' | 'archie' | 'blocky'

export const CAST: { kind: CharacterKind; name: string; role: string; color: string }[] = [
  { kind: 'hexo', name: 'Hexo', role: 'Verified on-chain', color: '#5ef2c2' },
  { kind: 'docket', name: 'Docket', role: 'Reported by a source', color: '#a99bff' },
  { kind: 'knot', name: 'Knot', role: 'Unconfirmed link', color: '#ffb03a' },
  { kind: 'snoop', name: 'Snoop', role: 'Your selection', color: '#3fd0ff' },
  { kind: 'archie', name: 'Archie', role: 'Across chains', color: '#ff7a3d' },
  { kind: 'blocky', name: 'Blocky', role: 'The raw record', color: '#f1efe7' },
]
