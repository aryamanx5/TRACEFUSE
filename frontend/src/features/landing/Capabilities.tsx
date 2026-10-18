import { useRef, type ReactNode } from 'react'
import type { CharacterKind } from '../../components/cast'
import { Character } from '../../components/characters'
import { ChapterLabel, MaskLine, Reveal } from './parts'

/*
 * 05 — What TRACEFUSE enables. Six plates in a staggered editorial arrangement; each plate has its own
 * drawn motif (schematic, not data), a label tab overlapping the frame, and one or two plain sentences.
 */

const INK = '#0e0f10'

function ArtTrace() {
  const ends: [number, number][] = [[250, 52], [250, 104], [250, 156], [250, 208], [340, 40], [340, 80], [340, 132], [340, 186], [340, 226]]
  return (
    <svg viewBox="0 0 400 260" aria-hidden focusable="false">
      <defs><linearGradient id="cap-g1" x1="0" x2="1"><stop offset="0" stopColor="#5ef2c2" /><stop offset="1" stopColor="#3fd0ff" /></linearGradient></defs>
      {[[160, 78], [160, 182]].map(([x, y], i) => <path key={i} d={`M64 130 C110 130 110 ${y} ${x} ${y}`} stroke="#5ef2c2" strokeWidth="3" fill="none" />)}
      {ends.slice(0, 4).map(([x, y], i) => <path key={i} d={`M160 ${i < 2 ? 78 : 182} C205 ${i < 2 ? 78 : 182} 205 ${y} ${x} ${y}`} stroke="#5ef2c2" strokeOpacity=".55" strokeWidth="2" fill="none" />)}
      {ends.slice(4).map(([x, y], i) => <path key={i} d={`M250 ${[52, 52, 104, 156, 208][i]} C295 ${[52, 52, 104, 156, 208][i]} 295 ${y} ${x} ${y}`} stroke="#5ef2c2" strokeOpacity=".3" strokeWidth="1.6" fill="none" />)}
      <path d="M64 130 C110 130 110 182 160 182 C205 182 205 156 250 156 C295 156 295 132 340 132" stroke="url(#cap-g1)" strokeWidth="6" fill="none" />
      {ends.map(([x, y], i) => <rect key={i} x={x - 7} y={y - 7} width="14" height="14" fill="#202224" stroke="#5ef2c2" strokeWidth="2" />)}
      <rect x="146" y="64" width="28" height="28" fill="#202224" stroke="#5ef2c2" strokeWidth="2.5" />
      <rect x="146" y="168" width="28" height="28" fill="#3fd0ff" stroke={INK} strokeWidth="3" />
      <rect x="40" y="106" width="48" height="48" fill="#5ef2c2" stroke={INK} strokeWidth="4" />
      <path d="M52 130h24M64 118v24" stroke={INK} strokeWidth="4" />
      <rect x="326" y="118" width="28" height="28" fill="#3fd0ff" stroke={INK} strokeWidth="3" />
    </svg>
  )
}

function ArtReplay() {
  const bars = [8, 14, 6, 22, 40, 64, 52, 30, 18, 26, 44, 70, 88, 60, 34, 20, 12, 28, 16, 8]
  return (
    <svg viewBox="0 0 400 260" aria-hidden focusable="false">
      {bars.map((h, i) => <rect key={i} x={30 + i * 17.5} y={200 - h * 1.6} width="12" height={h * 1.6} fill={i < 12 ? '#a99bff' : '#3b3e42'} />)}
      <path d="M30 206h350" stroke="#f1efe7" strokeOpacity=".4" strokeWidth="1.5" />
      {Array.from({ length: 11 }, (_, i) => <path key={i} d={`M${30 + i * 35} 206v8`} stroke="#f1efe7" strokeOpacity=".4" />)}
      <path d="M244 40v180" stroke="#f1efe7" strokeWidth="3" />
      <path d="M232 28h24l-12 14Z" fill="#f1efe7" />
      <circle cx="96" cy="70" r="34" fill="#202224" stroke="#a99bff" strokeWidth="4" />
      <path d="M96 70V48M96 70l16 10" stroke="#f1efe7" strokeWidth="4" strokeLinecap="square" />
      <path d="M140 64l14 8-14 8Z" fill="#a99bff" />
    </svg>
  )
}

