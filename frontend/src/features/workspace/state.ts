import type { Evidence, FusionRelationship } from '../../lib/types'

export interface Filter {
  start: number | null // unix seconds
  end: number | null
  assets: string[]
  kinds: string[]
  includeZero: boolean
  includeUnrecognised: boolean
  hide: string[]
  minAmount: string
}

export const DEFAULT_FILTER: Filter = {
  start: null,
  end: null,
  assets: [],
  kinds: [],
  includeZero: false,
  includeUnrecognised: true,
  hide: [],
  minAmount: '',
}

export function filterParams(f: Filter): Record<string, string | boolean | undefined | string[]> {
  return {
    start: f.start !== null ? String(f.start) : undefined,
    end: f.end !== null ? String(f.end) : undefined,
    assets: f.assets,
    kinds: f.kinds,
    include_zero_value: f.includeZero || undefined,
    include_unrecognised: f.includeUnrecognised ? undefined : false,
    hide: f.hide,
    min_amount: f.minAmount || undefined,
  }
}

export type Selection =
  | { kind: 'node'; address: string }
  | { kind: 'edge'; source: string; target: string }
  | { kind: 'evidence'; evidence: Evidence }
  | { kind: 'relationship'; rel: FusionRelationship }
  | { kind: 'transfers'; ids: string[]; title: string }
  | null

export type TabId = 'graph' | 'matrix' | 'fusion' | 'scores' | 'evidence' | 'crosschain' | 'metrics'
