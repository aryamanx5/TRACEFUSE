/** Concise legend shared by the 2D and 3D views. Shapes and colours match both renderers. */
export function FlowLegend({ inferred }: { inferred: boolean }) {
  const dot = (fill: string, stroke: string, shape: 'circle' | 'diamond' | 'hex' | 'oct' | 'square' | 'rounded' = 'circle', r = 5) => (
    <svg viewBox="0 0 14 14" className="h-3.5 w-3.5 shrink-0" aria-hidden>
      {shape === 'circle' && <circle cx="7" cy="7" r={r} fill={fill} stroke={stroke} strokeWidth="1.6" />}
      {shape === 'diamond' && <path d="M7 1 13 7 7 13 1 7Z" fill={fill} stroke={stroke} strokeWidth="1.6" />}
      {shape === 'hex' && <path d="M4 1.5h6L13 7l-3 5.5H4L1 7Z" fill={fill} stroke={stroke} strokeWidth="1.6" />}
      {shape === 'oct' && <path d="M4.5 1h5L13 4.5v5L9.5 13h-5L1 9.5v-5Z" fill={fill} stroke={stroke} strokeWidth="1.6" />}
      {shape === 'square' && <rect x="2" y="2" width="10" height="10" fill={fill} stroke={stroke} strokeWidth="1.6" />}
      {shape === 'rounded' && <rect x="2" y="3" width="10" height="8" rx="2.5" fill={fill} stroke={stroke} strokeWidth="1.6" />}
    </svg>
  )
  const line = (stroke: string, dash?: string, w = 2) => (
    <svg viewBox="0 0 26 8" className="h-2 w-6 shrink-0" aria-hidden><line x1="1" y1="4" x2="25" y2="4" stroke={stroke} strokeWidth={w} strokeDasharray={dash} strokeLinecap="round" /></svg>
  )
  const item = 'flex items-center gap-1.5'
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-line bg-elev px-3 py-2 text-[11px] text-dim" aria-label="Legend" role="group">
      <span className="tf-kicker mr-1">Legend</span>
      <span className={item}>{dot('var(--signal)', 'var(--signal-2)', 'square')} Starting wallet</span>
      <span className={item}>{dot('var(--panel-2)', 'var(--signal)')} Wallet</span>
      <span className={item}>{dot('color-mix(in srgb, var(--hypo) 30%, transparent)', 'var(--hypo)')} Flagged by a public source</span>
      <span className={item}>{dot('var(--panel-2)', 'var(--signal-2)', 'diamond')} Bridge</span>
      <span className={item}>{dot('var(--panel-2)', 'var(--signal-2)', 'hex')} Exchange / DEX</span>
      <span className={item}>{dot('color-mix(in srgb, var(--ember) 30%, transparent)', 'var(--ember)', 'oct')} Mixer</span>
      <span className={item}>{dot('var(--panel-2)', 'var(--signal)', 'rounded')} Contract</span>
      <span className="mx-1 hidden h-3 w-px bg-linestrong sm:inline-block" aria-hidden />
      <span className={item} title="A transfer recorded on the blockchain">{line('var(--signal)')} Verified transaction</span>
      <span className={item} title="A contract call that moved no value">{line('var(--line-strong)', '4 3')} Contract call, no value</span>
      <span className={item} title="Highlighted by Trace path">{line('var(--signal-2)', undefined, 3.5)} Traced route</span>
      {inferred && <span className={item} title="Pattern detected by an algorithm; not confirmed by a transaction or a source">{line('var(--hypo)', '1 4')} Unverified hypothesis</span>}
      <span className="text-faint">Labels on wallets are source-reported information — open a wallet to see the source.</span>
    </div>
  )
}