function ArtIntel() {
  return (
    <svg viewBox="0 0 400 260" aria-hidden focusable="false">
      <g transform="rotate(-8 120 120)">
        <path d="M60 40h96l24 24v130H60Z" fill="#f1efe7" stroke={INK} strokeWidth="4" />
        <path d="M156 40v24h24" fill="#cfccc3" stroke={INK} strokeWidth="4" />
        <path d="M78 82h80M78 100h80M78 118h56M78 136h80M78 154h40" stroke={INK} strokeWidth="5" />
        <rect x="76" y="114" width="70" height="10" fill="#a99bff" />
      </g>
      <path d="M180 132 C230 132 240 168 290 168" stroke="#a99bff" strokeWidth="4" strokeDasharray="10 7" fill="none" />
      <path d="M318 132l34 20v40l-34 20-34-20v-40Z" fill="#5ef2c2" stroke={INK} strokeWidth="4" />
      <path d="M318 132l34 20-34 20-34-20Z" fill="#9ffbe0" stroke={INK} strokeWidth="4" />
      <circle cx="226" cy="146" r="18" fill="#ff7a3d" stroke={INK} strokeWidth="4" />
      <path d="M218 146l6 6 10-11" stroke={INK} strokeWidth="4" fill="none" />
    </svg>
  )
}

function ArtLeads() {
  const rows = [0.92, 0.74, 0.58, 0.41, 0.27]
  return (
    <svg viewBox="0 0 400 260" aria-hidden focusable="false">
      {rows.map((w, i) => (
        <g key={i} transform={`translate(40 ${36 + i * 42})`}>
          <text x="0" y="20" fill="#f1efe7" fontFamily="JetBrains Mono, monospace" fontSize="14" opacity=".7">{String(i + 1).padStart(2, '0')}</text>
          <rect x="34" y="6" width="290" height="18" fill="#202224" />
          <rect x="34" y="6" width={290 * w} height="18" fill={i === 0 ? '#ffb03a' : i === 1 ? '#ff7a3d' : '#5c5f63'} />
          {[0, 1, 2].map((s) => <rect key={s} x={34 + 290 * w + 8 + s * 12} y="10" width="8" height="10" fill={s < 3 - Math.min(2, i) ? '#a99bff' : 'transparent'} stroke="#a99bff" strokeWidth="1.5" />)}
        </g>
      ))}
    </svg>
  )
}

function ArtChains() {
  return (
    <svg viewBox="0 0 400 260" aria-hidden focusable="false">
      <path d="M20 190 110 150 200 190 110 230Z" fill="#202224" stroke="#5ef2c2" strokeWidth="3" />
      <path d="M200 120 290 80 380 120 290 160Z" fill="#202224" stroke="#a99bff" strokeWidth="3" />
      <path d="M110 190 C110 70 290 40 290 120" stroke="#3fd0ff" strokeWidth="6" fill="none" />
      <path d="M140 205 C170 110 300 120 320 132" stroke="#ffb03a" strokeWidth="3" strokeDasharray="2 7" strokeLinecap="round" fill="none" />
      <rect x="98" y="178" width="24" height="24" fill="#5ef2c2" stroke={INK} strokeWidth="3" />
      <rect x="278" y="108" width="24" height="24" fill="#a99bff" stroke={INK} strokeWidth="3" />
      <path d="M188 74l12-12 12 12-12 12Z" fill="#3fd0ff" stroke={INK} strokeWidth="3" />
    </svg>
  )
}

function ArtExport() {
  return (
    <svg viewBox="0 0 400 260" aria-hidden focusable="false">
      {[2, 1, 0].map((i) => (
        <g key={i} transform={`translate(${120 + i * 22} ${30 + i * 14}) rotate(${(i - 1) * 4})`}>
          <rect width="150" height="190" fill={i === 0 ? '#f1efe7' : '#2a2c2f'} stroke={INK} strokeWidth="4" />
          {i === 0 && <>
            <rect x="16" y="18" width="70" height="12" fill="#5ef2c2" />
            {[48, 64, 80, 96, 112].map((y) => <path key={y} d={`M16 ${y}h${y % 32 ? 118 : 90}`} stroke={INK} strokeWidth="5" />)}
            <text x="16" y="150" fontFamily="JetBrains Mono, monospace" fontSize="13" fill={INK}>0x…67d0b7</text>
            <text x="16" y="170" fontFamily="JetBrains Mono, monospace" fontSize="13" fill={INK} opacity=".6">report.json</text>
          </>}
        </g>
      ))}
      <path d="M336 70v80m-24-24 24 24 24-24" stroke="#5ef2c2" strokeWidth="8" fill="none" strokeLinecap="square" />
      <path d="M306 176h60" stroke="#5ef2c2" strokeWidth="8" />
    </svg>
  )
}

