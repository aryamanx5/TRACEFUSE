// Response contracts mirrored from the backend (subset used by the UI).

export type AssertionStatus = 'verified_onchain' | 'external_assertion' | 'algorithmic_inference' | 'analyst_hypothesis'

export interface Label {
  label: string
  category: string | null
  source: string
  source_url?: string | null
  note?: string | null
}

export interface Hop {
  forward: number | null
  backward: number | null
  undirected: number | null
}

export interface GraphNode {
  id: string
  address: string
  is_seed: boolean
  is_contract: boolean | null
  name: string | null
  labels: Label[]
  expansion_status: string
  expansion_note?: string | null
  hop: Hop
  in_count: number
  out_count: number
  fan_in: number
  fan_out: number
  community: number | null
  component: number | null
  pagerank: number | null
  score: number | null
  band: string | null
  category: string | null
  evidence_count: number
}

export interface AssetTotal {
  asset_key: string
  symbol: string
  decimals?: number | null
  recognised: boolean
  raw: string
  amount: string | null
  count: number
}

export interface GraphEdge {
  id: string
  source: string
  target: string
  count: number
  transfer_ids: string[]
  tx_hashes: string[]
  totals: AssetTotal[]
  kinds: string[]
  value_bearing: boolean
  self_transfer: boolean
  first_ts: number | null
  last_ts: number | null
}

export interface GraphStats {
  nodes: number
  edges: number
  transfers: number
  value_bearing_transfers: number
  components: number
  density: number
  first_ts: number | null
  last_ts: number | null
  missing_timestamps: number
  assets: AssetTotal[]
}

export interface GraphResponse {
  nodes: GraphNode[]
  edges: GraphEdge[]
  stats: GraphStats
  seeds: string[]
  components: string[][]
  caveat: string
}

export interface Provenance {
  provider: string
  endpoint: string
  retrieved_at: string
  data_origin: 'live' | 'cached' | 'historical_case'
  from_cache: boolean
}

export interface Transfer {
  id: string
  chain: string
  chain_id: number
  tx_hash: string
  block_number: number
  timestamp: string | null
  timestamp_quality: string
  from_address: string
  to_address: string | null
  kind: string
  asset: { symbol: string; contract: string | null; decimals: number | null; recognised: boolean; token_type: string }
  raw_amount: string
  amount: string | null
  success: boolean
  method: string | null
  explorer_url: string
  provenance: Provenance
}

export interface Evidence {
  id: string
  kind: string
  subject_chain: string | null
  subject_address: string | null
  subject_tx: string | null
  title: string
  source: string
  source_url: string | null
  source_item_id: string | null
  snippet: string | null
  match_location: string | null
  match_criteria: string | null
  query: string | null
  published_at: string | null
  collected_at: string
  confidence: string
  assertion_status: AssertionStatus
  caveats: string[]
  attributes: Record<string, unknown>
  data_origin: string
}

export interface SourceStatus {
  source: string
  state: string
  message: string | null
  queried: number
  results: number
  from_cache: number
  last_retrieved_at: string | null
}

export interface Investigation {
  id: string
  case_id: string | null
  config: InvestigationConfig
  status: 'queued' | 'running' | 'completed' | 'partial' | 'failed' | 'cancelled'
  data_origin: string
  seed_kind: string
  seed_value: string
  chain: string
  provider: string | null
  created_at: string
  started_at: string | null
  finished_at: string | null
  error: string | null
  warnings: string[]
  summary: Record<string, unknown>
  running?: boolean
  transfer_count?: number
  source_status?: SourceStatus[]
  seed?: Record<string, unknown>
}

export interface InvestigationConfig {
  seed: string
  chain: string
  direction: 'forward' | 'backward' | 'both'
  max_hops: number
  max_branching: number
  max_transfers_per_address: number
  max_nodes: number
  time_start: string | null
  time_end: string | null
  include_internal: boolean
  include_tokens: boolean
  include_unrecognised_tokens_in_traversal: boolean
  min_traversal_share: number
  osint: { ofac: boolean; goplus: boolean; github: boolean; blockscout_labels: boolean }
  crosschain: { enabled: boolean; target_chains: string[]; window_hours: number; amount_tolerance: number; max_candidates_per_event: number }
  provider?: string | null
}

export interface ProgressEvent {
  seq: number
  investigation_id: string
  stage: string
  status: 'started' | 'progress' | 'completed' | 'failed' | 'skipped' | 'warning' | 'info'
  message: string
  detail: Record<string, unknown>
  ts: string
}