const CAPS: { thin: string; heavy: string; tone: string; art: ReactNode; text: string; char: CharacterKind }[] = [
  { thin: 'Trace', heavy: 'Fund flows', tone: 'mint', art: <ArtTrace />, char: 'hexo', text: 'Follow money hop by hop from a wallet or transaction, with the route to any wallet one click away.' },
  { thin: 'Replay', heavy: 'Over time', tone: 'violet', art: <ArtReplay />, char: 'blocky', text: 'Play recorded transfers back in the order they happened — layout and camera stay still.' },
  { thin: 'Connect', heavy: 'Public intel', tone: 'ember', art: <ArtIntel />, char: 'docket', text: 'Sanctions entries, reports and repositories attached to the wallets they mention, each with its source.' },
  { thin: 'Rank', heavy: 'Priority leads', tone: 'amber', art: <ArtLeads />, char: 'knot', text: 'Candidate wallets ordered by an explainable heuristic score — every signal shown, never a probability.' },
  { thin: 'Follow', heavy: 'Across chains', tone: 'cyan', art: <ArtChains />, char: 'archie', text: 'Bridge deposits matched to their destination — confirmed links and unconfirmed candidates kept apart.' },
  { thin: 'Inspect', heavy: '& export', tone: 'ink', art: <ArtExport />, char: 'snoop', text: 'Open the raw transaction, the source document and the reasoning; export reports, CSVs and JSON.' },
]

/** Pointer tilt for the plates (CSS variables only; the reduced-motion rule neutralises the transition). */
function tilt(e: React.PointerEvent<HTMLDivElement>) {
  if (e.pointerType !== 'mouse') return
  const r = e.currentTarget.getBoundingClientRect()
  e.currentTarget.style.setProperty('--rx', `${(((e.clientY - r.top) / r.height) - 0.5) * -7}deg`)
  e.currentTarget.style.setProperty('--ry', `${(((e.clientX - r.left) / r.width) - 0.5) * 9}deg`)
}
function untilt(e: React.PointerEvent<HTMLDivElement>) {
  e.currentTarget.style.setProperty('--rx', '0deg')
  e.currentTarget.style.setProperty('--ry', '0deg')
}

export function Capabilities({ reduced }: { reduced: boolean }) {
  const ref = useRef<HTMLElement>(null)
  return (
    <section ref={ref} id="capabilities" data-stage={4} aria-labelledby="capabilities-title" className="tfl-chapter tfl-caps-sec">
      <div className="tfl-caps-head">
        <ChapterLabel n="05">What it enables</ChapterLabel>
        <h2 id="capabilities-title" className="tf-display tfl-h2 tfl-center" tabIndex={-1}>
          <MaskLine reduced={reduced} className="tf-thin">From one wallet</MaskLine>{' '}
          <MaskLine reduced={reduced} i={1} className="tf-heavy">to a case file.</MaskLine>
        </h2>
      </div>
      <ul className="tfl-plates">
        {CAPS.map((c, i) => (
          <Reveal key={c.heavy} as="li" reduced={reduced} className={`tfl-plate tfl-tone-${c.tone}`} delay={(i % 2) * 0.12}>
            <div className="tfl-plate-frame tfl-tilt" data-index={String(i + 1).padStart(2, '0')} onPointerMove={tilt} onPointerLeave={untilt}>
              <span className={`tfl-plate-mascot ${i % 2 ? 'tfl-pm-left' : ''}`} aria-hidden><Character kind={c.char} size={112} pop={!reduced} delay={0.25} flip={i % 2 === 1} idle={i % 3 ? 'bob' : 'sway'} /></span>
              <div className="tfl-plate-art">{c.art}</div>
              <h3 className="tfl-plate-tab tf-display">
                <span className="tf-thin">{c.thin}</span> <span className="tf-heavy">{c.heavy}</span>
              </h3>
            </div>
            <p>{c.text}</p>
          </Reveal>
        ))}
      </ul>
    </section>
  )
}