export interface Signal {
  key: string
  label: string
  enabled: boolean
  weight: number
  value: number
  contribution: number
  available: boolean
  facts: string[]
  missing_reason: string | null
}

export interface Score {
  address: string
  category: 'seed' | 'infrastructure' | 'candidate'
  score: number
  band: string
  signals: Signal[]
  coverage: number
  caps_applied: string[]
  labels: (string | null)[]
  limitations: string[]
  rank: number | null
}

export interface MatrixCell {
  row: number
  col: number
  count: number
  raw: string | null
  amount: string | null
  value: number
  transfer_ids: string[]
}

export interface MatrixResponse {
  measure: 'count' | 'value'
  asset_key: string | null
  symbol: string | null
  labels: string[]
  cells: MatrixCell[]
  max: number
  min_nonzero: number
  scale: 'log' | 'linear'
  legend: string
  truncated: { total_nodes: number; shown: number; limit: number; is_truncated: boolean }
}

export interface TimelineEvent {
  id: string
  ts: number
  time: string
  tx_hash: string
  from: string
  to: string | null
  amount: string | null
  symbol: string
  asset_key: string
  kind: string
  explorer_url: string
}

export interface TimelineResponse {
  events: TimelineEvent[]
  buckets: { start: number; end: number; count: number }[]
  gaps: { start: number; end: number; seconds: number }[]
  missing_timestamps: number
  range: { start: number; end: number; start_iso: string; end_iso: string } | null
  gap_threshold_note?: string
  timestamp_quality?: string
}

export interface FusionEntity {
  id: string
  type: string
  title?: string
  chain?: string
  address?: string
  labels?: (string | null)[]
  is_seed?: boolean
  score?: number | null
  band?: string | null
  url?: string | null
  source?: string
  tx_hash?: string
  status?: string
  privacy_gap?: string
  published_at?: string | null
}

export interface FusionRelationship {
  id: string
  type: string
  assertion_status: AssertionStatus
  source: string
  target: string
  confidence: string
  evidence: Record<string, unknown>
  method: string | null
  caveats: (string | null)[]
  first_ts: number | null
  evidence_id?: string
}

export interface FusionResponse {
  entities: FusionEntity[]
  relationships: FusionRelationship[]
  conflicts: { address: string; type: string; summary: string; evidence_ids: string[] }[]
}

export interface CrossChainLink {
  source_chain: string
  source_tx: string
  bridge_address: string
  bridge_label: string
  bridge_family: string | null
  sender: string
  destination_chain: string | null
  source_timestamp: number | null
  status: 'confirmed' | 'derived' | 'candidate' | 'unresolved'
  method: string | null
  uncertainty: string | null
  evidence_for: string[]
  evidence_against: string[]
  links: Record<string, unknown>[]
}

export interface PrivacyGap {
  address: string
  label: string
  deposits: number
  transfer_ids: string[]
  senders: string[]
  status: string
  explanation: string
}

export interface CaseSummary {
  id: string
  title: string
  description: string
  origin: string
  review_state: 'open' | 'in_review' | 'closed'
  ui_state: Record<string, unknown>
  created_at: string
  updated_at: string
  investigation_count?: number
  note_count?: number
  bookmark_count?: number
}

export interface CaseDetail extends CaseSummary {
  investigations: Investigation[]
  notes: { id: string; target_type: string; target_id: string | null; body: string; created_at: string; updated_at: string }[]
  bookmarks: { id: string; target_type: string; target_id: string; label: string | null; created_at: string }[]
  reviews: { evidence_id: string; state: string; note: string | null; updated_at: string }[]
  decisions: { id: string; body: string; created_at: string }[]
  hypotheses: { id: string; source_entity: string; target_entity: string; relation: string; rationale: string; created_at: string }[]
}

export interface ChainInfo {
  key: string
  chain_id: number
  name: string
  native_symbol: string
  ready: boolean
  keyless_live_verified: boolean
  providers: { provider: string; supports_chain: boolean; configured: boolean; credential: string | null; note: string | null }[]
}

export interface ChallengeView {
  id: string
  title: string
  intro: string
  case_key: string
  solved: number
  total: number
  checkpoints: {
    id: string
    title: string
    prompt: string
    type: string
    choices: string[] | null
    hints_available: number
    hints: string[]
    attempts: number
    solved: boolean
    explanation: string | null
    evidence: string[] | null
    inspect?: { type: string; value: string } | null
  }[]
}
